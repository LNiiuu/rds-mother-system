'use strict';
// 文件系统工具执行器（M12）。
//
// 这是「Agent 能对工作区做什么」的唯一出口。刻意做成**白名单 + 根目录约束**：
//   read_file / list_dir / write_file / run_test
// 没有 run_command，没有 shell。模型即使要求执行 rm -rf，协议层也无处表达。
//
// 根目录约束不是字符串前缀比较：先 realpath 再比，符号链接指向根外会被拒绝。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const LIMITS = {
  readBytes: 200 * 1024,
  writeBytes: 400 * 1024,
  listEntries: 500,
  testTimeoutMs: 120000
};

const TOOLS = [
  {
    name: 'read_file',
    description: '读取工作区内一个文本文件。超过 200 KB 或被判定为二进制时拒绝。',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'list_dir',
    description: '列出工作区内一个目录的直接子项（最多 500 项）。',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: '写入（覆盖）工作区内一个文本文件，自动创建父目录。返回字节数与 SHA-256。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_test',
    description: '在工作区内运行 node --test（自动发现 test/ 或 tests/ 下的 *.test.js），返回 TAP 摘要。',
    parameters: {
      type: 'object',
      properties: { dir: { type: 'string' }, timeout_ms: { type: 'number' } }
    }
  }
];

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isProbablyBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

/**
 * @param {object} options
 * @param {string} options.root 工作区根（必须已存在）
 * @param {number} [options.testTimeoutMs]
 */
