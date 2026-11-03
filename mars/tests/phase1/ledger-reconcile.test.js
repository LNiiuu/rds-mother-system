'use strict';
// A1: recon the real DSH session files against provider usage and Phase 0 evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../../src/ledger');

const WORKSPACE = '--C-Users-liuch-Desktop-~8BA1~5212qpp--';
const SESSIONS = {
  R7: 'C:\\Users\\liuch\\.dsh\\sessions\\' + WORKSPACE + '\\adc6af6c-e78c-4df5-9da0-646fcd0abd74\\session.v4.jsonl.zstd',
  R3: 'C:\\Users\\liuch\\.dsh\\sessions\\' + WORKSPACE + '\\ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef\\session.v4.jsonl.zstd'
};
const PHASE0 = { R7: 41597577 };

function rawTotals(file) {
  const buf = fs.readFileSync(file);
  const frames = ledger.zstdFrames(buf);
  let usageEvents = 0;
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, total = 0;
  for (const frame of frames) {
    const text = zlib.zstdDecompressSync(frame).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (err) { continue; }
      if (!event || event.type !== 'assistant/message' || !event.data || !event.data.usage) continue;
      const u = event.data.usage;
      usageEvents += 1;
      input += Number(u.inputTokens) || 0;
      output += Number(u.outputTokens) || 0;
      cacheRead += Number(u.cacheReadTokens) || 0;
      cacheWrite += Number(u.cacheWriteTokens) || 0;
      total += Number(u.totalTokens) || 0;
    }
  }
  return { usageEvents, input, output, cacheRead, cacheWrite, total };
}

test('A1 R7 session parses and matches an independent frame decode', (t) => {
  const file = SESSIONS.R7;
  if (!fs.existsSync(file)) { t.skip('R7 session missing: ' + file); return; }
  const parsed = ledger.parseSession(file);
  const raw = rawTotals(file);
  assert.equal(parsed.usage_events, raw.usageEvents);
  assert.deepEqual(parsed.usage, {
    input: raw.input, output: raw.output, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite, total: raw.total
  });
  assert.equal(raw.total, raw.input + raw.output + raw.cacheRead + raw.cacheWrite);
  assert.equal(raw.cacheWrite, 0);
});

test('A1 R7 ledger reconciles with Phase 0 evidence within 1%', (t) => {
  const file = SESSIONS.R7;
  if (!fs.existsSync(file)) { t.skip('R7 session missing: ' + file); return; }
  const parsed = ledger.parseSession(file);
  const built = ledger.buildLedger({ sessions: [parsed] });
  const rec = ledger.reconcile(built, PHASE0.R7);
  assert.equal(rec.matched, 1, 'diff_ratio=' + rec.diff_ratio);
  assert.ok(rec.diff_ratio <= 0.01);
  assert.equal(built.totals.total, PHASE0.R7);
});

test('A1 R3 session parses deterministically (independent sum)', (t) => {
  const file = SESSIONS.R3;
  if (!fs.existsSync(file)) { t.skip('R3 session missing: ' + file); return; }
  const parsed = ledger.parseSession(file);
  const raw = rawTotals(file);
  assert.equal(parsed.usage_events, raw.usageEvents);
  assert.equal(parsed.usage.total, raw.total);
  assert.equal(parsed.session_id, 'ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef');
  assert.ok(parsed.usage.total > 0);
});

test('A1 CLI ledger writes ledger.json and ledger.csv offline', (t) => {
  const file = SESSIONS.R7;
  if (!fs.existsSync(file)) { t.skip('R7 session missing: ' + file); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-p1-ledger-'));
  const cli = path.resolve(__dirname, '..', '..', 'src', 'cli.js');
  const run = spawnSync(process.execPath, [cli, 'ledger', '--session', file, '--out', path.join(dir, 'out'), '--db', path.join(dir, 'cli.db')], {
    encoding: 'utf8', timeout: 120000
  });
  assert.equal(run.status, 0, run.stderr);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'ledger.json'), 'utf8'));
  const csv = fs.readFileSync(path.join(dir, 'out', 'ledger.csv'), 'utf8');
  assert.equal(json.usage.total, PHASE0.R7);
  assert.match(csv.split('\n')[0], /^session_id,path,usage_events,model,provider,input,output,cacheRead,cacheWrite,total$/);
  assert.ok(csv.trim().split('\n').pop().startsWith('TOTAL,'));
});
