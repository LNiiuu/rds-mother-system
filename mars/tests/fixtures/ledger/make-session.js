'use strict';
// 确定性 DSH v4 会话样本生成器（测试专用，不参与运行时）。
//
// 设计约束：
//   1. 不复制任何真实会话内容——所有事件由本文件按固定模板构造，数值由参数决定；
//   2. 每次生成字节相同（JSON.stringify 的键序即插入序，zstd 压缩参数固定）；
//   3. 只依赖 node 内置模块；
//   4. 事件字段名必须与 DSH 会话一致，否则测不到真实解析路径。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** 固定模板：2 条 assistant/message，合计 input=2000 output=500 cacheRead=2500 cacheWrite=0 total=5000。 */
const FIXTURE_EVENTS = [
  { type: 'session', version: 4, id: 'fixture-session-0001', createdAt: '2026-01-01T00:00:00.000Z' },
  { type: 'request/header', data: { model: 'fixture-model', provider: 'fixture-provider' } },
  {
    type: 'assistant/message',
    data: {
      message: { model: 'fixture-model' },
      usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 1600, cacheWriteTokens: 0, totalTokens: 3140 }
    }
  },
  { type: 'tool/result', data: { ok: true } },
  {
    type: 'assistant/message',
    data: {
      usage: { inputTokens: 800, outputTokens: 160, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 1860 }
    }
  }
];

/** 事件集合的期望统计值，供测试断言使用（与 ledger 的累加逻辑独立实现）。 */
function expectedTotals(events) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, usageEvents: 0 };
  for (const event of events) {
    if (!event || event.type !== 'assistant/message') continue;
    if (!event.data || !event.data.usage) continue;
    const u = event.data.usage;
    totals.usageEvents += 1;
    totals.input += Number(u.inputTokens) || 0;
    totals.output += Number(u.outputTokens) || 0;
    totals.cacheRead += Number(u.cacheReadTokens) || 0;
    totals.cacheWrite += Number(u.cacheWriteTokens) || 0;
    totals.total += Number(u.totalTokens) || 0;
  }
  return totals;
}

function zstdAvailable() {
  return typeof zlib.zstdCompressSync === 'function';
}

/** 把行切成若干帧（模拟 DSH 的「一次追加一帧」）。 */
function toFrames(events, frameCount) {
  const n = Math.max(1, Math.min(frameCount || 1, events.length));
  const size = Math.ceil(events.length / n);
  const frames = [];
  for (let i = 0; i < events.length; i += size) frames.push(events.slice(i, i + size));
  return frames;
}

/**
 * 写一个多帧 zstd 会话文件。
 * @returns {{ file: string, expected: object, frames: number }}
 */
function writeSession(dir, options = {}) {
  if (!zstdAvailable()) {
    throw new Error('FIXTURE_UNAVAILABLE: 当前 Node 缺少 zlib.zstdCompressSync，无法生成 zstd 会话样本');
  }
  const events = options.events || FIXTURE_EVENTS;
  const frames = toFrames(events, options.frames || 3);
  const buffers = frames.map(frame =>
    zlib.zstdCompressSync(Buffer.from(frame.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8'))
  );
  const file = path.join(dir, options.name || 'session.v4.jsonl.zstd');
  fs.writeFileSync(file, Buffer.concat(buffers));
  return { file, expected: expectedTotals(events), frames: frames.length };
}

/**
 * 写一个纯 JSONL 会话（无 zstd），用于格式错误/坏行场景。
 * @param {string[]} lines 原样写入的行（可含非法 JSON）
 */
function writePlainLines(dir, lines, name = 'session.v4.jsonl') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

/** 写一个多帧 zstd 文件，但每帧内容由调用方给定的原始文本决定（用于注入坏行）。 */
function writeRawFrames(dir, texts, name = 'session.v4.jsonl.zstd') {
  if (!zstdAvailable()) {
    throw new Error('FIXTURE_UNAVAILABLE: 当前 Node 缺少 zlib.zstdCompressSync，无法生成 zstd 会话样本');
  }
  const buffers = texts.map(t => zlib.zstdCompressSync(Buffer.from(t, 'utf8')));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat(buffers));
  return file;
}

module.exports = {
  FIXTURE_EVENTS,
  expectedTotals,
  toFrames,
  writeSession,
  writePlainLines,
  writeRawFrames,
  zstdAvailable
};
