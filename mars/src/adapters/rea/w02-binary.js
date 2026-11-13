'use strict';
// W-02 原生二进制静态分析（M14-2）。
//
// 本环境没有 Ghidra（且 WSL 被安全策略封禁），因此本工作流用 binutils 做**可复核的
// 静态事实提取**：格式、架构、段、导入表、符号、字符串、入口。
//
// 能力边界必须写在结果里：
//   能做：结构、导入导出、字符串、符号、反汇编片段（W-04）
//   不能做：反编译伪代码、类型恢复、xref 全图 —— 那需要 Ghidra/IDA，本环境不可用
// 因此 status 是 partial 而不是 full，且 result.capability 明确列出缺失项。

const fs = require('node:fs');
const path = require('node:path');
const { run, probe } = require('./tools');
const { sha256File, commandRecord } = require('./evidence');

const STRING_MIN = 6;
const MAX_STRINGS = 200000;

/** 从原始字节里提可打印字符串（不用外部 strings，保证跨平台一致）。 */
function extractStrings(buf, min = STRING_MIN) {
  const out = [];
  let cur = [];
  for (let i = 0; i < buf.length && out.length < MAX_STRINGS; i += 1) {
    const b = buf[i];
    if (b >= 0x20 && b <= 0x7e) {
      cur.push(b);
    } else {
      if (cur.length >= min) out.push(Buffer.from(cur).toString('latin1'));
      cur = [];
    }
  }
  if (cur.length >= min) out.push(Buffer.from(cur).toString('latin1'));
  return out;
}

function classifyString(s) {
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^HKEY_|^SOFTWARE\\\\|^SYSTEM\\\\/i.test(s)) return 'registry';
  if (/^[A-Za-z]:\\|^\\\\|^\/etc\/|^\/usr\//.test(s)) return 'path';
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) return 'ip';
  if (/\.(dll|exe|sys|ocx)$/i.test(s)) return 'module';
  if (/^[A-Z][A-Za-z ]{6,}$/.test(s) && s.split(' ').length >= 2) return 'message';
  return 'plain';
}

function parseFileHeader(text) {
  const out = {};
  const fmt = /file format (\S+)/.exec(text);
  if (fmt) out.format = fmt[1];
  const arch = /architecture: ([^,]+)/.exec(text);
  if (arch) out.architecture = arch[1].trim();
  const flags = /flags 0x[0-9a-f]+:([\s\S]*?)(?:\nstart address|$)/i.exec(text);
  if (flags) out.flags = flags[1].replace(/\s+/g, ' ').trim();
  const start = /start address (0x[0-9a-fA-F]+)/.exec(text);
  if (start) out.start_address = start[1];
  return out;
}

function parseSections(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+/.exec(line);
    if (m) {
      out.push({
        name: m[1],
        size: parseInt(m[2], 16),
        vma: '0x' + m[3].replace(/^0+/, ''),
        file_offset: '0x' + m[5].replace(/^0+/, '')
      });
    }
  }
  return out;
}

function parseImports(text) {
  const out = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const dll = /^\s*DLL Name:\s*(\S+)/.exec(line);
    if (dll) {
      current = { library: dll[1], symbols: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    // 形如 "	        42e0      1f7  GetCommandLineA"
    const sym = /^\s+[0-9a-f]+\s+(?:[0-9a-f]+|[A-Za-z]+)\s+(\S+)\s*$/.exec(line);
    if (sym) current.symbols.push(sym[1]);
    const idx = /^\s*\[\s*\d+\]/.test(line);
    if (idx) current = null;
  }
  return out;
}

function parseSymbols(text) {
  const named = [];
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{8,16})\s+(\S+)\s+(\S+)\s+(\S+)\s+([0-9a-fA-F]+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    total += 1;
    named.push({ address: '0x' + m[1].replace(/^0+/, ''), kind: m[3], section: m[4], name: m[6] });
  }
  return { total, named };
}

