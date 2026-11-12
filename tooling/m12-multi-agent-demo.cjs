#!/usr/bin/env node
'use strict';
// M12 多 Agent 交接链演示（真实执行层 + 确定性 mock 模型）。
//
// 必须说清楚它证明了什么、没证明什么：
//   证明了：每个 Agent 有独立的 session / run / 权限 / 上下文；
//           交接由系统自动完成，交接包是重新编译的，不是复制聊天记录；
//           工具调用真的落到磁盘，测试真的被执行；
//           trace 能把每一步追回来。
//   没证明：模型智能。provider=mock，用量是 estimated，不是真实模型调用。
//
// 用法：node tooling/m12-multi-agent-demo.cjs [--json]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime } = require('../mars/src/composition');
const projects = require('../mars/src/projects');
const runtime = require('../mars/src/runtime/agent-runtime');
const { executeChain } = require('../mars/src/runtime/chain');
const { createFsToolExecutor } = require('../mars/src/adapters/fs-tool-executor');
const { compileContext } = require('../mars/src/compiler');
const { listHandoffsOfTask } = require('../mars/src/runtime/handoff');

const SEED_SUM = [
  "'use strict';",
  '// 故意写错：减法。链上的 R2 要把它改成加法。',
  'function sum(a, b) { return a - b; }',
  'module.exports = { sum };',
  ''
].join('\n');

const SEED_TEST = [
  "'use strict';",
  "const { test } = require('node:test');",
  "const assert = require('node:assert');",
  "const { sum } = require('../src/sum.js');",
  '',
  "test('sum 返回两数之和', () => { assert.equal(sum(2, 3), 5); });",
  ''
].join('\n');

const FIXED_SUM = [
  "'use strict';",
  '// 修正：返回和。导出形状保持不变。',
  'function sum(a, b) { return a + b; }',
  'module.exports = { sum };',
  ''
].join('\n');

const DESIGN = [
  '# 设计：修复 sum',
  '',
  '## 结论',
  '- `sum(a, b)` 必须返回 `a + b`。',
  '- 导出形状保持 `module.exports = { sum }`，不改成 ESM，避免破坏调用方。',
  '',
  '## 约束',
  '- 只改 `src/sum.js` 的实现，不改测试。',
  '## 验收',
  '- `test/sum.test.js` 通过。',
  ''
].join('\n');

