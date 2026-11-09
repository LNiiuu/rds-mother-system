'use strict';
// 故障诊断矩阵（M4 / B5）。
//
// 目的不是"证明代码没 bug"，而是证明**出问题时用户能看懂**：
// 每种故障都必须给出①可 grep 的错误码 ②一句能行动的话 ③不是 Node 栈。
//
// 覆盖任务书 §9.5 列的八种情况：
//   配置缺失 / 配置格式错误 / 数据库不可读 / 数据库不可写 / 数据库损坏 /
//   资源文件不存在 / 会话来源不可用 / 注册表格式错误
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO, 'mars', 'src', 'cli.js');
const REGISTRY_SCRIPT = path.join(REPO, 'mars', 'scripts', 'mars-mcp-disable.js');

function runCli(args, extraEnv = {}) {
  const env = Object.assign({}, process.env, extraEnv);
  // 避免继承外部凭据/路径配置，保证每个用例都从干净状态开始
  delete env.MARS_TOKEN;
  delete env.MARS_DB;
  delete env.MARS_PRINCIPALS;
  delete env.MARS_ROUTING;
  delete env.RDS_HOME;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, timeout: 60000 });
}

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-diag-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 所有用例共用的底线：不能把 Node 栈甩给用户。 */
function assertNoStack(r) {
  assert.equal(/^\s+at .+:\d+:\d+\)?$/m.test(r.stderr), false, '不应输出 Node 调用栈：\n' + r.stderr);
  assert.equal(/node:internal\//.test(r.stderr), false, '不应暴露 node 内部栈：\n' + r.stderr);
}

test('B5 资源缺失：契约目录不存在 → ASSET_MISSING，而不是 ENOENT', () => {
  withDir((dir) => {
    const r = runCli(['init'], { RDS_HOME: dir });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /ASSET_MISSING/);
    assert.match(r.stderr, /contracts|契约/);
    assertNoStack(r);
  });
});

test('B5 配置缺失：契约在但 role-routing.json 不在 → ROUTING_UNAVAILABLE', () => {
  withDir((dir) => {
    fs.mkdirSync(path.join(dir, 'mars'), { recursive: true });
    fs.cpSync(path.join(REPO, 'mars', 'contracts'), path.join(dir, 'mars', 'contracts'), { recursive: true });
    const r = runCli(['init'], { RDS_HOME: dir });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /ROUTING_UNAVAILABLE/);
    assertNoStack(r);
  });
});

test('B5 配置格式错误：routing 不是合法 JSON → ROUTING_UNAVAILABLE 并指出文件', () => {
  withDir((dir) => {
    const bad = path.join(dir, 'bad-routing.json');
    fs.writeFileSync(bad, '{ "roles": [ oops');
    const r = runCli(['init', '--routing', bad], { RDS_HOME: REPO });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /ROUTING_UNAVAILABLE/);
    assert.match(r.stderr, /bad-routing\.json|routing 配置不可读/);
    assertNoStack(r);
  });
});

test('B5 数据库损坏：file is not a database → DB_OPEN_FAILED + 下一步建议', () => {
  withDir((dir) => {
    const file = path.join(dir, 'bad.db');
    fs.writeFileSync(file, 'definitely not sqlite');
    const r = runCli(['init', '--db', file]);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /DB_OPEN_FAILED/);
    assert.match(r.stderr, /rds doctor|mars-db-backup/, '应给出可执行的下一步');
    assertNoStack(r);
  });
});

test('B5 数据库不可写：父路径是文件 → DB_OPEN_FAILED，不是 ENOTDIR 裸奔', () => {
  withDir((dir) => {
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const r = runCli(['init', '--db', path.join(blocker, 'x', 'mars.db')]);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /DB_OPEN_FAILED/);
    assertNoStack(r);
  });
});

