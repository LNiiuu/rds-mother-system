'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../src/mcp');
const { sha256 } = require('../../src/util');

const TOKEN = 'test-token-0123456789abcdef';
const OTHER_TOKEN = 'other-token-0123456789abcdef';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-mcp-'));
  const principalsPath = path.join(dir, 'principals.json');
  fs.writeFileSync(principalsPath, JSON.stringify({
    version: '0.1.0',
    principals: [{
      token_sha256: sha256(TOKEN),
      principal_id: 'test-r2',
      project_ids: ['p1'],
      roles: ['R2']
    }, {
      token_sha256: sha256(OTHER_TOKEN),
      principal_id: 'test-r2-other',
      project_ids: ['p1'],
      roles: ['R2']
    }]
  }), 'utf8');
  const server = createServer({ dbPath: path.join(dir, 'mars.db'), principalsPath });
  return { dir, server };
}

function call(server, method, params, token = TOKEN) {
  return server.handle({ token, method, params });
}

test('unknown and short tokens are denied without detail', () => {
  const { server } = setup();
  try {
    const bad = call(server, 'memory.list', { project_id: 'p1', role_id: 'R2' }, 'wrong-token-0123456789');
    assert.deepEqual(bad, { ok: false, code: 'AUTH_DENIED' });
    const short = server.handle({ token: 'short', method: 'memory.list', params: { project_id: 'p1', role_id: 'R2' } });
    assert.equal(short.code, 'AUTH_DENIED');
    assert.equal(JSON.stringify(bad).includes('stack'), false);
  } finally {
    server.close();
  }
});

test('memory.propose only writes proposed and is readable by its creator', () => {
  const { server } = setup();
  try {
    const proposed = call(server, 'memory.propose', {
      project_id: 'p1', role_id: 'R2',
      input: { content: 'MARS 使用 SQLite 存储记忆', source_ref: 'docs/a.md', source_version: 'v1', memory_type: 'L2' }
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.data.status, 'proposed');
    assert.match(proposed.data.memory_id, /^mem_/);

    const got = call(server, 'memory.get', { project_id: 'p1', role_id: 'R2', memory_id: proposed.data.memory_id });
    assert.equal(got.ok, true);
    assert.equal(got.data.content, 'MARS 使用 SQLite 存储记忆');
    assert.equal(got.data.status, 'proposed');

    const list = call(server, 'memory.list', { project_id: 'p1', role_id: 'R2', filter: { status: 'proposed' } });
    assert.equal(list.ok, true);
    assert.equal(list.data.length, 1);

    const stats = call(server, 'memory.stats', { project_id: 'p1', role_id: 'R2' });
    assert.equal(stats.ok, true);
    assert.equal(stats.data.project_id, 'p1');
    assert.equal(stats.data.memories, 1);
    assert.equal(stats.data.proposed, 1);
    assert.equal(stats.data.approved, 0);
  } finally {
    server.close();
  }
});

test('project, role and method checks happen server-side', () => {
  const { server } = setup();
  try {
    assert.equal(call(server, 'memory.list', { project_id: 'p2', role_id: 'R2' }).code, 'AUTH_DENIED');
    assert.equal(call(server, 'memory.list', { project_id: 'p1', role_id: 'R4' }).code, 'AUTH_DENIED');
    assert.equal(call(server, 'memory.review', { project_id: 'p1', role_id: 'R2', memory_id: 'x' }).code, 'METHOD_NOT_FOUND');
    assert.equal(call(server, 'memory.get', { project_id: 'p1', role_id: 'R2' }).code, 'BAD_REQUEST');
    assert.equal(call(server, 'memory.list', {}).code, 'PROJECT_REQUIRED');
  } finally {
    server.close();
  }
});

test('invalid propose input returns a stable code, not a path or stack', () => {
  const { server } = setup();
  try {
    const res = call(server, 'memory.propose', {
      project_id: 'p1', role_id: 'R2',
      input: { content: '', source_ref: 'docs/a.md', source_version: 'v1' }
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'CONTENT_REQUIRED');
    const text = JSON.stringify(res);
    assert.equal(text.includes('D:\\'), false);
    assert.equal(text.includes('at '), false);
  } finally {
    server.close();
  }
});

test('proposed memories are not visible to another principal and absolute paths are denied', () => {
  const { server } = setup();
  try {
    const proposed = call(server, 'memory.propose', {
      project_id: 'p1', role_id: 'R2',
      input: { content: 'private draft', source_ref: 'docs/b.md', source_version: 'v1' }
    });
    assert.equal(proposed.ok, true);

    const otherGet = call(server, 'memory.get', {
      project_id: 'p1', role_id: 'R2', memory_id: proposed.data.memory_id
    }, OTHER_TOKEN);
    assert.deepEqual(otherGet, { ok: false, code: 'MEMORY_DENIED' });

    const otherList = call(server, 'memory.list', { project_id: 'p1', role_id: 'R2', filter: { status: 'proposed' } }, OTHER_TOKEN);
    assert.equal(otherList.ok, true);
    assert.equal(otherList.data.length, 0);

    const escaped = call(server, 'memory.propose', {
      project_id: 'p1', role_id: 'R2',
      input: { content: 'x', source_ref: 'D:\\secret.txt', source_version: 'v1' }
    });
    assert.equal(escaped.code, 'SOURCE_REF_DENIED');
  } finally {
    server.close();
  }
});

test('context.compile is authorized and returns a packet', () => {
  const { server } = setup();
  try {
    const res = call(server, 'context.compile', {
      project_id: 'p1', role_id: 'R2', budget: 512,
      task: { id: 'T-1', objective: 'verify', acceptance: ['ok'] },
      state: 'unit test', evidence: []
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.packet.project_id, 'p1');
    assert.equal(res.data.packet.role_id, 'R2');
    assert.ok(Array.isArray(res.data.packet.sections));
  } finally {
    server.close();
  }
});
