#!/usr/bin/env node
/**
 * RDS 统一入口（M1-3）。
 *
 * 本文件只做三件事：
 *   1. Node 版本门禁 —— 低于 22.5 时给出可读错误，而不是 node:sqlite 的模块缺失栈
 *   2. 内建命令 —— version / doctor / validate / test
 *   3. 其余命令原样转交 mars/src/cli.js（子进程）
 *
 * 硬约束：不在此复制 mars/src 的任何业务逻辑。入口与实现各写一遍，三个月后必然分叉。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// M5 / B3：用法文本的唯一真相在 mars/src/cli-help.js。
// 此前这里一份、cli.js 里一份，已经分叉（简版漏了 orchestrate）。
import cliHelp from '../mars/src/cli-help.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'mars', 'src', 'cli.js');
const MIN_NODE = [22, 5, 0];
const USAGE = cliHelp.USAGE;

function fail(message, code = 2) {
  console.error('ERROR ' + message);
  process.exit(code);
}

/** 读取版本：以 VERSION 为唯一真相源，缺失时回退 package.json。 */
function readVersion() {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    } catch {
      return '0.0.0-unknown';
    }
  }
}

function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- 1. Node 版本门禁（必须先于任何 require('node:sqlite')） ----------
const current = process.versions.node.split('.').map((n) => parseInt(n, 10));
if (cmpVersion(current, MIN_NODE) < 0) {
  console.error(
    `ERROR Node.js 版本过低：当前 v${process.versions.node}，RDS 需要 >= ${MIN_NODE.join('.')}。`
  );
  console.error('原因：数据库层依赖内置模块 node:sqlite，该模块自 Node 22.5 起提供。');
  console.error('处理：用 nvm / fnm 切到 Node 22.5+ 或 24.x 后重试；本命令不修改你的环境。');
  process.exit(78); // EX_CONFIG
}

const argv = process.argv.slice(2);
const cmd = argv[0];

// ---------- 2. 内建命令 ----------
if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

// rds help            -> 顶层用法（在此处理，避免多起一个进程）
// rds help <命令>     -> 转交 cli.js 打印该命令的详细说明（文本在 cli-help.js）
if (cmd === 'help' && argv.length === 1) {
  console.log(USAGE);
  process.exit(0);
}

// M5 / B3：内建命令也要认 --help / -h。
// 此前 `rds version --help` 直接打印版本号、`rds doctor --help` 真的去跑体检，
// 用户想要说明却触发了动作。
const WANTS_HELP = argv.includes('--help') || argv.includes('-h');

if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  if (WANTS_HELP) {
    console.log(cliHelp.render('version'));
    process.exit(0);
  }
  console.log(readVersion());
  process.exit(0);
}

if ((cmd === 'doctor' || cmd === 'validate' || cmd === 'test') && WANTS_HELP) {
  console.log(cliHelp.render(cmd));
  process.exit(0);
}

if (cmd === 'doctor' || cmd === 'validate') {
  const mod = await import('./' + cmd + '.mjs');
  process.exit(await mod.main(argv.slice(1)));
}

if (cmd === 'test') {
  const testsDir = path.join(ROOT, 'mars', 'tests');
  if (!fs.existsSync(testsDir)) {
    fail(
      '当前安装不含测试（发布包通过 package.json.files 白名单剔除了 tests）。请在源码仓库中运行。',
      2
    );
  }
  // 默认走 Required 门禁（fail=0 且 skipped=0）；--raw 直接看 node --test 原始输出。
  const gate = path.join(ROOT, 'tooling', 'test-gate.mjs');
  const raw = argv.includes('--raw');
  const childArgs = raw || !fs.existsSync(gate)
    ? ['--test', path.join(testsDir, '**', '*.test.js')]
    : [gate];
  const child = spawn(process.execPath, childArgs, { cwd: ROOT, stdio: 'inherit', shell: false });
  child.on('exit', (code) => process.exit(code === null ? 1 : code));
} else {
  // ---------- 3. 其余命令转交既有 CLI（子进程，零逻辑复制） ----------
  if (!fs.existsSync(CLI)) {
    fail('未找到 mars/src/cli.js，安装可能不完整：' + CLI, 2);
  }
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', CLI, ...argv],
    { stdio: 'inherit' }
  );
  child.on('error', (err) => fail('无法启动 CLI：' + err.message, 1));
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code === null ? 0 : code);
  });
}
