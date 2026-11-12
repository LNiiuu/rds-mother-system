'use strict';
// 模型 Provider 端口（M12）。
//
// 为什么只有 5 个方法：端口是「Provider 必须实现、Runtime 无法自行合成」的最小面。
//   createSession  建一个 provider 侧会话（多轮上下文边界）
//   sendMessage    发一轮，返回文本 / 工具调用意图 / 用量
//   cancel         请求中止一个进行中的会话或 run
//   getUsage       读该会话累计用量
//   healthCheck    凭据与连通性
// execute / getStatus / getResult / stream 由 Runtime 组合而成（见 runtime/agent-runtime.js），
// 不放进端口——否则每接一个 provider 都要重复实现同一套状态机。
//
// 本文件必须零 require（layering-check L1）。

const METHODS = ['createSession', 'sendMessage', 'cancel', 'getUsage', 'healthCheck'];

/**
 * 能力清单的**规范键**。每个适配器必须显式声明全部键，缺一个即视为无效适配器。
 * 目的：不允许上层假设「所有平台都一样」。
 */
const CAPABILITY_KEYS = [
  'sessions',      // 是否支持独立会话
  'tools',         // 是否支持工具调用
  'stream',        // 是否支持流式
  'cancel',        // 是否支持取消
  'resume',        // 是否支持会话恢复
  'usage',         // 是否提供真实用量（provider）还是只能估算（estimated）
  'concurrency',   // 是否支持并发会话
  'multiTurn'      // 是否支持多轮连续执行
];

/** 校验一个 provider 实例是否满足端口契约。返回缺失项数组，空数组表示合格。 */
function validateProvider(provider) {
  const missing = [];
  if (!provider || typeof provider !== 'object') return ['provider'];
  for (const m of METHODS) {
    if (typeof provider[m] !== 'function') missing.push(m);
  }
  if (!provider.capabilities || typeof provider.capabilities !== 'object') {
    missing.push('capabilities');
  } else {
    for (const k of CAPABILITY_KEYS) {
      if (typeof provider.capabilities[k] !== 'boolean') missing.push('capabilities.' + k);
    }
  }
  if (typeof provider.name !== 'string' || !provider.name) missing.push('name');
  return missing;
}

module.exports = { METHODS, CAPABILITY_KEYS, validateProvider };
