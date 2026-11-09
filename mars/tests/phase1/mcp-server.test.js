'use strict';
// MCP gateway: server-side authorization, stable codes and default-disabled CLI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, TOKENS } = require('./helpers');
const { testAssets } = require('../helpers/assets');
const { createServer } = require('../../src/mcp');

test('MCP denies missing/unknown identity and cross-project requests', () => {
  const env = setup('mars-p1-mcp-', { R2: { project_ids: ['p1'] } });
  const server = createServer({ dbPath: env.dbPath, principalsPath: env.principalsPath, routingPath: path.join(__dirname, '..', '..', 'config', 'role-routing.json'), assets: testAssets() });
  try {
    assert.equal(server.handle({ method: 'memory.list', params: { project_id: 'p1' } }).code, 'AUTH_DENIED');
    assert.equal(server.handle({ token: 'short', method: 'memory.list', params: { project_id: 'p1' } }).code, 'AUTH_DENIED');
    const cross = server.handle({ token: TOKENS.R2, method: 'memory.list', params: { project_id: 'p2', role_id: 'R2' } });
    assert.equal(cross.code, 'AUTH_DENIED');
    const review = server.handle({ token: TOKENS.R4, method: 'memory.review', params: { project_id: 'p1', role_id: 'R4', memory_id: 'x' } });
    assert.equal(review.code, 'METHOD_NOT_FOUND');
  } finally {
    server.close();
  }
});

test('MCP propose writes proposed only and errors never leak paths or stacks', () => {
  const env = setup('mars-p1-mcp-');
  const server = createServer({ dbPath: env.dbPath, principalsPath: env.principalsPath, routingPath: path.join(__dirname, '..', '..', 'config', 'role-routing.json'), allowedRoots: [env.dir], assets: testAssets() });
  try {
    const created = server.handle({
      token: TOKENS.R2, method: 'memory.propose',
      params: { project_id: 'p1', role_id: 'R2', content: 'mcp proposed fixture', memory_type: 'L2', source_ref: 'docs/mcp.md', source_version: 'v1' }
    });
    assert.equal(created.ok, true);
    assert.equal(created.data.status, 'proposed');
    const row = env.db.prepare('SELECT status FROM memories WHERE memory_id = ?').get(created.data.memory_id);
    assert.equal(row.status, 'proposed');
    const denied = server.handle({ token: TOKENS.R3, method: 'memory.get', params: { project_id: 'p1', role_id: 'R3', memory_id: created.data.memory_id } });
    assert.equal(denied.code, 'MEMORY_DENIED');
    const badPath = server.handle({
      token: TOKENS.R3, method: 'memory.propose',
      params: { project_id: 'p1', role_id: 'R3', content: 'x', source_ref: 'D:\\Windows\\win.ini', source_version: 'v1' }
    });
    assert.equal(badPath.code, 'SOURCE_REF_DENIED');
    assert.ok(!JSON.stringify(badPath).includes('D:\\Windows'));
    assert.ok(!('stack' in badPath));
  } finally {
    server.close();
  }
});

test('MCP context.compile is authorized and returns a packet', () => {
  const env = setup('mars-p1-mcp-');
  const server = createServer({ dbPath: env.dbPath, principalsPath: env.principalsPath, routingPath: path.join(__dirname, '..', '..', 'config', 'role-routing.json'), assets: testAssets() });
  try {
    const compiled = server.handle({
      token: TOKENS.R3, method: 'context.compile',
      params: { project_id: 'p1', role_id: 'R3', task_id: 'T-MCP', task: { id: 'T-MCP' }, evidence: [{ ref: 'docs/x.md', kind: 'file' }] }
    });
    assert.equal(compiled.ok, true);
    assert.equal(compiled.data.packet.estimate_label, '[ESTIMATE]');
    assert.equal(compiled.data.packet.role_id, 'R3');
  } finally {
    server.close();
  }
});

test('A8 MCP CLI stays default-disabled without --enable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-p1-mcp-cli-'));
  const cli = path.resolve(__dirname, '..', '..', 'src', 'cli.js');
  const run = spawnSync(process.execPath, [cli, 'mcp', '--db', path.join(dir, 'm.db'), '--principals', path.join(dir, 'p.json')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 5);
  assert.match(run.stderr, /MCP 网关默认禁用/);
  assert.ok(!fs.existsSync(path.join(dir, 'm.db')));
});
