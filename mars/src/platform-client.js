'use strict';
// 平台客户端（M22 域层）。
//
// 同一套调用逻辑跑在所有平台适配器上：提交任务、拉事件、等结果、取消、交接上下文。
// 它不认识 WorkBuddy/DSH/HTTP，只认识 ports/platform-adapter.js 的 5 个方法。

const { MESSAGE_TYPES } = require('./ports/platform-adapter');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function protocolError(message) {
  const e = new Error(message);
  e.code = 'PLATFORM_PROTOCOL_ERROR';
  return e;
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') throw protocolError('事件必须是对象');
  if (typeof raw.type !== 'string' || !MESSAGE_TYPES.includes(raw.type)) {
    throw protocolError('未知事件类型: ' + String(raw && raw.type));
  }
  if (raw.task_id !== undefined && typeof raw.task_id !== 'string') {
    throw protocolError('task_id 必须是字符串');
  }
  return raw;
}

function createPlatformClient(adapter, options = {}) {
  const pollMs = Number(options.pollMs || 50);
  let cursor = options.cursor || null;

  async function send(message) {
    if (!message || typeof message.type !== 'string' || !MESSAGE_TYPES.includes(message.type)) {
      throw protocolError('未知消息类型: ' + String(message && message.type));
    }
    return adapter.send(message);
  }

  return {
    describe() {
      return adapter.describe();
    },

    health() {
      return adapter.healthCheck();
    },

    cursor() {
      return cursor;
    },

    async submit(task) {
      if (!task || typeof task.objective !== 'string' || !task.objective.trim()) {
        throw protocolError('task.objective 必填');
      }
      const res = await send({
        type: 'task.submit',
        task_id: task.task_id || null,
        objective: task.objective,
        role_id: task.role_id || null,
        context: task.context || null,
        meta: task.meta || null
      });
      if (!res || typeof res.platform_task_id !== 'string') {
        throw protocolError('平台未返回 platform_task_id');
      }
      return res;
    },

    async poll() {
      const res = await adapter.receive({ cursor });
      if (!res || !Array.isArray(res.events)) throw protocolError('receive 必须返回 events 数组');
      if (res.cursor !== undefined) cursor = res.cursor;
      return res.events.map(normalizeEvent);
    },

    async waitForResult(taskId, opts = {}) {
      const timeoutMs = Number(opts.timeoutMs || 30000);
      const started = Date.now();
      const seen = [];
      for (;;) {
        const events = await this.poll();
        for (const ev of events) {
          if (ev.task_id !== taskId) continue;
          seen.push(ev);
          if (ev.type === 'task.result') return { status: ev.status || 'succeeded', result: ev.result, events: seen };
          if (ev.type === 'task.status' && TERMINAL.has(ev.status)) return { status: ev.status, result: ev.result, events: seen };
          if (ev.type === 'error' && ev.fatal === true) return { status: 'failed', error: ev.error, events: seen };
        }
        if (Date.now() - started > timeoutMs) {
          const e = new Error('等待平台结果超时 ' + timeoutMs + ' ms');
          e.code = 'PLATFORM_TIMEOUT';
          e.partial_events = seen;
          throw e;
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },

    async cancel(taskId, reason) {
      return adapter.cancel(taskId, reason || 'client_cancel');
    },

    async handoff(taskId, context) {
      return send({ type: 'context.handoff', task_id: taskId, context });
    },

    async status(taskId, status, detail) {
      if (!['running', 'succeeded', 'failed', 'cancelled'].includes(status)) {
        throw protocolError('非法任务状态: ' + String(status));
      }
      return send({ type: 'task.status', task_id: taskId, status, detail: detail || null });
    }
  };
}

module.exports = { createPlatformClient, normalizeEvent, TERMINAL };
