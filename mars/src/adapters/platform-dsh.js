'use strict';
// DSH 平台适配器（M22）——文件队列契约。
//
// 重要：本机没有 DSH 运行环境。这里实现的是 **DSH 接入协议的文件队列侧**
// （inbox.jsonl / outbox.jsonl），用真实文件 I/O 做契约验证；
// 真实 DSH 宿主会话标记 MOCK / NOT RUN，不能写成“已接入 DSH”。
//
// 协议：
//   <root>/inbox.jsonl   宿主写入的入站事件（task.submit / tool.result / ...）
//   <root>/outbox.jsonl  RDS 写出的出站事件（task.status / task.result / ...）
//   cursor 是“已消费的行数”，重启后从该行继续，避免重复处理。

const fs = require('node:fs');
const path = require('node:path');
const { ERRORS } = require('../ports/platform-adapter');

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}

function createDshPlatform(options = {}) {
  if (!options.root) throw new Error('DSH 适配器需要 root');
  const root = path.resolve(String(options.root));
  const inbox = path.join(root, 'inbox.jsonl');
  const outbox = path.join(root, 'outbox.jsonl');

  return {
    describe() {
      return {
        name: options.name || 'dsh',
        version: '1.0.0',
        kind: 'file-queue',
        transport: 'jsonl',
        capabilities: {
          sessions: false, lifecycle: false, submit: true, status: true, cancel: true,
          events: true, contextHandoff: true, tools: false, reconnect: true
        }
      };
    },

    async healthCheck() {
      const ok = fs.existsSync(root) && fs.statSync(root).isDirectory();
      return { ok, detail: { root, inbox: fs.existsSync(inbox), outbox: fs.existsSync(outbox) } };
    },

    async receive(input = {}) {
      const lines = readLines(inbox);
      const cursor = Math.max(0, Math.min(Number(input.cursor || 0), lines.length));
      const events = [];
      for (const line of lines.slice(cursor)) {
        try {
          events.push(JSON.parse(line));
        } catch (e) {
          throw Object.assign(new Error('DSH inbox 含非法 JSON 行'), { code: ERRORS.PROTOCOL });
        }
      }
      return { events, cursor: lines.length };
    },

    async send(message) {
      if (!message || typeof message.type !== 'string') {
        throw Object.assign(new Error('消息缺少 type'), { code: ERRORS.PROTOCOL });
      }
      if (!fs.existsSync(root)) {
        throw Object.assign(new Error('DSH 队列目录不存在: ' + root), { code: ERRORS.UNAVAILABLE });
      }
      appendLine(outbox, { ...message, at: new Date().toISOString() });
      return { accepted: true, transport: 'jsonl' };
    },

    async cancel(taskId) {
      if (!taskId) throw Object.assign(new Error('cancel 需要 taskId'), { code: ERRORS.PROTOCOL });
      appendLine(outbox, { type: 'task.cancel', task_id: taskId, at: new Date().toISOString() });
      return { cancelled: true, transport: 'jsonl' };
    }
  };
}

module.exports = { createDshPlatform };
