#!/usr/bin/env node
/**
 * Required 测试门禁（M2）。
 *
 * 判据只有一条：`tests > 0 && fail === 0 && skipped === 0 && pass === tests`。
 *
 * 为什么不用 `node --test` 的退出码就够了：
 *   - 缺 fixture 时 `t.skip()` 会让退出码保持 0，绿灯是假的；
 *   - 一个用例都没匹配到同样返回 0；
 *   - 子进程吞掉失败时，外层也可能看起来正常。
 * 本文件把「跑了几条、跳过几条」变成硬判定，并在失败时打印原始 TAP。
 *
 * 用法:
 *   node tooling/test-gate.mjs [--cwd <dir>] [--glob <pattern>] [--quiet]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = { cwd: DEFAULT_ROOT, glob: 'mars/tests/**/*.test.js', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--cwd') { out.cwd = path.resolve(argv[i + 1] || ''); i += 1; }
    else if (a === '--glob') { out.glob = argv[i + 1] || ''; i += 1; }
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') { out.help = true; }
    else throw new Error('未知参数: ' + a);
  }
  return out;
}

/** 从 TAP 摘要里取计数。兼容 `# tests 12` 与 `ℹ tests 12` 两种写法。 */
export function parseSummary(text) {
  const pick = (key) => {
    const m = text.match(new RegExp('(?:^|\\n)\\s*(?:#|\\u2139)\\s*' + key + '\\s+(\\d+)\\s*$', 'm'));
    return m ? Number(m[1]) : null;
  };
  return {
    tests: pick('tests'),
    pass: pick('pass'),
    fail: pick('fail'),
    skipped: pick('skipped'),
    todo: pick('todo'),
    cancelled: pick('cancelled')
  };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error('ERROR ' + err.message);
    return 2;
  }
  if (args.help) {
    console.log('用法: node tooling/test-gate.mjs [--cwd <dir>] [--glob <pattern>] [--quiet]');
    return 0;
  }

  if (!fs.existsSync(args.cwd)) {
    console.error('ERROR 目录不存在: ' + args.cwd);
    return 2;
  }

  const run = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', args.glob],
    { cwd: args.cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 }
  );

  const output = (run.stdout || '') + (run.stderr || '');
  const summary = parseSummary(output);
  const reasons = [];

  if (summary.tests === null || summary.tests === 0) reasons.push('没有匹配到任何测试（tests=0），不允许当作通过');
  if (summary.fail === null) reasons.push('输出里没有 fail 计数，无法判定');
  else if (summary.fail > 0) reasons.push('存在失败用例：fail=' + summary.fail);
  if (summary.skipped === null) reasons.push('输出里没有 skipped 计数，无法判定');
  else if (summary.skipped > 0) reasons.push('存在被跳过的用例：skipped=' + summary.skipped + '（必需测试不允许 skip）');
  if (summary.cancelled) reasons.push('存在被取消的用例：cancelled=' + summary.cancelled);
  if (summary.tests !== null && summary.pass !== null && summary.skipped !== null && summary.fail !== null) {
    const accounted = summary.pass + summary.fail + summary.skipped + (summary.todo || 0) + (summary.cancelled || 0);
    if (accounted !== summary.tests) reasons.push('计数不自洽：tests=' + summary.tests + ' 但 pass+fail+skipped+todo+cancelled=' + accounted);
  }
  if (run.status !== 0 && reasons.length === 0) reasons.push('测试进程退出码非 0（' + run.status + '）');

  const line = `tests=${summary.tests} pass=${summary.pass} fail=${summary.fail} skipped=${summary.skipped}`;

  if (reasons.length > 0) {
    console.error('GATE FAIL  ' + line);
    for (const r of reasons) console.error('  - ' + r);
    const tail = output.split('\n').slice(-80).join('\n');
    console.error('\n--- 原始输出（末 80 行）---\n' + tail);
    return 1;
  }

  if (!args.quiet) console.log('GATE PASS  ' + line);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
