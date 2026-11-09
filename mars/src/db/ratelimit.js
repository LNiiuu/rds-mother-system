'use strict';
// 限流（M3 / B5 从 db.js 拆出）。
//
// 按 principal 的固定窗口计数，持久化在库里：进程重启或重连都不会重置额度。
// Persistent per-principal fixed-window limiter. Survives process restarts so a
// caller cannot reset its quota by reconnecting.
function consumeRateLimit(db, principal_id, limit, windowMs) {
  // Persistent per-principal fixed-window limiter. The window reset and the
  // increment happen in one atomic UPSERT inside a write transaction, so two
  // processes cannot both observe "old window" and each grant a fresh quota.
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO rate_limits (principal_id, window_start, count)
      VALUES (?, ?, 1)
      ON CONFLICT(principal_id) DO UPDATE SET
        count = CASE WHEN excluded.window_start - window_start >= ? THEN 1 ELSE count + 1 END,
        window_start = CASE WHEN excluded.window_start - window_start >= ? THEN excluded.window_start ELSE window_start END`)
      .run(principal_id, now, windowMs, windowMs);
    const row = db.prepare('SELECT count FROM rate_limits WHERE principal_id = ?').get(principal_id);
    db.exec('COMMIT');
    const count = Number(row.count);
    return { allowed: count <= limit, count };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = { consumeRateLimit };
