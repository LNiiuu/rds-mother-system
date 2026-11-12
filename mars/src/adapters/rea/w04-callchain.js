'use strict';
// W-04 调用链分析（M14-4）。
//
// 从 objdump 的反汇编里抽 call 指令，构建**静态**调用图。
//
// 剥离二进制（系统程序基本都是）没有函数符号，因此这里用一条明确写出来的启发式：
//   函数边界 = {入口地址} ∪ {直接 call 的目标地址} ∪ {显式符号}
//   每条 call 归属于「地址不大于它的最近一个函数边界」
// 因此结果是"按调用目标推断出的函数图"，不是编译器产出的符号图。
// 这一点必须在结果和报告里写明，否则会被误读成精确的符号级调用链。
//
// 不做的事：不解析间接调用（IAT/寄存器）的目标。猜出来的调用链比没有更危险。

const fs = require('node:fs');
const path = require('node:path');
const { run, probe } = require('./tools');
const { sha256File, commandRecord } = require('./evidence');

const MAX_DISASM_BYTES = 96 * 1024 * 1024;
const MAX_INSTRUCTIONS = 400000;

function normAddr(a) {
  return String(a).toLowerCase().replace(/^0x/, '').replace(/^0+/, '');
}

/**
 * 解析 objdump -d。
 * @returns {{calls:Array, indirect:Array, labels:Map, instructionCount:number}}
 */
function parseDisassembly(text) {
  const labels = new Map();
  const calls = [];
  const indirect = [];
  let count = 0;

  const labelRe = /^([0-9a-fA-F]+)\s+<([^>]+)>:\s*$/;
  const insnRe = /^\s*([0-9a-fA-F]+):\s+(?:[0-9a-fA-F]{2}\s+)+\s*(.*)$/;
  const directRe = /^\bcall[a-z]*\s+(0x[0-9a-fA-F]+)\s*(?:<([^>]+)>)?/;
  const indirectRe = /^\bcall[a-z]*\s+\*/;

  for (const line of text.split(/\r?\n/)) {
    const label = labelRe.exec(line);
    if (label) {
      labels.set(normAddr(label[1]), label[2]);
      continue;
    }
    const insn = insnRe.exec(line);
    if (!insn) continue;
    count += 1;
    if (count > MAX_INSTRUCTIONS) break;
    const at = normAddr(insn[1]);
    const mnemonic = insn[2];
    const direct = directRe.exec(mnemonic);
    if (direct) {
      calls.push({ at, to: normAddr(direct[1]), to_name: direct[2] || null });
      continue;
    }
    if (indirectRe.test(mnemonic)) {
      const via = /#\s*(0x[0-9a-fA-F]+)/.exec(mnemonic);
      indirect.push({ at, via_iat: via ? via[1] : null });
    }
  }
  return { calls, indirect, labels, instructionCount: count };
}

/** 地址比较（按 BigInt 处理，PE 地址可能超过 2^53）。 */
function cmpAddr(a, b) {
  const A = BigInt('0x' + a);
  const B = BigInt('0x' + b);
  return A < B ? -1 : A > B ? 1 : 0;
}

/**
 * 从解析结果构建函数级图。
 * @param {object} parsed
 * @param {string} entryAddr 入口（十六进制，无前缀）
 * @param {number} maxDepth
 */
