'use strict';
// M8 / B1：身份文件不得被普通初始化静默覆盖。
//
// 这组测试守的是数据安全，不是命令语法：
//   - 已有身份时，重复 init-dev 必须失败，且文件逐字节不变；
//   - --add 追加后，原有 token 仍然有效；
//   - --replace 显式重建后，原有 token 才失效；
//   - 坏文件不会被静默吞掉。

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(REPO, 'bin', 'rds.mjs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-ident-'));
  const principals = path.join(dir, 'principals.json');
  const env = { ...process.env, MARS_DB: path.join(dir, 'mars.db'), MARS_PRINCIPALS: principals };
  delete env.MARS_TOKEN;
  const run = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...env, ...extra },
  });
  return { dir, principals, env, run };
}

function createIdentity(box, args = []) {
  const r = box.run(['init-dev', ...args]);
  assert.equal(r.status, 0, r.stderr);
  const token = (r.stdout.match(/^DEV_TOKEN=([0-9a-f]{48})$/m) || [])[1];
  assert.ok(token, 'init-dev 必须打印一次 DEV_TOKEN');
  return token;
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function principals(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).principals;
}

test('B1 首次初始化：正常创建，token 可用', () => {
  const box = sandbox();
  box.run(['init']);
  const token = createIdentity(box);
  assert.equal(principals(box.principals).length, 1);
  const list = box.run(['list', '--project', 'demo'], { MARS_TOKEN: token });
  assert.equal(list.status, 0, list.stderr);
});

test('B1 重复初始化：默认拒绝，文件逐字节不变，旧 token 仍有效', () => {
  const box = sandbox();
  box.run(['init']);
  const token = createIdentity(box, ['--principal', 'dev-r0', '--projects', 'demo', '--roles', 'R0']);
  const before = fileHash(box.principals);

  const again = box.run(['init-dev', '--principal', 'dev-r0', '--projects', 'demo', '--roles', 'R0']);
  assert.equal(again.status, 1, '已有身份时必须拒绝');
  assert.match(again.stderr, /IDENTITY_EXISTS/);
  assert.equal(fileHash(box.principals), before, '拒绝时不得改动文件');
  assert.equal(principals(box.principals).length, 1);

  const list = box.run(['list', '--project', 'demo'], { MARS_TOKEN: token });
  assert.equal(list.status, 0, '旧 token 必须仍然有效');
});

test('B1 --add：追加身份，两个 token 同时有效', () => {
  const box = sandbox();
  box.run(['init']);
  const r0 = createIdentity(box, ['--principal', 'dev-r0', '--projects', 'demo', '--roles', 'R0']);
  const r4 = createIdentity(box, ['--principal', 'dev-r4', '--projects', 'demo', '--roles', 'R4', '--add']);

  const list = principals(box.principals);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((x) => x.principal_id).sort(), ['dev-r0', 'dev-r4']);
  assert.equal(box.run(['list', '--project', 'demo'], { MARS_TOKEN: r0 }).status, 0);
  assert.equal(box.run(['list', '--project', 'demo'], { MARS_TOKEN: r4 }).status, 0);
});

test('B1 --add 重复 principal_id：拒绝且不改文件', () => {
  const box = sandbox();
  box.run(['init']);
  createIdentity(box, ['--principal', 'dev-r0']);
  const before = fileHash(box.principals);
  const dup = box.run(['init-dev', '--principal', 'dev-r0', '--add']);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /IDENTITY_EXISTS/);
  assert.equal(fileHash(box.principals), before);
});

test('B1 --replace：显式重建后旧 token 失效、新 token 有效', () => {
  const box = sandbox();
  box.run(['init']);
  const oldToken = createIdentity(box, ['--principal', 'dev-r0']);
  const newToken = createIdentity(box, ['--principal', 'dev-r0', '--replace']);

  assert.equal(principals(box.principals).length, 1);
  const oldUse = box.run(['list', '--project', 'demo'], { MARS_TOKEN: oldToken });
  assert.equal(oldUse.status, 3, '重建后旧 token 必须被拒绝');
  const newUse = box.run(['list', '--project', 'demo'], { MARS_TOKEN: newToken });
  assert.equal(newUse.status, 0);
});

test('B1 坏文件：默认拒绝覆盖，--replace 才重建', () => {
  const box = sandbox();
  fs.writeFileSync(box.principals, '{ not json');
  const before = fileHash(box.principals);

  const refused = box.run(['init-dev', '--principal', 'dev-r0']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /IDENTITY_EXISTS/);
  assert.equal(fileHash(box.principals), before, '坏文件也不能被静默覆盖');

  const replaced = box.run(['init-dev', '--principal', 'dev-r0', '--replace']);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(principals(box.principals).length, 1);
});

test('B1 空 principals 文件：允许直接初始化', () => {
  const box = sandbox();
  fs.writeFileSync(box.principals, JSON.stringify({ version: '0.1.0', principals: [] }));
  const r = box.run(['init-dev', '--principal', 'dev-r0']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(principals(box.principals).length, 1);
});
