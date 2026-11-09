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

function openDb(file) {
  if (file !== ':memory:') ensureDir(path.dirname(file));
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
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
    // 审计永不阻断调用（既有不变量）
  }
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
  dbStats,
  consumeRateLimit,
  SCHEMA_VERSION
};
