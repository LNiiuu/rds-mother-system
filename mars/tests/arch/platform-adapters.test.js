'use strict';
// M22：通用平台适配层契约测试。
// 真实执行：本地 HTTP 往返、真实文件队列、WorkBuddy bridge 协议、内存参考实现。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { validatePlatformAdapter, CAPABILITY_KEYS, ERRORS } = require('../../src/ports/platform-adapter');
const { createPlatformRegistry } = require('../../src/platform-registry');
const { createPlatformClient } = require('../../src/platform-client');
const { createMemoryPlatform } = require('../../src/adapters/platform-memory');
const { createHttpPlatform } = require('../../src/adapters/platform-http');
const { createDshPlatform } = require('../../src/adapters/platform-dsh');
const { createWorkbuddyPlatform, CHANNELS } = require('../../src/adapters/platform-workbuddy');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------- HTTP 平台宿主

function startHttpPlatform() {
  const events = [];
  const tasks = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, name: 'http-test', version: '1.0.0' });
    if (req.method === 'GET' && url.pathname === '/tasks') {
      const cursor = Number(url.searchParams.get('cursor') || 0);
      return send(200, { events: events.slice(cursor), cursor: events.length });
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg = null;
      try { msg = body ? JSON.parse(body) : null; } catch { return send(400, { error: 'bad json' }); }
      if (req.method === 'POST' && url.pathname === '/messages') {
        if (msg.type === 'task.submit') {
          const id = 'http-' + (tasks.size + 1);
          tasks.set(id, msg);
          events.push({ type: 'task.status', task_id: id, status: 'running' });
          events.push({ type: 'task.result', task_id: id, status: 'succeeded', result: { echo: msg.objective } });
          return send(200, { platform_task_id: id, accepted: true });
        }
        return send(200, { accepted: true });
      }
      const cancel = /^\/tasks\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancel) {
        const id = decodeURIComponent(cancel[1]);
        events.push({ type: 'task.status', task_id: id, status: 'cancelled' });
        return send(200, { cancelled: true });
      }
      return send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: 'http://127.0.0.1:' + port });
    });
  });
}

// ---------------------------------------------------------------- WorkBuddy fake bridge

function fakeWorkbuddyBridge() {
  const calls = [];
  const queue = [];
  let cursor = 0;
  return {
    calls,
    bridge: {
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        if (channel === CHANNELS.HEALTH) return { ok: true, host: 'workbuddy-test', version: '37.10.3-43' };
        if (channel === CHANNELS.POLL) {
          const from = Number(payload.cursor || 0);
          const events = queue.slice(from);
          cursor = queue.length;
          return { events, cursor };
        }
        if (channel === CHANNELS.SEND) {
          if (payload.type === 'task.submit') {
            const id = 'wb-' + (queue.length + 1);
            queue.push({ type: 'task.status', task_id: id, status: 'running' });
            queue.push({ type: 'task.result', task_id: id, status: 'succeeded', result: { echo: payload.objective } });
            return { platform_task_id: id, accepted: true };
          }
          return { accepted: true };
        }
        if (channel === CHANNELS.CANCEL) return { cancelled: true };
        throw new Error('unknown channel ' + channel);
      }
    }
  };
}

function allCapabilities() {
  return Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
}

// ---------------------------------------------------------------- 契约

test('M22 端口：五个方法 + 九个能力键，缺一即不合格', () => {
  const good = {
    describe: () => ({ name: 'x', version: '1', capabilities: allCapabilities() }),
    healthCheck() {}, receive() {}, send() {}, cancel() {}
  };
  assert.deepEqual(validatePlatformAdapter(good), []);
  const bad = { describe: () => ({ name: 'x', version: '1', capabilities: { sessions: true } }) };
  const missing = validatePlatformAdapter(bad);
  assert.ok(missing.includes('healthCheck'));
  assert.ok(missing.includes('capabilities.tools'));
  for (const k of CAPABILITY_KEYS) assert.equal(typeof allCapabilities()[k], 'boolean');
});

