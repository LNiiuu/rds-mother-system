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
// 注意：这里**不**在模块顶层 require 组合根或 db.js —— 它们会把 node:sqlite 一起拉进来，
// 而 doctor 恰恰要在 node:sqlite 不可用时给出诊断。所需模块在用到的地方按需引入。

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

/** 只收 Markdown。`walk` 按 CODE_EXT 过滤，.md 不在其中，需要单独一遍。 */
function walkMarkdown(dir, acc) {
  acc = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkMarkdown(path.join(dir, e.name), acc);
    } else if (e.name.toLowerCase().endsWith('.md')) {
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
  // M4 / B4：门槛从 22.5 提到 22.15 —— node:sqlite 在 22.5 就有，但 zstd 系列
  // （zstdDecompressSync，ledger 解析会话必需）到 22.15 才进 v22 分支。
  // 只按 sqlite 声明会让 22.5–22.14 的用户装得上、跑不了 ledger。
  const okNode = maj > 22 || (maj === 22 && min >= 15);
  add(
    'node',
    okNode ? 'ok' : 'fail',
    `v${v}（要求 >=22.15.0；22.5 起有 node:sqlite，22.15 起才有 zlib zstd）`
      + (process.versions.electron ? '；运行在 Electron 内，非标准 Node' : '')
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

  // 2b) zlib zstd：rds ledger 解析 zstd 会话必需。缺失时 ledger 会报 ZSTD_UNSUPPORTED，
  //      但那要等到用户跑命令才发现；这里提前说清楚。
  try {
    const zlib = require('node:zlib');
    const ok = typeof zlib.zstdDecompressSync === 'function' && typeof zlib.zstdCompressSync === 'function';
    add('zlib:zstd', ok ? 'ok' : 'fail',
      ok ? 'zstdCompressSync / zstdDecompressSync 可用（rds ledger 依赖）'
         : `当前 Node 缺少 zlib zstd（${process.version}）；rds ledger 不可用，请升级到 >=22.15.0`);
  } catch (err) {
    add('zlib:zstd', 'fail', err.message);
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

  // 历史证据里的机器路径：md 与代码/配置都要扫。
  // M5 / B4：此前只扫 CODE_EXT（不含 .md），于是「文档路径卫生」实际上从未检查过 .md。
  const docFiles = walk(path.join(ROOT, 'docs'), [])
    .concat(walkMarkdown(path.join(ROOT, 'docs')))
    .concat(walk(path.join(ROOT, 'mars', 'docs'), []))
    .concat(walkMarkdown(path.join(ROOT, 'mars', 'docs')));
  const docHits = scanPaths(docFiles, pats);
  add(
    'paths:docs',
    docHits.length === 0 ? 'ok' : 'warn',
    docHits.length === 0
      ? '历史文档无本机绝对路径'
      : `${docHits.length} 个文档文件命中（历史证据记录，属 M5 文档清理范围）`
  );

  // 6c) 活跃 Markdown 的路径卫生（M5 / B4）。
  //
  // 为什么不并进 paths:docs —— 两者性质不同：
  //   paths:docs   = 历史证据，含作者机器路径是「真实记录」，改写等于篡改，只告警；
  //   paths:assets = 会进发行包或作为仓库门面的文档，用户会直接读到，含机器路径即缺陷。
  //
  // 此前的盲区：core/**/*.md 会随包分发（package.json.files 含 "core/"），
  // 却不参与任何路径检查 —— CODE_EXT 不含 .md，paths:docs 只扫 docs/ 与 mars/docs/。
  // 活跃文档 = 仓库门面（README / CHANGELOG）+ docs/ 根下的正式文档 + core/**/*.md。
  // docs/ 根用目录扫描而不是硬编码清单：新增一份正式文档不必再改这里。
  // 排除 M1-0-*.md —— 它们是 2026-11-01 的阶段验收报告，属历史证据。
  const ASSET_DOCS_FIXED = ['README.md', 'CHANGELOG.md'];
  let docsRootMd = [];
  try {
    docsRootMd = fs.readdirSync(path.join(ROOT, 'docs'))
      .filter((n) => n.endsWith('.md') && !/^M1-0-/.test(n))
      .map((n) => path.join(ROOT, 'docs', n));
  } catch {
    /* docs/ 不存在时跳过 */
  }
  const assetDocs = ASSET_DOCS_FIXED
    .map((f) => path.join(ROOT, f))
    .filter((f) => fs.existsSync(f))
    .concat(docsRootMd)
    .concat(walkMarkdown(path.join(ROOT, 'core')));
  const assetHits = scanPaths(assetDocs, pats);
  add(
    'paths:assets',
    assetHits.length === 0 ? 'ok' : 'fail',
    assetHits.length === 0
      ? `已扫描 ${assetDocs.length} 个活跃文档，无本机绝对路径`
      : `${assetHits.length} 个文件命中：` +
        assetHits.slice(0, 5).map((h) => `${h.file}:${h.line}`).join('，')
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
  // M3 / B2：路径由组合根的 resolvePaths 统一解析（与 rds put / MCP 走同一套优先级），
  // 不再在这里单独读 MARS_DB —— 否则 doctor 报的库和实际写入的库可能不是同一个。
  // M4 / B3：这里真的把库打开（只读），而不是只看文件是否存在。
  //           "文件在"与"库能读"是两件事；损坏的库只有打开才知道。
  const { resolvePaths } = require(path.join(ROOT, 'mars', 'src', 'paths.js'));
  const { SCHEMA_VERSION } = require(path.join(ROOT, 'mars', 'src', 'db', 'schema.js'));
  const dbPath = resolvePaths({ env: process.env }).db;

  if (!fs.existsSync(dbPath)) {
    add('database', 'info', `未初始化：${dbPath}（rds init 创建）`);
  } else {
    const size = fs.statSync(dbPath).size;
    let handle = null;
    try {
      const { DatabaseSync } = require('node:sqlite');
      handle = new DatabaseSync(dbPath, { readOnly: true });
      const row = handle.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
      const got = Number(row && row.value);
      const quick = handle.prepare('PRAGMA quick_check').get();
      const integrity = quick && (quick.quick_check || Object.values(quick)[0]);

      if (Number.isFinite(got) && got > SCHEMA_VERSION) {
        add('database', 'fail',
          `结构版本 ${got} 高于当前代码支持的 ${SCHEMA_VERSION}（${dbPath}）；请升级 rds，勿用旧版本打开`);
      } else if (Number.isFinite(got) && got < SCHEMA_VERSION) {
        add('database', 'warn',
          `结构版本 ${got} < ${SCHEMA_VERSION}（${size} B）；下次打开会自动增量迁移，建议先备份`);
      } else if (integrity && String(integrity).toLowerCase() !== 'ok') {
        add('database', 'fail', `完整性检查未通过（${integrity}）；请从备份恢复：${dbPath}`);
      } else {
        add('database', 'ok', `${dbPath}（${size} B，schema ${Number.isFinite(got) ? got : '?'}）`);
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      const hint = /not a database|malformed|corrupt/i.test(msg)
        ? '不是有效的 SQLite 数据库或已损坏；从备份恢复（node mars/scripts/mars-db-backup.js）'
        : '检查文件权限与磁盘状态';
      add('database', 'fail', `无法打开 ${dbPath}：${msg}。${hint}`);
    } finally {
      try { if (handle) handle.close(); } catch (err) { /* ignore */ }
    }
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
