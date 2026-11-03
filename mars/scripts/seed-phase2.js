'use strict';
// Seed deterministic Phase 2 memories for project rds-m1 (idempotent by content hash).
// Proposals are created by the role that owns them; approvals by an authorized
// approver that is not the proposer (self-review denied by design).
const path = require('node:path');
const { openDb } = require('../src/db');
const { loadPrincipals, loadRouting } = require('../src/authz');
const store = require('../src/store');

const ROOT = path.resolve(__dirname, '..');
const db = openDb(path.join(ROOT, 'var', 'mars.db'));
const principals = loadPrincipals(path.join(ROOT, 'config', 'principals.json'));
const routing = loadRouting(path.join(ROOT, 'config', 'role-routing.json'));
const byId = (id) => {
  const p = principals.principals.find(x => x.principal_id === id);
  if (!p) throw new Error('principal missing: ' + id);
  return p;
};
const proposer = (role) => byId('mcp-' + role);
const PROJECT = 'rds-m1';
const allowedRoots = [path.resolve(ROOT, '..')];

const seeds = [
  { role: 'R0', type: 'L1', content: 'Phase 2 G1 杩涜涓細MARS MCP stdio 鏈嶅姟宸插疄鐜帮紝韬唤鏉ヨ嚜鏈湴 token 鏂囦欢骞剁粦瀹氬崟涓€瑙掕壊锛涚瓑寰?DSH 娉ㄥ唽鍚庢墽琛岀湡瀹炶皟鐢ㄩ獙璇併€?, ref: 'mars/docs/phase1-acceptance.md', version: '2026-11-03', visibility: 'project' },
  { role: 'R1', type: 'L2', content: 'MARS 杩愯浜?Node 24 鍐呯疆 node:sqlite锛圫QLite 3.53.4锛孎TS5 鍙敤锛夛紝鏃犵涓夋柟渚濊禆锛屽叏閮ㄦ祴璇曠绾挎墽琛屻€?, ref: 'mars/docs/phase1-acceptance.md', version: '2026-11-03', visibility: 'project' },
  { role: 'R1', type: 'L3', content: '鎺ュ叆 DSH 閲囩敤 profile cordis.patch.yml 鐨?dsh-mcp-client stdio 娉ㄥ唽锛汳ARS 杩涚▼缁戝畾鍗曡鑹?token锛屽鎴风浼犲叆鐨?role/project 涓嶄綔涓烘巿鏉冧緷鎹€?, ref: 'mars/docs/security.md', version: '2026-11-03', visibility: 'project' },
  { role: 'R2', type: 'L3', content: 'MCP 榛樿绂佺敤锛涢€氳繃 G1 鍚庝粎寮€鏀?memory.get/list/stats/context.compile 涓?memory.propose锛堝彧鍐?proposed锛屽鎵逛粛鍦ㄦ湇鍔＄涔嬪锛夈€?, ref: 'mars/src/mcp-stdio.js', version: '0.2.0', visibility: 'project' },
  { role: 'R1', type: 'L4', content: 'Context Compiler 瑙掕壊璺敱锛歊1 鏋舵瀯/鍘嗗彶鍐崇瓥/鎺ュ彛锛孯2 浠诲姟鍗?瀹炵幇绾︽潫锛孯3 楠屾敹鏍囧噯/娴嬭瘯璇佹嵁锛孯4 鍘熷闇€姹?鐙珛璇佹嵁锛孯0 鐘舵€?瀹℃壒锛汻0/R3/R4 鐨?evidence_direct=true 鍙仮澶嶅師鏂囥€?, ref: 'mars/config/role-routing.json', version: '2026-11-03', visibility: 'project' },
  { role: 'R4', type: 'L2', content: 'Phase 1 娈嬩綑闄愬埗锛歳eview 鏃犵姸鎬佽縼绉绘牎楠岋紙P10锛夈€佹祴璇曟姤鍛婃湭鍚屾 remediation 鐢ㄤ緥锛圥12锛夛紱MCP 灏氭棤 token 杞崲涓庡悐閿€銆?, ref: 'mars/docs/phase1-review-round2.md', version: '2026-11-03', visibility: 'project' },
  { role: 'R3', type: 'L4', content: '楠屾敹鍒ゅ畾鍙ｅ緞锛氱粨璁哄彧鑳芥槸 PASS/PARTIAL/BLOCKED/FAIL锛涗笉寰楁妸 PARTIAL/BLOCKED/FAIL 鎻愬崌涓?PASS锛屽畨鍏ㄩ樆鏂」蹇呴』鍏堜慨澶嶅啀鎵╁睍鎺ュ叆銆?, ref: 'mars/docs/phase1-acceptance.md', version: '2026-11-03', visibility: 'role', role_scope: ['R3'] },
  { role: 'R2', type: 'L2', content: 'Phase 2 瑕佹眰寤虹珛鐪熷疄浠诲姟 Token A/B 瀵圭収锛氬鐓х粍涓哄師 DSH 涓婁笅鏂囦紶閫掞紝瀹為獙缁勪负 MARS 瑙掕壊涓撳睘涓婁笅鏂囷紝姣忕粍鑷冲皯涓夋骞惰褰?usage 浜斿瓧娈点€?, ref: 'mars/docs/token-baseline.md', version: '2026-11-03', visibility: 'project', approve: false }
];

const results = [];
for (const s of seeds) {
  const p = proposer(s.role);
  const proposal = store.propose(db, p, {
    project_id: PROJECT,
    memory_type: s.type,
    content: s.content,
    source_ref: s.ref,
    source_version: s.version,
    confidence: 0.9,
    visibility: s.visibility,
    role_scope: s.role_scope || []
  }, { allowedRoots, routing });
  let status = proposal.status;
  if (s.approve !== false && proposal.status === 'proposed') {
    const reviewer = s.role === 'R4' ? byId('mcp-R0') : byId('mcp-R4');
    const reviewerRole = s.role === 'R4' ? 'R0' : 'R4';
    const reviewed = store.review(db, reviewer, reviewerRole, PROJECT, proposal.memory_id, 'approved', 'phase2 seed');
    status = reviewed.status;
  }
  results.push({ id: proposal.memory_id, duplicate: !!proposal.duplicate, status, role: s.role, type: s.type });
}
console.log(JSON.stringify({ seeded: results.length, results }, null, 2));
db.close();
