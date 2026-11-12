'use strict';
// xsum 验收测试（黑盒，只通过 CLI 表面断言）
//
// 这份文件在两组的执行期间不可见，也不允许被修改。
// 它的 SHA-256 在 M7-1-protocol.md 中预注册。
//
// 运行：ARM_DIR=<arm 目录> node --test acceptance.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ARM = process.env.ARM_DIR;
if (!ARM) throw new Error('必须设置 ARM_DIR');
const FIX = path.resolve(__dirname, '..', 'fixtures');
const CLI = path.join(ARM, 'bin', 'xsum.js');
const JAN = path.join(FIX, 'jan.csv');
const FEB = path.join(FIX, 'feb.jsonl');
const RATES = path.join(FIX, 'rates.json');
const RATES_BASE = path.join(FIX, 'rates-base.json');

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || ARM,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function json(args, opts) {
  const r = run(args, opts);
  let j = null;
  try { j = JSON.parse(r.out); } catch (_) { /* 留空，由断言报错 */ }
  return { ...r, j };
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xsum-acc-'));
}

test('A1 默认聚合：rows 与 stats 精确', () => {
  const r = json(['--rates', RATES, JAN, FEB]);
  assert.equal(r.code, 2, '有行级错误时退出码必须是 2');
  assert.ok(r.j, 'stdout 必须是合法 JSON');
  assert.equal(r.j.target, 'CNY');
  assert.deepEqual(r.j.rows, [
    { month: '2026-01', category: 'books', total: 24000, count: 1 },
    { month: '2026-01', category: 'food', total: -4000, count: 2 },
    { month: '2026-01', category: 'transport', total: 5050, count: 1 },
    { month: '2026-02', category: 'books', total: 4900, count: 1 },
    { month: '2026-02', category: 'food', total: 2034, count: 2 },
  ]);
  assert.deepEqual(r.j.stats, { files: 2, records: 11, duplicates: 1, invalid: 3, skipped_rate: 1 });
});

