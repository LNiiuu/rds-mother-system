'use strict';
// M11：角色权限、任务状态机、调度、交接与成本账本。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('../phase1/helpers');
const collab = require('../../src/collab');

test('M11 角色：R7 有本地提交、没有 push；R2 不能指派', () => {
  const r7 = collab.role('R7');
  assert.ok(r7.permissions.includes('git.commit'));
  assert.ok(!r7.permissions.includes('git.push'));
  assert.ok(r7.forbidden.includes('git.push'));
  assert.throws(() => collab.assertPermission('R2', 'task.assign'), /ROLE_DENIED/);
  assert.equal(collab.assertPermission('R0', 'task.assign'), true);
  assert.throws(() => collab.role('R9'), /ROLE_UNKNOWN/);
});

test('M11 状态机：合法路径可走，非法迁移与无证据完成被拒', () => {
  const env = setup('m11-task-');
  const task = collab.createTask(env.db, { project_id: 'p1', title: '实现导出', actor: 'pid-r0' });
  assert.equal(task.status, 'PLANNED');
  assert.equal(collab.assign(env.db, task.task_id, { role: 'R2', agent: 'a2', actor: 'pid-r0' }).status, 'ASSIGNED');
  assert.equal(collab.transition(env.db, task.task_id, 'RUNNING', 'a2').status, 'RUNNING');
  assert.throws(() => collab.transition(env.db, task.task_id, 'COMPLETED', 'a2'), /TASK_TRANSITION_INVALID/);
  assert.equal(collab.transition(env.db, task.task_id, 'REVIEW_PENDING', 'a2').status, 'REVIEW_PENDING');
  assert.equal(collab.transition(env.db, task.task_id, 'VERIFICATION_PENDING', 'a3').status, 'VERIFICATION_PENDING');
  assert.throws(() => collab.complete(env.db, task.task_id, { evidence: [], actor: 'a3' }), /EVIDENCE_REQUIRED/);
  const done = collab.complete(env.db, task.task_id, { evidence: ['test:unit'], actor: 'a3' });
  assert.equal(done.status, 'COMPLETED');
  assert.deepEqual(done.output_refs, ['test:unit']);

  const events = collab.events(env.db, task.task_id);
  assert.equal(events[0].to_status, 'PLANNED');
  assert.equal(events[events.length - 1].to_status, 'COMPLETED');

  const failing = collab.createTask(env.db, { project_id: 'p1', title: '会失败', actor: 'pid-r0' });
  assert.throws(() => collab.fail(env.db, failing.task_id, '', 'a2'), /FAILURE_REASON_REQUIRED/);
  assert.equal(collab.fail(env.db, failing.task_id, '依赖缺失', 'a2').status, 'FAILED');
});

test('M11 调度：实现+测试拆两个任务，不再整体判为 verification', () => {
  const split = collab.dispatch('实现导出功能并补测试');
  assert.equal(split.needs_review, false);
  assert.deepEqual(split.tasks.map((t) => t.role).sort(), ['R2', 'R3']);
  assert.ok(split.reasons.some((r) => /拆成两个任务/.test(r)));

  const onlyTest = collab.dispatch('只做回归测试');
  assert.deepEqual(onlyTest.tasks.map((t) => t.role), ['R3']);

  const explicit = collab.dispatch('随便写点什么', { role: 'R1' });
  assert.deepEqual(explicit.tasks.map((t) => t.role), ['R1']);
  assert.match(explicit.reasons[0], /显式指定/);

  const unclear = collab.dispatch('看看这个');
  assert.equal(unclear.needs_review, true);
  assert.equal(unclear.tasks[0].role, 'R0');
});

test('M11 任务拆分：父任务 + 子任务，项目隔离', () => {
  const env = setup('m11-plan-');
  const r = collab.planTasks(env.db, { project_id: 'p1', objective: '实现导出并补测试', actor: 'pid-r0' });
  assert.equal(r.tasks.length, 2);
  for (const t of r.tasks) assert.equal(t.parent_task_id, r.parent.task_id);
  assert.equal(collab.listTasks(env.db, { project_id: 'p1' }).length, 3);
  assert.equal(collab.listTasks(env.db, { project_id: 'p2' }).length, 0);
});

test('M11 交接：只记录事实，不编造决策/测试结果', () => {
  const env = setup('m11-handoff-');
  const task = collab.createTask(env.db, { project_id: 'p1', title: '实现导出', description: '导出 CSV', actor: 'pid-r0' });
  collab.assign(env.db, task.task_id, { role: 'R2', agent: 'a2', actor: 'pid-r0' });
  collab.transition(env.db, task.task_id, 'RUNNING', 'a2');
  const summary = collab.buildHandoffSummary(env.db, collab.getTask(env.db, task.task_id));
  assert.equal(summary.task_id, task.task_id);
  assert.deepEqual(summary.key_decisions, []);
  assert.deepEqual(summary.test_results, []);
  assert.match(summary.note, /不自动生成/);

  const saved = collab.saveHandoff(env.db, { task, toRole: 'R3', fromRole: 'R2', packetId: 'pkt_test', summary });
  assert.match(saved.handoff_id, /^hof_/);
  const list = collab.listHandoffs(env.db, task.task_id);
  assert.equal(list.length, 1);
  assert.equal(list[0].to_role, 'R3');
});

test('M11 成本：估算与实际分开，汇总可查', () => {
  const env = setup('m11-cost-');
  assert.throws(() => collab.recordCost(env.db, {
    project_id: 'p1', input_tokens: 10, usage_source: 'estimated', actual_cost: 0.5,
  }), /ACTUAL_COST_REQUIRES_PROVIDER/);
  assert.throws(() => collab.recordCost(env.db, { project_id: 'p1', usage_source: 'magic' }), /USAGE_SOURCE_INVALID/);

  collab.recordCost(env.db, { project_id: 'p1', task_id: 't1', agent_id: 'a2', model: 'm', input_tokens: 100, output_tokens: 20, usage_source: 'estimated' });
  collab.recordCost(env.db, { project_id: 'p1', task_id: 't2', agent_id: 'a3', model: 'm', input_tokens: 300, output_tokens: 50, usage_source: 'provider', actual_cost: 0.02 });
  const report = collab.costReport(env.db, { project_id: 'p1' });
  assert.equal(report.rows, 2);
  assert.equal(report.total.input, 400);
  assert.equal(report.total.output, 70);
  assert.equal(report.usage_source.provider, 1);
  assert.equal(report.usage_source.estimated, 1);
  assert.equal(report.top_task.task_id, 't2');
  assert.equal(report.total.actual, 0.02);
});
