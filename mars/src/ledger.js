'use strict';
// M6 Usage Ledger — 账本汇总、对账与 CSV 导出（纯计算）。
//
// M3 / B3 起本文件只做三件事：把会话用量汇总、按提示总量对账、导出 CSV。
// 「会话文件是什么格式、怎么解码」已移到 adapters/dsh-session-source.js；
// 本文件不做任何 I/O，也不再认识 DSH 的事件词汇。
//
// 定位不变：本地估算，token 数来自会话文件，成本不是厂商账单。
const DEFAULTS = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 };
const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/** 规范字段的清洗：非负整数，缺失/非法按 0。不做任何推断。 */
function sanitizeUsage(raw) {
  const usage = emptyUsage();
  if (!raw || typeof raw !== 'object') return usage;
  for (const field of FIELDS) usage[field] = toInt(raw[field]);
  return usage;
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
    const usage = sanitizeUsage(session.usage);
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
      source_kind: String(session.source_kind || 'dsh-session')
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
    source: rows.length && rows[0].source_kind ? rows[0].source_kind : 'dsh-session',
    sessions: rows,
    totals,
    cost: {
      estimate,
      currency: 'USD',
      rates: normalizedRates,
      basis: 'local estimate: tokens from session files × USD per 1M tokens; not a provider invoice'
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
  // CLI 历史上会把单个会话记录直接传进来；两种形状都接受。
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

module.exports = {
  DEFAULTS, CSV_HEADER, FIELDS, buildLedger, reconcile, toCsv, emptyUsage, sanitizeUsage, toInt
};
