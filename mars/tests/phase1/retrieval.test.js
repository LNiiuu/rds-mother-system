'use strict';
// Retrieval: FTS5, CJK LIKE fallback, aliases, structured filters and role scoping.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const store = require('../../src/store');
const { retrieve } = require('../../src/retrieval');

function make(env, id, content, type = 'L2', extra = {}) {
  const created = store.propose(env.db, env.principal(id), Object.assign({
    project_id: 'p1', role_id: env.principal(id).roles[0], content, memory_type: type,
    source_ref: 'docs/phase1-retrieval.md', source_version: 'v1'
  }, extra), { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  return created.memory_id;
}

test('FTS5 finds ASCII terms', () => {
  const env = setup('mars-p1-ret-');
  const id = make(env, 'R3', 'SQLite FTS5 memory store for MARS');
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', query: 'SQLite' });
  assert.ok(rows.some(row => row.memory_id === id && row.via === 'fts'));
});

test('CJK query falls back to LIKE', () => {
  const env = setup('mars-p1-ret-');
  const id = make(env, 'R3', '星日晓项目记忆编译测试');
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', query: '记忆' });
  assert.ok(rows.some(row => row.memory_id === id && row.via === 'like'));
});

test('term aliases resolve to the aliased memory', () => {
  const env = setup('mars-p1-ret-');
  const id = make(env, 'R3', '别名指向的记忆', 'L2');
  store.addAlias(env.db, env.principal('R3'), 'R3', 'p1', 'MARS', '记忆系统', id);
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', alias: '记忆系统' });
  assert.ok(rows.some(row => row.memory_id === id));
});

test('structured type filter returns only approved rows of that type', () => {
  const env = setup('mars-p1-ret-');
  make(env, 'R3', 'L2 fact for structured filter', 'L2');
  make(env, 'R3', 'L4 knowledge for structured filter', 'L4');
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', type: 'L2' });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(row => row.memory_type === 'L2' && row.status === 'approved'));
});

test('proposed memories of another principal are not retrievable', () => {
  const env = setup('mars-p1-ret-');
  const created = store.propose(env.db, env.principal('R2'), {
    project_id: 'p1', role_id: 'R2', memory_type: 'L2', content: 'pending-retrieval-marker',
    source_ref: 'docs/pending.md', source_version: 'v1'
  }, { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', query: 'pending-retrieval-marker' });
  assert.ok(!rows.some(row => row.memory_id === created.memory_id));
});

test('role profile limits which memory types are retrieved', () => {
  const env = setup('mars-p1-ret-');
  const l3 = make(env, 'R3', 'L3 role-filtered decision', 'L3');
  const r5L3 = retrieve(env.db, env.principal('R5'), 'R5', env.routing, { project_id: 'p1', type: 'L3' });
  assert.equal(r5L3.length, 0);
  const r3L3 = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', type: 'L3' });
  assert.ok(r3L3.some(row => row.memory_id === l3));
});
