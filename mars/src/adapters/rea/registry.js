'use strict';
// REA 工作流注册表（M14-7）。
//
// 统一接口（每个工作流都必须实现）：
//   workflow_id / title / engine / requires / input_schema / result_schema
//   preflight(input) -> { ok, checks, blocked_reason }
//   execute(input)   -> { result, tool_versions, commands, limitations, sample }
//   render(result)   -> Markdown
//
// 状态只有四种，含义严格：
//   PASS     目标达成，结果可复核
//   PARTIAL  目标部分达成（能力边界写在 result.capability / missing_capability）
//   BLOCKED  前置条件不满足（缺工具/缺授权/样本不可解析），**没有**假装跑过
//   FAILED   跑了但失败
//
// 「PARTIAL 不等于 PASS」这条在报告里必须保留。

const path = require('node:path');
const fs = require('node:fs');
const { newId, nowIso, stableJson } = require('../../util');
const { probe } = require('./tools');
const { makeEvidenceDir, persist } = require('./evidence');

const WORKFLOWS = [
  require('./w01-code'),
  require('./w02-binary'),
  require('./w03-apk'),
  require('./w04-callchain'),
  require('./w05-pcap'),
  require('./w06-frida')
];

// W-03 在缺 jadx 时仍能给出包结构事实，因此 blocked 也要执行一次「能做的部分」
const BLOCKED_STILL_REPORTS = new Set(['W-03']);

function all() {
  return WORKFLOWS.map((w) => ({
    workflow_id: w.workflow_id,
    title: w.title,
    engine: w.engine,
    requires: w.requires || [],
    completeness: w.completeness || 'partial',
    input_schema: w.input_schema,
    result_schema: w.result_schema
  }));
}

function get(workflowId) {
  const id = String(workflowId).toUpperCase();
  const wf = WORKFLOWS.find((w) => w.workflow_id === id);
  if (!wf) {
    const err = new Error('WORKFLOW_UNKNOWN ' + workflowId + '（可用：' + WORKFLOWS.map((w) => w.workflow_id).join(',') + '）');
    err.code = 'WORKFLOW_UNKNOWN';
    throw err;
  }
  return wf;
}

async function preflight(workflowId, input) {
  return get(workflowId).preflight(input || {});
}

/**
 * 执行一次工作流并落库 + 落证据。
 * @param {object} db
 * @param {object} opts { workflow_id, input, evidenceBase }
 */
