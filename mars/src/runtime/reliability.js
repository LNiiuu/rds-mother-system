'use strict';
// 可靠性策略（M13）：重试判定、退避、心跳陈旧检测、预算闸门。
//
// 全部是纯函数 + 一张表，没有隐藏状态：给定同样的输入，判定必然相同。
// 这样故障注入测试才能断言"第几次失败会重试、第几次会放弃"。

const { nowIso } = require('../util');

/**
 * 可重试的错误码白名单。
 * 刻意不包含：TOOL_DENIED / TOOL_PATH_ESCAPE / BUDGET_EXCEEDED / INVALID_RUN_STATE ——
 * 这些是**确定性拒绝**，重试只会把同一个错误再犯一遍，还多烧预算。
 */
const RETRYABLE = new Set([
  'PROVIDER_UNREACHABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_CANCELLED_TEMPORARY',
  'PROVIDER_RATE_LIMITED'
]);

/** PROVIDER_HTTP_5xx 属于上游临时故障，可重试；4xx 不可。 */
function isRetryable(code) {
  if (!code) return false;
  if (RETRYABLE.has(code)) return true;
  const m = /^PROVIDER_HTTP_(\d{3})$/.exec(code);
  if (m) {
    const status = Number(m[1]);
    return status >= 500 && status < 600;
  }
  return false;
}

/** 指数退避，带上限。attempt 从 1 开始。 */
function backoffMs(attempt, base = 250, cap = 4000) {
  const raw = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(cap, raw);
}

/**
 * 判断该不该重试。
 * @returns {{retry:boolean, reason:string, delay_ms:number}}
 */
function shouldRetry({ code, attempt, maxAttempts, budgetExhausted }) {
  if (budgetExhausted) return { retry: false, reason: 'BUDGET_EXCEEDED', delay_ms: 0 };
  if (!isRetryable(code)) return { retry: false, reason: 'NOT_RETRYABLE', delay_ms: 0 };
  if (attempt >= maxAttempts) return { retry: false, reason: 'ATTEMPTS_EXHAUSTED', delay_ms: 0 };
  return { retry: true, reason: 'RETRYABLE', delay_ms: backoffMs(attempt) };
}

/**
 * 找心跳陈旧的 RUNNING run。判定「Agent 可能已经死了」。
 * 不自动改状态——由调用方决定（CLI 的 agent reap 会先报告再动手）。
 */
function staleRuns(db, staleMs = 120000) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  return db.prepare(`SELECT run_id, agent_id, project_id, status, started_at, heartbeat_at
    FROM agent_runs WHERE status = 'RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at <= ?)`)
    .all(cutoff)
    .map((r) => ({ ...r, stale_ms: staleMs }));
}

/** 把陈旧的 RUNNING 标成 FAILED/AGENT_LOST。返回被处理的 run。 */
function reapStale(db, staleMs = 120000) {
  const rows = staleRuns(db, staleMs);
  const now = nowIso();
  for (const r of rows) {
    db.prepare(`UPDATE agent_runs SET status = 'FAILED', error_code = 'AGENT_LOST',
      error_message = ?, finished_at = ?, updated_at = ? WHERE run_id = ? AND status = 'RUNNING'`)
      .run(`心跳停止超过 ${staleMs} ms`, now, now, r.run_id);
    db.prepare('INSERT INTO run_events (run_id, seq, kind, payload_json, created_at) VALUES (?,?,?,?,?)')
      .run(r.run_id,
        Number((db.prepare('SELECT COALESCE(MAX(seq),0) s FROM run_events WHERE run_id = ?').get(r.run_id).s)) + 1,
        'STATE', JSON.stringify({ from: 'RUNNING', to: 'FAILED', note: 'AGENT_LOST' }), now);
  }
  return rows.map((r) => r.run_id);
}

/**
 * 项目/任务级预算闸门。数据来自 agent_usage（不是 costs，避免估算混入真实）。
 * @returns {{ok:boolean, spent:number, limit:number|null, ratio:number, status:string}}
 */
function budgetGate(db, { project_id, task_id, limit }) {
  const spent = task_id
    ? db.prepare('SELECT COALESCE(SUM(input_tokens+output_tokens),0) s FROM agent_usage WHERE project_id = ? AND task_id = ?').get(project_id, task_id).s
    : db.prepare('SELECT COALESCE(SUM(input_tokens+output_tokens),0) s FROM agent_usage WHERE project_id = ?').get(project_id).s;
  const n = Number(spent) || 0;
  if (!limit) return { ok: true, spent: n, limit: null, ratio: 0, status: 'UNLIMITED' };
  const ratio = n / Number(limit);
  const status = ratio >= 1 ? 'EXCEEDED' : ratio >= 0.9 ? 'CRITICAL' : ratio >= 0.75 ? 'WARNING' : 'NORMAL';
  return { ok: ratio < 1, spent: n, limit: Number(limit), ratio: Number(ratio.toFixed(4)), status };
}

module.exports = { RETRYABLE, isRetryable, backoffMs, shouldRetry, staleRuns, reapStale, budgetGate };
