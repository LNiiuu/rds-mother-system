#!/usr/bin/env node
'use strict';
// M15 联合协作演示：REA 分析 → 审核 → 交给研发 Agent 重构。
//
// 两个案例：
//   A. 逆向分析：对 where.exe 跑 W-02（结构/导入/字符串）+ W-04（调用图），
//      由 R4 审核证据，产出「已审核的逆向结论」。
//   B. 分析后重构：把经过审核的结论作为上下文交给 R1 → R2 → R3 → R4 链，
//      在真实工作区改代码并跑测试。
//
// 诚实边界：
//   - 模型是确定性 mock（provider=mock，usage_source=estimated）
//   - W-02/W-04 的工具执行、样本哈希、调用图、测试结果是真实的
//   - 「重构」这一步是脚本化的：R2 写的文件内容是预置的，不是模型生成的
//
// 用法：node tooling/m15-joint-demo.cjs [--json]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../mars/src/composition');
const projects = require('../mars/src/projects');
const runtime = require('../mars/src/runtime/agent-runtime');
const { executeChain } = require('../mars/src/runtime/chain');
const { createFsToolExecutor } = require('../mars/src/adapters/fs-tool-executor');
const { compileContext } = require('../mars/src/compiler');
const taskTypes = require('../mars/src/runtime/task-types');

const SAMPLE = process.platform === 'win32'
  ? 'C:/Windows/System32/where.exe'
  : '/bin/ls';

const SEED = [
  "'use strict';",
  '// 旧实现：把参数直接拼进命令字符串（重构目标）',
  'function buildCommand(tool, args) {',
  "  return tool + ' ' + args.join(' ');",
  '}',
  'module.exports = { buildCommand };',
  ''
].join('\n');

const SEED_TEST = [
  "'use strict';",
  "const { test } = require('node:test');",
  "const assert = require('node:assert');",
  "const { buildCommand } = require('../src/cmd.js');",
  '',
  "test('参数原样拼接（现有行为）', () => {",
  "  assert.equal(buildCommand('where', ['a', 'b']), 'where a b');",
  '});',
  ''
].join('\n');

const FIXED = [
  "'use strict';",
  '// 重构后：逐个转义并用数组返回，避免拼接注入',
  'function quote(a) {',
  "  const s = String(a);",
  "  if (/^[A-Za-z0-9_./:=@-]+$/.test(s)) return s;",
  '  return \'"\' + s.replace(/"/g, \'\\\\"\') + \'"\';',
  '}',
  'function buildCommand(tool, args) {',
  '  return [quote(tool)].concat(args.map(quote)).join(\' \');',
  '}',
  'module.exports = { buildCommand };',
  ''
].join('\n');

const DESIGN = [
  '# 重构设计：buildCommand',
  '',
  '## 输入（来自已审核的 W-02/W-04 结论）',
  '- W-02：样本为 PE x86-64，导入 KERNEL32/USER32 等；字符串中出现路径与模块名，说明该工具处理外部输入。',
  '- W-04：调用图存在大量间接调用（IAT），说明实际行为依赖运行时绑定。',
  '- 结论：外部输入进入命令拼接属于高风险面，应改为逐个转义。',
  '',
  '## 方案',
  '1. 增加 quote()：安全字符集原样返回，其余加双引号并转义内部双引号。',
  '2. buildCommand 对工具名与每个参数都做 quote。',
  '3. 保持返回 string 的对外形状不变。',
  '',
  '## 验收',
  '- 现有测试不变且通过。',
  '- 含空格/引号的参数不再原样拼接。',
  ''
].join('\n');

