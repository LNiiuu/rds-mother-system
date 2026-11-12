'use strict';
// M15：任务类型规则 + 研发与 REA 的联合流程。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('../phase1/helpers');
const taskTypes = require('../../src/runtime/task-types');
const registry = require('../../src/adapters/rea/registry');
const runtime = require('../../src/runtime/agent-runtime');
const { executeChain } = require('../../src/runtime/chain');
const { createFsToolExecutor } = require('../../src/adapters/fs-tool-executor');
const projects = require('../../src/projects');
const projectRoots = require('../../src/adapters/fs-project-roots');
const { buildPcap } = require('../../../tooling/make-pcap-fixture.cjs');

const deps = { resolveRoot: projectRoots.resolveRoot };

test('M15 任务类型：八种类型齐全，每种都声明角色链、工作流与证据要求', () => {
  const list = taskTypes.list();
  assert.equal(list.length, 8);
  assert.deepEqual(list.map((t) => t.task_type).sort(), [
    'apk_analysis', 'binary_analysis', 'callgraph_analysis', 'code_analysis',
    'development', 'dynamic_analysis', 'network_analysis', 'security_review'
  ]);
  for (const t of list) {
    assert.ok(Array.isArray(t.chain) && t.chain.length >= 1, t.task_type + ' 缺角色链');
    assert.ok(Array.isArray(t.workflows), t.task_type + ' 缺 workflows');
    assert.ok(Array.isArray(t.evidence_required), t.task_type + ' 缺证据要求');
    for (const r of t.chain) assert.match(r, /^R[0-7]$/, t.task_type + ' 角色名非法：' + r);
  }
  // 研发类不涉及 REA
  assert.deepEqual(taskTypes.get('development').workflows, []);
  assert.deepEqual(taskTypes.get('binary_analysis').workflows, ['W-02', 'W-04']);
});

test('M15 任务类型：工作流与类型不匹配时拒绝（不是警告，是抛错）', () => {
  assert.equal(taskTypes.assertWorkflowAllowed('binary_analysis', 'W-02'), true);
  assert.throws(() => taskTypes.assertWorkflowAllowed('binary_analysis', 'W-05'), /WORKFLOW_NOT_IN_TASK_TYPE/);
  assert.throws(() => taskTypes.assertWorkflowAllowed('development', 'W-02'), /TASK_TYPE_NO_WORKFLOW/);
  assert.throws(() => taskTypes.get('nope'), /TASK_TYPE_UNKNOWN/);
});

test('M15 任务类型：关键词只给建议，不决定流程', () => {
  assert.equal(taskTypes.suggest('实现导出功能并补测试').suggested, 'development');
  assert.equal(taskTypes.suggest('分析这个 pcap 的流量').suggested, 'network_analysis');
  assert.equal(taskTypes.suggest('反编译这个二进制样本').suggested, 'binary_analysis');
  const s = taskTypes.suggest('随便做点什么');
  assert.ok(s.reason, '必须说明依据');
});

