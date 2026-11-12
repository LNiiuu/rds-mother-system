'use strict';
// M10：确定性的上下文分析、压缩与恢复。
//
// 三条硬规则：
//   1. L0（任务、禁止事项）任何情况下都不改；改了就算失败，回退原文。
//   2. 压缩收益必须为正；否则记 NO_GAIN 并返回原文，不假装压缩成功。
//   3. 原文永远留在 compressions.original_json，恢复时校验 SHA-256。
//
// 这里没有任何模型调用。策略是去重、重复行折叠、历史归档；
// 「结构化摘要」只在内容本身是结构化 JSON 时做字段重排，不做语义生成。

const crypto = require('node:crypto');
const { nowIso, newId, estimateTokens } = require('./util');

const LAYERS = {
  task: 'L0',
  prohibitions: 'L0',
  decisions: 'L1',
  facts: 'L2',
  state: 'L2',
  knowledge: 'L2',
  evidence: 'L3',
  reference: 'L3',
};

function layerOf(kind) {
  return LAYERS[kind] || 'L3';
}

function norm(text) {
  return String(text === undefined || text === null ? '' : text).replace(/\r\n/g, '\n').trim();
}

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function sectionTokens(section) {
  const n = Number(section.token_estimate);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return estimateTokens(section.content || '');
}

function analyze(sections) {
  const entries = sections.map((s) => ({
    id: s.id,
    kind: s.kind,
    layer: layerOf(s.kind),
    tokens: sectionTokens(s),
    hash: sha(norm(s.content)),
  }));
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.hash) continue;
    if (!groups.has(entry.hash)) groups.set(entry.hash, []);
    groups.get(entry.hash).push(entry);
  }
  const duplicates = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      hash: group[0].hash,
      ids: group.map((x) => x.id),
      tokensEach: group[0].tokens,
      wastedTokens: group[0].tokens * (group.length - 1),
    }));
  const layers = {};
  for (const entry of entries) {
    if (!layers[entry.layer]) layers[entry.layer] = { count: 0, tokens: 0 };
    layers[entry.layer].count += 1;
    layers[entry.layer].tokens += entry.tokens;
  }
  return {
    totalTokens: entries.reduce((sum, e) => sum + e.tokens, 0),
    duplicates,
    wastedTokens: duplicates.reduce((sum, d) => sum + d.wastedTokens, 0),
    layers,
    entries,
  };
}

// 只折叠「连续且完全相同」的行，至少 3 行才动手；空行不折叠。
function foldRepeatedLines(content) {
  const lines = String(content).split('\n');
  const out = [];
  let i = 0;
  let folded = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j += 1;
    const count = j - i;
    if (count >= 3 && lines[i].trim()) {
      out.push(`${lines[i]}  …（重复 ${count} 次）`);
      folded += count - 1;
    } else {
      for (let k = i; k < j; k += 1) out.push(lines[k]);
    }
    i = j;
  }
  return { content: out.join('\n'), folded };
}

function compress(sections, options = {}) {
  const strategy = options.strategy || 'safe';
  const archive = options.archive === true;
  const compressionId = newId('cmp_');
  const original = sections.map((s) => ({ ...s }));
  const compressed = sections.map((s) => ({ ...s }));
  const actions = [];

  // 策略 A：内容完全相同的分节只留一个，来源合并到保留项。
  const seen = new Map();
  const deduped = [];
  for (const section of compressed) {
    const hash = sha(norm(section.content));
    if (!hash) { deduped.push(section); continue; }
    if (seen.has(hash)) {
      const kept = seen.get(hash);
      kept.source_refs = [...new Set([...(kept.source_refs || []), ...(section.source_refs || [])])];
      actions.push({ action: 'dedupe', removed: section.id, kept: kept.id });
      continue;
    }
    seen.set(hash, section);
    deduped.push(section);
  }

  // 策略 B：折叠重复行（L2/L3 才做）。
  if (strategy !== 'dedupe-only') {
    for (const section of deduped) {
      const layer = layerOf(section.kind);
      if (layer === 'L0' || layer === 'L1' || !section.content) continue;
      const folded = foldRepeatedLines(section.content);
      if (folded.folded > 0) {
        section.content = folded.content;
        section.token_estimate = estimateTokens(section.content);
        actions.push({ action: 'fold', section: section.id, collapsedLines: folded.folded });
      }
    }
  }

  // 策略 D/E：把 L3 原文归档，只留可恢复的引用。
  if (archive) {
    for (const section of deduped) {
      if (layerOf(section.kind) !== 'L3' || !section.content) continue;
      const before = sectionTokens(section);
      if (before < 40) { actions.push({ action: 'skip-small', section: section.id, tokens: before }); continue; }
      actions.push({ action: 'archive', section: section.id, originalTokens: before });
      section.content = `[已归档] ${section.title}：原文 ${before} tokens。恢复：rds context restore --compression ${compressionId}`;
      section.token_estimate = estimateTokens(section.content);
      section.archived = true;
    }
  }

  const beforeTokens = original.reduce((sum, s) => sum + sectionTokens(s), 0);
  const afterTokens = deduped.reduce((sum, s) => sum + sectionTokens(s), 0);

  const l0Before = original.filter((s) => layerOf(s.kind) === 'L0');
  const l0After = deduped.filter((s) => layerOf(s.kind) === 'L0');
  const l0Preserved = l0Before.every((before) => {
    const after = l0After.find((s) => s.id === before.id);
    return Boolean(after) && sha(norm(after.content)) === sha(norm(before.content));
  });

  let validationStatus = 'VALID';
  if (!l0Preserved) validationStatus = 'L0_MODIFIED';
  else if (afterTokens >= beforeTokens) validationStatus = 'NO_GAIN';

  return {
    compressionId,
    strategy,
    archive,
    original,
    compressed: deduped,
    beforeTokens,
    afterTokens,
    actions,
    l0Preserved,
    validationStatus,
  };
}

