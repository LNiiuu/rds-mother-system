'use strict';
// 外部工具探测与受控执行（M14）。
//
// 原则：
//   1. 先探测再执行，缺工具就报缺，不假装跑过
//   2. 全部走 execFile（不经 shell），带超时与输出上限
//   3. 版本号必须能写进证据——否则「用 Ghidra 12.1 分析的」这句话无法复核

const { execFile } = require('node:child_process');
const os = require('node:os');

const DEFAULT_TIMEOUT = 120000;
const MAX_BUFFER = 24 * 1024 * 1024;

/** 在 PATH 里找可执行文件。Windows 用 where，其它用 which。 */
function locate(bin) {
  const finder = os.platform() === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [bin], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(first || null);
    });
  });
}

/** 跑一条命令，永远 resolve（不抛），把失败也变成结构化结果。 */
function run(bin, args, options = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, {
      timeout: options.timeout || DEFAULT_TIMEOUT,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      cwd: options.cwd,
      windowsHide: true,
      env: options.env || process.env
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        timed_out: Boolean(err && err.killed),
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

/**
 * 探测一组工具：是否存在、路径、版本串。
 * 版本串取 `--version` 的第一行；拿不到就写 unknown（不猜）。
 */
async function probe(names, options = {}) {
  const out = [];
  for (const name of names) {
    const path = await locate(name);
    const entry = { name, present: Boolean(path), path: path || null, version: null };
    if (path) {
      const flag = (options.versionFlag && options.versionFlag[name]) || '--version';
      const r = await run(path, [flag], { timeout: 8000 });
      const text = (r.stdout || r.stderr || '').trim().split(/\r?\n/)[0] || '';
      entry.version = text.slice(0, 160) || 'unknown';
      entry.probe_ok = r.ok;
    }
    out.push(entry);
  }
  return out;
}

module.exports = { locate, run, probe, DEFAULT_TIMEOUT };
