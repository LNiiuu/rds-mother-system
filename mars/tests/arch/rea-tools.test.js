'use strict';
// M19：REA 统一工具适配层 —— 命令构造、缺失工具、状态形状。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../../src/adapters/rea/tool-registry');

test('M19 工具适配层：状态包含全部工具且能力/安全字段齐全', async () => {
  const rows = await tools.status();
  assert.ok(rows.length >= 7);
  for (const r of rows) {
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.present, 'boolean');
    assert.ok(Array.isArray(r.capabilities) && r.capabilities.length > 0);
    assert.equal(typeof r.safety, 'string');
    if (!r.present) assert.ok(r.version === null || typeof r.version === 'string');
  }
  const names = rows.map((r) => r.name);
  for (const n of ['objdump', 'ghidra', 'jadx', 'tshark', 'frida', 'adb']) assert.ok(names.includes(n));
});

test('M19 工具适配层：未知工具/缺失工具返回结构化错误，不抛', async () => {
  const unknown = await tools.execute('no-such-tool', []);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error_code, 'TOOL_UNKNOWN');
  const detect = await tools.detect('tshark');
  if (!detect.present) {
    const r = await tools.execute('tshark', ['-v']);
    assert.equal(r.ok, false);
    assert.equal(r.error_code, 'TOOL_MISSING');
    assert.ok(r.install);
  }
});

test('M19 工具适配层：命令构造是 argv 数组，不经 shell', () => {
  assert.deepEqual(tools.buildGhidraArgs({ sample: 'a.exe', projectDir: 'p', postScript: 'x.py', scriptPath: 's' }),
    ['p', 'mars-rea', '-import', 'a.exe', '-deleteProject', '-postScript', 'x.py', '-scriptPath', 's']);
  assert.deepEqual(tools.buildJadxArgs({ sample: 'a.apk', outDir: 'out' }), ['-d', 'out', '--no-res', 'a.apk']);
  assert.deepEqual(tools.buildTsharkArgs({ sample: 'a.pcap' }), ['-r', 'a.pcap', '-q', '-z', 'io,phs']);
  assert.deepEqual(tools.buildFridaArgs({ pid: 123, script: 'h.js' }), ['-p', '123', '-l', 'h.js']);
});
