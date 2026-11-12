'use strict';
// Agent / Run / Trace / Usage 的 CLI 处理（M12）。
//
// 这一层刻意不 require fs：文件读取（--mock-file、--packet、--task-file）
// 在 cli.js 里完成并作为已解析的数据传进来。cli.js 是入口，允许碰 fs；
// 这里是域逻辑，不允许。

const runtime = require('./runtime/agent-runtime');
const { executeChain } = require('./runtime/chain');
const reliability = require('./runtime/reliability');
const locks = require('./runtime/locks');
const policy = require('./runtime/policy');
const projects = require('./projects');
const collab = require('./collab');

function json(value) {
  console.log(JSON.stringify(value, null, 2));
}

function requireProject(db, projectId) {
  const row = projects.show(db, projectId);
  if (!row) throw new Error('PROJECT_UNKNOWN ' + projectId);
  if (row.status === 'removed') throw new Error('PROJECT_UNKNOWN 已移除：' + projectId);
  return row;
}

function actorOf(auth) {
  return (auth.principal && auth.principal.principal_id) || 'local';
}

/** 谁能建/停 Agent：协调者。谁能启动：协调者或该 Agent 自己的角色。 */
function assertCanManage(auth, what) {
  if (!collab.ROLES[auth.role]) throw new Error('ROLE_UNKNOWN ' + auth.role);
  if (auth.role !== 'R0') {
    throw new Error(`ROLE_DENIED ${what} 需要 R0（当前 ${auth.role}）`);
  }
}

function assertCanStart(auth, agent) {
  if (auth.role === 'R0' || auth.role === agent.role_id) return;
  throw new Error(`ROLE_DENIED 启动 ${agent.agent_id} 需要 R0 或 ${agent.role_id}（当前 ${auth.role}）`);
}

// ---------------------------------------------------------------- agent

function agentCreate({ db, args, runtime: rt, auth }) {
  assertCanManage(auth, 'agent create');
  requireProject(db, args.project);
  const mock = args.mockScript || null;
  const tools = args.tools ? String(args.tools).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const agent = runtime.createAgent(db, {
    agent_id: args.agent || null,
    project_id: args.project,
    role_id: args['to-role'] || args.agentRole || 'R2',
    name: args.name,
    provider: args.provider || 'mock',
    model: args.model,
    tools,
    budget_tokens: args.budget ? Number(args.budget) : null,
    mock,
    notes: args.notes || null
  }, { providers: rt.providerNames });
  json(agent);
}

function agentList({ db, args }) {
  json(runtime.listAgents(db, { project_id: args.project, status: args.status }));
}

function agentShow({ db, args }) {
  const a = runtime.getAgent(db, args.agent);
  if (!a) throw new Error('AGENT_NOT_FOUND ' + args.agent);
  json({ ...a, sessions: runtime.sessionsOf(db, a.agent_id), recent_runs: runtime.listRuns(db, { agent_id: a.agent_id, limit: 5 }) });
}

function agentStop({ db, args, auth }) {
  assertCanManage(auth, 'agent stop');
  json(runtime.stopAgent(db, args.agent));
}

/**
 * 启动一次执行（同步跑完再返回）。
 * 需要 cli.js 预先解析：args.packet（对象）、args.taskText（字符串）、args.workspaceRoot（绝对路径）
 */
