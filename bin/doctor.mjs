#!/usr/bin/env node
/**
 * rds doctor —— 环境与安装体检（M1-9）。
 *
 * 设计原则：
 *   - 只读为主：除一次「写入-删除」的权限探测外，不修改任何文件；不读取任何凭据内容
 *   - 不判断「能力可用」：只回答「依赖是否就绪」，能力结论必须靠实际工作流验证
 *   - 退出码可被 CI 使用：有 fail 即 1，仅 warn 仍为 0
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// node:sqlite 在 22.x 会打印 ExperimentalWarning，诊断输出里不该出现这条噪音。
const originalEmit = process.emit;
process.emit = function (name, data) {
  if (name === 'warning' && data && data.name === 'ExperimentalWarning') return false;
  return originalEmit.apply(this, arguments);
};

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.ps1', '.cmd', '.sh']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'var', 'dist', 'coverage']);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function walk(dir, acc, opts = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (opts.excludeDocs && e.name === 'docs' && dir === ROOT) continue;
      if (opts.excludeDocs && dir === path.join(ROOT, 'mars') && e.name === 'docs') continue;
      walk(path.join(dir, e.name), acc, opts);
    } else if (CODE_EXT.has(path.extname(e.name).toLowerCase())) {
      // 本机工具链配置按设计就含机器路径，不参与门禁
      if (e.name === 'toolchain.local.json') continue;
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

/** 本机绝对路径痕迹。用字符码拼装，避免本文件自己命中自己。 */
function machinePatterns() {
  const B = String.fromCharCode(92);
  const F = '/';
  return [
    'D:' + B + 'M1',
    'D:' + F + 'M1',
    'D:' + B + 'Tools',
    'D:' + F + 'Tools',
    'D:' + B + 'Projects',
    'C:' + B + 'Users' + B + 'liuch',
    'C:' + F + 'Users' + F + 'liuch',
  ];
}

function scanPaths(files, patterns) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const p of patterns) {
      const at = text.indexOf(p);
      if (at === -1) continue;
      const line = text.slice(0, at).split('\n').length;
      hits.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), line, pattern: p });
      break;
    }
  }
  return hits;
}

export function collect() {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  // 1) Node 版本
  const v = process.versions.node;
  const [maj, min] = v.split('.').map((n) => parseInt(n, 10));
  const okNode = maj > 22 || (maj === 22 && min >= 5);
  add(
    'node',
    okNode ? 'ok' : 'fail',
    `v${v}（要求 >=22.5.0）` + (process.versions.electron ? '；运行在 Electron 内，非标准 Node' : '')
  );

  // 2) node:sqlite + FTS5
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('create virtual table t using fts5(x)');
    db.close();
    add('node:sqlite', 'ok', '模块可用，FTS5 虚拟表可用');
  } catch (err) {
    add('node:sqlite', 'fail', err.message);
  }

  // 3) Git（可选依赖）
  const g = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (g.status === 0) {
    add('git', 'ok', (g.stdout || '').trim());
  } else {
    add('git', 'warn', '未在 PATH 中找到；仅影响 tooling/sync.ps1 等脚本，不影响 MARS 本体');
  }

  // 4) 数据目录可写
  const dbDefault = path.join(ROOT, 'mars', 'var');
  const probeDir = fs.existsSync(dbDefault) ? dbDefault : ROOT;
  try {
    const probe = path.join(probeDir, `.rds-doctor-${process.pid}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    add('writable', 'ok', probeDir);
  } catch (err) {
    add('writable', 'fail', `${probeDir}：${err.message}`);
  }

  // 5) 版本一致性
  let vfile = null;
  let pkg = null;
  try {
    vfile = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    /* ignore */
  }
  try {
    pkg = readJson(path.join(ROOT, 'package.json'));
  } catch {
    /* ignore */
  }
  if (!pkg) {
    add('version', 'fail', '缺少或无法解析 package.json');
  } else if (vfile !== pkg.version) {
    add('version', 'fail', `VERSION=${vfile} 与 package.json=${pkg.version} 不一致`);
  } else {
    add('version', 'ok', `${pkg.version}（VERSION 与 package.json 一致）`);
  }

  // 6) 路径卫生：代码/配置必须为 0，历史文档单独统计
  const pats = machinePatterns();
  const codeFiles = walk(ROOT, [], { excludeDocs: true });
  const codeHits = scanPaths(codeFiles, pats);
  add(
    'paths:code',
    codeHits.length === 0 ? 'ok' : 'fail',
    codeHits.length === 0
      ? `已扫描 ${codeFiles.length} 个代码/配置文件，无本机绝对路径`
      : `${codeHits.length} 个文件命中：` +
        codeHits.slice(0, 5).map((h) => `${h.file}:${h.line}`).join('，')
  );

  const docHits = scanPaths(walk(path.join(ROOT, 'docs'), []), pats).concat(
    scanPaths(walk(path.join(ROOT, 'mars', 'docs'), []), pats)
  );
  add(
    'paths:docs',
    docHits.length === 0 ? 'ok' : 'warn',
    docHits.length === 0
      ? '历史文档无本机绝对路径'
      : `${docHits.length} 个文档文件命中（历史证据记录，属 M5 文档清理范围）`
  );

  // 7) 身份文件（只报存在性，绝不读取内容）
  const principals = path.join(ROOT, 'mars', 'config', 'principals.json');
  add(
    'identity',
    'info',
    fs.existsSync(principals)
      ? 'mars/config/principals.json 存在（内容不读取；确认未被提交）'
      : '未创建（rds init-dev 生成；不要把生成的 token 写入版本库）'
  );

  // 8) 数据库
  const dbPath = process.env.MARS_DB ? path.resolve(process.env.MARS_DB) : path.join(dbDefault, 'mars.db');
  if (fs.existsSync(dbPath)) {
    const size = fs.statSync(dbPath).size;
    add('database', 'info', `${dbPath}（${size} B）`);
  } else {
    add('database', 'info', `未初始化：${dbPath}（rds init 创建）`);
  }

  return { root: ROOT, nodeVersion: process.versions.node, checks };
}

function render(result) {
  const width = Math.max(...result.checks.map((c) => c.id.length));
  const lines = [`RDS doctor  root=${result.root}`, ''];
  for (const c of result.checks) {
    lines.push(`  ${c.id.padEnd(width)}  ${c.status.padEnd(4)}  ${c.detail}`);
  }
  const fails = result.checks.filter((c) => c.status === 'fail').length;
  const warns = result.checks.filter((c) => c.status === 'warn').length;
  lines.push('');
  lines.push(
    `status: ${fails === 0 ? 'ok' : 'fail'}  (fail=${fails} warn=${warns} checks=${result.checks.length})`
  );
  return lines.join('\n');
}

export async function main(args = []) {
  const json = args.includes('--json');
  const result = collect();
  result.status = result.checks.some((c) => c.status === 'fail') ? 'fail' : 'ok';
  result.generated_at = new Date().toISOString();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(render(result));
  }
  return result.status === 'ok' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
