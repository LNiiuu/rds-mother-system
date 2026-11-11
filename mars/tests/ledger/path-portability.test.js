'use strict';
// ledger 输出的 path 语义（M5 / B4）。
//
// 这组用例不是「证明现在的做法最好」，而是**把现状固定成可执行契约**。
//
// 背景：ledger 输出的 `sessions[].path` 目前一律是**绝对路径**（来自 CLI 里的
// path.resolve）。它有两个用途：
//   (a) 人看：这条会话来自哪个文件
//   (b) 机器用：据此重新读取原文件
// (b) 要求路径可解析，相对路径依赖 cwd，所以选了绝对路径。
//
// 代价：产物含机器路径，跨平台格式不同（Windows 反斜杠 / POSIX 斜杠），
// 不适合提交到版本库或直接分享。这是已知限制，记在 docs/install.md §11。
//
// 改动 `path` 的语义属于**修改 JSON 输出格式**，必须先给方案并获授权。
// 这组用例的作用就是让任何「顺手改一下」立刻变红。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO, 'mars', 'src', 'cli.js');
const makeSession = require(path.join(REPO, 'mars', 'tests', 'fixtures', 'ledger', 'make-session.js'));

function runCli(args, opts = {}) {
  const env = Object.assign({}, process.env);
  for (const k of ['MARS_TOKEN', 'MARS_PRINCIPALS', 'MARS_ROUTING', 'RDS_HOME']) delete env[k];
  // 指向一个不存在的库：ledger 是只读动作，不应创建数据库
  env.MARS_DB = path.join(opts.cwd || REPO, 'no-such.db');
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env,
    timeout: 60000
  });
}

function withSession(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-ledger-path-'));
  try {
    const made = makeSession.writeSession(dir, { name: 'session.v4.jsonl.zstd', frames: 3 });
    return fn(dir, made.file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('B4 契约：ledger 的 path 是绝对路径，且指向真实文件', () => {
  withSession((dir, file) => {
    const r = runCli(['ledger', '--session', file]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(typeof j.path, 'string');
    assert.equal(path.isAbsolute(j.path), true, 'path 必须是绝对路径（当前契约）');
    assert.equal(fs.existsSync(j.path), true, 'path 必须能解析到真实文件');
    assert.equal(j.path, path.resolve(file));
  });
});

test('B4 契约：传入相对路径时，path 仍被解析为绝对路径', () => {
  withSession((dir) => {
    const rel = './session.v4.jsonl.zstd';
    const r = runCli(['ledger', '--session', rel], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(path.isAbsolute(j.path), true, '相对输入也输出绝对路径');
    // 比的是「指向同一个文件」，不是「字符串相同」。
    // macOS 上 os.tmpdir() 常经 /var → /private/var 的符号链接，子进程的
    // process.cwd() 返回 realpath，字面比较会误报。两边都取真实路径。
    assert.equal(
      fs.realpathSync(j.path),
      fs.realpathSync(path.join(dir, 'session.v4.jsonl.zstd')),
      '相对输入应解析到同一个文件'
    );
  });
});

test('B4 契约：--out 写出的 ledger.json 与 ledger.csv 使用同一个 path', () => {
  withSession((dir, file) => {
    const outDir = path.join(dir, 'out');
    const r = runCli(['ledger', '--session', file, '--out', outDir]);
    assert.equal(r.status, 0, r.stderr);

    const jsonFile = path.join(outDir, 'ledger.json');
    const csvFile = path.join(outDir, 'ledger.csv');
    assert.equal(fs.existsSync(jsonFile), true);
    assert.equal(fs.existsSync(csvFile), true);

    const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const lines = fs.readFileSync(csvFile, 'utf8').trim().split('\n');
    assert.equal(lines.length >= 2, true, 'CSV 至少要有表头与一行数据');

    const header = lines[0].split(',');
    const pathCol = header.indexOf('path');
    assert.notEqual(pathCol, -1, 'CSV 必须有 path 列');

    // path 里可能含逗号（Windows 用户目录不常见但存在），这里只做包含断言，
    // 不做严格分列，避免把 CSV 转义规则混进本用例。
    assert.equal(lines[1].includes(j.path), true, 'CSV 的 path 与 JSON 必须一致');
  });
});

test('B4 契约：ledger 是只读动作，不创建数据库', () => {
  withSession((dir, file) => {
    const db = path.join(dir, 'should-not-exist.db');
    const env = Object.assign({}, process.env, { MARS_DB: db });
    delete env.MARS_TOKEN;
    delete env.MARS_PRINCIPALS;
    delete env.MARS_ROUTING;
    const r = spawnSync(process.execPath, [CLI, 'ledger', '--session', file], {
      encoding: 'utf8',
      env,
      timeout: 60000
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(db), false, 'ledger 不应创建数据库');
  });
});
