'use strict';
// 测试用资产解析器（M3 / B1）。
//
// 测试允许读仓库文件 —— 分层规则只约束 mars/src 下的域模块。
// 但为了让「缺资产」可测，这里额外提供内存实现：缺键时抛 ASSET_MISSING。
const path = require('node:path');
const { createFsAssetResolver } = require('../../src/adapters/fs-asset-resolver');
const { AppError } = require('../../src/errors');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let cached = null;

/** 从仓库真实契约构造的解析器（不可变缓存，测试间共享只读对象）。 */
function testAssets() {
  if (!cached) cached = createFsAssetResolver({ root: REPO_ROOT, configPaths: {} });
  return cached;
}

/** 内存实现：只含显式给出的契约，用于验证缺资产时的错误码。 */
function memoryAssets(map = {}) {
  const store = new Map(Object.entries(map));
  return {
    contract(name) {
      if (!store.has(name)) throw new AppError('ASSET_MISSING', 'contract:' + name);
      const value = store.get(name);
      return { value: Object.freeze(value), source: 'memory', hash: 'memory:' + name };
    },
    config(name) {
      if (!store.has('config:' + name)) throw new AppError('ASSET_MISSING', 'config:' + name);
      return { value: Object.freeze(store.get('config:' + name)), source: 'memory', hash: 'memory:' + name };
    },
    rootPath() {
      return REPO_ROOT;
    }
  };
}

module.exports = { testAssets, memoryAssets, REPO_ROOT };