test('A2 行级错误：三类错误、按 file/line 升序', () => {
  const r = json(['--rates', RATES, JAN, FEB]);
  assert.ok(r.j);
  assert.deepEqual(r.j.errors.map((e) => e.code), ['E_DATE', 'E_AMOUNT', 'E_RATE']);
  const lines = r.j.errors.map((e) => e.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  for (const e of r.j.errors) assert.ok(e.file && e.message, '错误项要带 file 与 message');
});

test('A3 去重：同 id 保留第一条，其余只计数', () => {
  const r = json(['--rates', RATES, JAN]);
  assert.ok(r.j);
  assert.equal(r.j.stats.duplicates, 1);
  const food = r.j.rows.find((x) => x.month === '2026-01' && x.category === 'food');
  assert.deepEqual(food, { month: '2026-01', category: 'food', total: -4000, count: 2 },
    '被去重的那条 999.00 不能进合计');
  assert.equal(r.code, 0, 'jan.csv 没有行级错误');
});

test('A4 排序：month 升序、再按分组键码点升序', () => {
  const r = json(['--rates', RATES, JAN, FEB]);
  assert.ok(r.j);
  const keys = r.j.rows.map((x) => `${x.month}/${x.category}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('A5 过滤：since/until 闭区间，stats 不受过滤影响', () => {
  const r = json(['--rates', RATES, '--since', '2026-01-15', '--until', '2026-01-31', JAN, FEB]);
  assert.ok(r.j);
  assert.deepEqual(r.j.rows, [
    { month: '2026-01', category: 'books', total: 24000, count: 1 },
    { month: '2026-01', category: 'food', total: -14000, count: 1 },
  ]);
  assert.equal(r.j.stats.records, 11);
  assert.equal(r.j.stats.invalid, 3);
});

test('A6 --top：每月按 abs(total) 取前 N', () => {
  const r = json(['--rates', RATES, '--top', '1', JAN, FEB]);
  assert.ok(r.j);
  assert.deepEqual(r.j.rows, [
    { month: '2026-01', category: 'books', total: 24000, count: 1 },
    { month: '2026-02', category: 'books', total: 4900, count: 1 },
  ]);
});

test('A7 CSV：表头、整数分、末尾换行', () => {
  const r = run(['--rates', RATES, '--format', 'csv', JAN, FEB]);
  assert.equal(r.out,
    'month,category,total,count\n' +
    '2026-01,books,24000,1\n' +
    '2026-01,food,-4000,2\n' +
    '2026-01,transport,5050,1\n' +
    '2026-02,books,4900,1\n' +
    '2026-02,food,2034,2\n');
  assert.equal(r.code, 2);
});

test('A8 --out：写文件、stdout 不输出、内容与 stdout 模式一致', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'out.json');
  const r = run(['--rates', RATES, '--out', out, JAN, FEB]);
  assert.equal(r.out.trim(), '', '--out 时 stdout 应为空');
  const direct = json(['--rates', RATES, JAN, FEB]);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), direct.j);
  assert.equal(r.code, 2);
});

test('A9 幂等：重复运行逐字节一致', () => {
  const dir = tmpdir();
  const a = path.join(dir, 'a.json');
  const b = path.join(dir, 'b.json');
  run(['--rates', RATES, '--out', a, JAN, FEB]);
  run(['--rates', RATES, '--out', b, JAN, FEB]);
  assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
});

test('A10 --dry-run：只输出计数，不写文件', () => {
  const dir = tmpdir();
  const out = path.join(dir, 'never.json');
  const r = json(['--rates', RATES, '--dry-run', '--out', out, JAN, FEB]);
  assert.ok(r.j);
  assert.deepEqual(r.j, { records: 11, duplicates: 1, invalid: 3, would_write: true });
  assert.equal(fs.existsSync(out), false);
  assert.equal(r.code, 2);
});

test('A11 参数错误：--top 0 / --since 非法 / 无输入文件', () => {
  for (const args of [
    ['--rates', RATES, '--top', '0', JAN],
    ['--rates', RATES, '--since', '2026-13-01', JAN],
    ['--rates', RATES],
  ]) {
    const r = run(args);
    assert.equal(r.code, 1, `应致命退出：${args.join(' ')}`);
    assert.match(r.err, /E_ARGS/, `stderr 应含 E_ARGS：${args.join(' ')}`);
  }
});

test('A12 未知扩展名 → E_FORMAT；文件缺失 → E_FILE', () => {
  const dir = tmpdir();
  const txt = path.join(dir, 'x.txt');
  fs.writeFileSync(txt, 'a\n');
  const r1 = run(['--rates', RATES, txt]);
  assert.equal(r1.code, 1);
  assert.match(r1.err, /E_FORMAT/);

  const r2 = run(['--rates', RATES, path.join(dir, 'nope.csv')]);
  assert.equal(r2.code, 1);
  assert.match(r2.err, /E_FILE/);
});

test('C1 CR1：--group-by currency 的 JSON 与 CSV 表头', () => {
  const r = json(['--rates', RATES, '--group-by', 'currency', JAN, FEB]);
  assert.ok(r.j);
  assert.deepEqual(r.j.rows, [
    { month: '2026-01', currency: 'CNY', total: 15050, count: 2 },
    { month: '2026-01', currency: 'EUR', total: 24000, count: 1 },
    { month: '2026-01', currency: 'USD', total: -14000, count: 1 },
    { month: '2026-02', currency: 'CNY', total: 2034, count: 2 },
    { month: '2026-02', currency: 'USD', total: 4900, count: 1 },
  ]);
  const c = run(['--rates', RATES, '--group-by', 'currency', '--format', 'csv', JAN, FEB]);
  assert.match(c.out, /^month,currency,total,count\n/);
});

test('C2 CR1：--group-by 非法值 → E_ARGS', () => {
  const r = run(['--rates', RATES, '--group-by', 'month', JAN]);
  assert.equal(r.code, 1);
  assert.match(r.err, /E_ARGS/);
});

test('C3 CR2：带基准汇率 + 非 CNY 目标', () => {
  const r = json(['--rates', RATES_BASE, '--target', 'EUR', JAN, FEB]);
  assert.ok(r.j);
  assert.equal(r.j.target, 'EUR');
  assert.deepEqual(r.j.rows, [
    { month: '2026-01', category: 'books', total: 3000, count: 1 },
    { month: '2026-01', category: 'food', total: -500, count: 2 },
    { month: '2026-01', category: 'transport', total: 631, count: 1 },
    { month: '2026-02', category: 'books', total: 613, count: 1 },
    { month: '2026-02', category: 'food', total: 254, count: 2 },
  ]);
});

test('C4 CR2：扁平格式下非 CNY 目标仍被拒', () => {
  const r = run(['--rates', RATES, '--target', 'EUR', JAN]);
  assert.equal(r.code, 1);
  assert.match(r.err, /E_RATES_BASE/);
});

test('C5 CR2：rates[base] != 1 → E_RATES', () => {
  const dir = tmpdir();
  const bad = path.join(dir, 'bad-rates.json');
  fs.writeFileSync(bad, JSON.stringify({ base: 'USD', rates: { CNY: 7 } }));
  const r = run(['--rates', bad, '--target', 'CNY', JAN]);
  assert.equal(r.code, 1);
  assert.match(r.err, /E_RATES/);
});

test('C6 CR2：S == T 走同一路径；base 文件 target CNY 与扁平格式结果一致', () => {
  const a = json(['--rates', RATES, JAN, FEB]);
  const b = json(['--rates', RATES_BASE, '--target', 'CNY', JAN, FEB]);
  assert.ok(a.j && b.j);
  assert.deepEqual(b.j.rows, a.j.rows);
  assert.deepEqual(b.j.stats, a.j.stats);
});

test('C7 CR2：舍入为四舍五入、负数远离零', () => {
  const dir = tmpdir();
  const csv = path.join(dir, 'r.csv');
  fs.writeFileSync(csv,
    'id,date,amount,currency,category\n' +
    'r1,2026-03-01,0.01,CNY,pos\n' +
    'r2,2026-03-02,-0.01,CNY,neg\n');
  const rates = path.join(dir, 'r.json');
  fs.writeFileSync(rates, JSON.stringify({ base: 'USD', rates: { USD: 1, CNY: 2.0 } }));
  const r = json(['--rates', rates, '--target', 'USD', csv]);
  assert.ok(r.j);
  assert.deepEqual(r.j.rows, [
    { month: '2026-03', category: 'neg', total: -1, count: 1 },
    { month: '2026-03', category: 'pos', total: 1, count: 1 },
  ]);
});
