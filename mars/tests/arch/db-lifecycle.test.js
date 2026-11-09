'use strict';
// 数据库生命周期测试（M4 / B3）。
//
// 覆盖四个在基线上真实存在的缺陷：
//   1. 损坏库 → 原始 SQLite 异常（CLI 打出 Node 栈 + 安装路径，无错误码）
//   2. 更新的库（schema_version > 代码）被静默"降级"：initSchema 会把版本号覆盖回旧值
//   3. 没有 busy_timeout → MCP 常驻 + CLI 并发写会立刻 SQLITE_BUSY
//   4. 审计写入失败被 `catch {}` 完全吞掉，无人知晓
//
// 只用临时文件，不碰 mars/var 下的真实库。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDb, audit, attachAuditSink, auditStats, SCHEMA_VERSION } = require('../../src/db');
const { AppError } = require('../../src/errors');

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-db-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function modify(db, sql, params = []) {
  db.prepare(sql).run(...params);
  return db;
}

test('B3 损坏的数据库文件给出带码错误与可操作提示，而不是原始栈', () => {
  withDir((dir) => {
    const file = path.join(dir, 'bad.db');
    fs.writeFileSync(file, 'this is definitely not a sqlite database');

    assert.throws(
      () => openDb(file),
      (err) => {
        assert.ok(err instanceof AppError, '应是 AppError');
        assert.equal(err.code, 'DB_OPEN_FAILED');
        assert.match(err.message, /不是有效的 SQLite 数据库|损坏/);
        assert.match(err.message, /mars-db-backup\.js|rds doctor/, '应给出可执行的下一步');
        assert.equal(/at openDb|ERR_SQLITE_ERROR/.test(err.message), false, '不应把原始栈/内部码抛给用户');
        return true;
      }
    );
  });
});

test('B3 结构版本高于代码支持的库被拒绝，且版本号不被写回旧值', () => {
  withDir((dir) => {
    const file = path.join(dir, 'future.db');
    const first = openDb(file);
    modify(first, "UPDATE meta SET value = '9' WHERE key = 'schema_version'");
    first.close();

    assert.throws(
      () => openDb(file),
      (err) => {
        assert.equal(err.code, 'DB_SCHEMA_NEWER');
        assert.match(err.message, new RegExp('9.*' + SCHEMA_VERSION));
        return true;
      }
    );

    // 关键断言：拒绝之后库里的版本号必须原样保留 —— 否则等于静默降级了一个更新的库
    const check = openDb(':memory:');
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(file, { readOnly: true });
    const value = raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value;
    raw.close();
    check.close();
    assert.equal(value, '9', '被拒绝时不得改写库内容');
  });
});

test('B3 旧版本的库打开时自动增量迁移（补 expires_at 并升到当前版本）', () => {
  withDir((dir) => {
    const file = path.join(dir, 'legacy.db');
    const first = openDb(file);
    first.exec('ALTER TABLE memories DROP COLUMN expires_at');
    modify(first, "UPDATE meta SET value = '3' WHERE key = 'schema_version'");
    first.close();

    const migrated = openDb(file);
    const cols = migrated.prepare("PRAGMA table_info('memories')").all().map((c) => c.name);
    const version = migrated.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value;
    migrated.close();

    assert.ok(cols.includes('expires_at'), '迁移应补上 expires_at');
    assert.equal(version, String(SCHEMA_VERSION));
  });
});

test('B3 重复打开同一个库是幂等的（initSchema 可反复执行）', () => {
  withDir((dir) => {
    const file = path.join(dir, 'again.db');
    for (let i = 0; i < 3; i += 1) {
      const db = openDb(file);
      const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value;
      assert.equal(version, String(SCHEMA_VERSION));
      db.close();
    }
  });
});

test('B3 连接设置了 busy_timeout（并发写不再立刻失败）', () => {
  withDir((dir) => {
    const db = openDb(path.join(dir, 'busy.db'));
    const row = db.prepare('PRAGMA busy_timeout').get();
    const timeout = Number(Object.values(row)[0]);
    db.close();
    assert.ok(timeout > 0, 'busy_timeout 应大于 0，实际 ' + timeout);
  });
});

test('B3 审计写入失败时调用不被阻断，但会计数（不再完全静默）', () => {
  withDir((dir) => {
    const db = openDb(path.join(dir, 'audit.db'));
    attachAuditSink(db, {
      record() { throw new Error('disk full (injected)'); }
    });

    assert.doesNotThrow(() => audit(db, { principal_id: 'local', action: 'probe', result: 'ok' }));
    assert.doesNotThrow(() => audit(db, { principal_id: 'local', action: 'probe', result: 'ok' }));

    const stats = auditStats(db);
    assert.equal(stats.failures, 2);
    assert.match(stats.lastError, /disk full/);
    db.close();
  });
});

test('B3 无审计失败时计数为零', () => {
  withDir((dir) => {
    const db = openDb(path.join(dir, 'ok.db'));
    audit(db, { principal_id: 'local', action: 'probe', result: 'ok' });
    assert.deepEqual(auditStats(db), { failures: 0, lastError: null });
    db.close();
  });
});

// --- 备份脚本（B3 同时核查备份/恢复链路）----------------------------------

const { spawnSync } = require('node:child_process');

const BACKUP_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'mars-db-backup.js');

test('B3 备份脚本产出的快照完整性为 ok，且可用于恢复', () => {
  withDir((dir) => {
    const live = path.join(dir, 'live.db');
    const outDir = path.join(dir, 'backups');
    openDb(live).close();

    const r = spawnSync(process.execPath, [BACKUP_SCRIPT, '--db', live, '--out-dir', outDir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    assert.equal(info.integrity, 'ok');
    assert.ok(fs.existsSync(info.file));

    // 恢复演练：把快照当成新库打开，应能查 schema_version 与表
    const restored = openDb(info.file);
    constantsCheck(restored);
    restored.close();
  });
});

function constantsCheck(db) {
  const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value;
  assert.equal(v, String(SCHEMA_VERSION));
  assert.equal(typeof db.prepare('SELECT COUNT(*) AS n FROM memories').get().n, 'number');
}

test('B3 备份脚本拒绝未知参数（此前 --out 会被静默忽略并写到默认目录）', () => {
  withDir((dir) => {
    const live = path.join(dir, 'live.db');
    openDb(live).close();
    const r = spawnSync(process.execPath, [BACKUP_SCRIPT, '--db', live, '--out', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /未知参数 --out/);
  });
});
