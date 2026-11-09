'use strict';
// 配置解析一致性测试（M4 / B4）。
//
// M3 已经把四份各自为政的解析收敛到 paths.js 的 resolvePaths()，但"收敛了"这件事
// 本身没有机械约束 —— 任何人再写一份 `process.env.MARS_DB || ...` 都不会被发现。
// 本文件盯三件事：
//   1. 优先级固定为「命令行 > 环境变量 > 安装根默认」；
//   2. doctor 与运行时用同一个函数算 db 路径（否则医生报的库不是真正的库）；
//   3. 域模块不再自己读环境变量（配置是组合根在启动时解析的快照）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePaths, PACKAGE_ROOT } = require('../../src/paths');

const REPO = path.resolve(__dirname, '..', '..', '..');

test('B4 路径优先级：命令行参数覆盖环境变量，环境变量覆盖默认值', () => {
  const env = { MARS_DB: '/tmp/from-env.db', MARS_PRINCIPALS: '/tmp/env-principals.json', MARS_ROUTING: '/tmp/env-routing.json' };

  // 只有环境变量
  const onlyEnv = resolvePaths({ env });
  assert.equal(onlyEnv.db, path.resolve('/tmp/from-env.db'));
  assert.equal(onlyEnv.principals, path.resolve('/tmp/env-principals.json'));

  // 命令行 + 环境变量：命令行赢
  const both = resolvePaths({ argv: { db: '/tmp/from-argv.db' }, env });
  assert.equal(both.db, path.resolve('/tmp/from-argv.db'));
  assert.equal(both.principals, path.resolve('/tmp/env-principals.json'), '未指定的项仍用环境变量');

  // 都没有：安装根默认
  const bare = resolvePaths({ env: {} });
  assert.equal(bare.db, path.join(PACKAGE_ROOT, 'mars', 'var', 'mars.db'));
  assert.equal(bare.root, PACKAGE_ROOT);
});

test('B4 RDS_HOME 可以整体改根，且派生的默认路径跟着走', () => {
  const home = path.resolve('/tmp/rds-home-probe');
  const p = resolvePaths({ env: { RDS_HOME: home } });
  assert.equal(p.root, home);
  assert.equal(p.db, path.join(home, 'mars', 'var', 'mars.db'));
  assert.equal(p.routing, path.join(home, 'mars', 'config', 'role-routing.json'));

  // 显式 --root 优先级更高
  const explicit = resolvePaths({ argv: { root: '/tmp/explicit' }, env: { RDS_HOME: home } });
  assert.equal(explicit.root, path.resolve('/tmp/explicit'));
});

test('B4 doctor 与运行时共用 resolvePaths（不允许第二份解析）', () => {
  const doctor = fs.readFileSync(path.join(REPO, 'bin', 'doctor.mjs'), 'utf8');
  assert.match(doctor, /require\(path\.join\(ROOT, 'mars', 'src', 'paths\.js'\)\)/);
  // 反例守卫：doctor 不得自己读 MARS_DB
  assert.equal(/process\.env\.MARS_DB/.test(doctor), false, 'doctor 不应自己读 MARS_DB');
});

test('B4 域模块不再直接读环境变量（配置是启动快照）', () => {
  const domainFiles = ['store.js', 'compiler.js', 'manifest.js', 'ledger.js', 'retrieval.js', 'sharing.js'];
  const offenders = [];
  for (const name of domainFiles) {
    const src = fs.readFileSync(path.join(REPO, 'mars', 'src', name), 'utf8');
    // 允许注释里提 process.env；只挑真正的读取
    const code = src.replace(/\/\/[^\n]*/g, '');
    if (/process\.env\./.test(code)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], '这些域模块仍在读环境变量: ' + offenders.join(', '));
});
