#!/usr/bin/env node
'use strict';
// M18 演示：串行 / 并发 / 混合 / 冲突 / 恢复。
// 真实执行：文件写入、node --test、SQLite、Agent run/session；模型仍是确定性 mock。
// 不发起网络请求，不伪造真实模型调用。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../mars/src/db');
const runtime = require('../mars/src/runtime/agent-runtime');
const scheduler = require('../mars/src/runtime/scheduler');
const { createMockProvider } = require('../mars/src/adapters/provider-mock');
const { createFsToolExecutor } = require('../mars/src/adapters/fs-tool-executor');
const { createWorkspaceManager } = require('../mars/src/adapters/fs-workspaces');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm18-demo-'));
const projectRoot = path.join(tmp, 'ws');
const workRoot = path.join(tmp, 'work');
fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'base.txt'), 'base\n', 'utf8');
fs.writeFileSync(path.join(projectRoot, 'src', 'sum.js'), 'module.exports = { sum: (a, b) => a - b };\n', 'utf8');
fs.writeFileSync(path.join(projectRoot, 'test', 'sum.test.js'), [
  "'use strict';",
  "const { test } = require('node:test');",
  "const assert = require('node:assert/strict');",
  "const { sum } = require('../src/sum');",
  "test('sum adds', () => assert.equal(sum(1, 2), 3));",
  ''
].join('\n'), 'utf8');