const SCRIPTS = {
  R1: [
    { text: '写下设计文档', toolCalls: [{ name: 'write_file', args: { path: 'DESIGN.md', content: DESIGN } }] },
    { text: '设计完成：sum 改为加法，保持 CommonJS 导出不变，只改 src/sum.js。', usage: { input: 420, output: 90 } }
  ],
  R2: [
    { text: '按设计修改实现', toolCalls: [{ name: 'write_file', args: { path: 'src/sum.js', content: FIXED_SUM } }] },
    { text: '实现完成：src/sum.js 的 sum 已改为 a + b，导出未变。未运行测试（交给验证环节）。', usage: { input: 610, output: 110 } }
  ],
  R3: [
    { text: '运行测试', toolCalls: [{ name: 'run_test', args: { dir: 'test' } }] },
    { text: '验证完成：已执行 test/sum.test.js，具体通过/失败数以 trace 里的 run_test meta 为准。', usage: { input: 380, output: 70 } }
  ],
  R4: [
    { text: '复核实现', toolCalls: [{ name: 'read_file', args: { path: 'src/sum.js' } }] },
    { text: '复核设计', toolCalls: [{ name: 'read_file', args: { path: 'DESIGN.md' } }] },
    { text: '评审通过：实现与设计一致（a + b，CommonJS 导出），改动范围仅 src/sum.js。', usage: { input: 520, output: 80 } }
  ]
};

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm12-demo-'));
  const dbPath = path.join(base, 'mars.db');
  const root = path.join(base, 'ws');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'sum.js'), SEED_SUM);
  fs.writeFileSync(path.join(root, 'test', 'sum.test.js'), SEED_TEST);

  const rt = createRuntime({ argv: { db: dbPath } });
  const db = rt.openDb(dbPath);
  const principal = {
    principal_id: 'demo-r0',
    project_ids: ['demo'],
    roles: ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']
  };

  projects.create(db, principal, {
    project_id: 'demo', name: '多 Agent 演示', root
  }, { resolveRoot: rt.projectRoots.resolveRoot });

  const compilePacket = (input) => compileContext(db, principal, rt.routing, {
    project_id: input.project_id,
    task_id: input.task_id || 'T-UNKNOWN',
    role_id: input.role_id,
    budget: input.budget,
    task: input.task,
    objective: input.objective,
    assets: rt.assets
  }).packet;

  // 建 4 个 Agent，各自独立脚本
  const agents = [];
  for (const role of ['R1', 'R2', 'R3', 'R4']) {
    agents.push(runtime.createAgent(db, {
      project_id: 'demo',
      role_id: role,
      name: role + ' agent',
      provider: 'mock',
      model: 'mock-1',
      mock: { turns: SCRIPTS[role] }
    }, { providers: rt.providerNames }));
  }

  const executor = createFsToolExecutor({ root });
  const before = await executor.invoke('run_test', { dir: 'test' });

  const chain = await executeChain({
    db,
    agents,
    objective: '修复 sum 实现，使现有测试通过',
    taskId: 'T-SUM-1',
    initialPacket: compilePacket({
      project_id: 'demo', task_id: 'T-SUM-1', role_id: 'R1',
      task: {
        id: 'T-SUM-1',
        text: '任务：src/sum.js 当前返回差，应返回和；不得修改 test/sum.test.js。验收：该测试文件通过。',
        objective: '修复 sum 实现'
      },
      objective: '修复 sum 实现'
    }),
    providerFor: (a) => rt.providerFor(a.provider, a),
    executor,
    compilePacket,
    budget: 5000
  });

  const after = await executor.invoke('run_test', { dir: 'test' });
  const handoffs = listHandoffsOfTask(db, 'T-SUM-1');

  const out = {
    demo: 'm12-multi-agent-chain',
    simulated: true,
    note: '模型为确定性 mock（provider=mock，usage_source=estimated），不是真实模型调用；执行层、会话、交接、工具与测试是真实的',
    workspace: root,
    agents: agents.map((a) => ({ agent_id: a.agent_id, role_id: a.role_id, provider: a.provider, model: a.model })),
    chain: {
      steps: chain.steps,
      handoffs: chain.handoffs,
      sessions_distinct: chain.sessions_distinct,
      total_tokens_estimated: chain.total_tokens
    },
    tasks: {
      before: before.meta,
      after: after.meta,
      fixed: before.meta.fail > 0 && after.meta.fail === 0
    },
    handoff_count: handoffs.length,
    handoff_detail: handoffs.map((h) => ({
      handoff_id: h.handoff_id, from_agent: h.from_agent, to_agent: h.to_agent,
      from_run: h.from_run, packet_id: h.packet_id,
      files: h.summary.files, evidence: h.summary.evidence.slice(0, 6)
    })),
    runs: runtime.listRuns(db, { project_id: 'demo', limit: 20 }).map((r) => ({
      run_id: r.run_id, agent_id: r.agent_id, role_id: r.role_id, status: r.status,
      session_id: r.session_id, handoff_id: r.handoff_id, tool_rounds: r.tool_rounds
    })),
    usage: runtime.usageOfProject(db, 'demo')
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('M12 多 Agent 交接链演示');
    console.log('  agent 数:', out.agents.length, '| 独立 session:', chain.sessions_distinct, '| 交接:', handoffs.length);
    for (const s of chain.steps) {
      console.log(`  ${s.index + 1}. ${s.role_id} ${s.status} run=${s.run_id} session=${s.session_id} tools=${s.tool_rounds} tokens≈${s.tokens_used}`);
    }
    console.log('  测试 before:', JSON.stringify(before.meta));
    console.log('  测试 after :', JSON.stringify(after.meta));
    console.log('  修复生效:', out.tasks.fixed);
    console.log('  usage:', JSON.stringify(out.usage.by_source));
  }

  // 退出码表达结论：链没有全部成功或测试没修好，就是失败
  const allOk = chain.steps.every((s) => s.status === 'SUCCEEDED')
    && chain.sessions_distinct
    && out.tasks.fixed
    && handoffs.length === agents.length - 1;
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('DEMO FAILED:', e.message);
  process.exit(1);
});
