'use strict';
// 适配器：把审计事件写进 SQLite（M3 / B4）。
//
// 这是生产环境唯一写 audit 表的实现。契约要求 record() 不抛出：
// 审计失败只提示一次 stderr，绝不影响业务调用结果。
const { EVENT_FIELDS } = require('../ports/audit-sink');

function createDbAuditSink(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('createDbAuditSink 需要已打开的数据库句柄');
  let reported = false;

  return {
    record(event) {
      const e = event || {};
      try {
        db.prepare(`INSERT INTO audit (ts, principal_id, project_id, role_id, action, target, result, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          new Date().toISOString(),
          e.principal_id || 'unknown',
          e.project_id || '-',
          e.role_id || null,
          e.action || 'unknown',
          e.target || null,
          e.result === undefined || e.result === null ? 'unknown' : String(e.result),
          e.reason || null
        );
      } catch (err) {
        if (!reported) {
          reported = true;
          try {
            process.stderr.write('[mars] audit sink 写入失败（后续同类错误不再提示）: ' + (err && err.message) + '\n');
          } catch (writeErr) {
            /* stderr 不可写时彻底放弃，不影响调用方 */
          }
        }
      }
    }
  };
}

module.exports = { createDbAuditSink, EVENT_FIELDS };
