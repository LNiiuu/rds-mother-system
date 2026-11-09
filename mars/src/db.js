'use strict';
// SQLite 连接与审计出口（M3 / B5 起为外观层）。
//
// 本文件保留为**兼容入口**：9 个域模块与 15 个测试文件都 require('./db')，
// 拆分后不改它们的 import，只把实现搬到 db/ 子模块：
//   db/schema.js   建表与增量迁移
//   db/ratelimit.js 固定窗口限流
//   db/stats.js    统计查询
// 本文件只留三件事：打开连接、审计出口、把子模块重新导出。
const path = require('node:path');
const { ensureDir } = require('./util');
const { AppError } = require('./errors');
const { SCHEMA_VERSION, initSchema, migrate } = require('./db/schema');
const { consumeRateLimit } = require('./db/ratelimit');
const { dbStats } = require('./db/stats');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  throw new Error(
    `需要 Node.js >= 22.5（当前 ${process.version}）：内置模块 node:sqlite 不可用。原始错误：${err.message}`
  );
}

/**
 * 把 SQLite 的原始异常翻译成带码、可操作的错误。
 *
 * 为什么需要：在此之前，打开一个损坏文件会直接抛 `ERR_SQLITE_ERROR`，
 * CLI 打印的是 Node 栈 + 安装绝对路径，用户拿不到任何可执行的下一步。
 */
function dbOpenError(err, file) {
  const raw = String((err && err.message) || err);
  if (/not a database|malformed|corrupt/i.test(raw)) {
    return new AppError('DB_OPEN_FAILED',
      `数据库无法打开：${file} 不是有效的 SQLite 数据库或已损坏（${raw}）。`
      + '可先用 rds doctor 确认，再从备份恢复（node mars/scripts/mars-db-backup.js）。');
  }
  if (/unable to open|CANTOPEN|EACCES|EPERM|readonly/i.test(raw)) {
    return new AppError('DB_OPEN_FAILED',
      `数据库无法打开：${file}（${raw}）。检查该目录存在且当前用户可写。`);
  }
  return new AppError('DB_OPEN_FAILED', `数据库初始化失败：${file}（${raw}）`);
}

function readSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    const n = Number(row && row.value);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    return null; // 还没有 meta 表：视为全新库或极老库
  }
}

function openDb(file) {
  if (file !== ':memory:') ensureDir(path.dirname(file));

  let db;
  try {
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    // M4 / B3：并发写不要立刻失败。MCP 常驻 + CLI 同时写时会撞上 SQLITE_BUSY，
    // 给 SQLite 一个等待窗口，而不是把随机失败抛给调用方。
    db.exec('PRAGMA busy_timeout = 5000');
  } catch (err) {
    try { if (db) db.close(); } catch (e) { /* 关闭失败不影响原错误 */ }
    throw dbOpenError(err, file);
  }

  // 前向兼容守卫：库里记录的版本高于代码支持的版本，说明这个库被更新版本的 RDS 写过。
  // 直接往下走会用旧结构去理解未知数据，而且 initSchema 会把版本号覆盖回旧值 ——
  // 那是在悄悄"降级"一个更新的库。这里直接拒绝，且不写入任何东西。
  const existing = readSchemaVersion(db);
  if (existing !== null && existing > SCHEMA_VERSION) {
    try { db.close(); } catch (e) { /* ignore */ }
    throw new AppError('DB_SCHEMA_NEWER',
      `数据库结构版本 ${existing} 高于当前代码支持的 ${SCHEMA_VERSION}：${file}。`
      + '请使用更新版本的 rds；本进程未改动该库。');
  }

  try {
    initSchema(db);
  } catch (err) {
    try { db.close(); } catch (e) { /* ignore */ }
    throw dbOpenError(err, file);
  }
  return db;
}

// M3 / B4：审计出口统一走 AuditSink。
//
// 为什么 sink 挂在连接句柄上，而不是给每个域函数加参数：
// 24 个审计调用点分布在 9 个模块，全部改成透传只会制造大面积噪音 diff；
// 而句柄已经贯穿所有域函数，把 sink 绑在句柄上是唯一的「单点替换」位置。
// 生产路径由组合根绑定 DbAuditSink；未绑定时退化为一个内联直写 sink
// （保留给 openDb 的既有测试与嵌入方，行为与历史一致）。
function audit(db, event) {
  if (!db.__auditSink) {
    db.__auditSink = {
      record(e) {
        db.prepare(`INSERT INTO audit (ts, principal_id, project_id, role_id, action, target, result, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          new Date().toISOString(), e.principal_id || 'unknown', e.project_id || '-', e.role_id || null,
          e.action, e.target || null, e.result, e.reason || null
        );
      }
    };
  }
  try {
    db.__auditSink.record(event || {});
  } catch (err) {
    // 审计永不阻断调用（既有不变量），但不能完全静默：
    // ① 计数，供进程内诊断（auditStats）；
    // ② 每个连接只向 stderr 报一次，避免刷屏。MCP 的 JSON-RPC 走 stdout，stderr 安全。
    db.__auditFailures = (db.__auditFailures || 0) + 1;
    db.__auditLastError = String((err && err.message) || err);
    if (!db.__auditWarned) {
      db.__auditWarned = true;
      console.error('WARN 审计写入失败（同连接后续失败仅计数）：' + db.__auditLastError);
    }
  }
}

/** 审计出口的运行期计数（无库场景返回零）。 */
function auditStats(db) {
  if (!db) return { failures: 0, lastError: null };
  return { failures: db.__auditFailures || 0, lastError: db.__auditLastError || null };
}

/** 绑定/替换审计出口。返回同一个 db 句柄，便于链式使用。 */
function attachAuditSink(db, sink) {
  if (!sink || typeof sink.record !== 'function') throw new Error('attachAuditSink 需要实现 record() 的 sink');
  db.__auditSink = sink;
  return db;
}

module.exports = {
  openDb,
  initSchema,
  migrate,
  audit,
  attachAuditSink,
  auditStats,
  dbStats,
  consumeRateLimit,
  SCHEMA_VERSION
};
