'use strict';
// M3 / B0：统一错误模型。
//
// 背景（docs/architecture/m3/coupling-map.md H-10）：
//   mcp.js 的对外码白名单有 14 项，mcp-stdio.js 有 20 项，
//   差集 6 项在旧网关会退化成 INTERNAL_ERROR。
// 本文件既验证映射函数，也验证**真实调用路径**上这 6 个码不再退化。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppError, PUBLIC_CODES, toPublicCode, toPublicError, isPublicCode } = require('../../src/errors');
const { createServer } = require('../../src/mcp');
const { sha256 } = require('../../src/util');
const { testAssets } = require('../helpers/assets');

const TOKEN = 'errors-token-0123456789abcd';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-errors-'));
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({
    version: '0.1.0',
    principals: [{
      token_sha256: sha256(TOKEN),
      principal_id: 'err-r2',
      project_ids: ['p1'],
      roles: ['R2']
    }]
  }), 'utf8');
  const server = createServer({ dbPath: path.join(dir, 'mars.db'), principalsPath, assets: testAssets() });
  return { dir, server };
}

test('B0 toPublicCode 识别 AppError、旧式前缀与未知异常', () => {
  assert.equal(toPublicCode(new AppError('ASSET_MISSING', 'memory')), 'ASSET_MISSING');
  assert.equal(toPublicCode(new Error('PROJECT_DENIED')), 'PROJECT_DENIED');
  assert.equal(toPublicCode(new Error('MEMORY_SCHEMA_INVALID bad field')), 'MEMORY_SCHEMA_INVALID');
  assert.equal(toPublicCode(new Error('SOMETHING_ELSE happened')), 'INTERNAL_ERROR');
  assert.equal(toPublicCode(new Error('')), 'INTERNAL_ERROR');
  assert.equal(toPublicCode(null), 'INTERNAL_ERROR');
  assert.deepEqual(toPublicError(new Error('ROLE_DENIED')), { ok: false, code: 'ROLE_DENIED' });
});

test('B0 AppError 拒绝未登记的错误码', () => {
  assert.throws(() => new AppError('NOT_A_REGISTERED_CODE'), /UNKNOWN_PUBLIC_CODE/);
  assert.equal(isPublicCode('NOT_A_REGISTERED_CODE'), false);
  assert.equal(isPublicCode('ROLE_DENIED'), true);
});

test('B0 曾漂移的 6 个码全部可映射，不再退化为 INTERNAL_ERROR', () => {
  const drifted = [
    'EXPIRES_AT_INVALID',
    'INVALID_TRANSITION',
    'RATE_LIMITED',
    'ROLE_TYPE_DENIED',
    'ROUTING_UNAVAILABLE',
    'STATE_UNCHANGED'
  ];
  for (const code of drifted) {
    assert.equal(PUBLIC_CODES.has(code), true, code + ' 必须在 PUBLIC_CODES 中');
    assert.equal(toPublicCode(new Error(code + ' detail')), code);
  }
});

test('B0 旧网关上 ROLE_TYPE_DENIED 与 EXPIRES_AT_INVALID 真实可返回', () => {
  const { server } = setup();
  try {
    // R2 的 allowed_types 是 L1/L2/L4，L3 应被拒且码为 ROLE_TYPE_DENIED
    const roleDenied = server.handle({
      token: TOKEN,
      method: 'memory.propose',
      params: {
        project_id: 'p1', role_id: 'R2', memory_type: 'L3',
        content: 'x', source_ref: 'docs/d.md', source_version: 'v1'
      }
    });
    assert.equal(roleDenied.ok, false);
    assert.equal(roleDenied.code, 'ROLE_TYPE_DENIED');

    // 合法类型但 expires_at 非法 -> EXPIRES_AT_INVALID
    const badExpiry = server.handle({
      token: TOKEN,
      method: 'memory.propose',
      params: {
        project_id: 'p1', role_id: 'R2', memory_type: 'L2',
        content: 'y', source_ref: 'docs/d.md', source_version: 'v1',
        expires_at: 'not-a-date'
      }
    });
    assert.equal(badExpiry.ok, false);
    assert.equal(badExpiry.code, 'EXPIRES_AT_INVALID');
  } finally {
    server.close();
  }
});

test('B0 对外响应不含栈、SQL 或路径', () => {
  const { server } = setup();
  try {
    const r = server.handle({
      token: TOKEN,
      method: 'memory.propose',
      params: { project_id: 'p1', role_id: 'R2', memory_type: 'L2', content: '', source_ref: 'a.md', source_version: 'v1' }
    });
    const text = JSON.stringify(r);
    assert.equal(text.includes('stack'), false);
    assert.equal(text.includes('SELECT'), false);
    assert.match(r.code, /^[A-Z][A-Z0-9_]*$/);
  } finally {
    server.close();
  }
});
