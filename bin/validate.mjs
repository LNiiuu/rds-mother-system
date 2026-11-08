#!/usr/bin/env node
/**
 * rds validate —— project.yaml 顶层契约校验（M1-10）。
 *
 * 范围声明：只校验顶层 `key: value` 契约（必填项、枚举、未知键、占位符残留）。
 * 本仓库零第三方依赖，因此不引入 YAML 解析器；嵌套结构不做语义校验，只做结构存在性检查。
 * 这条边界必须保留在文档里，不能宣称「完整 YAML 校验」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const ALLOWED = [
  'schema',
  'name',
  'root',
  'language',
  'stack',
  'repo',
  'paths',
  'toolchain',
  'agents',
  'workflows',
  'boundaries',
  'evidence',
];
const REQUIRED = ['schema', 'name', 'root', 'stack'];

/** 去掉行内注释：只在引号外、且前面有空白的 `#` 处截断。 */
function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseTopLevel(text) {
  const out = new Map();
  const dup = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent !== 0) continue;
    const m = /^([A-Za-z_][\w.-]*)\s*:(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    if (out.has(key)) dup.push(key);
    out.set(key, { value: unquote(stripComment(m[2])), line: i + 1 });
  }
  return { map: out, dup };
}

const isAbsolute = (p) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p);

export function validateFile(file) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  if (!fs.existsSync(file)) {
    add('file', 'fail', `不存在：${file}`);
    return { file, checks, status: 'fail' };
  }

  const text = fs.readFileSync(file, 'utf8');
  const { map, dup } = parseTopLevel(text);

  for (const k of dup) add('duplicate', 'fail', `顶层键重复：${k}`);

  for (const k of REQUIRED) {
    if (!map.has(k)) add(k, 'fail', '缺失（必填）');
  }

  const unknown = [...map.keys()].filter((k) => !ALLOWED.includes(k));
  if (unknown.length) {
    add('unknown', 'fail', `未知顶层键：${unknown.join('，')}（允许：${ALLOWED.join('、')}）`);
  } else {
    add('unknown', 'ok', '无未知顶层键');
  }

  const schema = map.get('schema');
  if (schema) {
    add(
      'schema',
      schema.value === 'rds/project/v1' ? 'ok' : 'fail',
      schema.value === 'rds/project/v1' ? 'rds/project/v1' : `期望 rds/project/v1，实际 ${schema.value || '(空)'}`
    );
  }

  const name = map.get('name');
  if (name) {
    add('name', name.value ? 'ok' : 'fail', name.value || '不能为空');
  }

  const root = map.get('root');
  if (root) {
    if (!root.value) {
      add('root', 'fail', '不能为空');
    } else if (root.value.includes('<') || root.value.includes('{{')) {
      add('root', 'fail', `存在未替换的占位符：${root.value}`);
    } else if (!isAbsolute(root.value)) {
      add('root', 'warn', `${root.value}（非绝对路径；结构允许，但渲染提示词时会按原样输出）`);
    } else {
      add('root', 'ok', root.value);
    }
  }

  const stack = map.get('stack');
  if (stack) {
    if (!stack.value) {
      add('stack', 'fail', '不能为空');
    } else {
      const stackFile = path.join(ROOT, 'stacks', stack.value, 'stack.yaml');
      add(
        'stack',
        fs.existsSync(stackFile) ? 'ok' : 'fail',
        fs.existsSync(stackFile)
          ? `${stack.value}（stacks/${stack.value}/stack.yaml）`
          : `${stack.value}：未找到 stacks/${stack.value}/stack.yaml`
      );
    }
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  return { file, checks, status: fails === 0 ? 'ok' : 'fail' };
}

function render(result) {
  const width = Math.max(4, ...result.checks.map((c) => c.id.length));
  const lines = [`project.yaml  ${result.file}`, ''];
  for (const c of result.checks) {
    lines.push(`  ${c.id.padEnd(width)}  ${c.status.padEnd(4)}  ${c.detail}`);
  }
  lines.push('');
  lines.push(`status: ${result.status}`);
  return lines.join('\n');
}

export async function main(args = []) {
  const json = args.includes('--json');
  const i = args.indexOf('--file');
  const file = path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : path.join(process.cwd(), 'project.yaml'));

  const result = validateFile(file);
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(render(result));
  return result.status === 'ok' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
