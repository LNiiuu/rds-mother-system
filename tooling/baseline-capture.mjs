#!/usr/bin/env node
/**
 * 行为基线采集与比对（M3 / B0）。
 *
 * 目的：M3 的每一批都声称「对外零变化」。这个「零」必须可判定，否则只是口号。
 * 本脚本把 7 个对外面的当前取值落到 docs/architecture/m3/baseline/，
 * 之后每批结束重跑 --check；除 `approved-additions.json` 里显式登记的增项外，任何差异都算漂移。
 *
 * 覆盖的 7 个面
 *   1. cli-help.txt         CLI 帮助文本（子命令与 flag 拼写）
 *   2. cli-json-keys.json   6 个子命令的 JSON 键树（值不参与比较，时间/ID 不影响）
 *   3. mcp-tools.json       MCP 工具集（名称 / 必填 / 属性 / additionalProperties）
 *   4. error-codes.json     对外错误码全集
 *   5. pack-files.txt       发行包文件清单
 *   6. contracts-sha256.json 数据契约内容哈希（M3 期间必须不变）
 *   7. exit-codes.json      10 个场景的进程退出码
 *
 * 用法:
 *   node tooling/baseline-capture.mjs           采集并写入 baseline/
 *   node tooling/baseline-capture.mjs --check   比对，漂移则退出码 1
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'docs', 'architecture', 'm3', 'baseline');
const RDS = path.join(ROOT, 'bin', 'rds.mjs');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 收集一个 JSON 值的键树（数组用 [] 归并所有元素）。只关心形状，不关心值。 */
function keyTree(value, prefix = '', acc = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keyTree(item, prefix + '[]', acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value).sort()) {
      const p = prefix ? prefix + '.' + k : k;
      acc.add(p);
      keyTree(value[k], p, acc);
    }
  }
  return acc;
}

function run(args, env) {
  const r = spawnSync(process.execPath, [RDS, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
    maxBuffer: 32 * 1024 * 1024
  });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function jsonOut(res) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

/** 建一个临时工作区，完成 init → init-dev → put → 审批 → search → compile */
function buildWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-baseline-'));
  const env = {
    MARS_DB: path.join(dir, 'mars.db'),
    MARS_PRINCIPALS: path.join(dir, 'principals.json'),
    MARS_ROUTING: path.join(ROOT, 'mars', 'config', 'role-routing.json')
  };
  const out = { dir, env, steps: {} };

  out.steps.init = run(['init'], env);

  const initDev = run(['init-dev', '--principal', 'dev-r0', '--projects', 'demo', '--roles', 'R0,R4'], env);
  const token = (initDev.stdout.match(/^DEV_TOKEN=([0-9a-f]+)$/m) || [])[1] || '';
  out.steps['init-dev'] = initDev;
  out.token = token;
  env.MARS_TOKEN = token;

  out.steps.put = run(['put', '--project', 'demo', '--type', 'L3', '--content', '基线与兼容性测试用记录',
    '--source', 'docs/d.md', '--version', 'v1'], env);
  out.steps.list = run(['list', '--project', 'demo', '--status', 'proposed'], env);
  out.steps.stats = run(['stats', '--project', 'demo'], env);

  const listJson = jsonOut(out.steps.list) || [];
  const memoryId = listJson[0] && listJson[0].memory_id;
  out.steps.get = run(['get', '--project', 'demo', '--memory', memoryId], env);

  // 追加一个 R4 审批身份（不能自审）
  const p = JSON.parse(fs.readFileSync(env.MARS_PRINCIPALS, 'utf8'));
  const t4 = crypto.randomBytes(24).toString('hex');
  p.principals.push({
    token_sha256: sha256(Buffer.from(t4, 'utf8')),
    principal_id: 'dev-r4',
    project_ids: ['demo'],
    roles: ['R4'],
    note: 'baseline approver'
  });
  fs.writeFileSync(env.MARS_PRINCIPALS, JSON.stringify(p, null, 2));
  const env4 = Object.assign({}, env, { MARS_TOKEN: t4 });

  out.steps.review = run(['review', '--project', 'demo', '--memory', memoryId, '--decision', 'approved'], env4);
  out.steps.search = run(['search', '--project', 'demo', '--query', '基线'], env4);
  out.steps.compile = run(['compile', '--project', 'demo', '--task', 'T-001', '--role', 'R4', '--budget', '4000'], env4);

  // ledger：用仓库自带的 fixture 生成器造一个会话文件
  const fixtureModule = path.join(ROOT, 'mars', 'tests', 'fixtures', 'ledger', 'make-session.js');
  if (fs.existsSync(fixtureModule)) {
    const fx = require(fixtureModule);
    const made = fx.writeSession(dir, { name: 'session.v4.jsonl.zstd', frames: 3 });
    out.steps.ledger = run(['ledger', '--session', made.file], env4);
  }

  return out;
}

