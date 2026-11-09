'use strict';
// 脚本可解析性守卫（M4 / B2）。
//
// 起因：`mars/scripts/seed-phase2.js` 在仓库里长期处于**语法损坏**状态
// （中文曾被按 GBK 解码，含不可逆的 `?`），`node --check` 直接失败，
// 但它照样被提交、被引用、被当成"还能用的脚本"。没有任何门禁发现这件事。
//
// 本文件把"入库的脚本至少能被解析"变成机械检查：
//   - `.js`  用 vm.Script 解析（不执行，避免副作用）；
//   - `.mjs` 用 `node --check`（vm.Script 不认 ESM）。
//
// 只做语法层面的守卫。行为正确性由各自的测试负责 —— 这里不假装验证语义。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCAN_DIRS = ['mars/scripts', 'bin', 'tooling'];
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(relDir, acc = []) {
  const abs = path.join(REPO, relDir);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) walk(rel, acc);
    else if (/\.(js|mjs)$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(d)).sort();

test('B2 扫描范围内的脚本数量符合预期（防止目录改名后静默扫空）', () => {
  assert.ok(FILES.length >= 15, `只扫到 ${FILES.length} 个脚本，检查 SCAN_DIRS 是否失效`);
  assert.ok(FILES.some((f) => f.startsWith('mars/scripts/')), 'mars/scripts 下应有脚本');
  assert.ok(FILES.some((f) => f.startsWith('bin/')), 'bin 下应有脚本');
  assert.ok(FILES.some((f) => f.startsWith('tooling/')), 'tooling 下应有脚本');
});

test('B2 所有 .js 脚本均可解析（vm.Script，不执行）', () => {
  const broken = [];
  for (const rel of FILES.filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    try {
      new vm.Script(src, { filename: rel });
    } catch (err) {
      broken.push(rel + ': ' + err.message);
    }
  }
  assert.deepEqual(broken, [], '存在无法解析的脚本:\n' + broken.join('\n'));
});

test('B2 所有 .mjs 脚本均可通过 node --check', () => {
  const broken = [];
  for (const rel of FILES.filter((f) => f.endsWith('.mjs'))) {
    const r = spawnSync(process.execPath, ['--check', path.join(REPO, rel)], { encoding: 'utf8' });
    if (r.status !== 0) broken.push(rel + ': ' + String(r.stderr).split('\n')[0]);
  }
  assert.deepEqual(broken, [], '存在无法解析的 ESM 脚本:\n' + broken.join('\n'));
});

test('B2 回归守卫：损坏的 seed-phase2.js 已删除且未被重新引入', () => {
  assert.equal(fs.existsSync(path.join(REPO, 'mars', 'scripts', 'seed-phase2.js')), false,
    'seed-phase2.js 已按 B2 决策删除；如需种子能力请用 rds init-dev / put / review');
  // 同一目录下不允许再出现"入库即坏"的脚本
  assert.equal(FILES.filter((f) => f.includes('seed-phase2')).length, 0);
});

// --- 行为测试：身份签发脚本的参数与数据安全 -------------------------------
// 这些不是"语法"检查，而是 B2 修掉的三类真实故障的回归测试。

const os = require('node:os');

const IDENTITY_SCRIPT = path.join(REPO, 'mars', 'scripts', 'mars-issue-mcp-identity.js');

function runIdentity(args, opts = {}) {
  return spawnSync(process.execPath, [IDENTITY_SCRIPT, ...args], { encoding: 'utf8', ...opts });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-scripts-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('B2 身份脚本：拼错的 flag 必须报错（此前会静默生成身份）', () => {
  withTempDir((dir) => {
    const r = runIdentity(['--rol', 'R0', '--principals', path.join(dir, 'p.json'), '--token-dir', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag: --rol/);
    assert.equal(fs.existsSync(path.join(dir, 'p.json')), false, '失败时不应落盘');
  });
});

test('B2 身份脚本：未知角色必须拒绝（角色取自 role-routing.json）', () => {
  withTempDir((dir) => {
    const r = runIdentity(['--role', 'R9', '--principals', path.join(dir, 'p.json'), '--token-dir', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /未知角色 R9/);
  });
});

test('B2 身份脚本：principals.json 损坏时拒绝覆盖，且文件字节不变', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'p.json');
    const original = '{"principals": [ broken';
    fs.writeFileSync(file, original);
    const r = runIdentity(['--role', 'R1', '--principals', file, '--token-dir', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /拒绝覆盖/);
    assert.equal(fs.readFileSync(file, 'utf8'), original, '失败时不得改写 principals.json');
  });
});

test('B2 身份脚本：--help 输出用法且退出 0', () => {
  const r = runIdentity(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: node mars-issue-mcp-identity\.js/);
});
