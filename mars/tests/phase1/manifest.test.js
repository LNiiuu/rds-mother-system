'use strict';
// A3 / A6: manifest traceability, fragment de-duplication and restore permission.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { buildManifest, restoreFragment } = require('../../src/manifest');
const { compileContext } = require('../../src/compiler');
const store = require('../../src/store');

test('A6 manifest entries trace source, version, role and task', () => {
  const env = setup('mars-p1-man-');
  const manifest = buildManifest(env.db, {
    project_id: 'p1', task_id: 'T-P1-MAN', role_id: 'R3', token_budget: 1000, tokens_estimated: 42,
    assets: env.assets
  }, [
    { id: 'sec_task', kind: 'task', title: 'task', content: 'task card body', source_refs: ['task-card:T-P1-MAN'], token_estimate: 5 },
    { id: 'sec_facts', kind: 'facts', title: 'facts', content: 'fact one', source_refs: ['docs/f1.md'], source_version: 'v1', token_estimate: 3 },
    { id: 'sec_decisions', kind: 'decisions', title: 'decisions', content: 'decision one', source_refs: ['docs/d1.md'], source_version: 'v2', token_estimate: 3 }
  ]);
  assert.match(manifest.manifest_id, /^man_/);
  assert.equal(manifest.role_id, 'R3');
  assert.equal(manifest.task_id, 'T-P1-MAN');
  assert.equal(manifest.estimate_label, '[ESTIMATE]');
  assert.equal(manifest.entries.length, 3);
  for (const entry of manifest.entries) {
    assert.ok(entry.source_ref && entry.source_version && entry.content_hash);
    assert.equal(entry.status, 'approved');
  }
  const row = env.db.prepare('SELECT * FROM manifests WHERE manifest_id = ?').get(manifest.manifest_id);
  assert.equal(row.role_id, 'R3');
  assert.equal(row.task_id, 'T-P1-MAN');
});

test('A3 identical content reuses one fragment while keeping both entries', () => {
  const env = setup('mars-p1-man-');
  const manifest = buildManifest(env.db, {
    project_id: 'p1', task_id: 'T-P1-DEDUP', role_id: 'R3', token_budget: 1000, tokens_estimated: 10,
    assets: env.assets
  }, [
    { id: 'sec_a', kind: 'facts', content: 'same card text', source_refs: ['docs/a.md'], source_version: 'v1' },
    { id: 'sec_b', kind: 'facts', content: 'same card text', source_refs: ['docs/b.md'], source_version: 'v1' },
    { id: 'sec_c', kind: 'decisions', content: 'different content', source_refs: ['docs/c.md'], source_version: 'v1' }
  ]);
  assert.equal(manifest.entries.length, 3);
  const uniqueFragments = new Set(manifest.fragments.map(fragment => fragment.fragment_id));
  assert.equal(uniqueFragments.size, 2);
  assert.equal(manifest.fragments[0].fragment_id, manifest.fragments[1].fragment_id);
  assert.equal(manifest.fragments[1].ref_count, 2);
  const stored = env.db.prepare('SELECT COUNT(*) AS n FROM fragments WHERE project_id = ?').get('p1');
  assert.equal(Number(stored.n), 2);
});

test('A3/A7 restoreFragment returns the original text for R3 and denies R2', () => {
  const env = setup('mars-p1-man-');
  const manifest = buildManifest(env.db, {
    project_id: 'p1', task_id: 'T-P1-RESTORE', role_id: 'R3', token_budget: 1000, tokens_estimated: 10,
    assets: env.assets
  }, [{ id: 'sec_facts', kind: 'facts', content: 'restorable original text', source_refs: ['docs/r.md'], source_version: 'v1' }]);
  const fragmentId = manifest.entries[0].fragment_id;
  const restored = restoreFragment(env.db, env.principal('R3'), 'R3', 'p1', fragmentId, env.routing);
  assert.equal(restored.content, 'restorable original text');
  assert.equal(restored.content_hash, manifest.entries[0].content_hash);
  const restoredByR4 = restoreFragment(env.db, env.principal('R4'), 'R4', 'p1', fragmentId, env.routing);
  assert.equal(restoredByR4.content, 'restorable original text');
  assert.throws(() => restoreFragment(env.db, env.principal('R2'), 'R2', 'p1', fragmentId, env.routing), /EVIDENCE_DENIED/);
});

test('compiled packet links to a persisted manifest with section sources', () => {  const env = setup('mars-p1-man-');
  const created = store.propose(env.db, env.principal('R3'), {
    project_id: 'p1', role_id: 'R3', memory_type: 'L2', content: 'manifest compile fact',
    source_ref: 'docs/mc.md', source_version: 'v1'
  }, { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  const result = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-MC', role_id: 'R3', task: { id: 'T-P1-MC', objective: 'manifest' },
    evidence: [{ ref: 'docs/mc.md', kind: 'file' }]
  });
  assert.equal(result.packet.manifest_id, result.manifest.manifest_id);
  const row = env.db.prepare('SELECT * FROM manifests WHERE manifest_id = ?').get(result.packet.manifest_id);
  assert.ok(row);
  const entries = JSON.parse(row.entries_json);
  assert.ok(entries.some(entry => entry.source_ref === 'docs/mc.md'));
  const evidenceSection = result.packet.sections.find(sec => sec.kind === 'evidence');
  assert.ok(evidenceSection.source_refs.includes('docs/mc.md'));
});

test('A7 role profiles produce different packets for R2 and R3', () => {
  const env = setup('mars-p1-man-');
  const created = store.propose(env.db, env.principal('R3'), {
    project_id: 'p1', role_id: 'R3', memory_type: 'L3', content: 'role specific decision',
    source_ref: 'docs/role-l3.md', source_version: 'v1'
  }, { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  const compile = id => compileContext(env.db, env.principal(id), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-ROLE', role_id: id, task: { id: 'T-P1-ROLE' }
  });
  const r2 = compile('R2');
  const r3 = compile('R3');
  assert.notEqual(r2.packet.role_profile, r3.packet.role_profile);
  const r3Decisions = r3.packet.sections.find(sec => sec.kind === 'decisions');
  assert.ok(r3Decisions && r3Decisions.content.includes('role specific decision'));
  const r2Decisions = r2.packet.sections.find(sec => sec.kind === 'decisions');
  assert.ok(!r2Decisions, 'R2 role profile excludes L3');
  assert.ok(r2.packet.missing.some(item => item.kind === 'decisions' && item.blocking === true));
  const r1 = compileContext(env.db, env.principal('R1'), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-ROLE', role_id: 'R1', task: { id: 'T-P1-ROLE' },
    evidence: [{ ref: 'docs/role-l3.md', kind: 'file' }]
  });
  const r4 = compileContext(env.db, env.principal('R4'), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-ROLE', role_id: 'R4', task: { id: 'T-P1-ROLE' },
    evidence: [{ ref: 'docs/role-l3.md', kind: 'file' }]
  });
  assert.notEqual(r1.packet.role_profile, r4.packet.role_profile);
  const r1Evidence = r1.packet.sections.find(sec => sec.kind === 'evidence');
  const r4Evidence = r4.packet.sections.find(sec => sec.kind === 'evidence');
  assert.match(r1Evidence.content, /仅见引用/);
  assert.match(r4Evidence.content, /可直接访问原始证据/);
});