function collectExitCodes(ws) {
  const env = ws.env;
  const scenarios = {
    'help: no args': [],
    'help: --help': ['--help'],
    'version': ['version'],
    'doctor': ['doctor'],
    'init': ['init'],
    'put: no token': ['put', '--project', 'demo', '--type', 'L2', '--content', 'x', '--source', 'a.md', '--version', 'v1'],
    'ledger: session missing': ['ledger', '--session', path.join(ws.dir, 'no-such.jsonl')],
    'mcp: without --enable': ['mcp'],
    'unknown command': ['no-such-command'],
    'compile: no token': ['compile', '--project', 'demo', '--role', 'R4']
  };
  const result = {};
  for (const [name, args] of Object.entries(scenarios)) {
    const scenarioEnv = Object.assign({}, env);
    if (name === 'put: no token' || name === 'compile: no token') delete scenarioEnv.MARS_TOKEN;
    result[name] = run(args, scenarioEnv).code;
  }
  return result;
}

function collectCliKeys(ws) {
  const keys = {};
  for (const step of ['put', 'get', 'list', 'stats', 'review', 'search', 'compile', 'ledger']) {
    const res = ws.steps[step];
    if (!res) continue;
    const value = jsonOut(res);
    if (value === null) {
      keys[step] = { __nonJson: true, exit: res.code };
      continue;
    }
    keys[step] = Array.from(keyTree(value)).sort();
  }
  return keys;
}

function collectMcpTools() {
  const out = execFileSync(process.execPath, ['-e', `
    const { TOOLS } = require(${JSON.stringify(path.join(ROOT, 'mars', 'src', 'mcp-stdio.js'))});
    const norm = TOOLS.map(t => ({
      name: t.name,
      required: (t.inputSchema && t.inputSchema.required) || [],
      properties: Object.keys((t.inputSchema && t.inputSchema.properties) || {}).sort(),
      additionalProperties: !!(t.inputSchema && t.inputSchema.additionalProperties === false)
    }));
    process.stdout.write(JSON.stringify(norm, null, 2));
  `], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out);
}

function collectErrorCodes() {
  const out = execFileSync(process.execPath, ['-e', `
    const { PUBLIC_CODES } = require(${JSON.stringify(path.join(ROOT, 'mars', 'src', 'errors.js'))});
    process.stdout.write(JSON.stringify(Array.from(PUBLIC_CODES).sort(), null, 2));
  `], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(out);
}

function collectPackFiles() {
  // Windows 上 npm 是 .cmd，不能用 execFileSync 直接 spawn（EINVAL），必须走 shell。
  // 参数是常量，不含用户输入，不存在注入面。
  const out = execFileSync(NPM, ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024
  });
  const start = out.indexOf('[');
  const data = JSON.parse(out.slice(start));
  return data[0].files.map((f) => f.path).sort();
}

function collectContracts() {
  const dir = path.join(ROOT, 'mars', 'contracts');
  const acc = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    acc['mars/contracts/' + name] = sha256(fs.readFileSync(path.join(dir, name)));
  }
  return acc;
}

function collectAll() {
  const ws = buildWorkspace();
  const data = {
    'cli-help.txt': run(['--help'], ws.env).stdout.replace(/\r\n/g, '\n').trimEnd() + '\n',
    'cli-json-keys.json': collectCliKeys(ws),
    'mcp-tools.json': collectMcpTools(),
    'error-codes.json': collectErrorCodes(),
    'pack-files.txt': collectPackFiles().join('\n') + '\n',
    'contracts-sha256.json': collectContracts(),
    'exit-codes.json': collectExitCodes(ws)
  };
  fs.rmSync(ws.dir, { recursive: true, force: true });
  return data;
}

function writeBaseline(data) {
  fs.mkdirSync(BASE, { recursive: true });
  for (const [name, value] of Object.entries(data)) {
    const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
    fs.writeFileSync(path.join(BASE, name), body);
  }
  const approved = path.join(BASE, 'approved-additions.json');
  if (!fs.existsSync(approved)) {
    fs.writeFileSync(approved, JSON.stringify({
      note: 'M3 期间允许的对外增项。每加一条必须写清批次与理由；只允许新增，不允许修改或删除既有项。',
      errorCodes: [],
      packFiles: [],
      contractChanges: []
    }, null, 2) + '\n');
  }
}

