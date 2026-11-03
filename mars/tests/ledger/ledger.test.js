'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const ledger = require('../../src/ledger');
const { validate } = require('../../src/validate');

const LEDGER_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'ledger.schema.json'), 'utf8'));

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mars-ledger-'));
}

function jsonlFixture() {
  return [
    { type: 'session', version: 4, id: 'sess-test-1', createdAt: '2026-11-01T00:00:00.000Z' },
    { type: 'request/header', data: { model: 'deepseek-chat', provider: 'deepseek' } },
    { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 10, totalTokens: 360 } } },
    { type: 'tool/call', data: { name: 'read' } },
    { type: 'assistant/message', data: { usage: { inputTokens: 7, outputTokens: 3 } } },
    { type: 'assistant/message', data: { message: { content: 'no usage here' } } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
}

test('parseSession reads plain JSONL and sums only present usage fields', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'session.v4.jsonl');
  fs.writeFileSync(file, jsonlFixture(), 'utf8');
  const parsed = ledger.parseSession(file);
  assert.equal(parsed.session_id, 'sess-test-1');
  assert.equal(parsed.source_kind, 'dsh-session');
  assert.equal(parsed.usage_events, 2);
  assert.deepEqual(parsed.usage, { input: 107, output: 53, cacheRead: 200, cacheWrite: 10, total: 360 });
  assert.equal(parsed.model, 'deepseek-chat');
  assert.equal(parsed.provider, 'deepseek');
});

test('parseSession reads concatenated zstd frames', () => {
  if (typeof zlib.zstdCompressSync !== 'function') {
    test.skip('node:zlib zstdCompressSync unavailable');
    return;
  }
  const dir = tmpdir();
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const text = jsonlFixture();
  const cut = text.indexOf('\n') + 1;
  const frames = [text.slice(0, cut), text.slice(cut)].map(part => zlib.zstdCompressSync(Buffer.from(part, 'utf8')));
  fs.writeFileSync(file, Buffer.concat(frames));
  const parsed = ledger.parseSession(file);
  assert.equal(parsed.session_id, 'sess-test-1');
  assert.equal(parsed.usage_events, 2);
  assert.equal(parsed.usage.total, 360);
});

test('parseSession falls back to the session directory and skips corrupt lines', () => {
  const dir = tmpdir();
  const sessionDir = path.join(dir, '11111111-2222-3333-4444-555555555555');
  fs.mkdirSync(sessionDir);
  const file = path.join(sessionDir, 'session.v4.jsonl');
  fs.writeFileSync(file, 'not-json\n' + JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } }) + '\n', 'utf8');
  const parsed = ledger.parseSession(file);
  assert.equal(parsed.session_id, '11111111-2222-3333-4444-555555555555');
  assert.equal(parsed.usage_events, 1);
  assert.equal(parsed.usage.total, 3);
});

test('buildLedger conforms to ledger.schema.json and computes totals/cost', () => {
  const parsed = {
    session_id: 's1', path: 'C:/tmp/s1', usage_events: 2, source_kind: 'dsh-session',
    usage: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360 }
  };
  const book = ledger.buildLedger({ sessions: [parsed] });
  const result = validate(book, LEDGER_SCHEMA);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(book.version, '0.1.0');
  assert.equal(book.source, 'dsh-session');
  assert.deepEqual(book.totals, {
    input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360, cache_hit_rate: 0.666667
  });
  assert.equal(book.cost.currency, 'USD');
  assert.equal(book.cost.rates.input, 0.15);
  assert.equal(book.cost.estimate, 0.000046);
  assert.match(book.cost.basis, /not a provider invoice/);
  assert.equal(book.reconcile.diff_ratio, 0);
});

test('buildLedger warns on duplicate sessions and missing totalTokens', () => {
  const base = { usage_events: 1, usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const book = ledger.buildLedger({
    sessions: [
      Object.assign({ session_id: 'dup', path: 'a' }, base),
      Object.assign({ session_id: 'dup', path: 'b' }, base)
    ]
  });
  assert.ok(book.warnings.some(w => w.includes('duplicate session_id')));
  assert.ok(book.warnings.some(w => w.includes('totalTokens missing')));
});

test('reconcile accepts <=1% error and rejects larger diffs', () => {
  const book = ledger.buildLedger({
    sessions: [{ session_id: 's', path: 'p', usage_events: 1, usage: { input: 300, output: 50, cacheRead: 10, cacheWrite: 0, total: 360 } }]
  });
  assert.deepEqual(ledger.reconcile(book, 360), { checked: 1, matched: 1, diff_ratio: 0 });
  assert.equal(ledger.reconcile(book, 363).matched, 1); // 0.83%
  assert.equal(ledger.reconcile(book, 400).matched, 0);
  assert.equal(ledger.reconcile(book, 0).matched, 0);
  assert.deepEqual(ledger.reconcile(book, null), { checked: 0, matched: 0, diff_ratio: 0 });
});

test('toCsv accepts a single parseSession result (CLI compatibility)', () => {
  const csv = ledger.toCsv({
    session_id: 's', path: 'p', usage_events: 1,
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }
  });
  assert.ok(csv.startsWith(ledger.CSV_HEADER + '\n'));
  assert.ok(csv.includes('s,p,1'));
});

test('toCsv uses a fixed header, escapes cells and appends TOTAL', () => {
  const book = ledger.buildLedger({
    sessions: [
      { session_id: 's,1', path: 'C:/a"b', usage_events: 1, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } }
    ]
  });
  const csv = ledger.toCsv(book);
  assert.ok(csv.startsWith(ledger.CSV_HEADER + '\n'));
  assert.ok(csv.includes('"s,1"'));
  assert.ok(csv.includes('"C:/a""b"'));
  assert.ok(csv.trimEnd().endsWith('TOTAL,,,,,1,2,0,0,3'));
});
