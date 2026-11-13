'use strict';
// W-01 代码库理解与依赖梳理（M14-1）。
//
// 这是唯一一个**纯本地、零外部工具**的工作流：只用 node 的文件 API。
// 因此它在任何环境下都可真实执行——这也是它作为「陌生代码库第一站」的理由。
//
// 输出刻意区分「事实」与「推断」：
//   事实：文件名、大小、后缀计数、manifest 字段、目录结构
//   推断：语言归类、入口候选、测试框架识别

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 20000;
const MAX_DEPTH = 12;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);

const LANG_BY_EXT = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.m': 'Objective-C',
  '.sh': 'Shell', '.ps1': 'PowerShell', '.sql': 'SQL',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.md': 'Markdown',
  '.html': 'HTML', '.css': 'CSS', '.vue': 'Vue', '.svelte': 'Svelte'
};

const TEST_FRAMEWORKS = [
  { name: 'node:test', re: /node:test/ },
  { name: 'jest', re: /\bjest\b/ },
  { name: 'mocha', re: /\bmocha\b/ },
  { name: 'vitest', re: /\bvitest\b/ },
  { name: 'pytest', re: /\bpytest\b/ },
  { name: 'go test', re: /_test\.go$/ }
];

function walk(root, state, dir = root, depth = 0) {
  if (state.truncated) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (state.files.length >= MAX_FILES) { state.truncated = true; return; }
    if (e.name.startsWith('.') && e.name !== '.env.example') {
      if (e.isDirectory()) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || depth >= MAX_DEPTH) continue;
      walk(root, state, full, depth + 1);
      continue;
    }
    if (!e.isFile()) continue;
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    state.files.push({ path: path.relative(root, full).replace(/\\/g, '/'), bytes: st.size, ext: path.extname(e.name).toLowerCase() });
  }
}

function readManifest(root) {
  const out = [];
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      out.push({
        file: 'package.json', type: 'npm', name: j.name || null, version: j.version || null,
        main: j.main || null, bin: j.bin ? Object.keys(typeof j.bin === 'string' ? { [j.name || 'bin']: j.bin } : j.bin) : [],
        scripts: j.scripts ? Object.keys(j.scripts) : [],
        dependencies: j.dependencies ? Object.keys(j.dependencies).length : 0,
        dev_dependencies: j.devDependencies ? Object.keys(j.devDependencies).length : 0
      });
    } catch (e) {
      out.push({ file: 'package.json', type: 'npm', parse_error: e.message });
    }
  }
  for (const [file, type] of [['go.mod', 'go'], ['Cargo.toml', 'cargo'], ['pyproject.toml', 'python'], ['requirements.txt', 'python']]) {
    const p = path.join(root, file);
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8').slice(0, 4000);
      out.push({ file, type, first_line: text.split(/\r?\n/)[0] || null, bytes: Buffer.byteLength(text) });
    }
  }
  return out;
}

function detectEntries(root, files, manifests) {
  const out = [];
  for (const m of manifests) {
    if (m.type === 'npm' && m.main) out.push({ path: m.main, reason: 'package.json main' });
    if (m.type === 'npm' && m.bin) for (const b of m.bin) out.push({ path: 'bin:' + b, reason: 'package.json bin' });
  }
  const candidates = [
    ['index.js', 'index.js at root'], ['index.mjs', 'index.mjs at root'], ['src/index.js', 'src/index.js'],
    ['main.py', 'main.py'], ['__main__.py', '__main__.py'], ['cmd/main.go', 'go cmd entry'],
    ['app.js', 'app.js'], ['server.js', 'server.js'], ['bin/rds.mjs', 'cli entry']
  ];
  for (const [rel, reason] of candidates) {
    if (files.some((f) => f.path === rel)) out.push({ path: rel, reason });
  }
  // 去重
  const seen = new Set();
  return out.filter((e) => (seen.has(e.path) ? false : seen.add(e.path)));
}

function detectTests(root, files) {
  const testFiles = files.filter((f) => /(^|\/)(test|tests|__tests__|spec)\//.test(f.path) || /\.(test|spec)\.[a-z]+$/.test(f.path));
  const sample = [];
  for (const tf of testFiles.slice(0, 40)) {
    try {
      const text = fs.readFileSync(path.join(root, tf.path), 'utf8').slice(0, 4000);
      for (const fw of TEST_FRAMEWORKS) {
        if (fw.re.test(text) && !sample.some((s) => s.name === fw.name)) {
          sample.push({ name: fw.name, evidence: tf.path });
        }
      }
    } catch { /* 读不到就跳过，不假装识别 */ }
  }
  return { files: testFiles.length, samples: testFiles.slice(0, 10).map((f) => f.path), frameworks: sample };
}

const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

/** 静态 import/require 扫描：只读字节，不做 AST；结果是“可解析的边”，不是运行时依赖。 */
function analyzeJsFile(root, rel) {
  const abs = path.join(root, rel);
  let text;
  try { text = fs.readFileSync(abs, 'utf8').slice(0, 200 * 1024); } catch { return null; }
  const imports = new Set();
  const patterns = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) imports.add(m[1]);
  }
  const symbols = new Set();
  for (const re of [
    /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g
  ]) {
    let m;
    while ((m = re.exec(text))) symbols.add(m[1]);
  }
  const local = [];
  const external = [];
  for (const spec of imports) {
    if (!spec.startsWith('.')) { external.push(spec); continue; }
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    const candidates = [base, base + '.js', base + '.mjs', base + '.cjs', base + '.ts', base + '.tsx', base + '/index.js'];
    const found = candidates.find((c) => fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile());
    if (found) local.push(found);
    else external.push(spec);
  }
  return { imports: [...imports].sort(), local_edges: [...new Set(local)].sort(), external: [...new Set(external)].sort(), symbols: [...symbols].sort() };
}

