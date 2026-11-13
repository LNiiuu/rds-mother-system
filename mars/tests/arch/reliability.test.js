'use strict';
// M13：可靠调度与治理 —— 重试、锁、崩溃检测、预算闸门、权限矩阵、故障注入。
//
// 每个用例只断言一件事，失败时能直接定位到哪条策略没生效。

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
const reliability = require('../../src/runtime/reliability');
const locks = require('../../src/runtime/locks');
const policy = require('../../src/runtime/policy');

const deps = { resolveRoot: projectRoots.resolveRoot };

function env(prefix, role = 'R2', turns = [{ text: 'ok' }]) {
  const e = setup(prefix);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix + 'ws-'));
  projects.create(e.db, e.principal('R0'), { project_id: 'p1', name: 'P1', root, policy: 'default' }, deps);
  const agent = runtime.createAgent(e.db, {
    project_id: 'p1', role_id: role, name: role, provider: 'mock', model: 'mock-1', mock: { turns }
  }, { providers: ['mock'] });
  return { ...e, root, agent };
}

function providerOf(agent) {
  return createMockProvider({ scriptByAgent: { [agent.agent_id]: agent.definition.mock.turns } });
}

/** 前 n 次抛错，之后正常返回的 provider。用于验证重试与退避。 */
function flakyProvider(agent, failures, code = 'PROVIDER_UNREACHABLE') {
  const base = providerOf(agent);
  let n = 0;
  return {
    ...base,
    async sendMessage(sid, payload) {
      if (n < failures) {
        n += 1;
        const err = new Error(code);
        err.code = code;
        throw err;
      }
      return base.sendMessage(sid, payload);
    }
  };
}

// ---------------------------------------------------------------- 重试

test('M13 重试：可重试错误在 max_attempts 内成功，且留下 RETRY 事件', async () => {
  const e = env('m13-retry-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id, max_attempts: 3 });
  const result = await runtime.executeRun({
    db: e.db, run, agent: e.agent, provider: flakyProvider(e.agent, 2), executor: null
  });

  assert.equal(result.run.status, 'SUCCEEDED');
  assert.equal(result.run.attempt, 3);
  const retries = runtime.trace(e.db, run.run_id).filter((x) => x.kind === 'RETRY');
  assert.equal(retries.length, 2);
  assert.deepEqual(retries.map((r) => r.payload.retry), [true, true]);
  // 退避递增
  assert.ok(retries[1].payload.delay_ms > retries[0].payload.delay_ms);
});

test('M13 重试：不可重试错误不重试，一次即失败', async () => {
  const e = env('m13-noretry-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id, max_attempts: 5 });
  const result = await runtime.executeRun({
    db: e.db, run, agent: e.agent, provider: flakyProvider(e.agent, 9, 'PROVIDER_HTTP_400'), executor: null
  });

  assert.equal(result.run.status, 'FAILED');
  assert.equal(result.run.error_code, 'PROVIDER_HTTP_400');
  const retries = runtime.trace(e.db, run.run_id).filter((x) => x.kind === 'RETRY');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].payload.retry, false);
  assert.equal(retries[0].payload.reason, 'NOT_RETRYABLE');
});

