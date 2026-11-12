'use strict';
// M9：项目注册与路径安全。
//
// 安全边界：
//   - 项目根必须是已存在的目录，先 resolve 再 realpath（消掉符号链接与别名）
//   - project_id 有严格字符集，不能拿显示名当边界
//   - 删除是软删除：只改 status，不删用户源码，也不删记忆（审计需要）

const path = require('node:path');
const { nowIso } = require('./util');

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function assertId(project_id) {
  if (!ID_RE.test(String(project_id || ''))) {
    throw new Error('PROJECT_ID_INVALID 只允许小写字母、数字与 . _ -，且以字母或数字开头');
  }
}

function parse(row) {
  if (!row) return null;
  let config = {};
  try { config = row.config_json ? JSON.parse(row.config_json) : {}; } catch (err) { config = {}; }
  return {
    project_id: row.project_id,
    display_name: row.display_name,
    root_path: row.root_path || null,
    status: row.status || 'active',
    owner_principal: row.owner_principal,
    share_policy: row.share_policy,
    config,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

function create(db, principal, input, deps) {
  assertId(input.project_id);
  const exists = db.prepare('SELECT project_id FROM projects WHERE project_id = ?').get(input.project_id);
  if (exists) throw new Error('PROJECT_EXISTS ' + input.project_id);
  if (!deps || typeof deps.resolveRoot !== 'function') throw new Error('PROJECT_ROOT_RESOLVER_MISSING');
  const root = deps.resolveRoot(input.root);
  if (!path.isAbsolute(root) || root.split(path.sep).includes('..')) throw new Error('PROJECT_ROOT_UNSAFE ' + root);
  const now = nowIso();
  db.prepare(`INSERT INTO projects
    (project_id, display_name, owner_principal, share_policy, created_at, root_path, status, config_json, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    input.project_id,
    input.name || input.project_id,
    principal.principal_id,
    input.policy || 'deny',
    now,
    root,
    'active',
    JSON.stringify(input.config || {}),
    now
  );
  return show(db, input.project_id);
}

function list(db, options = {}) {
  const rows = options.includeRemoved
    ? db.prepare('SELECT * FROM projects ORDER BY project_id').all()
    : db.prepare("SELECT * FROM projects WHERE status <> 'removed' ORDER BY project_id").all();
  return rows.map(parse);
}

function show(db, project_id) {
  return parse(db.prepare('SELECT * FROM projects WHERE project_id = ?').get(project_id));
}

function updateConfig(db, project_id, config) {
  const existing = show(db, project_id);
  if (!existing) throw new Error('PROJECT_NOT_FOUND ' + project_id);
  db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE project_id = ?')
    .run(JSON.stringify(config || {}), nowIso(), project_id);
  return show(db, project_id);
}

// 软删除：默认不删记忆、不删源码。confirm 必须等于 project_id，避免误删。
function remove(db, project_id, confirm) {
  const existing = show(db, project_id);
  if (!existing) throw new Error('PROJECT_NOT_FOUND ' + project_id);
  if (confirm !== project_id) {
    throw new Error('PROJECT_CONFIRM_REQUIRED 二次确认必须写成 --confirm ' + project_id);
  }
  db.prepare("UPDATE projects SET status = 'removed', updated_at = ? WHERE project_id = ?")
    .run(nowIso(), project_id);
  return { project_id, status: 'removed', source_deleted: false, memories_deleted: false };
}

module.exports = { create, list, show, updateConfig, remove, assertId };