test('B5 会话文件不存在 → exit 2 并提示如何看用法', () => {
  withDir((dir) => {
    const r = runCli(['ledger', '--session', path.join(dir, 'nope.jsonl.zstd')]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /会话文件不存在/);
    assert.match(r.stderr, /相对路径按当前目录解析/);
    assertNoStack(r);
  });
});

test('B5 会话来源不可用：--source 未注册 → SOURCE_UNSUPPORTED 并列出已注册来源', () => {
  withDir((dir) => {
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'session', version: 4, id: 'x' }) + '\n');
    const r = runCli(['ledger', '--session', file, '--source', 'no-such-source']);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /SOURCE_UNSUPPORTED|未知数据源/);
    assert.match(r.stderr, /dsh-session/, '应告诉用户有哪些已注册来源');
    assertNoStack(r);
  });
});

test('B5 注册表格式错误 → HOST_REGISTRY_INVALID，且错误码不重复打印', () => {
  withDir((dir) => {
    const reg = path.join(dir, 'registry.json');
    fs.writeFileSync(reg, '{ not json');
    const r = spawnSync(process.execPath, [REGISTRY_SCRIPT, '--registry', reg], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /HOST_REGISTRY_INVALID/);
    const occurrences = (r.stderr.match(/HOST_REGISTRY_INVALID/g) || []).length;
    assert.equal(occurrences, 1, '错误码不应在一行里出现两次：' + r.stderr.trim());
    assertNoStack(r);
  });
});

test('B5 未知命令优先于身份检查：拼错命令不应报"认证失败"', () => {
  const r = runCli(['no-such-command']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /未知命令/);
  assert.equal(/认证失败/.test(r.stderr), false, '命令拼错不该被诊断成凭证问题');
  assertNoStack(r);
});

test('B5 ledger --help 输出用法并退出 0（此前会报缺少 --session）', () => {
  const r = runCli(['ledger', '--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--session/);
  assert.match(r.stdout, /--source/);
});

// --- MCP 启动降级（回滚演练在干净克隆里发现的问题）------------------------
// 此前 principals.json 不存在时 MCP 直接退出，客户端只看到进程消失 + 一行 ENOENT。
// 与 docs/install.md §9「token 缺失不阻止启动」不一致；现改为降级启动 + 明确告警。

const MCP = path.join(REPO, 'mars', 'src', 'mcp-stdio.js');

function handshake(requests, extraEnv = {}) {
  const env = Object.assign({}, process.env, extraEnv);
  delete env.MARS_TOKEN;
  delete env.MARS_TOKEN_FILE;
  Object.assign(env, extraEnv);
  const input = requests.map((r) => JSON.stringify(r)).join('\n') + '\n';
  return spawnSync(process.execPath, [MCP], { input, encoding: 'utf8', timeout: 60000, env });
}

test('B6 MCP 在 principals.json 缺失时降级启动，而不是退出', () => {
  withDir((dir) => {
    const r = handshake(
      [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'diag', version: '0' } } }],
      { MARS_PRINCIPALS: path.join(dir, 'missing.json'), MARS_DB: path.join(dir, 'mars.db') }
    );
    assert.equal(r.status, 0, r.stderr);
    const msg = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
    assert.equal(msg.result.serverInfo.name, 'mars');
    assert.match(r.stderr, /WARN principals 不可用/);
    assert.match(r.stderr, /rds init-dev/, '应告诉用户怎么生成身份');
  });
});

test('B6 MCP 在 principals.json 缺失时每次调用返回 AUTH_DENIED', () => {
  withDir((dir) => {
    const r = handshake([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'diag', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'demo' } } }
    ], { MARS_PRINCIPALS: path.join(dir, 'missing.json'), MARS_DB: path.join(dir, 'mars.db') });

    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const call = lines.find((m) => m.id === 2);
    const payload = JSON.parse(call.result.content[0].text);
    assert.equal(payload.ok, false);
    assert.match(String(payload.code), /AUTH_DENIED|TOKEN_MISSING/);
  });
});