test('M13 重试：尝试次数用尽后落 FAILED', async () => {
  const e = env('m13-exhaust-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id, max_attempts: 2 });
  const result = await runtime.executeRun({
    db: e.db, run, agent: e.agent, provider: flakyProvider(e.agent, 99), executor: null
  });
  assert.equal(result.run.status, 'FAILED');
  const retries = runtime.trace(e.db, run.run_id).filter((x) => x.kind === 'RETRY');
  assert.equal(retries.length, 2);
  assert.equal(retries[1].payload.reason, 'ATTEMPTS_EXHAUSTED');
});

test('M13 退避：指数增长并有上限', () => {
  assert.equal(reliability.backoffMs(1), 250);
  assert.equal(reliability.backoffMs(2), 500);
  assert.equal(reliability.backoffMs(3), 1000);
  assert.equal(reliability.backoffMs(9), 4000, '不得无限增长');
  assert.equal(reliability.isRetryable('PROVIDER_HTTP_503'), true);
  assert.equal(reliability.isRetryable('PROVIDER_HTTP_404'), false);
  assert.equal(reliability.isRetryable('TOOL_DENIED'), false);
  assert.equal(reliability.isRetryable('BUDGET_EXCEEDED'), false);
});

// ---------------------------------------------------------------- 锁

test('M13 工作区锁：并发两个写 run，第二个明确失败且无副作用', async () => {
  const e = env('m13-lock-', 'R2', [
    { text: '慢写', delayMs: 80, toolCalls: [{ name: 'write_file', args: { path: 'a.txt', content: 'A' } }] },
    { text: 'done' }
  ]);
  const executor = createFsToolExecutor({ root: e.root });

  const r1 = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'k1' });
  const r2 = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'k2' });

  const p1 = runtime.executeRun({ db: e.db, run: r1.run, agent: e.agent, provider: providerOf(e.agent), executor });
  const second = await runtime.executeRun({ db: e.db, run: r2.run, agent: e.agent, provider: providerOf(e.agent), executor });
  const first = await p1;

  assert.equal(second.run.status, 'FAILED');
  assert.equal(second.run.error_code, 'WORKSPACE_LOCKED');
  assert.equal(first.run.status, 'SUCCEEDED');
  assert.equal(fs.readFileSync(path.join(e.root, 'a.txt'), 'utf8'), 'A');
  // 第一个 run 结束后锁已释放
  assert.equal(locks.listLocks(e.db, 'p1').filter((l) => !l.expired).length, 0);
});

test('M13 锁过期：TTL 到点后可被另一个 run 取得', () => {
  const e = env('m13-ttl-');
  const a = locks.acquire(e.db, { project_id: 'p1', run_id: 'run-a', ttl_ms: 5000 });
  assert.equal(a.ok, true);
  const busy = locks.acquire(e.db, { project_id: 'p1', run_id: 'run-b' });
  assert.equal(busy.ok, false);
  assert.equal(busy.reason, 'LOCK_BUSY');

  // 手工把过期时间推到过去，模拟 TTL 到点
  e.db.prepare('UPDATE workspace_locks SET expires_at = ? WHERE run_id = ?').run('2000-01-01T00:00:00.000Z', 'run-a');
  const later = locks.acquire(e.db, { project_id: 'p1', run_id: 'run-b' });
  assert.equal(later.ok, true);
  assert.equal(locks.listLocks(e.db, 'p1').filter((l) => l.run_id === 'run-a').length, 0, '过期锁应被清理');
});

// ---------------------------------------------------------------- 崩溃检测

test('M13 崩溃检测：心跳陈旧的 RUNNING 被标为 AGENT_LOST，未删除数据', () => {
  const e = env('m13-reap-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  e.db.prepare("UPDATE agent_runs SET status = 'RUNNING', heartbeat_at = ? WHERE run_id = ?")
    .run('2000-01-01T00:00:00.000Z', run.run_id);

  const stale = reliability.staleRuns(e.db, 60000);
  assert.equal(stale.length, 1);

  const reaped = reliability.reapStale(e.db, 60000);
  assert.deepEqual(reaped, [run.run_id]);

  const after = runtime.getRun(e.db, run.run_id);
  assert.equal(after.status, 'FAILED');
  assert.equal(after.error_code, 'AGENT_LOST');
  // 现场保留：事件仍在
  assert.ok(runtime.trace(e.db, run.run_id).some((x) => x.kind === 'STATE' && x.payload.note === 'AGENT_LOST'));
  // 数据未被删
  assert.equal(e.db.prepare('SELECT count(*) c FROM agent_runs').get().c, 1);
});

test('M13 心跳：正常执行会刷新 heartbeat_at', async () => {
  const e = env('m13-hb-');
  const result = await (async () => {
    const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
    return runtime.executeRun({ db: e.db, run, agent: e.agent, provider: providerOf(e.agent), executor: null });
  })();
  assert.ok(result.run.heartbeat_at, '执行后应留下心跳时间');
  assert.ok(result.run.started_at);
  assert.ok(result.run.finished_at);
});

// ---------------------------------------------------------------- 预算

test('M13 预算闸门：四档状态与超限判定', () => {
  const e = env('m13-gate-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), { input: 700, output: 0, usage_source: 'estimated' });

  assert.equal(reliability.budgetGate(e.db, { project_id: 'p1', limit: 1000 }).status, 'NORMAL');
  runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), { input: 100, output: 0, usage_source: 'estimated' });
  assert.equal(reliability.budgetGate(e.db, { project_id: 'p1', limit: 1000 }).status, 'WARNING');
  runtime.recordUsage(e.db, runtime.getRun(e.db, run.run_id), { input: 150, output: 0, usage_source: 'estimated' });
  assert.equal(reliability.budgetGate(e.db, { project_id: 'p1', limit: 1000 }).status, 'CRITICAL');
  const over = reliability.budgetGate(e.db, { project_id: 'p1', limit: 900 });
  assert.equal(over.ok, false);
  assert.equal(over.status, 'EXCEEDED');
  assert.equal(reliability.budgetGate(e.db, { project_id: 'p1' }).status, 'UNLIMITED');
});

