'use strict';
// 会话来源注册表（M3 / B3）。
//
// 只有一件事：知道「有哪些数据源」以及「这段字节该交给谁解析」。
// 生产环境只注册 dsh-session 一个来源；注册动作由组合根显式完成，
// 不做自动发现、不做插件加载 —— 当前只有一个真实宿主，多一层动态机制只会带来打包与信任问题。
const { AppError } = require('./errors');
const { ERRORS } = require('./ports/session-source');

function createSessionRegistry() {
  const sources = new Map();

  const registry = {
    register(source) {
      if (!source || typeof source.kind !== 'function' || typeof source.parse !== 'function') {
        throw new AppError(ERRORS.UNSUPPORTED, '数据源必须实现 kind() 与 parse()');
      }
      const kind = String(source.kind());
      if (sources.has(kind)) throw new AppError(ERRORS.UNSUPPORTED, '重复注册的数据源: ' + kind);
      sources.set(kind, source);
      return registry;
    },

    list() {
      return Array.from(sources.keys()).sort();
    },

    /**
     * 按 kind 取；kind 缺省时用 sniff 嗅探。
     * 规则：命中 1 个才用；0 个或多于 1 个都报错 —— 宁可让调用方显式指定，也不猜。
     */
    resolve({ kind, bytes } = {}) {
      if (kind) {
        const found = sources.get(String(kind));
        if (!found) {
          throw new AppError(ERRORS.UNSUPPORTED, `未知数据源 ${kind}（已注册: ${registry.list().join('/') || '无'}）`);
        }
        return found;
      }
      if (!bytes || !bytes.length) {
        throw new AppError(ERRORS.UNSUPPORTED, '未指定数据源，且没有可供嗅探的内容');
      }
      const hits = Array.from(sources.values()).filter((s) => typeof s.sniff === 'function' && s.sniff(bytes));
      if (hits.length === 1) return hits[0];
      if (hits.length === 0) {
        throw new AppError(ERRORS.UNSUPPORTED, `无法识别会话格式（已注册: ${registry.list().join('/')}）`);
      }
      throw new AppError(ERRORS.AMBIGUOUS, `多个数据源都能解析（${hits.map((h) => h.kind()).join('/')}），请用 --source 指定`);
    }
  };

  return registry;
}

module.exports = { createSessionRegistry };
