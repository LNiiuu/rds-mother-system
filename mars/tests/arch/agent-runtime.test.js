'use strict';
// M12：Agent Runtime —— 定义、会话、执行、权限、失败路径、用量来源。
//
// 这些测试只用确定性 mock provider 与真实文件系统；不发起任何网络请求。
// 目的不是证明"模型效果好"，而是证明执行层本身的行为可预测、可追溯。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('../phase1/helpers');
const runtime = require('../../src/runtime/agent-runtime');
const { createMockProvider } = require('../../src/adapters/provider-mock');
const { createFsToolExecutor } = require('../../src/adapters/fs-tool-executor');
const projects = require('../../src/projects');
const projectRoots = require('../../src/adapters/fs-project-roots');

const deps = { resolveRoot: projectRoots.resolveRoot };

function workspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

/** 建一个带项目、Agent、工作区的最小环境。 */
function env(prefix, role = 'R2', turns = [{ text: 'ok' }], extra = {}) {
  const e = setup(prefix);
  const root = workspace(prefix + 'ws');
  projects.create(e.db, e.principal('R0'), { project_id: 'p1', name: 'P1', root, policy: 'default' }, deps);
  const agent = runtime.createAgent(e.db, {
    project_id: 'p1', role_id: role, name: role + ' agent', provider: 'mock', model: 'mock-1',
    mock: { turns }, ...extra
  }, { providers: ['mock', 'openai-compat'] });
  return { ...e, root, agent };
}

function providerFor(agent) {
  return createMockProvider({ scriptByAgent: { [agent.agent_id]: agent.definition.mock.turns } });
}

async function runOnce(e, agent, opts = {}) {
  const { run } = runtime.startRun(e.db, {
    agent_id: agent.agent_id, project_id: 'p1', objective: opts.objective || 'test',
    budget_tokens: opts.budget, timeout_ms: opts.timeout, idempotency_key: opts.key
  });
  const executor = opts.executor === null ? null : createFsToolExecutor({ root: e.root });
  const result = await runtime.executeRun({ db: e.db, run, agent, provider: providerFor(agent), executor });
  return result;
}

// ---------------------------------------------------------------- 定义

test('M12 Agent 定义：角色/Provider 校验、重复拒绝、停用后不可启动', () => {
  const e = env('m12-def-');
  assert.throws(() => runtime.createAgent(e.db, { project_id: 'p1', role_id: 'R9' }, { providers: ['mock'] }), /ROLE_UNKNOWN/);
  assert.throws(() => runtime.createAgent(e.db, { project_id: 'p1', role_id: 'R2', provider: 'nope' }, { providers: ['mock'] }), /PROVIDER_UNKNOWN/);
  assert.throws(
    () => runtime.createAgent(e.db, { project_id: 'p1', role_id: 'R2', agent_id: e.agent.agent_id }, { providers: ['mock'] }),
    /AGENT_EXISTS/
  );

  assert.equal(runtime.listAgents(e.db, { project_id: 'p1' }).length, 1);
  assert.equal(runtime.listAgents(e.db, { project_id: 'p2' }).length, 0);

  const stopped = runtime.stopAgent(e.db, e.agent.agent_id);
  assert.equal(stopped.status, 'STOPPED');
  assert.throws(() => runtime.startRun(e.db, { agent_id: e.agent.agent_id }), /AGENT_STOPPED/);
});

test('M12 项目隔离：Agent 不能跨项目启动 run', () => {
  const e = env('m12-proj-');
  assert.throws(
    () => runtime.startRun(e.db, { agent_id: e.agent.agent_id, project_id: 'p2' }),
    /PROJECT_DENIED/
  );
});

// ---------------------------------------------------------------- 执行

