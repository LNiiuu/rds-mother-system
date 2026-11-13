'use strict';
// 平台适配器注册表（M22）。
//
// 只做三件事：登记、按名取、列出能力声明。不做自动发现、不加载插件——
// 当前平台数量少，显式注册比动态加载更容易审计。
// 本文件不碰 fs/env，也不 require 任何 adapters/。

const { validatePlatformAdapter, CAPABILITY_KEYS } = require('./ports/platform-adapter');

function platformError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function createPlatformRegistry() {
  const adapters = new Map();

  const registry = {
    register(adapter) {
      const missing = validatePlatformAdapter(adapter);
      if (missing.length) {
        throw platformError('PLATFORM_INVALID', '适配器不满足端口契约: ' + missing.join(', '));
      }
      const name = adapter.describe().name;
      if (adapters.has(name)) {
        throw platformError('PLATFORM_DUPLICATE', '重复注册的平台适配器: ' + name);
      }
      adapters.set(name, adapter);
      return registry;
    },

    list() {
      return Array.from(adapters.keys()).sort();
    },

    has(name) {
      return adapters.has(String(name));
    },

    resolve(name) {
      const found = adapters.get(String(name));
      if (!found) {
        throw platformError('PLATFORM_NOT_FOUND', `未知平台适配器 ${name}（已注册: ${registry.list().join('/') || '无'}）`);
      }
      return found;
    },

    describe(name) {
      return registry.resolve(name).describe();
    },

    describeAll() {
      return registry.list().map((n) => adapters.get(n).describe());
    },

    /** 按能力取适配器；缺能力就明确拒绝，不做降级猜测。 */
    requireCapability(name, key) {
      if (!CAPABILITY_KEYS.includes(key)) {
        throw platformError('PLATFORM_UNSUPPORTED', '未知能力键: ' + key);
      }
      const desc = registry.describe(name);
      if (desc.capabilities[key] !== true) {
        throw platformError('PLATFORM_UNSUPPORTED', `平台 ${name} 不支持能力 ${key}`);
      }
      return registry.resolve(name);
    }
  };

  return registry;
}

module.exports = { createPlatformRegistry };
