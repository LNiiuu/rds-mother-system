'use strict';
// A8 / A10: offline-only posture and rollback safety (dry-run + temp-repo deletion).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROOT } = require('./helpers');

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function decode(buf) {
  if (!buf) return '';
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch (err) {
    return Buffer.from(buf).toString('utf8');
  }
}

function runScript(args) {
  const run = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'mars-rollback.ps1')].concat(args), {
    encoding: 'buffer', timeout: 60000
  });
  return { status: run.status, stdout: decode(run.stdout), stderr: decode(run.stderr) };
}

test('A10 rollback dry-run reports targets and deletes nothing', () => {
  const before = fs.existsSync('D:\\M1\\mars\\var\\mars.db');
  const run = runScript(['-Repo', 'D:\\M1']);
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /未加 -Yes/);
  assert.equal(fs.existsSync('D:\\M1\\mars\\var\\mars.db'), before);
});

test('A10 rollback removes only var runtime files in a temp repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-p1-rollback-'));
  const repo = path.join(dir, 'repo');
  const varDir = path.join(repo, 'mars', 'var');
  fs.mkdirSync(varDir, { recursive: true });
  fs.writeFileSync(path.join(varDir, 'mars.db'), 'db', 'utf8');
  fs.writeFileSync(path.join(varDir, 'baseline-now.json'), '{}', 'utf8');
  const run = runScript(['-Repo', repo, '-Yes']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /已删除/);
  assert.equal(fs.existsSync(path.join(varDir, 'mars.db')), false);
  assert.equal(fs.existsSync(path.join(varDir, 'baseline-now.json')), false);
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'cli.js')), 'source files must remain untouched');
});

test('A8 source tree has no network clients and no .env reads', () => {
  const dirs = [path.join(ROOT, 'src'), path.join(ROOT, 'scripts'), path.join(ROOT, 'config')];
  const forbidden = [
    /require\(['"](?:node:)?(?:http|https|net|tls|dns|dgram)['"]\)/,
    /\bfetch\s*\(/,
    /new\s+WebSocket\s*\(/,
    /['"]\.env['"]/,
    /process\.env\.DSH_/,
    /C:\\\\Users\\\\[^'"]*\.dsh/
  ];
  const offenders = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;
      if (!/\.(js|ps1|json)$/.test(name)) continue;
      const text = fs.readFileSync(file, 'utf8');
      forbidden.forEach((re, index) => { if (re.test(text)) offenders.push(name + ' matches rule#' + index); });
    }
  }
  assert.deepEqual(offenders, []);
});

test('A8 README documents the offline local deployment boundary', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /MCP/);
  assert.match(readme, /不访问网络|离线|Local/);
  assert.match(readme, /node:sqlite|SQLite/);
});
