'use strict';
// REA 证据（M14-8）。
//
// 每次分析必须能回答：分析的是什么、它的哈希是多少、用什么工具什么版本、
// 跑了什么命令、结论在哪、哪部分是工具直接观察、哪部分是推断。
//
// 这份模块只负责"如实记录"，不负责判断结论对不对。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_HASH_BYTES = 512 * 1024 * 1024;

function sha256File(file) {
  const st = fs.statSync(file);
  if (st.size > MAX_HASH_BYTES) {
    // 超大样本：流式哈希，避免一次性读进内存
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(file);
      s.on('data', (d) => h.update(d));
      s.on('end', () => resolve({ sha256: h.digest('hex'), bytes: st.size }));
      s.on('error', reject);
    });
  }
  const buf = fs.readFileSync(file);
  return Promise.resolve({ sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
}

/** 建立证据目录：<base>/<workflow>/<rea_run_id>/ */
function makeEvidenceDir(base, workflowId, runId) {
  const dir = path.join(base, workflowId, runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * 把一次分析落成三个文件：
 *   result.json    机器可读的完整结果
 *   report.md      人读的报告
 *   evidence.json  样本、工具、命令、复核方法
 */
function persist(dir, { workflow_id, rea_run_id, sample, tool_versions, commands, result, markdown, limitations }) {
  const evidence = {
    rea_run_id,
    workflow_id,
    sample: sample || null,
    tool_versions: tool_versions || [],
    commands: commands || [],
    limitations: limitations || [],
    // 复核入口：照着这三步能独立验证
    reproduce: [
      '1. 对 sample.path 重新计算 SHA-256，与 sample.sha256 比对',
      '2. 按 commands 里的 argv 重新执行（不经过 shell）',
      '3. 对比 result.json 的字段；不一致说明环境或样本变了'
    ],
    created_at: new Date().toISOString()
  };
  const files = {
    result: writeJson(path.join(dir, 'result.json'), result),
    evidence: writeJson(path.join(dir, 'evidence.json'), evidence)
  };
  if (markdown) {
    const md = path.join(dir, 'report.md');
    fs.writeFileSync(md, markdown, 'utf8');
    files.report = md;
  }
  return { dir, files, evidence };
}

/** 一条命令的可复核记录（argv 数组，不是拼好的字符串）。 */
function commandRecord(bin, args, outcome = {}) {
  return {
    bin,
    argv: args,
    ok: outcome.ok !== undefined ? outcome.ok : null,
    code: outcome.code !== undefined ? outcome.code : null,
    timed_out: outcome.timed_out || false,
    at: new Date().toISOString()
  };
}

module.exports = { sha256File, makeEvidenceDir, persist, commandRecord, writeJson };
