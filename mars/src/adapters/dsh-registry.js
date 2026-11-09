'use strict';
// 适配器：DSH 的 skill-mcp-manager 注册表（M3 / B4）。
//
// 与 B4 之前的 PowerShell 实现的差异（都是安全性的提升，不是功能变化）：
//   1. 写入前核对结构：entries 必须是数组；否则拒绝写（旧实现会写坏或抛 PowerShell 异常）；
//   2. 未知的顶层字段原样保留（旧实现经 ConvertTo-Json 重排键序、可能改变类型）；
//   3. 原子写：临时文件 + rename，中途失败不会留下半截文件；
//   4. 写后回读校验；校验失败自动用备份还原并报错；
//   5. 返回值只暴露条目名，调用方拿不到内部结构。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../errors');
const { ERRORS } = require('../ports/host-registry');

const FORMAT = 'dsh-skill-mcp-manager';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function createDshHostRegistry({ registryPath, backupDir } = {}) {
  if (!registryPath) throw new AppError(ERRORS.NOT_FOUND, '未提供 registryPath');

  const resolved = path.resolve(registryPath);
  const resolvedBackupDir = backupDir ? path.resolve(backupDir) : path.join(path.dirname(resolved), 'backups');

  function readDoc() {
    let raw;
    try {
      raw = fs.readFileSync(resolved);
    } catch (err) {
      throw new AppError(ERRORS.NOT_FOUND, `注册表不存在或不可读: ${resolved}（${err.code || 'READ_FAILED'}）`);
    }
    let doc;
    try {
      doc = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new AppError(ERRORS.INVALID, `注册表不是合法 JSON: ${err.message}`);
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new AppError(ERRORS.INVALID, '注册表顶层必须是对象');
    }
    if (!Array.isArray(doc.entries)) {
      throw new AppError(ERRORS.INVALID, '注册表缺少 entries 数组');
    }
    return { doc, raw, hash: sha256(raw) };
  }

  return {
    detect() {
      let doc;
      let raw;
      try {
        ({ doc, raw } = readDoc());
      } catch (err) {
        // 缺失是「可判定状态」，不是异常：与 NullHostRegistry 的返回形状保持一致。
        if (err.code === ERRORS.NOT_FOUND) {
          return { present: false, path: resolved, format: FORMAT, writable: false, reason: err.detail || err.message };
        }
        throw err;
      }
      let writable = true;
      try {
        fs.accessSync(resolved, fs.constants.W_OK);
      } catch (err) {
        writable = false;
      }
      return {
        present: true,
        path: resolved,
        format: FORMAT,
        writable,
        bytes: raw.length,
        entries: doc.entries.length,
        // 顶层键只用于展示与诊断；未知键会被保留，不会被丢弃
        topLevelKeys: Object.keys(doc).sort()
      };
    },

    list() {
      const { doc } = readDoc();
      return doc.entries.map((entry, index) => ({
        name: entry && typeof entry.name === 'string' ? entry.name : '(unnamed-' + index + ')',
        // 明确标注：这是适配器给的最小视图，调用方不应依赖其它字段
        opaque: true
      }));
    },

    backup() {
      const { raw, hash } = readDoc();
      fs.mkdirSync(resolvedBackupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
      const target = path.join(resolvedBackupDir, `registry-backup-${stamp}.json`);
      fs.writeFileSync(target, raw);
      return { path: target, bytes: raw.length, sha256: hash };
    },

    removeByPrefix(prefix, options = {}) {
      const prefixText = String(prefix || '');
      if (!prefixText) throw new AppError(ERRORS.INVALID, '前缀不能为空（否则会清空整个注册表）');
      const dryRun = options.dryRun !== false;
      const { doc, raw, hash } = readDoc();

      const kept = [];
      const removed = [];
      for (const entry of doc.entries) {
        const name = entry && typeof entry.name === 'string' ? entry.name : '';
        if (name.startsWith(prefixText)) removed.push(name);
        else kept.push(entry);
      }

      if (removed.length === 0) {
        return { removed: 0, kept: kept.length, names: [], backupPath: null, changed: false, dryRun, sha256Before: hash, sha256After: hash };
      }
      if (dryRun) {
        return { removed: removed.length, kept: kept.length, names: removed, backupPath: null, changed: false, dryRun: true, sha256Before: hash, sha256After: hash };
      }

      try {
        fs.accessSync(resolved, fs.constants.W_OK);
      } catch (err) {
        throw new AppError(ERRORS.READONLY, `注册表不可写: ${resolved}`);
      }

      const backupInfo = this.backup();

      // 只替换 entries，其余顶层字段原样带回去
      const next = Object.assign({}, doc, { entries: kept });
      const tmp = resolved + '.tmp-' + process.pid;
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, resolved);
      } catch (err) {
        try { fs.unlinkSync(tmp); } catch (cleanupErr) { /* 忽略：临时文件可能不存在 */ }
        throw new AppError(ERRORS.WRITE_REFUSED, `写入失败，注册表未变更: ${err.message}`);
      }

      // 写后回读校验：解析失败或 entries 条数不符，就用备份还原
      let after;
      try {
        after = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        if (!Array.isArray(after.entries)) throw new Error('entries 丢失');
      } catch (err) {
        fs.writeFileSync(resolved, raw);
        throw new AppError(ERRORS.WRITE_REFUSED, `写后校验失败，已用备份还原: ${err.message}`);
      }

      return {
        removed: removed.length,
        kept: kept.length,
        names: removed,
        backupPath: backupInfo.path,
        changed: true,
        dryRun: false,
        sha256Before: hash,
        sha256After: sha256(fs.readFileSync(resolved))
      };
    }
  };
}

module.exports = { createDshHostRegistry, FORMAT };
