'use strict';
// 敏感操作治理（M13）。
//
// 这张表的用途不是"提醒"，而是**在运行时判死**：
//   某些动作没有任何角色拥有 → 无论谁持有什么 token，永远拒绝。
// 这比"R7 不应该 push"的文档约定强一档：约定可以被忽略，UNKNOWN 动作在这里直接没有授权路径。
//
// 强度说明（必须原样保留）：
//   - 这是 CLI/运行时入口的准入校验，不是 OS 沙箱
//   - 工具层根本没有 run_command / git / 网络工具，所以"越权执行"在协议上无处表达
//   - 真要做删除/推送，只能由人用 git 命令直接做，系统不代劳

const { ROLES } = require('../collab');
const { audit } = require('../db');

/**
 * action -> 需要的权限串。
 * 刻意把「需要什么权限」与「谁能给这个权限」分开写，方便审计时逐条核对。
 */
const ACTIONS = {
  'file.read': { requires: 'tool.read_file', why: '读取工作区文件' },
  'file.write': { requires: 'tool.write_file', why: '写入/覆盖工作区文件' },
  'file.delete': { requires: 'file.delete', why: '删除文件（默认无角色拥有）' },
  'git.status': { requires: 'git.status', why: '查看本地 Git 状态' },
  'git.commit': { requires: 'git.commit', why: '本地提交' },
  'git.push': { requires: 'git.push', why: '远程推送（默认无角色拥有）' },
  'release': { requires: 'release', why: '发布/打正式版本（默认无角色拥有）' },
  'memory.write': { requires: 'memory.write', why: '写入记忆' },
  'memory.approve': { requires: 'memory.review', why: '审批记忆' },
  'network': { requires: 'network', why: '主动发起外部网络请求（默认无角色拥有）' }
};

/** 这四类动作没有任何角色拥有，因此永远拒绝。测试会断言这一点。 */
const NEVER_GRANTED = ['file.delete', 'git.push', 'release', 'network'];

function check(roleId, action) {
  const spec = ACTIONS[action];
  if (!spec) return { allowed: false, action, reason: 'UNKNOWN_ACTION' };
  if (NEVER_GRANTED.includes(action)) {
    return { allowed: false, action, requires: spec.requires, reason: 'NEVER_GRANTED' };
  }
  const profile = ROLES[roleId];
  if (!profile) return { allowed: false, action, reason: 'ROLE_UNKNOWN' };
  if (!profile.permissions.includes(spec.requires)) {
    return { allowed: false, action, requires: spec.requires, reason: 'ROLE_DENIED' };
  }
  return { allowed: true, action, requires: spec.requires, reason: 'GRANTED' };
}

/** 全矩阵：每个动作 × 每个角色，外加 NEVER_GRANTED 标注。 */
function matrix() {
  const roles = Object.keys(ROLES);
  return Object.keys(ACTIONS).map((action) => {
    const row = { action, requires: ACTIONS[action].requires, why: ACTIONS[action].why, roles: {} };
    for (const r of roles) row.roles[r] = check(r, action).allowed;
    row.never_granted = NEVER_GRANTED.includes(action);
    return row;
  });
}

/**
 * 带审计的准入。拒绝也要留痕——"被拒绝的操作不能静默执行"的反面是"被拒绝的操作不能静默消失"。
 */
function guardAndAudit(db, { role, action, project_id, target, actor }) {
  const verdict = check(role, action);
  audit(db, {
    principal_id: actor || 'unknown',
    project_id: project_id || '-',
    role_id: role,
    action: 'policy.' + action,
    target: target || null,
    result: verdict.allowed ? 'allowed' : 'denied:' + verdict.reason,
    reason: verdict.requires ? 'requires ' + verdict.requires : null
  });
  return verdict;
}

module.exports = { ACTIONS, NEVER_GRANTED, check, matrix, guardAndAudit };
