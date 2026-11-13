#!/usr/bin/env node
'use strict';
// M20：Development + REA 联合场景（真实 REA 工具 + mock Agent 编排）。
// 真实：W-01/W-02/W-04 工具执行、文件写入、node --test、SQLite、调度。
// mock：Agent 的模型文本/决策。绝不写成“真实模型联合”。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../mars/src/db');
const runtime = require('../mars/src/runtime/agent-runtime');
const scheduler = require('../mars/src/runtime/scheduler');
const { createMockProvider } = require('../mars/src/adapters/provider-mock');
const { createFsToolExecutor } = require('../mars/src/adapters/fs-tool-executor');
const { createWorkspaceManager } = require('../mars/src/adapters/fs-workspaces');
const rea = require('../mars/src/adapters/rea/registry');
const { build: buildApk } = require('./make-apk-fixture.cjs');

const ROOT = path.resolve(__dirname, '..');
const WHERE = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'where.exe') : 'where.exe';
const OUT = path.join(ROOT, 'docs', 'checks', 'm20');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm20-joint-'));
const projectRoot = path.join(tmp, 'ws');
const reaBase = path.join(tmp, 'rea');
fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'src', 'command.js'), [
  "'use strict';",
  'function buildCommand(input) {',
  "  return 'run ' + input;",
  '}',
  'module.exports = { buildCommand };',
  ''
].join('\n'), 'utf8');
fs.writeFileSync(path.join(projectRoot, 'test', 'command.test.js'), [
  "'use strict';",
  "const { test } = require('node:test');",
  "const assert = require('node:assert/strict');",
  "const { buildCommand } = require('../src/command');",
  "test('builds command', () => assert.equal(buildCommand('x'), 'run x'));",
  ''
].join('\n'), 'utf8');
const apk = path.join(tmp, 'synthetic.apk');
fs.writeFileSync(apk, buildApk());

