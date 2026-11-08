'use strict';
// A8 / A10: 离线姿态与回滚安全（dry-run + 仅删 mars/var 运行时产物）。
//
// 本文件不依赖 Windows：被验证的实现是 mars/scripts/mars-rollback.js，
// Windows PowerShell 入口 mars-rollback.ps1 只是转调它。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROOT } = require('./helpers');

const SCRIPT = path.join(ROOT, 'scripts', 'mars-rollback.js');

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-rollback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const varDir = path.join(repo, 'mars', 'var');
  fs.mkdirSync(varDir, { recursive: true });
  fs.mkdirSync(path.join(repo, 'mars', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'mars', 'config'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'mars', 'src', 'keep.js'), '// must survive\n', 'utf8');
  fs.writeFileSync(path.join(varDir, 'mars.db'), 'db', 'utf8');
  fs.writeFileSync(path.join(varDir, 'mars.db-wal'), 'wal', 'utf8');
  fs.writeFileSync(path.join(varDir, 'baseline-now.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(varDir, 'ledger.csv'), 'a,b\n', 'utf8');
  fs.writeFileSync(path.join(varDir, 'notes.txt'), 'keep me\n', 'utf8');
  return { repo, varDir };
}

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8', timeout: 60000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('A10 默认 dry-run：列出目标、退出码 2、不删除任何文件', (t) => {
  const { repo, varDir } = tempRepo(t);
  const r = run(['--repo', repo]);

  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /未加 --yes/);
  assert.match(r.stdout, /mars\.db/);
  assert.ok(fs.existsSync(path.join(varDir, 'mars.db')), 'dry-run 不得删除文件');
  assert.ok(fs.existsSync(path.join(varDir, 'ledger.csv')));
});

test('A10 --yes 只删除 var 下的数据库/JSON/CSV，源码与非运行时文件保留', (t) => {
  const { repo, varDir } = tempRepo(t);
  const r = run(['--repo', repo, '--yes']);

  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /已删除 4 个文件/);

  assert.equal(fs.existsSync(path.join(varDir, 'mars.db')), false);
  assert.equal(fs.existsSync(path.join(varDir, 'mars.db-wal')), false);
  assert.equal(fs.existsSync(path.join(varDir, 'baseline-now.json')), false);
  assert.equal(fs.existsSync(path.join(varDir, 'ledger.csv')), false);

  assert.ok(fs.existsSync(path.join(varDir, 'notes.txt')), '非运行时扩展名不得删除');
  assert.ok(fs.existsSync(path.join(repo, 'mars', 'src', 'keep.js')), '源码不得被删除');
});

test('A10 principals 只有在显式 --remove-principals 时才删除', (t) => {
  const { repo } = tempRepo(t);
  const principals = path.join(repo, 'mars', 'config', 'principals.json');
  fs.writeFileSync(principals, '{"principals":[]}', 'utf8');

  const first = run(['--repo', repo, '--yes']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(fs.existsSync(principals), '未加 --remove-principals 时不得删除身份文件');

  fs.writeFileSync(path.join(repo, 'mars', 'var', 'mars.db'), 'db', 'utf8');
  const second = run(['--repo', repo, '--yes', '--remove-principals']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(fs.existsSync(principals), false);
});

test('A10 token 只有在显式 --remove-tokens 时才删除', (t) => {
  const { repo, varDir } = tempRepo(t);
  const tokenDir = path.join(varDir, 'mcp', 'tokens');
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(path.join(tokenDir, 'R1.token'), 'x'.repeat(44), 'utf8');

  const first = run(['--repo', repo, '--yes']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.ok(fs.existsSync(path.join(tokenDir, 'R1.token')), '未加 --remove-tokens 时不得删除 token');

  fs.writeFileSync(path.join(repo, 'mars', 'var', 'mars.db'), 'db', 'utf8');
  const second = run(['--repo', repo, '--yes', '--remove-tokens']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(fs.existsSync(path.join(tokenDir, 'R1.token')), false);
});

test('A10 目标仓库不存在时报错退出 1，不做任何删除', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-rollback-missing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(['--repo', path.join(dir, 'no-such-repo'), '--yes']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /MARS 目录不存在/);
});

test('A10 运行时产物命名规则与实现一致', () => {
  const { isRuntimeArtifact } = require(path.join(ROOT, 'scripts', 'mars-rollback.js'));
  for (const name of ['mars.db', 'mars.db-wal', 'mars.db-shm', 'mars.db.2026-11-01', 'baseline.json', 'ledger.csv']) {
    assert.equal(isRuntimeArtifact(name), true, name + ' 应被识别为运行时产物');
  }
  for (const name of ['notes.txt', 'mars.sqlite', 'README.md', 'mars.dbx']) {
    assert.equal(isRuntimeArtifact(name), false, name + ' 不应被删除');
  }
});

test('A8 源码目录不含网络客户端与 .env 读取', () => {
  const dirs = [path.join(ROOT, 'src'), path.join(ROOT, 'scripts'), path.join(ROOT, 'config')];
  const forbidden = [
    /require\(['"](?:node:)?(?:http|https|net|tls|dns|dgram)['"]\)/,
    /\bfetch\s*\(/,
    /new\s+WebSocket\s*\(/,
    /['"]\.env['"]/,
    /process\.env\.DSH_/
  ];
  const offenders = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;
      if (!/\.(js|mjs|ps1|json)$/.test(name)) continue;
      const text = fs.readFileSync(file, 'utf8');
      forbidden.forEach((re, index) => { if (re.test(text)) offenders.push(name + ' matches rule#' + index); });
    }
  }
  assert.deepEqual(offenders, []);
});

test('A8 README 说明了离线与存储边界', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /MCP/);
  assert.match(readme, /不访问网络|离线|Local/);
  assert.match(readme, /node:sqlite|SQLite/);
});
