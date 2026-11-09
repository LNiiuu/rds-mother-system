'use strict';
// 文档一致性检查器自身的行为（M5 / B6）。
//
// 为什么值得给一个「检查脚本」写测试：如果它永远返回 0，它就是一个装饰品。
// 这组用例用 --root 指向临时目录，验证三件事：
//   1. 真实断链会被发现，退出码 1
//   2. 代码块里的「伪链接」不算断链（文档讲 Markdown 语法时会写出 [x](y)）
//   3. 页内锚点、http(s)、占位符不算断链
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO, 'tooling', 'docs-check.mjs');

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 60000 });
}

function withTree(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-docs-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('B6 docs-check：全部链接可达时退出 0', () => {
  withTree({
    'a.md': '[ok](b.md)\n',
    'b.md': '# b\n'
  }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DOCS PASS/);
  });
});

test('B6 docs-check：真实断链会被发现，指出文件与行号', () => {
  withTree({
    'a.md': '# a\n\n[bad](./missing.md)\n'
  }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /a\.md:3/);
    assert.match(r.stdout, /missing\.md/);
    assert.match(r.stdout, /DOCS FAIL/);
  });
});

test('B6 docs-check：代码块里的伪链接不算断链', () => {
  withTree({
    'a.md': [
      '# a',
      '',
      '行内示例：`[x](y.md)`',
      '',
      '```markdown',
      '[示例](not-exist.md)',
      '```',
      '',
      '上面的 `[x](y.md)` 在围栏外但被行内代码包住。',
      ''
    ].join('\n')
  }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

test('B6 docs-check：http(s)、锚点、占位符不算断链', () => {
  withTree({
    'a.md': [
      '# a',
      '',
      '[外链](https://example.com/x)',
      '[锚点](#section)',
      '[占位](<PROJECT_ROOT>/x.md)',
      '[占位2](path/*.md)',
      ''
    ].join('\n')
  }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

test('B6 docs-check：带锚点的有效链接按文件部分校验', () => {
  withTree({
    'a.md': '[ok](b.md#anchor)\n',
    'b.md': '# b\n'
  }, (dir) => {
    assert.equal(run(dir).status, 0);
  });
});

test('B6 docs-check：--json 输出机器可读结果', () => {
  withTree({
    'a.md': '[bad](missing.md)\n'
  }, (dir) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, '--json'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.scanned, 1);
    assert.equal(j.files.length, 1);
    assert.equal(j.files[0].problems[0].kind, 'link');
  });
});

test('B6 docs-check：本仓库当前状态为通过', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, '仓库内存在不可达的相对链接：\n' + r.stdout);
  assert.match(r.stdout, /DOCS PASS/);
});
