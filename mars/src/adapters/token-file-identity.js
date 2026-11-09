'use strict';
// 适配器：MCP 服务身份来源（M3 / B2）。
//
// 与 B2 之前 mcp-stdio.js 的 tokenFromEnv() 逐字等价：
//   - token 只从 MARS_TOKEN_FILE 读；物理常量固定，不接受命令行或工具参数传入；
//   - 文件不存在 / 不可读 / 内容为空 一律返回 TOKEN_MISSING，由调用方决定如何处理。
// 关键行为差异（刻意保留）：**网关仍然启动**，每次工具调用返回 AUTH_DENIED。
// 这一点写在 docs/install.md §9，属于对外承诺，不能因为重构而变成启动失败。
const fs = require('node:fs');
const path = require('node:path');
const { ERRORS } = require('../ports/identity-provider');

function createTokenFileIdentity({ env = process.env } = {}) {
  function readToken() {
    const file = env.MARS_TOKEN_FILE;
    if (!file) return null;
    try {
      const raw = fs.readFileSync(path.resolve(file), 'utf8').trim();
      return raw || null;
    } catch (err) {
      return null;
    }
  }

  function role() {
    const v = env.MARS_ROLE;
    return typeof v === 'string' && v ? v : null;
  }

  return {
    resolve() {
      const token = readToken();
      // 失败也返回 role：role 与 token 是两项独立配置，调用方（MCP 网关）需要在无 token 时
      // 仍然记录「本次请求声称的角色」，以便审计里能区分「没带凭证」与「带了但角色不对」。
      if (!token) return { ok: false, code: ERRORS.TOKEN_MISSING, role: role() };
      return { ok: true, token, role: role(), source: 'token-file' };
    },
    source() {
      return env.MARS_TOKEN_FILE ? 'token-file' : 'none';
    }
  };
}

module.exports = { createTokenFileIdentity };
