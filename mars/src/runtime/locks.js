'use strict';
// 工作区锁（M13）。
//
// 解决的问题：两个 Agent 同时改同一个工作区，后写的静默覆盖先写的。
// 做法：run 在执行前按项目拿一把「工作区写锁」，拿不到就明确失败，不排队、不覆盖。
//
// 为什么不是文件级锁：M12 的工具面里没有「一次调用改多个文件」的原子性保证，
// 文件级锁只能防住一部分竞态，却给人「已经安全」的错觉。先用项目级互斥把
// 最坏情况堵死，文件级留给将来有真实需求时再做。

const { nowIso, newId } = require('../util');

const DEFAULT_TTL_MS = 120000;

/** 惰性清理：过期锁视为不存在。不删除别人的锁，只在读取时忽略。 */
function pruneExpired(db, projectId) {
  db.prepare('DELETE FROM workspace_locks WHERE project_id = ? AND expires_at <= ?').run(projectId, nowIso());
}

/**
 * 申请锁。
 * @returns {{ok:boolean, lock:object|null, reason?:string, holder?:object}}
 */
function acquire(db, input) {
  const projectId = input.project_id;
  const scope = input.scope || 'workspace';
  const target = input.target || '*';
  const runId = input.run_id;
  const ttl = Number(input.ttl_ms || DEFAULT_TTL_MS);
  if (!projectId || !runId) throw new Error('LOCK_INPUT_INVALID project_id+run_id');

  pruneExpired(db, projectId);

  const existing = db.prepare('SELECT * FROM workspace_locks WHERE project_id = ? AND scope = ? AND target = ?')
    .get(projectId, scope, target);
  if (existing && existing.run_id !== runId) {
    return { ok: false, reason: 'LOCK_BUSY', holder: { run_id: existing.run_id, acquired_at: existing.acquired_at, expires_at: existing.expires_at } };
  }
  if (existing && existing.run_id === runId) {
    // 同一 run 重入：续期
    const expires = new Date(Date.now() + ttl).toISOString();
    db.prepare('UPDATE workspace_locks SET expires_at = ? WHERE lock_id = ?').run(expires, existing.lock_id);
    return { ok: true, lock: { ...existing, expires_at: expires } };
  }

  const lock = {
    lock_id: newId('lock'),
    project_id: projectId,
    scope,
    target,
    run_id: runId,
    acquired_at: nowIso(),
    expires_at: new Date(Date.now() + ttl).toISOString()
  };
  db.prepare(`INSERT INTO workspace_locks (lock_id, project_id, scope, target, run_id, acquired_at, expires_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(lock.lock_id, lock.project_id, lock.scope, lock.target, lock.run_id, lock.acquired_at, lock.expires_at);
  return { ok: true, lock };
}

function release(db, runId) {
  const info = db.prepare('DELETE FROM workspace_locks WHERE run_id = ?').run(runId);
  return { released: Number(info.changes || 0) };
}

function listLocks(db, projectId) {
  const rows = projectId
    ? db.prepare('SELECT * FROM workspace_locks WHERE project_id = ? ORDER BY acquired_at').all(projectId)
    : db.prepare('SELECT * FROM workspace_locks ORDER BY acquired_at').all();
  return rows.map((r) => ({ ...r, expired: r.expires_at <= nowIso() }));
}

module.exports = { acquire, release, listLocks, pruneExpired, DEFAULT_TTL_MS };
