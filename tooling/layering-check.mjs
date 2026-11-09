#!/usr/bin/env node
/**
 * 分层检查（M3 / B0）。
 *
 * 目的：把 M3 设计的依赖方向规则变成可执行断言，而不是靠评审时的自觉。
 * 规则来源：docs/architecture/m3/host-adapter-design.md §2 / §6。
 *
 * 检查项
 *   L1 端口模块零 require（不依赖 node:*，也不依赖其他端口）
 *   L2 单端口方法数 <= 5（METHODS 数组长度）
 *   L3 域模块不得 require('node:fs' / 'node:child_process')
 *   L4 域模块不得读 process.env
 *   L5 域模块不得 require 适配器
 *   L6 组合根 <= 120 行
 *   L7 mars/src 内无循环依赖
 *
 * 债务白名单：B0 时点已存在的违规登记在 ALLOW 里，并标注清除批次。
 *   - 新增违规 => FAIL
 *   - 白名单条目已不再违规 => 报告 STALE（提示清理，不影响退出码）
 * 这样债务只可能减少，不可能悄悄增加。
 *
 * 用法: node tooling/layering-check.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'mars', 'src');
const PORTS = path.join(SRC, 'ports');
const ADAPTERS = path.join(SRC, 'adapters');
const COMPOSITION = path.join(SRC, 'composition.js');

const COMPOSITION_MAX_LINES = 120;
const PORT_MAX_METHODS = 5;

// 债务白名单：file -> { rule, until, why }
// 这些是 B0 时点真实存在的耦合，按批次清除；不允许新增条目。
const ALLOW = [
  { rule: 'L3-fs', file: 'mars/src/util.js', until: 'permanent', why: 'guardSourceRef 用 realpathSync 做符号链接逃逸检测、writeJsonAtomic 做原子写：这是安全与持久化的最底层，刻意不抽象' },
  { rule: 'L3-fs', file: 'mars/src/cli.js', until: 'permanent', why: '入口负责把 --out 产物写到用户指定目录；输出 I/O 属于边界，不属于域逻辑' }
];

const FS_RE = /\brequire\(\s*['"](node:fs|node:fs\/promises|fs|node:child_process|child_process)['"]\s*\)/;
const ADAPTER_RE = /\brequire\(\s*['"][^'"]*adapters\/[^'"]*['"]\s*\)/;
const ENV_RE = /\bprocess\.env\b/;
const REQUIRE_RE = /\brequire\s*\(/;

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  const acc = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) acc.push(...listJs(p));
    else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * 把注释替换成等长空格（保持偏移与行号不变），避免「说明性文字里提到 process.env」
 * 被误判成真实违规。简易状态机，只处理 // 与 /* *\/，并跳过字符串内的同类字符。
 */
function maskComments(text) {
  const out = text.split('');
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < text.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isAllowed(rule, file) {
  return ALLOW.some((a) => a.rule === rule && a.file === file);
}

/** 收集 mars/src 下的 require 关系（仅本地相对模块），用于环检测。 */
function buildGraph(files) {
  const graph = new Map();
  for (const f of files) {
    const code = maskComments(read(f));
    const deps = [];
    const re = /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      let target = path.resolve(path.dirname(f), m[1]);
      if (!target.endsWith('.js')) target += '.js';
      if (fs.existsSync(target)) deps.push(target);
    }
    graph.set(f, deps);
  }
  return graph;
}

function findCycles(graph) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map();
  for (const k of graph.keys()) color.set(k, WHITE);
  const stack = [];
  const cycles = [];

  function dfs(node) {
    color.set(node, GREY);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      const c = color.get(dep);
      if (c === GREY) {
        const at = stack.indexOf(dep);
        cycles.push(stack.slice(at).concat(dep).map(rel));
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) if (color.get(node) === WHITE) dfs(node);
  return cycles;
}

