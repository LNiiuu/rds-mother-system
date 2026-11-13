'use strict';
// M18：多 Agent 任务编排器（域逻辑）。
//
// 它解决的问题不是“再跑一次 Agent”，而是：
//   - 把任务拆成有依赖的 job；
//   - 按优先级选出 READY 的 job；
//   - 在 max_concurrency 内并发执行；
//   - 串行/并发/混合三种模式共用同一套状态机；
//   - 每个 job 一个独立 Agent run / session / 工作区；
//   - 失败按可重试错误重试，不可重试的错误明确失败；
//   - 结果变更做冲突检测，冲突时停止自动合并。
//
// 明确边界：
//   - 这不是分布式调度器；单进程事件循环内并发，靠 Provider/工具的真实异步 I/O 重叠。
//   - 工作区隔离由注入的 workspace 适配器完成；本模块不碰 fs/child_process。
//   - 真实模型调用仍取决于 provider 配置；本模块不伪造执行性质。

const { nowIso, newId, stableJson } = require('../util');
const runtime = require('./agent-runtime');
const reliability = require('./reliability');

const PLAN_STATUS = ['CREATED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'];
const JOB_STATUS = ['CREATED', 'READY', 'WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED'];
const TERMINAL_JOB = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED']);
const TERMINAL_PLAN = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);

function emit(db, planId, jobId, kind, payload) {
  db.prepare(`INSERT INTO orchestration_events (plan_id, job_id, kind, payload_json, created_at)
    VALUES (?,?,?,?,?)`).run(planId, jobId || null, kind, stableJson(payload || {}), nowIso());
}

function parseJob(row) {
  if (!row) return null;
  return {
    ...row,
    deps: JSON.parse(row.deps_json || '[]'),
    writable_paths: row.writable_paths_json ? JSON.parse(row.writable_paths_json) : null,
    cancel_requested: Number(row.cancel_requested || 0),
    result: row.result_json ? JSON.parse(row.result_json) : null
  };
}

function parsePlan(row) {
  if (!row) return null;
  return {
    ...row,
    auto_merge: Number(row.auto_merge || 0),
    meta: row.meta_json ? JSON.parse(row.meta_json) : null
  };
}

function getPlan(db, planId) {
  return parsePlan(db.prepare('SELECT * FROM orchestration_plans WHERE plan_id = ?').get(planId));
}

function getJob(db, jobId) {
  return parseJob(db.prepare('SELECT * FROM orchestration_jobs WHERE job_id = ?').get(jobId));
}

function listJobs(db, planId) {
  return db.prepare('SELECT * FROM orchestration_jobs WHERE plan_id = ? ORDER BY priority DESC, created_at, job_key')
    .all(planId).map(parseJob);
}

function listPlans(db, filter = {}) {
  const where = [];
  const params = [];
  if (filter.project_id) { where.push('project_id = ?'); params.push(filter.project_id); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  const sql = 'SELECT * FROM orchestration_plans'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(filter.limit || 50));
  return db.prepare(sql).all(...params).map(parsePlan);
}

function listEvents(db, planId, limit = 500) {
  return db.prepare('SELECT * FROM orchestration_events WHERE plan_id = ? ORDER BY event_id LIMIT ?')
    .all(planId, Number(limit))
    .map((e) => ({ ...e, payload: JSON.parse(e.payload_json || '{}') }));
}

/** 依赖环检测：不允许 A→B→A。 */
function assertAcyclic(jobs) {
  const deps = new Map(jobs.map((j) => [j.key, j.deps || []]));
  const state = new Map(); // 0=未访问 1=访问中 2=完成
  const visit = (key, stack) => {
    const s = state.get(key) || 0;
    if (s === 1) throw new Error('DEPENDENCY_CYCLE ' + stack.concat(key).join(' -> '));
    if (s === 2) return;
    state.set(key, 1);
    for (const d of deps.get(key) || []) {
      if (!deps.has(d)) throw new Error('DEPENDENCY_UNKNOWN ' + key + ' -> ' + d);
      visit(d, stack.concat(key));
    }
    state.set(key, 2);
  };
  for (const j of jobs) visit(j.key, []);
}

