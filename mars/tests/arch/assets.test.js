'use strict';
// M3 / B1：AssetResolver 端口与适配器。
//
// 这一组用例存在的理由：B1 之前契约在 require 阶段被读取，缺文件时抛的是原生 ENOENT，
// 无法被错误码识别。这里把「缺资产必须是 ASSET_MISSING」变成可回归的断言。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFsAssetResolver } = require('../../src/adapters/fs-asset-resolver');
const { createRuntime } = require('../../src/composition');
const { KNOWN_CONTRACTS, CONTRACT_FILES } = require('../../src/ports/asset-resolver');
const { testAssets, memoryAssets } = require('../helpers/assets');
const { openDb } = require('../../src/db');
const store = require('../../src/store');

test('B1 端口契约：方法数 <= 5 且已知契约齐全', () => {
  const { METHODS } = require('../../src/ports/asset-resolver');
  assert.ok(METHODS.length <= 5, '端口方法数必须 <= 5');
  assert.deepEqual(METHODS.slice().sort(), ['config', 'contract', 'rootPath']);
  assert.equal(KNOWN_CONTRACTS.length, 5);
  for (const name of KNOWN_CONTRACTS) {
    assert.match(CONTRACT_FILES[name], /\.schema\.json$/);
  }
});

test('B1 真实契约可解析，返回冻结对象与内容哈希', () => {
  const assets = testAssets();
  const rec = assets.contract('memory');
  assert.equal(rec.source, 'file');
  assert.match(rec.hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(rec.value), true);
  assert.equal(rec.value.title, 'MARS Memory Record (v0)');
  // 同一实例第二次取应命中缓存，返回同一对象
  assert.equal(assets.contract('memory').value, rec.value);
});

test('B1 缺契约抛 ASSET_MISSING，而不是 ENOENT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-assets-'));
  try {
    const assets = createFsAssetResolver({ root: dir });
    try {
      assets.contract('memory');
      assert.fail('应当抛出 ASSET_MISSING');
    } catch (err) {
      assert.equal(err.code, 'ASSET_MISSING');
      // 允许在 detail 里保留底层 errno（便于诊断），但错误本身必须是带码的 AppError，
      // 而不是一个裸的 fs 异常。
      assert.equal(err.name, 'AppError');
      assert.match(err.message, /^ASSET_MISSING /);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.throws(() => memoryAssets({}).contract('memory'), (err) => err.code === 'ASSET_MISSING');
  assert.throws(() => createFsAssetResolver({ root: '' }), (err) => err.code === 'ASSET_MISSING');
});

test('B1 未知契约名与未配置的配置项都给出 ASSET_MISSING', () => {
  const assets = testAssets();
  assert.throws(() => assets.contract('no-such-contract'), (err) => err.code === 'ASSET_MISSING');
  assert.throws(() => assets.config('role-routing'), (err) => err.code === 'ASSET_MISSING');
});

test('B1 非法 JSON 抛 ASSET_INVALID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-assets-bad-'));
  try {
    fs.mkdirSync(path.join(dir, 'mars', 'contracts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mars', 'contracts', 'memory.schema.json'), '{ not json', 'utf8');
    const assets = createFsAssetResolver({ root: dir });
    assert.throws(() => assets.contract('memory'), (err) => err.code === 'ASSET_INVALID');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B1 组合根在启动时即解析全部契约（fail-fast）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-composition-'));
  try {
    assert.throws(() => createRuntime({ root: dir }), (err) => err.code === 'ASSET_MISSING');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // 正常根应成功且返回安装根
  const runtime = createRuntime({});
  assert.equal(runtime.root, path.resolve(__dirname, '..', '..', '..'));
  assert.equal(typeof runtime.assets.contract, 'function');
});

test('B1 域模块缺 assets 注入时报 ASSET_MISSING，而不是静默通过', () => {
  const db = openDb(':memory:');
  try {
    const principal = { principal_id: 'p1-r2', project_ids: ['p1'], roles: ['R2'] };
    // 只给 routing、不给 assets：应当停在 ASSET_MISSING（而不是静默用仓库里的契约兜底）
    const routingConfig = require('../../src/authz').loadRouting(path.join(__dirname, '..', '..', 'config', 'role-routing.json'));
    assert.throws(
      () => store.propose(db, principal, {
        project_id: 'p1', role_id: 'R2', memory_type: 'L2',
        content: 'no assets injected', source_ref: 'docs/a.md', source_version: 'v1'
      }, { routing: routingConfig }),
      (err) => err.code === 'ASSET_MISSING'
    );
    // 注入后应成功
    const ok = store.propose(db, principal, {
      project_id: 'p1', role_id: 'R2', memory_type: 'L2',
      content: 'with assets injected', source_ref: 'docs/a.md', source_version: 'v1'
    }, { assets: testAssets(), routing: routingConfig });
    assert.equal(ok.status, 'proposed');
  } finally {
    db.close();
  }
});
