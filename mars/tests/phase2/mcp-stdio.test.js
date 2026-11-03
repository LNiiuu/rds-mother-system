'use strict';
// Phase 2 regression tests: MCP stdio boundary validation, role-type enforcement,
// review state transitions, and project-denial error codes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256 } = require('../../src/util');
const { openDb } = require('../../src/db');
const store = require('../../src/store');
const { createGateway, validateToolArgs } = require('../../src/mcp-stdio');
const { loadRouting } = require('../../src/authz');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTING = path.join(ROOT, 'config', 'role-routing.json');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mars-phase2-')); }

test('validateToolArgs rejects unknown fields, bad enums and bad ranges', () => {
  assert.equal(validateToolArgs('memory_list', { project_id: 'p', extra: 1 }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('memory_list', { project_id: 'p', status: 'bogus' }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('memory_list', { project_id: 'p', limit: 9999 }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('memory_propose', { project_id: 'p', memory_type: 'L9', content: 'x', source_ref: 'a' }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('memory_propose', { project_id: 'p', memory_type: 'L2', content: 'x', source_ref: 'a', confidence: 7 }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('context_compile', { project_id: 'p', task: { task_id: 't', evil: 1 } }).code, 'INVALID_ARGUMENT');
  assert.equal(validateToolArgs('memory_get', { project_id: 'p' }).ok, false);
  assert.equal(validateToolArgs('memory_list', { project_id: 'p', status: 'approved' }).ok, true);
});

test('propose enforces role allowed_types (R2 cannot propose L3)', () => {
  const db = openDb(':memory:');
  const routing = loadRouting(ROUTING);
  const r2 = { principal_id: 'mcp-R2', roles: ['R2'], project_ids: ['rds-m1'] };
  assert.throws(
    () => store.propose(db, r2, { project_id: 'rds-m1', memory_type: 'L3', content: 'x', source_ref: 'docs/a.md', source_version: 'v1' }, { routing }),
    /ROLE_TYPE_DENIED/
  );
  const ok = store.propose(db, r2, { project_id: 'rds-m1', memory_type: 'L2', content: 'y', source_ref: 'docs/a.md', source_version: 'v1' }, { routing });
  assert.equal(ok.status, 'proposed');
});

test('review enforces state transitions and audits no-op attempts', () => {
  const db = openDb(':memory:');
  const routing = loadRouting(ROUTING);
  const proposer = { principal_id: 'mcp-R2', roles: ['R2'], project_ids: ['rds-m1'] };
  const approver = { principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'] };
  const a = store.propose(db, proposer, { project_id: 'rds-m1', memory_type: 'L2', content: 'alpha', source_ref: 'docs/a.md', source_version: 'v1' }, { routing });
  const approved = store.review(db, approver, 'R0', 'rds-m1', a.memory_id, 'approved', 'ok');
  assert.equal(approved.status, 'approved');
  assert.throws(() => store.review(db, approver, 'R0', 'rds-m1', a.memory_id, 'approved'), /STATE_UNCHANGED/);
  const sup = store.review(db, approver, 'R0', 'rds-m1', a.memory_id, 'superseded', 'v2');
  assert.equal(sup.status, 'superseded');
  const b = store.propose(db, proposer, { project_id: 'rds-m1', memory_type: 'L2', content: 'beta', source_ref: 'docs/b.md', source_version: 'v1' }, { routing });
  assert.throws(() => store.review(db, approver, 'R0', 'rds-m1', b.memory_id, 'superseded'), /INVALID_TRANSITION/);
  const rejected = store.review(db, approver, 'R0', 'rds-m1', b.memory_id, 'rejected', 'no');
  assert.equal(rejected.status, 'rejected');
});

test('gateway returns PROJECT_DENIED and INVALID_ARGUMENT without store access', () => {
  const dir = tmpDir();
  const token = 'phase2-test-token-0123456789abcdef';
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({
    principals: [{ principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'], token_sha256: sha256(token) }]
  }));
  const gw = createGateway({
    dbPath: path.join(dir, 'mars.db'),
    principalsPath,
    routingPath: ROUTING,
    token,
    role: 'R0'
  });
  try {
    const call = (args) => {
      const res = gw.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_list', arguments: args } });
      return JSON.parse(res.result.content[0].text);
    };
    assert.equal(call({ project_id: 'other-project' }).code, 'PROJECT_DENIED');
    assert.equal(call({ project_id: 'rds-m1', status: 'bogus' }).code, 'INVALID_ARGUMENT');
    assert.equal(call({ project_id: 'rds-m1', bogus: true }).code, 'INVALID_ARGUMENT');
    assert.equal(call({ project_id: 'rds-m1' }).ok, true);
  } finally {
    gw.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gateway startup fails closed when routing config is missing', () => {
  const dir = tmpDir();
  const token = 'phase2-routing-token-0123456789ab';
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({
    principals: [{ principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'], token_sha256: sha256(token) }]
  }));
  try {
    assert.throws(() => createGateway({
      dbPath: path.join(dir, 'mars.db'),
      principalsPath,
      routingPath: path.join(dir, 'missing-routing.json'),
      token,
      role: 'R0'
    }), /ROUTING_UNAVAILABLE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memory_stats only counts memories visible to the caller (F-09)', () => {
  const dir = tmpDir();
  const routing = loadRouting(ROUTING);
  const dbPath = path.join(dir, 'mars.db');
  const db = openDb(dbPath);
  const r0 = { principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'] };
  const r2 = { principal_id: 'mcp-R2', roles: ['R2'], project_ids: ['rds-m1'] };
  const r3 = { principal_id: 'mcp-R3', roles: ['R3'], project_ids: ['rds-m1'] };
  const add = (principal, input) => {
    const m = store.propose(db, principal, Object.assign({ project_id: 'rds-m1', source_ref: 'docs/s.md', source_version: 'v1' }, input), { routing });
    return m;
  };
  const visible = add(r3, { memory_type: 'L2', content: 'visible project fact', visibility: 'project' });
  store.review(db, r0, 'R0', 'rds-m1', visible.memory_id, 'approved', 'ok');
  const roleOnly = add(r3, { memory_type: 'L4', content: 'r3 only knowledge', visibility: 'role', role_scope: ['R3'] });
  store.review(db, r0, 'R0', 'rds-m1', roleOnly.memory_id, 'approved', 'ok');
  add(r3, { memory_type: 'L2', content: 'r3 pending proposal', visibility: 'project' }); // proposed, not R2's
  db.close();

  const token = 'phase2-stats-token-0123456789ab';
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({
    principals: [
      { principal_id: 'mcp-R0', roles: ['R0'], project_ids: ['rds-m1'], token_sha256: sha256('x0') },
      { principal_id: 'mcp-R2', roles: ['R2'], project_ids: ['rds-m1'], token_sha256: sha256(token) }
    ]
  }));
  const gw = createGateway({ dbPath, principalsPath, routingPath: ROUTING, token, role: 'R2' });
  try {
    const res = gw.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } });
    const out = JSON.parse(res.result.content[0].text);
    assert.equal(out.ok, true);
    assert.equal(out.data.scope, 'visible_to_caller');
    assert.equal(out.data.memories, 1);
    assert.equal(out.data.approved, 1);
    assert.equal(out.data.proposed, 0);
  } finally {
    gw.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
