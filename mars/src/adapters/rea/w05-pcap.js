'use strict';
// W-05 PCAP 流量分析（M14-5）。
//
// 历史状态是 BLOCKED：当时 `.pcap` 路径被 agent 侧安全策略整条拦下（规则 secret.ext.pcap），
// 属工具层拦截，不是能力缺失。本工作流把「解析能力」做成纯 JS 实现，
// 不再依赖 tshark —— 本环境也没有 tshark。
//
// 诚实边界：
//   - 只解析 libpcap（.pcap）。pcapng 会明确报 UNSUPPORTED_FORMAT，不猜。
//   - TLS 只识别 ClientHello，**不解密内容**，也不解析 SNI。
//   - 「可疑」是启发式，带明确阈值，不是判决。

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./evidence');

const MAGICS = [
  { bytes: [0xd4, 0xc3, 0xb2, 0xa1], endian: 'le', nano: false },
  { bytes: [0xa1, 0xb2, 0xc3, 0xd4], endian: 'be', nano: false },
  { bytes: [0x4d, 0x3c, 0xb2, 0xa1], endian: 'le', nano: true },
  { bytes: [0xa1, 0xb2, 0x3c, 0x4d], endian: 'be', nano: true }
];

const IP_PROTO = { 1: 'ICMP', 6: 'TCP', 17: 'UDP', 58: 'ICMPv6' };

function detectMagic(buf) {
  if (buf.length < 24) return null;
  for (const m of MAGICS) {
    if (m.bytes.every((b, i) => buf[i] === b)) return m;
  }
  // pcapng: 0a0d0d0a
  if (buf[0] === 0x0a && buf[1] === 0x0d && buf[2] === 0x0d && buf[3] === 0x0a) return { pcapng: true };
  return null;
}

