'use strict';
// Ollama 本地模型 Provider（M21）。
//
// 与 openai-compat/anthropic 共用 ports/model-provider.js 的 5 个方法。
// 差异只在协议：POST /api/chat，工具调用是 message.tool_calls，用量是
// prompt_eval_count / eval_count（真实本地计数，不是估算）。
//
// 明确边界：
//   - 只连本机/显式配置的 Ollama，不自动切云端；
//   - 非流式（stream:false），能力清单里 stream=false；
//   - 没有会话恢复（resume=false），历史由 Runtime 提供。

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:3b';

function normalizeToolCalls(raw, sessionId, cursor) {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => {
    const fn = tc && tc.function ? tc.function : {};
    let args = fn.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }
    if (!args || typeof args !== 'object') args = {};
    return {
      call_id: tc.id || `${sessionId}-call-${cursor}-${i}`,
      name: fn.name || 'unknown',
      args
    };
  });
}

function toOllamaMessages(messages) {
  return (messages || []).map((m) => {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: String(m.content || ''),
        tool_calls: m.tool_calls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args || {} }
        }))
      };
    }
    if (m.role === 'tool') {
      const out = { role: 'tool', content: String(m.content ?? '') };
      if (m.name) out.tool_name = m.name;
      return out;
    }
    return { role: m.role, content: String(m.content ?? '') };
  });
}

function createOllamaProvider(options = {}) {
  const env = options.env || {};
  const baseUrl = String(options.baseUrl || env.MARS_OLLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const defaultModel = String(options.model || env.MARS_OLLAMA_MODEL || DEFAULT_MODEL);
  const timeoutMs = Number(options.timeoutMs || env.MARS_OLLAMA_TIMEOUT_MS || 120000);
  const numCtx = Number(options.numCtx || env.MARS_OLLAMA_NUM_CTX || 8192);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const sessions = new Map();
  const controllers = new Map();
  const cancelled = new Set();
  let seq = 0;

  function newSessionId() {
    seq += 1;
    return 'ollama-sess-' + seq + '-' + Math.random().toString(16).slice(2, 8);
  }

  async function api(path, init) {
    if (typeof fetchImpl !== 'function') {
      const e = new Error('当前环境没有 fetch');
      e.code = 'PROVIDER_UNAVAILABLE';
      throw e;
    }
    const res = await fetchImpl(baseUrl + path, init);
    return res;
  }

  async function healthCheck() {
    try {
      const res = await api('/api/tags', { method: 'GET' });
      if (!res.ok) return { ok: false, detail: { status: res.status, baseUrl } };
      const json = await res.json();
      return {
        ok: Array.isArray(json.models),
        detail: { baseUrl, models: (json.models || []).map((m) => m.name) }
      };
    } catch (e) {
      return { ok: false, detail: { baseUrl, message: e.message } };
    }
  }

  return {
    name: 'ollama',
    capabilities: {
      sessions: true,
      tools: true,
      stream: false,
      cancel: true,
      resume: false,
      usage: true,
      concurrency: true,
      multiTurn: true
    },

    healthCheck,

    createSession(input = {}) {
      const id = newSessionId();
      const s = {
        session_id: id,
        model: input.model || defaultModel,
        num_ctx: input.num_ctx || numCtx,
        usage: { input: 0, output: 0, cached: 0 },
        calls: 0,
        created_at: new Date().toISOString()
      };
      sessions.set(id, s);
      return { session_id: id, model: s.model, capabilities: this.capabilities };
    },

    async sendMessage(sessionId, payload = {}) {
      const s = sessions.get(sessionId);
      if (!s) {
        const e = new Error('PROVIDER_SESSION_NOT_FOUND ' + sessionId);
        e.code = 'PROVIDER_SESSION_NOT_FOUND';
        throw e;
      }
      const controller = new AbortController();
      cancelled.delete(sessionId);
      controllers.set(sessionId, controller);
      s.calls = Number(s.calls || 0) + 1;
      const timer = setTimeout(() => controller.abort(), payload.timeoutMs || timeoutMs);

      const body = {
        model: payload.model || s.model,
        messages: toOllamaMessages(payload.messages || []),
        stream: false,
        options: { temperature: 0, num_ctx: payload.num_ctx || s.num_ctx }
      };
      if (Array.isArray(payload.tools) && payload.tools.length) {
        body.tools = payload.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }
        }));
      }
      if (payload.format === 'json') body.format = 'json';

      let res;
      try {
        res = await api('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (e) {
        const byCancel = cancelled.has(sessionId);
        const byTimeout = e.name === 'AbortError' && !byCancel;
        const err = new Error(byCancel ? 'PROVIDER_CANCELLED' : (byTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE ' + e.message));
        err.code = byCancel ? 'PROVIDER_CANCELLED' : (byTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE');
        throw err;
      } finally {
        clearTimeout(timer);
        controllers.delete(sessionId);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const e = new Error(`PROVIDER_HTTP_${res.status} ${text.slice(0, 300)}`);
        e.code = 'PROVIDER_HTTP_' + res.status;
        throw e;
      }

      const json = await res.json();
      const msg = json.message || {};
      const toolCalls = normalizeToolCalls(msg.tool_calls, sessionId, Date.now());
      const usage = {
        input: Number(json.prompt_eval_count || 0),
        output: Number(json.eval_count || 0),
        cached: 0
      };
      s.usage.input += usage.input;
      s.usage.output += usage.output;
      s.usage.cached += usage.cached;

      return {
        text: String(msg.content || ''),
        tool_calls: toolCalls,
        stop_reason: toolCalls.length ? 'tool_use' : (json.done ? 'end_turn' : 'length'),
        usage,
        usage_source: 'provider',
        model: json.model || body.model,
        // 本地推理的耗时字段，便于资源记录；不是标准 Provider 契约的一部分。
        metrics: {
          total_duration_ms: json.total_duration ? Math.round(json.total_duration / 1e6) : null,
          load_duration_ms: json.load_duration ? Math.round(json.load_duration / 1e6) : null,
          eval_count: json.eval_count || 0,
          prompt_eval_count: json.prompt_eval_count || 0
        }
      };
    },

    async cancel(sessionId) {
      const c = controllers.get(sessionId);
      if (c) {
        cancelled.add(sessionId);
        c.abort();
        controllers.delete(sessionId);
        return { cancelled: true };
      }
      return { cancelled: false };
    },

    getUsage(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return { input: 0, output: 0, cached: 0, calls: 0 };
      return { ...s.usage, calls: Number(s.calls || 0) };
    },

    listSessions() {
      return Array.from(sessions.values()).map((s) => s.session_id);
    }
  };
}

module.exports = { createOllamaProvider, DEFAULT_BASE, DEFAULT_MODEL };
