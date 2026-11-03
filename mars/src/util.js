'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
}

// Token 估算：CJK 约 1 token/1.6 字，其他约 1 token/4 字符；仅用于预算占位，必须标注 [ESTIMATE]。
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of String(text)) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.6 + other / 4);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function clampInt(n, min, max) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// 来源路径守卫：只允许仓库相对路径；禁止绝对路径、盘符、`..`、以及逃出允许根的真实路径。
function guardSourceRef(ref, allowedRoots) {
  const text = String(ref || '');
  if (!text || text.length > 512) return { ok: false, reason: 'EMPTY_OR_TOO_LONG' };
  if (/^[a-zA-Z]:/.test(text) || text.startsWith('\\\\') || text.startsWith('/')) {
    return { ok: false, reason: 'ABSOLUTE_PATH_DENIED' };
  }
  const normalized = text.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) return { ok: false, reason: 'TRAVERSAL_DENIED' };
  const roots = (allowedRoots || []).map(r => path.resolve(r));
  if (roots.length) {
    const candidate = path.resolve(roots[0], normalized);
    const inside = roots.some(root => candidate === root || candidate.startsWith(root + path.sep));
    if (!inside) return { ok: false, reason: 'OUTSIDE_ALLOWED_ROOT' };
    try {
      const real = fs.realpathSync(candidate);
      const realInside = roots.some(root => {
        const realRoot = fs.realpathSync(root);
        return real === realRoot || real.startsWith(realRoot + path.sep);
      });
      if (!realInside) return { ok: false, reason: 'SYMLINK_ESCAPE_DENIED' };
    } catch (err) {
      if (err && err.code !== 'ENOENT') return { ok: false, reason: 'REALPATH_BLOCKED' };
    }
  }
  return { ok: true, normalized };
}

module.exports = {
  sha256, nowIso, newId, stableJson, estimateTokens,
  ensureDir, readJson, writeJsonAtomic, clampInt, guardSourceRef
};
