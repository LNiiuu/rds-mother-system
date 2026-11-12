'use strict';
// M16：两个真实协议适配器的契约测试（不发网络请求，用注入的 fetch）。
//
// 这组测试证明的是「翻译是否正确」，不是「模型好不好」。
// 真实网络调用状态：NOT RUN —— 本环境没有任何 provider 凭据。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAiCompatProvider } = require('../../src/adapters/provider-openai-compat');
const { createAnthropicProvider } = require('../../src/adapters/provider-anthropic');
const { validateProvider } = require('../../src/ports/model-provider');

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = responder(url, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body)
    };
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------- openai-compat

test('M16 openai-compat：请求形状正确，工具调用与 usage 被正确翻译', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: {
      choices: [{ finish_reason: 'tool_calls', message: { content: '我先读文件', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 10 } }
    }
  }));
  const p = createOpenAiCompatProvider({ env: {}, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl });
  assert.deepEqual(validateProvider(p), []);

  const s = p.createSession({});
  const reply = await p.sendMessage(s.session_id, {
    messages: [
      { role: 'system', content: '你是 R2' },
      { role: 'user', content: '读文件' }
    ],
    tools: [{ name: 'read_file', description: '读', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]
  });

  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://x/v1/chat/completions');
  assert.equal(req.init.headers.authorization, 'Bearer k');
  assert.equal(req.body.model, 'm');
  assert.equal(req.body.messages.length, 2);
  assert.equal(req.body.tools[0].function.name, 'read_file');

  assert.equal(reply.text, '我先读文件');
  assert.equal(reply.tool_calls.length, 1);
  assert.deepEqual(reply.tool_calls[0].args, { path: 'a.txt' });
  assert.equal(reply.usage.source, undefined);
  assert.deepEqual(reply.usage, { input: 120, output: 30, cached: 10 });
  assert.equal(reply.usage_source, 'provider');
});

test('M16 openai-compat：未配置时明确失败，不静默降级', () => {
  const p = createOpenAiCompatProvider({ env: {}, fetchImpl: fakeFetch(() => ({ status: 200, body: {} })) });
  assert.equal(p.healthCheck().ok, false);
  assert.match(p.healthCheck().detail, /not_configured/);
  assert.throws(() => p.createSession({}), /PROVIDER_NOT_CONFIGURED/);
  assert.equal(p.capabilities.usage, true);
  assert.equal(p.capabilities.stream, false);
});

test('M16 openai-compat：5xx 归为可重试错误码，4xx 不可重试', async () => {
  const p500 = createOpenAiCompatProvider({
    env: {}, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm',
    fetchImpl: fakeFetch(() => ({ status: 503, body: { error: 'busy' } }))
  });
  const s = p500.createSession({});
  await assert.rejects(() => p500.sendMessage(s.session_id, { messages: [] }), /PROVIDER_HTTP_503/);

  const p400 = createOpenAiCompatProvider({
    env: {}, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm',
    fetchImpl: fakeFetch(() => ({ status: 400, body: { error: 'bad' } }))
  });
  const s2 = p400.createSession({});
  await assert.rejects(() => p400.sendMessage(s2.session_id, { messages: [] }), /PROVIDER_HTTP_400/);

  const { isRetryable } = require('../../src/runtime/reliability');
  assert.equal(isRetryable('PROVIDER_HTTP_503'), true);
  assert.equal(isRetryable('PROVIDER_HTTP_400'), false);
});

// ---------------------------------------------------------------- anthropic

test('M16 anthropic：system 提到顶层、工具用 input_schema、tool_result 用 user 块', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: {
      content: [{ type: 'text', text: '结论' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 25, cache_read_input_tokens: 5 }
    }
  }));
  const p = createAnthropicProvider({ env: {}, baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-x', fetchImpl });

  const s = p.createSession({});
  // 先演练 wire 翻译：tool 消息必须变成 user + tool_result
  const wire = p._toWire([
    { role: 'system', content: '你是 R2' },
    { role: 'user', content: '读文件' },
    { role: 'assistant', content: '', tool_calls: [{ call_id: 'tu1', name: 'read_file', args: { path: 'a' } }] },
    { role: 'tool', tool_call_id: 'tu1', content: 'OK' }
  ]);
  assert.equal(wire.system, '你是 R2');
  assert.equal(wire.messages.length, 3);
  assert.equal(wire.messages[1].content[0].type, 'tool_use');
  assert.equal(wire.messages[1].content[0].id, 'tu1');
  assert.equal(wire.messages[2].role, 'user');
  assert.equal(wire.messages[2].content[0].type, 'tool_result');
  assert.equal(wire.messages[2].content[0].tool_use_id, 'tu1');

  const reply = await p.sendMessage(s.session_id, {
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    tools: [{ name: 'read_file', description: '读', parameters: { type: 'object', properties: {} } }]
  });

  const req = fetchImpl.calls[0];
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.init.headers['x-api-key'], 'k');
  assert.equal(req.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.body.system, 'sys');
  assert.equal(req.body.tools[0].input_schema.type, 'object');
  assert.equal(req.body.tools[0].function, undefined, '不得残留 OpenAI 形状');

  assert.equal(reply.text, '结论');
  assert.deepEqual(reply.usage, { input: 200, output: 25, cached: 5 });
  assert.equal(reply.usage_source, 'provider');
});

test('M16 anthropic：tool_use 块被翻译成 tool_calls，未配置时拒绝', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: {
      content: [{ type: 'tool_use', id: 'tu9', name: 'run_test', input: { dir: 'test' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 }
    }
  }));
  const p = createAnthropicProvider({ env: {}, baseUrl: 'https://a', apiKey: 'k', model: 'm', fetchImpl });
  const s = p.createSession({});
  const reply = await p.sendMessage(s.session_id, { messages: [{ role: 'user', content: 'x' }] });
  assert.equal(reply.tool_calls.length, 1);
  assert.equal(reply.tool_calls[0].name, 'run_test');
  assert.deepEqual(reply.tool_calls[0].args, { dir: 'test' });
  assert.equal(reply.stop_reason, 'tool_use');

  const un = createAnthropicProvider({ env: {}, fetchImpl });
  assert.equal(un.healthCheck().ok, false);
  assert.throws(() => un.createSession({}), /PROVIDER_NOT_CONFIGURED/);
});

// ---------------------------------------------------------------- 能力清单

test('M16 能力清单：三个适配器的差异是显式声明，不是靠假设', () => {
  const mock = require('../../src/adapters/provider-mock').createMockProvider();
  const oa = createOpenAiCompatProvider({ env: {}, fetchImpl: fakeFetch(() => ({ status: 200, body: {} })) });
  const an = createAnthropicProvider({ env: {}, fetchImpl: fakeFetch(() => ({ status: 200, body: {} })) });

  // mock 不提供真实用量 —— 这是代码强制，不靠文档
  assert.equal(mock.capabilities.usage, false);
  assert.equal(oa.capabilities.usage, true);
  assert.equal(an.capabilities.usage, true);
  // 三者都不支持流式与会话恢复：没有实现就不声明
  for (const p of [mock, oa, an]) {
    assert.equal(p.capabilities.stream, false);
    assert.equal(p.capabilities.resume, false);
  }
});