test('M22 注册表：登记、按名取、重复拒绝、能力拒绝', () => {
  const reg = createPlatformRegistry();
  const mem = createMemoryPlatform();
  reg.register(mem);
  assert.deepEqual(reg.list(), ['memory']);
  assert.equal(reg.resolve('memory'), mem);
  assert.throws(() => reg.register(createMemoryPlatform()), /重复注册/);
  assert.throws(() => reg.resolve('nope'), /未知平台适配器/);
  assert.equal(reg.requireCapability('memory', 'tools'), mem);
  assert.throws(() => reg.requireCapability('memory', 'not-a-key'), /未知能力键/);

  // 能力矩阵必须能产生差异：DSH 文件队列没有工具执行，就必须拒绝 tools。
  const dsh = createDshPlatform({ root: tmp('m22-cap-') });
  reg.register(dsh);
  assert.equal(dsh.describe().capabilities.tools, false);
  assert.equal(dsh.describe().capabilities.lifecycle, false);
  assert.throws(() => reg.requireCapability('dsh', 'tools'), /不支持能力 tools/);
  assert.equal(reg.requireCapability('dsh', 'submit'), dsh);
});

test('M22 内存适配器：提交、结果、取消、上下文交接', async () => {
  const adapter = createMemoryPlatform();
  const client = createPlatformClient(adapter, { pollMs: 1 });
  const sub = await client.submit({ objective: 'hello', role_id: 'R1' });
  const out = await client.waitForResult(sub.platform_task_id, { timeoutMs: 2000 });
  assert.equal(out.status, 'succeeded');
  assert.equal(out.result.echo, 'hello');
  await client.handoff(sub.platform_task_id, { summary: 'ctx' });
  await assert.rejects(() => client.cancel('missing'), (e) => e.code === ERRORS.NOT_FOUND);
  const c = await client.cancel(sub.platform_task_id, 'test');
  assert.equal(c.cancelled, true);
});

test('M22 HTTP 适配器：真实本地服务往返、健康、结果、取消', async () => {
  const host = await startHttpPlatform();
  try {
    const adapter = createHttpPlatform({ baseUrl: host.baseUrl, timeoutMs: 3000 });
    const health = await adapter.healthCheck();
    assert.equal(health.ok, true);
    assert.equal(health.detail.name, 'http-test');

    const client = createPlatformClient(adapter, { pollMs: 2 });
    const sub = await client.submit({ objective: 'http hello' });
    const out = await client.waitForResult(sub.platform_task_id, { timeoutMs: 3000 });
    assert.equal(out.status, 'succeeded');
    assert.equal(out.result.echo, 'http hello');

    const cancel = await client.cancel(sub.platform_task_id);
    assert.equal(cancel.cancelled, true);
    assert.ok(adapter.describe().capabilities.reconnect);
  } finally {
    host.server.close();
  }
});