test('M13 重复提交：同 idempotency_key 并发也只产生一个 run', () => {
  const e = env('m13-dup-');
  const a = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'same' });
  const b = runtime.startRun(e.db, { agent_id: e.agent.agent_id, idempotency_key: 'same' });
  assert.equal(a.run.run_id, b.run.run_id);
  assert.equal(b.idempotent, true);
  assert.equal(e.db.prepare('SELECT count(*) c FROM agent_runs').get().c, 1);
});

// ---------------------------------------------------------------- 权限矩阵

test('M13 权限矩阵：四类动作永远拒绝，R7 有本地提交无推送', () => {
  for (const action of ['file.delete', 'git.push', 'release', 'network']) {
    for (const role of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']) {
      const v = policy.check(role, action);
      assert.equal(v.allowed, false, `${role} 不应能 ${action}`);
      assert.equal(v.reason, 'NEVER_GRANTED');
    }
  }
  assert.equal(policy.check('R7', 'git.commit').allowed, true);
  assert.equal(policy.check('R2', 'git.commit').allowed, false);
  assert.equal(policy.check('R4', 'memory.approve').allowed, true);
  assert.equal(policy.check('R2', 'memory.approve').allowed, false);
  assert.equal(policy.check('R2', 'file.write').allowed, true);
  assert.equal(policy.check('R3', 'file.write').allowed, false, 'R3 只验证不改代码');
  assert.equal(policy.check('R2', 'no.such.action').reason, 'UNKNOWN_ACTION');
});

