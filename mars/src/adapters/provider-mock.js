'use strict';
// 确定性 Mock Provider（M12）。
//
// 用途：在没有模型凭据的环境里，把**执行层的每一条路径**都跑到——
// 正常多轮、工具调用、工具失败、provider 报错、超时、取消。
//
// 诚实性约束（代码强制，不靠自觉）：
//   本适配器产出的用量一律 `usage_source = 'estimated'`，
//   capabilities.usage = false。它**永远不能**被当成 provider 真实用量。
//
// 脚本形状（写在 agent 的 definition_json.mock 里）：
//   {
//     "turns": [
//       { "text": "…", "toolCalls": [{ "name": "write_file", "args": {...} }] },
//       { "text": "…", "usage": { "input": 120, "output": 40 } },
//       { "failWith": "PROVIDER_UPSTREAM_ERROR" },
//       { "delayMs": 5000, "text": "慢响应" }
//     ]
//   }
// 每个 session 独立消费自己的 turns；turns 用完后返回一段确定的收尾文本。

const { nowIso, estimateTokens } = require('../util');
const { validateProvider } = require('../ports/model-provider');

function createMockProvider(options = {}) {
  const scriptByAgent = options.scriptByAgent || {};
  const defaultScript = options.defaultScript || [
    { text: '（mock）已完成本轮，没有更多动作。' }
  ];
  // session_id -> { agentId, turns, cursor, messages, usage }
  const sessions = new Map();
  // session_id -> AbortController（模拟取消）
  const aborts = new Map();
  let seq = 0;

  function createSession(input) {
    seq += 1;
    const sessionId = input.session_id || `mock-sess-${String(seq).padStart(4, '0')}`;
    const agentId = input.agent_id || 'unknown';
    const turns = scriptByAgent[agentId] || defaultScript;
    sessions.set(sessionId, {
      sessionId, agentId, provider: 'mock', model: input.model || 'mock-1',
      turns, cursor: 0, messages: [], usage: { input: 0, output: 0 },
      createdAt: nowIso()
    });
    return {
      session_id: sessionId,
      external_id: null,
      provider: 'mock',
      model: input.model || 'mock-1',
      created_at: nowIso()
    };
  }

  function sessionOf(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) {
      const err = new Error('PROVIDER_SESSION_NOT_FOUND ' + sessionId);
      err.code = 'PROVIDER_SESSION_NOT_FOUND';
      throw err;
    }
    return s;
  }

  /**
   * 发一轮。同步返回（Mock 不需要真异步），但形状与真实适配器一致：
   * { text, tool_calls, usage, stop_reason, usage_source }
   */
  function sendMessage(sessionId, payload = {}) {
    const s = sessionOf(sessionId);
    if (payload.signal && payload.signal.aborted) {
      const err = new Error('PROVIDER_CANCELLED');
      err.code = 'PROVIDER_CANCELLED';
      throw err;
    }
    for (const m of payload.messages || []) s.messages.push(m);

    const turn = s.turns[Math.min(s.cursor, s.turns.length - 1)] || { text: '' };
    s.cursor += 1;

    if (turn.failWith) {
      const err = new Error(turn.failWith);
      err.code = turn.failWith;
      throw err;
    }
    if (typeof turn.delayMs === 'number' && turn.delayMs > 0 && payload.waitForDelay !== false) {
      // 真睡：给取消/超时留出可观测的时间窗（测试用它验证 race）。
      const until = Date.now() + turn.delayMs;
      while (Date.now() < until) {
        if (payload.signal && payload.signal.aborted) {
          const err = new Error('PROVIDER_CANCELLED');
          err.code = 'PROVIDER_CANCELLED';
          throw err;
        }
        // 忙等会烧 CPU，用 Atomics.wait 做精确短睡眠（无依赖）。
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }

    const inTok = turn.usage && typeof turn.usage.input === 'number'
      ? turn.usage.input
      : estimateTokens((payload.messages || []).map((m) => String(m.content || '')).join('\n'));
    const outTok = turn.usage && typeof turn.usage.output === 'number'
      ? turn.usage.output
      : estimateTokens(String(turn.text || ''));
    s.usage.input += inTok;
    s.usage.output += outTok;

    const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls.map((tc, i) => ({
      call_id: tc.call_id || `${s.sessionId}-call-${s.cursor}-${i}`,
      name: tc.name,
      args: tc.args || {}
    })) : [];

    return {
      text: String(turn.text || ''),
      tool_calls: toolCalls,
      stop_reason: toolCalls.length ? 'tool_use' : 'end_turn',
      usage: { input: inTok, output: outTok, cached: 0 },
      // 关键：mock 的用量永远不是 provider 真实用量。
      usage_source: 'estimated'
    };
  }

  function cancel(sessionId) {
    aborts.set(sessionId, true);
    return { cancelled: true, session_id: sessionId };
  }

  function getUsage(sessionId) {
    const s = sessionOf(sessionId);
    return {
      input_tokens: s.usage.input,
      output_tokens: s.usage.output,
      cached_tokens: 0,
      usage_source: 'estimated'
    };
  }

  function healthCheck() {
    return {
      ok: true,
      provider: 'mock',
      detail: '确定性模拟，不发起网络请求',
      checked_at: nowIso()
    };
  }

  const provider = {
    name: 'mock',
    capabilities: {
      sessions: true,
      tools: true,
      stream: false,
      cancel: true,
      resume: false,
      // false = 不提供真实用量。上层据此把 usage_source 落成 estimated。
      usage: false,
      concurrency: true,
      multiTurn: true
    },
    createSession, sendMessage, cancel, getUsage, healthCheck
  };

  const missing = validateProvider(provider);
  if (missing.length) throw new Error('PROVIDER_CONTRACT_INVALID mock: ' + missing.join(','));

  return provider;
}

module.exports = { createMockProvider };
