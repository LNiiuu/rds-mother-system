'use strict';
// Shared fixtures for the Phase 1 independent acceptance suite (R3).
// Only test-owned files are written; every database lives in a fresh temp dir.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256 } = require('../../src/util');
const { openDb } = require('../../src/db');
const { loadPrincipals, loadRouting } = require('../../src/authz');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTING_PATH = path.join(ROOT, 'config', 'role-routing.json');

const TOKENS = {
  R0: 'tok-R0-0123456789abcdef',
  R1: 'tok-R1-0123456789abcdef',
  R2: 'tok-R2-0123456789abcdef',
  R3: 'tok-R3-0123456789abcdef',
  R4: 'tok-R4-0123456789abcdef',
  R5: 'tok-R5-0123456789abcdef',
  R6: 'tok-R6-0123456789abcdef',
  R7: 'tok-R7-0123456789abcdef'
};

const ROLES = {
  R0: ['R0', 'R4'],
  R1: ['R1'],
  R2: ['R2'],
  R3: ['R3'],
  R4: ['R4'],
  R5: ['R5'],
  R6: ['R6'],
  R7: ['R7']
};

function tmpdir(prefix = 'mars-p1-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function principalsFile(dir, overrides = {}) {
  const list = Object.keys(TOKENS).map(id => ({
    token_sha256: sha256(TOKENS[id]),
    principal_id: 'pid-' + id.toLowerCase(),
    project_ids: overrides[id] && overrides[id].project_ids ? overrides[id].project_ids : ['p1', 'p2'],
    roles: overrides[id] && overrides[id].roles ? overrides[id].roles : ROLES[id],
    note: 'phase1-test fixture'
  }));
  const file = path.join(dir, 'principals.json');
  fs.writeFileSync(file, JSON.stringify({ version: '0.1.0', principals: list }, null, 2), 'utf8');
  return file;
}

function setup(prefix = 'mars-p1-', overrides = {}) {
  const dir = tmpdir(prefix);
  const dbPath = path.join(dir, 'mars.db');
  const principalsPath = principalsFile(dir, overrides);
  const db = openDb(dbPath);
  const principals = loadPrincipals(principalsPath);
  const routing = loadRouting(ROUTING_PATH);
  const principal = id => {
    const auth = principals.principals.find(p => p.principal_id === 'pid-' + id.toLowerCase());
    if (!auth) throw new Error('missing fixture principal ' + id);
    return auth;
  };
  return { dir, db, dbPath, principalsPath, principals, routing, principal, token: id => TOKENS[id] };
}

function propose(env, id, input, options) {
  const store = require('../../src/store');
  return store.propose(env.db, env.principal(id), Object.assign({ project_id: 'p1', role_id: ROLES[id][0] }, input), options);
}

function approve(env, creatorId, memoryId, reviewerId = 'R4', decision = 'approved') {
  const store = require('../../src/store');
  return store.review(env.db, env.principal(reviewerId), ROLES[reviewerId][0], 'p1', memoryId, decision, 'phase1 test review');
}

function auditRows(env) {
  return env.db.prepare('SELECT * FROM audit').all();
}

module.exports = { ROOT, ROUTING_PATH, TOKENS, ROLES, tmpdir, principalsFile, setup, propose, approve, auditRows };