test('M12 执行：三次模型调用、两次真实工具调用、trace 完整有序', async () => {
  const e = env('m12-run-', 'R2', [
    { text: '写文件', toolCalls: [{ name: 'write_file', args: { path: 'src/a.js', content: 'export const a=1\n' } }] },
    { text: '读回来', toolCalls: [{ name: 'read_file', args: { path: 'src/a.js' } }] },
    { text: '完成', usage: { input: 50, output: 10 } }
  ]);
  const result = await runOnce(e, e.agent);

  assert.equal(result.run.status, 'SUCCEEDED');
  assert.equal(result.output.tool_rounds, 2);
  assert.equal(result.output.text, '完成');
  assert.equal(result.output.execution_kind, 'simulated');

  // 文件是真的被写了
  assert.equal(fs.readFileSync(path.join(e.root, 'src/a.js'), 'utf8'), 'export const a=1\n');

  const events = runtime.trace(e.db, result.run.run_id);
  const kinds = events.map((x) => x.kind);
  assert.ok(kinds.includes('STATE'));
  assert.ok(kinds.includes('SESSION'));
  assert.ok(kinds.includes('USAGE'));
  assert.equal(kinds.filter((k) => k === 'TOOL').length, 2);
  // seq 单调
  assert.deepEqual(events.map((x) => x.seq), events.map((_, i) => i + 1));
  // 工具事件带哈希，可追溯
  const toolEvent = events.find((x) => x.kind === 'TOOL');
  assert.equal(toolEvent.payload.allowed, true);
  assert.match(toolEvent.payload.meta.sha256, /^[0-9a-f]{64}$/);

  const usage = runtime.usageOfRun(e.db, result.run.run_id);
  assert.equal(usage.calls, 3);
  assert.equal(usage.tool_calls, 2);
  assert.deepEqual(usage.sources, ['estimated'], 'mock 的用量必须标 estimated');
});

test('M12 会话隔离：两个 Agent 各自独立 session，不共享上下文', async () => {
  const e = env('m12-sess-');
  const a2 = runtime.createAgent(e.db, {
    project_id: 'p1', role_id: 'R3', name: 'verifier', provider: 'mock', mock: { turns: [{ text: 'ok' }] }
  }, { providers: ['mock'] });

  const r1 = await runOnce(e, e.agent);
  const r2 = await runOnce(e, a2);

  assert.notEqual(r1.run.session_id, r2.run.session_id);
  const s1 = runtime.getSession(e.db, r1.run.session_id);
  const s2 = runtime.getSession(e.db, r2.run.session_id);
  assert.equal(s1.agent_id, e.agent.agent_id);
  assert.equal(s2.agent_id, a2.agent_id);
  assert.equal(runtime.sessionsOf(e.db, e.agent.agent_id).length, 1);
  assert.equal(runtime.sessionsOf(e.db, a2.agent_id).length, 1);
});

test('M12 幂等：相同 idempotency-key 返回同一个 run，不重复执行', async () => {
  const e = env('m12-idem-');
  const first = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'k-1' });
  assert.equal(first.idempotent, false);
  const second = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'k-1' });
  assert.equal(second.idempotent, true);
  assert.equal(second.run.run_id, first.run.run_id);
  assert.equal(runtime.listRuns(e.db, { project_id: 'p1' }).length, 1);
});

test('M12 终态不可重入：已成功的 run 再次执行被跳过', async () => {
  const e = env('m12-term-');
  const first = await runOnce(e, e.agent);
  assert.equal(first.run.status, 'SUCCEEDED');
  const again = await runtime.executeRun({
    db: e.db, run: first.run, agent: e.agent, provider: providerFor(e.agent), executor: null
  });
  assert.equal(again.skipped, true);
  assert.throws(() => runtime.transitionRun(e.db, first.run.run_id, 'RUNNING'), /INVALID_RUN_STATE/);
});

// ---------------------------------------------------------------- 权限

