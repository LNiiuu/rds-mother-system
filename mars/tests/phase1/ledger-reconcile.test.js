'use strict';
// A1: 会话账本 —— 多帧 zstd 解析、对账、CSV/JSON 导出。
//
// 本文件只使用 mars/tests/fixtures/ledger 生成的**合成**会话样本：
//   - 不读取作者本机 .dsh 目录，不依赖任何真实会话、真实日期或真实文件大小；
//   - 断言值来自 fixture 的期望统计（独立实现），不是硬编码的历史常量；
//   - 缺少 fixture 或能力不足时**失败**并给出原因，不静默跳过。
//
// 真实会话的核对已移到 mars/tests/external/dsh-real-session.external.js（显式 opt-in）。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../../src/ledger');
const fixtures = require('../fixtures/ledger/make-session');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 独立解码：逐帧解压、逐行累加。刻意不复用 ledger 的累加逻辑，避免「用实现验证实现」。 */
function rawTotals(file) {
  const frames = ledger.zstdFrames(fs.readFileSync(file));
  const acc = { usageEvents: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const frame of frames) {
    const text = zlib.zstdDecompressSync(frame).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (err) { continue; }
      if (!event || event.type !== 'assistant/message' || !event.data || !event.data.usage) continue;
      const u = event.data.usage;
      acc.usageEvents += 1;
      acc.input += Number(u.inputTokens) || 0;
      acc.output += Number(u.outputTokens) || 0;
      acc.cacheRead += Number(u.cacheReadTokens) || 0;
      acc.cacheWrite += Number(u.cacheWriteTokens) || 0;
      acc.total += Number(u.totalTokens) || 0;
    }
  }
  return acc;
}

test('A1 多帧 zstd 会话可解析，且与独立逐帧解码一致', (t) => {
  assert.ok(fixtures.zstdAvailable(), 'FIXTURE_UNAVAILABLE: 当前 Node 缺少 zlib.zstdCompressSync');
  const dir = tempDir(t);
  const { file, expected } = fixtures.writeSession(dir, { frames: 3 });

  const parsed = ledger.parseSession(file);
  const raw = rawTotals(file);

  assert.equal(parsed.usage_events, expected.usageEvents);
  assert.equal(parsed.usage_events, raw.usageEvents);
  assert.deepEqual(parsed.usage, {
    input: expected.input,
    output: expected.output,
    cacheRead: expected.cacheRead,
    cacheWrite: expected.cacheWrite,
    total: expected.total
  });
  assert.deepEqual(raw, {
    usageEvents: expected.usageEvents,
    input: expected.input,
    output: expected.output,
    cacheRead: expected.cacheRead,
    cacheWrite: expected.cacheWrite,
    total: expected.total
  });
  // totalTokens 与四项分量的关系必须成立（fixture 保证上界自洽）
  assert.equal(raw.total, raw.input + raw.output + raw.cacheRead + raw.cacheWrite);
  assert.equal(parsed.session_id, 'fixture-session-0001');
  assert.equal(parsed.model, 'fixture-model');
  assert.equal(parsed.provider, 'fixture-provider');
});

test('A1 账本与 fixture 总量对账通过，超出 1% 时明确拒绝', (t) => {
  const dir = tempDir(t);
  const { file, expected } = fixtures.writeSession(dir);
  const built = ledger.buildLedger({ sessions: [ledger.parseSession(file)] });

  assert.equal(built.totals.total, expected.total);

  const exact = ledger.reconcile(built, expected.total);
  assert.equal(exact.checked, 1);
  assert.equal(exact.matched, 1, 'diff_ratio=' + exact.diff_ratio);
  assert.equal(exact.diff_ratio, 0);

  // 偏差 25% 必须判为不匹配，防止「任何输入都 reconcile 成功」的假通过
  const skewed = ledger.reconcile(built, Math.round(expected.total * 0.8));
  assert.equal(skewed.checked, 1);
  assert.equal(skewed.matched, 0);
  assert.ok(skewed.diff_ratio > 0.01);
});