test('M13 权限审计：允许与拒绝都落审计行', () => {
  const e = env('m13-audit-');
  policy.guardAndAudit(e.db, { role: 'R2', action: 'file.write', project_id: 'p1', target: 'a.js', actor: 'pid-r2' });
  policy.guardAndAudit(e.db, { role: 'R2', action: 'git.push', project_id: 'p1', actor: 'pid-r2' });

  const rows = e.db.prepare("SELECT action, result FROM audit WHERE action LIKE 'policy.%' ORDER BY audit_id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].result, 'allowed');
  assert.match(rows[1].result, /^denied:NEVER_GRANTED/);
});

// ---------------------------------------------------------------- 故障注入

test('M13 故障注入：工具执行失败被记录，run 仍能收敛（不挂死）', async () => {
  const e = env('m13-toolfail-', 'R2', [
    { text: '读一个不存在的文件', toolCalls: [{ name: 'read_file', args: { path: 'nope.txt' } }] },
    { text: '文件不存在，结论：需要先创建' }
  ]);
  const executor = createFsToolExecutor({ root: e.root });
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  const result = await runtime.executeRun({ db: e.db, run, agent: e.agent, provider: providerOf(e.agent), executor });

  assert.equal(result.run.status, 'SUCCEEDED');
  const ev = runtime.trace(e.db, run.run_id).find((x) => x.kind === 'TOOL');
  assert.equal(ev.payload.allowed, true);
  assert.equal(ev.payload.ok, false);
  assert.equal(ev.payload.error_code, 'TOOL_NOT_FOUND');
});

test('M13 故障注入：无上下文包也能执行，不崩', async () => {
  const e = env('m13-noctx-');
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  const result = await runtime.executeRun({
    db: e.db, run, agent: e.agent, provider: providerOf(e.agent), executor: null, packet: null
  });
  assert.equal(result.run.status, 'SUCCEEDED');
  const ctxEvent = runtime.trace(e.db, run.run_id).find((x) => x.kind === 'CONTEXT');
  assert.equal(ctxEvent, undefined, '没有编译包时不应伪造 CONTEXT 事件');
});

test('M13 故障注入：Provider 不可用时不静默降级为 mock', async () => {
  const e = env('m13-noprov-');
  const bad = {
    name: 'openai-compat',
    capabilities: { sessions: true, tools: true, stream: false, cancel: true, resume: false, usage: true, concurrency: true, multiTurn: true },
    createSession() { const x = new Error('PROVIDER_NOT_CONFIGURED'); x.code = 'PROVIDER_NOT_CONFIGURED'; throw x; },
    sendMessage() { throw new Error('unreachable'); },
    cancel() { return { cancelled: false }; },
    getUsage() { return { input_tokens: 0, output_tokens: 0, usage_source: 'unknown' }; },
    healthCheck() { return { ok: false, detail: 'not_configured' }; }
  };
  const { run } = runtime.startRun(e.db, { agent_id: e.agent.agent_id });
  const result = await runtime.executeRun({ db: e.db, run, agent: e.agent, provider: bad, executor: null });
  assert.equal(result.run.status, 'FAILED');
  assert.equal(result.run.error_code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(runtime.usageOfRun(e.db, run.run_id).calls, 0);
});

test('M13 部分失败：链在第二棒失败后停止，第一棒的交接仍可查', async () => {
  const { executeChain } = require('../../src/runtime/chain');
  const { listHandoffsOfTask } = require('../../src/runtime/handoff');
  const e = env('m13-chainfail-', 'R1', [{ text: '第一棒完成' }]);
  const a2 = runtime.createAgent(e.db, {
    project_id: 'p1', role_id: 'R2', name: 'impl', provider: 'mock', model: 'mock-1',
    mock: { turns: [{ failWith: 'PROVIDER_UPSTREAM_ERROR' }] }
  }, { providers: ['mock'] });

  const result = await executeChain({
    db: e.db,
    agents: [e.agent, a2],
    objective: 'chain',
    taskId: 'T-CHAIN-FAIL',
    providerFor: (a) => providerOf(a),
    executor: null
  });

  assert.equal(result.steps.length, 2, '第二棒失败后不再继续');
  assert.equal(result.steps[0].status, 'SUCCEEDED');
  assert.equal(result.steps[1].status, 'FAILED');
  assert.equal(result.handoffs.length, 1, '第一棒仍留下交接，现场不丢');
  assert.equal(listHandoffsOfTask(e.db, 'T-CHAIN-FAIL').length, 1);
  assert.equal(result.sessions_distinct, true);
});

test('M18 锁续期：同一 run 再次 acquire 只延长 TTL，不新增锁行', () => {
  const e = env('m18-renew-');
  const first = locks.acquire(e.db, { project_id: 'p1', run_id: 'run-a', ttl_ms: 5000 });
  assert.equal(first.ok, true);
  e.db.prepare('UPDATE workspace_locks SET expires_at = ? WHERE run_id = ?').run('2000-01-01T00:00:00.000Z', 'run-a');
  const renewed = locks.acquire(e.db, { project_id: 'p1', run_id: 'run-a', ttl_ms: 60000 });
  assert.equal(renewed.ok, true);
  assert.ok(Date.parse(renewed.lock.expires_at) > Date.now() + 30000, '续期后 TTL 应重新变长');
  assert.equal(locks.listLocks(e.db, 'p1').filter((l) => l.run_id === 'run-a').length, 1);
});
