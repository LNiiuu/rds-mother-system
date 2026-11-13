'use strict';
// WorkBuddy 平台适配器（M22）——workbuddy guest bridge 传输。
//
// 真实的 WorkBuddy 只在 webview 内暴露 `window.__wbInvoke` / 事件总线
// （resources/wb-guest-sdk/wb.js）。本适配器不直接 require 该 SDK，
// 而是接收一个 bridge（invoke + 可选 on），因此：
//   - 在 WorkBuddy webview 里：由页面把 __wbInvoke 包成 bridge；
//   - 在 CLI/测试里：用实现同样通道契约的 fake bridge 做契约测试。
//
// 通道名是 RDS 与宿主页面之间的约定，不是 WorkBuddy 官方 API：
//   rds.health / rds.task.poll / rds.task.send / rds.task.cancel
// 真实 WorkBuddy 会话尚未执行，报告中必须标 NOT RUN，不能写成“已接入 WorkBuddy”。

const { ERRORS } = require('../ports/platform-adapter');

const CHANNELS = Object.freeze({
  HEALTH: 'rds.health',
  POLL: 'rds.task.poll',
  SEND: 'rds.task.send',
  CANCEL: 'rds.task.cancel'
});

function mapError(e) {
  if (!e) return Object.assign(new Error('平台调用失败'), { code: ERRORS.PROTOCOL });
  if (e.code && String(e.code).startsWith('PLATFORM_')) return e;
  const msg = String(e.message || e);
  let code = ERRORS.PROTOCOL;
  if (/timeout|timed out/i.test(msg)) code = ERRORS.TIMEOUT;
  else if (/unauthor|forbidden|denied/i.test(msg)) code = ERRORS.UNAUTHORIZED;
  else if (/not found|missing/i.test(msg)) code = ERRORS.NOT_FOUND;
  else if (/unavailable|disconnect|closed/i.test(msg)) code = ERRORS.UNAVAILABLE;
  return Object.assign(new Error(msg), { code, cause: e });
}

function createWorkbuddyPlatform(options = {}) {
  const bridge = options.bridge || null;
  const timeoutMs = Number(options.timeoutMs || 10000);

  async function invoke(channel, payload) {
    if (!bridge || typeof bridge.invoke !== 'function') {
      const e = new Error('WorkBuddy bridge 未注入');
      e.code = ERRORS.UNAVAILABLE;
      throw e;
    }
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(bridge.invoke(channel, payload)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const e = new Error('WorkBuddy 通道超时: ' + channel);
            e.code = ERRORS.TIMEOUT;
            reject(e);
          }, timeoutMs);
        })
      ]);
    } catch (e) {
      throw mapError(e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    describe() {
      return {
        name: options.name || 'workbuddy',
        version: options.version || '1.0.0',
        kind: 'guest-bridge',
        transport: 'wb:invoke',
        capabilities: {
          sessions: true, lifecycle: false, submit: true, status: true, cancel: true,
          events: true, contextHandoff: true, tools: false, reconnect: true
        }
      };
    },

    async healthCheck() {
      try {
        const res = await invoke(CHANNELS.HEALTH, {});
        return { ok: Boolean(res && res.ok !== false), detail: res || null };
      } catch (e) {
        return { ok: false, detail: { code: e.code, message: e.message } };
      }
    },

    async receive(input = {}) {
      const res = await invoke(CHANNELS.POLL, { cursor: input.cursor || null });
      if (!res || !Array.isArray(res.events)) {
        const e = new Error('WorkBuddy poll 未返回 events 数组');
        e.code = ERRORS.PROTOCOL;
        throw e;
      }
      return { events: res.events, cursor: res.cursor === undefined ? input.cursor : res.cursor };
    },

    async send(message) {
      if (!message || typeof message.type !== 'string') {
        const e = new Error('消息缺少 type');
        e.code = ERRORS.PROTOCOL;
        throw e;
      }
      return invoke(CHANNELS.SEND, message);
    },

    async cancel(taskId) {
      if (!taskId) {
        const e = new Error('cancel 需要 taskId');
        e.code = ERRORS.PROTOCOL;
        throw e;
      }
      return invoke(CHANNELS.CANCEL, { task_id: taskId });
    }
  };
}

module.exports = { createWorkbuddyPlatform, CHANNELS };
