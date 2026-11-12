'use strict';
// REA CLI 处理（M14）。
//
// 不 require 适配器：注册表由组合根注入（runtime.rea），与 provider/executor 一致。

const { nowIso } = require('./util');

function json(v) { console.log(JSON.stringify(v, null, 2)); }

async function reaList({ runtime: rt }) {
  json({ workflows: rt.rea.all() });
}

async function reaStatus({ runtime: rt }) {
  json({ workflows: await rt.rea.status(), checked_at: nowIso() });
}

async function reaPreflight({ runtime: rt, args }) {
  if (!args.workflow) throw new Error('BAD_REQUEST 需要 --workflow <W-01..W-06>');
  const input = {
    root: args.root || args.path,
    sample: args.sample,
    target: args.target,
    purpose: args.purpose,
    authorization: args.authorization
  };
  json({ workflow_id: String(args.workflow).toUpperCase(), preflight: await rt.rea.preflight(args.workflow, input) });
}

async function reaRun({ db, runtime: rt, args, reaEvidenceBase }) {
  if (!args.workflow) throw new Error('BAD_REQUEST 需要 --workflow <W-01..W-06>');
  const input = {
    root: args.root || args.path,
    sample: args.sample,
    entry: args.entry,
    depth: args.depth ? Number(args.depth) : undefined,
    sample_kind: args['sample-kind'] || 'unknown',
    max_strings: args['max-strings'] ? Number(args['max-strings']) : undefined,
    target: args.target,
    purpose: args.purpose,
    authorization: args.authorization
  };
  const out = await rt.rea.run(db, {
    workflow_id: String(args.workflow).toUpperCase(),
    input,
    evidenceBase: args.out || reaEvidenceBase
  });
  json({
    rea_run_id: out.rea_run_id,
    workflow_id: out.workflow_id,
    status: out.status,
    preflight: out.preflight,
    sample: out.sample,
    tool_versions: out.tool_versions,
    evidence_dir: out.evidence_dir,
    evidence_files: out.evidence_files,
    limitations: out.limitations,
    result_summary: summarize(out.workflow_id, out.result)
  });
}

/** 只摘要，不重复打印完整 result（完整结果在 evidence_dir/result.json）。 */
function summarize(workflowId, result) {
  if (!result) return null;
  if (result.error) return { error: result.error, note: result.note };
  switch (workflowId) {
    case 'W-01':
      return {
        files_scanned: result.files_scanned,
        languages: (result.languages || []).slice(0, 5).map((l) => `${l.name}:${l.files}`),
        entries: (result.entries || []).map((e) => e.path),
        tests: result.tests ? result.tests.files : null
      };
    case 'W-02':
      return {
        format: result.file && result.file.format,
        architecture: result.file && result.file.architecture,
        sections: (result.sections || []).length,
        imports: (result.imports || []).map((i) => i.library),
        symbols: result.symbols && result.symbols.total,
        strings: result.strings && result.strings.total,
        by_kind: result.strings && result.strings.by_kind,
        capability_not_done: result.capability && result.capability.not_done
      };
    case 'W-03':
      return { structure: result.structure, missing: result.missing_capability && result.missing_capability.not_done };
    case 'W-04':
      return { graph: result.graph, entry: result.entry, levels: (result.levels || []).length, hot: (result.hot_functions || []).slice(0, 5) };
    case 'W-05':
      return {
        packets: result.packets, bytes: result.bytes, by_protocol: result.by_protocol,
        dns: (result.dns_queries || []).length, http: (result.http_requests || []).length,
        heuristics: (result.heuristics || []).map((h) => h.rule)
      };
    default:
      return { blocked: result.blocked_reason || result.message || null };
  }
}

function reaInspect({ db, runtime: rt, args }) {
  if (!args.run) throw new Error('BAD_REQUEST 需要 --run <rea_run_id>');
  const row = rt.rea.getRun(db, args.run);
  if (!row) throw new Error('REA_RUN_NOT_FOUND ' + args.run);
  json(row);
}

function reaRuns({ db, args }) {
  const rows = db.prepare(`SELECT rea_run_id, workflow_id, status, sample_path, sample_sha256, sample_kind, created_at
    FROM rea_runs ORDER BY created_at DESC LIMIT ?`).all(Number(args.limit || 50));
  json({ runs: rows });
}

module.exports = { reaList, reaStatus, reaPreflight, reaRun, reaInspect, reaRuns, summarize };
