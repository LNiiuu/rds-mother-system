'use strict';
// 适配器：DSH v4 会话文件（M3 / B3）。
//
// 本文件承接原 mars/src/ledger.js 的 1-147 行：zstd 多帧解析、事件词汇、用量累加。
// 这些都属于「DSH 这个宿主的数据格式」，因此从账本领域逻辑里搬出来。
//
// 保持不变的行为（有回归测试）：
//   - 多帧 zstd 逐帧解压后拼接；
//   - 一条损坏的 JSON 行被跳过，不伪造用量；
//   - 没有 usage 事件时 usage_events=0、usage 全 0；
//   - session_id 缺失时回落到目录名 / 文件名；
//   - 输出仍是 source_kind='dsh-session'（契约 ledger.schema.json 目前用 const 锁定，本轮不改）。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { AppError } = require('../errors');
const { ERRORS } = require('../ports/session-source');

const ZSTD_MAGIC = 0xFD2FB528;
const SOURCE_KIND = 'dsh-session';

// DSH 的事件词汇映射。这是本文件存在的核心理由：它只对 DSH 成立。
const USAGE_KEYS = {
  input: 'inputTokens',
  output: 'outputTokens',
  cacheRead: 'cacheReadTokens',
  cacheWrite: 'cacheWriteTokens',
  total: 'totalTokens'
};
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];

function isZstd(buf) {
  return buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC;
}

// DSH writes one zstd frame per append batch. Parse frame boundaries manually so
// concatenated frames can be fed to zstdDecompressSync one at a time.
function zstdFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    if (buf.length - pos < 5 || buf.readUInt32LE(pos) !== ZSTD_MAGIC) {
      throw new AppError(ERRORS.CORRUPT, 'bad zstd magic at byte ' + pos);
    }
    const descriptor = buf[pos + 4];
    const fcsFlag = (descriptor >> 6) & 0x3;
    const singleSegment = (descriptor >> 5) & 0x1;
    const dictFlag = descriptor & 0x3;
    const checksum = (descriptor >> 2) & 0x1;
    let q = pos + 5;
    // Frame content size field (length depends on flag and single-segment bit).
    if (fcsFlag === 0) {
      if (singleSegment) q += 1;
    } else if (fcsFlag === 1) q += 2;
    else if (fcsFlag === 2) q += 4;
    else q += 8;
    if (!singleSegment) q += 1; // window descriptor
    q += [0, 1, 2, 4][dictFlag]; // dictionary id
    for (;;) {
      if (buf.length - q < 3) throw new AppError(ERRORS.CORRUPT, 'truncated block header');
      const header = buf.readUIntLE(q, 3);
      q += 3;
      const last = header & 0x1;
      const blockType = (header >> 1) & 0x3;
      const blockSize = header >> 3;
      q += blockType === 1 ? 1 : blockSize; // RLE block payload is one byte
      if (q > buf.length) throw new AppError(ERRORS.CORRUPT, 'truncated block payload');
      if (last) break;
    }
    if (checksum) q += 4;
    if (q > buf.length) throw new AppError(ERRORS.CORRUPT, 'truncated checksum');
    frames.push(buf.subarray(start, q));
    pos = q;
  }
  return frames;
}

function decodeSessionBytes(buf) {
  if (!isZstd(buf)) return buf.toString('utf8').replace(/^\uFEFF/, '');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new AppError('ZSTD_UNSUPPORTED', 'this Node.js build lacks zlib.zstdDecompressSync');
  }
  return zstdFrames(buf)
    .map(frame => zlib.zstdDecompressSync(frame).toString('utf8'))
    .join('');
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

function parseEvents(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (err) {
      // A corrupt line must not fabricate usage; skip it and keep the rest.
    }
  }
  return events;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/** DSH 的 usage 字段名 -> 账本的规范字段名。只在本文件使用。 */
function normalizeDshUsage(raw) {
  const usage = emptyUsage();
  if (!raw || typeof raw !== 'object') return usage;
  for (const field of FIELDS) usage[field] = toInt(raw[USAGE_KEYS[field]]);
  return usage;
}

/** 从字节解析一个 DSH v4 会话。纯函数：不读盘、不写盘。 */
function parseDshSession(bytes, ref) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const events = parseEvents(decodeSessionBytes(buffer));
  const usage = emptyUsage();
  let usageEvents = 0;
  let sessionId = null;
  let model;
  let provider;

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (!sessionId && event.type === 'session' && typeof event.id === 'string') sessionId = event.id;
    if (!sessionId && typeof event.session_id === 'string') sessionId = event.session_id;
    if (!model && event.type === 'request/header' && event.data && typeof event.data.model === 'string') model = event.data.model;
    if (!model && event.type === 'assistant/message' && event.data && event.data.message && typeof event.data.message.model === 'string') model = event.data.message.model;
    if (!provider && event.type === 'request/header' && event.data && typeof event.data.provider === 'string') provider = event.data.provider;
    if (event.type !== 'assistant/message') continue;
    if (!event.data || !event.data.usage || typeof event.data.usage !== 'object') continue;
    usageEvents += 1;
    const one = normalizeDshUsage(event.data.usage);
    for (const field of FIELDS) usage[field] += one[field];
  }

  const refText = String(ref || '');
  if (!sessionId) {
    const dir = path.basename(path.dirname(refText));
    const base = path.basename(refText).replace(/\.(jsonl|zstd)(\.zstd)?$/gi, '');
    sessionId = dir && dir !== '.' && dir !== path.sep ? dir : base;
  }

  const result = {
    session_id: String(sessionId),
    path: refText,
    usage_events: usageEvents,
    usage,
    source_kind: SOURCE_KIND
  };
  if (model) result.model = model;
  if (provider) result.provider = provider;
  return result;
}

function createDshSessionSource() {
  return {
    kind() {
      return SOURCE_KIND;
    },
    sniff(bytes) {
      if (!bytes || !bytes.length) return false;
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      if (isZstd(buf)) return true;
      // 明文 JSONL：第一条非空行必须是对象且带 type 字段
      const head = buf.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim());
      if (!head) return false;
      try {
        const first = JSON.parse(head);
        return !!first && typeof first === 'object' && typeof first.type === 'string';
      } catch (err) {
        return false;
      }
    },
    parse(input) {
      const bytes = input && input.bytes;
      if (!bytes) throw new AppError(ERRORS.CORRUPT, 'parse 需要 bytes');
      return parseDshSession(bytes, input.ref);
    }
  };
}

/** 便捷方法：读文件并解析（I/O 只在适配器里）。 */
function parseSessionFile(file, source) {
  const absolute = path.resolve(String(file));
  const bytes = fs.readFileSync(absolute);
  const src = source || createDshSessionSource();
  return src.parse({ bytes, ref: absolute });
}

/** 解码成换行分隔的 JSON 文本（原 ledger.sessionText 的等价物）。 */
function sessionText(file) {
  return decodeSessionBytes(fs.readFileSync(path.resolve(String(file))));
}

module.exports = {
  SOURCE_KIND,
  createDshSessionSource,
  parseSessionFile,
  sessionText,
  zstdFrames,
  decodeSessionBytes
};