test('M15 证据要求：缺项要明确列出，不默认通过', () => {
  const ok = taskTypes.checkEvidence('network_analysis', { rea_report: 'x', sample_hash: 'y' });
  assert.equal(ok.ok, true);
  const bad = taskTypes.checkEvidence('binary_analysis', { rea_report: 'x' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing.sort(), ['sample_hash', 'tool_version']);
});

test('M15 角色归属：链外角色被拒，R0 可协调', () => {
  assert.equal(taskTypes.assertRoleCanOwn('binary_analysis', 'R5').ok, true);
  assert.equal(taskTypes.assertRoleCanOwn('binary_analysis', 'R0').ok, true);
  assert.equal(taskTypes.assertRoleCanOwn('binary_analysis', 'R2').ok, false);
  assert.equal(taskTypes.assertRoleCanOwn('development', 'R2').ok, true);
});

test('M15 按类型建任务：父任务 + 角色链子任务，角色与顺序都来自类型声明', () => {
  const env = setup('m15-plan-');
  const p = taskTypes.planByType(env.db, {
    project_id: 'p1', task_type: 'binary_analysis', objective: '分析样本', actor: 'pid-r0'
  });
  assert.equal(p.chain.join(','), 'R5,R4');
  assert.equal(p.tasks.length, 2);
  assert.deepEqual(p.tasks.map((t) => t.assigned_role), ['R5', 'R4']);
  assert.equal(p.tasks[0].status, 'PLANNED');
  const rows = env.db.prepare('SELECT count(*) c FROM tasks WHERE parent_task_id = ?').get(p.parent.task_id);
  assert.equal(rows.c, 2);
  // 每个子任务都有自己的事件
  const ev = env.db.prepare('SELECT count(*) c FROM task_events').get();
  assert.ok(ev.c >= 3, '父任务 + 两个子任务都应写事件');
});

test('M15 联合流程：REA 分析 → R4 审核 → 研发链落地，测试由红转绿', async () => {
  const env = setup('m15-joint-');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm15-joint-ws-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'm.js'), 'module.exports = { n: () => 1 };\n');
  fs.writeFileSync(path.join(root, 'test', 'm.test.js'), [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "const { n } = require('../src/m.js');",
    "test('n 返回 2', () => { assert.equal(n(), 2); });"
  ].join('\n'));

  projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'P1', root, policy: 'default' }, deps);

  // —— REA：用合成 pcap，跨平台可跑，不依赖 objdump
  const pcap = path.join(root, 'flow.pcap');
  fs.writeFileSync(pcap, buildPcap());
  const rea = await registry.run(env.db, {
    workflow_id: 'W-05', input: { sample: pcap, sample_kind: 'synthetic' }, evidenceBase: path.join(root, 'ev')
  });
  assert.equal(rea.status, 'PARTIAL');
  assert.ok(rea.sample.sha256);

  // —— 证据摘要（交给审核 Agent 的最小上下文）
  const summary = path.join(root, 'SUMMARY.md');
  fs.writeFileSync(summary, `# 证据\n- sha256: ${rea.sample.sha256}\n- 包数: ${rea.result.packets}\n`);

  const reviewer = runtime.createAgent(env.db, {
    project_id: 'p1', role_id: 'R4', name: 'reviewer', provider: 'mock',
    tools: ['read_file'],
    mock: { turns: [
      { text: '读证据', toolCalls: [{ name: 'read_file', args: { path: 'SUMMARY.md' } }] },
      { text: '审核通过：结论与证据一致', usage: { input: 100, output: 20 } }
    ] }
  }, { providers: ['mock'] });

  const reviewRun = runtime.startRun(env.db, { agent_id: reviewer.agent_id, project_id: 'p1' });
  const review = await runtime.executeRun({
    db: env.db, run: reviewRun.run, agent: reviewer,
    provider: require('../../src/adapters/provider-mock').createMockProvider({
      scriptByAgent: { [reviewer.agent_id]: reviewer.definition.mock.turns }
    }),
    executor: createFsToolExecutor({ root })
  });
  assert.equal(review.run.status, 'SUCCEEDED');
  assert.match(review.output.text, /审核通过/);

  // —— 研发链：R2 修实现，R3 跑测试
  const r2 = runtime.createAgent(env.db, {
    project_id: 'p1', role_id: 'R2', name: 'impl', provider: 'mock',
    mock: { turns: [
      { text: '修实现', toolCalls: [{ name: 'write_file', args: { path: 'src/m.js', content: 'module.exports = { n: () => 2 };\n' } }] },
      { text: '实现完成：n 返回 2', usage: { input: 200, output: 40 } }
    ] }
  }, { providers: ['mock'] });
  const r3 = runtime.createAgent(env.db, {
    project_id: 'p1', role_id: 'R3', name: 'verify', provider: 'mock',
    mock: { turns: [
      { text: '跑测试', toolCalls: [{ name: 'run_test', args: { dir: 'test' } }] },
      { text: '测试通过', usage: { input: 120, output: 30 } }
    ] }
  }, { providers: ['mock'] });

  const executor = createFsToolExecutor({ root });
  const before = await executor.invoke('run_test', { dir: 'test' });
  assert.equal(before.meta.fail, 1, '起点应当是失败的');

  const chain = await executeChain({
    db: env.db, agents: [r2, r3], objective: '让 n 返回 2', taskId: 'T-JOINT',
    initialPacket: null,
    providerFor: (a) => require('../../src/adapters/provider-mock').createMockProvider({
      scriptByAgent: { [a.agent_id]: a.definition.mock.turns }
    }),
    executor
  });

  assert.equal(chain.steps.length, 2);
  assert.ok(chain.steps.every((s) => s.status === 'SUCCEEDED'));
  assert.equal(chain.sessions_distinct, true);
  assert.equal(chain.handoffs.length, 1);

  const after = await executor.invoke('run_test', { dir: 'test' });
  assert.equal(after.meta.fail, 0, '改完应当通过');
  assert.equal(after.meta.pass, 1);

  // 审计链：两个 run 的事件都在，且握手（HANDOFF_IN/OUT）有记录
  const outEvents = runtime.trace(env.db, chain.steps[0].run_id).filter((e) => e.kind === 'HANDOFF_OUT');
  const inEvents = runtime.trace(env.db, chain.steps[1].run_id).filter((e) => e.kind === 'HANDOFF_IN');
  assert.equal(outEvents.length, 1);
  assert.equal(inEvents.length, 1);
  assert.equal(inEvents[0].payload.handoff_id, outEvents[0].payload.handoff_id);
});