async function agentStart({ db, args, runtime: rt, auth, compilePacket }) {
  const agent = runtime.getAgent(db, args.agent);
  if (!agent) throw new Error('AGENT_NOT_FOUND ' + args.agent);
  assertCanStart(auth, agent);
  const project = requireProject(db, agent.project_id);

  // 上下文：显式 packet > 现场编译 > 空
  let packet = args.packet || null;
  if (!packet && compilePacket) {
    packet = compilePacket({
      project_id: agent.project_id,
      task_id: args.task || null,
      role_id: agent.role_id,
      budget: args.budget ? Number(args.budget) : undefined,
      task: args.taskText ? { id: args.task || 'T-UNKNOWN', text: args.taskText } : { id: args.task || 'T-UNKNOWN' },
      objective: args.objective || null
    });
  }

  const { run, idempotent } = runtime.startRun(db, {
    agent_id: agent.agent_id,
    project_id: agent.project_id,
    task_id: args.task || null,
    handoff_id: args.handoff || null,
    objective: args.objective || null,
    packet_id: packet ? packet.packet_id : null,
    input_tokens_est: packet ? packet.tokens_estimated : null,
    timeout_ms: args.timeout ? Number(args.timeout) : undefined,
    max_attempts: args['max-attempts'] ? Number(args['max-attempts']) : undefined,
    budget_tokens: args.budget ? Number(args.budget) : (agent.definition.budget_tokens || null),
    idempotency_key: args['idempotency-key'] || null
  });

  if (idempotent) {
    json({ run, idempotent: true, note: '相同 idempotency-key 已存在，未重复执行' });
    return;
  }

  runtime.emit(db, run.run_id, 'CONTEXT', {
    packet_id: packet ? packet.packet_id : null,
    tokens: packet ? packet.tokens_estimated : null,
    sections: packet ? (packet.sections || []).map((s) => ({ id: s.id, tokens: s.token_estimate })) : []
  });

  // M13：项目级预算闸门。项目配置里写了 budget_tokens 就生效；超了直接拒绝，不烧钱。
  const projectBudget = (() => {
    try {
      const cfg = project.config_json ? JSON.parse(project.config_json) : {};
      return cfg.budget_tokens ? Number(cfg.budget_tokens) : null;
    } catch { return null; }
  })();
  if (projectBudget) {
    const gate = reliability.budgetGate(db, { project_id: agent.project_id, limit: projectBudget });
    if (!gate.ok) {
      json({ refused: true, reason: 'PROJECT_BUDGET_EXCEEDED', gate, note: '项目预算已用尽，未发起模型调用' });
      return;
    }
  }

  const provider = rt.providerFor(agent.provider, agent);
  const health = provider.healthCheck();
  if (!health.ok) {
    // 不静默降级成 mock：明确失败，让调用者知道真实调用没有发生。
    db.prepare('UPDATE agent_runs SET status = ?, error_code = ?, error_message = ?, finished_at = ?, updated_at = ? WHERE run_id = ?')
      .run('FAILED', 'PROVIDER_UNAVAILABLE', health.detail, new Date().toISOString(), new Date().toISOString(), run.run_id);
    runtime.emit(db, run.run_id, 'ERROR', { code: 'PROVIDER_UNAVAILABLE', message: health.detail });
    json({ run: runtime.getRun(db, run.run_id), provider_health: health, executed: false });
    return;
  }

  const rootPath = args.workspaceRoot || (project.root_path || null);
  let executor = null;
  if (rootPath) {
    executor = rt.toolExecutorFor(rootPath);
  }

  const result = await runtime.executeRun({ db, run, agent, provider, executor, packet });

  // 用量同时写入 M11 的成本账本，保持一本账。
  const usage = runtime.usageOfRun(db, run.run_id);
  if (usage.calls > 0) {
    collab.recordCost(db, {
      project_id: agent.project_id,
      task_id: args.task || null,
      agent_id: agent.agent_id,
      run_id: run.run_id,
      model: agent.model,
      provider: agent.provider,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cached_tokens: usage.cached_tokens,
      tool_calls: usage.tool_calls,
      usage_source: usage.sources.includes('provider') ? 'provider' : (usage.sources.includes('estimated') ? 'estimated' : 'unknown')
    });
  }

  json({
    run: result.run,
    executed: true,
    output: result.output,
    usage,
    provider: { name: provider.name, capabilities: provider.capabilities },
    workspace: rootPath || null,
    // 让读报告的人一眼看出这次是模拟还是真实调用
    execution_kind: result.output.execution_kind
  });
}

function agentStatus({ db, args }) {
  const run = runtime.getRun(db, args.run);
  if (!run) throw new Error('RUN_NOT_FOUND ' + args.run);
  json({ run, usage: runtime.usageOfRun(db, run.run_id), last_events: runtime.trace(db, run.run_id, 10) });
}

function agentCancel({ db, args }) {
  json(runtime.requestCancel(db, args.run, args.reason || 'cli'));
}

/**
 * 交接链：多个 Agent 依次执行，每棒自动生成结构化交接并为其下一棒重编译上下文。
 * 需要 --agents id1,id2,... （同项目）
 */
