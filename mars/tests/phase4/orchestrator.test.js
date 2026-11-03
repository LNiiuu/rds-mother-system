'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../../src/db');
const orch = require('../../src/orchestrator');

const PROJECT = 'p6-demo';
const ALLOWED = [PROJECT];

function fresh() { return openDb(':memory:'); }

test('classify distinguishes architecture / implementation / verification', () => {
  const a = orch.classify({ objective: '设计订单事件架构与接口契约' });
  const b = orch.classify({ objective: '实现并修复登录限流代码' });
  const c = orch.classify({ objective: '测试并审查支付回调补丁' });
  assert.equal(a.task_class, 'architecture');
  assert.equal(b.task_class, 'implementation');
  assert.equal(c.task_class, 'verification');
  assert.ok(a.rationale.length >= 3);
});

test('plan picks a minimal sufficient set and explains it', () => {
  const p = orch.plan({ project_id: PROJECT, task_id: 'T-1', objective: '设计新的缓存层架构' }, { allowed_projects: ALLOWED });
  assert.equal(p.risk, 'low');
  assert.deepEqual(p.agents.map((x) => x.role_id), ['R1']);
  assert.equal(p.gates.requires_r4, false);
  assert.ok(p.explanation.some((l) => l.includes('最小充分 Agent 集合')));
  assert.ok(p.context_policy.per_agent_budget > 0);
});

test('medium risk implementation requires R2/R3/R4', () => {
  const p = orch.plan({ project_id: PROJECT, objective: '修改数据库幂等接口实现' }, { allowed_projects: ALLOWED });
  assert.equal(p.risk, 'medium');
  const roles = p.agents.map((x) => x.role_id);
  assert.deepEqual(roles, ['R2', 'R3', 'R4']);
  assert.equal(p.gates.requires_r4, true);
});

test('high risk requires human approval before running and before feedback', () => {
  const db = fresh();
  const p = orch.plan({ project_id: PROJECT, objective: '迁移权限数据并删除旧表（支付相关）' }, { allowed_projects: ALLOWED });
  assert.equal(p.risk, 'high');
  assert.equal(p.gates.requires_human_approval, true);
  assert.ok(p.agents.map((x) => x.role_id).includes('R0'));
  const run = orch.startRun(db, p, { principal_id: 'p6-tester' });
  assert.equal(run.status, 'awaiting_approval');
  assert.throws(() => orch.recordFeedback(db, run.run_id, { tokens_total: 10 }), /NOT_APPROVED/);
  const approved = orch.approveRun(db, run.run_id, { approver: 'R0-human', reason: 'reviewed' });
  assert.equal(approved.status, 'running');
  assert.equal(orch.recordFeedback(db, run.run_id, { tokens_total: 100, quality_score: 4 }).status, 'completed');
});

test('unknown or missing project is denied', () => {
  assert.throws(() => orch.plan({ objective: 'x' }, { allowed_projects: ALLOWED }), /PROJECT_REQUIRED/);
  assert.throws(() => orch.plan({ project_id: 'other', objective: 'x' }, { allowed_projects: ALLOWED }), /PROJECT_DENIED/);
});

test('budget overflow pauses the run', () => {
  const db = fresh();
  const p = orch.plan({ project_id: PROJECT, objective: '实现导出功能', budget: { task_tokens: 1000 } }, { allowed_projects: ALLOWED });
  const run = orch.startRun(db, p, { principal_id: 'p6-tester' });
  const fb = orch.recordFeedback(db, run.run_id, { tokens_total: 5000 });
  assert.equal(fb.status, 'paused_budget');
  assert.equal(orch.budgetStatus(db, run.run_id).paused, true);
});

test('feedback persists and suggestions stay offline-only', () => {
  const db = fresh();
  const p = orch.plan({ project_id: PROJECT, objective: '实现幂等校验' }, { allowed_projects: ALLOWED });
  const run = orch.startRun(db, p, { principal_id: 'p6-tester' });
  orch.recordFeedback(db, run.run_id, { tokens_total: 50000, quality_score: 4, rework_count: 0 });
  const s = orch.suggest(db, { project_id: PROJECT });
  assert.equal(s.mode, 'suggestion_only');
  assert.equal(s.applied, false);
  assert.ok(s.suggestions.length >= 1);
});
