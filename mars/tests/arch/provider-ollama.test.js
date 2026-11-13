'use strict';
// M21：Ollama 本地 Provider 契约测试（不依赖真实服务）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOllamaProvider } = require('../../src/adapters/provider-ollama');
const { validateProvider } = require('../../src/ports/model-provider');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init && init.method, body, headers: init && init.headers });
    const out = await handler({ url, init, body, index: calls.length - 1 });
    return {
      ok: out.status === undefined || out.status < 400,
      status: out.status || 200,
      json: async () => out.body,
      text: async () => JSON.stringify(out.body || {})
    };
  };
  fn.calls = calls;
  return fn;
}

test('M21 Ollama：端口契约与能力清单完整', () => {
  const p = createOllamaProvider({ env: {}, fetchImpl: fakeFetch(() => ({ body: { models: [] } })) });
  assert.deepEqual(validateProvider(p), []);
  assert.equal(p.capabilities.tools, true);
  assert.equal(p.capabilities.usage, true);
  assert.equal(p.capabilities.stream, false);
});

test('M21 Ollama：请求形状、工具声明、用量来源为 provider', async () => {
  const fetchImpl = fakeFetch(() => ({
    body: {
      model: 'qwen2.5:3b',
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a' } } }] },
      done: true,
      prompt_eval_count: 12,
      eval_count: 3
    }
  }));
  const p = createOllamaProvider({ env: {}, fetchImpl, model: 'qwen2.5:3b' });
  const s = p.createSession({});
  const out = await p.sendMessage(s.session_id, {
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'do' }],
    tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]
  });
  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(req.body.stream, false);
  assert.equal(req.body.model, 'qwen2.5:3b');
  assert.equal(req.body.messages.length, 2);
  assert.equal(req.body.tools[0].function.name, 'read_file');
  assert.equal(out.tool_calls.length, 1);
  assert.equal(out.tool_calls[0].name, 'read_file');
  assert.equal(out.tool_calls[0].args.path, 'a');
  assert.equal(out.usage.input, 12);
  assert.equal(out.usage.output, 3);
  assert.equal(out.usage_source, 'provider');
  assert.equal(out.stop_reason, 'tool_use');
});

test('M21 Ollama：多轮历史由 Runtime 提供，不重复 system/user', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { message: { content: 'ok' }, done: true, prompt_eval_count: 5, eval_count: 1 } }));
  const p = createOllamaProvider({ env: {}, fetchImpl });
  const s = p.createSession({});
  await p.sendMessage(s.session_id, { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'u1' }] });
  await p.sendMessage(s.session_id, {
    messages: [
      { role: 'system', content: 'sys' }, { role: 'user', content: 'u1' },
      { role: 'assistant', content: '', tool_calls: [{ call_id: 'c1', name: 'read_file', args: { path: 'a' } }] },
      { role: 'tool', content: 'OK' }
    ]
  });
  const second = fetchImpl.calls[1].body.messages;
  assert.equal(second.filter((m) => m.role === 'system').length, 1);
  assert.equal(second.filter((m) => m.role === 'user').length, 1);
  assert.equal(second.filter((m) => m.role === 'tool').length, 1);
  assert.equal(second[2].tool_calls[0].function.name, 'read_file');
});

test('M21 Ollama：健康检查读 /api/tags；不可达不抛', async () => {
  const okFetch = fakeFetch(() => ({ body: { models: [{ name: 'qwen2.5:3b' }] } }));
  const p = createOllamaProvider({ env: {}, fetchImpl: okFetch });
  const h = await p.healthCheck();
  assert.equal(h.ok, true);
  assert.deepEqual(h.detail.models, ['qwen2.5:3b']);

  const bad = createOllamaProvider({ env: {}, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const h2 = await bad.healthCheck();
  assert.equal(h2.ok, false);
  assert.match(h2.detail.message, /ECONNREFUSED/);
});

test('M21 Ollama：超时映射为 PROVIDER_TIMEOUT，HTTP 错误带状态码', async () => {
  const slow = createOllamaProvider({
    env: {},
    timeoutMs: 15,
    fetchImpl: async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    })
  });
  const s = slow.createSession({});
  await assert.rejects(
    () => slow.sendMessage(s.session_id, { messages: [{ role: 'user', content: 'x' }] }),
    (e) => e.code === 'PROVIDER_TIMEOUT'
  );

  const http500 = createOllamaProvider({
    env: {},
    fetchImpl: fakeFetch(() => ({ status: 500, body: { error: 'boom' } }))
  });
  const s2 = http500.createSession({});
  await assert.rejects(
    () => http500.sendMessage(s2.session_id, { messages: [{ role: 'user', content: 'x' }] }),
    (e) => e.code === 'PROVIDER_HTTP_500'
  );
});

test('M21 Ollama：主动取消映射为 PROVIDER_CANCELLED，不等于超时；calls 计数真实', async () => {
  const p = createOllamaProvider({
    env: {},
    fetchImpl: async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    })
  });
  const s = p.createSession({});
  const pending = p.sendMessage(s.session_id, { messages: [{ role: 'user', content: 'x' }] });
  setTimeout(() => { p.cancel(s.session_id); }, 10);
  await assert.rejects(() => pending, (e) => e.code === 'PROVIDER_CANCELLED');
  assert.equal(p.getUsage(s.session_id).calls, 1);
});
