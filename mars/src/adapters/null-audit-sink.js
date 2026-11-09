'use strict';
// 适配器：丢弃所有审计事件（M3 / B4）。
//
// 用途：无数据库场景（例如只读部署、纯解析脚本）与测试中用 `openDb(path, { auditSink })` 断言
// 「业务成功但审计被旁路」的情况。
function createNullAuditSink() {
  return {
    record() {
      /* 契约：不抛出、不返回 */
    }
  };
}

module.exports = { createNullAuditSink };