const workflow = {
  workflow_id: 'W-02',
  title: '原生二进制静态分析',
  engine: 'binutils',
  completeness: 'partial',
  requires: ['objdump'],

  input_schema: {
    type: 'object',
    properties: {
      sample: { type: 'string', description: '二进制绝对路径（只读）' },
      max_strings: { type: 'number', description: '最多提取多少条字符串，默认 5000' }
    },
    required: ['sample']
  },

  result_schema: {
    type: 'object',
    properties: {
      sample: { type: 'object' },
      file: { type: 'object' },
      sections: { type: 'array' },
      imports: { type: 'array' },
      exports_count: { type: 'number' },
      symbols: { type: 'object' },
      strings: { type: 'object' },
      capability: { type: 'object' }
    }
  },

  async preflight(input) {
    const checks = [];
    const tools = await probe(['objdump']);
    const objdump = tools[0];
    checks.push({ check: 'objdump 可用', ok: objdump.present, detail: objdump.path || '未在 PATH 中找到' });
    let ghidra = null;
    try { ghidra = await require('./tool-registry').detect('ghidra'); } catch { /* 可选工具 */ }
    checks.push({ check: 'Ghidra Headless 可用（可选，用于反编译）', ok: Boolean(ghidra && ghidra.present), detail: ghidra && ghidra.present ? `${ghidra.path} (${ghidra.version})` : '未安装；仅 binutils 结构/符号级分析' });
    const sample = input && input.sample ? path.resolve(String(input.sample)) : null;
    checks.push({ check: 'sample 已提供', ok: Boolean(sample) });
    if (!sample) return { ok: false, checks, blocked_reason: 'SAMPLE_REQUIRED', tools };
    const exists = fs.existsSync(sample) && fs.statSync(sample).isFile();
    checks.push({ check: 'sample 存在且是文件', ok: exists, detail: sample });
    return { ok: objdump.present && exists, checks, blocked_reason: !objdump.present ? 'TOOL_MISSING:objdump' : (!exists ? 'SAMPLE_NOT_FOUND' : null), tools: { objdump, ghidra } };
  },

  async execute(input, ctx = {}) {
    const sample = path.resolve(String(input.sample));
    const maxStrings = Number(input.max_strings || 5000);
    const objdump = ctx.objdumpPath || 'objdump';
    const commands = [];

    const hash = await sha256File(sample);
    let ghidra = null;
    try { ghidra = await require('./tool-registry').detect('ghidra'); } catch { /* 可选工具 */ }
    const ghidraStatus = ghidra ? { present: Boolean(ghidra.present), version: ghidra.version || null } : { present: false, version: null };

    const f = await run(objdump, ['-f', sample], { timeout: 30000 });
    commands.push(commandRecord(objdump, ['-f', sample], f));
    const file = parseFileHeader(f.stdout);

    const h = await run(objdump, ['-h', sample], { timeout: 60000 });
    commands.push(commandRecord(objdump, ['-h', sample], h));
    const sections = parseSections(h.stdout);

    const p = await run(objdump, ['-p', sample], { timeout: 60000 });
    commands.push(commandRecord(objdump, ['-p', sample], p));
    const imports = parseImports(p.stdout);
    const exportsMatch = /\[Ordinal\/Name Pointer\] Table[\s\S]*?^\[/m.exec(p.stdout);
    const exportsCount = imports.length
      ? Number((/Export Address Table[\s\S]{0,200}?(\d+)\s+exports/.exec(p.stdout) || [])[1] || 0)
      : 0;

    const t = await run(objdump, ['-t', sample], { timeout: 60000 });
    commands.push(commandRecord(objdump, ['-t', sample], t));
    const symbols = parseSymbols(t.stdout);

    const buf = fs.readFileSync(sample);
    const all = extractStrings(buf);
    const byKind = {};
    for (const s of all) {
      const k = classifyString(s);
      byKind[k] = (byKind[k] || 0) + 1;
    }
    const interesting = all
      .map((s) => ({ kind: classifyString(s), value: s.slice(0, 300) }))
      .filter((x) => x.kind !== 'plain')
      .slice(0, maxStrings);

    const result = {
      sample: { path: sample, bytes: hash.bytes, sha256: hash.sha256, kind: 'authorized-local-file' },
      file,
      sections,
      imports: imports.map((i) => ({ library: i.library, symbol_count: i.symbols.length, symbols: i.symbols.slice(0, 60) })),
      exports_count: exportsCount,
      symbols: { total: symbols.total, named: symbols.named.slice(0, 80) },
      strings: {
        total: all.length,
        by_kind: byKind,
        interesting: interesting.slice(0, 200)
      },
      // 能力声明：让读者知道"没做什么"
      capability: {
        done: ['文件格式与架构', '段表', '导入表（DLL + 符号）', '符号表', '字符串提取与分类', '入口地址'],
        not_done: ['反编译伪代码（需 Ghidra/IDA，本环境无）', '类型恢复', '完整 xref 图', '动态行为'],
        why_partial: '本环境无 Ghidra 且 WSL 被安全策略封禁；binutils 只能给出结构与符号级事实',
        ghidra: ghidraStatus
      },
      inference_notes: [
        'strings 的分类（url/registry/path/ip/module/message）是正则推断，可能误判',
        'imports 的符号列表被截断到 60 条，symbol_count 是完整计数'
      ]
    };

    return {
      result,
      tool_versions: [{ name: 'objdump', version: (await probe(['objdump']))[0].version, path: objdump, kind: 'external' }],
      commands,
      limitations: result.capability.not_done,
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: 'authorized-local-file' }
    };
  },

  render(result) {
    const L = [];
    L.push(`# W-02 原生二进制静态分析`);
    L.push('');
    L.push(`样本：\`${result.sample.path}\``);
    L.push('');
    L.push(`- 大小：${result.sample.bytes} B`);
    L.push(`- SHA-256：\`${result.sample.sha256}\``);
    L.push(`- 格式：${result.file.format || '?'} / ${result.file.architecture || '?'}`);
    L.push(`- 入口：${result.file.start_address || '?'}`);
    L.push('');
    L.push('## 段');
    L.push('');
    L.push('| 段 | 大小 | VMA |');
    L.push('|---|---:|---|');
    for (const s of result.sections.slice(0, 12)) L.push(`| ${s.name} | ${s.size} | ${s.vma} |`);
    L.push('');
    L.push('## 导入库');
    L.push('');
    for (const i of result.imports) L.push(`- **${i.library}** — ${i.symbol_count} 个符号`);
    L.push('');
    L.push(`## 符号\n\n总数 ${result.symbols.total}（列出前 ${result.symbols.named.length} 条）`);
    L.push('');
    L.push(`## 字符串\n\n共 ${result.strings.total} 条；分类：${Object.entries(result.strings.by_kind).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    L.push('');
    for (const s of result.strings.interesting.slice(0, 25)) L.push(`- \`[${s.kind}]\` ${s.value}`);
    L.push('');
    L.push('## 能力边界');
    L.push('');
    L.push(`**已做**：${result.capability.done.join('、')}`);
    L.push('');
    L.push(`**未做**：${result.capability.not_done.join('、')}`);
    L.push('');
    L.push(`原因：${result.capability.why_partial}`);
    return L.join('\n') + '\n';
  }
};

module.exports = workflow;
// 供测试直接验证解析逻辑（不依赖本机是否装了 objdump）
module.exports.parseFileHeader = parseFileHeader;
module.exports.parseSections = parseSections;
module.exports.parseImports = parseImports;
module.exports.parseSymbols = parseSymbols;
module.exports.extractStrings = extractStrings;
module.exports.classifyString = classifyString;