test('M12 工具权限：R4 无写权限，被拒且不落文件', async () => {
  const e = env('m12-perm-', 'R4', [
    { text: '试图写文件', toolCalls: [{ name: 'write_file', args: { path: 'hack.txt', content: 'x' } }] },
    { text: '被拒了，改为只读结论' }
  ]);
  const result = await runOnce(e, e.agent);
  assert.equal(result.run.status, 'SUCCEEDED');
  assert.equal(fs.existsSync(path.join(e.root, 'hack.txt')), false, '被拒的工具不得产生副作用');

  const denied = runtime.trace(e.db, result.run.run_id).find((x) => x.kind === 'TOOL');
  assert.equal(denied.payload.allowed, false);
  assert.equal(denied.payload.error_code, 'TOOL_DENIED');
});

test('M12 路径逃逸：../ 与绝对路径都被拒绝', async () => {
  const e = env('m12-escape-', 'R2', [
    { text: '越界', toolCalls: [{ name: 'write_file', args: { path: '../escape.txt', content: 'x' } }] },
    { text: '绝对路径', toolCalls: [{ name: 'write_file', args: { path: 'C:/Windows/Temp/escape.txt', content: 'x' } }] },
    { text: '结束' }
  ]);
  const result = await runOnce(e, e.agent);
  const toolEvents = runtime.trace(e.db, result.run.run_id).filter((x) => x.kind === 'TOOL');
  assert.equal(toolEvents.length, 2);
  assert.equal(toolEvents[0].payload.error_code, 'TOOL_PATH_ESCAPE');
  assert.equal(toolEvents[1].payload.error_code, 'TOOL_PATH_ESCAPE');
  assert.equal(fs.existsSync(path.join(path.dirname(e.root), 'escape.txt')), false);
});

test('M12 工具白名单：不存在的工具名不会被执行', async () => {
  const e = env('m12-wl-', 'R2', [
    { text: '跑 shell', toolCalls: [{ name: 'run_command', args: { cmd: 'rm -rf /' } }] },
    { text: '结束' }
  ]);
  const result = await runOnce(e, e.agent);
  const ev = runtime.trace(e.db, result.run.run_id).find((x) => x.kind === 'TOOL');
  assert.equal(ev.payload.allowed, false);
  assert.equal(ev.payload.error_code, 'TOOL_DENIED');
});

// ---------------------------------------------------------------- 失败路径

test('M12 Provider 失败：run 落 FAILED 并保留错误码', async () => {
  const e = env('m12-fail-', 'R2', [{ failWith: 'PROVIDER_UPSTREAM_ERROR' }]);
  const result = await runOnce(e, e.agent);
  assert.equal(result.run.status, 'FAILED');
  assert.equal(result.run.error_code, 'PROVIDER_UPSTREAM_ERROR');
  const err = runtime.trace(e.db, result.run.run_id).find((x) => x.kind === 'ERROR');
  assert.equal(err.payload.code, 'PROVIDER_UPSTREAM_ERROR');
});

test('M12 超时：超过 timeout_ms 落 TIMEOUT', async () => {
  const e = env('m12-timeout-', 'R2', [
    { text: '慢', delayMs: 120, toolCalls: [{ name: 'list_dir', args: { path: '.' } }] },
    { text: '不该到这里' }
  ]);
  const result = await runOnce(e, e.agent, { timeout: 50 });
  assert.equal(result.run.status, 'TIMEOUT');
  assert.equal(result.run.error_code, 'RUN_TIMEOUT');
});

test('M12 取消：执行前请求取消，run 落 CANCELLED 且不调用模型', async () => {
  const e = env('m12-cancel-', 'R2', [
    { text: '不该被调用', usage: { input: 999, output: 999 } }
  ]);
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  runtime.requestCancel(e.db, run.run_id, 'test');
  const result = await runtime.executeRun({
    db: e.db, run, agent: e.agent, provider: providerFor(e.agent), executor: null
  });
  assert.equal(result.run.status, 'CANCELLED');
  assert.equal(result.run.error_code, 'RUN_CANCELLED');
  assert.equal(runtime.usageOfRun(e.db, run.run_id).calls, 0, '取消后不应产生模型调用');
});

