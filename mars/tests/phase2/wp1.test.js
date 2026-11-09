'use strict';
// WP-1 regressions: fail-closed routing (N-03), stats without pagination clamp (N-08),
// expiry governance, persistent rate limiting, revoke command, idempotent migration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256 } = require('../../src/util');
const { openDb, consumeRateLimit, SCHEMA_VERSION } = require('../../src/db');
const store = require('../../src/store');
const { retrieve } = require('../../src/retrieval');
const { loadRouting } = require('../../src/authz');
const { createGateway } = require('../../src/mcp-stdio');
const { testAssets } = require('../helpers/assets');

const ROOT = path.resolve(__dirname, '..', '..');
const assets = testAssets();
const ROUTING = path.join(ROOT, 'config', 'role-routing.json');
// 被测脚本是普通 Node 脚本，用当前 Node 运行即可；不再依赖 DSH.exe。
// 需要指定其他运行时（例如 Electron 内置 Node）时用 RDS_NODE_BIN 覆盖。
const NODE_BIN = process.env.RDS_NODE_BIN || process.execPath;
const TMP = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mars-wp1-'));

function principal(id, roles) { return { principal_id: id, roles, project_ids: ['rds-m1'] }; }

test('N-03: propose is fail-closed without an explicit routing object', () => {
  const db = openDb(':memory:');
  const routing = loadRouting(ROUTING);
  const r2 = principal('mcp-R2', ['R2']);

  // M3 / B2 起更严格：域内不再读 MARS_ROUTING（配置是组合根的启动快照），
  // 因此「没传 routing」一律 ROUTING_UNAVAILABLE，不再依赖进程环境碰巧指向哪里。
  assert.throws(
    () => store.propose(db, r2, { project_id: 'rds-m1', memory_type: 'L2', content: 'x', source_ref: 'docs/a.md', source_version: 'v1' }, { assets }),
    /ROUTING_UNAVAILABLE/
  );

  // 注入 routing 后角色门禁仍然生效：R2 不能提 L3
  assert.throws(
    () => store.propose(db, r2, { project_id: 'rds-m1', memory_type: 'L3', content: 'x', source_ref: 'docs/a.md', source_version: 'v1' }, { routing, assets }),
    /ROLE_TYPE_DENIED/
  );

  // 合法组合应当成功
  const ok = store.propose(db, r2, { project_id: 'rds-m1', memory_type: 'L2', content: 'y', source_ref: 'docs/a.md', source_version: 'v1' }, { routing, assets });
  assert.equal(ok.status, 'proposed');
});

test('N-08: stats counts all visible rows without the list pagination clamp', () => {
  const dir = TMP();
  const dbPath = path.join(dir, 'mars.db');
  const db = openDb(dbPath);
  const r0 = principal('mcp-R0', ['R0']);
  const routing = loadRouting(ROUTING);
  for (let i = 0; i < 205; i += 1) {
    store.propose(db, r0, { project_id: 'rds-m1', memory_type: 'L2', content: 'bulk-' + i, source_ref: 'docs/bulk.md', source_version: 'v1' }, { routing, assets });
  }
  const token = 'wp1-token-0123456789abcdef';
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({ principals: [{ principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'], token_sha256: sha256(token) }] }));
  const gw = createGateway({ dbPath, principalsPath, routingPath: ROUTING, token, role: 'R0', assets });
  try {
    const res = gw.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } });
    const data = JSON.parse(res.result.content[0].text).data;
    assert.equal(data.memories, 205);
    assert.equal(data.proposed, 205);
    assert.equal(data.scope, 'visible_to_caller');
  } finally { gw.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold WAL briefly */ } }
});

test('expired memories leave compiled context but remain readable by approvers', () => {
  const db = openDb(':memory:');
  const routing = loadRouting(ROUTING);
  const r3 = principal('mcp-R3', ['R3']);
  const r0 = principal('mcp-R0', ['R0']);
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  const p = store.propose(db, r3, {
    project_id: 'rds-m1', memory_type: 'L2', content: 'short-lived fact', source_ref: 'docs/t.md', source_version: 'v1', expires_at: past
  }, { routing, assets });
  store.review(db, r0, 'R0', 'rds-m1', p.memory_id, 'approved');
  const found = retrieve(db, r0, 'R0', routing, { project_id: 'rds-m1', query: 'short-lived' });
  assert.equal(found.some((r) => r.memory_id === p.memory_id), false);
  assert.equal(store.get(db, r0, 'R0', 'rds-m1', p.memory_id).memory_id, p.memory_id);
});

test('rate limit is persisted per principal across windows', () => {
  const db = openDb(':memory:');
  const a = consumeRateLimit(db, 'mcp-R0', 2, 60000);
  const b = consumeRateLimit(db, 'mcp-R0', 2, 60000);
  const c = consumeRateLimit(db, 'mcp-R0', 2, 60000);
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  assert.equal(c.allowed, false);
  const other = consumeRateLimit(db, 'mcp-R2', 2, 60000);
  assert.equal(other.allowed, true);
});

test('rate limit window reset is atomic across two connections', () => {
  const dir = TMP();
  const dbPath = path.join(dir, 'rl.db');
  const d1 = openDb(dbPath);
  const d2 = openDb(dbPath);
  // First call opens the window on connection 1.
  assert.equal(consumeRateLimit(d1, 'mcp-R3', 1, 60000).allowed, true);
  // The second connection must see the same window and be rejected, not start a new one.
  const second = consumeRateLimit(d2, 'mcp-R3', 1, 60000);
  assert.equal(second.allowed, false);
  assert.equal(second.count, 2);
  const row = d2.prepare('SELECT window_start, count FROM rate_limits WHERE principal_id = ?').get('mcp-R3');
  assert.equal(Number(row.count), 2);
  assert.ok(Number(row.window_start) > 0);
  d1.close();
  d2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration is idempotent and revoke removes principal plus token file', () => {
  const dir = TMP();
  const dbPath = path.join(dir, 'm.db');
  const d1 = openDb(dbPath); d1.close();
  const d2 = openDb(dbPath);
  const version = d2.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value;
  const cols = d2.prepare("PRAGMA table_info('memories')").all().map((c) => c.name);
  assert.equal(version, String(SCHEMA_VERSION));
  assert.ok(cols.includes('expires_at'));
  d2.close();

  const principals = path.join(dir, 'principals.json');
  const tokenDir = path.join(dir, 'tokens');
  fs.writeFileSync(principals, JSON.stringify({ principals: [{ principal_id: 'mcp-R1', roles: ['R1'], project_ids: ['rds-m1'], token_sha256: sha256('x'.repeat(20)) }] }));
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(path.join(tokenDir, 'R1.token'), 'x'.repeat(44));
  const script = path.join(ROOT, 'scripts', 'mars-issue-mcp-identity.js');
  const r = spawnSync(NODE_BIN, [script, '--role', 'R1', '--revoke', '--principals', principals, '--token-dir', tokenDir], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).revoked, true);
  assert.equal(fs.existsSync(path.join(tokenDir, 'R1.token')), false);
  assert.equal(JSON.parse(fs.readFileSync(principals, 'utf8')).principals.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
