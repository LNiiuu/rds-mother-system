'use strict';
// Maps P4 subagent sessions to (task, arm) by their embedded marker and sums real usage.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseSession, sessionText } = require('../src/ledger');

const ROOT = process.env.RDS_SESSIONS_ROOT || path.join(os.homedir(), '.dsh', 'sessions');
const OUT = path.resolve(__dirname, '..', 'experiments', 'p4');
const since = Date.now() - 60 * 60 * 1000; // last hour
const rows = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === 'session.v4.jsonl.zstd' && fs.statSync(p).mtimeMs >= since) {
      let text = '';
      try { text = sessionText(p); } catch { /* skip */ }
      const m = text.match(/P4-RUN:(P4-[ABC][12]):(base|mars)/);
      if (!m) continue;
      const parsed = parseSession(p);
      rows.push({
        task: m[1],
        arm: m[2],
        session_id: parsed.session_id,
        usage_events: parsed.usage_events,
        input: parsed.usage.input,
        output: parsed.usage.output,
        cacheRead: parsed.usage.cacheRead,
        cacheWrite: parsed.usage.cacheWrite,
        total: parsed.usage.total
      });
    }
  }
}
if (!fs.existsSync(ROOT)) {
  console.error('未找到会话目录：' + ROOT);
  console.error('请用 RDS_SESSIONS_ROOT 指定包含 session.v4.jsonl.zstd 的目录。');
  process.exit(2);
}
walk(ROOT);

function dedupe(list) {
  const best = new Map();
  for (const r of list) {
    if (r.total <= 0 || r.total > 1000000) continue;
    const k = r.task + '/' + r.arm;
    if (!best.has(k) || r.total < best.get(k).total) best.set(k, r);
  }
  return [...best.values()];
}

function agg(arm) {
  const list = dedupe(rows.filter((r) => r.arm === arm));
  const sum = (k) => list.reduce((n, r) => n + r[k], 0);
  return {
    runs: list.length,
    input: sum('input'),
    output: sum('output'),
    cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'),
    total: sum('total'),
    avg_total: list.length ? Math.round(sum('total') / list.length) : 0
  };
}

const summary = { base: agg('base'), mars: agg('mars'), runs: dedupe(rows) };
fs.writeFileSync(path.join(OUT, 'usage.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify({ base: summary.base, mars: summary.mars, runs: rows.map((r) => r.task + '/' + r.arm + ':' + r.total) }, null, 2));
