'use strict';
// R0 remediation tests for R4 Phase 1 review findings (P1/P2/P3/P4).
// P1 restoreFragment role assertion; P2 query type purity; P3 manifest status; P4 schema keywords.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, propose, approve } = require('./helpers');
const { retrieve } = require('../../src/retrieval');
const { compileContext } = require('../../src/compiler');
const { restoreFragment } = require('../../src/manifest');
const { validate } = require('../../src/validate');

function seed(env) {
  const fact = propose(env, 'R2', { memory_type: 'L2', content: 'alpha 事实：接口超时重试 3 次', source_ref: 'docs/fact.md', source_version: 'v1' });
  approve(env, 'R2', fact.memory_id);
  const decision = propose(env, 'R3', { memory_type: 'L3', content: 'alpha 决策：采用幂等键', source_ref: 'docs/decision.md', source_version: 'v1' });
  approve(env, 'R3', decision.memory_id);
  return { fact, decision };
}

test('P1: restoreFragment rejects role not held by principal', () => {
  const env = setup('mars-p1-rem-');
  seed(env);
  const packet = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets, project_id: 'p1', role_id: 'R3', task_id: 'T-REM', budget: 4000, query: 'alpha'
  });
  const fragmentId = packet.manifest.fragments.find(f => f.content_type === 'decision').fragment_id;
  // R2 token holder cannot claim R3 (evidence_direct) role.
  const r2 = env.principal('R2');
  assert.throws(() => restoreFragment(env.db, r2, 'R3', 'p1', fragmentId, env.routing), /ROLE_DENIED/);
  // R3 token holder with R3 role may restore.
  const restored = restoreFragment(env.db, env.principal('R3'), 'R3', 'p1', fragmentId, env.routing);
  assert.match(restored.content, /alpha 决策/);
});

test('P2: query does not leak other memory types when type is requested', () => {
  const env = setup('mars-p1-rem-');
  seed(env);
  const rows = retrieve(env.db, env.principal('R3'), 'R3', env.routing, { project_id: 'p1', query: 'alpha', type: 'L3' });
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(r => r.memory_type === 'L3'), 'only L3 rows expected, got ' + rows.map(r => r.memory_type).join(','));

  const packet = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets, project_id: 'p1', role_id: 'R3', task_id: 'T-REM', budget: 4000, query: 'alpha'
  });
  const decisions = packet.packet.sections.find(s => s.kind === 'decisions');
  assert.ok(decisions && !decisions.content.includes('alpha 事实'), 'decisions section must not contain L2 facts');
  assert.ok(decisions.content.includes('alpha 决策'));
});

test('P3: manifest entry status reflects source status', () => {
  const env = setup('mars-p1-rem-');
  const { decision } = seed(env);
  const packet = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets, project_id: 'p1', role_id: 'R3', task_id: 'T-REM', budget: 4000
  });
  const entry = packet.manifest.entries.find(e => e.content_type === 'decision');
  assert.equal(entry.status, 'approved');
  assert.ok(entry.fragment_id);
  assert.ok(decision.memory_id);
});

test('P4: validator enforces maxItems/uniqueItems/format', () => {
  const tagsSchema = { type: 'array', items: { type: 'string' }, maxItems: 3, uniqueItems: true };
  assert.equal(validate(['a', 'b'], tagsSchema).valid, true);
  assert.equal(validate(['a', 'b', 'c', 'd'], tagsSchema).valid, false);
  assert.equal(validate(['a', 'a'], tagsSchema).valid, false);

  const dt = { type: 'string', format: 'date-time' };
  assert.equal(validate('2026-11-03T19:00:00+08:00', dt).valid, true);
  assert.equal(validate('2026-11-03 19:00:00', dt).valid, false);
});

test('G1: role-scoped memory is excluded from other roles packets (even approvers)', () => {
  const env = setup('mars-p1-scope-');
  const scoped = propose(env, 'R3', {
    memory_type: 'L4', content: 'scope 知识：仅 R3 可见的调试技巧', source_ref: 'docs/scope.md',
    source_version: 'v1', visibility: 'role', role_scope: ['R3']
  });
  approve(env, 'R3', scoped.memory_id, 'R4');
  const r0 = compileContext(env.db, env.principal('R0'), env.routing, {
    assets: env.assets, project_id: 'p1', role_id: 'R0', task_id: 'T-SCOPE', budget: 4000, query: 'scope'
  });
  const r0Knowledge = r0.packet.sections.find(s => s.kind === 'knowledge');
  const r0Text = r0Knowledge ? r0Knowledge.content : '';
  assert.ok(!r0Text.includes('仅 R3 可见'), 'R0 packet must not contain R3-scoped memory, got: ' + r0Text);
  const r3 = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets, project_id: 'p1', role_id: 'R3', task_id: 'T-SCOPE', budget: 4000, query: 'scope'
  });
  const r3Knowledge = r3.packet.sections.find(s => s.kind === 'knowledge');
  assert.ok(r3Knowledge && r3Knowledge.content.includes('仅 R3 可见'), 'R3 packet must contain R3-scoped memory');
});

test('G1: MCP task envelope is normalized (task_id/title -> id/objective)', () => {
  const { normalizeTask } = require('../../src/mcp-stdio');
  const t = normalizeTask({ task_id: 'G1-REAL-CALL-001', title: '验证 R0 经 DSH 真实调用 MARS', criteria: ['a'], inScope: ['mars/'] });
  assert.equal(t.id, 'G1-REAL-CALL-001');
  assert.equal(t.objective, '验证 R0 经 DSH 真实调用 MARS');
  assert.deepEqual(t.acceptance, ['a']);
  assert.deepEqual(t.scope, ['mars/']);
});
