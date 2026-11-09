'use strict';
const { sha256, nowIso, newId, guardSourceRef } = require('./util');
const { validate } = require('./validate');
const { audit } = require('./db');
const { isApprover } = require('./authz');
const { AppError } = require('./errors');

// M3 / B1：memory schema 不再在模块加载期读盘，改由调用方通过 options.assets 注入。
// 缺注入时给出带码的错误，而不是让调用栈里出现一个 ENOENT。
function resolveMemorySchema(options) {
  const assets = options && options.assets;
  if (!assets || typeof assets.contract !== 'function') {
    throw new AppError('ASSET_MISSING', 'memory schema 未注入（调用方需传 options.assets）');
  }
  return assets.contract('memory').value;
}

// Fail-closed routing resolution（M3 / B2 起更严格）：
// 只接受调用方注入的 routing 对象。域内不再读 MARS_ROUTING、也不再兜底读仓库文件 —
// 配置是组合根在启动时解析好的快照。缺注入就明确失败，绝不静默回退（N-03）。
function resolveRouting(routing) {
  if (routing && routing.roles) return routing;
  throw new AppError('ROUTING_UNAVAILABLE', 'routing 未注入：由组合根解析后传入（域内不读环境变量）');
}

function toRecord(row) {
  if (!row) return null;
  return {
    memory_id: row.memory_id,
    project_id: row.project_id,
    memory_type: row.memory_type,
    content: row.content,
    source_ref: row.source_ref,
    source_version: row.source_version,
    content_hash: row.content_hash,
    status: row.status,
    confidence: row.confidence,
    visibility: row.visibility,
    role_scope: JSON.parse(row.role_scope),
    tags: JSON.parse(row.tags),
    relations: JSON.parse(row.relations),
    evidence_refs: JSON.parse(row.evidence_refs),
    provenance: JSON.parse(row.provenance),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at || null
  };
}

function assertValid(record, schema) {
  if (!schema) throw new AppError('ASSET_MISSING', 'memory schema 未注入');
  const result = validate(record, schema);
  if (!result.valid) {
    const head = result.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error('MEMORY_SCHEMA_INVALID ' + head);
  }
}

