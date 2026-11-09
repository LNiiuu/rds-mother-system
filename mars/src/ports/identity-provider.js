'use strict';
// 端口：IdentityProvider（M3 / B2）
//
// 职责：回答「这次调用的身份凭证从哪来」。
//
// 与 M3-1 设计的一处刻意调整：
//   设计稿写 resolve() -> { principal, role }，实施时改为返回**凭证**（token + role）。
//   理由：认证本身（sha256 比对、角色/项目校验）是纯函数、无宿主耦合，已由 authz.js 承担；
//   若让适配器返回 principal，它就必须依赖 authz.js，形成「适配器 → 域」的反向依赖。
//   因此端口边界定在「凭证来源」，认证仍留在域内。
//
// 约束（tooling/layering-check.mjs 检查）：本文件零 require；方法数 <= 5；不依赖其他端口。
//
// 契约形状：
//   resolve() -> { ok:true, token, role, source } | { ok:false, code }
//   source()  -> 'flag' | 'env' | 'token-file' | 'static' | 'none'

const METHODS = ['resolve', 'source'];

const ERRORS = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  AUTH_DENIED: 'AUTH_DENIED',
  ROLE_REQUIRED: 'ROLE_REQUIRED'
});

const SOURCES = Object.freeze(['flag', 'env', 'token-file', 'static', 'none']);

module.exports = { METHODS, ERRORS, SOURCES };
