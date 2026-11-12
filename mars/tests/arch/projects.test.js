'use strict';
// M9：多项目注册、路径安全、软删除与隔离。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('../phase1/helpers');
const projects = require('../../src/projects');
const projectRoots = require('../../src/adapters/fs-project-roots');
const deps = { resolveRoot: projectRoots.resolveRoot };
const store = require('../../src/store');
const { compileContext } = require('../../src/compiler');

function root(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  return dir;
}

test('M9 项目注册：两个项目、根目录规范化、列表', () => {
  const env = setup('m9-proj-');
  const ra = root('proj-a');
  const rb = root('proj-b');
  const a = projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'A', root: ra, policy: 'default' }, deps);
  const b = projects.create(env.db, env.principal('R0'), { project_id: 'p2', name: 'B', root: rb, policy: 'default' }, deps);
  assert.equal(a.project_id, 'p1');
  assert.equal(b.project_id, 'p2');
  assert.equal(a.root_path, fs.realpathSync(ra));
  assert.equal(projects.list(env.db).length, 2);
  assert.equal(projects.show(env.db, 'p1').display_name, 'A');
});

test('M9 项目校验：重复 ID、非法 ID、根目录不存在', () => {
  const env = setup('m9-proj-bad-');
  projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'A', root: root('proj-c') }, deps);
  assert.throws(() => projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'A2', root: root('proj-d') }, deps), /PROJECT_EXISTS/);
  assert.throws(() => projects.create(env.db, env.principal('R0'), { project_id: 'P1', name: 'X', root: root('proj-e') }, deps), /PROJECT_ID_INVALID/);
  assert.throws(() => projects.create(env.db, env.principal('R0'), { project_id: 'p3', name: 'X' }, deps), /PROJECT_ROOT_REQUIRED/);
  assert.throws(() => projects.create(env.db, env.principal('R0'), { project_id: 'p4', name: 'X', root: path.join(os.tmpdir(), 'no-such-dir-xyz') }, deps), /PROJECT_ROOT_NOT_FOUND/);
});

test('M9 路径安全：符号链接（junction）被解析成真实路径', () => {
  const env = setup('m9-proj-link-');
  const target = root('proj-target');
  const link = path.join(os.tmpdir(), 'm9-link-' + process.pid);
  try {
    if (fs.existsSync(link)) fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(target, link, 'junction');
  } catch (err) {
    // 某些环境不允许创建链接：跳过而不是伪造通过
    return;
  }
  const created = projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'L', root: link }, deps);
  assert.equal(created.root_path, fs.realpathSync(target));
  fs.rmSync(link, { recursive: true, force: true });
});

test('M9 软删除：必须二次确认，不删源码与记忆', () => {
  const env = setup('m9-proj-rm-');
  const r = root('proj-rm');
  projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'A', root: r }, deps);
  const mem = store.propose(env.db, env.principal('R0'), {
    project_id: 'p1', memory_type: 'L3', content: '删除后仍应存在', source_ref: 'x.md', source_version: 'v1', role_id: 'R0',
  }, { assets: env.assets, routing: env.routing });

  assert.throws(() => projects.remove(env.db, 'p1', 'wrong'), /PROJECT_CONFIRM_REQUIRED/);
  assert.equal(projects.show(env.db, 'p1').status, 'active');
  const removed = projects.remove(env.db, 'p1', 'p1');
  assert.equal(removed.status, 'removed');
  assert.equal(removed.source_deleted, false);
  assert.equal(fs.existsSync(r), true, '源目录不能被删');
  assert.equal(projects.list(env.db).length, 0, '默认列表不含 removed');
  assert.equal(projects.list(env.db, { includeRemoved: true }).length, 1);
  const row = env.db.prepare('SELECT count(*) AS n FROM memories WHERE project_id = ?').get('p1');
  assert.equal(row.n, 1, '记忆不能因项目移除而丢');
  assert.ok(mem.memory_id);
});

test('M9 项目隔离：A 的记忆与上下文不进 B', () => {
  const env = setup('m9-iso-');
  projects.create(env.db, env.principal('R0'), { project_id: 'p1', name: 'A', root: root('iso-a') }, deps);
  projects.create(env.db, env.principal('R0'), { project_id: 'p2', name: 'B', root: root('iso-b') }, deps);

  const mem = store.propose(env.db, env.principal('R0'), {
    project_id: 'p1', memory_type: 'L3', content: 'ALPHA-ONLY-P1 的决策', source_ref: 'a.md', source_version: 'v1', role_id: 'R0',
  }, { assets: env.assets, routing: env.routing });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', mem.memory_id, 'approved', 'ok');

  const p1 = compileContext(env.db, env.principal('R0'), env.routing, {
    project_id: 'p1', task_id: 'T1', role_id: 'R0', budget: 4000, task: { id: 'T1', text: '任务' }, assets: env.assets,
  });
  const p2 = compileContext(env.db, env.principal('R0'), env.routing, {
    project_id: 'p2', task_id: 'T2', role_id: 'R0', budget: 4000, task: { id: 'T2', text: '任务' }, assets: env.assets,
  });
  const p1Text = p1.packet.sections.map((s) => s.content).join('\n');
  const p2Text = p2.packet.sections.map((s) => s.content).join('\n');
  assert.match(p1Text, /ALPHA-ONLY-P1/);
  assert.ok(!p2Text.includes('ALPHA-ONLY-P1'), '项目 B 不能读到项目 A 的记忆');

  const p2Rows = env.db.prepare('SELECT * FROM memories WHERE project_id = ?').all('p2');
  assert.equal(p2Rows.length, 0);
});
