'use strict';
// Phase 3 (P5) 跨项目共享冒烟：默认拒绝 → 显式创建 → 目标方审批 → 可见 → 撤销 → 不可见。
// 只使用合成项目数据与临时数据库，不触碰 rds-m1 生产库。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const store = require('../src/store');
const sharing = require('../src/sharing');
const { retrieve } = require('../src/retrieval');
const { loadRouting } = require('../src/authz');
const { sha256 } = require('../src/util');

const ROOT = path.resolve(__dirname, '..');
const ROUTING = loadRouting(path.join(ROOT, 'config', 'role-routing.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-p5-'));
const db = openDb(path.join(dir, 'mars.db'));

function principal(id, roles, projects) {
  return { principal_id: id, roles, project_ids: projects };
}

const A = 'proj-a';
const B = 'proj-b';
const aR2 = principal('demo-a-R2', ['R2'], [A]);
const aR0 = principal('demo-a-R0', ['R0'], [A]);
const bR2 = principal('demo-b-R2', ['R2'], [B]);
const bR0 = principal('demo-b-R0', ['R0'], [B]);

sharing.registerProject(db, aR0, 'R0', { project_id: A, display_name: 'Synthetic A' });
sharing.registerProject(db, bR0, 'R0', { project_id: B, display_name: 'Synthetic B' });
const fact = store.propose(db, aR2, {
  project_id: A, memory_type: 'L2', content: 'alpha fact available for explicit sharing',
  source_ref: 'docs/a.md', source_version: 'v1'
}, { routing: ROUTING });
store.review(db, aR0, 'R0', A, fact.memory_id, 'approved');

const before = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' });
const share = sharing.createShare(db, aR0, 'R0', {
  source_project: A, target_project: B, memory_ids: [fact.memory_id], roles: ['R2'], note: 'demo export'
});
const pending = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' });
const approved = sharing.approveShare(db, bR0, 'R0', share.share_id);
const visible = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' });
const revoked = sharing.revokeShare(db, aR0, 'R0', share.share_id, 'demo revoke');
const afterRevoke = retrieve(db, bR2, 'R2', ROUTING, { project_id: B, query: 'alpha' });
const auditCount = db.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'share.%' OR action = 'memory.share.read'").get().n;

const checks = {
  default_deny: before.length === 0,
  pending_not_visible: pending.length === 0,
  approved_visible: visible.length === 1 && visible[0].source_project === A && visible[0].via === 'share:' + share.share_id,
  revoked_hidden: afterRevoke.length === 0,
  share_audited: auditCount >= 3
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ ok, checks, share: { id: approved.share_id, status: approved.status, revoked: revoked.status }, auditCount }, null, 2));
try { db.close(); } catch { /* ignore */ }
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold WAL briefly */ }
process.exit(ok ? 0 : 1);
