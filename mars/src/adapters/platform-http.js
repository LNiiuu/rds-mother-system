'use strict';
// 通用 HTTP 平台适配器（M22）。
//
// 面向自建 Agent 客户端、Web 控制台、其他工作平台的 webhook 网关。
// 协议是 RDS 自己的最小 HTTP 契约，不是某家平台的私有 API：
//   GET  /health
//   GET  /tasks?cursor=<opaque>
//   POST /messages            { type, task_id, ... }
//   POST /tasks/:id/cancel    { reason }
//
// 真实执行验证：测试里起一个本地 http.Server，走真实网络往返，不用 mock fetch。

const { ERRORS } = require('../ports/platform-adapter');

function mapStatus(status) {
  if (status === 401 || status === 403) return ERRORS.UNAUTHORIZED;
  if (status === 404) return ERRORS.NOT_FOUND;
  if (status === 408 || status === 504) return ERRORS.TIMEOUT;
  if (status >= 500) return ERRORS.UNAVAILABLE;
  return ERRORS.PROTOCOL;
}

function createHttpPlatform(options = {}) {
  const baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
  const token = options.token || null;
  const timeoutMs = Number(options.timeoutMs || 10000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!baseUrl) throw new Error('HTTP 平台适配器需要 baseUrl');
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境没有 fetch');

  async function request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      const code = e && e.name === 'AbortError' ? ERRORS.TIMEOUT : ERRORS.UNAVAILABLE;
      throw Object.assign(new Error('HTTP 平台不可达: ' + e.message), { code });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!res.ok) {
      throw Object.assign(new Error(`HTTP ${res.status} ${text.slice(0, 200)}`), {
        code: mapStatus(res.status), status: res.status, body: json
      });
    }
    return json;
  }

  return {
    describe() {
      return {
        name: options.name || 'http',
        version: '1.0.0',
        kind: 'http',
        transport: 'http+json',
        capabilities: {
          sessions: true, lifecycle: true, submit: true, status: true, cancel: true,
          events: true, contextHandoff: true, tools: true, reconnect: true
        }
      };
    },

    async healthCheck() {
      try {
        const res = await request('GET', '/health');
        return { ok: Boolean(res && res.ok !== false), detail: res };
      } catch (e) {
        return { ok: false, detail: { code: e.code, message: e.message } };
      }
    },

    async receive(input = {}) {
      const cursor = input.cursor === null || input.cursor === undefined ? '' : String(input.cursor);
      const res = await request('GET', '/tasks' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (!res || !Array.isArray(res.events)) {
        throw Object.assign(new Error('HTTP 平台未返回 events 数组'), { code: ERRORS.PROTOCOL });
      }
      return { events: res.events, cursor: res.cursor === undefined ? input.cursor : res.cursor };
    },

    async send(message) {
      if (!message || typeof message.type !== 'string') {
        throw Object.assign(new Error('消息缺少 type'), { code: ERRORS.PROTOCOL });
      }
      return request('POST', '/messages', message);
    },

    async cancel(taskId) {
      if (!taskId) throw Object.assign(new Error('cancel 需要 taskId'), { code: ERRORS.PROTOCOL });
      return request('POST', '/tasks/' + encodeURIComponent(taskId) + '/cancel', { reason: 'client_cancel' });
    }
  };
}

module.exports = { createHttpPlatform };
