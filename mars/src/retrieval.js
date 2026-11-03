'use strict';
const { audit } = require('./db');
const { canRead, toRecord } = require('./store');
const { roleProfile } = require('./authz');
const { sharedRecords } = require('./sharing');

function rowsToRecords(rows) {
  return rows.map(r => toRecord(r));
}

function ftsQuery(query) {
  const terms = String(query || '').split(/\s+/).filter(Boolean).slice(0, 8);
  return terms.map(t => '"' + t.replace(/"/g, '""') + '"').join(' ');
}

const SEPARATORS = /[\s,，。；;：:()（）\[\]【】、/]+/;

function cjkSegments(query) {
  return String(query || '')
    .split(SEPARATORS)
    .map(s => s.trim())
    .filter(s => s.length >= 2)
    .slice(0, 6);
}

function likePattern(text) {
  return '%' + String(text).replace(/[\\%_]/g, m => '\\' + m) + '%';
}

function retrieve(db, principal, roleId, routing, params) {
  const { project_id, query, ids, type, alias, limit } = params || {};
  if (!principal.project_ids.includes(project_id)) throw new Error('PROJECT_DENIED');
  if (!principal.roles.includes(roleId)) throw new Error('ROLE_DENIED');
  const profile = roleProfile(routing, roleId) || { allowed_types: ['L2', 'L4'] };
  const max = Math.max(1, Math.min(100, Number(limit) || 20));
  const seen = new Set();
  const out = [];

  const push = (record, via) => {
    if (!record || seen.has(record.memory_id)) return;
    if (!profile.allowed_types.includes(record.memory_type)) return;
    if (type && record.memory_type !== type) return;
    // role 限定记忆只对 role_scope 内角色可见：即使 R0/R4 具备审批读取权，
    // 也不得进入其角色上下文（审批走 memory.get/review 显式路径）。
    if (record.visibility === 'role' && !(record.role_scope || []).includes(roleId)) return;
    // 过期记忆不再进入编译上下文（审计/审批仍可经 memory.get 显式读取）。
    if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return;
    if (!canRead(record, principal, roleId)) return;
    // 编译上下文只纳入 approved 记忆（含 R0/R4）：proposed/deprecated/rejected
    // 只能经 memory.get/review 显式路径读取，不允许进入角色 packet。
    if (record.status !== 'approved') return;
    seen.add(record.memory_id);
    out.push({ ...record, via });
  };

  // 1) 结构化字段（type/最近）优先；带 query 时交给全文/子串路径，
  //    避免“按类型取最近 N 条”把无关记录塞进角色上下文（P4 相关性优化）。
  if (type && !query) {
    const rows = db.prepare(
      "SELECT * FROM memories WHERE project_id = ? AND memory_type = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT ?"
    ).all(project_id, type, max);
    rowsToRecords(rows).forEach(r => push(r, 'structured'));
  }
  // 2) ID 精确
  if (Array.isArray(ids) && ids.length) {
    const stmt = db.prepare('SELECT * FROM memories WHERE project_id = ? AND memory_id = ?');
    ids.slice(0, max).forEach(id => push(toRecord(stmt.get(project_id, id)), 'id'));
  }
  // 3) FTS5 全文（ASCII 词）
  if (query) {
    const q = ftsQuery(query);
    if (q) {
      try {
        const rows = db.prepare(
          `SELECT m.* FROM memories_fts f JOIN memories m ON m.memory_id = f.memory_id
           WHERE memories_fts MATCH ? AND m.project_id = ? AND m.status = 'approved'
           ORDER BY rank LIMIT ?`
        ).all(q, project_id, max);
        rowsToRecords(rows).forEach(r => push(r, 'fts'));
      } catch (err) {
        // FTS 语法异常不影响其他检索路径
      }
    }
  }
  // 3b) CJK 子串回退（FTS5 unicode61 不切分中文），按分段 LIKE 召回
  if (query && /[\u3000-\u9fff]/.test(query)) {
    const stmt = db.prepare(
      "SELECT * FROM memories WHERE project_id = ? AND status = 'approved' AND content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?"
    );
    for (const segment of cjkSegments(query)) {
      rowsToRecords(stmt.all(project_id, likePattern(segment), max)).forEach(r => push(r, 'like'));
    }
  }
  // 4) 术语/别名
  if (alias) {
    const stmt = db.prepare(
      `SELECT DISTINCT m.* FROM aliases a JOIN memories m ON m.memory_id = a.memory_id
       WHERE a.project_id = ? AND (a.term LIKE ? ESCAPE '\\' OR a.alias LIKE ? ESCAPE '\\') LIMIT ?`
    );
    rowsToRecords(stmt.all(project_id, likePattern(alias), likePattern(alias), max)).forEach(r => push(r, 'alias'));
  }
  // 5) P5 跨项目共享：仅当存在已批准的显式 share 时才有结果（默认拒绝）。
  if (params && params.shared !== false) {
    for (const shared of sharedRecords(db, principal, roleId, routing, { target_project: project_id, type, limit: max })) {
      if (seen.has(shared.memory_id)) continue;
      seen.add(shared.memory_id);
      out.push(shared);
    }
  }
  const records = out.slice(0, max);
  audit(db, {
    principal_id: principal.principal_id, project_id, role_id: roleId,
    action: 'memory.list', target: query ? 'query:' + String(query).slice(0, 80) : (type || 'structured'),
    result: String(records.length)
  });
  return records;
}

module.exports = { retrieve, ftsQuery, cjkSegments };
