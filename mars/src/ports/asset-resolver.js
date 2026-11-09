'use strict';
// 端口：AssetResolver（M3 / B1）
//
// 职责：唯一负责「契约与配置从哪来」的问答。
// 为什么需要它：在 B1 之前，store / compiler / manifest 三个域模块在 **require 阶段**
// 用 path.resolve(__dirname,'..') 拼路径读 contracts/*.schema.json，
// 导致 ① 模块与安装目录绑定；② 测试无法替换契约；③ 缺文件时抛原生 ENOENT 而不是带码的错误。
//
// 约束（由 tooling/layering-check.mjs 机械检查）：
//   - 本文件零 require；
//   - 方法数 <= 5；
//   - 不依赖其他端口。
//
// 契约形状：
//   contract(name) -> { value, source, hash }
//   config(name)   -> { value, source, hash }
//   rootPath()     -> string

const METHODS = ['contract', 'config', 'rootPath'];

const ERRORS = Object.freeze({
  MISSING: 'ASSET_MISSING',
  INVALID: 'ASSET_INVALID',
  HASH_MISMATCH: 'ASSET_HASH_MISMATCH'
});

// 随发行包分发的不可变契约。名字是逻辑名，不是文件名。
const CONTRACT_FILES = Object.freeze({
  memory: 'memory.schema.json',
  'context-packet': 'context-packet.schema.json',
  manifest: 'manifest.schema.json',
  ledger: 'ledger.schema.json',
  'role-routing': 'role-routing.schema.json'
});

const KNOWN_CONTRACTS = Object.freeze(Object.keys(CONTRACT_FILES));

// 可变的用户配置。路径由组合根决定（CLI 参数 / 环境变量 / 默认值），端口只按名字取。
const KNOWN_CONFIGS = Object.freeze(['role-routing', 'principals']);

module.exports = { METHODS, ERRORS, CONTRACT_FILES, KNOWN_CONTRACTS, KNOWN_CONFIGS };
