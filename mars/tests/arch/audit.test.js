'use strict';
// M3 / B4：AuditSink 端口与三个实现。
//
// 守的是三条不变式：
//   1. 审计出口可替换（不再等同于「必须写库」）；
//   2. 审计永不阻断业务（sink 抛异常时调用仍然成功）；
//   3. 生产路径（组合根打开的连接）默认绑定 DbAuditSink。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, attachAuditSink, audit } = require('../../src/db');
const { createDbAuditSink } = require('../../src/adapters/db-audit-sink');
const { createNullAuditSink } = require('../../src/adapters/null-audit-sink');
const { createRuntime } = require('../../src/composition');
const { METHODS, EVENT_FIELDS } = require('../../src/ports/audit-sink');
const { testAssets } = require('../helpers/assets');
const { loadRouting } = require('../../src/authz');
const store = require('../../src/store');

const ROUTING = loadRouting(path.join(__dirname, '..', '..', 'config', 'role-routing.json'));

function memorySink() {
  const rows = [];
  return { rows, record(event) { rows.push(event); } };
}

test('B4 端口契约：单一方法，事件字段固定', () => {
  assert.deepEqual(METHODS, ['record']);
  assert.deepEqual(EVENT_FIELDS, ['principal_id', 'project_id', 'role_id', 'action', 'target', 'result', 'reason']);
});

test('B4 替换 sink 后业务写入不再落库，但事件被完整捕获', () => {
  const db = openDb(':memory:');
  try {
    const sink = memorySink();
    attachAuditSink(db, sink);
    const principal = { principal_id: 'p-r2', project_ids: ['p1'], roles: ['R2'] };
    const created = store.propose(db, principal, {
      project_id: 'p1', role_id: 'R2', memory_type: 'L2',
      content: 'audit goes to sink', source_ref: 'docs/a.md', source_version: 'v1'
    }, { routing: ROUTING, assets: testAssets() });
    assert.equal(created.status, 'proposed');

    const dbRows = db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
    assert.equal(dbRows, 0, '绑定 sink 后不应直接写 audit 表');
    assert.equal(sink.rows.length >= 1, true);
    const last = sink.rows[sink.rows.length - 1];
    assert.equal(last.principal_id, 'p-r2');
    assert.equal(last.action, 'memory.propose');
    assert.equal(last.result, 'created');
  } finally {
    db.close();
  }
});

test('B4 Null sink 丢弃事件且不报错', () => {
  const db = openDb(':memory:');
  try {
    attachAuditSink(db, createNullAuditSink());
    audit(db, { principal_id: 'x', project_id: 'p1', action: 'memory.get', result: 'ok' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 0);
  } finally {
    db.close();
  }
});

test('B4 sink 抛异常不影响业务调用（审计永不阻断）', () => {
  const db = openDb(':memory:');
  try {
    attachAuditSink(db, { record() { throw new Error('sink boom'); } });
    const principal = { principal_id: 'p-r2', project_ids: ['p1'], roles: ['R2'] };
    const created = store.propose(db, principal, {
      project_id: 'p1', role_id: 'R2', memory_type: 'L2',
      content: 'sink failure must not block', source_ref: 'docs/b.md', source_version: 'v1'
    }, { routing: ROUTING, assets: testAssets() });
    assert.equal(created.status, 'proposed');
  } finally {
    db.close();
  }
});

test('B4 DbAuditSink 正常落库，且 attachAuditSink 拒绝非法 sink', () => {
  const db = openDb(':memory:');
  try {
    attachAuditSink(db, createDbAuditSink(db));
    audit(db, {
      principal_id: 'p-r0', project_id: 'p1', role_id: 'R0',
      action: 'memory.stats', target: 'cli', result: 'ok', reason: 'test'
    });
    const row = db.prepare('SELECT * FROM audit').get();
    assert.equal(row.principal_id, 'p-r0');
    assert.equal(row.action, 'memory.stats');
    assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.keys(row).includes('reason'), true);

    assert.throws(() => attachAuditSink(db, { notRecord: true }), /attachAuditSink/);
    assert.throws(() => createDbAuditSink(null), /已打开的数据库句柄/);
  } finally {
    db.close();
  }
});

test('B4 组合根打开的生产连接默认已绑定 DbAuditSink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-audit-'));
  try {
    const runtime = createRuntime({});
    const db = runtime.openDb(path.join(dir, 'mars.db'));
    try {
      audit(db, { principal_id: 'p-local', project_id: 'p1', action: 'memory.list', result: 'ok' });
      const row = db.prepare('SELECT principal_id FROM audit').get();
      assert.equal(row.principal_id, 'p-local');
      assert.equal(typeof runtime.auditSinkFactory, 'function');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