const db = openDb(path.join(tmp, 'm20.db'));
const now = new Date().toISOString();
db.prepare(`INSERT INTO projects (project_id, display_name, owner_principal, share_policy, created_at, root_path, status, config_json, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run('joint', 'M20 Joint', 'demo', 'deny', now, projectRoot, 'active', '{}', now);

function cleanText(s) {
  let out = String(s);
  for (const [a, b] of [[ROOT, '<REPO>'], [tmp, '<TEMP>']]) out = out.split(a).join(b);
  return out;
}
function clean(v) {
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = clean(v[k]); return o; }
  return v;
}

function agent(id, role, turns) {
  return runtime.createAgent(db, { project_id: 'joint', role_id: role, agent_id: id, name: id, provider: 'mock', model: 'mock-1', mock: { turns } }, { providers: ['mock'] });
}

(async () => {
  // 1) 真实 REA：W-01 代码库、W-02/W-04 where.exe、W-03 APK（预期 BLOCKED）
  const w01 = await rea.run(db, { workflow_id: 'W-01', input: { root: projectRoot }, evidenceBase: reaBase });
  const w02 = await rea.run(db, { workflow_id: 'W-02', input: { sample: WHERE, max_strings: 200 }, evidenceBase: reaBase });
  const w04 = await rea.run(db, { workflow_id: 'W-04', input: { sample: WHERE, depth: 3 }, evidenceBase: reaBase });
  const w03 = await rea.run(db, { workflow_id: 'W-03', input: { sample: apk }, evidenceBase: reaBase });

  const summary = [
    '# Joint Evidence Summary',
    '',
    `- W-01: ${w01.status}; files=${w01.result.files_scanned}; deps_nodes=${w01.result.dependencies.nodes}; deps_edges=${w01.result.dependencies.edges}`,
    `- W-02: ${w02.status}; sections=${w02.result.sections.length}; imports=${w02.result.imports.length}; strings=${w02.result.strings.total}; sample_sha256=${w02.result.sample.sha256}`,
    `- W-04: ${w04.status}; insn=${w04.result.graph.instructions_scanned}; functions=${w04.result.graph.functions}; direct_edges=${w04.result.graph.direct_edges}; indirect=${w04.result.graph.indirect_call_sites}`,
    `- W-03: ${w03.status}; blocked=${w03.preflight.blocked_reason}; zip_entries=${w03.result.structure ? w03.result.structure.entries : 0}`,
    '',
    '## Facts',
    '- W-02/W-04 的样本哈希相同，均为 where.exe 的 SHA-256。',
    '- W-04 的函数边界是启发式推断，不是编译器符号；间接调用只计数不解析。',
    '- W-03 缺 jadx/java，只有 ZIP 结构事实，未做反编译。',
    '',
    '## Inferences',
    '- 该二进制导入文件系统与进程 API；是否“命令拼接风险”需要结合调用方代码，不能仅凭导入表判定。',
    '',
    '## Not verified',
    '- 运行时行为、恶意性、真实漏洞可利用性。',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(projectRoot, 'evidence', 'SUMMARY.md'), summary, 'utf8');
  fs.mkdirSync(path.join(OUT, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'evidence', 'SUMMARY.md'), summary, 'utf8');

  const reportText = [
    '# Joint Analysis Report',
    '',
    '## Scope',
    '分析测试代码库与 where.exe 的结构/调用图，输出证据边界。',
    '',
    '## Evidence',
    `- W-01 ${w01.status}: ${w01.result.files_scanned} files, ${w01.result.dependencies.nodes} dep nodes, ${w01.result.dependencies.edges} edges.`,
    `- W-02 ${w02.status}: ${w02.result.sections.length} sections, ${w02.result.imports.length} DLL, ${w02.result.strings.total} strings.`,
    `- W-04 ${w04.status}: ${w04.result.graph.instructions_scanned} insn, ${w04.result.graph.functions} inferred functions, ${w04.result.graph.direct_edges} direct edges, ${w04.result.graph.indirect_call_sites} indirect sites.`,
    `- W-03 ${w03.status}: ${w03.preflight.blocked_reason}; ZIP entries ${w03.result.structure ? w03.result.structure.entries : 0}.`,
    '',
    '## Review',
    '- 结论只使用工具直接事实与明确标注的推断。',
    '- 未验证运行时行为、恶意性、漏洞可利用性。',
    '- W-03 未反编译，不能把 ZIP 结构写成 APK 行为结论。',
    ''
  ].join('\n');

  agent('r1', 'R1', [
    { text: '写计划', toolCalls: [{ name: 'write_file', args: { path: 'JOINT-PLAN.md', content: '# Plan\n1. REA facts\n2. Review\n3. Report\n' } }] },
    { text: '计划完成' }
  ]);
  agent('r5', 'R5', [
    { text: '读证据', delayMs: 180, asyncDelay: true, toolCalls: [{ name: 'read_file', args: { path: 'evidence/SUMMARY.md' } }] },
    { text: '研究完成：证据含哈希与限制。' }
  ]);
  agent('r6', 'R6', [
    { text: '安全复核', delayMs: 220, asyncDelay: true, toolCalls: [{ name: 'read_file', args: { path: 'evidence/SUMMARY.md' } }] },
    { text: '安全完成：未发现越权执行证据。' }
  ]);
  agent('r2', 'R2', [
    { text: '写报告', delayMs: 150, asyncDelay: true, toolCalls: [{ name: 'write_file', args: { path: 'JOINT-REPORT.md', content: reportText } }] },
    { text: '报告完成' }
  ]);
  agent('r4', 'R4', [
    { text: '审查', toolCalls: [{ name: 'read_file', args: { path: 'JOINT-REPORT.md' } }] },
    { text: '审查完成', toolCalls: [{ name: 'read_file', args: { path: 'evidence/SUMMARY.md' } }] },
    { text: '审查通过：结论未超出证据范围。' }
  ]);
  agent('r0', 'R0', [
    { text: '汇总', toolCalls: [{ name: 'read_file', args: { path: 'JOINT-REPORT.md' } }] },
    { text: '联合任务完成。' }
  ]);

  const plan = scheduler.createPlan(db, {
    project_id: 'joint', base_root: projectRoot, mode: 'hybrid', workspace_mode: 'copy', max_concurrency: 2, auto_merge: true,
    objective: '分析测试代码与二进制，生成带证据边界的联合报告',
    jobs: [
      { key: 'design', agent_id: 'r1', role_id: 'R1', title: '计划', deps: [], priority: 10, isolation: 'shared', writable_paths: ['JOINT-PLAN.md'] },
      { key: 'research', agent_id: 'r5', role_id: 'R5', title: '研究', deps: ['design'], priority: 6, isolation: 'copy' },
      { key: 'security', agent_id: 'r6', role_id: 'R6', title: '安全', deps: ['design'], priority: 6, isolation: 'copy' },
      { key: 'report', agent_id: 'r2', role_id: 'R2', title: '报告', deps: ['design', 'research', 'security'], priority: 8, isolation: 'copy', writable_paths: ['JOINT-REPORT.md'] },
      { key: 'review', agent_id: 'r4', role_id: 'R4', title: '审查', deps: ['report'], priority: 9, isolation: 'shared' },
      { key: 'final', agent_id: 'r0', role_id: 'R0', title: '汇总', deps: ['review'], priority: 10, isolation: 'shared' }
    ]
  });

  const result = await scheduler.executePlan({
    db, plan,
    workspace: createWorkspaceManager({ baseDir: path.join(tmp, 'work') }),
    providerFor: (name, a) => createMockProvider({ scriptByAgent: { [a.agent_id]: a.definition.mock.turns } }),
    toolExecutorFor: (root, options) => createFsToolExecutor({ root, ...options }),
    compilePacket: (input) => ({
      packet_id: 'pkt_m20_' + Math.random().toString(16).slice(2, 8),
      tokens_estimated: 80,
      sections: [{ id: 'sec_task', title: '任务', kind: 'task', content: String(input.task && input.task.text || ''), token_estimate: 80 }]
    })
  });

  const jobs = result.jobs.map((j) => ({
    key: j.job_key, role: j.role_id, status: j.status, error: j.error_code, run_id: j.run_id, attempt: j.attempt,
    tool_events: j.run_id ? runtime.trace(db, j.run_id).filter((e) => e.kind === 'TOOL').map((e) => ({ tool: e.payload.tool, ok: e.payload.ok, error: e.payload.error_code, meta: e.payload.meta })) : []
  }));
  const usage = jobs.filter((j) => j.run_id).reduce((acc, j) => {
    const u = runtime.usageOfRun(db, j.run_id);
    acc.runs += 1; acc.input += u.input_tokens; acc.output += u.output_tokens; acc.calls += u.calls;
    return acc;
  }, { runs: 0, input: 0, output: 0, calls: 0 });

  const out = {
    demo: 'm20', generated_at: new Date().toISOString(), simulated_models: true,
    note: 'REA W-01/W-02/W-04 为真实工具执行；Agent 模型为 mock；W-03 缺 jadx 为 BLOCKED',
    rea: {
      W01: { status: w01.status, files: w01.result.files_scanned, deps_nodes: w01.result.dependencies.nodes, deps_edges: w01.result.dependencies.edges },
      W02: { status: w02.status, sections: w02.result.sections.length, imports: w02.result.imports.length, strings: w02.result.strings.total, sha256: w02.result.sample.sha256 },
      W04: { status: w04.status, insn: w04.result.graph.instructions_scanned, functions: w04.result.graph.functions, direct_edges: w04.result.graph.direct_edges, indirect: w04.result.graph.indirect_call_sites },
      W03: { status: w03.status, blocked: w03.preflight.blocked_reason, zip_entries: w03.result.structure ? w03.result.structure.entries : 0 }
    },
    plan: { plan_id: plan.plan_id, mode: plan.mode, status: result.plan.status, merge_status: result.plan.merge_status, max_concurrency: plan.max_concurrency },
    jobs, usage,
    files: {
      plan: fs.existsSync(path.join(projectRoot, 'JOINT-PLAN.md')),
      report: fs.existsSync(path.join(projectRoot, 'JOINT-REPORT.md')),
      summary: fs.existsSync(path.join(projectRoot, 'evidence', 'SUMMARY.md'))
    },
    artifacts: { evidence_summary: 'docs/checks/m20/evidence/SUMMARY.md', report: 'JOINT-REPORT.md' }
  };
  fs.writeFileSync(path.join(OUT, 'execution-record.json'), clean(JSON.stringify(out, null, 2)) + '\n');
  fs.writeFileSync(path.join(OUT, 'evidence', 'JOINT-REPORT.md'), reportText, 'utf8');
  fs.writeFileSync(path.join(OUT, 'evidence', 'JOINT-PLAN.md'), '# Plan\n1. REA facts\n2. Review\n3. Report\n', 'utf8');
  console.log(JSON.stringify({ ok: true, plan: out.plan, rea: out.rea, jobs: jobs.map((j) => `${j.key}:${j.status}`), files: out.files }, null, 2));
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
