'use strict';
// P5 cross-project sharing and isolation governance.
//
// Rules (任务书 WP-3): default deny; sharing is explicit and approved; every
// shared record keeps its source project, source reference, version, approver,
// scope, expiry and revocation state; revocation stops subsequent retrieval.
const { audit } = require('./db');
const { nowIso, newId } = require('./util');
const { isApprover, roleProfile } = require('./authz');

function parse(row) {
  if (!row) return null;
  return {
    share_id: row.share_id,
    source_project: row.source_project,
    target_project: row.target_project,
    memory_ids: JSON.parse(row.memory_ids),
    memory_types: JSON.parse(row.memory_types),
    roles: JSON.parse(row.roles),
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at || null,
    expires_at: row.expires_at || null,
    revoked_by: row.revoked_by || null,
    revoked_at: row.revoked_at || null,
    note: row.note || null,
    reference_chain: JSON.parse(row.reference_chain || '[]')
  };
}

function getProject(db, project_id) {
  return db.prepare('SELECT * FROM projects WHERE project_id = ?').get(project_id) || null;
}

function inProject(principal, project_id) {
  return Array.isArray(principal.project_ids) && principal.project_ids.includes(project_id);
}

function isOwner(db, principal, project_id) {
  const project = getProject(db, project_id);
  return Boolean(project && project.owner_principal === principal.principal_id);
}

// A project must be registered before it can share or receive shared memories.
// Registration is restricted to principals already bound to that project id.
function registerProject(db, principal, role_id, input) {
  const project_id = String(input.project_id || '').trim();
  if (!project_id) throw new Error('PROJECT_ID_REQUIRED');
  if (!inProject(principal, project_id)) throw new Error('PROJECT_DENIED');
  const existing = getProject(db, project_id);
  if (existing) {
    if (existing.owner_principal !== principal.principal_id) throw new Error('PROJECT_OWNER_DENIED');
    db.prepare('UPDATE projects SET display_name = ?, share_policy = ? WHERE project_id = ?')
      .run(String(input.display_name || existing.display_name), String(input.share_policy || existing.share_policy), project_id);
    audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'project.update', target: project_id, result: 'ok' });
    return getProject(db, project_id);
  }
  const ts = nowIso();
  db.prepare('INSERT INTO projects (project_id, display_name, owner_principal, share_policy, created_at) VALUES (?,?,?,?,?)')
    .run(project_id, String(input.display_name || project_id), principal.principal_id, String(input.share_policy || 'deny'), ts);
  audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'project.register', target: project_id, result: 'created' });
  return getProject(db, project_id);
}

function listProjects(db) {
  return db.prepare('SELECT * FROM projects ORDER BY created_at').all();
}

