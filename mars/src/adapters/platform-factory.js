'use strict';
// 平台适配器工厂（M22）。
//
// 组合根只拿到「名字 -> 适配器」这一层；平台协议细节留在各自文件。
// 不自动发现、不扫描目录：新增平台必须在 CATALOG 显式登记。

const { createMemoryPlatform } = require('./platform-memory');
const { createHttpPlatform } = require('./platform-http');
const { createDshPlatform } = require('./platform-dsh');
const { createWorkbuddyPlatform } = require('./platform-workbuddy');

const CATALOG = Object.freeze({
  memory: {
    kind: 'reference',
    requires: [],
    create: (options) => createMemoryPlatform(options)
  },
  http: {
    kind: 'http',
    requires: ['baseUrl'],
    create: (options) => createHttpPlatform(options)
  },
  dsh: {
    kind: 'file-queue',
    requires: ['root'],
    create: (options) => createDshPlatform(options)
  },
  workbuddy: {
    kind: 'guest-bridge',
    requires: ['bridge'],
    create: (options) => createWorkbuddyPlatform(options)
  }
});

function platformNames() {
  return Object.keys(CATALOG).sort();
}

function platformCatalog() {
  return platformNames().map((name) => ({
    name,
    kind: CATALOG[name].kind,
    requires: CATALOG[name].requires.slice()
  }));
}

function createPlatform(name, options = {}) {
  const entry = CATALOG[String(name)];
  if (!entry) throw new Error('PLATFORM_UNKNOWN ' + name + '（可用：' + platformNames().join(',') + '）');
  for (const key of entry.requires) {
    if (!options[key]) {
      const e = new Error(`缺少适配器选项 ${name}.${key}`);
      e.code = 'PLATFORM_OPTION_REQUIRED';
      throw e;
    }
  }
  return entry.create(options);
}

module.exports = { platformNames, platformCatalog, createPlatform };
