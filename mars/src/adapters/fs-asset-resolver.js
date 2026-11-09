'use strict';
// 适配器：从文件系统读取契约与配置（M3 / B1）。
//
// 这是唯一允许碰 node:fs 的资产读取点。域模块只拿到已解析、已冻结的对象。
//
// 设计要点：
//   1. 构造时不做 I/O；由组合根显式调用 contract() 完成 fail-fast 预解析；
//   2. 解析结果按文件缓存 —— 契约随包分发且不可变，缓存不会造成「配置改了不生效」的误解，
//      因为用户配置走 config()，其路径由组合根给出且每个进程只读一次（B2 起为启动快照）；
//   3. 失败一律抛 AppError，码来自 ports/asset-resolver.js 的 ERRORS。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../errors');
const { CONTRACT_FILES, ERRORS } = require('../ports/asset-resolver');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function createFsAssetResolver({ root, configPaths = {} } = {}) {
  if (!root) throw new AppError(ERRORS.MISSING, 'AssetResolver 需要 root');
  const resolvedRoot = path.resolve(root);
  const contractsDir = path.join(resolvedRoot, 'mars', 'contracts');
  const cache = new Map();

  function readJson(file, label) {
    const cached = cache.get(file);
    if (cached) return cached;

    let raw;
    try {
      raw = fs.readFileSync(file);
    } catch (err) {
      throw new AppError(ERRORS.MISSING, `${label} 不存在或不可读: ${file}（${err.code || 'READ_FAILED'}）`);
    }

    let value;
    try {
      value = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new AppError(ERRORS.INVALID, `${label} 不是合法 JSON: ${file}（${err.message}）`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppError(ERRORS.INVALID, `${label} 顶层必须是对象: ${file}`);
    }

    const record = Object.freeze({
      value: Object.freeze(value),
      source: 'file',
      hash: sha256(raw)
    });
    cache.set(file, record);
    return record;
  }

  return {
    contract(name) {
      const file = CONTRACT_FILES[name];
      if (!file) throw new AppError(ERRORS.MISSING, `未知契约名: ${name}（已知: ${Object.keys(CONTRACT_FILES).join('/')}）`);
      return readJson(path.join(contractsDir, file), `contract:${name}`);
    },

    config(name) {
      const configured = configPaths[name];
      if (!configured) throw new AppError(ERRORS.MISSING, `配置项 ${name} 的路径未由组合根给出`);
      return readJson(path.resolve(configured), `config:${name}`);
    },

    rootPath() {
      return resolvedRoot;
    }
  };
}

module.exports = { createFsAssetResolver };
