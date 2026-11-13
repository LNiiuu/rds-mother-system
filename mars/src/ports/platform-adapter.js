'use strict';
// 平台适配器端口（M22）。
//
// 解决什么问题：RDS Core 需要从「某个平台」接收任务、把状态/结果送回去，
// 但不能把 WorkBuddy、DSH 或任何平台的会话/工具/生命周期写进域层。
//
// 为什么只有 5 个方法：端口只描述「双向消息网关」的最小面。
//   describe     平台身份 + 能力声明（不允许上层假设所有平台一样）
//   healthCheck  平台是否可达、凭据是否有效
//   receive      拉取入站消息（任务、取消、工具结果、上下文交接），带 cursor 支持重连
//   send         发送出站消息（状态、结果、上下文、工具调用请求）
//   cancel       请求取消一个平台任务
//
// Agent 注册、任务提交、状态回传、工具调用、上下文交接全部是**消息类型**，
// 不是端口方法；这样新增一种协作语义不需要改端口，也不需要改所有适配器。
//
// 约束（tooling/layering-check.mjs）：本文件零 require；METHODS <= 5；不依赖其他端口。

const METHODS = ['describe', 'healthCheck', 'receive', 'send', 'cancel'];

/**
 * 能力键的规范集合。每个适配器必须显式声明全部布尔键，缺一个即视为无效。
 * 上层只能按能力分支，不能按平台名分支。
 */
const CAPABILITY_KEYS = [
  'sessions',       // 是否有独立会话/线程概念
  'lifecycle',      // 是否能感知 Agent 上线/下线
  'submit',         // 是否接受任务提交
  'status',         // 是否能回传任务状态
  'cancel',         // 是否支持取消
  'events',         // 是否支持事件流/游标重连
  'contextHandoff', // 是否支持上下文交接
  'tools',          // 是否支持工具调用消息
  'reconnect'       // 断线后能否从 cursor 续读
];

/** 消息类型。适配器可以少支持，但必须用这些名字，不能用平台私有词汇。 */
const MESSAGE_TYPES = [
  'agent.register',
  'agent.offline',
  'task.submit',
  'task.status',
  'task.cancel',
  'tool.call',
  'tool.result',
  'context.handoff',
  'task.result',
  'error'
];

/** 统一错误码。适配器必须把平台错误翻译成这些码，不把 HTTP/平台原文抛给域层。 */
const ERRORS = Object.freeze({
  UNAVAILABLE: 'PLATFORM_UNAVAILABLE',
  UNAUTHORIZED: 'PLATFORM_UNAUTHORIZED',
  PROTOCOL: 'PLATFORM_PROTOCOL_ERROR',
  TIMEOUT: 'PLATFORM_TIMEOUT',
  NOT_FOUND: 'PLATFORM_NOT_FOUND',
  UNSUPPORTED: 'PLATFORM_UNSUPPORTED',
  CANCELLED: 'PLATFORM_CANCELLED'
});

/** 校验适配器形状；返回缺失项，空数组表示合格。 */
function validatePlatformAdapter(adapter) {
  const missing = [];
  if (!adapter || typeof adapter !== 'object') return ['adapter'];
  for (const m of METHODS) {
    if (typeof adapter[m] !== 'function') missing.push(m);
  }
  let desc = null;
  try {
    desc = typeof adapter.describe === 'function' ? adapter.describe() : null;
  } catch (e) {
    missing.push('describe() threw: ' + e.message);
  }
  if (!desc || typeof desc !== 'object') {
    missing.push('describe()');
    return missing;
  }
  if (typeof desc.name !== 'string' || !desc.name) missing.push('describe().name');
  if (typeof desc.version !== 'string' || !desc.version) missing.push('describe().version');
  if (!desc.capabilities || typeof desc.capabilities !== 'object') {
    missing.push('describe().capabilities');
  } else {
    for (const k of CAPABILITY_KEYS) {
      if (typeof desc.capabilities[k] !== 'boolean') missing.push('capabilities.' + k);
    }
  }
  return missing;
}

module.exports = { METHODS, CAPABILITY_KEYS, MESSAGE_TYPES, ERRORS, validatePlatformAdapter };
