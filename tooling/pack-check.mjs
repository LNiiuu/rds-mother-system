#!/usr/bin/env node
/**
 * 发行包内容检查。
 *
 * 目的：把「哪些东西绝对不能进包」变成可执行断言，而不是靠人工看 `npm pack --dry-run`。
 * 这条检查在 M1 抓到过真实缺陷（mars/contracts/*.json 漏打包 → 装完 put 直接 ENOENT）。
 *
 * 用法: node tooling/pack-check.mjs <tarball.tgz>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED = [
  'package.json',
  'VERSION',
  'LICENSE',
  'bin/rds.mjs',
  'bin/doctor.mjs',
  'bin/validate.mjs',
  'docs/install.md',
  'mars/src/cli.js',
  'mars/src/ledger.js',
  'mars/src/db/schema.js',
  'mars/src/db/ratelimit.js',
  'mars/src/db/stats.js',
  'mars/src/errors.js',
  'mars/src/composition.js',
  'mars/src/ports/asset-resolver.js',
  'mars/src/ports/identity-provider.js',
  'mars/src/ports/session-source.js',
  'mars/src/ports/audit-sink.js',
  'mars/src/ports/host-registry.js',
  'mars/src/paths.js',
  'mars/src/session-registry.js',
  'mars/src/adapters/fs-asset-resolver.js',
  'mars/src/adapters/cli-identity.js',
  'mars/src/adapters/token-file-identity.js',
  'mars/src/adapters/dsh-session-source.js',
  'mars/src/adapters/db-audit-sink.js',
  'mars/src/adapters/null-audit-sink.js',
  'mars/src/adapters/dsh-registry.js',
  'mars/src/adapters/null-host-registry.js',
  'mars/contracts/memory.schema.json',
  'mars/contracts/context-packet.schema.json',
  'mars/contracts/manifest.schema.json',
  'mars/contracts/ledger.schema.json',
  'mars/contracts/role-routing.schema.json',
  'mars/config/role-routing.json',
  'mars/config/principals.example.json',
  'core/templates/project.yaml'
];

const FORBIDDEN = [
  { re: /(^|\/)mars\/tests\//, why: '测试不随包分发' },
  { re: /(^|\/)tests\//, why: '测试不随包分发' },
  { re: /(^|\/)docs\/history\//, why: '历史材料不随包分发' },
  { re: /(^|\/)docs\/checks\//, why: '检查记录不随包分发' },
  { re: /(^|\/)mars\/experiments\//, why: '实验数据不随包分发' },
  { re: /(^|\/)mars\/var\//, why: '运行时数据不随包分发' },
  { re: /(^|\/)principals\.json$/, why: '身份文件绝不能进包' },
  { re: /toolchain\.local\.json$/, why: '本机工具链配置不随包分发' },
  { re: /\.(db|db-wal|db-shm)$/, why: '数据库文件不随包分发' },
  { re: /\.zstd$|\.jsonl$/, why: '会话样本不随包分发' }
];

function listTarball(tgz) {
  const out = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^package\//, ''))
    .filter(l => !l.endsWith('/'));
}

function main() {
  const tgz = process.argv[2];
  if (!tgz || !fs.existsSync(tgz)) {
    console.error('ERROR 需要存在的 tarball 路径: node tooling/pack-check.mjs <x.tgz>');
    return 2;
  }

  const files = listTarball(tgz);
  const set = new Set(files);
  const problems = [];

  for (const req of REQUIRED) {
    if (!set.has(req)) problems.push('缺少必需文件: ' + req);
  }
  for (const f of files) {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(f)) problems.push('不应打包: ' + f + '（' + rule.why + '）');
    }
  }

  const size = fs.statSync(tgz).size;
  console.log(`tarball: ${path.basename(tgz)}  文件 ${files.length} 个  ${size} B`);

  if (problems.length > 0) {
    console.error('PACK FAIL');
    for (const p of problems) console.error('  - ' + p);
    return 1;
  }

  console.log('PACK PASS  必需文件齐全，禁止项 0 命中');
  return 0;
}

process.exit(main());