function createShare(db, principal, role_id, input) {
  const source_project = String(input.source_project || '');
  const target_project = String(input.target_project || '');
  if (!source_project || !target_project) throw new Error('PROJECT_ID_REQUIRED');
  if (source_project === target_project) throw new Error('SELF_SHARE_DENIED');
  if (!inProject(principal, source_project)) throw new Error('PROJECT_DENIED');
  if (!isApprover(principal, role_id) && !isOwner(db, principal, source_project)) throw new Error('SHARE_CREATE_DENIED');
  if (!getProject(db, target_project)) throw new Error('TARGET_PROJECT_UNKNOWN');
  if (!Array.isArray(input.memory_ids) || input.memory_ids.length === 0) throw new Error('SHARE_MEMORY_REQUIRED');
  if (input.memory_ids.length > 200) throw new Error('SHARE_MEMORY_LIMIT');
  const ids = [...new Set(input.memory_ids.map(String))];
  const rows = ids.map((id) => db.prepare('SELECT * FROM memories WHERE project_id = ? AND memory_id = ?').get(source_project, id));
  if (rows.some((row) => !row)) throw new Error('SHARE_MEMORY_NOT_FOUND');
  if (rows.some((row) => row.status !== 'approved')) throw new Error('SHARE_MEMORY_NOT_APPROVED');
  const types = Array.isArray(input.memory_types) && input.memory_types.length
    ? input.memory_types : [...new Set(rows.map((row) => row.memory_type))];
  if (!types.every((t) => ['L1', 'L2', 'L3', 'L4'].includes(t))) throw new Error('SHARE_TYPE_INVALID');
  const roles = Array.isArray(input.roles) && input.roles.length ? input.roles.map(String) : null;
  if (!roles) throw new Error('SHARE_ROLES_REQUIRED');
  const expires = input.expires_at == null ? null : String(input.expires_at);
  if (expires !== null && Number.isNaN(Date.parse(expires))) throw new Error('EXPIRES_AT_INVALID');
  const share_id = newId('shr_');
  const ts = nowIso();
  db.prepare(`INSERT INTO shares (share_id, source_project, target_project, memory_ids, memory_types, roles,
      status, created_by, created_at, expires_at, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    share_id, source_project, target_project, JSON.stringify(ids), JSON.stringify(types), JSON.stringify(roles),
    'proposed', principal.principal_id, ts, expires, input.note ? String(input.note).slice(0, 500) : null
  );
  audit(db, { principal_id: principal.principal_id, project_id: source_project, role_id, action: 'share.create', target: share_id, result: 'proposed' });
  return parse(db.prepare('SELECT * FROM shares WHERE share_id = ?').get(share_id));
}

function approveShare(db, principal, role_id, share_id) {
  const share = parse(db.prepare('SELECT * FROM shares WHERE share_id = ?').get(share_id));
  if (!share) throw new Error('SHARE_NOT_FOUND');
  if (share.status !== 'proposed') throw new Error('INVALID_TRANSITION');
  if (!inProject(principal, share.target_project)) throw new Error('PROJECT_DENIED');
  if (!isApprover(principal, role_id) && !isOwner(db, principal, share.target_project)) throw new Error('SHARE_APPROVE_DENIED');
  if (share.created_by === principal.principal_id) throw new Error('SELF_REVIEW_DENIED');
  const chain = share.reference_chain.concat([{ approved_by: principal.principal_id, at: nowIso() }]);
  db.prepare('UPDATE shares SET status = ?, approved_by = ?, approved_at = ?, reference_chain = ? WHERE share_id = ?')
    .run('approved', principal.principal_id, nowIso(), JSON.stringify(chain), share_id);
  audit(db, { principal_id: principal.principal_id, project_id: share.target_project, role_id, action: 'share.approve', target: share_id, result: 'approved' });
  return parse(db.prepare('SELECT * FROM shares WHERE share_id = ?').get(share_id));
}

function revokeShare(db, principal, role_id, share_id, reason) {
  const share = parse(db.prepare('SELECT * FROM shares WHERE share_id = ?').get(share_id));
  if (!share) throw new Error('SHARE_NOT_FOUND');
  if (share.status === 'revoked') throw new Error('STATE_UNCHANGED');
  const allowed = (inProject(principal, share.source_project) || inProject(principal, share.target_project)) &&
    (isApprover(principal, role_id) || isOwner(db, principal, share.source_project) || isOwner(db, principal, share.target_project));
  if (!allowed) throw new Error('SHARE_REVOKE_DENIED');
  const ts = nowIso();
  db.prepare('UPDATE shares SET status = ?, revoked_by = ?, revoked_at = ?, note = COALESCE(?, note) WHERE share_id = ?')
    .run('revoked', principal.principal_id, ts, reason ? String(reason).slice(0, 500) : null, share_id);
  audit(db, { principal_id: principal.principal_id, project_id: share.source_project, role_id, action: 'share.revoke', target: share_id, result: 'revoked', reason: reason || null });
  return parse(db.prepare('SELECT * FROM shares WHERE share_id = ?').get(share_id));
}

function listShares(db, project_id) {
  return db.prepare('SELECT * FROM shares WHERE source_project = ? OR target_project = ? ORDER BY created_at DESC')
    .all(project_id, project_id).map(parse);
}

function activeShares(db, target_project) {
  return db.prepare(`SELECT * FROM shares WHERE target_project = ? AND status = 'approved'
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at`).all(target_project, nowIso()).map(parse);
}

// Explicit shared records visible to a target project. Default deny: no active
// share means an empty list. Source project, version, approver and share id are
// preserved so the caller can trace where the record came from.
function sharedRecords(db, principal, roleId, routing, params) {
  const target_project = params && params.target_project;
  if (!target_project) return [];
  const profile = roleProfile(routing, roleId) || { allowed_types: [] };
  const max = Math.max(1, Math.min(100, Number(params.limit) || 20));
  const out = [];
  const seen = new Set();
  for (const share of activeShares(db, target_project)) {
    if (!share.roles.includes(roleId)) continue; // share scope by target roles
    for (const id of share.memory_ids) {
      if (seen.has(id)) continue;
      if (out.length >= max) break;
      const row = db.prepare('SELECT * FROM memories WHERE project_id = ? AND memory_id = ?').get(share.source_project, id);
      if (!row) continue;
      if (row.status !== 'approved') continue;
      if (!share.memory_types.includes(row.memory_type)) continue;
      if (!profile.allowed_types.includes(row.memory_type)) continue;
      if (params.type && row.memory_type !== params.type) continue;
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) continue;
      if (row.visibility === 'role' && !JSON.parse(row.role_scope || '[]').includes(roleId)) continue;
      if (row.visibility === 'private') continue;
      seen.add(id);
      out.push({
        ...JSON.parse(JSON.stringify({
          memory_id: row.memory_id, project_id: row.project_id, memory_type: row.memory_type,
          content: row.content, source_ref: row.source_ref, source_version: row.source_version,
          content_hash: row.content_hash, status: row.status, confidence: row.confidence,
          visibility: row.visibility, role_scope: JSON.parse(row.role_scope),
          provenance: JSON.parse(row.provenance), created_by: row.created_by,
          created_at: row.created_at, updated_at: row.updated_at, expires_at: row.expires_at
        })),
        via: 'share:' + share.share_id,
        share_id: share.share_id,
        source_project: share.source_project,
        share_approved_by: share.approved_by
      });
    }
  }
  if (out.length) {
    audit(db, {
      principal_id: principal.principal_id, project_id: target_project, role_id: roleId,
      action: 'memory.share.read', target: String(out.length),
      result: out.map((r) => r.share_id).filter((v, i, a) => a.indexOf(v) === i).join(',')
    });
  }
  return out;
}

module.exports = {
  registerProject, listProjects, getProject, createShare, approveShare, revokeShare,
  listShares, activeShares, sharedRecords, inProject, isOwner
};