function readBaseline(name) {
  const p = path.join(BASE, name);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  return name.endsWith('.json') ? JSON.parse(text) : text;
}

function diffContracts(base, cur, approved) {
  // 契约哈希默认不允许漂移。允许**显式登记**的变更：approved.contractChanges 里
  // 每条 {file, sha256, reason, batch}，sha256 必须是变更后的值。
  // 这样「改了契约」会留下审阅痕迹，而不是靠重新采集基线把差异抹掉。
  const problems = [];
  const ok = new Map((approved || []).map((e) => [e.file, e.sha256]));
  const stale = (approved || []).filter((e) => cur[e.file] !== e.sha256);
  for (const e of stale) {
    problems.push(`契约变更登记已过期（当前哈希不匹配）-> ${e.file}`);
  }
  const names = new Set([...Object.keys(base || {}), ...Object.keys(cur || {})]);
  for (const f of [...names].sort()) {
    const b = (base || {})[f];
    const c = (cur || {})[f];
    if (b === c) continue;
    if (!b) { problems.push(`契约新增未登记 -> ${f}`); continue; }
    if (!c) { problems.push(`契约被删除 -> ${f}`); continue; }
    if (ok.get(f) === c) continue;
    problems.push(`契约内容变化但未登记批准 -> ${f}（base=${String(b).slice(0, 8)} cur=${String(c).slice(0, 8)}）`);
  }
  return problems;
}

function diffSets(label, base, cur, approved) {
  const problems = [];
  const missing = base.filter((x) => !cur.includes(x));
  const added = cur.filter((x) => !base.includes(x));
  for (const m of missing) problems.push(`${label}: 基线有、现在缺失 -> ${m}`);
  for (const a of added) {
    if (!approved.includes(a)) problems.push(`${label}: 出现未登记的新增 -> ${a}`);
  }
  const stale = approved.filter((a) => !cur.includes(a));
  for (const s of stale) problems.push(`${label}: approved-additions 里的项已不存在 -> ${s}`);
  return problems;
}

function check() {
  const approved = readBaseline('approved-additions.json') || { errorCodes: [], packFiles: [] };
  const cur = collectAll();
  const problems = [];
  const notes = [];

  // 1. 文本严格相等
  const helpBase = readBaseline('cli-help.txt');
  if (helpBase === null) problems.push('缺少基线 cli-help.txt');
  else if (helpBase !== cur['cli-help.txt']) problems.push('cli-help.txt 与基线不一致（子命令或 flag 拼写发生变化）');

  // 2/6/7. JSON 严格相等（契约单独处理：允许经登记的变更，见 diffContracts）
  for (const name of ['cli-json-keys.json', 'exit-codes.json', 'mcp-tools.json']) {
    const base = readBaseline(name);
    if (base === null) {
      problems.push('缺少基线 ' + name);
      continue;
    }
    const a = JSON.stringify(base, null, 2);
    const b = JSON.stringify(cur[name], null, 2);
    if (a !== b) problems.push(name + ' 与基线不一致');
  }

  // 3/5. 集合：只允许登记过的增项
  problems.push(...diffContracts(readBaseline('contracts-sha256.json') || {}, cur['contracts-sha256.json'], approved.contractChanges || []));

  problems.push(...diffSets('error-codes', readBaseline('error-codes.json') || [], cur['error-codes.json'], approved.errorCodes || []));
  const packBase = (readBaseline('pack-files.txt') || '').split('\n').filter(Boolean);
  const packCur = cur['pack-files.txt'].split('\n').filter(Boolean);
  problems.push(...diffSets('pack-files', packBase, packCur, approved.packFiles || []));

  notes.push(`当前发行包 ${packCur.length} 个文件 / 基线 ${packBase.length} 个`);
  notes.push(`当前错误码 ${cur['error-codes.json'].length} 个 / 基线 ${(readBaseline('error-codes.json') || []).length} 个`);

  for (const n of notes) console.log('  · ' + n);
  if (problems.length) {
    console.log(`BASELINE FAIL  drift=${problems.length}`);
    for (const p of problems) console.log('  - ' + p);
    return 1;
  }
  console.log('BASELINE PASS  7 个面均与基线一致（含已登记增项）');
  return 0;
}

function main(argv) {
  if (argv.includes('--check')) return check();
  const data = collectAll();
  writeBaseline(data);
  console.log('BASELINE 已写入 ' + path.relative(ROOT, BASE));
  for (const [name, value] of Object.entries(data)) {
    const size = typeof value === 'string' ? value.length : JSON.stringify(value).length;
    console.log(`  · ${name}  ${size} 字符`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