function propose(db, principal, input, options = {}) {
  const project_id = input.project_id;
  const content = String(input.content || '');
  if (!content) throw new Error('CONTENT_REQUIRED');
  const source = guardSourceRef(input.source_ref, options.allowedRoots);
  if (!source.ok) throw new Error('SOURCE_REF_DENIED ' + source.reason);
  if (!input.source_version) throw new Error('SOURCE_VERSION_REQUIRED');
  if (!Array.isArray(principal.project_ids) || !principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
  const role = input.role_id || principal.roles[0];
  if (!principal.roles.includes(role)) throw new Error('ROLE_DENIED');
  const memory_type = input.memory_type || 'L2';
  if (!['L1', 'L2', 'L3', 'L4'].includes(memory_type)) throw new Error('MEMORY_TYPE_INVALID');
  const routing = resolveRouting(options.routing);
  const roleTypes = routing.roles[role] && routing.roles[role].allowed_types;
  if (!Array.isArray(roleTypes)) throw new Error('ROUTING_UNAVAILABLE');
  if (!roleTypes.includes(memory_type)) throw new Error('ROLE_TYPE_DENIED');
  const visibility = input.visibility || 'project';
  const roleScope = Array.isArray(input.role_scope) ? input.role_scope : [];
  if (visibility === 'role' && roleScope.length === 0) throw new Error('ROLE_SCOPE_REQUIRED');
  const expiresAt = input.expires_at === undefined || input.expires_at === null ? null : String(input.expires_at);
  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) throw new Error('EXPIRES_AT_INVALID');
  const content_hash = sha256(content);
  const memory_id = 'mem_' + sha256([project_id, content_hash, source.normalized, input.source_version].join('|')).slice(0, 12);
  const ts = nowIso();
  const record = {
    memory_id,
    project_id,
    memory_type,
    content,
    source_ref: source.normalized,
    source_version: String(input.source_version),
    content_hash,
    status: 'proposed',
    confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
    visibility,
    role_scope: roleScope,
    tags: Array.isArray(input.tags) ? input.tags : [],
    relations: Array.isArray(input.relations) ? input.relations : [],
    evidence_refs: Array.isArray(input.evidence_refs) ? input.evidence_refs : [],
    provenance: Object.assign({
      origin: input.origin || 'agent',
      collected_at: ts,
      agent_role: role
    }, input.run_id ? { run_id: String(input.run_id) } : {}, input.provenance || {}),
    created_at: ts,
    updated_at: ts,
    expires_at: expiresAt
  };
  assertValid(record, resolveMemorySchema(options));
  const existing = db.prepare(
    'SELECT * FROM memories WHERE project_id = ? AND content_hash = ? AND source_ref = ? AND source_version = ?'
  ).get(project_id, content_hash, source.normalized, String(input.source_version));
  if (existing) {
    audit(db, { principal_id: principal.principal_id, project_id, role_id: role, action: 'memory.propose', target: memory_id, result: 'duplicate' });
    return { memory_id: existing.memory_id, status: existing.status, duplicate: true };
  }
  db.prepare(`INSERT INTO memories (
      memory_id, project_id, memory_type, content, source_ref, source_version, content_hash,
      status, confidence, visibility, role_scope, tags, relations, evidence_refs, provenance,
      created_by, created_at, updated_at, expires_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    record.memory_id, record.project_id, record.memory_type, record.content, record.source_ref,
    record.source_version, record.content_hash, record.status, record.confidence, record.visibility,
    JSON.stringify(record.role_scope), JSON.stringify(record.tags), JSON.stringify(record.relations),
    JSON.stringify(record.evidence_refs), JSON.stringify(record.provenance), principal.principal_id,
    record.created_at, record.updated_at, record.expires_at
  );
  db.prepare('INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)').run(memory_id, content);
  audit(db, { principal_id: principal.principal_id, project_id, role_id: role, action: 'memory.propose', target: memory_id, result: 'created' });
  return { memory_id, status: 'proposed', duplicate: false };
}

function canRead(record, principal, role_id) {
  if (!principal.project_ids.includes(record.project_id)) return false;
  if (isApprover(principal, role_id)) return true;
  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return false;
  if (record.created_by === principal.principal_id) return true;
  if (record.status === 'proposed') return record.created_by === principal.principal_id;
  if (record.visibility === 'project') return principal.roles.includes(role_id);
  if (record.visibility === 'role') return record.role_scope.includes(role_id) && principal.roles.includes(role_id);
  return false; // private 未实现授权读取
}

function assertProject(principal, project_id) {
  if (!Array.isArray(principal.project_ids) || !principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
}

function get(db, principal, role_id, project_id, memory_id) {
  assertProject(principal, project_id);
  if (!principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
  const row = db.prepare('SELECT * FROM memories WHERE project_id = ? AND memory_id = ?').get(project_id, memory_id);
  const record = toRecord(row);
  if (!record) return null;
  if (!canRead(record, principal, role_id)) throw new Error('MEMORY_DENIED');
  audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'memory.get', target: memory_id, result: 'ok' });
  return record;
}

function list(db, principal, role_id, project_id, filter = {}) {
  assertProject(principal, project_id);
  if (!principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
  const clauses = ['project_id = ?'];
  const params = [project_id];
  if (filter.status) { clauses.push('status = ?'); params.push(filter.status); }
  if (filter.type) { clauses.push('memory_type = ?'); params.push(filter.type); }
  if (Array.isArray(filter.ids) && filter.ids.length) {
    clauses.push(`memory_id IN (${filter.ids.map(() => '?').join(',')})`);
    params.push(...filter.ids);
  }
  const limit = Math.max(1, Math.min(200, Number(filter.limit) || 50));
  const rows = db.prepare(`SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit}`).all(...params);
  const records = rows.map(toRecord).filter(r => canRead(r, principal, role_id));
  audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'memory.list', target: filter.status || '*', result: String(records.length) });
  return records;
}

function review(db, principal, role_id, project_id, memory_id, decision, note) {
  assertProject(principal, project_id);
  if (!isApprover(principal, role_id)) throw new Error('REVIEW_DENIED');
  const TRANSITIONS = {
    proposed: ['approved', 'rejected'],
    approved: ['superseded', 'deprecated'],
    rejected: [],
    superseded: [],
    deprecated: []
  };
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, decision)) throw new Error('DECISION_INVALID');
  const row = db.prepare('SELECT * FROM memories WHERE project_id = ? AND memory_id = ?').get(project_id, memory_id);
  if (!row) throw new Error('MEMORY_NOT_FOUND');
  if (row.created_by === principal.principal_id) throw new Error('SELF_REVIEW_DENIED');
  if (row.status === decision) {
    audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'memory.review', target: memory_id, result: 'noop' });
    throw new Error('STATE_UNCHANGED');
  }
  const allowed = TRANSITIONS[row.status];
  if (!Array.isArray(allowed) || !allowed.includes(decision)) throw new Error('INVALID_TRANSITION');
  const provenance = JSON.parse(row.provenance);
  provenance.approved_by = principal.principal_id;
  provenance.approved_at = nowIso();
  if (note) provenance.review_note = String(note).slice(0, 500);
  const ts = nowIso();
  db.prepare('UPDATE memories SET status = ?, updated_at = ?, provenance = ? WHERE memory_id = ?')
    .run(decision, ts, JSON.stringify(provenance), memory_id);
  audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'memory.review', target: memory_id, result: decision });
  return toRecord(db.prepare('SELECT * FROM memories WHERE memory_id = ?').get(memory_id));
}

function addAlias(db, principal, role_id, project_id, term, alias, memory_id) {
  assertProject(principal, project_id);
  if (!principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
  db.prepare('INSERT OR IGNORE INTO aliases (project_id, term, alias, memory_id) VALUES (?,?,?,?)')
    .run(project_id, term, alias, memory_id);
  audit(db, { principal_id: principal.principal_id, project_id, role_id, action: 'memory.alias', target: `${term}=>${alias}`, result: 'ok' });
}

module.exports = { propose, get, list, review, addAlias, toRecord, canRead, assertValid, resolveMemorySchema };
