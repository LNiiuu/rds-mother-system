'use strict';
// M3 / B2：身份来源、路径解析与配置快照。
//
// 这一组的理由是：B2 之前路径解析在四个地方各写一遍（cli / mcp-stdio / doctor / store），
// 优先级互不相同，域模块还会自己读 MARS_ROUTING。这里把「只有一处解析」变成可回归断言。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRuntime, resolvePaths } = require('../../src/composition');
const { createCliIdentity } = require('../../src/adapters/cli-identity');
const { createTokenFileIdentity } = require('../../src/adapters/token-file-identity');
const { loadRouting } = require('../../src/authz');
const { ACTIONS } = require('../../src/authz');
const { openDb } = require('../../src/db');

test('B2 CLI 身份来源：--token 优先于 MARS_TOKEN，角色可覆盖', () => {
  const both = createCliIdentity({ argv: { token: 'flag-token', role: 'R4' }, env: { MARS_TOKEN: 'env-token', MARS_ROLE: 'R2' } });
  assert.deepEqual(both.resolve(), { ok: true, token: 'flag-token', role: 'R4', source: 'flag' });
  assert.equal(both.source(), 'flag');

  const envOnly = createCliIdentity({ argv: {}, env: { MARS_TOKEN: 'env-token' } });
  assert.deepEqual(envOnly.resolve(), { ok: true, token: 'env-token', role: null, source: 'env' });

  const none = createCliIdentity({ argv: {}, env: {} });
  assert.equal(none.resolve().code, 'TOKEN_MISSING');
  assert.equal(none.source(), 'none');
});

test('B2 MCP 身份来源：只认 token 文件，缺文件给 TOKEN_MISSING 但保留 role', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-ident-'));
  try {
    const tokenFile = path.join(dir, 'token.txt');
    fs.writeFileSync(tokenFile, 'file-token-0123456789abcdef\n', 'utf8');

    const ok = createTokenFileIdentity({ env: { MARS_TOKEN_FILE: tokenFile, MARS_ROLE: 'R0' } });
    assert.deepEqual(ok.resolve(), { ok: true, token: 'file-token-0123456789abcdef', role: 'R0', source: 'token-file' });

    const missing = createTokenFileIdentity({ env: { MARS_TOKEN_FILE: path.join(dir, 'nope.txt'), MARS_ROLE: 'R0' } });
    const missingResult = missing.resolve();
    assert.equal(missingResult.ok, false);
    assert.equal(missingResult.code, 'TOKEN_MISSING');
    // role 与 token 是两项独立配置：即便没有 token，也要能记录「声称的角色」
    assert.equal(missingResult.role, 'R0');

    const noEnv = createTokenFileIdentity({ env: {} });
    assert.equal(noEnv.resolve().code, 'TOKEN_MISSING');
    assert.equal(noEnv.source(), 'none');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B2 路径解析只有一处：argv > 环境变量 > 安装根默认值', () => {
  const fromArgv = resolvePaths({ argv: { db: '/tmp/a.db', principals: '/tmp/a.json' }, env: { MARS_DB: '/tmp/env.db' } });
  assert.equal(fromArgv.db, path.resolve('/tmp/a.db'));
  assert.equal(fromArgv.principals, path.resolve('/tmp/a.json'));

  const fromEnv = resolvePaths({ argv: {}, env: { MARS_DB: '/tmp/env.db', MARS_PRINCIPALS: '/tmp/env.json' } });
  assert.equal(fromEnv.db, path.resolve('/tmp/env.db'));
  assert.equal(fromEnv.principals, path.resolve('/tmp/env.json'));

  const fromRoot = resolvePaths({ argv: {}, env: { RDS_HOME: '/tmp/rds-home' } });
  assert.equal(fromRoot.root, path.resolve('/tmp/rds-home'));
  assert.equal(fromRoot.db, path.resolve('/tmp/rds-home/mars/var/mars.db'));
  assert.equal(fromRoot.routing, path.resolve('/tmp/rds-home/mars/config/role-routing.json'));
});

test('B2 配置快照：启动时解析并校验，非法配置明确失败', () => {
  const runtime = createRuntime({});
  assert.ok(runtime.routing.roles.R0, '应加载到真实角色表');
  assert.equal(Object.isFrozen(runtime.routing), true, '快照必须是只读的');
  assert.equal(runtime.paths.routing, path.resolve(__dirname, '..', '..', 'config', 'role-routing.json'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-routing-'));
  try {
    const bad = path.join(dir, 'role-routing.json');
    fs.writeFileSync(bad, JSON.stringify({ version: '0.1.0', default: {}, roles: [] }), 'utf8');
    assert.throws(() => createRuntime({ argv: { routing: bad } }), (err) => err.code === 'ROUTING_UNAVAILABLE');

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ oops', 'utf8');
    assert.throws(() => createRuntime({ argv: { routing: broken } }), (err) => err.code === 'ROUTING_UNAVAILABLE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B2 授权动作表不再声明「账本读取」，未知动作仍被拒绝', () => {
  assert.equal(ACTIONS.has('ledger.read'), false);
  assert.equal(ACTIONS.has('memory.get'), true);
  const principal = { principal_id: 'p', project_ids: ['p1'], roles: ['R0'] };
  const { authorize } = require('../../src/authz');
  const routing = loadRouting(path.join(__dirname, '..', '..', 'config', 'role-routing.json'));
  assert.equal(authorize(principal, { project_id: 'p1', role_id: 'R0', action: 'ledger.read', routing }).reason, 'UNKNOWN_ACTION');
});

test('B2 本地未认证的 ledger 调用不伪装成已认证主体', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-ledger-audit-'));
  try {
    const dbPath = path.join(dir, 'mars.db');
    const cli = path.join(__dirname, '..', '..', 'src', 'cli.js');
    const session = path.join(dir, 'session.v4.jsonl');
    fs.writeFileSync(session, JSON.stringify({ type: 'session', id: 's-audit-1' }) + '\n', 'utf8');

    // 先建库：审计只在库已存在时写入（见下一条用例）
    const initRun = spawnSync(process.execPath, [cli, 'init', '--db', dbPath], { encoding: 'utf8', timeout: 60000 });
    assert.equal(initRun.status, 0, initRun.stderr);

    const run = spawnSync(process.execPath, [cli, 'ledger', '--db', dbPath, '--session', session], {
      encoding: 'utf8',
      timeout: 60000
    });
    assert.equal(run.status, 0, run.stderr);

    const db = openDb(dbPath);
    try {
      const row = db.prepare("SELECT principal_id, action FROM audit WHERE action = 'ledger.parse'").get();
      assert.ok(row, '应写入一条 ledger.parse 审计');
      // 关键断言：不是 'cli' 这种会被误读成主体的字面量，而是显式的本地哨兵
      assert.equal(row.principal_id, 'local');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B3 只读的 ledger 调用不会因为写审计而创建数据库', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-ledger-nodb-'));
  try {
    const dbPath = path.join(dir, 'mars.db');
    const cli = path.join(__dirname, '..', '..', 'src', 'cli.js');
    const session = path.join(dir, 'session.v4.jsonl');
    fs.writeFileSync(session, JSON.stringify({ type: 'session', id: 's-nodb-1' }) + '\n', 'utf8');
    assert.equal(fs.existsSync(dbPath), false);

    const run = spawnSync(process.execPath, [cli, 'ledger', '--db', dbPath, '--session', session], {
      encoding: 'utf8',
      timeout: 60000
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(dbPath), false, 'ledger 是只读动作，不应创建数据库');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