function ipToString(bytes, offset) {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

/** 解析 DNS 问题段的 qname。 */
function parseDnsQname(payload, offset) {
  const labels = [];
  let i = offset;
  let guard = 0;
  while (i < payload.length && guard < 128) {
    const len = payload[i];
    if (len === 0) { i += 1; break; }
    if (len > 63) return { name: null, next: i, malformed: true };
    labels.push(payload.slice(i + 1, i + 1 + len).toString('latin1'));
    i += 1 + len;
    guard += 1;
  }
  return { name: labels.join('.'), next: i, malformed: false };
}

function parseTcp(payload, state) {
  if (payload.length < 20) return null;
  const sport = payload.readUInt16BE(0);
  const dport = payload.readUInt16BE(2);
  const dataOffset = (payload[12] >> 4) * 4;
  const flags = payload[13];
  return { sport, dport, flags, payload: payload.slice(dataOffset), header_len: dataOffset };
}

function parseUdp(payload) {
  if (payload.length < 8) return null;
  return { sport: payload.readUInt16BE(0), dport: payload.readUInt16BE(2), payload: payload.slice(8) };
}

/**
 * 分析一段 pcap 字节。
 * @returns {object} 结构化结果
 */
function analyzePcap(buf) {
  const magic = detectMagic(buf);
  if (!magic) return { error: 'UNSUPPORTED_FORMAT', note: '不是 libpcap 文件（magic 不匹配）' };
  if (magic.pcapng) return { error: 'UNSUPPORTED_FORMAT', note: 'pcapng 未实现解析；请转成 libpcap 后重试' };

  const le = magic.endian === 'le';
  const rd16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const rd32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));

  const linkType = rd32(buf, 20);
  const packets = [];
  let off = 24;
  let index = 0;
  while (off + 16 <= buf.length && index < 200000) {
    const tsSec = rd32(buf, off);
    const tsFrac = rd32(buf, off + 4);
    const inclLen = rd32(buf, off + 8);
    const origLen = rd32(buf, off + 12);
    off += 16;
    if (inclLen === 0 || off + inclLen > buf.length) break;
    packets.push({ index, ts: tsSec + tsFrac / (magic.nano ? 1e9 : 1e6), incl_len: inclLen, orig_len: origLen, data: buf.slice(off, off + inclLen) });
    off += inclLen;
    index += 1;
  }

  const stats = {
    packets: packets.length,
    bytes: packets.reduce((a, p) => a + p.orig_len, 0),
    by_protocol: {},
    conversations: new Map(),
    ports: new Map(),
    dns_queries: [],
    http_requests: [],
    tls_client_hellos: 0,
    arp: 0,
    ipv6: 0,
    other: 0
  };

  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const p of packets) {
    let frame = p.data;
    let ethertype = null;
    if (linkType === 1) {
      if (frame.length < 14) { stats.other += 1; continue; }
      ethertype = frame.readUInt16BE(12);
      frame = frame.slice(14);
    } else if (linkType === 101 || linkType === 228) {
      ethertype = 0x0800; // raw IP
    } else {
      stats.other += 1;
      continue;
    }

    if (ethertype === 0x0806) { stats.arp += 1; stats.by_protocol.ARP = (stats.by_protocol.ARP || 0) + 1; continue; }
    if (ethertype === 0x86dd) { stats.ipv6 += 1; stats.by_protocol.IPv6 = (stats.by_protocol.IPv6 || 0) + 1; continue; }
    if (ethertype !== 0x0800) { stats.other += 1; continue; }

    if (frame.length < 20) { stats.other += 1; continue; }
    const ihl = (frame[0] & 0x0f) * 4;
    const proto = frame[9];
    const src = ipToString(frame, 12);
    const dst = ipToString(frame, 16);
    const l4 = frame.slice(ihl);
    const protoName = IP_PROTO[proto] || ('IP-' + proto);
    stats.by_protocol[protoName] = (stats.by_protocol[protoName] || 0) + 1;

    if (proto === 6) {
      const tcp = parseTcp(l4);
      if (!tcp) { stats.other += 1; continue; }
      bump(stats.ports, tcp.dport);
      bump(stats.conversations, `${src}:${tcp.sport} -> ${dst}:${tcp.dport}/TCP`);
      const pl = tcp.payload;
      if (pl.length) {
        const first = pl.slice(0, 4).toString('latin1');
        if (/^(GET|POST|PUT|HEAD|DELETE|OPTIONS) /.test(first)) {
          const line = pl.slice(0, 500).toString('latin1').split('\r\n')[0];
          const hostMatch = /\r\nHost:\s*([^\r\n]+)/i.exec(pl.slice(0, 2000).toString('latin1'));
          stats.http_requests.push({
            method: line.split(' ')[0],
            path: line.split(' ')[1] || '',
            host: hostMatch ? hostMatch[1].trim() : null,
            dst,
            dport: tcp.dport
          });
        } else if (pl[0] === 0x16 && pl[1] === 0x03) {
          // TLS handshake record；0x01 = ClientHello
          if (pl[5] === 0x01) stats.tls_client_hellos += 1;
        }
      }
    } else if (proto === 17) {
      const udp = parseUdp(l4);
      if (!udp) { stats.other += 1; continue; }
      bump(stats.ports, udp.dport);
      bump(stats.conversations, `${src}:${udp.sport} -> ${dst}:${udp.dport}/UDP`);
      if (udp.dport === 53 || udp.sport === 53) {
        const q = parseDnsQname(udp.payload, 12);
        if (q.name) {
          const qtype = udp.payload.length >= q.next + 4 ? udp.payload.readUInt16BE(q.next) : null;
          stats.dns_queries.push({
            name: q.name,
            qtype: qtype === 1 ? 'A' : qtype === 28 ? 'AAAA' : qtype === 16 ? 'TXT' : String(qtype),
            dst,
            direction: udp.dport === 53 ? 'query' : 'response'
          });
        }
      }
    }
  }

  const conversations = [...stats.conversations.entries()]
    .map(([flow, count]) => ({ flow, packets: count }))
    .sort((a, b) => b.packets - a.packets)
    .slice(0, 20);

  const topPorts = [...stats.ports.entries()]
    .map(([port, count]) => ({ port, packets: count }))
    .sort((a, b) => b.packets - a.packets)
    .slice(0, 20);

  // 启发式：全部带阈值，标注为 heuristic
  const heuristics = [];
  const longNames = stats.dns_queries.filter((q) => q.name.length > 50 || q.name.split('.').some((l) => l.length > 40));
  if (longNames.length) {
    heuristics.push({
      rule: 'dns-long-label', severity: 'medium', count: longNames.length,
      samples: longNames.slice(0, 5).map((q) => q.name),
      why: 'DNS 标签 > 40 字符或全名 > 50 字符，是 DNS 隧道/数据外带的常见特征（也可能只是 CDN 或反病毒域名）'
    });
  }
  const oddHttp = stats.http_requests.filter((r) => ![80, 8080, 8000, 3000].includes(r.dport));
  if (oddHttp.length) {
    heuristics.push({
      rule: 'http-nonstandard-port', severity: 'low', count: oddHttp.length,
      samples: oddHttp.slice(0, 5).map((r) => `${r.dport} ${r.method} ${r.path}`),
      why: '明文 HTTP 走非常规端口，可能是内部服务，也可能是绕过代理'
    });
  }

  return {
    link_type: linkType,
    link_type_name: linkType === 1 ? 'Ethernet' : linkType === 101 ? 'Raw IP' : String(linkType),
    timestamp_precision: magic.nano ? 'nanosecond' : 'microsecond',
    packets: stats.packets,
    bytes: stats.bytes,
    by_protocol: stats.by_protocol,
    conversations,
    top_ports: topPorts,
    dns_queries: stats.dns_queries.slice(0, 50),
    http_requests: stats.http_requests.slice(0, 50),
    tls: {
      client_hellos: stats.tls_client_hellos,
      sni_parsed: false,
      note: '只识别握手类型；未解析 SNI，也未解密任何内容'
    },
    arp_packets: stats.arp,
    ipv6_packets: stats.ipv6,
    unparsed_packets: stats.other,
    heuristics,
    limits: {
      format: 'libpcap only（pcapng 报 UNSUPPORTED_FORMAT）',
      reassembly: '未做 TCP 流重组，HTTP 只取单包首行',
      tls: '不解密、不解析 SNI',
      verdict: 'heuristics 是启发式，不是恶意判定'
    }
  };
}

