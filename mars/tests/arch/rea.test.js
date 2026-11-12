'use strict';
// M14：REA 工作流 —— 接口契约、真实执行、阻塞判定、证据完整性。
//
// 这组测试只验证「工作流本身」的行为；跨引擎联合在 M15 的测试里。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('../phase1/helpers');
const registry = require('../../src/adapters/rea/registry');
const w02 = require('../../src/adapters/rea/w02-binary');
const w04 = require('../../src/adapters/rea/w04-callchain');
const w05 = require('../../src/adapters/rea/w05-pcap');
const { buildPcap } = require('../../../tooling/make-pcap-fixture.cjs');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

// ---------------------------------------------------------------- 接口契约

test('M14 注册表：六套工作流齐全，且都实现了统一接口', () => {
  const list = registry.all();
  assert.deepEqual(list.map((w) => w.workflow_id), ['W-01', 'W-02', 'W-03', 'W-04', 'W-05', 'W-06']);
  for (const w of list) {
    assert.ok(w.title, w.workflow_id + ' 缺 title');
    assert.ok(w.input_schema && w.input_schema.type === 'object', w.workflow_id + ' 缺 input_schema');
    assert.ok(w.result_schema && w.result_schema.type === 'object', w.workflow_id + ' 缺 result_schema');
    assert.ok(['full', 'partial'].includes(w.completeness), w.workflow_id + ' completeness 非法');
  }
  const wf = registry.get('w-01');
  assert.equal(wf.workflow_id, 'W-01', 'id 应大小写不敏感');
  assert.throws(() => registry.get('W-99'), /WORKFLOW_UNKNOWN/);
});

// ---------------------------------------------------------------- W-01

test('M14 W-01：真实扫描临时代码库，识别语言/入口/测试，并声明未做项', async () => {
  const root = tmp('rea-w01');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo-app', version: '1.0.0', main: 'src/index.js',
    scripts: { test: 'node --test' }, dependencies: { a: '1' }
  }));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(root, 'test', 'a.test.js'), "require('node:test')\n");
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo App\n\n说明\n');

  const pre = await registry.preflight('W-01', { root });
  assert.equal(pre.ok, true);

  const out = await registry.run(setup('rea-w01-run-').db, {
    workflow_id: 'W-01', input: { root }, evidenceBase: path.join(root, '..', 'rea-ev')
  });

  assert.equal(out.status, 'PARTIAL', 'W-01 声明为 partial，不能报 PASS');
  assert.equal(out.result.files_scanned, 4);
  assert.ok(out.result.languages.some((l) => l.name === 'JavaScript'));
  assert.ok(out.result.manifests.some((m) => m.name === 'demo-app'));
  assert.ok(out.result.entries.some((e) => e.path === 'src/index.js'));
  assert.equal(out.result.tests.files, 1);
  assert.ok(out.result.not_done.includes('模块间依赖关系图（需 AST 或 W-04）'));
  assert.ok(out.result.inference_notes.length > 0, '必须标明哪些是推断');
});

test('M14 W-01：根不存在时 preflight 拒绝并给出原因', async () => {
  const pre = await registry.preflight('W-01', { root: path.join(os.tmpdir(), 'no-such-root-xyz') });
  assert.equal(pre.ok, false);
  assert.equal(pre.blocked_reason, 'ROOT_NOT_FOUND');
  assert.ok(pre.checks.some((c) => c.check === 'root 存在' && c.ok === false));
});

// ---------------------------------------------------------------- W-05

test('M14 W-05：解析合成 pcap，协议/DNS/HTTP/启发式全部落地', async () => {
  const dir = tmp('rea-w05');
  const pcap = path.join(dir, 's.pcap');
  fs.writeFileSync(pcap, buildPcap());

  const out = await registry.run(setup('rea-w05-run-').db, {
    workflow_id: 'W-05', input: { sample: pcap, sample_kind: 'synthetic' }, evidenceBase: path.join(dir, 'ev')
  });

  assert.equal(out.status, 'PARTIAL');
  assert.equal(out.result.packets, 4);
  assert.equal(out.result.by_protocol.UDP, 2);
  assert.equal(out.result.by_protocol.TCP, 2);
  assert.equal(out.result.dns_queries.length, 2);
  assert.equal(out.result.http_requests.length, 1);
  assert.equal(out.result.http_requests[0].host, 'api.internal.test');
  assert.ok(out.result.heuristics.some((h) => h.rule === 'dns-long-label'));
  assert.equal(out.sample.kind, 'synthetic', '样本性质必须如实标注');
  assert.match(out.sample.sha256, /^[0-9a-f]{64}$/);
  // 证据三件套
  assert.ok(fs.existsSync(out.evidence_files.result));
  assert.ok(fs.existsSync(out.evidence_files.report));
  assert.ok(fs.existsSync(out.evidence_files.evidence));
  const ev = JSON.parse(fs.readFileSync(out.evidence_files.evidence, 'utf8'));
  assert.equal(ev.sample.sha256, out.sample.sha256);
  assert.ok(ev.reproduce.length >= 3, '证据里必须有复核步骤');
});

