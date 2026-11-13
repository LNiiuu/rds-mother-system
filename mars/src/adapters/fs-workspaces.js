'use strict';
// M18：工作区隔离与受控合并（适配器）。
//
// 三种模式：
//   shared   —— 直接在项目根执行；只适合串行/单写者。
//   worktree —— git worktree add --detach；基于 HEAD 的干净副本。
//   copy     —— 只复制 git 跟踪文件到临时目录；不带未跟踪用户数据。
//
// 安全边界：
//   - 不复制 .git / node_modules / mars/var / docs/history / git-review 等大目录；
//   - 合并只做「新增/修改」，删除一律报冲突，不自动删文件；
//   - 合并前校验 base 的当前哈希与 job 启动时一致，防止覆盖别人的改动；
//   - 同一路径被两个 job 修改时，第二个合并报 DUPLICATE_PATH。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.mars-work', 'mars/var', 'docs/history', 'docs/checks/git-review', 'docs/analysis', 'docs/runs']);
const MAX_FILES = 5000;
const MAX_BYTES = 64 * 1024 * 1024;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function normalizeRel(rel) {
  const s = String(rel || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) {
    throw new Error('WORKSPACE_PATH_INVALID ' + rel);
  }
  return s;
}

function skipped(rel) {
  for (const d of SKIP_DIRS) {
    if (rel === d || rel.startsWith(d + '/')) return true;
  }
  return false;
}

