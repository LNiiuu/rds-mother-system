'use strict';
// 统一错误模型（M3 / B0）。
//
// 背景：在 B0 之前，对外错误码的白名单有两份内联正则，
//   mars/src/mcp.js      14 个码
//   mars/src/mcp-stdio.js 20 个码
// 差集 6 个码（EXPIRES_AT_INVALID / INVALID_TRANSITION / RATE_LIMITED /
// ROLE_TYPE_DENIED / ROUTING_UNAVAILABLE / STATE_UNCHANGED）在旧网关会退化成
// INTERNAL_ERROR。两份清单会继续漂移，因此收敛为这里的唯一真相。
//
// 约束：
//   1. 本文件零依赖（不 require 任何模块），可被域、适配器、入口共同引用；
//   2. 只做「错误 -> 对外码」的映射，不做日志、不做 I/O；
//   3. 对外码只增不减；删除属于破坏性变更。

/**
 * 已知的对外错误码。调用方可以安全地据此分支。
 * 新增时必须同时在该码的抛出点写测试。
 */
const PUBLIC_CODES = new Set([
  // 资产与配置（B1/B2）
  'ASSET_MISSING',
  'ASSET_INVALID',
  'ASSET_HASH_MISMATCH',
  'ROUTING_UNAVAILABLE',
  'PRINCIPALS_MISSING',

  // 身份与授权（既有）
  'AUTH_DENIED',
  'AUTHZ_DENIED',
  'TOKEN_MISSING',
  'ROLE_REQUIRED',
  'ROLE_DENIED',
  'ROLE_TYPE_DENIED',
  'ROLE_SCOPE_REQUIRED',
  'ROLE_NOT_CONFIGURED',
  'PROJECT_DENIED',
  'PROJECT_REQUIRED',
  'PROJECT_ID_REQUIRED',
  'PROJECT_UNKNOWN',
  'PROJECT_OWNER_DENIED',
  'REVIEW_DENIED',
  'SELF_REVIEW_DENIED',
  'APPROVER_REQUIRED',
  'EVIDENCE_DENIED',
  'SOURCE_REF_DENIED',

  // 记忆（既有）
  'MEMORY_DENIED',
  'MEMORY_NOT_FOUND',
  'MEMORY_SCHEMA_INVALID',
  'MEMORY_TYPE_INVALID',
  'CONTENT_REQUIRED',
  'SOURCE_VERSION_REQUIRED',
  'DECISION_INVALID',
  'INVALID_TRANSITION',
  'STATE_UNCHANGED',
  'NOT_APPROVED',
  'EXPIRES_AT_INVALID',

  // 上下文包与片段（既有）
  'PACKET_SCHEMA_INVALID',
  'MANIFEST_SCHEMA_INVALID',
  'FRAGMENT_NOT_FOUND',

  // 会话与账本（既有 + B3）
  'SESSION_CORRUPT',
  'SESSION_INVALID_AT_',
  'SESSIONS_REQUIRED',
  'SOURCE_UNSUPPORTED',
  'SOURCE_AMBIGUOUS',
  'LEDGER_REQUIRED',
  'ZSTD_UNSUPPORTED',
  'DSH_SESSION_CORRUPT',

  // 宿主注册表（新增 B4）
  'HOST_REGISTRY_NOT_FOUND',
  'HOST_REGISTRY_INVALID',
  'HOST_REGISTRY_READONLY',
  'HOST_WRITE_REFUSED',

  // 共享与编排（既有）
  'SHARE_NOT_FOUND',
  'SHARE_CREATE_DENIED',
  'SHARE_APPROVE_DENIED',
  'SHARE_REVOKE_DENIED',
  'SHARE_TYPE_INVALID',
  'SHARE_ROLES_REQUIRED',
  'SHARE_MEMORY_REQUIRED',
  'SHARE_MEMORY_NOT_FOUND',
  'SHARE_MEMORY_NOT_APPROVED',
  'SHARE_MEMORY_LIMIT',
  'SELF_SHARE_DENIED',
  'TARGET_PROJECT_UNKNOWN',
  'RUN_NOT_FOUND',
  'INVALID_RUN_STATE',
  'AGENT_UNAVAILABLE',
  'AGENT_RISK_MISMATCH',

  // 基础设施与限流
  'DB_AND_PRINCIPALS_REQUIRED',
  'RATE_LIMITED',
  'METHOD_NOT_FOUND',
  'BAD_REQUEST',
  'INTERNAL_ERROR'
]);

/**
 * 迁移期兼容：既有的 `throw new Error('CODE detail')` 仍要被识别。
 * 只做「首 token 精确匹配」，不做前缀/模糊匹配 —— 与原正则的 `^(A|B|...)` 语义一致。
 */
const CODE_TOKEN = /^([A-Z][A-Z0-9_]*)/;

class AppError extends Error {
  /**
   * @param {string} code 必须是 PUBLIC_CODES 成员
   * @param {string} [detail] 仅进日志/审计，不进对外响应
   */
  constructor(code, detail) {
    if (!PUBLIC_CODES.has(code)) {
      throw new Error('UNKNOWN_PUBLIC_CODE: ' + code + '（先把它加进 PUBLIC_CODES）');
    }
    super(detail ? code + ' ' + detail : code);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail === undefined || detail === null ? '' : String(detail);
  }
}

function isPublicCode(code) {
  return typeof code === 'string' && PUBLIC_CODES.has(code);
}

function messageOf(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.message || '');
}

/**
 * 把任意异常映射成对外错误码。
 * 绝不返回栈、SQL、文件路径或原始 detail。
 * @returns {string}
 */
function toPublicCode(err) {
  if (err && err.name === 'AppError' && isPublicCode(err.code)) return err.code;
  const message = messageOf(err);
  const m = CODE_TOKEN.exec(message);
  if (!m) return 'INTERNAL_ERROR';
  // SESSION_INVALID_AT_<index> 这类带下标的码按前缀归并
  if (m[1].startsWith('SESSION_INVALID_AT_')) return m[1];
  return PUBLIC_CODES.has(m[1]) ? m[1] : 'INTERNAL_ERROR';
}

/**
 * 构造对外响应体。`{ok:false, code}` 是既有契约，不新增字段。
 */
function toPublicError(err) {
  return { ok: false, code: toPublicCode(err) };
}

module.exports = { AppError, PUBLIC_CODES, CODE_TOKEN, isPublicCode, toPublicCode, toPublicError };
