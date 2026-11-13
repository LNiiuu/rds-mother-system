'use strict';
// OpenAI 兼容 Provider 适配器（M12）。
//
// 刻意**不绑定任何厂商**：只认 OpenAI Chat Completions 的形状。
// 换 baseUrl + model 即可接 DeepSeek / Moonshot / 通义兼容模式 / vLLM / Ollama 的 /v1。
// 这不是"支持所有平台"，而是"支持实现了这一种协议的平台"——能力清单里如实写。
//
// 配置来源（全部走环境变量，绝不写进仓库）：
//   MARS_LLM_BASE_URL   例如 https://api.deepseek.com/v1
//   MARS_LLM_API_KEY    凭据；缺失时 healthCheck 报 not_configured，调用报 PROVIDER_NOT_CONFIGURED
//   MARS_LLM_MODEL      例如 deepseek-chat
//   MARS_LLM_TIMEOUT_MS 默认 60000
//
// 用量：只要响应里带 usage 就记 provider（真实）；不带就返回 null，由 Runtime 落 estimated。

const { validateProvider } = require('../ports/model-provider');

const DEFAULT_TIMEOUT_MS = 60000;

function nowIsoLocal() {
  return new Date().toISOString();
}

function createOpenAiCompatProvider(options = {}) {
  const env = options.env || process.env;
  const baseUrl = (options.baseUrl || env.MARS_LLM_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = options.apiKey || env.MARS_LLM_API_KEY || '';
  const defaultModel = options.model || env.MARS_LLM_MODEL || '';
  const timeoutMs = Number(options.timeoutMs || env.MARS_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const sessions = new Map();   // session_id -> { messages, model, usage }
  const controllers = new Map(); // session_id -> AbortController

  function configured() {
    return Boolean(baseUrl && apiKey && defaultModel);
  }

  function createSession(input = {}) {
    if (!configured()) {
      const err = new Error('PROVIDER_NOT_CONFIGURED 需要 MARS_LLM_BASE_URL / MARS_LLM_API_KEY / MARS_LLM_MODEL');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }
    const sessionId = input.session_id || 'oa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    sessions.set(sessionId, {
      messages: [],
      model: input.model || defaultModel,
      usage: { input: 0, output: 0, cached: 0 }
    });
    return { session_id: sessionId, external_id: null, provider: 'openai-compat', model: input.model || defaultModel, created_at: nowIsoLocal() };
  }

  function toWireMessages(messages) {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content ?? '') };
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.call_id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
          }))
        };
      }
      return { role: m.role, content: String(m.content ?? '') };
    });
  }

  async function sendMessage(sessionId, payload = {}) {
    const s = sessions.get(sessionId);
    if (!s) {
      const err = new Error('PROVIDER_SESSION_NOT_FOUND ' + sessionId);
      err.code = 'PROVIDER_SESSION_NOT_FOUND';
      throw err;
    }
    const controller = new AbortController();
    controllers.set(sessionId, controller);
    const timer = setTimeout(() => controller.abort(), payload.timeoutMs || timeoutMs);

    // M18：payload.messages 是 Runtime 维护的**完整**对话历史。
    // 适配器不再把它追加到 session（旧实现会让第二轮重复 system/user），
    // session 只保存身份、模型与累计用量。
    const history = payload.messages || [];
    s.messages = history.slice();

    const body = {
      model: payload.model || s.model,
      messages: toWireMessages(history),
      temperature: 0
    };
    if (Array.isArray(payload.tools) && payload.tools.length) {
      body.tools = payload.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }
      }));
      body.tool_choice = 'auto';
    }

    let res;
    try {
      res = await fetchImpl(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      controllers.delete(sessionId);
      const err = new Error(e.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE ' + e.message);
      err.code = e.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE';
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      controllers.delete(sessionId);
      const text = await res.text().catch(() => '');
      const err = new Error(`PROVIDER_HTTP_${res.status} ${text.slice(0, 300)}`);
      err.code = 'PROVIDER_HTTP_' + res.status;
      throw err;
    }

    const json = await res.json();
    controllers.delete(sessionId);
    const choice = (json.choices && json.choices[0]) || {};
    const msg = choice.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((tc) => {
      let args = {};
      try { args = JSON.parse(tc.function && tc.function.arguments ? tc.function.arguments : '{}'); } catch { args = { _raw: tc.function && tc.function.arguments }; }
      return { call_id: tc.id, name: tc.function ? tc.function.name : 'unknown', args };
    }) : [];

    // 真实的 usage 只在响应里有时才记 provider；否则交给 Runtime 估算。
    let usage = null;
    if (json.usage && typeof json.usage.prompt_tokens === 'number') {
      usage = {
        input: json.usage.prompt_tokens,
        output: json.usage.completion_tokens || 0,
        cached: (json.usage.prompt_tokens_details && json.usage.prompt_tokens_details.cached_tokens) || 0
      };
      s.usage.input += usage.input;
      s.usage.output += usage.output;
      s.usage.cached += usage.cached;
    }

    return {
      text: msg.content || '',
      tool_calls: toolCalls,
      stop_reason: choice.finish_reason || (toolCalls.length ? 'tool_use' : 'end_turn'),
      usage,
      usage_source: usage ? 'provider' : 'unknown'
    };
  }

  function cancel(sessionId) {
    const c = controllers.get(sessionId);
    if (c) c.abort();
    return { cancelled: Boolean(c), session_id: sessionId };
  }

  function getUsage(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) {
      const err = new Error('PROVIDER_SESSION_NOT_FOUND ' + sessionId);
      err.code = 'PROVIDER_SESSION_NOT_FOUND';
      throw err;
    }
    return {
      input_tokens: s.usage.input,
      output_tokens: s.usage.output,
      cached_tokens: s.usage.cached,
      usage_source: s.usage.input || s.usage.output ? 'provider' : 'unknown'
    };
  }

  function healthCheck() {
    if (!configured()) {
      return {
        ok: false,
        provider: 'openai-compat',
        detail: 'not_configured：缺 ' + [
          baseUrl ? null : 'MARS_LLM_BASE_URL',
          apiKey ? null : 'MARS_LLM_API_KEY',
          defaultModel ? null : 'MARS_LLM_MODEL'
        ].filter(Boolean).join(' / '),
        checked_at: nowIsoLocal()
      };
    }
    return {
      ok: true,
      provider: 'openai-compat',
      detail: 'configured：' + baseUrl + ' model=' + defaultModel + '（未发起探测请求）',
      checked_at: nowIsoLocal()
    };
  }

  const provider = {
    name: 'openai-compat',
    capabilities: {
      sessions: true,
      tools: true,
      stream: false,
      cancel: true,
      resume: false,
      // 取决于服务端是否回 usage；运行时按响应实际情况落 provider / unknown。
      usage: true,
      concurrency: true,
      multiTurn: true
    },
    createSession, sendMessage, cancel, getUsage, healthCheck,
    // 供 CLI 判断是否可发起真实调用
    isConfigured: configured
  };

  const missing = validateProvider(provider);
  if (missing.length) throw new Error('PROVIDER_CONTRACT_INVALID openai-compat: ' + missing.join(','));

  return provider;
}

module.exports = { createOpenAiCompatProvider };
