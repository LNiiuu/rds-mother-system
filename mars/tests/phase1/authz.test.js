'use strict';
// A4 / A7: identity, project, role and review authorization.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, TOKENS } = require('./helpers');
const { authenticate, authorize } = require('../../src/authz');
const store = require('../../src/store');
const { retrieve } = require('../../src/retrieval');

function build(env, id, input) {
  return store.propose(env.db, env.principal(id), Object.assign({
    project_id: 'p1', role_id: env.principal(id).roles[0],
    source_ref: 'docs/phase1-authz.md', source_version: 'v1'
  }, input), { allowedRoots: [env.dir] });
}

test('A4 unknown and short tokens are denied without detail', () => {
  const env = setup('mars-p1-authz-');
  const unknown = authenticate(env.principals, 'tok-unknown-0123456789abcdef');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'UNKNOWN_PRINCIPAL');
  assert.equal(authenticate(env.principals, 'short').reason, 'TOKEN_MISSING_OR_TOO_SHORT');
  assert.equal(authenticate(env.principals, '').reason, 'TOKEN_MISSING_OR_TOO_SHORT');
  assert.equal(authenticate(env.principals, TOKENS.R0).principal.principal_id, 'pid-r0');
});

test('A4 cross-project reads are denied', () => {
  const env = setup('mars-p1-authz-', { R2: { project_ids: ['p1'] } });
  const r0 = env.principal('R0');
  const created = store.propose(env.db, r0, {
    project_id: 'p2', role_id: 'R0', content: 'p2 secret', source_ref: 'docs/p2.md', source_version: 'v1'
  }, { allowedRoots: [env.dir] });
  const r2 = env.principal('R2');
  assert.throws(() => store.get(env.db, r2, 'R2', 'p2', created.memory_id), /PROJECT_DENIED/);
  const check = authorize(r2, { project_id: 'p2', role_id: 'R2', action: 'memory.get', routing: env.routing });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'PROJECT_DENIED');
});

test('A4 role mismatch and non-approver review are denied', () => {
  const env = setup('mars-p1-authz-');
  const r2 = env.principal('R2');
  const roleCheck = authorize(r2, { project_id: 'p1', role_id: 'R3', action: 'memory.list', routing: env.routing });
  assert.equal(roleCheck.ok, false);
  assert.equal(roleCheck.reason, 'ROLE_DENIED');
  const reviewCheck = authorize(r2, { project_id: 'p1', role_id: 'R2', action: 'memory.review', routing: env.routing });
  assert.equal(reviewCheck.ok, false);
  assert.equal(reviewCheck.reason, 'REVIEW_DENIED');
  const created = build(env, 'R2', { content: 'review denial fixture', memory_type: 'L2' });
  assert.throws(() => store.review(env.db, r2, 'R2', 'p1', created.memory_id, 'approved', 'x'), /REVIEW_DENIED/);
});

test('A4 self review is denied and R4 can approve', () => {
  const env = setup('mars-p1-authz-');
  const created = build(env, 'R0', { content: 'self review fixture', memory_type: 'L3' });
  const r0 = env.principal('R0');
  assert.throws(() => store.review(env.db, r0, 'R0', 'p1', created.memory_id, 'approved', 'self'), /SELF_REVIEW_DENIED/);
  const approved = store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'independent');
  assert.equal(approved.status, 'approved');
  assert.equal(approved.provenance.approved_by, 'pid-r4');
});

test('A7 R5 cannot retrieve L3 while R3 can', () => {
  const env = setup('mars-p1-authz-');
  const created = build(env, 'R3', { content: 'L3 decision visible only to L3 roles', memory_type: 'L3' });
  const r3 = env.principal('R3');
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  const r5Rows = retrieve(env.db, env.principal('R5'), 'R5', env.routing, { project_id: 'p1', type: 'L3' });
  assert.equal(r5Rows.length, 0);
  const r3Rows = retrieve(env.db, r3, 'R3', env.routing, { project_id: 'p1', type: 'L3' });
  assert.ok(r3Rows.some(row => row.memory_id === created.memory_id));
});
