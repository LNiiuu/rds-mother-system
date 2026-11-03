'use strict';
// M6 Usage Ledger — DSH session usage parser, reconciliation and CSV export.
// Local estimate only: token counts come from the session file; cost is NOT a provider invoice.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ZSTD_MAGIC = 0xFD2FB528;
const DEFAULTS = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 };
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const USAGE_KEYS = {
  input: 'inputTokens',
  output: 'outputTokens',
  cacheRead: 'cacheReadTokens',
  cacheWrite: 'cacheWriteTokens',
  total: 'totalTokens'
};

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
      throw new Error('DSH_SESSION_CORRUPT: bad zstd magic at byte ' + pos);
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
      if (buf.length - q < 3) throw new Error('DSH_SESSION_CORRUPT: truncated block header');
      const header = buf.readUIntLE(q, 3);
      q += 3;
      const last = header & 0x1;
      const blockType = (header >> 1) & 0x3;
      const blockSize = header >> 3;
      q += blockType === 1 ? 1 : blockSize; // RLE block payload is one byte
      if (q > buf.length) throw new Error('DSH_SESSION_CORRUPT: truncated block payload');
      if (last) break;
    }
    if (checksum) q += 4;
    if (q > buf.length) throw new Error('DSH_SESSION_CORRUPT: truncated checksum');
    frames.push(buf.subarray(start, q));
    pos = q;
  }
  return frames;
}

function decodeSessionBytes(buf) {
  if (!isZstd(buf)) return buf.toString('utf8').replace(/^\uFEFF/, '');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('ZSTD_UNSUPPORTED: this Node.js build lacks zlib.zstdDecompressSync');
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

function normalizeUsage(raw) {
  const usage = emptyUsage();
  if (!raw || typeof raw !== 'object') return usage;
  for (const field of FIELDS) usage[field] = toInt(raw[USAGE_KEYS[field]]);
  return usage;
}

function parseSession(file) {
  const absolute = path.resolve(String(file));
  const buf = fs.readFileSync(absolute);
  const events = parseEvents(decodeSessionBytes(buf));
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
    const one = normalizeUsage(event.data.usage);
    for (const field of FIELDS) usage[field] += one[field];
  }

  if (!sessionId) {
    const dir = path.basename(path.dirname(absolute));
    const base = path.basename(absolute).replace(/\.(jsonl|zstd)(\.zstd)?$/gi, '');
    sessionId = dir && dir !== '.' && dir !== path.sep ? dir : base;
  }

  const result = {
    session_id: String(sessionId),
    path: absolute,
    usage_events: usageEvents,
    usage,
    source_kind: 'dsh-session'
  };
  if (model) result.model = model;
  if (provider) result.provider = provider;
  return result;
}

function normalizeRates(rates) {
  const merged = Object.assign({}, DEFAULTS);
  if (rates && typeof rates === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      const n = Number(rates[key]);
      if (Number.isFinite(n) && n >= 0) merged[key] = n;
    }
  }
  return merged;
}