function createFsToolExecutor(options = {}) {
  const declaredRoot = options.root;
  if (!declaredRoot || !path.isAbsolute(declaredRoot)) {
    throw new Error('TOOL_ROOT_INVALID 需要绝对路径');
  }
  const root = fs.realpathSync(declaredRoot);
  const testTimeoutMs = Number(options.testTimeoutMs || LIMITS.testTimeoutMs);

  /** 把用户给的相对路径解析成根内绝对路径；逃逸或绝对路径一律拒绝。 */
  function resolveInside(target) {
    const raw = String(target == null ? '.' : target);
    if (path.isAbsolute(raw)) {
      throw Object.assign(new Error('TOOL_PATH_ESCAPE 不允许绝对路径: ' + raw), { code: 'TOOL_PATH_ESCAPE' });
    }
    const abs = path.resolve(root, raw);
    // 对已存在的路径取 realpath 再判；新文件则判其最近的已存在父目录。
    let probe = abs;
    while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw Object.assign(new Error('TOOL_PATH_ESCAPE 越出工作区: ' + raw), { code: 'TOOL_PATH_ESCAPE' });
    }
    return abs;
  }

  function fail(code, message, meta = {}) {
    return { ok: false, output: '', error_code: code, message, meta };
  }

  function readFile(args) {
    const abs = resolveInside(args.path);
    const st = fs.statSync(abs);
    if (!st.isFile()) return fail('TOOL_NOT_A_FILE', abs);
    if (st.size > LIMITS.readBytes) return fail('TOOL_TOO_LARGE', `${st.size} B > ${LIMITS.readBytes} B`, { bytes: st.size });
    const buf = fs.readFileSync(abs);
    if (isProbablyBinary(buf)) return fail('TOOL_BINARY', '二进制文件不通过 read_file 读取', { bytes: buf.length });
    return {
      ok: true, output: buf.toString('utf8'), error_code: null,
      meta: { path: path.relative(root, abs), bytes: buf.length, sha256: sha256Hex(buf) }
    };
  }

  function listDir(args) {
    const abs = resolveInside(args.path);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .slice(0, LIMITS.listEntries)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' }));
    return { ok: true, output: entries.map((e) => e.type + ' ' + e.name).join('\n'), error_code: null, meta: { path: path.relative(root, abs) || '.', count: entries.length } };
  }

  function writeFile(args) {
    const content = String(args.content == null ? '' : args.content);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > LIMITS.writeBytes) return fail('TOOL_TOO_LARGE', `${bytes} B > ${LIMITS.writeBytes} B`, { bytes });
    const abs = resolveInside(args.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return {
      ok: true, output: 'written ' + bytes + ' B', error_code: null,
      meta: { path: path.relative(root, abs), bytes, sha256: sha256Hex(Buffer.from(content, 'utf8')) }
    };
  }

  function discoverTests(dirAbs) {
    const out = [];
    const walk = (d, depth) => {
      if (depth > 4 || out.length >= 200) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (/\.test\.js$/.test(e.name)) out.push(p);
      }
    };
    walk(dirAbs, 0);
    return out.sort();
  }

  function runTest(args) {
    const dirRel = args.dir ? String(args.dir) : (fs.existsSync(path.join(root, 'test')) ? 'test' : fs.existsSync(path.join(root, 'tests')) ? 'tests' : '.');
    const dirAbs = resolveInside(dirRel);
    const files = discoverTests(dirAbs);
    if (!files.length) return fail('TOOL_NO_TESTS', '在 ' + dirRel + ' 下没找到 *.test.js');
    const timeout = Number(args.timeout_ms || testTimeoutMs);
    return new Promise((resolve) => {
      // 关键：清掉 NODE_TEST_CONTEXT。否则在被测进程里再起 node --test 会被判定为
      // 「递归调用 test runner」而直接跳过，测试看起来'通过'但一条没跑。
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      execFile(process.execPath, ['--test', '--test-reporter=tap', ...files], {
        cwd: root, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: childEnv
      }, (err, stdout, stderr) => {
        const out = String(stdout || '');
        const summary = {
          tests: pick(out, /^# tests (\d+)$/m),
          pass: pick(out, /^# pass (\d+)$/m),
          fail: pick(out, /^# fail (\d+)$/m),
          skipped: pick(out, /^# skipped (\d+)$/m),
          files: files.length,
          exit_code: err && typeof err.code === 'number' ? err.code : 0,
          timed_out: Boolean(err && err.killed)
        };
        const okRun = !summary.timed_out && summary.fail === 0 && summary.exit_code === 0;
        resolve({
          ok: okRun,
          output: out.slice(-8000) || String(stderr || '').slice(-2000),
          error_code: okRun ? null : (summary.timed_out ? 'TOOL_TEST_TIMEOUT' : 'TOOL_TEST_FAILED'),
          meta: summary
        });
      });
    });
  }

  function pick(text, re) {
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  }

  return {
    root,
    name: 'fs',
    list() { return TOOLS.map((t) => ({ ...t })); },
    async invoke(name, args = {}) {
      try {
        switch (name) {
          case 'read_file': return readFile(args);
          case 'list_dir': return listDir(args);
          case 'write_file': return writeFile(args);
          case 'run_test': return await runTest(args);
          default: return fail('TOOL_UNKNOWN', '未注册的工具: ' + name + '（白名单：' + TOOLS.map((t) => t.name).join(',') + '）');
        }
      } catch (e) {
        // 把 Node 的 errno 收敛成稳定错误码，避免上层看到 ENOENT/EACCES 这类平台细节。
        const map = { ENOENT: 'TOOL_NOT_FOUND', EACCES: 'TOOL_ACCESS_DENIED', EPERM: 'TOOL_ACCESS_DENIED', EISDIR: 'TOOL_NOT_A_FILE' };
        return fail(map[e.code] || e.code || 'TOOL_ERROR', e.message);
      }
    },
    healthCheck() {
      const checks = [];
      checks.push({ tool: 'read_file', ok: true, detail: 'root=' + root });
      checks.push({ tool: 'list_dir', ok: true });
      checks.push({ tool: 'write_file', ok: fs.existsSync(root) });
      const hasTests = discoverTests(root).length > 0;
      checks.push({ tool: 'run_test', ok: hasTests, detail: hasTests ? '' : '工作区内无 *.test.js（工具可用，但当前无测试）' });
      return { ok: checks.every((c) => c.ok || c.tool === 'run_test'), checks };
    }
  };
}

module.exports = { createFsToolExecutor, TOOLS, LIMITS };
