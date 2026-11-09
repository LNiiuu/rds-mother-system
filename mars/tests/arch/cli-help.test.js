'use strict';
// CLI 帮助覆盖（M5 / B3）。
//
// 这组用例守的是三件事，每一件都对应一个真实发生过的缺陷：
//   1. 覆盖：每个已知命令都必须有详细帮助，新增子命令时不许漏
//   2. 无副作用：--help 不能建库、不能生成身份、不能覆盖已有身份文件
//   3. 一致性：rds help <cmd> 与 rds <cmd> --help 必须是同一份文本
//
// 修复前的实测行为（作为回归基线）：
//   rds init --help       → 创建数据库并输出 stats
//   rds init-dev --help   → 生成 dev-r0/demo 并**整个覆盖** principals.json
//   rds put --help        → ERROR 认证失败：TOKEN_MISSING（exit 3）
//   rds mcp --help        → ERROR MCP 网关默认禁用（exit 5）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(REPO, 'bin', 'rds.mjs');
const CLI = path.join(REPO, 'mars', 'src', 'cli.js');
const HELP = require(path.join(REPO, 'mars', 'src', 'cli-help.js'));
const { KNOWN_COMMANDS } = require(CLI);

// 全量命令集 = cli.js 实现的 + bin/rds.mjs 直接实现的。
const ALL_COMMANDS = [...KNOWN_COMMANDS, ...HELP.BUILTINS];

/** 干净环境：不继承任何外部路径或凭据。 */
function cleanEnv(extra = {}) {
  const env = Object.assign({}, process.env);
  for (const k of ['MARS_TOKEN', 'MARS_DB', 'MARS_PRINCIPALS', 'MARS_ROUTING', 'RDS_HOME']) delete env[k];
  return Object.assign(env, extra);
}

function runBin(args, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: cleanEnv(extraEnv),
    timeout: 60000
  });
}

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-help-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- 1. 覆盖 ----------

test('B3 覆盖：每个已知命令都有帮助条目', () => {
  const missing = ALL_COMMANDS.filter((c) => !HELP.TOPICS[c]);
  assert.deepEqual(missing, [], '以下命令没有帮助条目：' + missing.join(', '));
});

test('B3 覆盖：每个帮助条目都对应一个已知命令', () => {
  const extra = HELP.TOPIC_NAMES.filter((c) => !ALL_COMMANDS.includes(c));
  assert.deepEqual(extra, [], '以下帮助条目没有对应的命令：' + extra.join(', '));
});

test('B3 覆盖：每个命令的 --help 退出码 0 且输出用法', () => {
  withDir((dir) => {
    const env = { MARS_DB: path.join(dir, 'mars.db'), MARS_PRINCIPALS: path.join(dir, 'principals.json') };
    const bad = [];
    for (const cmd of ALL_COMMANDS) {
      const r = runBin([cmd, '--help'], env);
      if (r.status !== 0) bad.push(`${cmd}: exit=${r.status} ${r.stderr.trim().split('\n')[0] || ''}`);
      else if (!/^用法: rds /.test(r.stdout)) bad.push(`${cmd}: 输出不以「用法: rds」开头`);
    }
    assert.deepEqual(bad, [], '以下命令的 --help 不合格：\n' + bad.join('\n'));
  });
});

test('B3 覆盖：-h 与 --help 等价', () => {
  withDir((dir) => {
    const env = { MARS_DB: path.join(dir, 'mars.db'), MARS_PRINCIPALS: path.join(dir, 'principals.json') };
    const long = runBin(['put', '--help'], env);
    const short = runBin(['put', '-h'], env);
    assert.equal(short.status, 0);
    assert.equal(short.stdout, long.stdout);
  });
});

// ---------- 2. 无副作用 ----------

test('B3 无副作用：init --help 不创建数据库', () => {
  withDir((dir) => {
    const db = path.join(dir, 'mars.db');
    const r = runBin(['init', '--help'], { MARS_DB: db, MARS_PRINCIPALS: path.join(dir, 'p.json') });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(db), false, '--help 不应创建数据库');
  });
});

test('B3 无副作用：init-dev --help 不创建也不覆盖身份文件', () => {
  withDir((dir) => {
    const p = path.join(dir, 'principals.json');
    const original = JSON.stringify({ version: '0.1.0', principals: [{ principal_id: 'keep-me', roles: ['R0'] }] }, null, 2);
    fs.writeFileSync(p, original);

    const r = runBin(['init-dev', '--help'], { MARS_DB: path.join(dir, 'mars.db'), MARS_PRINCIPALS: p });
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(p, 'utf8'), original, '--help 不应改写已有身份文件');
  });
});

test('B3 无副作用：身份文件缺失时 --help 也不报认证错误', () => {
  withDir((dir) => {
    const env = { MARS_DB: path.join(dir, 'nope.db'), MARS_PRINCIPALS: path.join(dir, 'nope.json') };
    for (const cmd of ['put', 'list', 'search', 'review', 'compile', 'stats', 'audit', 'project', 'share', 'orchestrate']) {
      const r = runBin([cmd, '--help'], env);
      assert.equal(r.status, 0, `${cmd} --help 应退出 0，实际 ${r.status}：${r.stderr.trim()}`);
      assert.equal(/TOKEN_MISSING|认证失败/.test(r.stderr), false, `${cmd} --help 不应报认证失败`);
    }
  });
});

test('B3 无副作用：mcp --help 不返回「网关默认禁用」', () => {
  const r = runBin(['mcp', '--help']);
  assert.equal(r.status, 0);
  assert.equal(/网关默认禁用/.test(r.stderr), false);
});

// ---------- 3. 一致性 ----------

test('B3 一致性：rds help <cmd> 与 rds <cmd> --help 输出相同', () => {
  withDir((dir) => {
    const env = { MARS_DB: path.join(dir, 'mars.db'), MARS_PRINCIPALS: path.join(dir, 'p.json') };
    const bad = [];
    for (const cmd of ALL_COMMANDS) {
      const a = runBin(['help', cmd], env);
      const b = runBin([cmd, '--help'], env);
      if (a.stdout !== b.stdout) bad.push(cmd);
    }
    assert.deepEqual(bad, [], '以下命令两种入口输出不一致：' + bad.join(', '));
  });
});

test('B3 一致性：顶层帮助列出了全部命令与公共选项', () => {
  const r = runBin(['--help']);
  assert.equal(r.status, 0);
  for (const cmd of ALL_COMMANDS) {
    if (cmd === 'help') continue;
    assert.equal(r.stdout.includes(cmd), true, '顶层帮助缺少命令：' + cmd);
  }
  for (const opt of ['--token', '--principals', '--db', '--routing', '--root', '--debug']) {
    assert.equal(r.stdout.includes(opt), true, '顶层帮助缺少公共选项：' + opt);
  }
});

test('B3 一致性：未知命令的 --help 报未知命令而不是认证失败', () => {
  const r = runBin(['no-such-cmd', '--help']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /未知命令/);
  assert.equal(/TOKEN_MISSING|认证失败/.test(r.stderr), false);
});

test('B3 一致性：帮助文本不出现本机绝对路径', () => {
  const all = [HELP.USAGE].concat(HELP.TOPIC_NAMES.map((c) => HELP.render(c))).join('\n');
  assert.equal(/[A-Za-z]:\\\\|[A-Za-z]:\\[A-Za-z]|\/home\/|\/Users\//.test(all), false, '帮助文本不应含本机绝对路径');
});
