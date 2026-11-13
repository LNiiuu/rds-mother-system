#!/usr/bin/env node
'use strict';
// M19：在真实环境跑 W-01..W-06 并落证据。
// 工具缺失的工作流必须 BLOCKED；不产生模拟分析结果。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../mars/src/db');
const rea = require('../mars/src/adapters/rea/registry');
const toolRegistry = require('../mars/src/adapters/rea/tool-registry');
const { buildPcap } = require('./make-pcap-fixture.cjs');
const { build: buildApk } = require('./make-apk-fixture.cjs');

const ROOT = path.resolve(__dirname, '..');
const WHERE = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'where.exe') : 'where.exe';
const OUT = path.join(ROOT, 'docs', 'checks', 'm19');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm19-rea-'));
const db = openDb(path.join(tmp, 'm19.db'));
const evidenceBase = path.join(tmp, 'evidence');
fs.mkdirSync(evidenceBase, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const apk = path.join(tmp, 'synthetic.apk');
fs.writeFileSync(apk, buildApk());
const pcap = path.join(tmp, 'synthetic.pcap');
fs.writeFileSync(pcap, buildPcap());

function cleanText(s) {
  let out = String(s);
  const reps = [
    [ROOT, '<REPO>'], [ROOT.replace(/\\/g, '/'), '<REPO>'],
    [tmp, '<TEMP>'], [tmp.replace(/\\/g, '/'), '<TEMP>'], [tmp.replace(/\\/g, '\\\\'), '<TEMP>'],
    ['D://MinGw//Mingw//mingw64//bin', '<TOOLCHAIN>'],
    ['D:/MinGw/Mingw/mingw64/bin', '<TOOLCHAIN>']
  ];
  for (const [a, b] of reps) out = out.split(a).join(b);
  return out;
}
function clean(v) {
  if (typeof v === 'string') return cleanText(v);
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = clean(v[k]); return o; }
  return v;
}

const CASES = [
  { id: 'W-01', input: { root: ROOT } },
  { id: 'W-02', input: { sample: WHERE, max_strings: 200 } },
  { id: 'W-03', input: { sample: apk } },
  { id: 'W-04', input: { sample: WHERE, depth: 3 } },
  { id: 'W-05', input: { sample: pcap, sample_kind: 'synthetic' } },
  { id: 'W-06', input: { target: 'com.example', purpose: 'authorized lab test', authorization: 'own-device' } }
];

(async () => {
  const tools = await toolRegistry.status();
  const records = [];
  for (const c of CASES) {
    const dir = path.join(OUT, c.id);
    fs.mkdirSync(dir, { recursive: true });
    let out;
    try {
      out = await rea.run(db, { workflow_id: c.id, input: c.input, evidenceBase });
    } catch (e) {
      out = { workflow_id: c.id, status: 'FAILED', error: e.message, evidence_files: {}, limitations: [] };
    }
    const files = out.evidence_files || {};
    for (const [kind, src] of Object.entries(files)) {
      const name = kind === 'result' ? 'result.json' : kind === 'report' ? 'report.md' : 'evidence.json';
      const dst = path.join(dir, name);
      fs.writeFileSync(dst, cleanText(fs.readFileSync(src, 'utf8')));
    }
    const log = [
      'workflow_id=' + c.id,
      'status=' + out.status,
      'rea_run_id=' + (out.rea_run_id || ''),
      'evidence_dir=' + cleanText(out.evidence_dir || ''),
      'sample=' + JSON.stringify(clean(out.sample || null)),
      'tool_versions=' + JSON.stringify(clean(out.tool_versions || [])),
      'limitations=' + JSON.stringify(out.limitations || []),
      'run_at=' + new Date().toISOString()
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'execution.log'), log);
    records.push({
      workflow_id: c.id, status: out.status, rea_run_id: out.rea_run_id || null,
      evidence_dir: 'docs/checks/m19/' + c.id,
      sample: clean(out.sample || null),
      tool_versions: clean(out.tool_versions || []),
      limitations: out.limitations || [],
      preflight: clean(out.preflight || null)
    });
  }
  const record = {
    demo: 'm19', generated_at: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    tools: clean(tools),
    workflows: records,
    note: 'W-01/W-04 为真实本地分析；W-02/W-03/W-05/W-06 缺专业工具，按 BLOCKED/PARTIAL 记录；未发起网络请求'
  };
  fs.writeFileSync(path.join(OUT, 'execution-record.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, statuses: records.map((r) => `${r.workflow_id}:${r.status}`), tools: tools.map((t) => `${t.name}:${t.present ? 'present' : 'missing'}`) }, null, 2));
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