test('M14 W-05：pcapng 明确报 UNSUPPORTED_FORMAT，不猜', () => {
  const buf = Buffer.concat([Buffer.from([0x0a, 0x0d, 0x0d, 0x0a]), Buffer.alloc(60)]);
  const r = w05.analyzePcap(buf);
  assert.equal(r.error, 'UNSUPPORTED_FORMAT');
  assert.match(r.note, /pcapng/);
});

test('M14 W-05：非 pcap 输入报 UNSUPPORTED_FORMAT', () => {
  const r = w05.analyzePcap(Buffer.from('this is not a capture file at all'));
  assert.equal(r.error, 'UNSUPPORTED_FORMAT');
});

// ---------------------------------------------------------------- W-02 解析

test('M14 W-02：objdump 输出解析（格式/段/导入/符号/字符串分类）', () => {
  const header = [
    '',
    'C:/x/w.exe:     file format pei-x86-64',
    'architecture: i386:x86-64, flags 0x0000012f:',
    'HAS_RELOC, EXEC_P',
    'start address 0x0000000140001300',
    ''
  ].join('\n');
  const f = w02.parseFileHeader(header);
  assert.equal(f.format, 'pei-x86-64');
  assert.equal(f.architecture, 'i386:x86-64');
  assert.equal(f.start_address, '0x0000000140001300');

  const secText = [
    'Idx Name          Size      VMA               LMA               File off  Algn',
    '  0 .text         00008000  0000000140001000  0000000140001000  00000400  2**4'
  ].join('\n');
  const secs = w02.parseSections(secText);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].name, '.text');
  assert.equal(secs[0].size, 0x8000);

  const impText = [
    'The Import Tables (interpreted .idata section contents)',
    '	DLL Name: KERNEL32.dll',
    '	vma:  Hint/Ord Member-Name Bound-To',
    '	        42e0      1f7  GetCommandLineA',
    '	        42f0      1f8  GetStdHandle',
    '	DLL Name: USER32.dll',
    '	vma:  Hint/Ord Member-Name Bound-To',
    '	        4300       10  MessageBoxA'
  ].join('\n');
  const imports = w02.parseImports(impText);
  assert.deepEqual(imports.map((i) => i.library), ['KERNEL32.dll', 'USER32.dll']);
  assert.deepEqual(imports[0].symbols, ['GetCommandLineA', 'GetStdHandle']);

  const buf = Buffer.from('MZ\x00\x00http://evil.example/HKEY_LOCAL_MACHINE\\Software\x00\x01C:\\Windows\\x.dll\x00', 'latin1');
  const strs = w02.extractStrings(buf, 4);
  assert.ok(strs.some((s) => s.includes('http://')));
  assert.equal(w02.classifyString('http://a.b/c'), 'url');
  assert.equal(w02.classifyString('HKEY_LOCAL_MACHINE\\Software'), 'registry');
  assert.equal(w02.classifyString('C:\\Windows\\x.dll'), 'path');
  assert.equal(w02.classifyString('KERNEL32.dll'), 'module');
  assert.equal(w02.classifyString('普通文本不是 ASCII'), 'plain');
});

test('M14 W-02：样本不存在时 preflight 拒绝', async () => {
  const pre = await registry.preflight('W-02', { sample: path.join(os.tmpdir(), 'no-such-binary-xyz') });
  assert.equal(pre.ok, false);
  assert.equal(pre.blocked_reason, 'SAMPLE_NOT_FOUND');
});

// ---------------------------------------------------------------- W-04 图构建

test('M14 W-04：从反汇编构建调用图（含剥离二进制启发式）', () => {
  const asm = [
    '0000000140001000 <.text>:',
    '   140001000:\t55                   \tpush   %rbp',
    '   140001010:\te8 eb ff ff ff       \tcall   0x140001020',
    '   140001020:\te8 0b 00 00 00       \tcall   0x140001030',
    '   140001030:\tff 15 00 00 00 00    \tcall   *0x0(%rip)        # 0x14000a428',
    ''
  ].join('\n');
  const parsed = w04.parseDisassembly(asm);
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.indirect.length, 1);
  assert.equal(parsed.calls[0].to, '140001020');

  const g = w04.buildGraph(parsed, '140001010', 3);
  // 边界 = {.text 标签, 入口, 两个 call 目标}；.text 是 objdump 的分段标签，也算一个边界
  assert.equal(g.functions, 4, '边界 = {.text, 入口, 两个 call 目标}');
  assert.equal(g.edges, 2);
  assert.ok(g.reached >= 3);
  // 入口那一层应当直接调用 sub_140001020
  const level0 = g.levels[0];
  assert.equal(level0.nodes[0], '140001010');
  assert.ok(level0.edges.some((e) => e.to === '140001020'));
});

