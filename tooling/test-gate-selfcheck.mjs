#!/usr/bin/env node
/**
 * 门禁自检：证明 test-gate 真的会变红。
 *
 * 在临时目录里造四种最小用例集（全绿 / 有失败 / 有跳过 / 空集），
 * 分别跑一遍 test-gate，并核对退出码是否符合预期。
 * 这条检查存在的意义：防止「门禁永远返回 0」这种最隐蔽的假绿。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'test-gate.mjs');

const CASES = [
  {
    id: 'all-pass',
    expect: 0,
    files: {
      'a.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('passes', () => { assert.equal(1, 1); });
`
    }
  },
  {
    id: 'has-failure',
    expect: 1,
    files: {
      'a.test.js': `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('fails on purpose', () => { assert.equal(1, 2); });
`
    }
  },
  {
    id: 'has-skip',
    expect: 1,
    files: {
      'a.test.js': `'use strict';
const { test } = require('node:test');
test('skips silently', (t) => { t.skip('fixture missing'); });
`
    }
  },
  {
    id: 'no-tests',
    expect: 1,
    files: {}
  }
];

function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-gate-' + c.id + '-'));
  try {
    for (const [name, body] of Object.entries(c.files)) {
      fs.writeFileSync(path.join(dir, name), body, 'utf8');
    }
    const run = spawnSync(process.execPath, [GATE, '--cwd', dir, '--glob', '*.test.js', '--quiet'], {
      encoding: 'utf8',
      timeout: 120000
    });
    return { id: c.id, expect: c.expect, actual: run.status, output: (run.stdout || '') + (run.stderr || '') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const rows = CASES.map(runCase);
  let failed = 0;
  for (const r of rows) {
    const ok = r.actual === r.expect;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(12)} 期望 exit=${r.expect} 实际 exit=${r.actual}`);
    if (!ok) console.log('  --- 输出 ---\n' + r.output.split('\n').slice(-20).join('\n'));
  }
  console.log(`\n门禁自检: ${failed === 0 ? 'PASS' : 'FAIL'}（${rows.length - failed}/${rows.length}）`);
  return failed === 0 ? 0 : 1;
}

process.exit(main());
