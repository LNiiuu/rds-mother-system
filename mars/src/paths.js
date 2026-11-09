'use strict';
// 路径与配置快照的解析规则（M3 / B2）。
//
// 单独成文件的原因：这些规则要被「组合根、doctor、嵌入方」共用，
// 但它们不含业务，也不该让 composition.js 膨胀成一个什么都装的文件。
//
// 注意：本文件只读传入的 env 对象，不碰 process.env —— 读取进程环境是组合根的职责。
const path = require('node:path');
const { AppError } = require('./errors');

// 安装根：本文件在 mars/src/ 下，包根是上两级。
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

function resolveRoot(explicit, env) {
  if (explicit) return path.resolve(explicit);
  if (env && env.RDS_HOME) return path.resolve(env.RDS_HOME);
  return PACKAGE_ROOT;
}

/**
 * 唯一的路径解析实现。优先级：命令行参数 > 环境变量 > 安装根下的默认位置。
 * 调用方（CLI / MCP / doctor / 脚本）不再各写一套。
 */
function resolvePaths({ argv = {}, env = {} } = {}) {
  const root = resolveRoot(argv.root, env);
  const allowed = typeof env.MARS_ALLOWED_ROOTS === 'string' && env.MARS_ALLOWED_ROOTS
    ? env.MARS_ALLOWED_ROOTS.split(';').filter(Boolean)
    : null;
  return {
    root,
    db: path.resolve(argv.db || env.MARS_DB || path.join(root, 'mars', 'var', 'mars.db')),
    principals: path.resolve(argv.principals || env.MARS_PRINCIPALS || path.join(root, 'mars', 'config', 'principals.json')),
    routing: path.resolve(argv.routing || env.MARS_ROUTING || path.join(root, 'mars', 'config', 'role-routing.json')),
    allowedRootsFromEnv: allowed
  };
}

/** 启动时校验路由配置：无效就明确失败，不静默回退到任何默认值。 */
function loadRoutingConfig(assets) {
  let record;
  try {
    record = assets.config('role-routing');
  } catch (err) {
    throw new AppError('ROUTING_UNAVAILABLE', 'routing 配置不可读: ' + (err && err.message));
  }
  const routing = record.value;
  const roles = routing && routing.roles;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing) ||
      !roles || typeof roles !== 'object' || Array.isArray(roles) ||
      Object.keys(roles).length === 0) {
    throw new AppError('ROUTING_UNAVAILABLE', 'routing 配置缺少有效的 roles 对象');
  }
  return routing;
}

module.exports = { PACKAGE_ROOT, resolveRoot, resolvePaths, loadRoutingConfig };