// 校验不通过时一律回退原文——宁可没压缩，也不静默丢信息。
function apply(result) {
  return result.validationStatus === 'VALID' ? result.compressed : result.original;
}

function save(db, meta, result) {
  const originalJson = JSON.stringify(result.original);
  const compressedJson = JSON.stringify(result.compressed);
  db.prepare(`INSERT INTO compressions
    (compression_id, project_id, task_id, role_id, strategy, original_hash, compressed_hash,
     before_tokens, after_tokens, original_json, compressed_json, validation_status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    result.compressionId,
    meta.project_id,
    meta.task_id || null,
    meta.role_id || null,
    result.strategy,
    sha(originalJson),
    sha(compressedJson),
    result.beforeTokens,
    result.afterTokens,
    originalJson,
    compressedJson,
    result.validationStatus,
    nowIso()
  );
  return result.compressionId;
}

function restore(db, compressionId) {
  const row = db.prepare('SELECT * FROM compressions WHERE compression_id = ?').get(compressionId);
  if (!row) throw new Error('COMPRESSION_NOT_FOUND ' + compressionId);
  if (sha(row.original_json) !== row.original_hash) {
    throw new Error('COMPRESSION_HASH_MISMATCH 原文校验失败，拒绝返回');
  }
  return {
    compression_id: row.compression_id,
    project_id: row.project_id,
    task_id: row.task_id,
    role_id: row.role_id,
    strategy: row.strategy,
    before_tokens: row.before_tokens,
    after_tokens: row.after_tokens,
    validation_status: row.validation_status,
    sections: JSON.parse(row.original_json),
  };
}

function recordRun(db, run) {
  db.prepare(`INSERT INTO context_runs
    (run_id, project_id, task_id, role_id, agent_id, model, estimated_input_tokens,
     available_input_tokens, utilization_ratio, budget_status, sections_json, layers_json,
     compression_id, before_tokens, after_tokens, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    run.run_id,
    run.project_id,
    run.task_id || null,
    run.role_id || null,
    run.agent_id || null,
    run.model || null,
    run.estimated_input_tokens,
    run.available_input_tokens === undefined ? null : run.available_input_tokens,
    run.utilization_ratio === undefined ? null : run.utilization_ratio,
    run.budget_status || null,
    JSON.stringify(run.sections || []),
    JSON.stringify(run.layers || {}),
    run.compression_id || null,
    run.before_tokens === undefined ? null : run.before_tokens,
    run.after_tokens === undefined ? null : run.after_tokens,
    nowIso()
  );
}

function listRuns(db, filter = {}) {
  const rows = filter.project_id
    ? db.prepare('SELECT * FROM context_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(filter.project_id, filter.limit || 20)
    : db.prepare('SELECT * FROM context_runs ORDER BY created_at DESC LIMIT ?').all(filter.limit || 20);
  return rows.map((row) => ({
    run_id: row.run_id,
    project_id: row.project_id,
    task_id: row.task_id,
    role_id: row.role_id,
    model: row.model,
    estimated_input_tokens: row.estimated_input_tokens,
    available_input_tokens: row.available_input_tokens,
    utilization_ratio: row.utilization_ratio,
    budget_status: row.budget_status,
    compression_id: row.compression_id,
    before_tokens: row.before_tokens,
    after_tokens: row.after_tokens,
    created_at: row.created_at,
  }));
}

function getRun(db, runId) {
  const row = db.prepare('SELECT * FROM context_runs WHERE run_id = ?').get(runId);
  if (!row) throw new Error('CONTEXT_RUN_NOT_FOUND ' + runId);
  return {
    ...row,
    sections: JSON.parse(row.sections_json),
    layers: JSON.parse(row.layers_json),
  };
}

module.exports = { analyze, compress, apply, save, restore, recordRun, listRuns, getRun, layerOf, LAYERS, foldRepeatedLines };
