#!/usr/bin/env node
'use strict';
// M21：Ollama 本地模型真实验证。
// 只有真实 HTTP 调用才算 PASS；模型缺失/工具调用不支持时如实标 FAIL/PARTIAL。

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createOllamaProvider } = require('../mars/src/adapters/provider-ollama');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'checks', 'm21');
const MODEL = process.env.M21_MODEL || process.argv[2] || 'qwen2.5:0.5b';
const OLLAMA = process.env.OLLAMA_BIN || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');

function now() { return Date.now(); }

async function timed(fn) {
  const t0 = now();
  try {
    const value = await fn();
    return { ok: true, value, ms: now() - t0 };
  } catch (e) {
    return { ok: false, error: { code: e.code || null, message: e.message }, ms: now() - t0 };
  }
}

function ps() {
  try {
    return execFileSync(OLLAMA, ['ps'], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) {
    return 'unavailable: ' + e.message;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const p = createOllamaProvider({ env: {}, model: MODEL, timeoutMs: 180000, numCtx: 8192 });
  const record = {
    demo: 'm21-ollama',
    generated_at: new Date().toISOString(),
    simulated: false,
    provider: 'ollama',
    model: MODEL,
    base_url: 'http://127.0.0.1:11434',
    health: null,
    tests: {},
    resources: {},
    notes: []
  };

  record.health = await p.healthCheck();
  if (!record.health.ok) {
    record.verdict = 'BLOCKED';
    record.notes.push('Ollama 服务不可用或模型未安装；未发起任何模型推理');
    fs.writeFileSync(path.join(OUT, 'execution-record.json'), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: record.verdict, health: record.health }, null, 2));
    return;
  }
  record.health.models = record.health.detail.models;
  const modelPresent = (record.health.detail.models || []).some((m) => m === MODEL || String(m).startsWith(MODEL + ':'));
  record.model_present = modelPresent;

  // 1) 基础对话
  const s1 = p.createSession({});
  record.tests.basic = await timed(async () => {
    const r = await p.sendMessage(s1.session_id, {
      messages: [{ role: 'system', content: '你是简洁的助手，最多两句话。' }, { role: 'user', content: '用一句话说明 2+2 等于几。' }]
    });
    if (!r.text || !r.text.trim()) throw new Error('空响应');
    return { text: r.text.slice(0, 300), usage: r.usage, metrics: r.metrics };
  });

  // 2) 结构化输出
  record.tests.structured = await timed(async () => {
    const r = await p.sendMessage(s1.session_id, {
      messages: [{ role: 'user', content: '只输出一个 JSON 对象，不要 markdown：{"ok":true,"sum":5}' }],
      format: 'json'
    });
    const parsed = JSON.parse(r.text);
    if (parsed.ok !== true || parsed.sum !== 5) throw new Error('JSON 字段不符合要求: ' + r.text.slice(0, 100));
    return { parsed, usage: r.usage };
  });

  // 3) 多轮
  const s2 = p.createSession({});
  record.tests.multi_turn = await timed(async () => {
    await p.sendMessage(s2.session_id, { messages: [{ role: 'user', content: '记住数字 42。只回答“好”。' }] });
    const r = await p.sendMessage(s2.session_id, {
      messages: [
        { role: 'user', content: '记住数字 42。只回答“好”。' },
        { role: 'assistant', content: '好' },
        { role: 'user', content: '刚才让你记住的数字是多少？只回答数字。' }
      ]
    });
    if (!/42/.test(r.text)) throw new Error('多轮未保留数字 42: ' + r.text.slice(0, 120));
    return { text: r.text.slice(0, 100), usage: r.usage };
  });

  // 4) 工具调用
  record.tests.tool_calling = await timed(async () => {
    const r = await p.sendMessage(s2.session_id, {
      messages: [{ role: 'user', content: '请调用 get_weather 工具查询北京的天气，不要直接回答。' }],
      tools: [{
        name: 'get_weather',
        description: '查询城市天气',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
      }]
    });
    if (!r.tool_calls || !r.tool_calls.length) throw new Error('模型未产生 tool_calls');
    return { tool_calls: r.tool_calls, usage: r.usage };
  });

  // 5) 长上下文（约 3k 字符）
  const filler = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 条：这是一段用于填充上下文的普通文本，不包含答案。`).join('\n');
  record.tests.long_context = await timed(async () => {
    const r = await p.sendMessage(p.createSession({}).session_id, {
      messages: [{ role: 'user', content: filler + '\n\n问题：上面一共有多少条“第 N 条”？只回答数字。' }]
    });
    if (!/60/.test(r.text)) throw new Error('长上下文计数不正确: ' + r.text.slice(0, 120));
    return { text: r.text.slice(0, 80), usage: r.usage, metrics: r.metrics };
  });

  // 6) 三个独立会话并发
  const concurrent = await timed(async () => {
    const jobs = [11, 12, 13].map(async (n) => {
      const s = p.createSession({});
      const t0 = now();
      const r = await p.sendMessage(s.session_id, {
        messages: [{ role: 'user', content: `只回答数字 ${n} 的平方，不要解释。` }]
      });
      return { n, session_id: s.session_id, text: r.text.trim().slice(0, 40), ms: now() - t0, usage: r.usage };
    });
    const out = await Promise.all(jobs);
    return out;
  });
  record.tests.concurrent = concurrent;
  if (concurrent.ok) {
    const sum = concurrent.value.reduce((a, x) => a + x.ms, 0);
    record.tests.concurrent.sum_ms = sum;
    record.tests.concurrent.overlap = concurrent.ms < sum * 0.9;
    record.tests.concurrent.distinct_sessions = new Set(concurrent.value.map((x) => x.session_id)).size === 3;
  }

  // 7) 不可达失败路径
  const bad = createOllamaProvider({ env: {}, baseUrl: 'http://127.0.0.1:11435', timeoutMs: 2000 });
  record.tests.failure_path = await timed(async () => {
    const h = await bad.healthCheck();
    if (h.ok) throw new Error('不可达端口不应健康');
    let sendError = null;
    try {
      const s = bad.createSession({});
      await bad.sendMessage(s.session_id, { messages: [{ role: 'user', content: 'x' }] });
    } catch (e) {
      sendError = { code: e.code, message: e.message };
    }
    if (!sendError) throw new Error('不可达端口必须抛错');
    return { health: h, send_error: sendError };
  });

  record.resources.ollama_ps = ps();
  record.resources.total_tokens = Object.values(record.tests).reduce((a, t) => {
    if (!t || !t.ok || !t.value) return a;
    const u = t.value.usage || (t.value[0] && t.value[0].usage);
    return a + (u ? (u.input || 0) + (u.output || 0) : 0);
  }, 0);

  // 判定：核心三项 + 并发必须通过；工具调用可 PARTIAL
  const core = ['basic', 'structured', 'multi_turn', 'long_context', 'failure_path'];
  const coreOk = core.every((k) => record.tests[k] && record.tests[k].ok);
  const toolOk = record.tests.tool_calling && record.tests.tool_calling.ok;
  const concurrentOk = concurrent.ok && record.tests.concurrent.distinct_sessions;
  record.verdict = coreOk && concurrentOk ? (toolOk ? 'PASS' : 'PARTIAL') : 'FAIL';
  if (!modelPresent) {
    record.verdict = 'BLOCKED';
    record.notes.push('模型未安装：' + MODEL + '；所有推理请求返回 PROVIDER_HTTP_404，未产生有效输出');
  }
  if (!toolOk) record.notes.push('模型未产生 tool_calls；工具调用能力标 PARTIAL，不影响基础对话结论');
  if (!record.tests.concurrent.overlap) record.notes.push('并发请求未观察到明显时间重叠（本地模型可能串行排队）');

  fs.writeFileSync(path.join(OUT, 'execution-record.json'), JSON.stringify(record, null, 2) + '\n');
  const summary = {
    verdict: record.verdict,
    model: MODEL,
    health: record.health,
    tests: Object.fromEntries(Object.entries(record.tests).map(([k, v]) => [k, { ok: v.ok, ms: v.ms, error: v.error || null }])),
    resources: record.resources
  };
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
