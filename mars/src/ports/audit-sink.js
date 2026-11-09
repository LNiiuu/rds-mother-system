'use strict';
// 端口：AuditSink（M3 / B4）
//
// 职责：把「发生了一次受治理的动作」这件事送出去，不关心落到哪里。
// 为什么需要它：B4 之前 audit() 直接是 db.js 的导出，导致「想写审计就必须有数据库」——
// ledger 曾为了写一行审计去打开一个可写库（B3 已解除），而测试与嵌入方也没法替换出口。
//
// 契约（必须遵守，实现方自行保证）：
//   1. record(event) **不得抛出** —— 审计失败不能影响调用结果，这是既有语义；
//   2. 事件字段固定为 EVENT_FIELDS，实现方可忽略但不应该静默改名；
//   3. 不返回任何值。
//
// 约束：本文件零 require；方法数 <= 5；不依赖其他端口。

const METHODS = ['record'];

const EVENT_FIELDS = Object.freeze([
  'principal_id', 'project_id', 'role_id', 'action', 'target', 'result', 'reason'
]);

module.exports = { METHODS, EVENT_FIELDS };