async function agentChain({ db, args, runtime: rt, auth, compilePacket }) {
  assertCanManage(auth, 'agent chain');
  const ids = String(args.agents || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error('BAD_REQUEST 需要 --agents <id1,id2,...> 至少两个');
  const agents = ids.map((id) => {
    const a = runtime.getAgent(db, id);
    if (!a) throw new Error('AGENT_NOT_FOUND ' + id);
    return a;
  });
  const projectId = agents[0].project_id;
  for (const a of agents) {
    if (a.project_id !== projectId) throw new Error('PROJECT_DENIED 链上 Agent 必须属于同一项目：' + a.agent_id);
    if (a.status !== 'ACTIVE') throw new Error('AGENT_STOPPED ' + a.agent_id);
  }
  const project = requireProject(db, projectId);
  const rootPath = args.workspaceRoot || project.root_path || null;
  const executor = rootPath ? rt.toolExecutorFor(rootPath) : null;

  // 第一棒的上下文：显式 packet > 现场编译（带任务正文）
  let initialPacket = args.packet || null;
  if (!initialPacket && compilePacket) {
    initialPacket = compilePacket({
      project_id: projectId,
      task_id: args.task || 'T-UNKNOWN',
      role_id: agents[0].role_id,
      budget: args.budget ? Number(args.budget) : undefined,
      task: {
        id: args.task || 'T-UNKNOWN',
        text: args.taskText || null,
        objective: args.objective || null
      }
    });
  }

  const result = await executeChain({
    db, agents, objective: args.objective || null, taskId: args.task || null,
    initialPacket, executor, compilePacket,
    providerFor: (a) => rt.providerFor(a.provider, a),
    budget: args.budget ? Number(args.budget) : null,
    timeout: args.timeout ? Number(args.timeout) : undefined,
    maxToolRounds: args['max-tool-rounds'] ? Number(args['max-tool-rounds']) : undefined
  });
  json({ ...result, workspace: rootPath });
}

// ---------------------------------------------------------------- run / trace / usage

function runList({ db, args }) {
  const rows = runtime.listRuns(db, {
    project_id: args.project, agent_id: args.agent, status: args.status, task_id: args.task,
    limit: args.limit ? Number(args.limit) : 50
  });
  json(rows.map((r) => ({
    run_id: r.run_id, agent_id: r.agent_id, role_id: r.role_id, status: r.status,
    provider: r.provider, model: r.model, task_id: r.task_id,
    tokens_est: r.input_tokens_est, tool_rounds: r.tool_rounds,
    error: r.error_code || null, started_at: r.started_at, finished_at: r.finished_at
  })));
}

function runInspect({ db, args }) {
  const run = runtime.getRun(db, args.run);
  if (!run) throw new Error('RUN_NOT_FOUND ' + args.run);
  json({ run, usage: runtime.usageOfRun(db, run.run_id), trace: runtime.trace(db, run.run_id) });
}

function traceInspect({ db, args }) {
  const run = runtime.getRun(db, args.run);
  if (!run) throw new Error('RUN_NOT_FOUND ' + args.run);
  json({ run_id: run.run_id, status: run.status, events: runtime.trace(db, run.run_id, args.limit ? Number(args.limit) : 500) });
}

function usageShow({ db, args }) {
  if (args.run) {
    json(runtime.usageOfRun(db, args.run));
    return;
  }
  if (!args.project) throw new Error('BAD_REQUEST 需要 --run 或 --project');
  json(runtime.usageOfProject(db, args.project));
}

/** 列出所有 provider 的契约与就绪状态（只探测配置，不发请求）。 */
function agentProviders({ runtime: rt }) {
  const rows = rt.providerNames.map((name) => {
    try {
      const p = rt.providerFor(name, null);
      return {
        provider: name,
        capabilities: p.capabilities,
        health: p.healthCheck(),
        // 明确标注：mock 是模拟，其它是真实协议但可能未配置
        kind: name === 'mock' ? 'simulated' : 'network',
        configured: typeof p.isConfigured === 'function' ? p.isConfigured() : true
      };
    } catch (e) {
      return { provider: name, error: e.message };
    }
  });
  json({ providers: rows, note: 'configured=false 表示缺凭据：真实调用为 NOT RUN，不是失败' });
}

// ---------------------------------------------------------------- M13 治理

/** 清理心跳停止的 RUNNING run（判定 Agent 已失联）。 */
function agentReap({ db, args }) {
  const staleMs = args.stale ? Number(args.stale) : 120000;
  const before = reliability.staleRuns(db, staleMs);
  const reaped = reliability.reapStale(db, staleMs);
  json({
    stale_ms: staleMs,
    candidates: before.length,
    reaped,
    note: reaped.length ? '已标为 FAILED/AGENT_LOST，未删除任何数据' : '没有心跳陈旧的 run'
  });
}

function lockList({ db, args }) {
  json({ locks: locks.listLocks(db, args.project), note: '过期锁在下次申请时被忽略并清理' });
}

function policyList() {
  json({ actions: policy.matrix(), never_granted: policy.NEVER_GRANTED });
}

function policyCheck({ args }) {
  if (!args.role || !args.action) throw new Error('BAD_REQUEST 需要 --role 与 --action');
  json({ ...policy.check(String(args.role), String(args.action)), role: args.role });
}

function budgetGateShow({ db, args }) {
  if (!args.project) throw new Error('BAD_REQUEST 需要 --project');
  json(reliability.budgetGate(db, {
    project_id: args.project,
    task_id: args.task || null,
    limit: args.limit ? Number(args.limit) : null
  }));
}

module.exports = {
  agentCreate, agentList, agentShow, agentStop, agentStart,
  agentStatus, agentCancel, agentChain,
  runList, runInspect, traceInspect, usageShow,
  agentReap, lockList, policyList, policyCheck, budgetGateShow, agentProviders
};
