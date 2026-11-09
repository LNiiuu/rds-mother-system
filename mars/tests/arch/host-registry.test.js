'use strict';
// M3 / B4：HostRegistry 端口与 DSH 注册表适配器。
//
// 这是唯一会写「外部产品状态」的代码，因此用例比别处更偏安全：
//   只读探测、结构拒绝、备份、原子写、未知字段保留、写后回读。
// 所有用例都跑在临时目录里的假注册表上，绝不触碰真实宿主。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDshHostRegistry } = require('../../src/adapters/dsh-registry');
const { createNullHostRegistry } = require('../../src/adapters/null-host-registry');
const { METHODS, ERRORS } = require('../../src/ports/host-registry');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function withRegistry(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-hostreg-'));
  const registryPath = path.join(dir, 'registry.json');
  if (contents !== null) fs.writeFileSync(registryPath, contents, 'utf8');
  try {
    return fn({ dir, registryPath, backupDir: path.join(dir, 'backups') });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE = JSON.stringify({
  version: 1,
  entries: [
    { name: 'mars-r0', command: 'node', args: ['x'] },
    { name: 'mars-r4', command: 'node', args: ['y'] },
    { name: 'other-tool', command: 'node' }
  ],
  unknownKey: { keep: true }
}, null, 2) + '\n';

test('B4 端口契约：四个方法、四个错误码', () => {
  assert.deepEqual(METHODS.slice().sort(), ['backup', 'detect', 'list', 'removeByPrefix']);
  assert.equal(METHODS.length <= 5, true);
  assert.deepEqual(Object.values(ERRORS).sort(), [
    'HOST_REGISTRY_INVALID', 'HOST_REGISTRY_NOT_FOUND', 'HOST_REGISTRY_READONLY', 'HOST_WRITE_REFUSED'
  ]);
});

test('B4 detect/list：只暴露条目名，不泄露内部结构', () => {
  withRegistry(SAMPLE, ({ registryPath, backupDir }) => {
    const reg = createDshHostRegistry({ registryPath, backupDir });
    const info = reg.detect();
    assert.equal(info.present, true);
    assert.equal(info.format, 'dsh-skill-mcp-manager');
    assert.equal(info.entries, 3);
    assert.equal(info.writable, true);
    assert.deepEqual(info.topLevelKeys, ['entries', 'unknownKey', 'version']);

    const list = reg.list();
    assert.deepEqual(list.map((e) => e.name), ['mars-r0', 'mars-r4', 'other-tool']);
    for (const item of list) {
      assert.deepEqual(Object.keys(item).sort(), ['name', 'opaque']);
      assert.equal(item.command, undefined, '不得暴露条目内部字段');
    }
  });
});

test('B4 缺文件 / 坏 JSON / entries 不是数组：都不猜，直接报码', () => {
  withRegistry(null, ({ registryPath, backupDir }) => {
    const reg = createDshHostRegistry({ registryPath, backupDir });
    assert.equal(reg.detect().present, false, 'detect 对缺失文件返回 present=false');
    assert.throws(() => reg.list(), (err) => err.code === 'HOST_REGISTRY_NOT_FOUND');
    assert.throws(() => reg.removeByPrefix('mars-', { dryRun: false }), (err) => err.code === 'HOST_REGISTRY_NOT_FOUND');
  });

  withRegistry('{ not json', ({ registryPath, backupDir }) => {
    const reg = createDshHostRegistry({ registryPath, backupDir });
    assert.throws(() => reg.list(), (err) => err.code === 'HOST_REGISTRY_INVALID');
  });

  withRegistry(JSON.stringify({ version: 1, entries: 'nope' }), ({ registryPath, backupDir }) => {
    const reg = createDshHostRegistry({ registryPath, backupDir });
    assert.throws(() => reg.detect(), (err) => err.code === 'HOST_REGISTRY_INVALID');
  });
});

test('B4 空前缀被拒绝（否则等于清空注册表）', () => {
  withRegistry(SAMPLE, ({ registryPath, backupDir }) => {
    const reg = createDshHostRegistry({ registryPath, backupDir });
    assert.throws(() => reg.removeByPrefix('', { dryRun: true }), (err) => err.code === 'HOST_REGISTRY_INVALID');
    assert.throws(() => reg.removeByPrefix(undefined, { dryRun: true }), (err) => err.code === 'HOST_REGISTRY_INVALID');
  });
});

test('B4 默认 dry-run：字节不变、无备份', () => {
  withRegistry(SAMPLE, ({ registryPath, backupDir }) => {
    const before = sha256File(registryPath);
    const reg = createDshHostRegistry({ registryPath, backupDir });
    const result = reg.removeByPrefix('mars-');
    assert.equal(result.dryRun, true);
    assert.equal(result.removed, 2);
    assert.deepEqual(result.names, ['mars-r0', 'mars-r4']);
    assert.equal(result.changed, false);
    assert.equal(result.backupPath, null);
    assert.equal(sha256File(registryPath), before, 'dry-run 不得改动文件');
    assert.equal(fs.existsSync(backupDir), false, 'dry-run 不得创建备份目录');
  });
});

test('B4 显式写入：先备份、保留未知字段、无临时文件残留', () => {
  withRegistry(SAMPLE, ({ dir, registryPath, backupDir }) => {
    const beforeHash = sha256File(registryPath);
    const reg = createDshHostRegistry({ registryPath, backupDir });
    const result = reg.removeByPrefix('mars-', { dryRun: false });

    assert.equal(result.changed, true);
    assert.equal(result.removed, 2);
    assert.equal(result.kept, 1);
    assert.notEqual(result.sha256After, result.sha256Before);

    assert.ok(result.backupPath && fs.existsSync(result.backupPath), '必须有备份');
    assert.equal(sha256File(result.backupPath), beforeHash, '备份内容必须等于写入前的文件');

    const after = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.deepEqual(after.entries.map((e) => e.name), ['other-tool']);
    assert.deepEqual(after.unknownKey, { keep: true }, '未知顶层字段必须保留');
    assert.equal(after.version, 1);

    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, [], '不应残留临时文件');
  });
});

test('B4 没有匹配项时不写文件、不建备份', () => {
  withRegistry(SAMPLE, ({ registryPath, backupDir }) => {
    const before = sha256File(registryPath);
    const reg = createDshHostRegistry({ registryPath, backupDir });
    const result = reg.removeByPrefix('nomatch-', { dryRun: false });
    assert.equal(result.removed, 0);
    assert.equal(result.changed, false);
    assert.equal(sha256File(registryPath), before);
    assert.equal(fs.existsSync(backupDir), false);
  });
});

test('B4 无宿主时给出可解释的错误，而不是「文件不存在」', () => {
  const reg = createNullHostRegistry({ reason: '测试：无宿主' });
  assert.equal(reg.detect().present, false);
  assert.deepEqual(reg.list(), []);
  assert.throws(() => reg.removeByPrefix('mars-'), (err) => err.code === 'HOST_REGISTRY_NOT_FOUND');
  assert.throws(() => reg.backup(), (err) => err.code === 'HOST_REGISTRY_NOT_FOUND');
});
