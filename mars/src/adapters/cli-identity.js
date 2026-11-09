'use strict';
// 适配器：CLI 身份来源（M3 / B2）。
//
// 优先级与原 cli.js 完全一致：--token 优先于 MARS_TOKEN；--role 优先于 MARS_ROLE。
// 角色为空时由调用方回落到「该 principal 的第一个角色」（原 cli.js 的 `auth.principal.roles[0]`）。
const { ERRORS } = require('../ports/identity-provider');

function createCliIdentity({ argv = {}, env = process.env } = {}) {
  function pick() {
    const fromFlag = typeof argv.token === 'string' && argv.token ? argv.token : null;
    const fromEnv = typeof env.MARS_TOKEN === 'string' && env.MARS_TOKEN ? env.MARS_TOKEN : null;
    const token = fromFlag || fromEnv;
    const role = (typeof argv.role === 'string' && argv.role ? argv.role : null) ||
      (typeof env.MARS_ROLE === 'string' && env.MARS_ROLE ? env.MARS_ROLE : null);
    return { token, role, source: fromFlag ? 'flag' : (fromEnv ? 'env' : 'none') };
  }

  return {
    resolve() {
      const { token, role, source } = pick();
      if (!token) return { ok: false, code: ERRORS.TOKEN_MISSING };
      return { ok: true, token, role, source };
    },
    source() {
      return pick().source;
    }
  };
}

module.exports = { createCliIdentity };