/** 依赖图 + 符号 + 关键模块（按入度）。 */
function analyzeDependencies(root, files) {
  const jsFiles = files.filter((f) => JS_EXT.has(f.ext)).slice(0, 500);
  const nodes = [];
  const edges = [];
  const external = new Map();
  const symbols = [];
  for (const f of jsFiles) {
    const a = analyzeJsFile(root, f.path);
    if (!a) continue;
    nodes.push(f.path);
    for (const to of a.local_edges) edges.push({ from: f.path, to, kind: 'static-import' });
    for (const e of a.external) external.set(e, (external.get(e) || 0) + 1);
    for (const s of a.symbols) symbols.push({ name: s, file: f.path });
  }
  const fanIn = new Map();
  for (const e of edges) fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
  return {
    nodes: nodes.length,
    edges: edges.length,
    local_edges: edges.slice(0, 2000),
    external_dependencies: [...external.entries()].map(([name, files]) => ({ name, files })).sort((x, y) => y.files - x.files).slice(0, 30),
    symbols: symbols.slice(0, 300),
    key_modules: [...fanIn.entries()].map(([file, inbound]) => ({ file, inbound })).sort((a, b) => b.inbound - a.inbound).slice(0, 10),
    method: 'static import/require regex; no AST, no dynamic import, no type resolution'
  };
}