function walk(root) {
  const out = [];
  let truncated = false;
  let bytes = 0;
  const visit = (dir, depth) => {
    if (truncated || depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (skipped(rel)) continue;
      if (e.isDirectory()) { visit(abs, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      bytes += st.size;
      if (out.length >= MAX_FILES || bytes > MAX_BYTES) { truncated = true; return; }
      out.push(rel);
    }
  };
  visit(root, 0);
  return { files: out.sort(), truncated };
}

function snapshot(root) {
  const map = new Map();
  const walked = walk(root);
  for (const rel of walked.files) {
    try { map.set(rel, { sha256: sha256File(path.join(root, rel)), bytes: fs.statSync(path.join(root, rel)).size }); } catch { /* 变化中的文件跳过 */ }
  }
  return { files: map, truncated: walked.truncated };
}

function copyFile(base, dest, rel) {
  const from = path.join(base, rel);
  const to = path.join(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTracked(base, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = null;
  try {
    const raw = execFileSync('git', ['-C', base, 'ls-files', '-z'], { encoding: 'buffer', timeout: 30000 });
    files = raw.toString('utf8').split('\0').filter(Boolean);
  } catch { files = null; }
  if (files) {
    for (const rel of files) {
      if (skipped(rel)) continue;
      const abs = path.join(base, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      copyFile(base, dest, rel);
    }
    return { kind: 'copy', tracked: true, files: files.length };
  }
  // 非 git 仓库：复制目录树，但跳过敏感/大目录。
  const walkCopy = (dir, depth) => {
    if (depth > 12) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(base, abs).replace(/\\/g, '/');
      if (skipped(rel)) continue;
      if (e.isDirectory()) walkCopy(abs, depth + 1);
      else if (e.isFile()) copyFile(base, dest, rel);
    }
  };
  walkCopy(base, 0);
  return { kind: 'copy', tracked: false, files: null };
}

function createWorkspaceManager(options = {}) {
  const baseDir = options.baseDir;
  if (!baseDir) throw new Error('WORKSPACE_BASE_DIR_REQUIRED');
  fs.mkdirSync(baseDir, { recursive: true });

  function prepare({ base_root, plan_id, job_key, attempt, isolation }) {
    const base = path.resolve(String(base_root));
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error('WORKSPACE_BASE_NOT_DIR ' + base);
    if (isolation === 'shared') {
      return { kind: 'shared', path: base, before: snapshot(base), prepared_at: new Date().toISOString() };
    }
    const planDir = path.join(baseDir, String(plan_id));
    fs.mkdirSync(planDir, { recursive: true });
    const dest = path.join(planDir, `${job_key}-a${attempt}`);
    if (fs.existsSync(dest)) throw new Error('WORKSPACE_EXISTS ' + dest);
    if (isolation === 'worktree') {
      try {
        execFileSync('git', ['-C', base, 'worktree', 'add', '--detach', dest, 'HEAD'], { timeout: 30000, stdio: 'pipe' });
        return { kind: 'worktree', path: dest, before: snapshot(dest), prepared_at: new Date().toISOString() };
      } catch (e) {
        // 非 git 仓库/无 HEAD：降级为 copy，并显式记录原因。
        const info = copyTracked(base, dest);
        return { kind: 'copy', path: dest, before: snapshot(dest), fallback_from: 'worktree', fallback_reason: e.message.slice(0, 200), ...info, prepared_at: new Date().toISOString() };
      }
    }
    if (isolation === 'copy') {
      const info = copyTracked(base, dest);
      return { kind: 'copy', path: dest, before: snapshot(dest), ...info, prepared_at: new Date().toISOString() };
    }
    throw new Error('WORKSPACE_ISOLATION_INVALID ' + isolation);
  }

  function changes(info) {
    const now = snapshot(info.path);
    const files = [];
    for (const [rel, cur] of now.files) {
      const before = info.before.files.get(rel);
      if (!before) files.push({ path: rel, status: 'added', sha256: cur.sha256, bytes: cur.bytes });
      else if (before.sha256 !== cur.sha256) files.push({ path: rel, status: 'modified', sha256: cur.sha256, bytes: cur.bytes, before_sha256: before.sha256 });
    }
    for (const [rel, before] of info.before.files) {
      if (!now.files.has(rel)) files.push({ path: rel, status: 'deleted', sha256: null, bytes: 0, before_sha256: before.sha256 });
    }
    return { files, truncated: Boolean(info.before.truncated || now.truncated), workspace: info.path };
  }

  /**
   * 受控合并。先全量校验，再统一写入；任何冲突都不写。
   */
  function merge({ base_root, workspace, changes: list, job_key, owners, apply = true }) {
    const base = path.resolve(String(base_root));
    const ownerMap = owners || new Map();
    const conflicts = [];
    const planned = [];
    for (const c of list || []) {
      let rel;
      try { rel = normalizeRel(c.path); } catch (e) { conflicts.push({ path: String(c.path), reason: 'PATH_INVALID', detail: e.message }); continue; }
      const owner = ownerMap.get(rel);
      if (owner && owner !== job_key) { conflicts.push({ path: rel, reason: 'DUPLICATE_PATH', owner }); continue; }
      if (c.status === 'deleted') { conflicts.push({ path: rel, reason: 'DELETE_NOT_AUTO_MERGED' }); continue; }
      const target = path.join(base, rel);
      const exists = fs.existsSync(target);
      if (!exists && c.status === 'modified') { conflicts.push({ path: rel, reason: 'MISSING_IN_BASE' }); continue; }
      if (exists) {
        const cur = sha256File(target);
        if (c.before_sha256 && cur !== c.before_sha256) { conflicts.push({ path: rel, reason: 'BASE_CHANGED', expected: c.before_sha256, actual: cur }); continue; }
        if (!c.before_sha256 && c.status === 'added') { conflicts.push({ path: rel, reason: 'ALREADY_EXISTS' }); continue; }
      }
      const src = path.join(workspace, rel);
      if (!fs.existsSync(src)) { conflicts.push({ path: rel, reason: 'SOURCE_MISSING' }); continue; }
      planned.push({ ...c, path: rel, target, src });
    }
    if (conflicts.length) return { ok: false, conflicts, merged: [] };
    if (!apply) {
      for (const p of planned) ownerMap.set(p.path, job_key);
      return { ok: true, conflicts: [], merged: planned.map((p) => ({ path: p.path, status: p.status, applied: false })) };
    }
    const merged = [];
    for (const p of planned) {
      fs.mkdirSync(path.dirname(p.target), { recursive: true });
      fs.copyFileSync(p.src, p.target);
      ownerMap.set(p.path, job_key);
      merged.push({ path: p.path, status: p.status, sha256: sha256File(p.target), applied: true });
    }
    if (conflicts.length) return { ok: false, conflicts, merged };
    return { ok: true, conflicts: [], merged };
  }

  function cleanup(info) {
    if (!info || info.kind === 'shared') return { removed: false };
    try {
      if (info.kind === 'worktree') {
        execFileSync('git', ['-C', path.resolve(info.path), 'worktree', 'remove', '--force', info.path], { timeout: 30000, stdio: 'pipe' });
      } else {
        fs.rmSync(info.path, { recursive: true, force: true });
      }
      return { removed: true };
    } catch (e) {
      return { removed: false, error: e.message };
    }
  }

  return { baseDir, prepare, changes, merge, cleanup, snapshot };
}

module.exports = { createWorkspaceManager, snapshot, walk, normalizeRel, SKIP_DIRS };
