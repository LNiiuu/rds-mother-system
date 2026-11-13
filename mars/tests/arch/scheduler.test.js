'use strict';
// M18：多 Agent 调度器 —— 依赖、串行、并发重叠、冲突保护、恢复。
//
// 这些测试使用真实文件系统 + 确定性 mock provider；不发起网络请求。
// 并发测试用 asyncDelay（setTimeout）而不是 Atomics.wait，证明事件循环内真实重叠。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup, tmpdir } = require('../phase1/helpers');
const runtime = require('../../src/runtime/agent-runtime');
const scheduler = require('../../src/runtime/scheduler');
const { createMockProvider } = require('../../src/adapters/provider-mock');
const { createFsToolExecutor } = require('../../src/adapters/fs-tool-executor');
const { createWorkspaceManager } = require('../../src/adapters/fs-workspaces');

function makeBase(prefix) {
  const root = tmpdir(prefix);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  return root;
}

function addProject(db, root) {
  db.prepare(`INSERT INTO projects (project_id, display_name, owner_principal, share_policy, created_at, root_path, status, config_json, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('p1', 'P1', 'pid-r0', 'deny', new Date().toISOString(), root, 'active', '{}', new Date().toISOString());
}

function addAgent(db, role, turns, id) {
  return runtime.createAgent(db, {
    project_id: 'p1', role_id: role, agent_id: id, name: id || role,
    provider: 'mock', model: 'mock-1', mock: { turns }
  }, { providers: ['mock'] });
}

function ctxFor(db, baseDir) {
  return {
    db,
    workspace: createWorkspaceManager({ baseDir }),
    providerFor: (name, agent) => createMockProvider({ scriptByAgent: { [agent.agent_id]: agent.definition.mock.turns } }),
    toolExecutorFor: (root, options) => createFsToolExecutor({ root, ...options }),
    compilePacket: null
  };
}

test('M18 串行依赖：R1 写文件后 R2 才能读到', async () => {
  const e = setup('m18-serial-');
  const root = makeBase('m18-serial-base-');
  addProject(e.db, root);
  addAgent(e.db, 'R1', [
    { text: '写设计', toolCalls: [{ name: 'write_file', args: { path: 'a.txt', content: 'design' } }] },
    { text: '完成' }
  ], 'a-r1');
  addAgent(e.db, 'R2', [
    { text: '读设计', toolCalls: [{ name: 'read_file', args: { path: 'a.txt' } }] },
    { text: '完成' }
  ], 'a-r2');

  const plan = scheduler.createPlan(e.db, {
    project_id: 'p1', base_root: root, mode: 'serial', workspace_mode: 'shared', max_concurrency: 1,
    jobs: [
      { key: 'design', agent_id: 'a-r1', title: '设计', writable_paths: ['a.txt'], deps: [], priority: 10 },
      { key: 'impl', agent_id: 'a-r2', title: '实现', deps: ['design'], priority: 5 }
    ]
  });
  const out = await scheduler.executePlan({ ...ctxFor(e.db, tmpdir('m18-serial-work-')), plan });
  assert.equal(out.plan.status, 'SUCCEEDED');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'design');
  const design = out.jobs.find((j) => j.job_key === 'design');
  const impl = out.jobs.find((j) => j.job_key === 'impl');
  assert.equal(design.status, 'SUCCEEDED');
  assert.equal(impl.status, 'SUCCEEDED');
  const r1 = runtime.getRun(e.db, design.run_id);
  const r2 = runtime.getRun(e.db, impl.run_id);
  assert.ok(r1.finished_at <= r2.started_at, '串行依赖必须先完成后开始');
});

test('M18 并发：三个独立 job 在真实时间上重叠，且各自有独立 session', async () => {
  const e = setup('m18-parallel-');
  const root = makeBase('m18-parallel-base-');
  addProject(e.db, root);
  addAgent(e.db, 'R5', [{ text: '研究完成', delayMs: 300, asyncDelay: true }], 'p-r5');
  addAgent(e.db, 'R6', [{ text: '安全完成', delayMs: 300, asyncDelay: true }], 'p-r6');
  addAgent(e.db, 'R2', [
    { text: '写产物', delayMs: 300, asyncDelay: true, toolCalls: [{ name: 'write_file', args: { path: 'out.txt', content: 'ok' } }] },
    { text: '完成' }
  ], 'p-r2');

  const plan = scheduler.createPlan(e.db, {
    project_id: 'p1', base_root: root, mode: 'parallel', workspace_mode: 'copy', max_concurrency: 3, auto_merge: true,
    jobs: [
      { key: 'research', agent_id: 'p-r5', title: '研究', isolation: 'copy', priority: 5 },
      { key: 'security', agent_id: 'p-r6', title: '安全', isolation: 'copy', priority: 5 },
      { key: 'write', agent_id: 'p-r2', title: '写', isolation: 'copy', writable_paths: ['out.txt'], priority: 5 }
    ]
  });
  const out = await scheduler.executePlan({ ...ctxFor(e.db, tmpdir('m18-parallel-work-')), plan });
  assert.equal(out.plan.status, 'SUCCEEDED');
  const runs = out.jobs.map((j) => ({ j, r: runtime.getRun(e.db, j.run_id) }));
  assert.equal(new Set(runs.map((x) => x.r.session_id)).size, 3, '三个 job 的 session 必须不同');
  let overlap = 0;
  for (let i = 0; i < runs.length; i += 1) {
    for (let k = i + 1; k < runs.length; k += 1) {
      const a = runs[i].r; const b = runs[k].r;
      if (Date.parse(a.started_at) < Date.parse(b.finished_at) && Date.parse(b.started_at) < Date.parse(a.finished_at)) overlap += 1;
    }
  }
  assert.ok(overlap >= 1, '至少两个 job 的执行时间窗应重叠，实际 overlap=' + overlap);
  assert.equal(fs.readFileSync(path.join(root, 'out.txt'), 'utf8'), 'ok');
});

test('M18 冲突保护：两个 job 改同一文件，第二个合并被阻止', async () => {
  const e = setup('m18-conflict-');
  const root = makeBase('m18-conflict-base-');
  addProject(e.db, root);
  addAgent(e.db, 'R2', [
    { text: '写 A', toolCalls: [{ name: 'write_file', args: { path: 'conflict.txt', content: 'A' } }] },
    { text: '完成' }
  ], 'c-a');
  addAgent(e.db, 'R2', [
    { text: '写 B', toolCalls: [{ name: 'write_file', args: { path: 'conflict.txt', content: 'B' } }] },
    { text: '完成' }
  ], 'c-b');

  const plan = scheduler.createPlan(e.db, {
    project_id: 'p1', base_root: root, mode: 'parallel', workspace_mode: 'copy', max_concurrency: 2, auto_merge: true,
    jobs: [
      { key: 'a', agent_id: 'c-a', title: 'A', isolation: 'copy', writable_paths: ['conflict.txt'] },
      { key: 'b', agent_id: 'c-b', title: 'B', isolation: 'copy', writable_paths: ['conflict.txt'] }
    ]
  });
  const out = await scheduler.executePlan({ ...ctxFor(e.db, tmpdir('m18-conflict-work-')), plan });
  assert.equal(out.plan.status, 'PARTIAL');
  assert.equal(out.plan.merge_status, 'CONFLICT');
  const blocked = out.jobs.filter((j) => j.status === 'BLOCKED');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].error_code, 'MERGE_CONFLICT');
  assert.match(blocked[0].error_message, /conflict\.txt/);
});

test('M18 恢复：心跳陈旧的 RUNNING job 被重新排队，run 标 AGENT_LOST', () => {
  const e = setup('m18-recover-');
  const root = makeBase('m18-recover-base-');
  addProject(e.db, root);
  addAgent(e.db, 'R2', [{ text: 'ok' }], 'rec-r2');
  const plan = scheduler.createPlan(e.db, {
    project_id: 'p1', base_root: root, mode: 'serial', workspace_mode: 'shared',
    jobs: [{ key: 'one', agent_id: 'rec-r2', title: 'one', max_attempts: 2 }]
  });
  const job = scheduler.listJobs(e.db, plan.plan_id)[0];
  const { run } = runtime.startRun(e.db, { agent_id: 'rec-r2', project_id: 'p1' });
  e.db.prepare("UPDATE agent_runs SET status='RUNNING', heartbeat_at='2000-01-01T00:00:00.000Z' WHERE run_id=?").run(run.run_id);
  e.db.prepare("UPDATE orchestration_jobs SET status='RUNNING', run_id=?, attempt=1 WHERE job_id=?").run(run.run_id, job.job_id);

  const rec = scheduler.recoverPlan(e.db, plan.plan_id, { staleMs: 1000 });
  assert.equal(rec.recovered.length, 1);
  assert.equal(rec.recovered[0].action, 'REQUEUE');
  assert.equal(scheduler.getJob(e.db, job.job_id).status, 'READY');
  assert.equal(runtime.getRun(e.db, run.run_id).status, 'FAILED');
  assert.equal(runtime.getRun(e.db, run.run_id).error_code, 'AGENT_LOST');
});

test('M18 工作区：copy 变更合并；同一路径第二次合并冲突', () => {
  const base = makeBase('m18-ws-base-');
  fs.writeFileSync(path.join(base, 'a.txt'), 'v1\n', 'utf8');
  const wm = createWorkspaceManager({ baseDir: tmpdir('m18-ws-work-') });
  const a = wm.prepare({ base_root: base, plan_id: 'plan-ws', job_key: 'a', attempt: 1, isolation: 'copy' });
  const b = wm.prepare({ base_root: base, plan_id: 'plan-ws', job_key: 'b', attempt: 1, isolation: 'copy' });
  fs.writeFileSync(path.join(a.path, 'a.txt'), 'v2\n', 'utf8');
  fs.writeFileSync(path.join(b.path, 'a.txt'), 'v3\n', 'utf8');
  const ca = wm.changes(a);
  const cb = wm.changes(b);
  assert.equal(ca.files.find((f) => f.path === 'a.txt').status, 'modified');
  const owners = new Map();
  const first = wm.merge({ base_root: base, workspace: a.path, changes: ca.files, job_key: 'a', owners, apply: true });
  assert.equal(first.ok, true);
  const second = wm.merge({ base_root: base, workspace: b.path, changes: cb.files, job_key: 'b', owners, apply: true });
  assert.equal(second.ok, false);
  assert.ok(second.conflicts.some((c) => c.path === 'a.txt'));
  assert.equal(fs.readFileSync(path.join(base, 'a.txt'), 'utf8'), 'v2\n');
});

test('M18 任务级写路径：allowedWritePaths 外拒绝，内允许', async () => {
  const root = makeBase('m18-scope-');
  const ex = createFsToolExecutor({ root, allowedWritePaths: ['src/**'] });
  const denied = await ex.invoke('write_file', { path: 'docs/out.txt', content: 'x' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error_code, 'TOOL_PATH_DENIED');
  const allowed = await ex.invoke('write_file', { path: 'src/out.txt', content: 'x' });
  assert.equal(allowed.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'src', 'out.txt')), true);
});
