'use strict';
const { readJson, sha256 } = require('./util');

// M3 / B2：移除「账本读取」这一授权动作。
// 原因：ledger 是本地只读能力（读一个会话文件、算 token），从未被 authorize() 校验过；
// 保留一个「声明但永不执行」的动作会让权限模型不可信。若将来要把它纳入授权，
// 应连同 MCP 工具面一起设计，而不是留一个空条目。
const ACTIONS = new Set([
  'memory.get', 'memory.list', 'memory.stats', 'memory.propose',
  'memory.review', 'context.compile', 'audit.read'
]);

function loadPrincipals(file) {
  const data = readJson(file);
  if (!data || !Array.isArray(data.principals)) throw new Error('principals file invalid: principals[] required');
  return data;
}

function loadRouting(file) {
  const data = readJson(file);
  if (!data || !data.roles) throw new Error('role routing invalid: roles required');
  return data;
}

function authenticate(principals, token) {
  if (typeof token !== 'string' || token.length < 16) return { ok: false, reason: 'TOKEN_MISSING_OR_TOO_SHORT' };
  const hash = sha256(token);
  const principal = principals.principals.find(p => p.token_sha256 === hash);
  if (!principal) return { ok: false, reason: 'UNKNOWN_PRINCIPAL' };
  return { ok: true, principal };
}

function authorize(principal, { project_id, role_id, action, routing }) {
  if (!principal) return { ok: false, reason: 'NO_PRINCIPAL' };
  if (!ACTIONS.has(action)) return { ok: false, reason: 'UNKNOWN_ACTION' };
  if (!project_id || !principal.project_ids || !principal.project_ids.includes(project_id)) {
    return { ok: false, reason: 'PROJECT_DENIED' };
  }
  if (!role_id || !principal.roles || !principal.roles.includes(role_id)) {
    return { ok: false, reason: 'ROLE_DENIED' };
  }
  if (action === 'memory.review' && !isApprover(principal, role_id)) {
    return { ok: false, reason: 'REVIEW_DENIED' };
  }
  if (routing) {
    const role = (routing.roles && routing.roles[role_id]) || routing.default;
    if (!role) return { ok: false, reason: 'ROLE_NOT_CONFIGURED' };
  }
  return { ok: true };
}

function isApprover(principal, role_id) {
  return (role_id === 'R0' || role_id === 'R4') &&
    principal.roles.includes(role_id);
}

function roleProfile(routing, role_id) {
  return (routing && routing.roles && routing.roles[role_id]) || (routing && routing.default) || null;
}

module.exports = { ACTIONS, loadPrincipals, loadRouting, authenticate, authorize, isApprover, roleProfile };
