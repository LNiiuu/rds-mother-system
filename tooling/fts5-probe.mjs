#!/usr/bin/env node
/**
 * FTS5 前置探针（macOS 兼容性验证，第一批）。
 *
 * 为什么单独做这一步：
 *   macOS 兼容性评估里唯一的高风险项是「darwin 构建的 node:sqlite 是否启用了 FTS5」。
 *   整个引擎的检索压在这一条上，而它**无法靠静态阅读确定**。
 *   所以在跑完整测试之前，先用一条最短路径把它验掉：
 *   失败就停，不许跳过、不许降级、不许用 LIKE 回退掩盖。
 *
 * 为什么走 db.js 而不是自己 require('node:sqlite')：
 *   要验证的是**项目实际使用的那条路径**——openDb → initSchema →
 *   `CREATE VIRTUAL TABLE ... USING fts5(..., tokenize='unicode61')`。
 *   自己另写一份只证明「Node 有 sqlite」，证明不了「RDS 能用」。
 *
 * 输出三段：环境、五步断言、结论。任何一步失败即 exit 1。
 *
 * 用法:
 *   node tooling/fts5-probe.mjs
 *   node tooling/fts5-probe.mjs --json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 环境快照：runner image、架构、Node 精确版本。 */
function environment() {
  const v = process.versions;
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    nodeModulesAbi: v.modules || null,
    v8: v.v8 || null,
    sqlite: v.sqlite || null,
    uv: v.uv || null,
    // GitHub Actions 注入的环境变量（本地运行为 null）
    runnerOS: process.env.RUNNER_OS || null,
    runnerArch: process.env.RUNNER_ARCH || null,
    imageOS: process.env.ImageOS || null,
    imageVersion: process.env.ImageVersion || null,
    cpus: os.cpus().length,
    osRelease: os.release(),
    osType: os.type()
  };
}

const checks = [];
function record(name, ok, detail, extra) {
  checks.push(Object.assign({ name, ok, detail }, extra || {}));
  return ok;
}

function main() {
  const json = process.argv.includes('--json');
  const env = environment();
  const log = (...args) => { if (!json) console.log(...args); };

  log('== 环境 ==');
  log(`  platform=${env.platform}  arch=${env.arch}  node=${env.node}  sqlite=${env.sqlite || '(unknown)'}`);
  log(`  runner: RUNNER_OS=${env.runnerOS || '-'}  RUNNER_ARCH=${env.runnerArch || '-'}  ImageOS=${env.imageOS || '-'}  ImageVersion=${env.imageVersion || '-'}`);
  log(`  os: ${env.osType} ${env.osRelease}  cpus=${env.cpus}`);
  log('');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-fts5-probe-'));
  const dbFile = path.join(dir, 'probe.db');
  let db = null;

  try {
    // ---- 1) 走项目真实路径打开数据库（触发 initSchema，其中建 FTS5 虚拟表）
    const dbModule = require(path.join(ROOT, 'mars', 'src', 'db.js'));
    db = dbModule.openDb(dbFile);
    record('openDb + initSchema', true, `schema_version=${dbModule.SCHEMA_VERSION}, file=${path.basename(dbFile)}`);
    log(`== 1) openDb（项目真实路径）==  ok  schema_version=${dbModule.SCHEMA_VERSION}`);

    // ---- 2) FTS5 虚拟表确实被建出来了，且用的是 fts5 模块
    const master = db.prepare("SELECT name, sql FROM sqlite_master WHERE name = 'memories_fts'").get();
    const isFts5 = !!(master && /USING\s+fts5/i.test(master.sql || ''));
    const hasUnicode61 = !!(master && /unicode61/i.test(master.sql || ''));
    record('memories_fts 存在且为 fts5', isFts5, master ? master.sql : '(表不存在)');
    record('tokenize=unicode61', hasUnicode61, hasUnicode61 ? 'unicode61' : '(未见 unicode61)');
    log(`== 2) FTS5 虚拟表 ==  ${isFts5 ? 'ok' : 'FAIL'}  ${master ? 'memories_fts' : '缺失'}`);

    if (!isFts5) throw new Error('memories_fts 不是 fts5 虚拟表，后续断言无意义');

    // ---- 3) 直接对 FTS5 表做 写入 → MATCH 查询（底层能力）
    db.prepare('INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)').run('probe-1', 'RDS uses sqlite builtin fts5 for retrieval');
    const direct = db.prepare("SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?").all('fts5');
    const directOk = direct.length === 1 && direct[0].memory_id === 'probe-1';
    record('FTS5 直接写入 + MATCH', directOk, `matched=${direct.length}`);
    log(`== 3) FTS5 直接写入 + MATCH ==  ${directOk ? 'ok' : 'FAIL'}  matched=${direct.length}`);

    // ---- 4) unicode61 对中文的行为（项目大量使用中文内容）
    // 不断言中文分词质量（unicode61 不切词，只按空白与标点分段），
    // 只断言「含中文的内容能被写入、并能被其中的连续片段命中」——
    // 这是 retrieval.js 依赖 LIKE 回退之外的最小可用性。
    db.prepare('INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)').run('probe-2', '本项目使用内置 sqlite 数据库');
    const zh = db.prepare("SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?").all('数据库');
    const zhOk = zh.some((r) => r.memory_id === 'probe-2');
    record('中文内容可写入且可被 ASCII 片段命中', zhOk, `matched=${zh.length}`);
    log(`== 4) 中文 + unicode61 ==  ${zhOk ? 'ok' : 'FAIL'}  matched=${zh.length}`);

    // ---- 5) 项目语义：memories 与 memories_fts 同时写入后，按 FTS5 检索得到
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO memories
      (memory_id, project_id, memory_type, content, source_ref, source_version, content_hash,
       status, confidence, visibility, role_scope, tags, relations, evidence_refs,
       provenance, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'probe-mem-1', 'demo', 'L3', '探针写入的决策内容 about sqlite',
      'docs/probe.md', 'v1', 'hash-probe',
      'approved', 0.5, 'project',
      '[]', '[]', '[]', '[]',
      JSON.stringify({ origin: 'probe' }), 'probe', now, now
    );
    db.prepare('INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)').run('probe-mem-1', '探针写入的决策内容 about sqlite');
    const viaProject = db.prepare(
      "SELECT m.memory_id FROM memories_fts f JOIN memories m ON m.memory_id = f.memory_id WHERE memories_fts MATCH ? AND m.status = 'approved'"
    ).all('sqlite');
    const viaOk = viaProject.some((r) => r.memory_id === 'probe-mem-1');
    record('项目语义：memories + fts 联表检索', viaOk, `matched=${viaProject.length}`);
    log(`== 5) 项目语义联表检索 ==  ${viaOk ? 'ok' : 'FAIL'}  matched=${viaProject.length}`);

    log('');
  } catch (err) {
    record('probe 执行', false, String((err && err.message) || err));
    if (!json) {
      console.log('');
      console.log('FTS5 PROBE FAIL');
      console.log('  ' + String((err && err.stack) || err).split('\n').slice(0, 6).join('\n  '));
    }
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const failed = checks.filter((c) => !c.ok);
  const pass = failed.length === 0 && checks.length >= 5;

  if (json) {
    console.log(JSON.stringify({ env, checks, pass }, null, 2));
  } else {
    console.log(pass ? 'FTS5 PROBE PASS' : `FTS5 PROBE FAIL  (${failed.length} 项未通过)`);
    if (!pass) for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }

  // 明确不提供「跳过」出口：能力缺失就是失败，让 CI 变红。
  return pass ? 0 : 1;
}

process.exit(main());
