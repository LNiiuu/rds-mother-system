'use strict';
// A3 / A5 / G2: lifecycle, approval gating, visibility scope and source_ref traversal.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const store = require('../../src/store');
const { compileContext } = require('../../src/compiler');

function propose(env, id, extra = {}) {
  return store.propose(env.db, env.principal(id), Object.assign({
    project_id: 'p1', role_id: env.principal(id).roles[0],
    source_ref: 'docs/phase1-lifecycle.md', source_version: 'v1'
  }, extra), { allowedRoots: [env.dir], routing: env.routing, assets: env.assets });
}

function compile(env, id, query) {
  return compileContext(env.db, env.principal(id), env.routing, {
    assets: env.assets,project_id: 'p1', task_id: 'T-P1-TEST', role_id: env.principal(id).roles[0],
    query, task: { id: 'T-P1-TEST', objective: 'phase1 lifecycle', acceptance: ['A5'] },
    evidence: [{ ref: 'docs/phase1-lifecycle.md', kind: 'file' }]
  });
}

test('A5 proposed memory never enters a packet until approved', () => {
  const env = setup('mars-p1-life-');
  const created = propose(env, 'R2', { content: 'lifecycle-marker pending approval', memory_type: 'L2' });
  assert.equal(created.status, 'proposed');
  const before = compile(env, 'R3', 'lifecycle-marker');
  assert.ok(!before.packet.sections.some(sec => sec.content.includes('lifecycle-marker')));
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  const after = compile(env, 'R3', 'lifecycle-marker');
  const facts = after.packet.sections.find(sec => sec.kind === 'facts');
  assert.ok(facts && facts.content.includes('lifecycle-marker'));
});

test('A4 visibility=role is scoped to the declared roles', () => {
  const env = setup('mars-p1-life-');
  const created = propose(env, 'R3', {
    content: 'role scoped L3 memory', memory_type: 'L3', visibility: 'role', role_scope: ['R3']
  });
  store.review(env.db, env.principal('R4'), 'R4', 'p1', created.memory_id, 'approved', 'ok');
  assert.throws(() => store.get(env.db, env.principal('R2'), 'R2', 'p1', created.memory_id), /MEMORY_DENIED/);
  const own = store.get(env.db, env.principal('R3'), 'R3', 'p1', created.memory_id);
  assert.equal(own.memory_id, created.memory_id);
});

test('G2 source_ref traversal and absolute paths are denied', () => {
  const env = setup('mars-p1-life-');
  assert.throws(() => propose(env, 'R3', { content: 'x', source_ref: '../escape.md' }), /SOURCE_REF_DENIED TRAVERSAL_DENIED/);
  assert.throws(() => propose(env, 'R3', { content: 'x', source_ref: 'docs/../../escape.md' }), /SOURCE_REF_DENIED TRAVERSAL_DENIED/);
  assert.throws(() => propose(env, 'R3', { content: 'x', source_ref: '/etc/passwd' }), /SOURCE_REF_DENIED ABSOLUTE_PATH_DENIED/);
  assert.throws(() => propose(env, 'R3', { content: 'x', source_ref: 'C:\\Windows\\win.ini' }), /SOURCE_REF_DENIED ABSOLUTE_PATH_DENIED/);
  assert.throws(() => propose(env, 'R3', { content: 'x', source_ref: '\\\\server\\share\\file.md' }), /SOURCE_REF_DENIED ABSOLUTE_PATH_DENIED/);
});

test('G2 symlink escaping the allowed root is denied', (t) => {
  const env = setup('mars-p1-life-');
  const outside = path.join(env.dir, '..', 'mars-outside-' + process.pid);
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), 'outside secret', 'utf8');
  const link = path.join(env.dir, 'link-outside');
  // 目录符号链接：Windows 用 junction（无需管理员权限），POSIX 用 dir。
  // 创建失败属于「安全断言无法验证」，必须显式失败；静默跳过会让越界防护形同虚设。
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    assert.fail('SECURITY_TEST_UNAVAILABLE: 无法创建目录符号链接（' + err.code + '），越界防护未被验证');
  }
  assert.throws(
    () => propose(env, 'R3', { content: 'x', source_ref: 'link-outside/secret.md' }),
    /SOURCE_REF_DENIED SYMLINK_ESCAPE_DENIED/
  );
});

test('A3 same content from different sources is not merged; restore keeps one fragment', () => {
  const env = setup('mars-p1-life-');
  const a = propose(env, 'R3', { content: 'identical task card text', source_ref: 'docs/card-a.md', source_version: 'v1' });
  const again = propose(env, 'R3', { content: 'identical task card text', source_ref: 'docs/card-a.md', source_version: 'v1' });
  const b = propose(env, 'R3', { content: 'identical task card text', source_ref: 'docs/card-b.md', source_version: 'v1' });
  assert.equal(again.duplicate, true);
  assert.equal(again.memory_id, a.memory_id);
  assert.equal(b.duplicate, false);
  assert.notEqual(b.memory_id, a.memory_id);
});