const workflow = {
  workflow_id: 'W-05',
  title: 'PCAP 网络流量分析',
  engine: 'pure-js',
  completeness: 'partial',
  requires: [],

  input_schema: {
    type: 'object',
    properties: {
      sample: { type: 'string', description: 'pcap 绝对路径' },
      sample_kind: { type: 'string', description: 'capture | synthetic | unknown，默认 unknown' }
    },
    required: ['sample']
  },

  result_schema: {
    type: 'object',
    properties: {
      sample: { type: 'object' },
      link_type: { type: 'number' },
      packets: { type: 'number' },
      by_protocol: { type: 'object' },
      conversations: { type: 'array' },
      dns_queries: { type: 'array' },
      http_requests: { type: 'array' },
      heuristics: { type: 'array' }
    }
  },

  async preflight(input) {
    const checks = [];
    const sample = input && input.sample ? path.resolve(String(input.sample)) : null;
    checks.push({ check: 'sample 已提供', ok: Boolean(sample) });
    if (!sample) return { ok: false, checks, blocked_reason: 'SAMPLE_REQUIRED' };
    const exists = fs.existsSync(sample) && fs.statSync(sample).isFile();
    checks.push({ check: 'sample 存在', ok: exists, detail: sample });
    if (!exists) return { ok: false, checks, blocked_reason: 'SAMPLE_NOT_FOUND' };
    const head = fs.readFileSync(sample).slice(0, 24);
    const magic = detectMagic(head);
    checks.push({ check: 'libpcap magic 匹配', ok: Boolean(magic && !magic.pcapng), detail: magic ? (magic.pcapng ? 'pcapng' : magic.endian + (magic.nano ? '/nano' : '/micro')) : '不匹配' });
    return { ok: Boolean(magic && !magic.pcapng), checks, blocked_reason: !magic ? 'UNSUPPORTED_FORMAT' : (magic.pcapng ? 'UNSUPPORTED_FORMAT:pcapng' : null) };
  },

  async execute(input) {
    const sample = path.resolve(String(input.sample));
    const hash = await sha256File(sample);
    const buf = fs.readFileSync(sample);
    const analysis = analyzePcap(buf);
    if (analysis.error) {
      return {
        result: { sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes }, ...analysis },
        tool_versions: [{ name: 'rea-pcap-parser', version: '1.0.0', kind: 'builtin' }],
        commands: [],
        limitations: [analysis.note],
        sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: input.sample_kind || 'unknown' }
      };
    }
    return {
      result: {
        sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: input.sample_kind || 'unknown' },
        ...analysis
      },
      tool_versions: [{ name: 'rea-pcap-parser', version: '1.0.0', kind: 'builtin' }],
      commands: [],
      limitations: Object.values(analysis.limits),
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: input.sample_kind || 'unknown' }
    };
  },

  render(result) {
    const L = [];
    L.push('# W-05 PCAP 流量分析');
    L.push('');
    L.push(`样本：\`${result.sample.path}\`（kind=${result.sample.kind}）`);
    L.push('');
    L.push(`- SHA-256：\`${result.sample.sha256}\``);
    if (result.error) {
      L.push('');
      L.push(`**无法分析**：${result.error} — ${result.note}`);
      return L.join('\n') + '\n';
    }
    L.push(`- 链路类型：${result.link_type_name}（${result.link_type}）`);
    L.push(`- 包数：${result.packets}，字节：${result.bytes}`);
    L.push('');
    L.push('## 协议分布');
    L.push('');
    for (const [k, v] of Object.entries(result.by_protocol)) L.push(`- ${k}: ${v}`);
    L.push('');
    L.push('## 主要会话');
    L.push('');
    L.push('| 流 | 包数 |');
    L.push('|---|---:|');
    for (const c of result.conversations.slice(0, 10)) L.push(`| \`${c.flow}\` | ${c.packets} |`);
    L.push('');
    L.push('## DNS');
    L.push('');
    L.push(result.dns_queries.length ? result.dns_queries.slice(0, 10).map((q) => `- ${q.name} (${q.qtype}, ${q.direction})`).join('\n') : '（无）');
    L.push('');
    L.push('## HTTP');
    L.push('');
    L.push(result.http_requests.length ? result.http_requests.slice(0, 10).map((r) => `- ${r.method} ${r.host || ''}${r.path}`).join('\n') : '（无）');
    L.push('');
    L.push(`## TLS\n\nClientHello ${result.tls.client_hellos} 个；${result.tls.note}`);
    L.push('');
    L.push('## 启发式');
    L.push('');
    L.push(result.heuristics.length ? result.heuristics.map((h) => `- **${h.rule}**（${h.severity}，${h.count} 条）：${h.why}\n  例：${h.samples.join(' / ')}`).join('\n') : '（未触发）');
    L.push('');
    L.push('## 能力边界');
    L.push('');
    for (const [k, v] of Object.entries(result.limits)) L.push(`- **${k}**：${v}`);
    return L.join('\n') + '\n';
  }
};

module.exports = workflow;
module.exports.analyzePcap = analyzePcap;
module.exports.detectMagic = detectMagic;