const SCRIPTS = {
  review: [
    { text: '读取分析证据', toolCalls: [{ name: 'read_file', args: { path: 'rea/SUMMARY.md' } }] },
    { text: '审核通过：W-02 的结构事实与 W-04 的调用图都带样本哈希与工具版本，结论限定在"外部输入进入命令拼接属高风险"，未超出证据范围。', usage: { input: 420, output: 90 } }
  ],
  R1: [
    { text: '写设计', toolCalls: [{ name: 'write_file', args: { path: 'DESIGN.md', content: DESIGN } }] },
    { text: '设计完成：基于已审核的逆向结论，改用逐参数转义，对外返回形状不变。', usage: { input: 700, output: 120 } }
  ],
  R2: [
    { text: '按设计改实现', toolCalls: [{ name: 'write_file', args: { path: 'src/cmd.js', content: FIXED } }] },
    { text: '实现完成：src/cmd.js 增加 quote()，buildCommand 对工具名与参数逐个转义。', usage: { input: 640, output: 130 } }
  ],
  R3: [
    { text: '跑测试', toolCalls: [{ name: 'run_test', args: { dir: 'test' } }] },
    { text: '验证完成：test/cmd.test.js 全部通过，详见 trace 的 run_test meta。', usage: { input: 380, output: 70 } }
  ],
  R4: [
    { text: '复核实现', toolCalls: [{ name: 'read_file', args: { path: 'src/cmd.js' } }] },
    { text: '评审通过：转义逻辑与设计一致，对外形状未变，测试通过。', usage: { input: 300, output: 60 } }
  ]
};

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm15-joint-'));
  const dbPath = path.join(base, 'mars.db');
  const root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rea'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'cmd.js'), SEED);
  fs.writeFileSync(path.join(root, 'test', 'cmd.test.js'), SEED_TEST);

  const rt = createRuntime({ argv: { db: dbPath } });
  const db = rt.openDb(dbPath);
  const principal = { principal_id: 'demo-r0', project_ids: ['joint'], roles: ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'] };
  projects.create(db, principal, { project_id: 'joint', name: '联合演示', root }, { resolveRoot: rt.projectRoots.resolveRoot });

  const compilePacket = (input) => compileContext(db, principal, rt.routing, {
    project_id: input.project_id,
    task_id: input.task_id || 'T-UNKNOWN',
    role_id: input.role_id,
    budget: input.budget,
    task: input.task,
    objective: input.objective,
    assets: rt.assets
  }).packet;

  const out = {
    demo: 'm15-joint',
    simulated_models: true,
    note: '模型是确定性 mock；REA 工具执行、样本哈希、调用图、测试结果均为真实',
    sample: SAMPLE,
    case_a: null,
    case_b: null
  };

  // ---------------- 案例 A：逆向分析 ----------------
  const planA = taskTypes.planByType(db, {
    project_id: 'joint', task_type: 'binary_analysis',
    objective: '分析目标样本的导入与调用链，评估命令拼接风险', actor: 'demo-r0'
  });

  const w02 = await rt.rea.run(db, {
    workflow_id: 'W-02', input: { sample: SAMPLE, max_strings: 50 }, evidenceBase: path.join(base, 'rea')
  });
  const w04 = await rt.rea.run(db, {
    workflow_id: 'W-04', input: { sample: SAMPLE, depth: 3 }, evidenceBase: path.join(base, 'rea')
  });

  // 证据摘要写给审核 Agent（最小必要上下文，不贴原始 JSON）
  const summaryPath = path.join(root, 'rea', 'SUMMARY.md');
  fs.writeFileSync(summaryPath, [
    '# 逆向分析证据摘要',
    '',
    `- 样本：${SAMPLE}`,
    `- SHA-256：${w02.sample ? w02.sample.sha256 : 'n/a'}`,
    `- W-02 状态：${w02.status}（${w02.result.graph ? '' : ''}${w02.preflight && w02.preflight.blocked_reason ? w02.preflight.blocked_reason : 'ok'}）`,
    `- W-04 状态：${w04.status}`,
    `- W-02 证据目录：${w02.evidence_dir}`,
    `- W-04 证据目录：${w04.evidence_dir}`,
    '',
    '## 事实（工具直接观察）',
    `- 格式：${w02.result && w02.result.file ? w02.result.file.format : '?'} / ${w02.result && w02.result.file ? w02.result.file.architecture : '?'}`,
    `- 导入库：${w02.result && w02.result.imports ? w02.result.imports.map((i) => i.library).join(', ') : '?'}`,
    `- 调用图：${w04.result && w04.result.graph ? `${w04.result.graph.functions} 个推断函数 / ${w04.result.graph.direct_edges} 条直接边 / ${w04.result.graph.indirect_call_sites} 个间接调用点` : '?'}`,
    '',
    '## 推断（需人工确认）',
    '- 外部输入进入命令拼接属于高风险面（基于导入表与字符串推断，未做动态验证）'
  ].join('\n') + '\n', 'utf8');

  const reviewer = runtime.createAgent(db, {
    project_id: 'joint', role_id: 'R4', name: 'evidence-reviewer', provider: 'mock', model: 'mock-1',
    tools: ['read_file'], mock: { turns: SCRIPTS.review }
  }, { providers: rt.providerNames });

  const reviewRun = runtime.startRun(db, {
    agent_id: reviewer.agent_id, project_id: 'joint', task_id: planA.tasks[1].task_id,
    objective: '审核逆向分析证据是否支撑结论'
  });
  const reviewResult = await runtime.executeRun({
    db, run: reviewRun.run, agent: reviewer,
    provider: rt.providerFor('mock', reviewer),
    executor: createFsToolExecutor({ root }),
    packet: compilePacket({
      project_id: 'joint', task_id: planA.tasks[1].task_id, role_id: 'R4',
      task: { id: planA.tasks[1].task_id, text: '审核 W-02/W-04 的结论是否超出证据范围。', objective: '证据审核' }
    })
  });

  out.case_a = {
    task_type: planA.task_type,
    tasks: planA.tasks,
    workflows: [w02, w04].map((w) => ({
      rea_run_id: w.rea_run_id, workflow_id: w.workflow_id, status: w.status,
      sample_sha256: w.sample ? w.sample.sha256 : null,
      evidence_dir: w.evidence_dir,
      tool_versions: w.tool_versions,
      limitations: w.limitations
    })),
    review: {
      run_id: reviewResult.run.run_id,
      status: reviewResult.run.status,
      verdict: reviewResult.output.text,
      reviewed: reviewResult.run.status === 'SUCCEEDED'
    },
    evidence_summary: summaryPath
  };

  // ---------------- 案例 B：分析后重构 ----------------
  const planB = taskTypes.planByType(db, {
    project_id: 'joint', task_type: 'development',
    objective: '依据已审核的逆向结论重构 buildCommand', actor: 'demo-r0'
  });

  const agents = ['R1', 'R2', 'R3', 'R4'].map((role) => runtime.createAgent(db, {
    project_id: 'joint', role_id: role, name: role + '-joint', provider: 'mock', model: 'mock-1',
    mock: { turns: SCRIPTS[role] }
  }, { providers: rt.providerNames }));

  const executor = createFsToolExecutor({ root });
  const before = await executor.invoke('run_test', { dir: 'test' });

  const chain = await executeChain({
    db, agents,
    objective: planB.parent.title,
    taskId: planB.parent.task_id,
    initialPacket: compilePacket({
      project_id: 'joint', task_id: planB.parent.task_id, role_id: 'R1',
      task: {
        id: planB.parent.task_id,
        text: [
          '任务：重构 buildCommand，避免参数直接拼接。',
          '',
          '## 已审核的逆向结论（来自案例 A，R4 已复核）',
          `- 样本 ${SAMPLE}（SHA-256 ${w02.sample ? w02.sample.sha256.slice(0, 16) : '?'}…）`,
          '- 结论：外部输入进入命令拼接属高风险面，应逐个转义。',
          `- 证据目录：${w02.evidence_dir} / ${w04.evidence_dir}`,
          '',
          '## 约束',
          '- 对外返回形状不变（仍是 string）。',
          '- 不得修改 test/cmd.test.js。'
        ].join('\n'),
        objective: '重构 buildCommand'
      },
      objective: '重构 buildCommand'
    }),
    providerFor: (a) => rt.providerFor('mock', a),
    executor,
    compilePacket,
    budget: 6000
  });

  const after = await executor.invoke('run_test', { dir: 'test' });

  out.case_b = {
    task_type: planB.task_type,
    parent_task: planB.parent,
    tasks: planB.tasks,
    steps: chain.steps,
    handoffs: chain.handoffs,
    sessions_distinct: chain.sessions_distinct,
    tests_before: before.meta,
    tests_after: after.meta,
    refactor_effective: after.meta.fail === 0 && fs.readFileSync(path.join(root, 'src', 'cmd.js'), 'utf8').includes('quote')
  };

  out.usage = runtime.usageOfProject(db, 'joint');
  out.rea_runs = rt.rea.listRuns(db, { limit: 10 }).map((r) => ({ id: r.rea_run_id, wf: r.workflow_id, status: r.status }));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('M15 联合协作演示（REA → 审核 → 研发）');
    console.log('  案例 A：', out.case_a.workflows.map((w) => `${w.workflow_id}=${w.status}`).join(' '));
    console.log('  样本哈希：', out.case_a.workflows[0].sample_sha256);
    console.log('  审核：', out.case_a.review.status, '| reviewed =', out.case_a.review.reviewed);
    console.log('  案例 B：', out.case_b.steps.map((s) => `${s.role_id}:${s.status}`).join(' → '));
    console.log('  交接：', out.case_b.handoffs.length, '次 | 独立 session：', out.case_b.sessions_distinct);
    console.log('  测试 before：', JSON.stringify(out.case_b.tests_before));
    console.log('  测试 after ：', JSON.stringify(out.case_b.tests_after));
    console.log('  重构生效：', out.case_b.refactor_effective);
  }

  const ok = out.case_a.review.reviewed
    && out.case_a.workflows.every((w) => w.status === 'PARTIAL' || w.status === 'PASS')
    && out.case_b.steps.every((s) => s.status === 'SUCCEEDED')
    && out.case_b.refactor_effective
    && out.case_b.sessions_distinct;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('DEMO FAILED:', e.message);
  process.exit(1);
});