function createPlan(db, input = {}) {
  const projectId = String(input.project_id || '');
  const project = db.prepare('SELECT project_id, root_path FROM projects WHERE project_id = ?').get(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND ' + projectId);
  const mode = String(input.mode || 'hybrid');
  if (!['serial', 'parallel', 'hybrid'].includes(mode)) throw new Error('PLAN_MODE_INVALID ' + mode);
  const workspaceMode = String(input.workspace_mode || (mode === 'serial' ? 'shared' : 'copy'));
  if (!['shared', 'worktree', 'copy'].includes(workspaceMode)) throw new Error('WORKSPACE_MODE_INVALID ' + workspaceMode);
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  if (!jobs.length) throw new Error('PLAN_JOBS_REQUIRED');
  if (jobs.length > 64) throw new Error('PLAN_TOO_MANY_JOBS ' + jobs.length);

  const seen = new Set();
  const normalized = jobs.map((j) => {
    const key = String(j.key || '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) throw new Error('JOB_KEY_INVALID ' + key);
    if (seen.has(key)) throw new Error('JOB_KEY_DUPLICATE ' + key);
    seen.add(key);
    const agent = runtime.getAgent(db, j.agent_id);
    if (!agent) throw new Error('AGENT_NOT_FOUND ' + j.agent_id);
    if (agent.project_id !== projectId) throw new Error('PROJECT_DENIED Agent ' + agent.agent_id + ' 属于 ' + agent.project_id);
    const roleId = String(j.role_id || agent.role_id);
    if (roleId !== agent.role_id) throw new Error('ROLE_MISMATCH ' + key + ' agent=' + agent.role_id + ' job=' + roleId);
    const deps = Array.isArray(j.deps) ? j.deps.map(String) : [];
    if (deps.includes(key)) throw new Error('DEPENDENCY_SELF ' + key);
    return {
      key, agent, role_id: roleId,
      title: String(j.title || key),
      task: j.task ? String(j.task) : String(j.title || key),
      deps,
      priority: Number(j.priority || 0),
      isolation: String(j.isolation || (workspaceMode === 'shared' ? 'shared' : 'copy')),
      writable_paths: Array.isArray(j.writable_paths) ? j.writable_paths.map(String) : null,
      max_attempts: Math.max(1, Number(j.max_attempts || 1)),
      timeout_ms: j.timeout_ms ? Number(j.timeout_ms) : null,
      budget_tokens: j.budget_tokens ? Number(j.budget_tokens) : null
    };
  });
  for (const j of normalized) {
    if (!['shared', 'copy', 'worktree'].includes(j.isolation)) throw new Error('JOB_ISOLATION_INVALID ' + j.key + ' ' + j.isolation);
  }
  assertAcyclic(normalized);

  const planId = String(input.plan_id || newId('plan'));
  const now = nowIso();
  const baseRoot = input.base_root || project.root_path;
  if (!baseRoot) throw new Error('PROJECT_ROOT_REQUIRED ' + projectId);
  const maxConcurrency = Math.max(1, Number(input.max_concurrency || (mode === 'serial' ? 1 : 3)));
  const autoMerge = input.auto_merge === undefined ? (workspaceMode !== 'shared') : Boolean(input.auto_merge);

  db.prepare(`INSERT INTO orchestration_plans
    (plan_id, project_id, objective, mode, status, max_concurrency, workspace_mode, auto_merge,
     base_root, merge_status, meta_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(planId, projectId, input.objective ? String(input.objective) : null, mode, 'CREATED',
      maxConcurrency, workspaceMode, autoMerge ? 1 : 0, String(baseRoot), null,
      stableJson(input.meta || {}), now, now);

  for (const j of normalized) {
    const jobId = newId('job');
    const status = j.deps.length ? 'WAITING' : 'READY';
    db.prepare(`INSERT INTO orchestration_jobs
      (job_id, plan_id, job_key, title, role_id, agent_id, deps_json, priority, isolation,
       writable_paths_json, status, attempt, max_attempts, timeout_ms, budget_tokens,
       created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(jobId, planId, j.key, j.title, j.role_id, j.agent.agent_id, stableJson(j.deps),
        j.priority, j.isolation, j.writable_paths ? stableJson(j.writable_paths) : null,
        status, 0, j.max_attempts, j.timeout_ms, j.budget_tokens, now, now);
    emit(db, planId, jobId, 'JOB_CREATED', { job_key: j.key, role_id: j.role_id, deps: j.deps, isolation: j.isolation });
  }
  emit(db, planId, null, 'PLAN_CREATED', { mode, max_concurrency: maxConcurrency, workspace_mode: workspaceMode, jobs: normalized.length });
  return getPlan(db, planId);
}

/**
 * 把 WAITING 推进到 READY；依赖失败则 BLOCKED。
 * 不做执行，只改状态——便于单独测试依赖语义。
 */
function promoteReady(db, planId) {
  const jobs = listJobs(db, planId);
  const byKey = new Map(jobs.map((j) => [j.job_key, j]));
  for (const job of jobs) {
    if (job.status !== 'WAITING') continue;
    const deps = job.deps.map((k) => byKey.get(k)).filter(Boolean);
    const failed = deps.find((d) => ['FAILED', 'CANCELLED', 'BLOCKED'].includes(d.status));
    if (failed) {
      db.prepare(`UPDATE orchestration_jobs SET status='BLOCKED', error_code='DEPENDENCY_FAILED',
        error_message=?, finished_at=?, updated_at=? WHERE job_id=?`)
        .run('依赖 ' + failed.job_key + ' 状态为 ' + failed.status, nowIso(), nowIso(), job.job_id);
      emit(db, planId, job.job_id, 'JOB_BLOCKED', { reason: 'DEPENDENCY_FAILED', dependency: failed.job_key, dependency_status: failed.status });
      continue;
    }
    if (deps.length === job.deps.length && deps.every((d) => d.status === 'SUCCEEDED')) {
      db.prepare(`UPDATE orchestration_jobs SET status='READY', updated_at=? WHERE job_id=?`).run(nowIso(), job.job_id);
      emit(db, planId, job.job_id, 'JOB_READY', {});
    }
  }
  return listJobs(db, planId);
}

function setJob(db, jobId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = 'UPDATE orchestration_jobs SET ' + keys.map((k) => k + ' = ?').join(', ') + ', updated_at = ? WHERE job_id = ?';
  db.prepare(sql).run(...keys.map((k) => fields[k]), nowIso(), jobId);
}

function deriveJobStatus(runStatus) {
  if (runStatus === 'SUCCEEDED') return 'SUCCEEDED';
  if (runStatus === 'CANCELLED') return 'CANCELLED';
  return 'FAILED';
}

function retryable(code) {
  return code === 'RUN_TIMEOUT' || reliability.isRetryable(code);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 跑一个 job，包含调度级重试。
 * 每次尝试新建 workspace + 新 run；不覆盖上一次的 run 证据。
 */
async function runJob(ctx, plan, job) {
  const { db } = ctx;
  const maxAttempts = Math.max(1, Number(job.max_attempts || 1));
  let attempt = Number(job.attempt || 0);
  let last = null;

  for (;;) {
    if (Number((db.prepare('SELECT cancel_requested FROM orchestration_jobs WHERE job_id=?').get(job.job_id) || {}).cancel_requested)) {
      setJob(db, job.job_id, { status: 'CANCELLED', error_code: 'JOB_CANCELLED', finished_at: nowIso() });
      emit(db, plan.plan_id, job.job_id, 'JOB_CANCELLED', { reason: 'cancel_requested_before_attempt' });
      return getJob(db, job.job_id);
    }
    attempt += 1;
    db.prepare(`UPDATE orchestration_jobs SET status='RUNNING', attempt=?, started_at=COALESCE(started_at, ?), updated_at=? WHERE job_id=?`)
      .run(attempt, nowIso(), nowIso(), job.job_id);
    emit(db, plan.plan_id, job.job_id, 'JOB_START', { attempt, agent_id: job.agent_id, role_id: job.role_id });

    let info = null;
    try {
      info = await ctx.workspace.prepare({
        base_root: plan.base_root,
        plan_id: plan.plan_id,
        job_key: job.job_key,
        attempt,
        isolation: job.isolation
      });
      const executor = ctx.toolExecutorFor(info.path, { allowedWritePaths: job.writable_paths });
      const packet = ctx.compilePacket ? ctx.compilePacket({
        project_id: plan.project_id,
        task_id: plan.plan_id + ':' + job.job_key,
        role_id: job.role_id,
        budget: job.budget_tokens || undefined,
        task: {
          id: plan.plan_id + ':' + job.job_key,
          text: job.task,
          objective: plan.objective,
          acceptance: []
        },
        objective: plan.objective
      }) : null;

      const { run } = runtime.startRun(db, {
        agent_id: job.agent_id,
        project_id: plan.project_id,
        task_id: plan.plan_id + ':' + job.job_key,
        objective: plan.objective,
        packet_id: packet ? packet.packet_id : null,
        input_tokens_est: packet ? packet.tokens_estimated : null,
        timeout_ms: job.timeout_ms || undefined,
        max_attempts: 1,
        budget_tokens: job.budget_tokens || undefined,
        idempotency_key: plan.plan_id + ':' + job.job_key + ':' + attempt
      });
      const agent = runtime.getAgent(db, job.agent_id);
      const provider = ctx.providerFor(agent.provider, agent);
      const runResult = await runtime.executeRun({
        db, run, agent, provider, executor, packet,
        // M18：隔离工作区的锁按工作区路径区分，避免同项目并行 job 被项目级锁串行化。
        lockScope: 'workspace',
        lockTarget: info.kind === 'shared' ? '*' : info.path
      });
      const changes = await ctx.workspace.changes(info);
      let status = deriveJobStatus(runResult.run.status);
      let errorCode = runResult.run.error_code || null;
      let errorMessage = runResult.run.error_message || null;

      if (status === 'SUCCEEDED' && plan.auto_merge && info.kind !== 'shared' && changes.files.length) {
        const merged = await ctx.workspace.merge({
          base_root: plan.base_root,
          workspace: info.path,
          changes: changes.files,
          job_key: job.job_key,
          owners: ctx.mergedFiles
        });
        if (!merged.ok) {
          status = 'BLOCKED';
          errorCode = 'MERGE_CONFLICT';
          errorMessage = merged.conflicts.map((c) => c.path + ':' + c.reason).join('; ');
          ctx.mergeConflicts = (ctx.mergeConflicts || []).concat(merged.conflicts);
        }
      }

      const result = {
        attempt,
        run_id: runResult.run.run_id,
        run_status: runResult.run.status,
        execution_kind: runResult.output ? runResult.output.execution_kind : null,
        output: runResult.output,
        usage: runtime.usageOfRun(db, runResult.run.run_id),
        workspace: info.path,
        workspace_kind: info.kind,
        changes: changes.files,
        changes_truncated: changes.truncated || false
      };
      last = result;
      const retry = ['FAILED', 'BLOCKED'].includes(status) && attempt < maxAttempts && retryable(errorCode);
      db.prepare(`UPDATE orchestration_jobs SET run_id=?, workspace=?, result_json=?, error_code=?, error_message=?,
        status=?, finished_at=?, updated_at=? WHERE job_id=?`)
        .run(runResult.run.run_id, info.path, stableJson(result), errorCode, errorMessage,
          retry ? 'RUNNING' : status, retry ? null : nowIso(), nowIso(), job.job_id);
      emit(db, plan.plan_id, job.job_id, retry ? 'JOB_RETRY' : 'JOB_' + status, {
        attempt, run_id: runResult.run.run_id, status, error_code: errorCode,
        changed_files: changes.files.length
      });
      if (retry) {
        await sleep(reliability.backoffMs(attempt));
        continue;
      }
      return getJob(db, job.job_id);
    } catch (e) {
      const code = e.code || 'SCHEDULER_JOB_ERROR';
      const retry = attempt < maxAttempts && retryable(code);
      const result = { attempt, workspace: info ? info.path : null, error: e.message, stack: e.stack };
      db.prepare(`UPDATE orchestration_jobs SET status=?, error_code=?, error_message=?, result_json=?,
        finished_at=?, updated_at=? WHERE job_id=?`)
        .run(retry ? 'RUNNING' : 'FAILED', code, e.message, stableJson(result),
          retry ? null : nowIso(), nowIso(), job.job_id);
      emit(db, plan.plan_id, job.job_id, retry ? 'JOB_RETRY' : 'JOB_FAILED', {
        attempt, error_code: code, message: e.message
      });
      if (retry) {
        await sleep(reliability.backoffMs(attempt));
        continue;
      }
      return getJob(db, job.job_id);
    }
  }
}

function finalPlanStatus(jobs) {
  if (!jobs.length) return 'FAILED';
  if (jobs.every((j) => j.status === 'SUCCEEDED')) return 'SUCCEEDED';
  if (jobs.every((j) => j.status === 'CANCELLED')) return 'CANCELLED';
  if (jobs.some((j) => j.status === 'SUCCEEDED')) return 'PARTIAL';
  return 'FAILED';
}

/**
 * 执行一个计划。
 * @param {object} ctx { db, plan, providerFor, toolExecutorFor, workspace, compilePacket, maxConcurrency? }
 */
async function executePlan(ctx) {
  const { db } = ctx;
  let plan = ctx.plan ? getPlan(db, ctx.plan.plan_id) : null;
  if (!plan) throw new Error('PLAN_REQUIRED');
  if (TERMINAL_PLAN.has(plan.status)) return { plan, jobs: listJobs(db, plan.plan_id), already_terminal: true };

  db.prepare("UPDATE orchestration_plans SET status='RUNNING', started_at=COALESCE(started_at, ?), updated_at=? WHERE plan_id=?")
    .run(nowIso(), nowIso(), plan.plan_id);
  plan = getPlan(db, plan.plan_id);
  ctx.mergedFiles = ctx.mergedFiles || new Map();
  emit(db, plan.plan_id, null, 'PLAN_START', { mode: plan.mode, max_concurrency: plan.max_concurrency });

  const running = new Map();
  for (;;) {
    promoteReady(db, plan.plan_id);
    const jobs = listJobs(db, plan.plan_id);
    const ready = jobs.filter((j) => j.status === 'READY')
      .sort((a, b) => (b.priority - a.priority) || String(a.created_at).localeCompare(String(b.created_at)) || a.job_key.localeCompare(b.job_key));
    const slots = Math.max(0, Number(plan.max_concurrency) - running.size);
    for (const job of ready.slice(0, slots)) {
      if (job.cancel_requested) {
        setJob(db, job.job_id, { status: 'CANCELLED', error_code: 'JOB_CANCELLED', finished_at: nowIso() });
        emit(db, plan.plan_id, job.job_id, 'JOB_CANCELLED', { reason: 'cancel_requested' });
        continue;
      }
      const p = runJob(ctx, plan, job).finally(() => running.delete(job.job_id));
      running.set(job.job_id, p);
      emit(db, plan.plan_id, job.job_id, 'JOB_DISPATCHED', { running: running.size, max_concurrency: plan.max_concurrency });
    }

    const current = listJobs(db, plan.plan_id);
    if (current.every((j) => TERMINAL_JOB.has(j.status))) break;
    if (running.size > 0) {
      await Promise.race([...running.values(), sleep(50)]);
      continue;
    }
    // 没有运行中的 job，也没有 READY；如果还有 WAITING，说明依赖永远无法满足。
    if (current.some((j) => j.status === 'WAITING')) {
      for (const j of current.filter((x) => x.status === 'WAITING')) {
        setJob(db, j.job_id, { status: 'BLOCKED', error_code: 'DEPENDENCY_UNRESOLVED', error_message: '依赖无法完成', finished_at: nowIso() });
        emit(db, plan.plan_id, j.job_id, 'JOB_BLOCKED', { reason: 'DEPENDENCY_UNRESOLVED' });
      }
      break;
    }
    if (!current.some((j) => j.status === 'READY')) break;
  }

  const jobs = listJobs(db, plan.plan_id);
  const status = finalPlanStatus(jobs);
  const conflicts = ctx.mergeConflicts || [];
  db.prepare(`UPDATE orchestration_plans SET status=?, finished_at=?, merge_status=?, error_code=?, error_message=? WHERE plan_id=?`)
    .run(status, nowIso(), conflicts.length ? 'CONFLICT' : (plan.auto_merge ? 'CLEAN' : 'NOT_MERGED'),
      conflicts.length ? 'MERGE_CONFLICT' : null,
      conflicts.length ? conflicts.map((c) => c.path + ':' + c.reason).join('; ') : null,
      plan.plan_id);
  emit(db, plan.plan_id, null, 'PLAN_' + status, { jobs: jobs.map((j) => ({ key: j.job_key, status: j.status, error: j.error_code })) });
  return { plan: getPlan(db, plan.plan_id), jobs };
}

function cancelJob(db, jobId, reason) {
  const job = getJob(db, jobId);
  if (!job) throw new Error('JOB_NOT_FOUND ' + jobId);
  if (TERMINAL_JOB.has(job.status)) return { job, already_terminal: true };
  db.prepare('UPDATE orchestration_jobs SET cancel_requested=1, updated_at=? WHERE job_id=?').run(nowIso(), jobId);
  if (job.run_id) {
    try { runtime.requestCancel(db, job.run_id, reason || 'scheduler_cancel'); } catch { /* run 可能已结束 */ }
  }
  if (['CREATED', 'READY', 'WAITING'].includes(job.status)) {
    setJob(db, jobId, { status: 'CANCELLED', error_code: 'JOB_CANCELLED', finished_at: nowIso() });
  }
  emit(db, job.plan_id, job.job_id, 'JOB_CANCEL_REQUESTED', { reason: reason || null });
  return { job: getJob(db, jobId), already_terminal: false };
}

/**
 * 恢复：把 RUNNING 但心跳陈旧/已终态的 job 收敛。
 * 不自动删除任何数据；重试次数用尽则 FAILED。
 */
function recoverPlan(db, planId, options = {}) {
  const plan = getPlan(db, planId);
  if (!plan) throw new Error('PLAN_NOT_FOUND ' + planId);
  const staleMs = Number(options.staleMs || 120000);
  const jobs = listJobs(db, planId).filter((j) => j.status === 'RUNNING');
  const recovered = [];
  for (const job of jobs) {
    if (!job.run_id) {
      setJob(db, job.job_id, { status: job.attempt < job.max_attempts ? 'READY' : 'FAILED', error_code: 'RUN_MISSING', error_message: 'RUNNING job 没有 run_id', finished_at: nowIso() });
      recovered.push({ job_key: job.job_key, action: 'RUN_MISSING' });
      continue;
    }
    const run = runtime.getRun(db, job.run_id);
    if (!run) {
      setJob(db, job.job_id, { status: job.attempt < job.max_attempts ? 'READY' : 'FAILED', error_code: 'RUN_NOT_FOUND', finished_at: nowIso() });
      recovered.push({ job_key: job.job_key, action: 'RUN_NOT_FOUND' });
      continue;
    }
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(run.status)) {
      const status = deriveJobStatus(run.status);
      setJob(db, job.job_id, { status, error_code: run.error_code, error_message: run.error_message, finished_at: nowIso() });
      recovered.push({ job_key: job.job_key, action: 'SYNC_TERMINAL', run_status: run.status });
      continue;
    }
    const heartbeat = run.heartbeat_at ? Date.parse(run.heartbeat_at) : 0;
    const stale = !heartbeat || (Date.now() - heartbeat) > staleMs;
    if (!stale) continue;
    const now = nowIso();
    db.prepare(`UPDATE agent_runs SET status='FAILED', error_code='AGENT_LOST', error_message=?,
      finished_at=?, updated_at=? WHERE run_id=? AND status='RUNNING'`)
      .run('心跳停止超过 ' + staleMs + ' ms', now, now, run.run_id);
    runtime.emit(db, run.run_id, 'STATE', { from: 'RUNNING', to: 'FAILED', note: 'AGENT_LOST' });
    const retry = job.attempt < job.max_attempts;
    setJob(db, job.job_id, { status: retry ? 'READY' : 'FAILED', error_code: retry ? 'AGENT_LOST_RETRY' : 'AGENT_LOST', error_message: 'Agent 心跳陈旧', finished_at: retry ? null : now });
    recovered.push({ job_key: job.job_key, action: retry ? 'REQUEUE' : 'FAILED', run_id: run.run_id });
    emit(db, planId, job.job_id, 'JOB_RECOVERED', { action: retry ? 'REQUEUE' : 'FAILED', run_id: run.run_id });
  }
  if (recovered.length) {
    emit(db, planId, null, 'PLAN_RECOVERED', { recovered });
  }
  return { plan: getPlan(db, planId), recovered };
}

/**
 * 对已完成/未自动合并的计划做受控合并。默认只报告冲突，不写文件。
 */
async function mergePlan(ctx, planId, options = {}) {
  const plan = getPlan(ctx.db, planId);
  if (!plan) throw new Error('PLAN_NOT_FOUND ' + planId);
  const jobs = listJobs(ctx.db, planId).filter((j) => j.result && Array.isArray(j.result.changes) && j.result.changes.length);
  const owners = new Map();
  const conflicts = [];
  const merged = [];
  for (const job of jobs) {
    const r = await ctx.workspace.merge({
      base_root: plan.base_root,
      workspace: job.workspace,
      changes: job.result.changes,
      job_key: job.job_key,
      owners,
      apply: Boolean(options.apply)
    });
    if (!r.ok) conflicts.push(...r.conflicts);
    else merged.push(...r.merged);
  }
  const status = conflicts.length ? 'CONFLICT' : (options.apply ? 'CLEAN' : 'DRY_RUN');
  ctx.db.prepare('UPDATE orchestration_plans SET merge_status=? WHERE plan_id=?').run(status, planId);
  return { plan_id: planId, apply: Boolean(options.apply), status, merged, conflicts };
}

module.exports = {
  PLAN_STATUS, JOB_STATUS, TERMINAL_JOB, TERMINAL_PLAN,
  createPlan, getPlan, getJob, listJobs, listPlans, listEvents,
  promoteReady, executePlan, cancelJob, recoverPlan, mergePlan,
  deriveJobStatus, finalPlanStatus
};
