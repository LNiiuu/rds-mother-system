#!/usr/bin/env node
'use strict';
// MARS 回滚：只删除 mars/var 下的运行时产物（可选 principals / token）。
//
// 与 mars-rollback.ps1 行为对齐，但用 Node 实现，便于在 Windows/Linux/macOS 上
// 被同一套测试验证（旧脚本改为转调本文件，避免两份实现分叉）。
//
// 安全边界：
//   - 每一个待删路径都必须位于 <repo>/mars 之内（解析后前缀校验）；
//   - 默认 dry-run，必须显式 --yes 才删除；
//   - 只删文件，不删目录，不递归。
const fs = require('node:fs');
const path = require('node:path');

const USAGE = `用法: node mars/scripts/mars-rollback.js [--repo <仓库根>] [--remove-principals] [--remove-tokens] [--yes]

默认 dry-run：只列出将被删除的运行时产物，退出码 2。
加 --yes 才真正删除，退出码 0。
`;

function parseArgs(argv) {
  const out = { repo: '', removePrincipals: false, removeTokens: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo') { out.repo = argv[i + 1] || ''; i += 1; }
    else if (a === '--remove-principals') out.removePrincipals = true;
    else if (a === '--remove-tokens') out.removeTokens = true;
    else if (a === '--yes') out.yes = true;
    else if (a === '--dry-run') out.yes = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('未知参数: ' + a);
  }
  return out;
}

/** var/ 下的运行时产物：数据库（含 -wal/-shm/备份）、JSON、CSV。 */
function isRuntimeArtifact(name) {
  return /^mars\.db([-.]|$)/.test(name) || /\.json$/.test(name) || /\.csv$/.test(name);
}

function collectTargets({ repo, removePrincipals, removeTokens }) {
  const marsDir = path.resolve(repo, 'mars');
  if (!fs.existsSync(marsDir)) throw new Error('MARS 目录不存在: ' + marsDir);

  const targets = [];
  const varDir = path.join(marsDir, 'var');
  if (fs.existsSync(varDir)) {
    for (const entry of fs.readdirSync(varDir, { withFileTypes: true })) {
      if (entry.isFile() && isRuntimeArtifact(entry.name)) targets.push(path.join(varDir, entry.name));
    }
    if (removeTokens) {
      const tokenDir = path.join(varDir, 'mcp', 'tokens');
      if (fs.existsSync(tokenDir)) {
        for (const entry of fs.readdirSync(tokenDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.token')) targets.push(path.join(tokenDir, entry.name));
        }
      }
    }
  }
  if (removePrincipals) {
    const principals = path.join(marsDir, 'config', 'principals.json');
    if (fs.existsSync(principals)) targets.push(principals);
  }
  return { marsDir, targets };
}

function assertInside(marsDir, target) {
  const resolved = path.resolve(target);
  const prefix = marsDir.endsWith(path.sep) ? marsDir : marsDir + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error('越界路径，拒绝删除: ' + resolved);
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error('ERROR ' + err.message);
    console.error(USAGE);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const repo = args.repo
    ? path.resolve(args.repo)
    : (process.env.RDS_HOME ? path.resolve(process.env.RDS_HOME) : path.resolve(__dirname, '..', '..'));

  let marsDir;
  let targets;
  try {
    ({ marsDir, targets } = collectTargets({
      repo,
      removePrincipals: args.removePrincipals,
      removeTokens: args.removeTokens
    }));
  } catch (err) {
    console.error('ERROR ' + err.message);
    return 1;
  }

  if (targets.length === 0) {
    console.log('无运行时产物需要删除。');
    return 0;
  }

  console.log('将删除以下 MARS 运行时产物（仅限 mars/var 与可选 principals/token）：');
  for (const t of targets) console.log('  - ' + t);

  if (!args.yes) {
    console.log('未加 --yes，未执行删除。');
    return 2;
  }

  let removed = 0;
  for (const t of targets) {
    try {
      assertInside(marsDir, t);
      fs.unlinkSync(t);
      removed += 1;
    } catch (err) {
      console.error('ERROR ' + err.message);
      return 1;
    }
  }
  console.log('已删除 ' + removed + ' 个文件；源码与文档未改动。');
  return 0;
}

module.exports = { parseArgs, collectTargets, isRuntimeArtifact, main };

if (require.main === module) {
  process.exit(main());
}