function buildGraph(parsed, entryAddr, maxDepth) {
  const boundaries = new Set();
  if (entryAddr) boundaries.add(entryAddr);
  for (const c of parsed.calls) boundaries.add(c.to);
  for (const a of parsed.labels.keys()) boundaries.add(a);

  const sorted = [...boundaries].sort(cmpAddr);
  const nameOf = (addr) => parsed.labels.get(addr) || ('sub_' + addr);

  function ownerOf(addr) {
    let lo = 0;
    let hi = sorted.length - 1;
    let ans = sorted[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cmpAddr(sorted[mid], addr) <= 0) { ans = sorted[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  const adj = new Map();
  const outDegree = new Map();
  const seenEdge = new Set();
  let attributed = 0;
  for (const c of parsed.calls) {
    const from = ownerOf(c.at);
    const key = from + '>' + c.to;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ from, from_name: nameOf(from), to: c.to, to_name: nameOf(c.to) });
    outDegree.set(from, (outDegree.get(from) || 0) + 1);
    attributed += 1;
  }

  const levels = [];
  const seen = new Set();
  let frontier = entryAddr ? [entryAddr] : [];
  if (entryAddr) seen.add(entryAddr);
  for (let d = 0; d <= maxDepth && frontier.length; d += 1) {
    const next = [];
    const levelEdges = [];
    for (const node of frontier) {
      for (const e of adj.get(node) || []) {
        levelEdges.push(e);
        if (!seen.has(e.to)) { seen.add(e.to); next.push(e.to); }
      }
    }
    levels.push({ depth: d, nodes: frontier, edges: levelEdges });
    frontier = next;
  }

  const hot = [...outDegree.entries()]
    .map(([addr, n]) => ({ address: '0x' + addr, name: nameOf(addr), calls: n }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 15);

  return { functions: boundaries.size, edges: attributed, adjacency: adj, levels, reached: seen.size, hot, nameOf };
}

const workflow = {
  workflow_id: 'W-04',
  title: '调用链分析（静态）',
  engine: 'binutils',
  completeness: 'partial',
  requires: ['objdump'],

  input_schema: {
    type: 'object',
    properties: {
      sample: { type: 'string', description: '二进制绝对路径' },
      entry: { type: 'string', description: '起始函数地址（十六进制）或符号名；省略则用入口点' },
      depth: { type: 'number', description: '展开深度，默认 3' }
    },
    required: ['sample']
  },

  result_schema: {
    type: 'object',
    properties: {
      sample: { type: 'object' },
      entry: { type: 'object' },
      graph: { type: 'object' },
      levels: { type: 'array' },
      hot_functions: { type: 'array' },
      inference: { type: 'object' }
    }
  },

  async preflight(input) {
    const checks = [];
    const objdump = (await probe(['objdump']))[0];
    checks.push({ check: 'objdump 可用', ok: objdump.present, detail: objdump.path || '未找到' });
    const sample = input && input.sample ? path.resolve(String(input.sample)) : null;
    const exists = Boolean(sample) && fs.existsSync(sample) && fs.statSync(sample).isFile();
    checks.push({ check: 'sample 存在', ok: exists, detail: sample || '(未提供)' });
    return {
      ok: objdump.present && exists, checks,
      blocked_reason: !objdump.present ? 'TOOL_MISSING:objdump' : (!exists ? 'SAMPLE_NOT_FOUND' : null),
      tools: [objdump]
    };
  },

  async execute(input, ctx = {}) {
    const sample = path.resolve(String(input.sample));
    const depth = Number(input.depth || 3);
    const objdump = ctx.objdumpPath || 'objdump';
    const hash = await sha256File(sample);
    const commands = [];

    const f = await run(objdump, ['-f', sample], { timeout: 30000 });
    commands.push(commandRecord(objdump, ['-f', sample], f));
    const startMatch = /start address (0x[0-9a-fA-F]+)/.exec(f.stdout);
    const startAddr = startMatch ? normAddr(startMatch[1]) : null;

    const d = await run(objdump, ['-d', sample], { timeout: 240000, maxBuffer: MAX_DISASM_BYTES });
    commands.push(commandRecord(objdump, ['-d', sample], { ok: d.ok, code: d.code, timed_out: d.timed_out }));

    if (!d.stdout) {
      return {
        result: {
          sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes },
          error: 'DISASSEMBLY_EMPTY',
          note: '未取得反汇编输出：可能被加壳、无代码段，或格式不受 objdump 支持'
        },
        tool_versions: [{ name: 'objdump', version: (await probe(['objdump']))[0].version }],
        commands,
        limitations: ['未取得反汇编输出，无法构建调用图'],
        sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes }
      };
    }

    const parsed = parseDisassembly(d.stdout);

    let entryAddr = null;
    let entrySource = null;
    if (input.entry) {
      const want = normAddr(String(input.entry));
      if (parsed.labels.has(want)) { entryAddr = want; entrySource = 'explicit-address'; }
      else {
        for (const [addr, name] of parsed.labels) {
          if (name.toLowerCase() === String(input.entry).toLowerCase()) { entryAddr = addr; entrySource = 'explicit-symbol'; break; }
        }
        if (!entryAddr && /^[0-9a-f]+$/.test(want)) { entryAddr = want; entrySource = 'explicit-address-unlabeled'; }
      }
    }
    if (!entryAddr && startAddr) { entryAddr = startAddr; entrySource = 'pe-start-address'; }

    const g = buildGraph(parsed, entryAddr, depth);
    const symbols = [...parsed.labels.entries()].filter(([a, n]) => !/^\./.test(n));
    const stripped = symbols.length === 0;

    const result = {
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes },
      entry: entryAddr ? { address: '0x' + entryAddr, name: g.nameOf(entryAddr), source: entrySource } : null,
      graph: {
        functions: g.functions,
        direct_edges: g.edges,
        indirect_call_sites: parsed.indirect.length,
        instructions_scanned: parsed.instructionCount,
        reachable_from_entry: g.reached,
        stripped_like: stripped,
        symbol_count: symbols.length
      },
      levels: g.levels.map((l) => ({
        depth: l.depth,
        nodes: l.nodes.map((a) => ({ address: '0x' + a, name: g.nameOf(a) })),
        edges: l.edges.slice(0, 100).map((e) => ({ from: e.from_name, to: e.to_name }))
      })),
      hot_functions: g.hot,
      inference: {
        kind: 'static-disassembly',
        what_this_is: '从 objdump -d 的直接 call 指令读出的调用关系；函数边界按「调用目标 + 入口」推断',
        what_this_is_not: '不是运行时实测；间接调用（IAT/寄存器）只计数不解析；剥离二进制的函数边界是启发式，不等于编译器符号',
        boundary_rule: '函数边界 = {入口} ∪ {直接 call 目标} ∪ {显式符号}；每条 call 归属于地址不大于它的最近边界',
        indirect_calls_not_resolved: parsed.indirect.slice(0, 20)
      }
    };

    return {
      result,
      tool_versions: [{ name: 'objdump', version: (await probe(['objdump']))[0].version, path: objdump }],
      commands,
      limitations: ['只解析直接 call；间接调用只计数', '剥离二进制用启发式划分函数边界', '未做跨模块（DLL）解析'],
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes }
    };
  },

  render(result) {
    const L = [];
    L.push('# W-04 调用链分析（静态）');
    L.push('');
    L.push(`样本：\`${result.sample.path}\``);
    L.push('');
    if (result.error) {
      L.push(`**无法分析**：${result.error} — ${result.note}`);
      return L.join('\n') + '\n';
    }
    L.push(`- SHA-256：\`${result.sample.sha256}\``);
    L.push(`- 函数（推断边界）：${result.graph.functions}`);
    L.push(`- 直接调用边：${result.graph.direct_edges}`);
    L.push(`- 间接调用点：${result.graph.indirect_call_sites}（未解析目标）`);
    L.push(`- 扫描指令：${result.graph.instructions_scanned}`);
    L.push(`- 入口：${result.entry ? `\`${result.entry.name}\` @ ${result.entry.address}（${result.entry.source}）` : '未确定'}`);
    L.push(`- 从入口可达：${result.graph.reachable_from_entry} 个函数`);
    L.push('');
    for (const lv of result.levels) {
      L.push(`## 第 ${lv.depth} 层（${lv.nodes.length} 个函数）`);
      L.push('');
      L.push(lv.nodes.slice(0, 30).map((n) => `- \`${n.name}\``).join('\n') || '（无）');
      if (lv.edges.length) {
        L.push('');
        L.push('调用：' + lv.edges.slice(0, 25).map((e) => `${e.from} → ${e.to}`).join('；'));
      }
      L.push('');
    }
    L.push('## 扇出最高的函数');
    L.push('');
    L.push('| 函数 | 直接调用数 |');
    L.push('|---|---:|');
    for (const h of result.hot_functions) L.push(`| \`${h.name}\` | ${h.calls} |`);
    L.push('');
    L.push('## 这是推断，不是实测');
    L.push('');
    L.push(`- ${result.inference.what_this_is}`);
    L.push(`- ${result.inference.what_this_is_not}`);
    L.push(`- 边界规则：${result.inference.boundary_rule}`);
    return L.join('\n') + '\n';
  }
};

module.exports = workflow;
module.exports.parseDisassembly = parseDisassembly;
module.exports.buildGraph = buildGraph;