async function run(db, opts) {
  const wf = get(opts.workflow_id);
  const reaRunId = newId('rea');
  const startedAt = nowIso();
  const evidenceBase = opts.evidenceBase || path.join(process.cwd(), '.rea');

  let status = null;
  let bundle = null;
  let errorCode = null;
  let errorMessage = null;
  let pre = null;

  try {
    pre = await wf.preflight(opts.input || {});
  } catch (e) {
    pre = { ok: false, checks: [], blocked_reason: 'PREFLIGHT_ERROR' };
    errorCode = e.code || 'PREFLIGHT_ERROR';
    errorMessage = e.message;
  }

  if (!pre.ok) {
    if (BLOCKED_STILL_REPORTS.has(wf.workflow_id)) {
      try {
        const objdump = (await probe(['objdump']))[0];
        bundle = await wf.execute(opts.input || {}, { objdumpPath: objdump.path || 'objdump' });
      } catch (e) {
        bundle = null;
        errorCode = e.code || 'EXECUTE_ERROR';
        errorMessage = e.message;
      }
    }
    status = 'BLOCKED';
  } else {
    try {
      const objdump = (await probe(['objdump']))[0];
      bundle = await wf.execute(opts.input || {}, { objdumpPath: objdump.path || 'objdump' });
      status = wf.completeness === 'partial' ? 'PARTIAL' : 'PASS';
      if (bundle && bundle.result && bundle.result.error) status = 'FAILED';
    } catch (e) {
      status = 'FAILED';
      errorCode = e.code || 'EXECUTE_ERROR';
      errorMessage = e.message;
      bundle = null;
    }
  }

  const samplePath = opts.input && (opts.input.sample || opts.input.root);
  const sampleHash = bundle && bundle.sample ? bundle.sample : null;

  const result = bundle ? bundle.result : {
    blocked_reason: pre ? pre.blocked_reason : null,
    checks: pre ? pre.checks : [],
    message: '前置条件不满足，未执行分析'
  };

  const markdown = (() => {
    try {
      if (status === 'BLOCKED' && wf.workflow_id === 'W-06') return wf.render({ message: '缺 frida/adb 与授权目标' });
      return wf.render(result);
    } catch {
      return '# ' + wf.workflow_id + '\n\n（报告渲染失败，见 result.json）\n';
    }
  })();

  const dir = makeEvidenceDir(evidenceBase, wf.workflow_id, reaRunId);
  const stored = persist(dir, {
    workflow_id: wf.workflow_id,
    rea_run_id: reaRunId,
    sample: sampleHash
      ? { ...sampleHash, path: samplePath || sampleHash.path }
      : (samplePath ? { path: samplePath } : null),
    tool_versions: bundle ? bundle.tool_versions : [],
    commands: bundle ? bundle.commands : [],
    result: { status, preflight: pre, result, error: errorCode ? { code: errorCode, message: errorMessage } : null },
    markdown,
    limitations: bundle ? bundle.limitations : ['未执行']
  });

  const now = nowIso();
  db.prepare(`INSERT INTO rea_runs (rea_run_id, workflow_id, sample_path, sample_sha256, sample_bytes,
    sample_kind, status, tool_versions_json, input_json, result_json, evidence_dir, error_code,
    error_message, started_at, finished_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(reaRunId, wf.workflow_id, samplePath || null,
      sampleHash ? sampleHash.sha256 : null,
      sampleHash ? sampleHash.bytes : null,
      sampleHash ? (sampleHash.kind || null) : null,
      status,
      stableJson(bundle ? bundle.tool_versions : []),
      stableJson(opts.input || {}),
      stableJson(result),
      dir, errorCode, errorMessage, startedAt, now, now);

  return {
    rea_run_id: reaRunId,
    workflow_id: wf.workflow_id,
    title: wf.title,
    status,
    preflight: pre,
    result,
    evidence_dir: dir,
    evidence_files: stored.files,
    tool_versions: bundle ? bundle.tool_versions : [],
    limitations: bundle ? bundle.limitations : ['未执行'],
    sample: sampleHash
  };
}

function getRun(db, reaRunId) {
  const r = db.prepare('SELECT * FROM rea_runs WHERE rea_run_id = ?').get(reaRunId);
  if (!r) return null;
  return {
    ...r,
    tool_versions: JSON.parse(r.tool_versions_json || '[]'),
    input: JSON.parse(r.input_json || '{}'),
    result: JSON.parse(r.result_json || '{}')
  };
}

function listRuns(db, filter = {}) {
  const where = [];
  const params = [];
  if (filter.workflow_id) { where.push('workflow_id = ?'); params.push(String(filter.workflow_id).toUpperCase()); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  const sql = 'SELECT rea_run_id, workflow_id, status, sample_path, sample_sha256, sample_kind, created_at, evidence_dir FROM rea_runs'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(filter.limit || 50));
  return db.prepare(sql).all(...params);
}

/** 所有工作流 + 当前环境的就绪状态（只探测，不执行）。 */
async function status() {
  const out = [];
  for (const wf of WORKFLOWS) {
    const tools = wf.requires && wf.requires.length ? await probe(wf.requires) : [];
    out.push({
      workflow_id: wf.workflow_id,
      title: wf.title,
      engine: wf.engine,
      completeness: wf.completeness || 'partial',
      requires: wf.requires || [],
      tools_ready: tools.every((t) => t.present),
      tools
    });
  }
  return out;
}

module.exports = { all, get, preflight, run, getRun, listRuns, status, WORKFLOWS };
