'use strict';
// 独立算盘：只用于核对验收测试里的期望值，不参与任何一组实现。
// 按 TASK.md 的规则直接计算，输出 rows/stats，供人工比对。

const fs = require('node:fs');
const path = require('node:path');

const FIX = path.resolve(__dirname, '..', 'fixtures');

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',').map((s) => s.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    const o = {};
    header.forEach((h, idx) => { o[h] = cells[idx]; });
    return { ...o, __line: i + 2 };
  });
}

function parseJsonl(text) {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).map((l, i) => {
    try { return { ...JSON.parse(l), __line: i + 1 }; } catch (e) { return { __bad: true, __line: i + 1 }; }
  });
}

function parseAmount(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  const [i, f = ''] = body.split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

function convert(cents, from, to, rates) {
  if (rates.base) {
    const rf = rates.rates[from], rt = rates.rates[to];
    if (rf === undefined || rt === undefined) return null;
    return roundHalfAway((cents * rt) / rf);
  }
  // 扁平：1 单位 = X CNY
  if (to !== 'CNY') return undefined;
  if (from === 'CNY') return cents;
  if (rates[from] === undefined) return null;
  return roundHalfAway(cents * rates[from]);
}

function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  return file.endsWith('.csv') ? parseCsv(text) : parseJsonl(text);
}

function main() {
  const rates = JSON.parse(fs.readFileSync(path.join(FIX, 'rates.json'), 'utf8'));
  const ratesBase = JSON.parse(fs.readFileSync(path.join(FIX, 'rates-base.json'), 'utf8'));
  const files = ['jan.csv', 'feb.jsonl'].map((f) => path.join(FIX, f));
  const rows = [];
  let records = 0, duplicates = 0, invalid = 0, skipped = 0;
  const errors = [];
  const seen = new Set();
  for (const f of files) {
    for (const rec of load(f)) {
      records += 1;
      if (rec.id && seen.has(rec.id)) { duplicates += 1; continue; }
      if (rec.id) seen.add(rec.id);
      if (rec.__bad) { invalid += 1; errors.push([path.basename(f), rec.__line, 'E_JSON']); continue; }
      const date = parseDate(String(rec.date || '').trim());
      const cents = parseAmount(String(rec.amount || ''));
      const cur = String(rec.currency || '').trim();
      const cat = String(rec.category || '').trim();
      let code = null;
      if (!date) code = 'E_DATE';
      else if (cents === null) code = 'E_AMOUNT';
      else if (!/^[A-Z]{3}$/.test(cur)) code = 'E_CURRENCY';
      else if (!cat) code = 'E_CATEGORY';
      if (code) { invalid += 1; errors.push([path.basename(f), rec.__line, code]); continue; }
      const v = convert(cents, cur, 'CNY', rates);
      if (v === null) { invalid += 1; skipped += 1; errors.push([path.basename(f), rec.__line, 'E_RATE']); continue; }
      rows.push({ month: date.slice(0, 7), category: cat, total: v });
    }
  }
  const fmt = (rs) => {
    const m = new Map();
    for (const r of rs) {
      const k = r.month + '|' + r.category;
      const o = m.get(k) || { month: r.month, category: r.category, total: 0, count: 0 };
      o.total += r.total; o.count += 1; m.set(k, o);
    }
    return [...m.values()].sort((a, b) => (a.month + '/' + a.category).localeCompare(b.month + '/' + b.category));
  };
  console.log('CNY rows:', JSON.stringify(fmt(rows), null, 1));
  console.log('stats:', JSON.stringify({ files: files.length, records, duplicates, invalid, skipped_rate: skipped }));
  console.log('errors:', JSON.stringify(errors));

  // CR1: group by currency
  const byCur = new Map();
  for (const r of rows) { /* 需要原币种，重算一次 */ }
  const rowsCur = [];
  const seen2 = new Set(); records = 0; duplicates = 0;
  for (const f of files) {
    for (const rec of load(f)) {
      records += 1;
      if (rec.id && seen2.has(rec.id)) { duplicates += 1; continue; }
      if (rec.id) seen2.add(rec.id);
      const date = parseDate(String(rec.date || '').trim());
      const cents = parseAmount(String(rec.amount || ''));
      if (!date || cents === null) continue;
      const cur = String(rec.currency || '').trim();
      const v = convert(cents, cur, 'CNY', rates);
      if (v === null) continue;
      rowsCur.push({ month: date.slice(0, 7), currency: cur, total: v });
    }
  }
  const m2 = new Map();
  for (const r of rowsCur) {
    const k = r.month + '|' + r.currency;
    const o = m2.get(k) || { month: r.month, currency: r.currency, total: 0, count: 0 };
    o.total += r.total; o.count += 1; m2.set(k, o);
  }
  console.log('CR1 rows:', JSON.stringify([...m2.values()].sort((a, b) => (a.month + '/' + a.currency).localeCompare(b.month + '/' + b.currency)), null, 1));

  // CR2: target EUR
  const seen3 = new Set();
  const rowsEur = [];
  for (const f of files) {
    for (const rec of load(f)) {
      if (rec.id && seen3.has(rec.id)) continue;
      if (rec.id) seen3.add(rec.id);
      const date = parseDate(String(rec.date || '').trim());
      const cents = parseAmount(String(rec.amount || ''));
      if (!date || cents === null) continue;
      const cur = String(rec.currency || '').trim();
      const cat = String(rec.category || '').trim();
      const v = convert(cents, cur, 'EUR', ratesBase);
      if (v === null) continue;
      rowsEur.push({ month: date.slice(0, 7), category: cat, total: v });
    }
  }
  console.log('CR2 rows (EUR):', JSON.stringify(fmt(rowsEur), null, 1));
}

main();