function buildLedger({ sessions, rates } = {}) {
  if (!Array.isArray(sessions)) throw new Error('SESSIONS_REQUIRED');
  const normalizedRates = normalizeRates(rates);
  const warnings = [];
  const seen = new Set();
  const rows = sessions.map((session, index) => {
    if (!session || typeof session !== 'object') throw new Error('SESSION_INVALID_AT_' + index);
    const usage = normalizeUsage({
      inputTokens: session.usage && session.usage.input,
      outputTokens: session.usage && session.usage.output,
      cacheReadTokens: session.usage && session.usage.cacheRead,
      cacheWriteTokens: session.usage && session.usage.cacheWrite,
      totalTokens: session.usage && session.usage.total
    });
    const sessionId = String(session.session_id || session.sessionId || 'session-' + index);
    if (seen.has(sessionId)) warnings.push('duplicate session_id: ' + sessionId);
    seen.add(sessionId);
    if (usage.total === 0 && (usage.input > 0 || usage.output > 0)) {
      warnings.push(sessionId + ': totalTokens missing or zero while input/output are present');
    }
    const row = {
      session_id: sessionId,
      path: String(session.path || ''),
      usage_events: toInt(session.usage_events),
      usage,
      source_kind: 'dsh-session'
    };
    if (typeof session.model === 'string' && session.model) row.model = session.model;
    if (typeof session.provider === 'string' && session.provider) row.provider = session.provider;
    return row;
  });

  const totals = emptyUsage();
  for (const row of rows) for (const field of FIELDS) totals[field] += row.usage[field];
  const denominator = totals.input + totals.cacheRead;
  totals.cache_hit_rate = denominator > 0 ? Number((totals.cacheRead / denominator).toFixed(6)) : 0;

  const estimate = Number((
    (totals.input * normalizedRates.input +
      totals.output * normalizedRates.output +
      totals.cacheRead * normalizedRates.cacheRead +
      totals.cacheWrite * normalizedRates.cacheWrite) / 1e6
  ).toFixed(6));

  return {
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    source: 'dsh-session',
    sessions: rows,
    totals,
    cost: {
      estimate,
      currency: 'USD',
      rates: normalizedRates,
      basis: 'local estimate: tokens from DSH session files × USD per 1M tokens; not a provider invoice'
    },
    reconcile: { checked: rows.length, matched: rows.length, diff_ratio: 0 },
    warnings
  };
}

function rawTotalOf(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (Array.isArray(raw)) {
    return raw.reduce((sum, item) => {
      const one = rawTotalOf(item);
      return sum + (one === null ? 0 : one);
    }, 0);
  }
  if (typeof raw === 'object') {
    if (Number.isFinite(Number(raw.total))) return Number(raw.total);
    let sum = 0;
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      const n = Number(raw[field]);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }
  return null;
}

function reconcile(ledger, rawUsageHints) {
  if (!ledger || !ledger.totals) throw new Error('LEDGER_REQUIRED');
  const raw = rawTotalOf(rawUsageHints);
  if (raw === null || raw < 0) return { checked: 0, matched: 0, diff_ratio: 0 };
  const actual = Number(ledger.totals.total) || 0;
  const diff = Math.abs(actual - raw);
  const ratio = raw === 0 ? (actual === 0 ? 0 : 1) : diff / raw;
  return {
    checked: 1,
    matched: ratio <= 0.01 ? 1 : 0,
    diff_ratio: Number(ratio.toFixed(6))
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

const CSV_HEADER = 'session_id,path,usage_events,model,provider,input,output,cacheRead,cacheWrite,total';

function toCsv(ledger) {
  if (!ledger || typeof ledger !== 'object') throw new Error('LEDGER_REQUIRED');
  // CLI historically passes a single parseSession() result; accept both shapes.
  if (!Array.isArray(ledger.sessions)) {
    if (ledger.usage && ledger.session_id) ledger = buildLedger({ sessions: [ledger] });
    else throw new Error('LEDGER_REQUIRED');
  }
  const lines = [CSV_HEADER];
  for (const row of ledger.sessions) {
    lines.push([
      row.session_id, row.path, row.usage_events, row.model || '', row.provider || '',
      row.usage.input, row.usage.output, row.usage.cacheRead, row.usage.cacheWrite, row.usage.total
    ].map(csvCell).join(','));
  }
  const totals = ledger.totals || emptyUsage();
  lines.push([
    'TOTAL', '', '', '', '', totals.input, totals.output, totals.cacheRead, totals.cacheWrite, totals.total
  ].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

// Decode a session file to newline-delimited JSON text (used by experiment
// collectors to map a session to its first user prompt without re-implementing
// the multi-frame zstd parser).
function sessionText(file) {
  return decodeSessionBytes(fs.readFileSync(path.resolve(String(file))));
}

module.exports = {
  DEFAULTS, CSV_HEADER, parseSession, buildLedger, reconcile, toCsv, normalizeUsage, zstdFrames, sessionText
};
