#!/usr/bin/env node
'use strict';
// 从宿主 MCP 注册表移除本体系条目（M3 / B4）。
//
// 原实现在 mars-mcp-disable.ps1 里用 ConvertFrom-Json / ConvertTo-Json 整文件重写，
// 现在下沉到这里，PowerShell 只做转调（与 mars-rollback.ps1 同一模式，避免两份实现分叉）。
//
// 安全默认：
//   - 不带 --yes 时只打印将要移除的条目，不写文件；
//   - 写入前备份并打印备份路径；
//   - 遇到结构不符（entries 不是数组）直接拒绝，不猜；
//   - 未知顶层字段原样保留。
//
// 用法:
//   node mars/scripts/mars-mcp-disable.js [--registry <path>] [--backup-dir <dir>]
//                                         [--prefix mars-] [--yes] [--json]
const os = require('node:os');
const path = require('node:path');
const { createDshHostRegistry } = require('../src/adapters/dsh-registry');
const { createNullHostRegistry } = require('../src/adapters/null-host-registry');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const defaultRegistry = path.join(os.homedir(), '.dsh', 'skill-mcp-manager', 'registry.json');
  const registryPath = typeof args.registry === 'string' ? args.registry : defaultRegistry;
  const backupDir = typeof args['backup-dir'] === 'string' ? args['backup-dir'] : undefined;
  const prefix = typeof args.prefix === 'string' ? args.prefix : 'mars-';
  const json = args.json === true;
  const write = args.yes === true;

  const registry = registryPath
    ? createDshHostRegistry({ registryPath, backupDir })
    : createNullHostRegistry();

  try {
    const info = registry.detect();
    if (!info.present) {
      const payload = { ok: false, code: 'HOST_REGISTRY_NOT_FOUND', detail: info.reason };
      if (json) console.log(JSON.stringify(payload, null, 2));
      else console.error('ERROR HOST_REGISTRY_NOT_FOUND: ' + info.reason);
      return 2;
    }

    const result = registry.removeByPrefix(prefix, { dryRun: !write });

    if (json) {
      console.log(JSON.stringify({ ok: true, registry: info.path, prefix, ...result }, null, 2));
    } else {
      console.log(`registry: ${info.path}`);
      console.log(`entries: ${info.entries}; prefix "${prefix}"; will remove: ${result.removed}`);
      if (result.removed === 0) {
        console.log('no matching entries; nothing to do');
      } else if (result.dryRun) {
        console.log('WHATIF: no write. Re-run with --yes (registry is backed up first).');
        console.log('to remove: ' + result.names.join(', '));
      } else {
        console.log('backup written: ' + result.backupPath);
        console.log(`removed ${result.removed} entries; kept ${result.kept}`);
        console.log('NOTE: a running host session must reload/restart before the tool catalog refreshes.');
      }
    }
    return 0;
  } catch (err) {
    const code = (err && err.code) || 'HOST_WRITE_REFUSED';
    if (json) console.log(JSON.stringify({ ok: false, code, detail: err && err.message }, null, 2));
    else console.error(`ERROR ${code}: ${err && err.message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());

module.exports = { main, parseArgs };