test('M12 预算：超出 budget_tokens 落 FAILED/BUDGET_EXCEEDED', async () => {
  const e = env('m12-budget-', 'R2', [
    { text: '第一次', usage: { input: 500, output: 100 }, toolCalls: [{ name: 'list_dir', args: { path: '.' } }] },
    { text: '第二次' }
  ]);
  const result = await runOnce(e, e.agent, { budget: 100 });
  assert.equal(result.run.status, 'FAILED');
  assert.equal(result.run.error_code, 'BUDGET_EXCEEDED');
});

test('M12 无执行器：工具调用被明确拒绝，不静默通过', async () => {
  const e = env('m12-noexec-', 'R2', [
    { text: '想读文件', toolCalls: [{ name: 'read_file', args: { path: 'x' } }] },
    { text: '结束' }
  ]);
  const result = await runOnce(e, e.agent, { executor: null });
  const ev = runtime.trace(e.db, result.run.run_id).find((x) => x.kind === 'TOOL');
  assert.equal(ev.payload.allowed, false);
  assert.equal(ev.payload.error_code, 'TOOL_EXECUTOR_MISSING');
});

// ---------------------------------------------------------------- 用量来源

test('M12 用量来源：provider 与 estimated 在账本里严格分开', async () => {
  const e = env('m12-usage-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });

  // 手工塞一个真实 provider 风格的用量
  runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), {
    input: 1000, output: 200, cached: 50, tool_calls: 0, usage_source: 'provider'
  });
  runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), {
    input: 10, output: 5, cached: 0, tool_calls: 0, usage_source: 'estimated'
  });
  const usage = runtime.usageOfRun(e.db, run.run_id);
  assert.deepEqual(usage.sources.sort(), ['estimated', 'provider']);
  assert.equal(usage.input_tokens, 1010);

  const byProject = runtime.usageOfProject(e.db, 'p1');
  assert.equal(byProject.by_source.provider.input, 1000);
  assert.equal(byProject.by_source.estimated.input, 10);
});

test('M12 未知来源不伪装：非三值的 usage_source 落 unknown', () => {
  const e = env('m12-unknown-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  const rec = runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), {
    input: 7, output: 3, usage_source: 'whatever'
  });
  assert.equal(rec.usage_source, 'unknown');
});

// ---------------------------------------------------------------- 执行器契约

test('M12 执行器：read_file 拒绝二进制与超限，list_dir 不越界', async () => {
  const root = workspace('m12-exec');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(200 * 1024 + 1));
  const exec = createFsToolExecutor({ root });

  const bin = await exec.invoke('read_file', { path: 'bin.dat' });
  assert.equal(bin.ok, false);
  assert.equal(bin.error_code, 'TOOL_BINARY');

  const big = await exec.invoke('read_file', { path: 'big.txt' });
  assert.equal(big.error_code, 'TOOL_TOO_LARGE');

  const escape = await exec.invoke('list_dir', { path: '../' });
  assert.equal(escape.error_code, 'TOOL_PATH_ESCAPE');

  const ok = await exec.invoke('list_dir', { path: '.' });
  assert.equal(ok.ok, true);
});

test('M12 执行器：run_test 真实运行工作区测试并返回 TAP 摘要', async () => {
  const root = workspace('m12-test');
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'a.test.js'), [
    "const { test } = require('node:test');",
    "const assert = require('node:assert');",
    "test('ok', () => assert.equal(1, 1));"
  ].join('\n'));
  const exec = createFsToolExecutor({ root });
  const r = await exec.invoke('run_test', {});
  assert.equal(r.ok, true, r.output);
  assert.equal(r.meta.pass, 1);
  assert.equal(r.meta.fail, 0);
});

test('M12 Provider 契约：缺方法或缺能力键即判定无效', () => {
  const { validateProvider } = require('../../src/ports/model-provider');
  const good = createMockProvider();
  assert.deepEqual(validateProvider(good), []);
  assert.ok(validateProvider({ name: 'x' }).includes('createSession'));
  assert.ok(validateProvider({ ...good, capabilities: { sessions: true } }).includes('capabilities.tools'));
});
