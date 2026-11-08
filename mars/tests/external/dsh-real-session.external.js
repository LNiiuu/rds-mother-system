'use strict';
// External 测试：真实 DSH 会话核对。
//
// 本文件**不属于** Required 测试集：
//   - 文件名是 *.external.js，不在 `node --test "mars/tests/**/*.test.js"` 的匹配范围内；
//   - 必须显式设置 RDS_IT_DSH_SESSION 指向一个真实会话文件才会执行；
//   - 未设置时整份文件失败并说明如何启用，避免「悄悄 0 个用例仍算绿」。
//
// 用途：验证 parseSession 在真实 DSH 产出上的行为（多帧 zstd、真实字段）。
// 不用于 CI 门禁——CI 机器上没有用户会话，也不应该读取。
const fs = require('node:fs');
const zlib = require('node:zlib');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../../src/ledger');

const SESSION = process.env.RDS_IT_DSH_SESSION || '';
const EXPECTED_TOTAL = process.env.RDS_IT_DSH_EXPECTED_TOTAL || '';

function rawTotals(file) {
  const frames = ledger.zstdFrames(fs.readFileSync(file));
  const acc = { usageEvents: 0, total: 0, cacheWrite: 0 };
  for (const frame of frames) {
    const text = zlib.zstdDecompressSync(frame).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch (err) { continue; }
      if (!event || event.type !== 'assistant/message' || !event.data || !event.data.usage) continue;
      const u = event.data.usage;
      acc.usageEvents += 1;
      acc.total += Number(u.totalTokens) || 0;
      acc.cacheWrite += Number(u.cacheWriteTokens) || 0;
    }
  }
  return acc;
}

if (!SESSION) {
  test('EXTERNAL 真实会话核对需要显式启用', () => {
    assert.fail(
      '未设置 RDS_IT_DSH_SESSION。\n' +
      '运行方式：RDS_IT_DSH_SESSION=<session.v4.jsonl.zstd 路径> npm run test:external\n' +
      '本文件是 External 测试，不属于 Required 门禁；CI 不执行它。'
    );
  });
} else {
  test('EXTERNAL 真实会话解析结果与独立逐帧解码一致', () => {
    const parsed = ledger.parseSession(SESSION);
    const raw = rawTotals(SESSION);
    assert.equal(parsed.usage_events, raw.usageEvents);
    assert.equal(parsed.usage.total, raw.total);
    assert.ok(parsed.usage.total > 0, '真实会话应包含 usage 事件');
  });

  test('EXTERNAL 真实会话可与外部给定的期望总量对账（可选）', () => {
    if (!EXPECTED_TOTAL) {
      assert.ok(true, '未提供 RDS_IT_DSH_EXPECTED_TOTAL，跳过对账断言');
      return;
    }
    const built = ledger.buildLedger({ sessions: [ledger.parseSession(SESSION)] });
    const rec = ledger.reconcile(built, Number(EXPECTED_TOTAL));
    assert.equal(rec.matched, 1, 'diff_ratio=' + rec.diff_ratio);
    assert.ok(rec.diff_ratio <= 0.01);
  });
}