const workflow = {
  workflow_id: 'W-01',
  title: '代码库理解与依赖梳理',
  engine: 'local-fs',
  completeness: 'partial',
  // 强弱声明：本工作流不依赖任何外部逆向工具，因此不存在 BLOCKED 风险
  requires: [],

  input_schema: {
    type: 'object',
    properties: {
      root: { type: 'string', description: '代码库根目录（绝对路径）' },
      max_files: { type: 'number', description: '扫描文件上限，默认 20000' }
    },
    required: ['root']
  },

  result_schema: {
    type: 'object',
    properties: {
      root: { type: 'string' },
      files_scanned: { type: 'number' },
      truncated: { type: 'boolean' },
      by_extension: { type: 'object' },
      languages: { type: 'array' },
      top_dirs: { type: 'array' },
      manifests: { type: 'array' },
      entries: { type: 'array' },
      tests: { type: 'object' },
      dependencies: { type: 'object' },
      symbols: { type: 'array' },
      largest: { type: 'array' },
      readme: { type: 'object' }
    }
  },

  async preflight(input) {
    const checks = [];
    const root = input && input.root ? path.resolve(String(input.root)) : null;
    checks.push({ check: 'root 已提供', ok: Boolean(root) });
    if (!root) return { ok: false, checks, blocked_reason: 'ROOT_REQUIRED' };
    const exists = fs.existsSync(root);
    checks.push({ check: 'root 存在', ok: exists, detail: root });
    if (!exists) return { ok: false, checks, blocked_reason: 'ROOT_NOT_FOUND' };
    const isDir = fs.statSync(root).isDirectory();
    checks.push({ check: 'root 是目录', ok: isDir });
    let readable = false;
    try { fs.readdirSync(root); readable = true; } catch { readable = false; }
    checks.push({ check: 'root 可读', ok: readable });
    return { ok: exists && isDir && readable, checks, blocked_reason: exists && isDir && readable ? null : 'ROOT_NOT_READABLE' };
  },

  async execute(input) {
    const root = path.resolve(String(input.root));
    const state = { files: [], truncated: false };
    walk(root, state);

    const byExt = {};
    let totalBytes = 0;
    for (const f of state.files) {
      byExt[f.ext || '(none)'] = (byExt[f.ext || '(none)'] || 0) + 1;
      totalBytes += f.bytes;
    }

    const langAgg = {};
    for (const f of state.files) {
      const lang = LANG_BY_EXT[f.ext];
      if (!lang) continue;
      if (!langAgg[lang]) langAgg[lang] = { name: lang, files: 0, bytes: 0 };
      langAgg[lang].files += 1;
      langAgg[lang].bytes += f.bytes;
    }
    const languages = Object.values(langAgg).sort((a, b) => b.files - a.files);

    const dirAgg = {};
    for (const f of state.files) {
      const top = f.path.includes('/') ? f.path.split('/')[0] : '(root)';
      dirAgg[top] = (dirAgg[top] || 0) + 1;
    }
    const topDirs = Object.entries(dirAgg).map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files).slice(0, 15);

    const manifests = readManifest(root);
    const entries = detectEntries(root, state.files, manifests);
    const tests = detectTests(root, state.files);
    const dependencies = analyzeDependencies(root, state.files);
    const symbols = dependencies.symbols.slice(0, 100);
    const largest = [...state.files].sort((a, b) => b.bytes - a.bytes).slice(0, 10);

    let readme = null;
    for (const name of ['README.md', 'README.MD', 'readme.md', 'README.txt']) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8').slice(0, 4000);
        readme = { path: name, title: (text.split(/\r?\n/).find((l) => l.startsWith('#')) || '').replace(/^#+\s*/, ''), bytes: Buffer.byteLength(text) };
        break;
      }
    }

    const result = {
      root,
      files_scanned: state.files.length,
      truncated: state.truncated,
      total_bytes: totalBytes,
      by_extension: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 20)),
      languages,
      top_dirs: topDirs,
      manifests,
      entries,
      tests,
      dependencies,
      symbols,
      largest,
      readme,
      // 目标里没做到的部分，明确列出——避免 PARTIAL 被读成 PASS
      not_done: ['完整 AST/类型解析', '动态 import 与运行时依赖', '运行时行为'],
      // 明确标注哪些是推断
      inference_notes: [
        'languages 由扩展名映射得出，是推断，不是编译/解析结果',
        'entries 来自 manifest 字段与常见文件名约定，是候选而非确认',
        'tests.frameworks 来自测试文件内容的关键字匹配，可能漏判'
      ]
    };

    return {
      result,
      tool_versions: [{ name: 'node', version: process.version, kind: 'runtime' }],
      commands: [],
      limitations: [
        '依赖图来自 import/require 正则，不做 AST/类型解析；动态 import 可能漏',
        '二进制文件不会被解析，只统计大小'
      ]
    };
  },

  render(result) {
    const L = [];
    L.push(`# W-01 代码库理解：${result.root}`);
    L.push('');
    L.push(`扫描文件 **${result.files_scanned}** 个${result.truncated ? '（已达上限，结果不完整）' : ''}，合计 ${(result.total_bytes / 1024).toFixed(1)} KB。`);
    L.push('');
    L.push('## 语言分布（推断）');
    L.push('');
    L.push('| 语言 | 文件数 | 字节 |');
    L.push('|---|---:|---:|');
    for (const l of result.languages.slice(0, 12)) L.push(`| ${l.name} | ${l.files} | ${l.bytes} |`);
    L.push('');
    L.push('## 顶层目录');
    L.push('');
    L.push(result.top_dirs.map((d) => `- \`${d.name}\` — ${d.files} 个文件`).join('\n') || '（无）');
    L.push('');
    L.push('## 工程清单');
    L.push('');
    if (!result.manifests.length) L.push('（未发现 package.json / go.mod / Cargo.toml / pyproject.toml）');
    for (const m of result.manifests) {
      L.push(`- \`${m.file}\`（${m.type}）` + (m.name ? ` name=${m.name}` : '') + (m.scripts ? ` scripts=${m.scripts.join(',')}` : ''));
    }
    L.push('');
    L.push('## 入口候选（推断）');
    L.push('');
    L.push(result.entries.map((e) => `- \`${e.path}\` — ${e.reason}`).join('\n') || '（未识别到入口）');
    L.push('');
    L.push('## 测试');
    L.push('');
    L.push(`测试文件 ${result.tests.files} 个；识别到的框架：${result.tests.frameworks.map((f) => f.name).join(', ') || '未识别'}`);
    L.push('');
    L.push('## 静态依赖图（推断）');
    L.push('');
    L.push(`节点 ${result.dependencies ? result.dependencies.nodes : 0} 个，边 ${result.dependencies ? result.dependencies.edges : 0} 条；方法：${result.dependencies ? result.dependencies.method : '未执行'}`);
    L.push('');
    for (const k of (result.dependencies ? result.dependencies.key_modules : []).slice(0, 5)) {
      L.push(`- 关键模块 \`${k.file}\` — 入度 ${k.inbound}`);
    }
    L.push('');
    L.push('## 符号（前 20）');
    L.push('');
    for (const s of (result.symbols || []).slice(0, 20)) L.push(`- \`${s.name}\` — ${s.file}`);
    L.push('');
    L.push('## 最大的文件');
    L.push('');
    for (const f of result.largest.slice(0, 5)) L.push(`- \`${f.path}\` — ${f.bytes} B`);
    L.push('');
    L.push('## 推断与事实的边界');
    L.push('');
    for (const n of result.inference_notes) L.push(`- ${n}`);
    return L.join('\n') + '\n';
  }
};

module.exports = workflow;
