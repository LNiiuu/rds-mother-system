'use strict';
// M8 / B2：上下文包必须能携带任务正文，并且不再重复序列化内容。
//
// 守三件事：
//   1. --task-file 的任务正文原样进入 sec_task（不再只有「任务: ID」）；
//   2. Markdown 格式可读、且比同一份包的 JSON 更小；
//   3. --out 的 budget 只剩摘要，--no-manifest 能进一步去掉清单。

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(REPO, 'bin', 'rds.mjs');
const MARKER = '本节是任务正文的唯一标记：ALPHA-7731。实现时必须逐条满足下面的规则。';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-packet-'));
  const env = {
    ...process.env,
    MARS_DB: path.join(dir, 'mars.db'),
    MARS_PRINCIPALS: path.join(dir, 'principals.json'),
  };
  delete env.MARS_TOKEN;
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: REPO, encoding: 'utf8', env });
  assert.equal(run(['init']).status, 0);
  const created = run(['init-dev', '--principal', 'p-r0', '--projects', 'demo', '--roles', 'R0']);
  assert.equal(created.status, 0, created.stderr);
  const token = (created.stdout.match(/^DEV_TOKEN=([0-9a-f]{48})$/m) || [])[1];
  assert.ok(token);
  env.MARS_TOKEN = token;
  assert.equal(run(['project', 'register', '--project', 'demo', '--name', 'Demo', '--policy', 'default']).status, 0);

  const taskFile = path.join(dir, 'TASK.md');
  fs.writeFileSync(taskFile, `# 任务\n\n${MARKER}\n\n## 规则\n\n- 金额用整数分\n- 输出按月排序\n`);
  return { dir, env, run, taskFile };
}

function compile(box, extra) {
  return box.run(['compile', '--project', 'demo', '--task', 'T-1', ...extra]);
}

test('B2 任务正文进入 sec_task，且不再报 task_text 缺失', () => {
  const box = setup();
  const out = path.join(box.dir, 'packet.json');
  const r = compile(box, ['--task-file', box.taskFile, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
  const task = bundle.packet.sections.find((s) => s.kind === 'task');
  assert.match(task.content, /ALPHA-7731/, '任务正文必须原样进包');
  assert.match(task.content, /金额用整数分/, '正文里的规则不能丢');
  assert.ok(!bundle.packet.missing.some((m) => m.kind === 'task_text'), '有正文就不该报缺失');
});

test('B2 不传任务正文时，明确给出非阻塞缺失项', () => {
  const box = setup();
  const out = path.join(box.dir, 'packet.json');
  const r = compile(box, ['--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const packet = JSON.parse(fs.readFileSync(out, 'utf8')).packet;
  const miss = packet.missing.find((m) => m.kind === 'task_text');
  assert.ok(miss, '缺正文必须显式提示');
  assert.equal(miss.blocking, false, '缺正文是提示，不是硬失败');
});

test('B2 Markdown 包：可读、含正文、比同包 JSON 小', () => {
  const box = setup();
  const md = path.join(box.dir, 'packet.md');
  const js = path.join(box.dir, 'packet.json');
  assert.equal(compile(box, ['--task-file', box.taskFile, '--format', 'md', '--out', md]).status, 0);
  assert.equal(compile(box, ['--task-file', box.taskFile, '--out', js]).status, 0);

  const text = fs.readFileSync(md, 'utf8');
  assert.match(text, /^# 上下文包：T-1/);
  assert.match(text, /## 任务要求/);
  assert.match(text, /ALPHA-7731/);
  assert.ok(!text.includes('"packet_id"'), 'Markdown 里不该再有 JSON 字段名');
  assert.ok(fs.statSync(md).size < fs.statSync(js).size, 'Markdown 应比 JSON 小');
});

test('B2 --out 的 budget 只保留摘要，不再复制 sections', () => {
  const box = setup();
  const out = path.join(box.dir, 'packet.json');
  assert.equal(compile(box, ['--task-file', box.taskFile, '--out', out]).status, 0);
  const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(bundle.budget).sort(), ['over_budget', 'protected_kept', 'tokens', 'truncated']);
  assert.ok(!('sections' in bundle.budget), 'budget 不得再复制 sections');
  assert.ok(bundle.packet.sections.length > 0);
  assert.equal(bundle.budget.tokens, bundle.packet.tokens_estimated);
});

test('B2 --no-manifest：省略清单但保留 manifest_id 可追溯', () => {
  const box = setup();
  const out = path.join(box.dir, 'packet.json');
  assert.equal(compile(box, ['--task-file', box.taskFile, '--no-manifest', '--out', out]).status, 0);
  const bundle = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(bundle).sort(), ['budget', 'packet']);
  assert.match(bundle.packet.manifest_id, /^man_[0-9a-f]{12}$/);
});

test('B2 默认 stdout 仍是 packet 本体（兼容旧用法）', () => {
  const box = setup();
  const r = compile(box, ['--task-file', box.taskFile]);
  assert.equal(r.status, 0, r.stderr);
  const packet = JSON.parse(r.stdout);
  assert.match(packet.packet_id, /^pkt_[0-9a-f]{12}$/);
  assert.ok(Array.isArray(packet.sections));
  assert.ok(!('packet' in packet), 'stdout 不应变成 {packet,manifest} 包装');
});

test('B2 未知格式：明确报错，不产出半成品', () => {
  const box = setup();
  const out = path.join(box.dir, 'packet.xml');
  const r = compile(box, ['--task-file', box.taskFile, '--format', 'xml', '--out', out]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--format/);
  assert.equal(fs.existsSync(out), false);
});
