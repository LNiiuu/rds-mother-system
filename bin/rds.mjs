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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'mars', 'src', 'cli.js');
const MIN_NODE = [22, 5, 0];

const USAGE = `RDS —— 研发流程资产 + 本地记忆引擎（MARS）

用法: rds <命令> [选项]

内建命令
  version                 打印 VERSION
  doctor [--json]         环境诊断（Node / node:sqlite+FTS5 / Git / 目录可写 / 版本一致性 / 路径卫生）
  validate [--file <p>]   校验 project.yaml（默认取当前目录）
  test                    运行 mars/tests（仅源码仓库可用）

MARS 记忆引擎（转交 mars/src/cli.js）
  init                    初始化数据库
  init-dev                生成开发身份（token 只显示一次）
  put | get | list        写入 / 读取 / 列出记忆
  search                  检索（只返回 approved）
  review                  审批（需 R4 类角色，不能自审）
  compile                 编译上下文包
  fragment | alias | stats | audit | ledger | mcp | project | share

示例
  rds init --db ./mars-data/mars.db
  rds doctor
  rds search --token $env:MARS_TOKEN --project demo --query "SQLite"

文档: docs/install.md
`;

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
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  console.log(readVersion());
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
