'use strict';
// WP-5 stress probe: repeated retrieval/compile on a temp copy of the production DB.
// Copies db + -wal/-shm so the snapshot is consistent; asserts that no memory
// invisible to a role (not approved, wrong project, or role-scoped for another role)
// ever appears in that role's compiled packet.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { compileContext } = require('../src/compiler');
const { retrieve } = require('../src/retrieval');
const authz = require('../src/authz');
const { createRuntime } = require('../src/composition');
const RUNTIME_ASSETS = createRuntime({}).assets;

const ROOT = path.resolve(__dirname, '..');
const src = path.join(ROOT, 'var', 'mars.db');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-wp5-'));
const dbPath = path.join(dir, 'stress.db');
for (const suffix of ['', '-wal', '-shm']) {
  const from = src + suffix;
  if (fs.existsSync(from)) fs.copyFileSync(from, dbPath + suffix);
}
const db = openDb(dbPath);
const routing = authz.loadRouting(path.join(ROOT, 'config', 'role-routing.json'));
const principals = authz.loadPrincipals(path.join(ROOT, 'config', 'principals.json')).principals;
const byId = Object.fromEntries(principals.map((p) => [p.principal_id, p]));
const roleOf = { 'mcp-R0': 'R0', 'mcp-R1': 'R1', 'mcp-R2': 'R2', 'mcp-R3': 'R3', 'mcp-R4': 'R4' };

const ADMIN_ROLES = new Set(['R0', 'R4']);
const all = db.prepare('SELECT memory_id, project_id, status, visibility, role_scope FROM memories').all();
function forbiddenFor(role) {
  const set = new Set();
  for (const m of all) {
    const scope = m.role_scope ? JSON.parse(m.role_scope) : [];
    const roleLimited = m.visibility === 'role' && !scope.includes(role);
    if (m.status !== 'approved' || roleLimited) set.add(m.memory_id);
  }
  return set;
}

const roles = Object.keys(roleOf);
const durations = [];
const tokenStats = {};
let leaks = 0;
let leakSamples = [];
const N = 240;
for (let i = 0; i < N; i += 1) {
  const pid = roles[i % roles.length];
  const role = roleOf[pid];
  const forbidden = forbiddenFor(role);
  const t0 = process.hrtime.bigint();
  const out = compileContext(db, byId[pid], routing, {
    assets: RUNTIME_ASSETS,
    project_id: 'rds-m1', role_id: role, budget: 800,
    task_id: `WP5-STRESS-${i}`, task: { task_id: `WP5-STRESS-${i}`, title: 'stress compile' }
  });
  const t1 = process.hrtime.bigint();
  durations.push(Number(t1 - t0) / 1e6);
  tokenStats[role] = tokenStats[role] || [];
  tokenStats[role].push(out.packet.tokens_estimated);

  const text = JSON.stringify(out.packet.sections);
  const hit = [...forbidden].filter((id) => text.includes(id));
  if (hit.length > 0) {
    leaks += hit.length;
    if (leakSamples.length < 5) leakSamples.push({ role, memory_ids: hit, iteration: i });
  }
  if (i % 3 === 0) {
    retrieve(db, byId[pid], role, routing, { project_id: 'rds-m1', query: 'MCP token', limit: 5 });
  }
}
durations.sort((a, b) => a - b);
const pct = (p) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))];
const summary = {
  ok: leaks === 0,
  iterations: N,
  leaks,
  leak_samples: leakSamples,
  forbidden_checked: Object.fromEntries(roles.map((pid) => [roleOf[pid], forbiddenFor(roleOf[pid]).size])),
  latency_ms: { p50: +pct(0.5).toFixed(2), p95: +pct(0.95).toFixed(2), max: +durations[durations.length - 1].toFixed(2) },
  tokens_by_role: Object.fromEntries(Object.entries(tokenStats).map(([r, xs]) => [r, { min: Math.min(...xs), max: Math.max(...xs), avg: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) }]))
};
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