const db = openDb(path.join(tmp, 'mars.db'));
const now = new Date().toISOString();
db.prepare(`INSERT INTO projects (project_id, display_name, owner_principal, share_policy, created_at, root_path, status, config_json, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run('demo', 'M18 Demo', 'demo', 'deny', now, projectRoot, 'active', '{}', now);

function agent(id, role, turns, writable) {
  return runtime.createAgent(db, {
    project_id: 'demo', role_id: role, agent_id: id, name: id,
    provider: 'mock', model: 'mock-1', mock: { turns }, notes: writable ? 'writable_paths=' + writable.join(',') : null
  }, { providers: ['mock'] });
}

agent('r1', 'R1', [
  { text: '写设计', toolCalls: [{ name: 'write_file', args: { path: 'DESIGN.md', content: '# Design\nsum should add.\n' } }] },
  { text: '设计完成' }
]);
agent('r2', 'R2', [
  { text: '实现', delayMs: 260, asyncDelay: true, toolCalls: [{ name: 'write_file', args: { path: 'src/sum.js', content: 'module.exports = { sum: (a, b) => a + b };\n' } }] },
  { text: '实现完成' }
]);
agent('r3', 'R3', [
  { text: '验证', toolCalls: [{ name: 'run_test', args: { dir: 'test' } }] },
  { text: '验证完成' }
]);
agent('r4', 'R4', [
  { text: '审查', toolCalls: [{ name: 'read_file', args: { path: 'src/sum.js' } }] },
  { text: '审查通过' }
]);
agent('r5', 'R5', [
  { text: '研究', delayMs: 260, asyncDelay: true, toolCalls: [{ name: 'read_file', args: { path: 'base.txt' } }] },
  { text: '研究完成' }
]);
agent('r6', 'R6', [
  { text: '安全', delayMs: 320, asyncDelay: true, toolCalls: [{ name: 'read_file', args: { path: 'base.txt' } }] },
  { text: '安全完成' }
]);
agent('r0', 'R0', [
  { text: '汇总', toolCalls: [{ name: 'read_file', args: { path: 'DESIGN.md' } }] },
  { text: '汇总完成', toolCalls: [{ name: 'read_file', args: { path: 'src/sum.js' } }] },
  { text: '最终汇总：设计、实现、验证、审查均完成。' }
]);
agent('r2a', 'R2', [
  { text: '写 A', toolCalls: [{ name: 'write_file', args: { path: 'conflict.txt', content: 'A' } }] },
  { text: 'A 完成' }
]);
agent('r2b', 'R2', [
  { text: '写 B', toolCalls: [{ name: 'write_file', args: { path: 'conflict.txt', content: 'B' } }] },
  { text: 'B 完成' }
]);

function ctx() {
  return {
    db,
    workspace: createWorkspaceManager({ baseDir: workRoot }),
    providerFor: (name, a) => createMockProvider({ scriptByAgent: { [a.agent_id]: a.definition.mock.turns } }),
    toolExecutorFor: (root, options) => createFsToolExecutor({ root, ...options }),
    compilePacket: (input) => ({
      packet_id: 'pkt_' + Math.random().toString(16).slice(2, 10),
      tokens_estimated: 64 + String(input.task && input.task.text || '').length,
      sections: [{ id: 'sec_task', title: '任务', kind: 'task', content: String(input.task && input.task.text || ''), token_estimate: 64 }]
    })
  };
}

function job(key, agentId, role, extra = {}) {
  return { key, agent_id: agentId, role_id: role, title: key, task: key + ' task', deps: [], priority: 5, ...extra };
}

function usageOf(plan) {
  const rows = scheduler.listJobs(db, plan.plan_id).filter((j) => j.run_id);
  const bySource = { provider: 0, estimated: 0, unknown: 0 };
  let input = 0; let output = 0; let calls = 0;
  for (const j of rows) {
    const u = runtime.usageOfRun(db, j.run_id);
    input += u.input_tokens; output += u.output_tokens; calls += u.calls;
    for (const s of u.sources) bySource[s] = (bySource[s] || 0) + 1;
  }
  return { runs: rows.length, calls, input_tokens: input, output_tokens: output, by_source: bySource };
}

function overlapOf(plan) {
  const runs = scheduler.listJobs(db, plan.plan_id).filter((j) => j.run_id).map((j) => runtime.getRun(db, j.run_id));
  let pairs = 0;
  for (let i = 0; i < runs.length; i += 1) {
    for (let k = i + 1; k < runs.length; k += 1) {
      const a = runs[i]; const b = runs[k];
      if (Date.parse(a.started_at) < Date.parse(b.finished_at) && Date.parse(b.started_at) < Date.parse(a.finished_at)) pairs += 1;
    }
  }
  return { runs: runs.length, overlapping_pairs: pairs, times: runs.map((r) => ({ run_id: r.run_id, role: r.role_id, started_at: r.started_at, finished_at: r.finished_at })) };
}

async function runPlan(label, planInput) {
  const plan = scheduler.createPlan(db, planInput);
  const result = await scheduler.executePlan({ ...ctx(), plan });
  return {
    label, plan_id: plan.plan_id, mode: plan.mode, status: result.plan.status,
    merge_status: result.plan.merge_status,
    max_concurrency: plan.max_concurrency,
    jobs: result.jobs.map((j) => ({ key: j.job_key, role: j.role_id, status: j.status, error: j.error_code, run_id: j.run_id, attempt: j.attempt, workspace: j.workspace })),
    tool_events: result.jobs.map((j) => ({
      key: j.job_key,
      events: j.run_id ? runtime.trace(db, j.run_id).filter((e) => e.kind === 'TOOL').map((e) => ({ tool: e.payload.tool, allowed: e.payload.allowed, ok: e.payload.ok, error: e.payload.error_code, meta: e.payload.meta })) : []
    })),
    usage: usageOf(result.plan),
    overlap: overlapOf(result.plan)
  };
}

(async () => {
  const out = { demo: 'm18', generated_at: new Date().toISOString(), simulated_models: true, note: '模型为 mock；文件、测试、会话、调度、锁、合并为真实执行' };

  out.serial = await runPlan('serial', {
    project_id: 'demo', base_root: projectRoot, mode: 'serial', workspace_mode: 'shared', max_concurrency: 1,
    jobs: [
      job('design', 'r1', 'R1', { deps: [], priority: 10, writable_paths: ['DESIGN.md'] }),
      job('impl', 'r2', 'R2', { deps: ['design'], priority: 8, writable_paths: ['src/**'] }),
      job('verify', 'r3', 'R3', { deps: ['impl'], priority: 8 })
    ]
  });

  out.parallel = await runPlan('parallel', {
    project_id: 'demo', base_root: projectRoot, mode: 'parallel', workspace_mode: 'copy', max_concurrency: 3, auto_merge: true,
    jobs: [
      job('research', 'r5', 'R5', { isolation: 'copy', priority: 5 }),
      job('security', 'r6', 'R6', { isolation: 'copy', priority: 5 }),
      job('write', 'r2', 'R2', { isolation: 'copy', priority: 5, writable_paths: ['parallel.txt'] })
    ]
  });

  out.hybrid = await runPlan('hybrid', {
    project_id: 'demo', base_root: projectRoot, mode: 'hybrid', workspace_mode: 'copy', max_concurrency: 3, auto_merge: true,
    jobs: [
      job('arch', 'r1', 'R1', { isolation: 'shared', priority: 10, writable_paths: ['DESIGN.md'] }),
      job('impl', 'r2', 'R2', { deps: ['arch'], isolation: 'copy', priority: 8, writable_paths: ['src/**'] }),
      job('research', 'r5', 'R5', { deps: ['arch'], isolation: 'copy', priority: 5 }),
      job('security', 'r6', 'R6', { deps: ['arch'], isolation: 'copy', priority: 5 }),
      job('verify', 'r3', 'R3', { deps: ['impl', 'research', 'security'], isolation: 'shared', priority: 9 }),
      job('review', 'r4', 'R4', { deps: ['verify'], isolation: 'shared', priority: 9 }),
      job('summary', 'r0', 'R0', { deps: ['review'], isolation: 'shared', priority: 10 })
    ]
  });

  out.conflict = await runPlan('conflict', {
    project_id: 'demo', base_root: projectRoot, mode: 'parallel', workspace_mode: 'copy', max_concurrency: 2, auto_merge: true,
    jobs: [
      job('a', 'r2a', 'R2', { isolation: 'copy', writable_paths: ['conflict.txt'] }),
      job('b', 'r2b', 'R2', { isolation: 'copy', writable_paths: ['conflict.txt'] })
    ]
  });

  // 恢复：造一个 RUNNING 且心跳陈旧的 job，再调用 recover。
  const recPlan = scheduler.createPlan(db, {
    project_id: 'demo', base_root: projectRoot, mode: 'serial', workspace_mode: 'shared',
    jobs: [job('recover', 'r2', 'R2', { max_attempts: 2 })]
  });
  const recJob = scheduler.listJobs(db, recPlan.plan_id)[0];
  const { run } = runtime.startRun(db, { agent_id: 'r2', project_id: 'demo' });
  db.prepare("UPDATE agent_runs SET status='RUNNING', heartbeat_at='2000-01-01T00:00:00.000Z' WHERE run_id=?").run(run.run_id);
  db.prepare("UPDATE orchestration_jobs SET status='RUNNING', run_id=?, attempt=1 WHERE job_id=?").run(run.run_id, recJob.job_id);
  const rec = scheduler.recoverPlan(db, recPlan.plan_id, { staleMs: 1000 });
  out.recovery = { plan_id: recPlan.plan_id, recovered: rec.recovered, job: scheduler.getJob(db, recJob.job_id), run: runtime.getRun(db, run.run_id) };

  // 关键文件摘要
  out.files = {
    design: fs.existsSync(path.join(projectRoot, 'DESIGN.md')),
    sum: fs.readFileSync(path.join(projectRoot, 'src', 'sum.js'), 'utf8').trim(),
    test: fs.readFileSync(path.join(projectRoot, 'test', 'sum.test.js'), 'utf8').split('\n')[4]
  };
  out.db = path.join(tmp, 'mars.db');
  out.workspace = projectRoot;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