export function collect() {
  const problems = [];
  const warnings = [];
  const notes = [];
  const stale = [];

  // ---- 端口 ----
  const portFiles = listJs(PORTS);
  for (const f of portFiles) {
    const text = read(f);
    const code = maskComments(text);
    const r = rel(f);
    if (REQUIRE_RE.test(code)) {
      problems.push({ rule: 'L1', file: r, detail: '端口模块必须零 require（不依赖 node:* 与其他端口）' });
    }
    const m = /const METHODS\s*=\s*\[([^\]]*)\]/.exec(code);
    if (m) {
      const count = (m[1].match(/['"][^'"]+['"]/g) || []).length;
      if (count > PORT_MAX_METHODS) {
        problems.push({ rule: 'L2', file: r, detail: `方法数 ${count} 超过上限 ${PORT_MAX_METHODS}` });
      }
    } else {
      warnings.push({ rule: 'L2', file: r, detail: '未找到 METHODS 常量，无法检查方法数上限' });
    }
  }
  notes.push(`端口文件 ${portFiles.length} 个`);

  // ---- 域 ----
  const domainFiles = listJs(SRC).filter((f) => {
    const r = rel(f);
    return !r.startsWith('mars/src/ports/') &&
      !r.startsWith('mars/src/adapters/') &&
      r !== 'mars/src/composition.js';
  });

  for (const f of domainFiles) {
    const text = read(f);
    const code = maskComments(text);
    const r = rel(f);
    const checks = [
      { rule: 'L3-fs', re: FS_RE, label: '域模块不得直接 require 文件系统/子进程' },
      { rule: 'L4-env', re: ENV_RE, label: '域模块不得读取 process.env' },
      { rule: 'L5-adapters', re: ADAPTER_RE, label: '域模块不得 require 适配器' }
    ];
    for (const c of checks) {
      const m = c.re.exec(code);
      if (!m) continue;
      if (isAllowed(c.rule, r)) {
        stale.push({ rule: c.rule, file: r, line: lineOf(text, m.index) });
        const entry = ALLOW.find((a) => a.rule === c.rule && a.file === r) || {};
        const note = entry.until === 'permanent'
          ? '已声明为边界代码（永久允许）'
          : `已登记债务，计划 ${entry.until} 清除`;
        warnings.push({ rule: c.rule, file: r, detail: `${c.label}（${note}）` });
      } else {
        problems.push({ rule: c.rule, file: r, detail: `${c.label}（第 ${lineOf(text, m.index)} 行）` });
      }
    }
  }
  notes.push(`域文件 ${domainFiles.length} 个`);

  // ---- 组合根 ----
  if (fs.existsSync(COMPOSITION)) {
    const lines = read(COMPOSITION).split('\n').length;
    if (lines > COMPOSITION_MAX_LINES) {
      problems.push({ rule: 'L6', file: rel(COMPOSITION), detail: `行数 ${lines} 超过上限 ${COMPOSITION_MAX_LINES}` });
    }
    notes.push(`组合根 ${lines} 行 / 上限 ${COMPOSITION_MAX_LINES}`);
  } else {
    notes.push('组合根尚未建立（B1 之前属预期）');
  }

  // ---- 环 ----
  const graph = buildGraph(listJs(SRC));
  const cycles = findCycles(graph);
  for (const c of cycles) {
    problems.push({ rule: 'L7', file: c[0], detail: '循环依赖: ' + c.join(' -> ') });
  }

  // 白名单中已不再违规的条目（提示清理）
  const allAllowRules = new Set(ALLOW.map((a) => `${a.rule}|${a.file}`));
  const observed = new Set(stale.map((s) => `${s.rule}|${s.file}`));
  for (const key of allAllowRules) {
    if (!observed.has(key)) {
      const [rule, file] = key.split('|');
      warnings.push({ rule: 'STALE', file, detail: `白名单条目已不再违规（${rule}），应删除该条目` });
    }
  }

  return { problems, warnings, notes, cycles, ports: portFiles.map(rel), domain: domainFiles.map(rel) };
}

function main(argv) {
  const json = argv.includes('--json');
  const result = collect();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('RDS layering check');
    for (const n of result.notes) console.log('  · ' + n);
    for (const w of result.warnings) console.log(`  WARN  ${w.rule}  ${w.file}  ${w.detail}`);
    for (const p of result.problems) console.log(`  FAIL  ${p.rule}  ${p.file}  ${p.detail}`);
  }

  if (result.problems.length > 0) {
    console.log(`LAYERS FAIL  problems=${result.problems.length} warnings=${result.warnings.length}`);
    return 1;
  }
  console.log(`LAYERS PASS  problems=0 warnings=${result.warnings.length}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { ALLOW, COMPOSITION_MAX_LINES, PORT_MAX_METHODS };
