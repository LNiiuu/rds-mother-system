'use strict';
// Anthropic Messages 协议 Provider 适配器（M16）。
//
// 为什么要有第二个适配器：只接一种协议时，"能力清单"和"端口抽象"是无法被检验的
// ——任何抽象在只有一个实现时都成立。第二个实现才会暴露「哪些差异必须由适配器吃掉」。
//
// 与 openai-compat 的真实差异（不是换个 URL 就行）：
//   1. system 是顶层字段，不是 messages 里的一条
//   2. 工具定义是 {name, description, input_schema}，不是 function.arguments 字符串
//   3. 工具结果是一条 user 消息里的 tool_result 块，不是 role:'tool'
//   4. 用量字段是 input_tokens / output_tokens，没有 prompt_tokens
//   5. 必须带 anthropic-version 头
//
// 真实调用状态：NOT RUN —— 本环境没有 ANTHROPIC_API_KEY。
// 适配器本身用注入的 fetch 做过契约测试（见 tests/arch/provider-adapters.test.js）。

const { validateProvider } = require('../ports/model-provider');

const DEFAULT_TIMEOUT_MS = 60000;
const ANTHROPIC_VERSION = '2023-06-01';

function createAnthropicProvider(options = {}) {
  const env = options.env || process.env;
  const baseUrl = (options.baseUrl || env.MARS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const apiKey = options.apiKey || env.MARS_ANTHROPIC_API_KEY || '';
  const defaultModel = options.model || env.MARS_ANTHROPIC_MODEL || '';
  const timeoutMs = Number(options.timeoutMs || env.MARS_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const sessions = new Map();
  const controllers = new Map();

  function configured() {
    return Boolean(apiKey && defaultModel);
  }

  function createSession(input = {}) {
    if (!configured()) {
      const err = new Error('PROVIDER_NOT_CONFIGURED 需要 MARS_ANTHROPIC_API_KEY / MARS_ANTHROPIC_MODEL');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      throw err;
    }
    const sessionId = input.session_id || 'an-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    sessions.set(sessionId, { system: null, messages: [], model: input.model || defaultModel, usage: { input: 0, output: 0, cached: 0 } });
    return { session_id: sessionId, external_id: null, provider: 'anthropic', model: input.model || defaultModel, created_at: new Date().toISOString() };
  }

  /** 把内部消息形状翻译成 Messages API 形状。这是适配器的核心职责。 */
  function toWire(messages) {
    const out = [];
    let system = null;
    for (const m of messages) {
      if (m.role === 'system') { system = String(m.content || ''); continue; }
      if (m.role === 'tool') {
        // 内部是 role:'tool' + tool_call_id；Anthropic 要 user + tool_result 块
        out.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '') }]
        });
        continue;
      }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const blocks = [];
        if (m.content) blocks.push({ type: 'text', text: String(m.content) });
        for (const tc of m.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.call_id, name: tc.name, input: tc.args || {} });
        }
        out.push({ role: 'assistant', content: blocks });
        continue;
      }
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') });
    }
    return { system, messages: out };
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

    for (const m of payload.messages || []) s.messages.push(m);
    const wire = toWire(s.messages);

    const body = {
      model: payload.model || s.model,
      max_tokens: payload.maxTokens || 2048,
      messages: wire.messages
    };
    if (wire.system) body.system = wire.system;
    if (Array.isArray(payload.tools) && payload.tools.length) {
      body.tools = payload.tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.parameters || { type: 'object', properties: {} }
      }));
    }

    let res;
    try {
      res = await fetchImpl(baseUrl + '/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
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
    const blocks = Array.isArray(json.content) ? json.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
      call_id: b.id, name: b.name, args: b.input || {}
    }));

    let usage = null;
    if (json.usage && typeof json.usage.input_tokens === 'number') {
      usage = {
        input: json.usage.input_tokens,
        output: json.usage.output_tokens || 0,
        cached: json.usage.cache_read_input_tokens || 0
      };
      s.usage.input += usage.input;
      s.usage.output += usage.output;
      s.usage.cached += usage.cached;
    }
    if (text) s.messages.push({ role: 'assistant', content: text, tool_calls: toolCalls });

    return {
      text,
      tool_calls: toolCalls,
      stop_reason: json.stop_reason || (toolCalls.length ? 'tool_use' : 'end_turn'),
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
        provider: 'anthropic',
        detail: 'not_configured：缺 ' + [apiKey ? null : 'MARS_ANTHROPIC_API_KEY', defaultModel ? null : 'MARS_ANTHROPIC_MODEL'].filter(Boolean).join(' / '),
        checked_at: new Date().toISOString()
      };
    }
    return { ok: true, provider: 'anthropic', detail: 'configured：' + baseUrl + ' model=' + defaultModel + '（未发起探测请求）', checked_at: new Date().toISOString() };
  }

  const provider = {
    name: 'anthropic',
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
    createSession, sendMessage, cancel, getUsage, healthCheck,
    isConfigured: configured,
    // 供测试断言协议翻译
    _toWire: toWire
  };

  const missing = validateProvider(provider);
  if (missing.length) throw new Error('PROVIDER_CONTRACT_INVALID anthropic: ' + missing.join(','));

  return provider;
}

module.exports = { createAnthropicProvider };
