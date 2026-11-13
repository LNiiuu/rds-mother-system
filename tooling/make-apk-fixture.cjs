#!/usr/bin/env node
'use strict';
// 生成一个最小、合法、确定性的 APK/ZIP 样本，用于 W-03 的 ZIP 事实层测试。
// 它不是可安装 APK；只用于验证“包里有什么”的字节解析，不冒充可运行应用。

const fs = require('node:fs');

const ENTRIES = [
  ['AndroidManifest.xml', Buffer.from([0x03, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00])],
  ['classes.dex', Buffer.from('dex\n035\0', 'latin1')],
  ['classes2.dex', Buffer.from('dex\n035\0', 'latin1')],
  ['resources.arsc', Buffer.from([0x02, 0x00, 0x0c, 0x00])],
  ['lib/arm64-v8a/libnative.so', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  ['assets/config.json', Buffer.from('{"ok":true}\n', 'utf8')],
  ['META-INF/CERT.RSA', Buffer.from([0x30, 0x82, 0x00, 0x01])]
];

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function build() {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of ENTRIES) {
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
    const chunk = Buffer.concat([local, nameBuf, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(chunk);
    offset += chunk.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(ENTRIES.length, 8);
  eocd.writeUInt16LE(ENTRIES.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: make-apk-fixture.cjs <out.apk>'); process.exit(2); }
  const buf = build();
  fs.writeFileSync(out, buf);
  console.log(JSON.stringify({ wrote: out, bytes: buf.length, entries: ENTRIES.length, kind: 'synthetic-apk-zip' }, null, 2));
}

if (require.main === module) main();
module.exports = { build, ENTRIES };