test('M22 HTTP 适配器：503 映射为 PLATFORM_UNAVAILABLE，健康检查不抛', async () => {
  const server = http.createServer((req, res) => { res.writeHead(503); res.end('down'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const adapter = createHttpPlatform({ baseUrl: 'http://127.0.0.1:' + port, timeoutMs: 1000 });
    const health = await adapter.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.detail.code, ERRORS.UNAVAILABLE);
  } finally {
    server.close();
  }
});

test('M22 DSH 适配器：真实文件队列、游标续读、取消写出', async () => {
  const root = tmp('m22-dsh-');
  const inbox = path.join(root, 'inbox.jsonl');
  fs.writeFileSync(inbox, [
    JSON.stringify({ type: 'task.submit', task_id: 'd1', objective: 'dsh task' }),
    JSON.stringify({ type: 'task.result', task_id: 'd1', status: 'succeeded', result: { echo: 'dsh task' } }),
    ''
  ].join('\n'), 'utf8');

  const adapter = createDshPlatform({ root });
  assert.equal((await adapter.healthCheck()).ok, true);
  const first = await adapter.receive({ cursor: 0 });
  assert.equal(first.events.length, 2);
  assert.equal(first.cursor, 2);

  fs.appendFileSync(inbox, JSON.stringify({ type: 'task.status', task_id: 'd1', status: 'running' }) + '\n');
  const second = await adapter.receive({ cursor: first.cursor });
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].type, 'task.status');

  await adapter.send({ type: 'task.result', task_id: 'd1', status: 'succeeded' });
  await adapter.cancel('d1');
  const out = fs.readFileSync(path.join(root, 'outbox.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'task.result');
  assert.equal(out[1].type, 'task.cancel');

  const missing = createDshPlatform({ root: path.join(root, 'nope') });
  await assert.rejects(() => missing.send({ type: 'task.status' }), (e) => e.code === ERRORS.UNAVAILABLE);
});

test('M22 WorkBuddy 适配器：bridge 通道契约、提交与取消', async () => {
  const fake = fakeWorkbuddyBridge();
  const adapter = createWorkbuddyPlatform({ bridge: fake.bridge, timeoutMs: 1000 });
  assert.equal(validatePlatformAdapter(adapter).length, 0);
  const health = await adapter.healthCheck();
  assert.equal(health.ok, true);

  const client = createPlatformClient(adapter, { pollMs: 1 });
  const sub = await client.submit({ objective: 'wb hello', role_id: 'R2' });
  const out = await client.waitForResult(sub.platform_task_id, { timeoutMs: 2000 });
  assert.equal(out.result.echo, 'wb hello');
  const cancel = await client.cancel(sub.platform_task_id);
  assert.equal(cancel.cancelled, true);

  const channels = fake.calls.map((c) => c.channel);
  for (const ch of [CHANNELS.HEALTH, CHANNELS.POLL, CHANNELS.SEND, CHANNELS.CANCEL]) {
    assert.ok(channels.includes(ch), '必须调用 ' + ch);
  }
  assert.equal(fake.calls.find((c) => c.channel === CHANNELS.SEND).payload.type, 'task.submit');
});

test('M22 WorkBuddy 适配器：bridge 缺失/超时都映射为可读错误，不抛平台原文', async () => {
  const noBridge = createWorkbuddyPlatform({});
  const h1 = await noBridge.healthCheck();
  assert.equal(h1.ok, false);
  assert.equal(h1.detail.code, ERRORS.UNAVAILABLE);

  const slow = createWorkbuddyPlatform({
    bridge: { invoke: () => new Promise((r) => setTimeout(() => r({ ok: true }), 500)) },
    timeoutMs: 20
  });
  const h2 = await slow.healthCheck();
  assert.equal(h2.ok, false);
  assert.equal(h2.detail.code, ERRORS.TIMEOUT);
});

test('M22 可替换性：同一套 PlatformClient 在四种适配器上得到同样结果', async () => {
  const host = await startHttpPlatform();
  const dshRoot = tmp('m22-replace-');
  fs.writeFileSync(path.join(dshRoot, 'inbox.jsonl'), '');
  const fake = fakeWorkbuddyBridge();

  const cases = [
    createMemoryPlatform(),
    createHttpPlatform({ baseUrl: host.baseUrl }),
    (() => {
      const a = createDshPlatform({ root: dshRoot });
      // DSH 宿主侧：收到 task.submit 后写入结果
      const originalSend = a.send.bind(a);
      a.send = async (msg) => {
        const r = await originalSend(msg);
        if (msg.type === 'task.submit') {
          fs.appendFileSync(path.join(dshRoot, 'inbox.jsonl'), JSON.stringify({
            type: 'task.result', task_id: msg.task_id || 'dsh-1', status: 'succeeded', result: { echo: msg.objective }
          }) + '\n');
          return { platform_task_id: msg.task_id || 'dsh-1', accepted: true };
        }
        return r;
      };
      return a;
    })(),
    createWorkbuddyPlatform({ bridge: fake.bridge })
  ];

  try {
    const results = [];
    for (const adapter of cases) {
      const client = createPlatformClient(adapter, { pollMs: 1 });
      const sub = await client.submit({ objective: 'same task', task_id: 'same-task' });
      const out = await client.waitForResult(sub.platform_task_id, { timeoutMs: 2000 });
      results.push({ name: adapter.describe().name, status: out.status, echo: out.result.echo });
    }
    assert.deepEqual(results.map((r) => r.status), ['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    assert.deepEqual(results.map((r) => r.echo), ['same task', 'same task', 'same task', 'same task']);
    assert.deepEqual(results.map((r) => r.name).sort(), ['dsh', 'http', 'memory', 'workbuddy']);
  } finally {
    host.server.close();
  }
});

test('M22 协议校验：未知消息/事件/缺 task_id 都拒绝', async () => {
  const client = createPlatformClient(createMemoryPlatform(), { pollMs: 1 });
  await assert.rejects(() => client.submit({ objective: '' }), /objective 必填/);
  await assert.rejects(() => client.submit({ objective: 'x' }).then(() => client.status('x', 'weird')), /非法任务状态/);
});
