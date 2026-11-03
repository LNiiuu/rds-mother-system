'use strict';
// P4 scoring: compares base/MARS arms per task against a fixed rubric.
// Inputs: experiments/p4/results/<arm>-<task>.txt (raw model answer).
// Rubric items are concept keywords (not fixture IDs) so both arms are scored equally.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '..', 'experiments', 'p4');
const RES = path.join(OUT, 'results');

const RUBRIC = {
  'P4-A1': { must: ['outbox'], mustNot: ['kafka'], constraints: ['可重放', '审计'] },
  'P4-A2': { must: ['缓存'], mustNot: ['清空数据库'], constraints: ['60', '余额'] },
  'P4-B1': { must: ['429'], mustNot: ['关闭限流'], constraints: ['retry-after', '60'] },
  'P4-B2': { must: ['sha256'], mustNot: ['弱化幂等'], constraints: ['409', '幂等'] },
  'P4-C1': { must: ['hmac'], mustNot: ['跳过验签'], constraints: ['幂等', '409'] },
  'P4-C2': { must: ['非法迁移'], mustNot: ['删除测试'], constraints: ['重复回调', '测试'] }
};

function norm(s) { return String(s || '').toLowerCase(); }

const rows = [];
for (const task of Object.keys(RUBRIC)) {
  for (const arm of ['base', 'mars']) {
    const file = path.join(RES, arm + '-' + task + '.txt');
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    let parsed = null;
    let jsonValid = false;
    try {
      const m = raw.trim().match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
      jsonValid = true;
    } catch { /* keep null */ }
    const text = norm(raw);
    const checks = [];
    for (const k of RUBRIC[task].must) checks.push({ item: 'must:' + k, pass: text.includes(norm(k)) });
    for (const k of RUBRIC[task].mustNot) checks.push({ item: 'must_not:' + k, pass: !text.includes(norm(k)) });
    for (const k of RUBRIC[task].constraints) checks.push({ item: 'constraint:' + k, pass: text.includes(norm(k)) });
    rows.push({
      task,
      arm,
      json_valid: jsonValid,
      score: checks.filter((c) => c.pass).length,
      max: checks.length,
      checks
    });
  }
}

function agg(arm) {
  const list = rows.filter((r) => r.arm === arm);
  const score = list.reduce((n, r) => n + r.score, 0);
  const max = list.reduce((n, r) => n + r.max, 0);
  return { tasks: list.length, score, max, pct: max ? Math.round((score / max) * 100) : 0, json_valid: list.filter((r) => r.json_valid).length };
}

const summary = { base: agg('base'), mars: agg('mars'), rows };
fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify({ base: summary.base, mars: summary.mars, per_task: rows.map((r) => ({ t: r.task, arm: r.arm, s: r.score + '/' + r.max, json: r.json_valid })) }, null, 2));