test('A1 只有会话头、没有 usage 事件时不产出虚假用量', (t) => {
  const dir = tempDir(t);
  const events = [{ type: 'session', version: 4, id: 'fixture-empty-0001', createdAt: '2026-01-01T00:00:00.000Z' }];
  const { file } = fixtures.writeSession(dir, { events, frames: 1 });

  const parsed = ledger.parseSession(file);
  assert.equal(parsed.usage_events, 0);
  assert.deepEqual(parsed.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  assert.equal(parsed.session_id, 'fixture-empty-0001');

  const built = ledger.buildLedger({ sessions: [parsed] });
  assert.equal(built.totals.total, 0);
});

test('A1 损坏行被跳过，但不影响同一文件里合法行的统计', (t) => {
  const dir = tempDir(t);
  const header = JSON.stringify({ type: 'session', version: 4, id: 'fixture-corrupt-0001' });
  const good = JSON.stringify({
    type: 'assistant/message',
    data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0, totalTokens: 150 } }
  });
  const file = fixtures.writeRawFrames(dir, [
    header + '\n{ this is not json\n',
    good + '\n',
    '\n'
  ]);

  const parsed = ledger.parseSession(file);
  assert.equal(parsed.usage_events, 1, '坏行必须被跳过，合法行必须保留');
  assert.equal(parsed.usage.total, 150);
  assert.equal(parsed.session_id, 'fixture-corrupt-0001');
});

test('A1 会话文件不存在时抛出错误，而不是静默跳过', (t) => {
  const dir = tempDir(t);
  const missing = path.join(dir, 'not-there.v4.jsonl.zstd');
  assert.throws(() => ledger.parseSession(missing), /ENOENT/);
});

test('A1 同一 fixture 多次解析结果稳定', (t) => {
  const dir = tempDir(t);
  const { file } = fixtures.writeSession(dir);
  const first = ledger.parseSession(file);
  const second = ledger.parseSession(file);
  assert.deepEqual(
    { id: first.session_id, n: first.usage_events, u: first.usage },
    { id: second.session_id, n: second.usage_events, u: second.usage }
  );
});

test('A1 重复 session_id 会被记为警告，不静默合并', (t) => {
  const dir = tempDir(t);
  const { file } = fixtures.writeSession(dir);
  const parsed = ledger.parseSession(file);
  const built = ledger.buildLedger({ sessions: [parsed, parsed] });
  assert.ok(
    built.warnings.some(w => w.includes('duplicate session_id')),
    'warnings=' + JSON.stringify(built.warnings)
  );
  assert.equal(built.sessions.length, 2, '重复会话必须各自成行，不能合并');
});

test('A1 CLI ledger 离线写出 ledger.json 与 ledger.csv，总量与 fixture 一致', (t) => {
  const dir = tempDir(t);
  const { file, expected } = fixtures.writeSession(dir);
  const outDir = path.join(dir, 'out');
  const cli = path.resolve(__dirname, '..', '..', 'src', 'cli.js');

  const run = spawnSync(
    process.execPath,
    [cli, 'ledger', '--session', file, '--out', outDir, '--db', path.join(dir, 'cli.db')],
    { encoding: 'utf8', timeout: 120000 }
  );
  assert.equal(run.status, 0, run.stderr);

  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'ledger.json'), 'utf8'));
  // CLI 写的是单会话解析结果（parseSession 的返回），不是 buildLedger 的账本结构。
  assert.equal(json.usage.total, expected.total);
  assert.equal(json.usage_events, expected.usageEvents);
  assert.equal(json.session_id, 'fixture-session-0001');

  const csv = fs.readFileSync(path.join(outDir, 'ledger.csv'), 'utf8');
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'session_id,path,usage_events,model,provider,input,output,cacheRead,cacheWrite,total');
  const totalRow = lines[lines.length - 1].split(',');
  assert.equal(totalRow[0], 'TOTAL');
  assert.equal(Number(totalRow[9]), expected.total);
});
