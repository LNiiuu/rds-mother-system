'use strict';
// Agent Runtime（M12）——执行层的域逻辑。
//
// 这里回答四个问题：
//   1. 有哪些 Agent（定义，不是常量表）
//   2. 谁在什么会话里跑（session 隔离）
//   3. 一次执行经历了什么（run + run_events）
//   4. 花了多少（agent_usage，三分来源）
//
// 不做什么（分层约束，见 docs/checks/m12/M12-0-baseline-audit.md §4.1）：
//   - 不发 HTTP、不碰文件系统、不起子进程 → 由 provider / executor 适配器做
//   - 不读 process.env → 由组合根注入
//   - 不 require adapters
//
// 权限强度说明（不许含糊）：
//   - 角色权限在这里**代码校验**，每个工具调用都过一遍 hasToolPermission
//   - 但它不是进程沙箱：同一 OS 用户换个 token 就能换角色
//   - 真正拦住危险动作的是工具白名单（没有 run_command / shell）

const { nowIso, newId, estimateTokens, stableJson } = require('../util');
const { ROLES } = require('../collab');
const locks = require('./locks');
const { shouldRetry } = require('./reliability');

const RUN_STATUS = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMEOUT'];
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMEOUT']);

/** run 状态迁移白名单。终态不可再变。 */
const RUN_TRANSITIONS = {
  PENDING: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMEOUT'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMEOUT: []
};

const DEFAULT_MAX_TOOL_ROUNDS = 6;
const DEFAULT_TIMEOUT_MS = 120000;

// ---------------------------------------------------------------- 事件

function nextSeq(db, runId) {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM run_events WHERE run_id = ?').get(runId);
  return Number(row.s) + 1;
}

function emit(db, runId, kind, payload) {
  db.prepare('INSERT INTO run_events (run_id, seq, kind, payload_json, created_at) VALUES (?,?,?,?,?)')
    .run(runId, nextSeq(db, runId), kind, stableJson(payload || {}), nowIso());
}

function trace(db, runId, limit = 500) {
  return db.prepare('SELECT seq, kind, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY seq LIMIT ?')
    .all(runId, limit)
    .map((r) => ({ seq: r.seq, kind: r.kind, at: r.created_at, payload: JSON.parse(r.payload_json) }));
}

// ---------------------------------------------------------------- Agent

