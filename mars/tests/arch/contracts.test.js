'use strict';
// 契约一致性测试（M4 / B1）。
//
// 背景：M3 结束时 `ledger.schema.json` 是「声明了但没人执行」的契约 ——
// `mars/src` 对它零引用，ledger 输出从未被校验；同时 `source`/`source_kind`
// 用 `const: dsh-session` 把数据源锁死，而代码早已支持多来源（session-registry）。
//
// 本文件把契约变成可执行断言：
//   1. 五个契约都能通过真实解析器取出（发行包缺失会在这里红，而不是在用户机器上）；
//   2. buildLedger 的聚合输出符合契约；
//   3. CLI 单文件模式输出的会话记录符合 sessions.items；
//   4. 非法 source_kind 被模式拦住（而不是被静默接受）；
//   5. 已注册数据源的 kind 全部匹配模式，未注册的 kind 由注册表明确拒绝；
//   6. H-05 回归守卫：契约里不允许再出现 `const: dsh-session`。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validate } = require('../../src/validate');
const ledger = require('../../src/ledger');
const { testAssets } = require('../helpers/assets');
const { createSessionRegistry } = require('../../src/session-registry');
const { createDshSessionSource } = require('../../src/adapters/dsh-session-source');
const { KNOWN_CONTRACTS } = require('../../src/ports/asset-resolver');
const { FIXTURE_EVENTS, expectedTotals, zstdAvailable } = require('../fixtures/ledger/make-session');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCHEMA_DIR = path.join(REPO, 'mars', 'contracts');
const ledgerSchema = testAssets().contract('ledger').value;

// 与 fixtures/ledger/make-session.js 的构造保持一致的一条会话记录形状。
const SESSION_RECORD = Object.freeze({
  session_id: 'fixture-session-0001',
  path: 'C:/tmp/session.v4.jsonl.zstd',
  usage_events: 2,
  source_kind: 'dsh-session',
  model: 'fixture-model',
  provider: 'fixture-provider',
  usage: Object.freeze({ input: 2000, output: 500, cacheRead: 2500, cacheWrite: 0, total: 5000 })
});

test('B1 五个契约都能通过解析器取出，且文件名与端口声明一致', () => {
  assert.deepEqual(KNOWN_CONTRACTS.slice().sort(),
    ['context-packet', 'ledger', 'manifest', 'memory', 'role-routing']);
  for (const name of KNOWN_CONTRACTS) {
    const record = testAssets().contract(name);
    assert.equal(typeof record.hash, 'string', name + ' 缺 hash');
    assert.ok(record.hash.length === 64, name + ' 的 hash 不是 sha256');
    assert.equal(typeof record.value, 'object');
  }
});

test('B1 ledger 契约描述的是 buildLedger 的聚合输出，且该输出通过校验', () => {
  const built = ledger.buildLedger({ sessions: [Object.assign({}, SESSION_RECORD)] });
  const result = validate(built, ledgerSchema);
  assert.deepEqual(result.errors, [], '聚合输出应满足契约: ' + JSON.stringify(result.errors.slice(0, 3)));
  assert.equal(result.valid, true);
  // 契约里 source 必须跟着 sessions[0].source_kind 走，而不是写死
  assert.equal(built.source, 'dsh-session');
});

test('B1 CLI 单文件模式的会话记录符合 sessions.items', () => {
  const itemSchema = ledgerSchema.properties.sessions.items;
  const ok = validate(Object.assign({}, SESSION_RECORD), itemSchema);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.valid, true);
});

test('B1 非法 source_kind 被模式拦住（不是静默接受）', () => {
  const itemSchema = ledgerSchema.properties.sessions.items;
  const bad = Object.assign({}, SESSION_RECORD, { source_kind: 'DSH Session!' });
  const result = validate(bad, itemSchema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('B1 缺失必需字段的会话记录被拒绝', () => {
  const itemSchema = ledgerSchema.properties.sessions.items;
  const bad = Object.assign({}, SESSION_RECORD);
  delete bad.source_kind;
  assert.equal(validate(bad, itemSchema).valid, false);
});

test('B1 已注册数据源的 kind 全部匹配契约模式，未注册的 kind 由注册表拒绝', () => {
  const registry = createSessionRegistry().register(createDshSessionSource());
  const pattern = new RegExp(ledgerSchema.properties.source.pattern);
  const kinds = registry.list();
  assert.ok(kinds.length >= 1, '至少一个数据源');
  for (const kind of kinds) assert.match(kind, pattern, kind + ' 不匹配契约模式');

  assert.throws(
    () => registry.resolve({ kind: 'not-registered' }),
    (err) => err.code === 'SOURCE_UNSUPPORTED'
  );
  // 未指定 kind 且没有内容时也必须明确失败，不能默认挑一个
  assert.throws(() => registry.resolve({}), (err) => err.code === 'SOURCE_UNSUPPORTED');
});

test('H-05 回归守卫：契约不再用 const 锁死数据源', () => {
  const raw = fs.readFileSync(path.join(SCHEMA_DIR, 'ledger.schema.json'), 'utf8');
  assert.equal(raw.includes('"const": "dsh-session"'), false, 'source/source_kind 不得再用 const 锁死');
  assert.equal(typeof ledgerSchema.properties.source.pattern, 'string');
  assert.equal(typeof ledgerSchema.properties.sessions.items.properties.source_kind.pattern, 'string');
});

test('B1 真实会话经适配器解析后同样满足 sessions.items（端到端）', (t) => {
  if (!zstdAvailable()) {
    // 这不是"跳过"：契约测试必须真的跑过解析路径，缺能力就算失败。
    assert.fail('本机 Node 缺少 zlib.zstdCompressSync，无法构造 zstd 会话样本');
  }
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-contract-'));
  try {
    const zlib = require('node:zlib');
    const frames = [];
    const chunk = 3;
    for (let i = 0; i < FIXTURE_EVENTS.length; i += chunk) {
      const slice = FIXTURE_EVENTS.slice(i, i + chunk).map((e) => JSON.stringify(e)).join('\n') + '\n';
      frames.push(zlib.zstdCompressSync(Buffer.from(slice, 'utf8')));
    }
    const file = path.join(dir, 'session.v4.jsonl.zstd');
    fs.writeFileSync(file, Buffer.concat(frames));

    const parsed = createDshSessionSource().parse({ bytes: fs.readFileSync(file), ref: file });
    const result = validate(parsed, ledgerSchema.properties.sessions.items);
    assert.deepEqual(result.errors, []);
    assert.equal(parsed.usage.total, expectedTotals(FIXTURE_EVENTS).total);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
