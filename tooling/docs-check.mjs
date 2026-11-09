#!/usr/bin/env node
/**
 * 文档一致性检查（M5 / B6）。
 *
 * 目的：把「文档里的链接是否点得开」从人工抽查变成可执行断言。
 *
 * 检查项
 *   相对链接：Markdown 的 [文字](目标)，目标文件必须存在
 *
 * 刻意不检查
 *   - http(s) / mailto / 页内锚点：需要网络或渲染上下文，不在本工具范围
 *   - **反引号里的路径**：试过，信噪比太低，放弃。原因有三：
 *       ① 已删除文件的记录（CHANGELOG 里「删除 seed-phase2.js」是历史事实，
 *          不是断链）；
 *       ② 基准不同的路径（`checks/x.md` 在 docs/acceptance/ 里指 docs/checks/，
 *          按仓库根解析必然错）；
 *       ③ 外部项目的文件（历史文档引用 DSH 插件的 README）。
 *     反引号是「代码样式」，不是「可点击目标」——只有链接才有明确的解析基准。
 *   - 纯文件名（不含 / 的 `foo.js`）：可能只是举例，误报率高
 *   - 占位符（含 < > * ? 或以 $ 开头）
 *
 * 代码块与行内代码里的「链接」不算链接 —— 文档里讲 Markdown 语法时会写出
 * 方括号加圆括号的样子，那不是要用户点开的。
 *
 * 用法:
 *   node tooling/docs-check.mjs                人类可读输出，有问题退出 1
 *   node tooling/docs-check.mjs --json         机器可读
 *   node tooling/docs-check.mjs --root <dir>   指定仓库根（测试用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 测试需要指向临时目录，因此根可覆盖；默认是脚本所在仓库。
let ROOT = DEFAULT_ROOT;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'var', 'dist', 'coverage', '.workbuddy']);

function listMarkdown(dir, acc) {
  acc = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      listMarkdown(path.join(dir, e.name), acc);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

/**
 * 把围栏代码块与行内代码替换成等长空格，保持行号与列偏移不变。
 * 只处理 ``` 与 `，不处理 ~~~（仓库里没有用到）。
 */
function maskCode(text) {
  const out = text.split('');
  let i = 0;
  let inFence = false;
  while (i < text.length) {
    if (text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') {
      // 围栏开始或结束：整行置空到换行为止，然后继续
      inFence = !inFence;
      while (i < text.length && text[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (inFence) {
      if (text[i] !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    if (text[i] === '`') {
      // 行内代码：跳到配对的 `，中间置空
      let j = i + 1;
      while (j < text.length && text[j] !== '`' && text[j] !== '\n') j += 1;
      if (j < text.length && text[j] === '`') {
        for (let k = i; k <= j; k += 1) if (out[k] !== '\n') out[k] = ' ';
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return out.join('');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** 看起来像占位符或示例，不当作真实引用。 */
function isPlaceholder(target) {
  if (/[<>*?]/.test(target)) return true;
  if (/^\.\.\.$/.test(target)) return true;
  if (target.startsWith('$')) return true;
  return false;
}

function checkFile(full) {
  const rel = path.relative(ROOT, full).replace(/\\/g, '/');
  const raw = fs.readFileSync(full, 'utf8');
  const masked = maskCode(raw);
  const problems = [];

  // 1) 相对链接
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = linkRe.exec(masked)) !== null) {
    const target = m[2];
    if (/^(https?:|mailto:|#|\/\/)/.test(target)) continue;
    if (isPlaceholder(target)) continue;
    const clean = decodeURIComponent(target.split('#')[0]);
    if (!clean) continue;
    const abs = path.resolve(path.dirname(full), clean);
    if (!fs.existsSync(abs)) {
      problems.push({ kind: 'link', line: lineOf(masked, m.index), target });
    }
  }

  return { file: rel, problems };
}

function main(argv) {
  const json = argv.includes('--json');
  const rootAt = argv.indexOf('--root');
  if (rootAt !== -1 && argv[rootAt + 1]) ROOT = path.resolve(argv[rootAt + 1]);
  const files = listMarkdown(ROOT, []);
  const results = files.map(checkFile).filter((r) => r.problems.length > 0);

  if (json) {
    console.log(JSON.stringify({ scanned: files.length, files: results }, null, 2));
    return results.length > 0 ? 1 : 0;
  }

  console.log(`RDS docs check  扫描 ${files.length} 个 Markdown`);
  if (results.length === 0) {
    console.log('DOCS PASS  相对链接全部可达');
    return 0;
  }
  let total = 0;
  for (const r of results) {
    for (const p of r.problems) {
      total += 1;
      const kind = p.kind === 'link' ? '链接' : '引用';
      console.log(`  BROKEN ${kind}  ${r.file}:${p.line}  ->  ${p.target}`);
    }
  }
  console.log(`DOCS FAIL  ${total} 处不可达（${results.length} 个文件）`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
