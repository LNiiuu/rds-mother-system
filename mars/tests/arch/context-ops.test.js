'use strict';
// M9/M10：预算、分析、压缩、恢复。
//
// 这组测试守的是「不丢信息」：L0 必须原样、无收益不许假装压缩、原文必须能恢复。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('../phase1/helpers');
const budget = require('../../src/context-budget');
const ops = require('../../src/context-ops');
const { compileContext } = require('../../src/compiler');
const { sha256 } = require('../../src/util');

function sections() {
  return [
    { id: 'sec_task', title: '任务要求', kind: 'task', content: '任务: T-1\n任务正文:\n做一件事', token_estimate: 20, source_refs: ['task:T-1'] },
    { id: 'sec_decisions', title: '已批准决策', kind: 'decisions', content: '- 决策 A\n- 决策 B', token_estimate: 12, source_refs: ['m1@v1'] },
    { id: 'sec_facts', title: '相关项目事实', kind: 'facts', content: '事实 1\n事实 1\n事实 1\n事实 2', token_estimate: 14, source_refs: ['m2@v1'] },
    { id: 'sec_evidence', title: '证据引用', kind: 'evidence', content: '- a.md\n- b.md', token_estimate: 8, source_refs: ['a.md', 'b.md'] },
    { id: 'sec_dup', title: '重复证据', kind: 'evidence', content: '- a.md\n- b.md', token_estimate: 8, source_refs: ['c.md'] },
  ];
}

test('M9 预算：可用输入与状态阈值', () => {
  const r = budget.compute({ model: 'generic-128k', estimatedInputTokens: 1000 });
  assert.equal(r.modelContextWindow, 128000);
  assert.equal(r.availableInputTokens, 128000 - 8192 - 4000 - 6000 - 6000);
  assert.equal(r.budgetStatus, 'NORMAL');
  assert.match(r.estimationMethod, /not provider usage/);

  const check = (tokens) => budget.compute({ model: 'generic-128k', estimatedInputTokens: tokens }).budgetStatus;
  const available = r.availableInputTokens;
  assert.equal(check(Math.ceil(available * 0.61)), 'WARNING');
  assert.equal(check(Math.ceil(available * 0.76)), 'HIGH');
  assert.equal(check(Math.ceil(available * 0.86)), 'CRITICAL');
  assert.equal(check(available), 'EXCEEDED');
  assert.throws(() => budget.compute({ model: 'no-such-model', estimatedInputTokens: 1 }), /MODEL_UNKNOWN/);
});

test('M10 分析：重复识别与分层', () => {
  const a = ops.analyze(sections());
  assert.equal(a.duplicates.length, 1);
  assert.deepEqual(a.duplicates[0].ids.sort(), ['sec_dup', 'sec_evidence']);
  assert.equal(a.duplicates[0].wastedTokens, 8);
  assert.equal(a.layers.L0.count, 1);
  assert.equal(a.layers.L3.count, 2);
});

test('M10 压缩：去重 + 重复行折叠，L0 不动', () => {
  const before = sections();
  const r = ops.compress(before, { strategy: 'safe' });
  assert.equal(r.validationStatus, 'VALID');
  assert.ok(r.afterTokens < r.beforeTokens);
  const ids = r.compressed.map((s) => s.id);
  assert.ok(!ids.includes('sec_dup'), '重复分节应被合并');
  const task = r.compressed.find((s) => s.id === 'sec_task');
  assert.equal(task.content, before[0].content, 'L0 必须逐字不变');
  const facts = r.compressed.find((s) => s.id === 'sec_facts');
  assert.match(facts.content, /重复 3 次/);
  assert.equal(r.l0Preserved, true);
});

test('M10 归档 + 恢复：原文 SHA-256 校验通过', () => {
  const env = setup('m10-archive-');
  const big = sections();
  big[3] = {
    id: 'sec_evidence', title: '证据引用', kind: 'evidence',
    content: Array.from({ length: 100 }, (_, i) => `- evidence/ref-${i}.md [file]`).join('\n'),
    token_estimate: 300, source_refs: ['evidence'],
  };
  const r = ops.compress(big, { archive: true });
  assert.equal(r.validationStatus, 'VALID');
  const evidence = r.compressed.find((s) => s.id === 'sec_evidence');
  assert.match(evidence.content, /已归档/);
  ops.save(env.db, { project_id: 'p1', task_id: 'T-1', role_id: 'R0' }, r);

  const restored = ops.restore(env.db, r.compressionId);
  assert.equal(restored.sections.length, big.length);
  const orig = restored.sections.find((s) => s.id === 'sec_evidence');
  assert.match(orig.content, /ref-99\.md/);
});

test('M10 恢复：原文被篡改则拒绝返回', () => {
  const env = setup('m10-tamper-');
  const r = ops.compress(sections(), { archive: true });
  ops.save(env.db, { project_id: 'p1', task_id: 'T-1', role_id: 'R0' }, r);
  env.db.prepare('UPDATE compressions SET original_json = ? WHERE compression_id = ?')
    .run(JSON.stringify([{ id: 'x', content: 'tampered' }]), r.compressionId);
  assert.throws(() => ops.restore(env.db, r.compressionId), /COMPRESSION_HASH_MISMATCH/);
});

test('M10 无收益：记 NO_GAIN 并回退原文', () => {
  const tiny = [{ id: 'sec_task', title: '任务', kind: 'task', content: 'x', token_estimate: 1, source_refs: [] }];
  const r = ops.compress(tiny, { archive: true });
  assert.equal(r.validationStatus, 'NO_GAIN');
  assert.deepEqual(ops.apply(r), tiny);
});

test('M10 编译自动压缩：超预算触发、L0 保留、记录可查', () => {
  const env = setup('m10-auto-');
  const evidence = Array.from({ length: 80 }, (_, i) => ({ ref: `evidence/ref-${i}.md`, kind: 'file' }));
  const taskText = '任务正文：'.padEnd(300, '规');
  const before = compileContext(env.db, env.principal('R0'), env.routing, {
    project_id: 'p1', task_id: 'T-AUTO', role_id: 'R0', budget: 850,
    task: { id: 'T-AUTO', text: taskText }, evidence, assets: env.assets,
  });
  const after = compileContext(env.db, env.principal('R0'), env.routing, {
    project_id: 'p1', task_id: 'T-AUTO', role_id: 'R0', budget: 850,
    task: { id: 'T-AUTO', text: taskText }, evidence, assets: env.assets,
    autoCompress: true, model: 'generic-32k',
  });
  assert.ok(after.compression, '应触发压缩');
  assert.equal(after.compression.validation_status, 'VALID');
  assert.ok(after.packet.tokens_estimated < before.packet.tokens_estimated);
  const taskAfter = after.packet.sections.find((s) => s.kind === 'task');
  assert.match(taskAfter.content, /任务正文/);
  assert.ok(taskAfter.content.includes(taskText), 'L0 任务正文必须完整保留');

  const runs = ops.listRuns(env.db, { project_id: 'p1' });
  assert.ok(runs.length >= 2);
  assert.equal(runs[0].compression_id, after.compression.compression_id);

  const restored = ops.restore(env.db, after.compression.compression_id);
  const evBefore = restored.sections.find((s) => s.kind === 'evidence');
  assert.ok(evBefore.content.includes('ref-79'), '归档前证据必须可恢复');
});
