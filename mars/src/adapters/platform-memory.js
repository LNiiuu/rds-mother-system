'use strict';
// 内存平台适配器（M22 参考实现）。
//
// 用途不是“假装接了平台”，而是给契约测试和替换性测试一个确定性的基线：
// 同样的 PlatformClient 代码必须能在 memory / http / dsh / workbuddy 上跑出同样形状的结果。

const { newId } = require('../util');

function createMemoryPlatform(options = {}) {
  const events = [];
  const tasks = new Map();
  let closed = false;

  function push(ev) {
    events.push({ ...ev, at: new Date().toISOString() });
  }

  return {
    describe() {
      return {
        name: options.name || 'memory',
        version: '1.0.0',
        kind: 'reference',
        capabilities: {
          sessions: true, lifecycle: true, submit: true, status: true, cancel: true,
          events: true, contextHandoff: true, tools: true, reconnect: true
        }
      };
    },

    async healthCheck() {
      return { ok: !closed, detail: closed ? 'closed' : 'in-memory' };
    },

    async receive(input = {}) {
      const cursor = Number(input.cursor || 0);
      return { events: events.slice(cursor), cursor: events.length };
    },

    async send(message) {
      if (closed) {
        const e = new Error('平台已关闭');
        e.code = 'PLATFORM_UNAVAILABLE';
        throw e;
      }
      if (!message || typeof message.type !== 'string') {
        const e = new Error('消息缺少 type');
        e.code = 'PLATFORM_PROTOCOL_ERROR';
        throw e;
      }
      if (message.type === 'task.submit') {
        const id = message.task_id || newId('ptask');
        tasks.set(id, { status: 'running', objective: message.objective });
        push({ type: 'task.status', task_id: id, status: 'running' });
        push({
          type: 'task.result', task_id: id, status: 'succeeded',
          result: { echo: message.objective, role_id: message.role_id || null }
        });
        return { platform_task_id: id, accepted: true };
      }
      if (message.type === 'context.handoff') {
        push({ type: 'context.handoff', task_id: message.task_id || null, context: message.context || null });
        return { accepted: true };
      }
      if (message.type === 'task.status' || message.type === 'task.result') {
        push(message);
        return { accepted: true };
      }
      if (message.type === 'tool.call') {
        return { accepted: true, result: { tool: message.tool || null, ok: true } };
      }
      push(message);
      return { accepted: true };
    },

    async cancel(taskId, reason) {
      const t = tasks.get(taskId);
      if (!t) {
        const e = new Error('任务不存在: ' + taskId);
        e.code = 'PLATFORM_NOT_FOUND';
        throw e;
      }
      t.status = 'cancelled';
      push({ type: 'task.status', task_id: taskId, status: 'cancelled', detail: reason || null });
      return { cancelled: true };
    },

    close() {
      closed = true;
    }
  };
}

module.exports = { createMemoryPlatform };