test('M14 W-04：空反汇编不崩，明确报 DISASSEMBLY_EMPTY', async () => {
  const dir = tmp('rea-w04-empty');
  const f = path.join(dir, 'empty.bin');
  fs.writeFileSync(f, Buffer.from('not a binary'));
  const out = await registry.run(setup('rea-w04-run-').db, {
    workflow_id: 'W-04', input: { sample: f }, evidenceBase: path.join(dir, 'ev')
  });
  // 没有 objdump 判 BLOCKED；有 objdump 但读不出反汇编判 FAILED/PARTIAL 带 error
  assert.ok(['BLOCKED', 'FAILED', 'PARTIAL'].includes(out.status));
  if (out.status !== 'BLOCKED') {
    assert.equal(out.result.error, 'DISASSEMBLY_EMPTY');
  }
});

// ---------------------------------------------------------------- 阻塞项

test('M14 W-03：缺 jadx 时 BLOCKED，但仍给出真实 ZIP 结构（或明确不是 APK）', async () => {
  const dir = tmp('rea-w03');
  const apk = path.join(dir, 'fake.apk');
  // 构造一个最小 zip：直接用 Compress-Archive 不可控，这里手写一个单条目 zip
  fs.writeFileSync(apk, buildMinimalZip({ 'classes.dex': Buffer.from('dex\n035\0', 'latin1') }));

  const out = await registry.run(setup('rea-w03-run-').db, {
    workflow_id: 'W-03', input: { sample: apk }, evidenceBase: path.join(dir, 'ev')
  });
  assert.equal(out.status, 'BLOCKED');
  assert.match(out.preflight.blocked_reason, /^TOOL_MISSING:jadx|^TOOL_MISSING:java$/);
  assert.ok(out.result.structure, 'BLOCKED 也要给出能确定的事实');
  assert.equal(out.result.structure.entries, 1);
  assert.ok(out.result.missing_capability.not_done.includes('DEX 反编译（Java/Kotlin 源码）'));
});

test('M14 W-06：无 frida 时 BLOCKED，且不提供模拟执行', async () => {
  const out = await registry.run(setup('rea-w06-run-').db, {
    workflow_id: 'W-06',
    input: { target: 'com.example', purpose: 'test', authorization: 'own-device' },
    evidenceBase: tmp('rea-w06-ev')
  });
  assert.equal(out.status, 'BLOCKED');
  assert.equal(out.preflight.blocked_reason, 'TOOL_MISSING:frida');
  assert.equal(out.result.result, undefined, '不应有执行结果');
});

test('M14 W-06：授权声明缺失时先拦授权，不先怪工具', async () => {
  const pre = await registry.preflight('W-06', { target: 'x', purpose: 'y' });
  assert.equal(pre.ok, false);
  assert.equal(pre.blocked_reason, 'AUTHORIZATION_REQUIRED');
});

// ---------------------------------------------------------------- 落库

test('M14 落库：每次执行写 rea_runs，含样本哈希与工具版本', async () => {
  const env = setup('rea-db-');
  const dir = tmp('rea-db-files');
  const pcap = path.join(dir, 'x.pcap');
  fs.writeFileSync(pcap, buildPcap());

  const out = await registry.run(env.db, {
    workflow_id: 'W-05', input: { sample: pcap, sample_kind: 'synthetic' }, evidenceBase: path.join(dir, 'ev')
  });
  const row = registry.getRun(env.db, out.rea_run_id);
  assert.equal(row.workflow_id, 'W-05');
  assert.equal(row.status, 'PARTIAL');
  assert.equal(row.sample_sha256, out.sample.sha256);
  assert.ok(row.tool_versions.length >= 1);
  assert.equal(row.sample_kind, 'synthetic');

  const runs = registry.listRuns(env.db, { workflow_id: 'W-05' });
  assert.equal(runs.length, 1);
});

// ---------------------------------------------------------------- 工具：最小 zip

/** 构造一个 store（不压缩）方式的最小 ZIP，用于确定性测试。 */
function buildMinimalZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
