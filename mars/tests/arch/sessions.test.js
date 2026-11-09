'use strict';
// M3 / B3：SessionSource 端口、注册表与数据源契约。
//
// 这组用例守的是「账本不认识 DSH」这件事：
//   - ledger.js 不得再出现 DSH 事件词汇；
//   - 换数据源只动注册表，不动账本算法；
//   - 无法识别/多个命中/损坏字节都要有明确错误码，而不是静默返回 0。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSessionRegistry } = require('../../src/session-registry');
const { createDshSessionSource, zstdFrames } = require('../../src/adapters/dsh-session-source');
const { createRuntime } = require('../../src/composition');
const ledger = require('../../src/ledger');
const { METHODS, ERRORS } = require('../../src/ports/session-source');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'ledger', 'make-session.js');
const fx = require(FIXTURE);

test('B3 端口契约：三个方法，错误码齐全', () => {
  assert.deepEqual(METHODS.slice().sort(), ['kind', 'parse', 'sniff']);
  assert.equal(METHODS.length <= 5, true);
  assert.equal(ERRORS.CORRUPT, 'SESSION_CORRUPT');
  assert.equal(ERRORS.UNSUPPORTED, 'SOURCE_UNSUPPORTED');
  assert.equal(ERRORS.AMBIGUOUS, 'SOURCE_AMBIGUOUS');
});

test('B3 注册表：按 kind 取、按字节嗅探、多命中拒绝猜测', () => {
  const dsh = createDshSessionSource();
  const registry = createSessionRegistry().register(dsh);
  assert.deepEqual(registry.list(), ['dsh-session']);
  assert.equal(registry.resolve({ kind: 'dsh-session' }), dsh);

  assert.throws(() => registry.resolve({ kind: 'no-such-source' }), (err) => {
    assert.equal(err.code, 'SOURCE_UNSUPPORTED');
    assert.match(err.message, /dsh-session/);
    return true;
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-sessions-'));
  try {
    const made = fx.writeSession(dir, { name: 'session.v4.jsonl.zstd', frames: 2 });
    const bytes = fs.readFileSync(made.file);
    assert.equal(registry.resolve({ bytes }), dsh, '嗅探应命中唯一来源');

    assert.throws(() => registry.resolve({ bytes: Buffer.from('not a session at all', 'utf8') }), (err) => err.code === 'SOURCE_UNSUPPORTED');
    assert.throws(() => registry.resolve({}), (err) => err.code === 'SOURCE_UNSUPPORTED');

    // 两个都能嗅探 -> 必须拒绝，而不是挑第一个
    const twin = createSessionRegistry().register(dsh).register({
      kind: () => 'twin', sniff: () => true, parse: () => ({})
    });
    assert.throws(() => twin.resolve({ bytes }), (err) => err.code === 'SOURCE_AMBIGUOUS');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B3 DSH 适配器：明文与多帧 zstd 都能解析，损坏帧报 SESSION_CORRUPT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-dsh-'));
  try {
    const made = fx.writeSession(dir, { name: 'a.v4.jsonl.zstd', frames: 3 });
    const bytes = fs.readFileSync(made.file);
    const dsh = createDshSessionSource();
    assert.equal(dsh.sniff(bytes), true);
    const parsed = dsh.parse({ bytes, ref: made.file });
    assert.equal(parsed.source_kind, 'dsh-session');
    assert.equal(parsed.usage.total, made.expected.total);
    assert.equal(parsed.usage_events, made.expected.usageEvents);
    assert.equal(zstdFrames(bytes).length, 3);

    const plain = path.join(dir, 'plain.jsonl');
    fs.writeFileSync(plain, [
      JSON.stringify({ type: 'session', id: 'plain-1' }),
      JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } })
    ].join('\n') + '\n', 'utf8');
    const plainParsed = dsh.parse({ bytes: fs.readFileSync(plain), ref: plain });
    assert.equal(plainParsed.session_id, 'plain-1');
    assert.equal(plainParsed.usage.total, 15);

    // 声称是 zstd 但字节坏了
    const broken = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from('garbage')]);
    assert.throws(() => dsh.parse({ bytes: broken, ref: 'x' }), (err) => err.code === 'SESSION_CORRUPT');
    assert.throws(() => dsh.parse({ ref: 'x' }), (err) => err.code === 'SESSION_CORRUPT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B3 账本算法不认识 DSH：source_kind 由数据源给出并原样保留', () => {
  const book = ledger.buildLedger({
    sessions: [{
      session_id: 'any-1', path: 'x', usage_events: 2, source_kind: 'other-host',
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 }
    }]
  });
  assert.equal(book.source, 'other-host');
  assert.equal(book.sessions[0].source_kind, 'other-host');
  assert.equal(book.totals.total, 150);
  // 缺 source_kind 时保持历史默认，避免历史账本形状变化
  const legacy = ledger.buildLedger({ sessions: [{ session_id: 'l', usage: { input: 1, total: 1 } }] });
  assert.equal(legacy.sessions[0].source_kind, 'dsh-session');
});

test('B3 账本模块不再包含 DSH 事件词汇（结构断言）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ledger.js'), 'utf8');
  for (const word of ['assistant/message', 'request/header', 'inputTokens', 'zstd', 'node:fs']) {
    assert.equal(src.includes(word), false, 'ledger.js 不应出现 ' + word);
  }
});

test('B3 CLI 对不认识的 --source 给出明确错误码与退出码', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-ledger-cli-'));
  try {
    const cli = path.join(__dirname, '..', '..', 'src', 'cli.js');
    const made = fx.writeSession(dir, { name: 's.v4.jsonl.zstd', frames: 1 });
    const run = spawnSync(process.execPath, [cli, 'ledger', '--source', 'nope', '--session', made.file], {
      encoding: 'utf8', timeout: 60000
    });
    assert.equal(run.status, 4, run.stderr);
    assert.match(run.stderr, /SOURCE_UNSUPPORTED/);
    assert.match(run.stderr, /dsh-session/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B3 组合根注册了唯一的数据源，且运行时可解析', () => {
  const runtime = createRuntime({});
  assert.deepEqual(runtime.sessions.list(), ['dsh-session']);
  assert.equal(typeof runtime.sessions.resolve({ kind: 'dsh-session' }).parse, 'function');
});
