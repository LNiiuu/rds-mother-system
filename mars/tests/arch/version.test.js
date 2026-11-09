'use strict';
// 版本一致性测试（M4 / B4）。
//
// 背景：基线里存在三个互不相干的"版本号"：
//   VERSION / package.json = 0.1.0
//   mcp-stdio.js 的 SERVER_VERSION = '0.2.0'（硬编码）
//   ledger.schema.json 的 version = 0.1.0（数据格式版本，另一维度）
// 前两者长期不一致且没有文档说明谁是谁。本文件把 docs/versioning.md 的规则变成断言。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const pkg = require('../../../package.json');
const { PRODUCT_VERSION } = require('../../src/version');

test('B4 VERSION 文件与 package.json 版本一致（doctor 的口径）', () => {
  const vfile = fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim();
  assert.equal(vfile, pkg.version);
});

test('B4 产品版本读取点唯一：version.js 直接来自 package.json', () => {
  assert.equal(PRODUCT_VERSION, pkg.version);
  // 守卫：不允许再出现第二个硬编码的 serverInfo 版本
  const src = fs.readFileSync(path.join(REPO, 'mars', 'src', 'mcp-stdio.js'), 'utf8');
  assert.equal(/SERVER_VERSION\s*=\s*['"]\d/.test(src), false, 'serverInfo 版本不得硬编码');
  assert.match(src, /require\('\.\/version'\)/);
});

test('B4 MCP initialize 的 serverInfo.version 等于产品版本（端到端握手）', () => {
  const script = path.join(REPO, 'mars', 'src', 'mcp-stdio.js');
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'version-test', version: '0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ''
  ].join('\n');

  // 自建临时身份与库：绝不依赖仓库内的 mars/config/principals.json
  // （那是本机运行产物，干净检出里不存在 —— 早期版本因此在本机绿、在克隆里红）。
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-version-'));
  const principals = path.join(dir, 'principals.json');
  fs.writeFileSync(principals, JSON.stringify({ version: '0.1.0', principals: [] }));
  const env = Object.assign({}, process.env, {
    MARS_PRINCIPALS: principals,
    MARS_DB: path.join(dir, 'mars.db'),
    MARS_ROUTING: path.join(REPO, 'mars', 'config', 'role-routing.json')
  });
  delete env.MARS_TOKEN;
  delete env.MARS_TOKEN_FILE;

  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 30000, env });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const first = r.stdout.split('\n').filter(Boolean)[0];
  const msg = JSON.parse(first);
  assert.equal(msg.result.serverInfo.version, PRODUCT_VERSION);
  assert.equal(msg.result.protocolVersion, '2024-11-05');
});

test('B4 engines.node 不低于 22.15（zstd 的实际门槛），且 doctor 口径一致', () => {
  const floor = String(pkg.engines && pkg.engines.node || '');
  assert.match(floor, /^>=22\.(\d+)\.\d+$/);
  const minor = Number(floor.match(/^>=22\.(\d+)/)[1]);
  assert.ok(minor >= 15, `engines 声明 ${floor} 低于 zstd 实际要求 22.15`);
  assert.equal(/^>=22\.5\.0$/.test(floor), false, '不允许回退到 22.5.0（zstd 在 22.15 才有）');

  const doctor = fs.readFileSync(path.join(REPO, 'bin', 'doctor.mjs'), 'utf8');
  assert.match(doctor, /min >= 15/, 'doctor 的 Node 门槛应同步到 22.15');
});
