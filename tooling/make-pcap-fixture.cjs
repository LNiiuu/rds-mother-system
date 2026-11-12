#!/usr/bin/env node
'use strict';
// 生成一个**合成** libpcap 样本，用于 W-05 的可复核测试。
//
// 为什么需要它：本机没有任何真实抓包，也没有 tshark。为了让 W-05 的解析器
// 能在真实字节上被验证，这里按 libpcap 格式逐字节构造 4 个包：
//   DNS 查询（含一个长标签，用于触发长标签启发式）、DNS 响应、
//   TCP SYN 到 443、TCP 明文 HTTP GET（走 8080）。
//
// 它是合成样本，不是真实流量。任何引用这份数据的地方都必须标注 synthetic。

const fs = require('node:fs');
const path = require('node:path');

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; }

function mac(s) { return Buffer.from(s.split(':').map((x) => parseInt(x, 16))); }
function ip(s) { return Buffer.from(s.split('.').map((x) => parseInt(x, 10))); }

function eth(src, dst, ethertype) {
  return Buffer.concat([mac(dst), mac(src), u16(ethertype)]);
}

function ipv4(src, dst, proto, payload) {
  const total = 20 + payload.length;
  const h = Buffer.alloc(20);
  h[0] = 0x45;
  h[1] = 0x00;
  h.writeUInt16BE(total, 2);
  h.writeUInt16BE(0x1234, 4);
  h.writeUInt16BE(0x4000, 6);
  h[8] = 64;
  h[9] = proto;
  h.writeUInt16BE(0, 10); // checksum 留 0：样本不用于转发，解析器也不校验
  ip(src).copy(h, 12);
  ip(dst).copy(h, 16);
  return Buffer.concat([h, payload]);
}

function udp(sport, dport, payload) {
  const h = Buffer.alloc(8);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt16BE(8 + payload.length, 4);
  h.writeUInt16BE(0, 6);
  return Buffer.concat([h, payload]);
}

function tcp(sport, dport, flags, payload) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt32BE(1, 4);
  h.writeUInt32BE(0, 8);
  h[12] = 0x50;
  h[13] = flags;
  return Buffer.concat([h, payload]);
}

function dnsQuery(id, name, qtype) {
  const labels = [];
  for (const part of name.split('.')) {
    labels.push(Buffer.from([part.length]), Buffer.from(part, 'latin1'));
  }
  return Buffer.concat([
    u16(id), u16(0x0100), u16(1), u16(0), u16(0), u16(0),
    ...labels, Buffer.from([0]), u16(qtype), u16(1)
  ]);
}

function buildPcap() {
  const CLIENT = '10.0.0.5';
  const MAC_C = 'aa:bb:cc:00:00:01';
  const MAC_G = 'aa:bb:cc:00:00:ff';

  const frames = [];
  const push = (payload, ts) => frames.push({ ts, data: payload });

  // 1) DNS 查询：长标签用于触发 dns-long-label
  const longLabel = 'a'.repeat(48) + '.example.com';
  push(Buffer.concat([
    eth(MAC_C, MAC_G, 0x0800),
    ipv4(CLIENT, '10.0.0.1', 17, udp(51515, 53, dnsQuery(0x1234, longLabel, 1)))
  ]), 1700000000.000001);

  // 2) DNS 响应（问题段相同，标志位 0x8180）
  const q = dnsQuery(0x1234, longLabel, 1);
  const resp = Buffer.from(q);
  resp.writeUInt16BE(0x8180, 2);
  push(Buffer.concat([
    eth(MAC_G, MAC_C, 0x0800),
    ipv4('10.0.0.1', CLIENT, 17, udp(53, 51515, resp))
  ]), 1700000000.010000);

  // 3) TCP SYN → 443（之后没有任何 TLS 载荷，用于确认不会误判 ClientHello）
  push(Buffer.concat([
    eth(MAC_C, MAC_G, 0x0800),
    ipv4(CLIENT, '93.184.216.34', 6, tcp(52000, 443, 0x02, Buffer.alloc(0)))
  ]), 1700000000.020000);

  // 4) 明文 HTTP GET → 8080
  const http = Buffer.from('GET /api/v1/items HTTP/1.1\r\nHost: api.internal.test\r\nUser-Agent: rea-fixture\r\n\r\n', 'latin1');
  push(Buffer.concat([
    eth(MAC_C, MAC_G, 0x0800),
    ipv4(CLIENT, '10.0.0.9', 6, tcp(52001, 8080, 0x18, http))
  ]), 1700000000.030000);

  const global = Buffer.concat([
    u32(0xa1b2c3d4), u16(2), u16(4), u32(0), u32(0), u32(65535), u32(1)
  ]);

  const records = frames.map((f) => {
    const sec = Math.floor(f.ts);
    const usec = Math.round((f.ts - sec) * 1e6);
    return Buffer.concat([u32(sec), u32(usec), u32(f.data.length), u32(f.data.length), f.data]);
  });

  return Buffer.concat([global, ...records]);
}

function main() {
  const out = process.argv[2] || path.join(process.cwd(), 'synthetic-sample.pcap');
  const buf = buildPcap();
  fs.writeFileSync(out, buf);
  console.log(JSON.stringify({ wrote: out, bytes: buf.length, packets: 4, kind: 'synthetic' }, null, 2));
}

if (require.main === module) main();

module.exports = { buildPcap };
