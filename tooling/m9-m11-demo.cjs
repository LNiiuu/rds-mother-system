#!/usr/bin/env node
'use strict';
// M9–M11 双项目 + 模拟多角色演示。
//
// 说明：角色由**同一个进程按顺序模拟**，不是真实的多 Agent 模型协作。
// 输出里 simulated=true，任何引用这份结果的地方都必须保留这个标记。
//
// 用法：node tooling/m9-m11-demo.mjs [--json]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../mars/src/composition');
const projects = require('../mars/src/projects');
const collab = require('../mars/src/collab');
const contextOps = require('../mars/src/context-ops');
const store = require('../mars/src/store');
const { compileContext } = require('../mars/src/compiler');


function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm9m11-demo-'));
  const dbPath = path.join(base, 'mars.db');
  const runtime = createRuntime({ argv: { db: dbPath } });
  const db = runtime.openDb(dbPath);
  const assets = runtime.assets;
  const routing = runtime.routing;

  const principal = {
    principal_id: 'demo-r0',
    project_ids: ['proj-a', 'proj-b'],
    roles: ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'],
  };

  const rootA = path.join(base, 'proj-a');
  const rootB = path.join(base, 'proj-b');
  fs.mkdirSync(rootA);
  fs.mkdirSync(rootB);

  const out = { simulated: true, note: '角色由同一进程顺序模拟，不是真实多模型协作', steps: [] };

  // M9：两个项目
  const a = projects.create(db, principal, { project_id: 'proj-a', name: '项目 A', root: rootA }, { resolveRoot: runtime.projectRoots.resolveRoot });
  const b = projects.create(db, principal, { project_id: 'proj-b', name: '项目 B', root: rootB }, { resolveRoot: runtime.projectRoots.resolveRoot });
  out.steps.push({ step: 'project.create', a: a.project_id, b: b.project_id });

  // 各自写一条决策并审批（同身份不能自审，这里用 R4 角色身份模拟另一个主体）
  const r4 = { principal_id: 'demo-r4', project_ids: ['proj-a', 'proj-b'], roles: ['R4'] };
  const memA = store.propose(db, principal, {
    project_id: 'proj-a', memory_type: 'L3', content: 'A 项目专属决策：导出用 stream',
    source_ref: 'a.md', source_version: 'v1', role_id: 'R0',
  }, { assets, routing });
  store.review(db, r4, 'R4', 'proj-a', memA.memory_id, 'approved', 'demo');
  const memB = store.propose(db, principal, {
    project_id: 'proj-b', memory_type: 'L3', content: 'B 项目专属决策：导出用 buffer',
    source_ref: 'b.md', source_version: 'v1', role_id: 'R0',
  }, { assets, routing });
  store.review(db, r4, 'R4', 'proj-b', memB.memory_id, 'approved', 'demo');

  const textA = '任务正文：为 A 项目实现导出。'.padEnd(300, '规');
  const textB = '任务正文：为 B 项目实现导出。'.padEnd(300, '矩');

  const pktA = compileContext(db, principal, routing, {
    project_id: 'proj-a', task_id: 'A-1', role_id: 'R0', budget: 4000,
    task: { id: 'A-1', text: textA }, assets,
  });
  const pktB = compileContext(db, principal, routing, {
    project_id: 'proj-b', task_id: 'B-1', role_id: 'R0', budget: 4000,
    task: { id: 'B-1', text: textB }, assets,
  });
  const textOf = (p) => p.packet.sections.map((s) => s.content).join('\n');
  out.steps.push({
    step: 'context.compile.isolation',
    a_tokens: pktA.packet.tokens_estimated,
    b_tokens: pktB.packet.tokens_estimated,
    a_has_a: textOf(pktA).includes('A 项目专属决策'),
    a_has_b: textOf(pktA).includes('B 项目专属决策'),
    b_has_b: textOf(pktB).includes('B 项目专属决策'),
    b_has_a: textOf(pktB).includes('A 项目专属决策'),
  });

  // M10：超预算自动压缩 + 恢复
  const evidence = Array.from({ length: 80 }, (_, i) => ({ ref: `evidence/ref-${i}.md`, kind: 'file' }));
  const compressed = compileContext(db, principal, routing, {
    project_id: 'proj-a', task_id: 'A-2', role_id: 'R0', budget: 850,
    task: { id: 'A-2', text: textA }, evidence, assets,
    autoCompress: true, model: 'generic-32k',
  });
  const restored = compressed.compression && compressed.compression.compression_id
    ? contextOps.restore(db, compressed.compression.compression_id)
    : null;
  out.steps.push({
    step: 'context.compress',
    before_tokens: compressed.compression ? compressed.compression.before_tokens : null,
    after_tokens: compressed.compression ? compressed.compression.after_tokens : null,
    validation: compressed.compression ? compressed.compression.validation_status : 'NOT_TRIGGERED',
    restored_sections: restored ? restored.sections.length : 0,
    restored_hash_ok: Boolean(restored), // contextOps.restore 内部已校验 original_hash，失败会抛错
  });

  // M11：任务拆分 + 状态机 + 交接 + 成本
  const plan = collab.planTasks(db, { project_id: 'proj-a', objective: '实现导出功能并补测试', actor: 'demo-r0' });
  const impl = plan.tasks.find((t) => t.assigned_role === 'R2');
  const verify = plan.tasks.find((t) => t.assigned_role === 'R3');
  collab.assign(db, impl.task_id, { role: 'R2', agent: 'sim-r2', actor: 'demo-r0' });
  collab.transition(db, impl.task_id, 'RUNNING', 'sim-r2');
  collab.transition(db, impl.task_id, 'REVIEW_PENDING', 'sim-r2', '实现完成');
  collab.transition(db, impl.task_id, 'VERIFICATION_PENDING', 'sim-r3');
  collab.complete(db, impl.task_id, { evidence: ['test:unit', 'file:export.js'], actor: 'sim-r3' });

  const summary = collab.buildHandoffSummary(db, collab.getTask(db, verify.task_id));
  const handoffPacket = compileContext(db, principal, routing, {
    project_id: 'proj-a', task_id: verify.task_id, role_id: 'R3', budget: 4000,
    task: { id: verify.task_id, text: `交接给 R3\n${verify.title}` },
    state: JSON.stringify(summary), assets,
  });
  collab.saveHandoff(db, { task: verify, toRole: 'R3', fromRole: 'R2', packetId: handoffPacket.packet.packet_id, summary });

  collab.recordCost(db, { project_id: 'proj-a', task_id: impl.task_id, agent_id: 'sim-r2', model: 'generic-128k', input_tokens: 1200, output_tokens: 300, usage_source: 'estimated' });
  collab.recordCost(db, { project_id: 'proj-a', task_id: verify.task_id, agent_id: 'sim-r3', model: 'generic-128k', input_tokens: 600, output_tokens: 120, usage_source: 'estimated' });
  const cost = collab.costReport(db, { project_id: 'proj-a' });

  out.steps.push({
    step: 'task.plan',
    parent: plan.parent.task_id,
    roles: plan.tasks.map((t) => t.assigned_role),
    needs_review: plan.needs_review,
  });
  out.steps.push({ step: 'task.state_machine', status: collab.getTask(db, impl.task_id).status, events: collab.events(db, impl.task_id).length });
  out.steps.push({ step: 'handoff', to_role: 'R3', packet: handoffPacket.packet.packet_id, tokens: handoffPacket.packet.tokens_estimated });
  out.steps.push({ step: 'cost.report', rows: cost.rows, input: cost.total.input, top_task: cost.top_task.task_id });

  // 审计链与项目隔离的最终抽查
  const auditCount = db.prepare('SELECT count(*) AS n FROM audit').get().n;
  out.steps.push({ step: 'audit', entries: auditCount });
  out.steps.push({
    step: 'isolation.final',
    a_memories: db.prepare('SELECT count(*) AS n FROM memories WHERE project_id = ?').get('proj-a').n,
    b_memories: db.prepare('SELECT count(*) AS n FROM memories WHERE project_id = ?').get('proj-b').n,
    tasks_in_b: db.prepare('SELECT count(*) AS n FROM tasks WHERE project_id = ?').get('proj-b').n,
  });

  out.ok = out.steps.every((s) => {
    if (s.step === 'context.compile.isolation') return s.a_has_a && !s.a_has_b && s.b_has_b && !s.b_has_a;
    if (s.step === 'task.plan') return s.roles.includes('R2') && s.roles.includes('R3') && s.needs_review === false;
    if (s.step === 'task.state_machine') return s.status === 'COMPLETED';
    if (s.step === 'isolation.final') return s.tasks_in_b === 0;
    return true;
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('M9–M11 演示（角色为模拟执行，simulated=true）');
    for (const step of out.steps) console.log('  ' + JSON.stringify(step));
    console.log(out.ok ? 'DEMO PASS' : 'DEMO FAIL');
  }
  return out.ok ? 0 : 1;
}

process.exitCode = main();
