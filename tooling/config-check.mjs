#!/usr/bin/env node
/**
 * 配置校验（CI 步骤之一）。
 *
 * 能力边界要说清楚：
 *   - JSON：严格解析，一条不合格就失败；
 *   - YAML：只做结构性 lint（制表符 / BOM / 末尾换行），不做语义解析。
 *     本仓库零第三方依赖，不引 YAML 解析器；工作流语义由 GitHub Actions 自身校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'var', 'dist', 'coverage']);

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), acc);
    } else {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

function main() {
  const files = walk(ROOT, []);
  const problems = [];
  let jsonCount = 0;
  let yamlCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();
    const raw = fs.readFileSync(file);
    const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;

    if (ext === '.json') {
      jsonCount += 1;
      // JSON 带 BOM 会让严格解析器直接失败，必须拦下
      if (hasBom) problems.push(`${rel}: JSON 含 UTF-8 BOM`);
      try {
        JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        problems.push(`${rel}: JSON 解析失败 — ${err.message}`);
      }
      continue;
    }

    if (ext === '.yml' || ext === '.yaml') {
      yamlCount += 1;
      if (hasBom) problems.push(`${rel}: YAML 含 UTF-8 BOM`);
      const text = raw.toString('utf8');
      if (text.includes('\t')) problems.push(`${rel}: YAML 含制表符缩进`);
      if (!text.endsWith('\n')) problems.push(`${rel}: 文件末尾缺少换行`);
    }
  }

  console.log(`CONFIG CHECK  json=${jsonCount} yaml=${yamlCount}`);
  if (problems.length > 0) {
    console.error('CONFIG FAIL');
    for (const p of problems) console.error('  - ' + p);
    return 1;
  }
  console.log('CONFIG PASS');
  return 0;
}

process.exit(main());
