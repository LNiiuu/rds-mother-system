'use strict';
// Budget behaviour: protected sections, trimming and [ESTIMATE] labelling.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { applyBudget } = require('../../src/budget');
const { compileContext } = require('../../src/compiler');
const store = require('../../src/store');

test('small budget trims non-protected sections and keeps the protected task', () => {
  const sections = [
    { id: 'task', kind: 'task', content: 'T'.repeat(200) },
    { id: 'facts', kind: 'facts', content: 'F'.repeat(200) },
    { id: 'reference', kind: 'reference', content: 'R'.repeat(200) }
  ];
  const out = applyBudget(sections, { budget: 60, protections: ['task'] });
  assert.equal(out.over_budget, false);
  assert.ok(out.sections.some(sec => sec.id === 'task'));
  assert.ok(out.truncated.includes('facts'));
  assert.ok(out.truncated.includes('reference'));
  assert.ok(out.tokens <= 60);
});

test('protected sections are never trimmed even when over budget', () => {
  const sections = [
    { id: 'task', kind: 'task', content: 'T'.repeat(400) },
    { id: 'prohibitions', kind: 'prohibitions', content: 'P'.repeat(400) },
    { id: 'facts', kind: 'facts', content: 'F'.repeat(40) }
  ];
  const out = applyBudget(sections, { budget: 20, protections: ['task', 'prohibitions'] });
  assert.equal(out.over_budget, true);
  assert.equal(out.note, 'PROTECTED_SECTIONS_EXCEED_BUDGET');
  assert.deepEqual(out.protected_kept.sort(), ['prohibitions', 'task']);
});

test('compiled packet exposes an [ESTIMATE] label and trims oversized facts', () => {
  const env = setup('mars-p1-budget-');
  const huge = store.propose(env.db, env.principal('R3'), {
    project_id: 'p1', role_id: 'R3', memory_type: 'L2', content: 'C'.repeat(6000),
    source_ref: 'docs/huge.md', source_version: 'v1'
  }, { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', huge.memory_id, 'approved', 'ok');
  const result = compileContext(env.db, env.principal('R3'), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-BUDGET', role_id: 'R3', budget: 256,
    task: { id: 'T-P1-BUDGET', objective: 'budget' },
    evidence: [{ ref: 'docs/huge.md', kind: 'file' }]
  });
  assert.equal(result.packet.estimate_label, '[ESTIMATE]');
  assert.ok(result.packet.tokens_estimated <= 256);
  const facts = result.packet.sections.find(sec => sec.kind === 'facts');
  assert.ok(!facts || facts.truncated === true);
});
