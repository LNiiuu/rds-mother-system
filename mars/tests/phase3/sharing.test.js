'use strict';
// P5 (WP-3): cross-project sharing and isolation governance.
// Default deny, explicit approved shares, revocation, expiry, indirect-leak checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../../src/db');
const store = require('../../src/store');
const sharing = require('../../src/sharing');
const { retrieve } = require('../../src/retrieval');
const { loadRouting } = require('../../src/authz');

const path = require('node:path');
const ROUTING = loadRouting(path.join(__dirname, '..', '..', 'config', 'role-routing.json'));
const A = 'proj-a';
const B = 'proj-b';

function principal(id, roles, projects) {
  return { principal_id: id, roles, project_ids: projects };
}

function seed(db) {
  const aR2 = principal('agent-a-R2', ['R2'], [A]);
  const aR0 = principal('agent-a-R0', ['R0'], [A]);
  const aR1 = principal('agent-a-R1', ['R1'], [A]);
  const bR2 = principal('agent-b-R2', ['R2'], [B]);
  const bR0 = principal('agent-b-R0', ['R0'], [B]);
  const projA = sharing.registerProject(db, aR0, 'R0', { project_id: A, display_name: 'Synthetic A' });
  const projB = sharing.registerProject(db, bR0, 'R0', { project_id: B, display_name: 'Synthetic B' });
  const fact = store.propose(db, aR2, { project_id: A, memory_type: 'L2', content: 'alpha fact inside project A', source_ref: 'docs/a.md', source_version: 'v1' }, { routing: ROUTING });
  const decision = store.propose(db, aR1, { project_id: A, memory_type: 'L3', content: 'decision: choose SQLite for A', source_ref: 'docs/a-decision.md', source_version: 'v1' }, { routing: ROUTING });
  store.review(db, aR0, 'R0', A, fact.memory_id, 'approved');
  store.review(db, aR0, 'R0', A, decision.memory_id, 'approved');
  const bFact = store.propose(db, bR2, { project_id: B, memory_type: 'L2', content: 'beta fact inside project B', source_ref: 'docs/b.md', source_version: 'v1' }, { routing: ROUTING });
  store.review(db, bR0, 'R0', B, bFact.memory_id, 'approved');
  return { aR0, aR1, aR2, bR0, bR2, fact, decision, bFact, projA, projB };
}

test('P5 default deny: no share means no cross-project retrieval, stats or FTS leak', () => {
  const db = openDb(':memory:');
  const { bR2, bFact } = seed(db);
  const got = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha', type: 'L2' });
  assert.ok(got.every((r) => r.project_id === B), 'no project A record may be returned without a share');
  // A query narrows via FTS; project B has no "alpha" text, so nothing is returned.
  assert.equal(got.length, 0);
  const all = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, type: 'L2' });
  assert.deepEqual(all.map((r) => r.memory_id), [bFact.memory_id]);
  assert.equal(all[0].source_project, undefined);
  const stats = db.prepare('SELECT COUNT(*) n FROM memories WHERE project_id = ?').get(B).n;
  assert.equal(stats, 1);
  // alias path must not leak across projects
  store.addAlias(db, bR2, 'R2', B, 'alpha', 'leak-word', bFact.memory_id);
  const viaAlias = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, alias: 'alpha' });
  assert.ok(viaAlias.every((r) => r.project_id === B), 'alias path must not return project A records');
});

test('P5 explicit share: proposed -> target approver approves -> visible with provenance', () => {
  const db = openDb(':memory:');
  const { aR0, bR0, bR2, fact } = seed(db);
  const share = sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2', 'R0'], note: 'explicit export for R2'
  });
  assert.equal(share.status, 'proposed');
  assert.throws(() => sharing.approveShare(db, aR0, 'R0', share.share_id), /PROJECT_DENIED/);
  assert.throws(() => sharing.approveShare(db, bR2, 'R2', share.share_id), /SHARE_APPROVE_DENIED/);
  const approved = sharing.approveShare(db, bR0, 'R0', share.share_id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved_by, 'agent-b-R0');
  const got = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha', type: 'L2' }).filter((r) => r.project_id === A);
  assert.equal(got.length, 1);
  assert.equal(got[0].memory_id, fact.memory_id);
  assert.equal(got[0].source_project, A);
  assert.equal(got[0].via, 'share:' + share.share_id);
  // share is scoped to roles: R3 in B must not see it
  const bR3 = principal('agent-b-R3', ['R3'], [B]);
  assert.deepEqual(retrieve(db, bR3, 'R3', ROUTING, { project_id: B, query: 'alpha' }).filter((r) => r.project_id === A), []);
});

test('P5 self-approval and unregistered target are rejected', () => {
  const db = openDb(':memory:');
  const { aR0, aR2, fact } = seed(db);
  assert.throws(() => sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: 'proj-missing', memory_ids: [fact.memory_id], roles: ['R2']
  }), /TARGET_PROJECT_UNKNOWN/);
  const share = sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2']
  });
  // creator cannot approve, and non-approver role cannot approve
  const aR0Again = sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2']
  });
  assert.equal(aR0Again.status, 'proposed');
  assert.equal(share.status, 'proposed');
  assert.throws(() => sharing.approveShare(db, aR2, 'R0', share.share_id), /PROJECT_DENIED/);
});

test('P5 revocation stops subsequent retrieval and is auditable', () => {
  const db = openDb(':memory:');
  const { aR0, bR0, bR2, fact } = seed(db);
  const share = sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2']
  });
  sharing.approveShare(db, bR0, 'R0', share.share_id);
  assert.equal(retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' }).length, 1);
  const revoked = sharing.revokeShare(db, aR0, 'R0', share.share_id, 'scope no longer needed');
  assert.equal(revoked.status, 'revoked');
  assert.deepEqual(retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' }), []);
  const auditRow = db.prepare("SELECT * FROM audit WHERE action = 'share.revoke' ORDER BY audit_id DESC LIMIT 1").get();
  assert.equal(auditRow.result, 'revoked');
  assert.match(auditRow.reason, /no longer needed/);
});

test('P5 expired share is inactive; approved-only and scoped types are enforced', () => {
  const db = openDb(':memory:');
  const { aR0, bR0, bR2, fact, decision } = seed(db);
  const expired = sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2'],
    expires_at: '2020-01-01T00:00:00.000Z'
  });
  sharing.approveShare(db, bR0, 'R0', expired.share_id);
  assert.deepEqual(retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' }), []);
  // L3 decision is not allowed for R2; and its type is not in the share scope
  assert.throws(() => sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [decision.memory_id], roles: ['R2'], memory_types: ['L5']
  }), /SHARE_TYPE_INVALID/);
  assert.throws(() => sharing.createShare(db, aR0, 'R0', {
    source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: []
  }), /SHARE_ROLES_REQUIRED/);
});