function parseAgent(row) {
  if (!row) return null;
  return {
    agent_id: row.agent_id,
    project_id: row.project_id,
    role_id: row.role_id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    status: row.status,
    definition: JSON.parse(row.definition_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * 建一个 Agent 定义。role_id 必须是已知角色；provider 只接受注入的可用名单。
 * 同一项目内 agent_id 唯一（冲突返回 AGENT_EXISTS，不静默覆盖）。
 */
function createAgent(db, input, deps = {}) {
  const projectId = input.project_id;
  const roleId = input.role_id;
  if (!projectId) throw new Error('PROJECT_REQUIRED');
  if (!ROLES[roleId]) throw new Error('ROLE_UNKNOWN ' + roleId);

  const agentId = input.agent_id || newId('agent');
  const existing = db.prepare('SELECT agent_id FROM agents WHERE agent_id = ?').get(agentId);
  if (existing) throw new Error('AGENT_EXISTS ' + agentId);

  const provider = String(input.provider || 'mock');
  const available = deps.providers || ['mock'];
  if (!available.includes(provider)) {
    throw new Error('PROVIDER_UNKNOWN ' + provider + '（可用：' + available.join(',') + '）');
  }

  const definition = {
    duty: ROLES[roleId].duty,
    permissions: ROLES[roleId].permissions,
    forbidden: ROLES[roleId].forbidden,
    tools: input.tools || null,          // null = 用角色默认；数组 = 进一步收窄
    max_risk: input.max_risk || 'medium',
    budget_tokens: input.budget_tokens || null,
    mock: input.mock || null,            // 仅 mock provider 使用
    notes: input.notes || null
  };

  const now = nowIso();
  db.prepare(`INSERT INTO agents (agent_id, project_id, role_id, name, provider, model,
    definition_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(agentId, projectId, roleId, String(input.name || roleId + ' agent'), provider,
      String(input.model || (provider === 'mock' ? 'mock-1' : 'unknown')),
      stableJson(definition), 'ACTIVE', now, now);

  return parseAgent(db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId));
}

function listAgents(db, filter = {}) {
  const where = [];
  const params = [];
  if (filter.project_id) { where.push('project_id = ?'); params.push(filter.project_id); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  const sql = 'SELECT * FROM agents' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at, agent_id';
  return db.prepare(sql).all(...params).map(parseAgent);
}

function getAgent(db, agentId) {
  return parseAgent(db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId));
}

function stopAgent(db, agentId) {
  const a = getAgent(db, agentId);
  if (!a) throw new Error('AGENT_NOT_FOUND ' + agentId);
  db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE agent_id = ?').run('STOPPED', nowIso(), agentId);
  return getAgent(db, agentId);
}

// ---------------------------------------------------------------- 会话

function createSession(db, agent, input = {}) {
  const sessionId = input.session_id || newId('sess');
  const now = nowIso();
  db.prepare(`INSERT INTO agent_sessions (session_id, agent_id, provider, model, external_id,
    status, turn_count, tokens_in, tokens_out, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sessionId, agent.agent_id, agent.provider, agent.model, input.external_id || null,
      'OPEN', 0, 0, 0, now, now);
  return getSession(db, sessionId);
}

function getSession(db, sessionId) {
  const r = db.prepare('SELECT * FROM agent_sessions WHERE session_id = ?').get(sessionId);
  return r ? { ...r } : null;
}

function closeSession(db, sessionId, status = 'CLOSED') {
  db.prepare('UPDATE agent_sessions SET status = ?, updated_at = ? WHERE session_id = ?').run(status, nowIso(), sessionId);
  return getSession(db, sessionId);
}

function sessionsOf(db, agentId) {
  return db.prepare('SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY created_at').all(agentId).map((r) => ({ ...r }));
}

// ---------------------------------------------------------------- Run

function parseRun(row) {
  if (!row) return null;
  return {
    run_id: row.run_id,
    project_id: row.project_id,
    agent_id: row.agent_id,
    session_id: row.session_id,
    task_id: row.task_id,
    handoff_id: row.handoff_id,
    role_id: row.role_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    idempotency_key: row.idempotency_key,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    timeout_ms: row.timeout_ms,
    budget_tokens: row.budget_tokens,
    cancel_requested: Number(row.cancel_requested),
    heartbeat_at: row.heartbeat_at,
    packet_id: row.packet_id,
    objective: row.objective,
    input_tokens_est: row.input_tokens_est,
    tool_rounds: row.tool_rounds,
    output: row.output_json ? JSON.parse(row.output_json) : null,
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function transitionRun(db, runId, to, note) {
  const run = parseRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
  if (!run) throw new Error('RUN_NOT_FOUND ' + runId);
  const allowed = RUN_TRANSITIONS[run.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`INVALID_RUN_STATE ${run.status} -> ${to}`);
  }
  db.prepare('UPDATE agent_runs SET status = ?, updated_at = ? WHERE run_id = ?').run(to, nowIso(), runId);
  emit(db, runId, 'STATE', { from: run.status, to, note: note || null });
  return parseRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
}

/**
 * 发起一次 run。幂等：同 project + idempotency_key 已存在时直接返回既有 run，
 * 不新建、不重复执行（M13 的重复任务防护从这里开始）。
 */
function startRun(db, input = {}) {
  const agent = getAgent(db, input.agent_id);
  if (!agent) throw new Error('AGENT_NOT_FOUND ' + input.agent_id);
  if (agent.status !== 'ACTIVE') throw new Error('AGENT_STOPPED ' + agent.agent_id);
  if (input.project_id && input.project_id !== agent.project_id) {
    throw new Error('PROJECT_DENIED Agent ' + agent.agent_id + ' 属于 ' + agent.project_id);
  }

  if (input.idempotency_key) {
    const dup = db.prepare('SELECT * FROM agent_runs WHERE project_id = ? AND idempotency_key = ?')
      .get(agent.project_id, String(input.idempotency_key));
    if (dup) {
      const run = parseRun(dup);
      return { run, idempotent: true };
    }
  }

  const runId = input.run_id || newId('run');
  const sessionId = input.session_id || null;
  const now = nowIso();
  db.prepare(`INSERT INTO agent_runs (run_id, project_id, agent_id, session_id, task_id, handoff_id,
    role_id, status, provider, model, idempotency_key, attempt, max_attempts, timeout_ms, budget_tokens,
    cancel_requested, packet_id, objective, input_tokens_est, tool_rounds, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(runId, agent.project_id, agent.agent_id, sessionId, input.task_id || null,
      input.handoff_id || null, agent.role_id, 'PENDING', agent.provider, agent.model,
      input.idempotency_key ? String(input.idempotency_key) : null,
      1, Number(input.max_attempts || 1), Number(input.timeout_ms || DEFAULT_TIMEOUT_MS),
      input.budget_tokens ? Number(input.budget_tokens) : null,
      0, input.packet_id || null, input.objective || null,
      input.input_tokens_est || null, 0, now, now);
  emit(db, runId, 'STATE', { from: null, to: 'PENDING', note: 'created' });
  return { run: getRun(db, runId), idempotent: false };
}

function getRun(db, runId) {
  return parseRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
}

function listRuns(db, filter = {}) {
  const where = [];
  const params = [];
  for (const [col, key] of [['project_id', 'project_id'], ['agent_id', 'agent_id'], ['status', 'status'], ['task_id', 'task_id']]) {
    if (filter[key]) { where.push(col + ' = ?'); params.push(filter[key]); }
  }
  const sql = 'SELECT * FROM agent_runs' + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(filter.limit || 100));
  return db.prepare(sql).all(...params).map(parseRun);
}

function heartbeat(db, runId) {
  db.prepare('UPDATE agent_runs SET heartbeat_at = ?, updated_at = ? WHERE run_id = ? AND status = ?')
    .run(nowIso(), nowIso(), runId, 'RUNNING');
  return getRun(db, runId);
}

/** 请求取消：只置标志，由正在执行的循环在下一个检查点收敛。 */
function requestCancel(db, runId, reason) {
  const run = getRun(db, runId);
  if (!run) throw new Error('RUN_NOT_FOUND ' + runId);
  if (TERMINAL.has(run.status)) return { run, already_terminal: true };
  db.prepare('UPDATE agent_runs SET cancel_requested = 1, updated_at = ? WHERE run_id = ?').run(nowIso(), runId);
  emit(db, runId, 'CANCEL_REQUESTED', { reason: reason || null });
  return { run: getRun(db, runId), already_terminal: false };
}

// ---------------------------------------------------------------- 用量

function recordUsage(db, run, usage) {
  if (!usage) return null;
  const source = ['provider', 'estimated', 'unknown'].includes(usage.usage_source)
    ? usage.usage_source
    : 'unknown';
  db.prepare(`INSERT INTO agent_usage (run_id, agent_id, project_id, task_id, provider, model,
    input_tokens, output_tokens, cached_tokens, tool_calls, usage_source, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(run.run_id, run.agent_id, run.project_id, run.task_id, run.provider, run.model,
      usage.input || 0, usage.output || 0, usage.cached || 0, usage.tool_calls || 0, source, nowIso());
  if (run.session_id) {
    db.prepare(`UPDATE agent_sessions SET turn_count = turn_count + 1,
      tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, updated_at = ? WHERE session_id = ?`)
      .run(usage.input || 0, usage.output || 0, nowIso(), run.session_id);
  }
  emit(db, run.run_id, 'USAGE', {
    input: usage.input || 0, output: usage.output || 0,
    cached: usage.cached || 0, tool_calls: usage.tool_calls || 0, source
  });
  return { ...usage, usage_source: source };
}

function usageOfRun(db, runId) {
  const rows = db.prepare('SELECT * FROM agent_usage WHERE run_id = ? ORDER BY usage_id').all(runId);
  return {
    run_id: runId,
    calls: rows.length,
    input_tokens: rows.reduce((a, r) => a + (r.input_tokens || 0), 0),
    output_tokens: rows.reduce((a, r) => a + (r.output_tokens || 0), 0),
    cached_tokens: rows.reduce((a, r) => a + (r.cached_tokens || 0), 0),
    tool_calls: rows.reduce((a, r) => a + (r.tool_calls || 0), 0),
    sources: [...new Set(rows.map((r) => r.usage_source))],
    detail: rows.map((r) => ({
      provider: r.provider, model: r.model,
      input: r.input_tokens, output: r.output_tokens, source: r.usage_source, at: r.created_at
    }))
  };
}

function usageOfProject(db, projectId) {
  const rows = db.prepare(`SELECT agent_id, usage_source, SUM(input_tokens) i, SUM(output_tokens) o,
    SUM(tool_calls) t, COUNT(*) c FROM agent_usage WHERE project_id = ? GROUP BY agent_id, usage_source`)
    .all(projectId);
  const bySource = { provider: { input: 0, output: 0 }, estimated: { input: 0, output: 0 }, unknown: { input: 0, output: 0 } };
  for (const r of rows) {
    const b = bySource[r.usage_source] || (bySource[r.usage_source] = { input: 0, output: 0 });
    b.input += r.i || 0;
    b.output += r.o || 0;
  }
  return { project_id: projectId, by_source: bySource, by_agent: rows };
}

// ---------------------------------------------------------------- 工具权限

/** 角色是否能调用某工具。以 `tool.<name>` 形式登记在角色权限里。 */
function hasToolPermission(roleId, toolName) {
  const profile = ROLES[roleId];
  if (!profile) return false;
  if (!profile.permissions.includes('tool.' + toolName)) return false;
  return true;
}

// ---------------------------------------------------------------- 消息构建

function buildSystemPrompt(agent, run) {
  const d = agent.definition;
  return [
    `你是 ${agent.role_id}（${d.duty}）。`,
    `当前任务：${run.objective || '(未提供目标)'}`,
    '',
    '硬性规则：',
    '1. 只使用提供的上下文与工具；不确定就说不确定，不要编造文件内容或测试结果。',
    '2. 只调用你被授权的工具；被拒绝时不要绕过。',
    '3. 结束时给出一段结论，说明做了什么、改了什么、验证结果、未完成事项。',
    `可用权限：${d.permissions.join(', ') || '(无)'}`,
    `显式禁止：${d.forbidden.join(', ') || '(无)'}`
  ].join('\n');
}

/** 把上下文包渲染成一条消息。分节保留来源，便于追溯。 */
function buildContextMessage(packet) {
  if (!packet) return { role: 'user', content: '（无上下文包）' };
  const parts = [];
  parts.push(`# 上下文包 ${packet.packet_id || ''}（${packet.tokens_estimated || '?'} tokens）`);
  for (const s of packet.sections || []) {
    const refs = (s.source_refs || []).join(', ');
    parts.push(`\n## ${s.title || s.id}${refs ? `　[来源: ${refs}]` : ''}\n${s.content}`);
  }
  if (Array.isArray(packet.missing) && packet.missing.length) {
    parts.push('\n## 缺失项（编译时未能提供）\n' + packet.missing.map((m) => '- ' + (m.note || m.id || m)).join('\n'));
  }
  return { role: 'user', content: parts.join('\n') };
}

// ---------------------------------------------------------------- 执行

function toolSpecsFor(agent, executor) {
  const all = executor.list();
  const narrowed = agent.definition.tools;
  const allowedNames = all.map((t) => t.name).filter((n) => hasToolPermission(agent.role_id, n));
  const finalNames = Array.isArray(narrowed) ? allowedNames.filter((n) => narrowed.includes(n)) : allowedNames;
  return all.filter((t) => finalNames.includes(t.name));
}

/**
 * 执行一次 run。
 *
 * @param {object} ctx
 * @param {object} ctx.db
 * @param {object} ctx.run          startRun 返回的 run
 * @param {object} ctx.agent
 * @param {object} ctx.provider     端口实现（mock / openai-compat）
 * @param {object} ctx.executor     工具执行器（可选；无工具时不传）
 * @param {object} [ctx.packet]     上下文包
 * @param {number} [ctx.maxToolRounds]
 * @param {number} [ctx.budgetTokens]
 */
async function executeRun(ctx) {
  const { db, agent, provider, executor, packet } = ctx;
  let run = ctx.run;
  if (!run) throw new Error('RUN_REQUIRED');
  if (TERMINAL.has(run.status)) {
    return { run, skipped: true, reason: 'already_terminal' };
  }
  if (run.status !== 'PENDING') throw new Error('INVALID_RUN_STATE ' + run.status + ' -> RUNNING');

  run = transitionRun(db, run.run_id, 'RUNNING', 'execute');
  db.prepare('UPDATE agent_runs SET started_at = ?, heartbeat_at = ? WHERE run_id = ?')
    .run(nowIso(), nowIso(), run.run_id);
  run = getRun(db, run.run_id);

  // M13：执行前拿工作区写锁。拿不到就明确失败——不排队、不覆盖别人的改动。
  // 只在真的会写东西（注入了执行器）时才拿，只读 run 不互斥。
  // M18：隔离工作区用 lockScope/lockTarget 区分；默认仍是项目级 '*'。
  let lockHeld = false;
  const lockArgs = {
    project_id: run.project_id,
    run_id: run.run_id,
    scope: ctx.lockScope || 'workspace',
    target: ctx.lockTarget || '*',
    ttl_ms: Number(run.timeout_ms || 120000) + 30000
  };
  if (ctx.lockWorkspace !== false && executor) {
    const got = locks.acquire(db, lockArgs);
    if (!got.ok) {
      const now = nowIso();
      db.prepare(`UPDATE agent_runs SET status = 'FAILED', error_code = 'WORKSPACE_LOCKED',
        error_message = ?, finished_at = ?, updated_at = ? WHERE run_id = ?`)
        .run('工作区已被 run ' + got.holder.run_id + ' 占用', now, now, run.run_id);
      emit(db, run.run_id, 'ERROR', { code: 'WORKSPACE_LOCKED', holder: got.holder });
      emit(db, run.run_id, 'STATE', { from: 'RUNNING', to: 'FAILED', note: 'WORKSPACE_LOCKED' });
      return { run: getRun(db, run.run_id), skipped: false, output: null, locked: false };
    }
    lockHeld = true;
    emit(db, run.run_id, 'LOCK', { scope: ctx.lockScope || 'workspace', target: ctx.lockTarget || '*', run_id: run.run_id, expires_at: got.lock.expires_at });
  }

  const budget = Number(run.budget_tokens || ctx.budgetTokens || 0) || null;
  const startedAt = Date.now();
  let spent = 0;
  let rounds = 0;
  let finalText = '';
  let status = null;
  let errorCode = null;
  let errorMessage = null;

  try {
    // 会话：run 没带 session 就新建一个，保证不同 run 不共享上下文。
    let session = run.session_id ? getSession(db, run.session_id) : null;
    if (!session) {
      session = createSession(db, agent, { model: run.model });
      db.prepare('UPDATE agent_runs SET session_id = ? WHERE run_id = ?').run(session.session_id, run.run_id);
      run = getRun(db, run.run_id);
      emit(db, run.run_id, 'SESSION', { session_id: session.session_id, provider: run.provider, model: run.model });
    }

    let providerSession = session.external_id;
    if (!providerSession) {
      const created = await provider.createSession({
        session_id: session.session_id, agent_id: agent.agent_id, model: run.model
      });
      providerSession = created.session_id;
      db.prepare('UPDATE agent_sessions SET external_id = ?, updated_at = ? WHERE session_id = ?')
        .run(providerSession, nowIso(), session.session_id);
    }

    const tools = executor ? toolSpecsFor(agent, executor) : [];
    const messages = [buildSystemPrompt(agent, run), buildContextMessage(packet)];
    const maxRounds = Number(ctx.maxToolRounds || DEFAULT_MAX_TOOL_ROUNDS);

    // 单次模型调用的重试。只对可重试错误重试；确定性拒绝不重试。
    const callModel = async () => {
      let attempt = 1;
      for (;;) {
        try {
          return await provider.sendMessage(providerSession, { messages, tools, timeoutMs: run.timeout_ms });
        } catch (e) {
          const code = e.code || 'PROVIDER_ERROR';
          const verdict = shouldRetry({
            code, attempt,
            maxAttempts: Number(run.max_attempts || 1),
            budgetExhausted: Boolean(budget && spent > budget)
          });
          emit(db, run.run_id, 'RETRY', {
            attempt, code, retry: verdict.retry, reason: verdict.reason, delay_ms: verdict.delay_ms
          });
          if (!verdict.retry) throw e;
          attempt += 1;
          db.prepare('UPDATE agent_runs SET attempt = ?, updated_at = ? WHERE run_id = ?')
            .run(attempt, nowIso(), run.run_id);
          await new Promise((resolve) => setTimeout(resolve, verdict.delay_ms));
          const cur = getRun(db, run.run_id);
          if (cur && cur.cancel_requested) {
            const err = new Error('PROVIDER_CANCELLED');
            err.code = 'PROVIDER_CANCELLED';
            throw err;
          }
        }
      }
    };

    while (rounds <= maxRounds) {
      // ---- 检查点 1：取消
      const fresh = getRun(db, run.run_id);
      if (fresh && fresh.cancel_requested) {
        status = 'CANCELLED';
        errorCode = 'RUN_CANCELLED';
        break;
      }
      // ---- 检查点 2：超时
      if (run.timeout_ms && Date.now() - startedAt > run.timeout_ms) {
        status = 'TIMEOUT';
        errorCode = 'RUN_TIMEOUT';
        errorMessage = `超过 ${run.timeout_ms} ms`;
        break;
      }
      // ---- 检查点 3：预算
      if (budget && spent > budget) {
        status = 'FAILED';
        errorCode = 'BUDGET_EXCEEDED';
        errorMessage = `已用 ${spent} > 预算 ${budget}`;
        break;
      }
      heartbeat(db, run.run_id);
      // 锁 TTL 不随心跳自动延长，长 run 会在 TTL 后失去锁。
      // 每轮续期；续不上说明锁已被别人拿走，立即停止，避免双写。
      if (lockHeld) {
        const renewed = locks.acquire(db, lockArgs);
        if (!renewed.ok) {
          status = 'FAILED';
          errorCode = 'WORKSPACE_LOCK_LOST';
          errorMessage = '锁已被 run ' + (renewed.holder ? renewed.holder.run_id : 'unknown') + ' 占用';
          emit(db, run.run_id, 'ERROR', { code: 'WORKSPACE_LOCK_LOST', holder: renewed.holder });
          break;
        }
      }

      const reply = await callModel();
      const used = reply.usage
        ? { ...reply.usage, usage_source: reply.usage_source || 'unknown' }
        : { input: estimateTokens(messages.map((m) => m.content).join('\n')), output: estimateTokens(reply.text), cached: 0, usage_source: 'estimated' };
      spent += (used.input || 0) + (used.output || 0);
      recordUsage(db, getRun(db, run.run_id), { ...used, tool_calls: (reply.tool_calls || []).length });

      const calls = reply.tool_calls || [];
      if (!calls.length) {
        finalText = reply.text || '';
        status = 'SUCCEEDED';
        break;
      }

      rounds += 1;
      db.prepare('UPDATE agent_runs SET tool_rounds = ? WHERE run_id = ?').run(rounds, run.run_id);
      messages.push({ role: 'assistant', content: reply.text || '', tool_calls: calls });

      for (const call of calls) {
        const verdict = await runTool(db, { agent, run: getRun(db, run.run_id), executor, tools, call });
        emit(db, run.run_id, 'TOOL', {
          tool: call.name, call_id: call.call_id, allowed: verdict.allowed,
          ok: verdict.result ? verdict.result.ok : false,
          error_code: verdict.result ? verdict.result.error_code : verdict.code,
          meta: verdict.result ? verdict.result.meta : null
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.call_id,
          content: verdict.allowed
            ? (verdict.result.ok ? verdict.result.output : `ERROR ${verdict.result.error_code}: ${verdict.result.message || ''}`)
            : `DENIED ${verdict.code}: ${verdict.message}`
        });
      }
      if (rounds >= maxRounds) {
        status = 'FAILED';
        errorCode = 'TOOL_ROUNDS_EXCEEDED';
        errorMessage = `工具轮次超过 ${maxRounds}`;
      }
    }
    if (!status) {
      status = 'FAILED';
      errorCode = 'RUN_NO_TERMINAL_STATE';
    }
  } catch (e) {
    const code = e.code || 'PROVIDER_ERROR';
    if (code === 'PROVIDER_CANCELLED') {
      status = 'CANCELLED';
      errorCode = code;
    } else if (code === 'PROVIDER_TIMEOUT') {
      status = 'TIMEOUT';
      errorCode = code;
    } else {
      status = 'FAILED';
      errorCode = code;
    }
    errorMessage = e.message;
    emit(db, run.run_id, 'ERROR', { code, message: e.message });
  } finally {
    if (lockHeld) {
      const r = locks.release(db, run.run_id);
      emit(db, run.run_id, 'LOCK', { released: true, count: r.released });
    }
  }

  // 保证状态一定收敛：异常路径也可能走到这里（status 已被 catch 赋值）
  if (!status) {
    status = 'FAILED';
    errorCode = errorCode || 'RUN_NO_TERMINAL_STATE';
  }
  const output = {
    text: finalText,
    tool_rounds: rounds,
    tokens_used: spent,
    provider: run.provider,
    model: run.model,
    session_id: run.session_id,
    // 明确写出这次执行的性质，避免后续读报告的人误判
    execution_kind: run.provider === 'mock' ? 'simulated' : 'provider'
  };
  db.prepare(`UPDATE agent_runs SET status = ?, output_json = ?, error_code = ?, error_message = ?,
    finished_at = ?, updated_at = ? WHERE run_id = ?`)
    .run(status, stableJson(output), errorCode, errorMessage, nowIso(), nowIso(), run.run_id);
  emit(db, run.run_id, 'STATE', { from: 'RUNNING', to: status, note: errorCode });

  return { run: getRun(db, run.run_id), skipped: false, output, locked: true };
}

/** 单个工具调用的权限 + 执行。权限被拒也返回结构化结果，由调用方回灌给模型。 */
async function runTool(db, { agent, executor, tools, call }) {
  if (!hasToolPermission(agent.role_id, call.name)) {
    return { allowed: false, code: 'TOOL_DENIED', message: `${agent.role_id} 没有 tool.${call.name} 权限` };
  }
  if (!executor) {
    return { allowed: false, code: 'TOOL_EXECUTOR_MISSING', message: '本次运行未注入工具执行器' };
  }
  const spec = tools.find((t) => t.name === call.name);
  if (!spec) {
    return { allowed: false, code: 'TOOL_NOT_AVAILABLE', message: `工具 ${call.name} 不在本次可用清单内` };
  }
  const result = await executor.invoke(call.name, call.args || {});
  return { allowed: true, result };
}

module.exports = {
  RUN_STATUS, RUN_TRANSITIONS, TERMINAL,
  DEFAULT_MAX_TOOL_ROUNDS, DEFAULT_TIMEOUT_MS,
  createAgent, listAgents, getAgent, stopAgent,
  createSession, getSession, closeSession, sessionsOf,
  startRun, getRun, listRuns, transitionRun,
  heartbeat, requestCancel, executeRun,
  recordUsage, usageOfRun, usageOfProject,
  hasToolPermission, toolSpecsFor,
  buildSystemPrompt, buildContextMessage,
  trace, emit
};
