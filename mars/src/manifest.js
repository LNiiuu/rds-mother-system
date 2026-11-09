'use strict';
const { sha256, nowIso, newId, stableJson } = require('./util');
const { validate } = require('./validate');
const { audit } = require('./db');
const { AppError } = require('./errors');

const TYPE_MAP = { facts: 'fact', decisions: 'decision', prohibitions: 'prohibition', task: 'task', state: 'state', knowledge: 'knowledge', evidence: 'evidence', reference: 'reference' };

// M3 / B1：manifest schema 由调用方注入（meta.assets），模块不再在加载期读盘。
function resolveManifestSchema(meta) {
  const assets = meta && meta.assets;
  if (!assets || typeof assets.contract !== 'function') {
    throw new AppError('ASSET_MISSING', 'manifest schema 未注入（调用方需传 meta.assets）');
  }
  return assets.contract('manifest').value;
}

function assertManifest(manifest, schema) {
  if (!schema) throw new AppError('ASSET_MISSING', 'manifest schema 未注入');
  const result = validate(manifest, schema);
  if (!result.valid) {
    const head = result.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error('MANIFEST_SCHEMA_INVALID ' + head);
  }
}

function upsertFragment(db, project_id, entry, content) {
  const content_hash = entry.content_hash;
  const fragment_id = 'frag_' + sha256(project_id + '|' + entry.content_type + ':' + content_hash).slice(0, 12);
  const existing = db.prepare('SELECT * FROM fragments WHERE project_id = ? AND content_hash = ? AND content_type = ?')
    .get(project_id, content_hash, entry.content_type);
  if (existing) {
    db.prepare('UPDATE fragments SET ref_count = ref_count + 1 WHERE fragment_id = ?').run(existing.fragment_id);
    return { fragment_id: existing.fragment_id, content_hash, content_type: entry.content_type, content_length: existing.content_length, ref_count: existing.ref_count + 1, original_ref: existing.original_ref };
  }
  db.prepare(`INSERT INTO fragments (fragment_id, project_id, content_hash, content_type, content_length, original_ref, content, created_at, ref_count)
              VALUES (?,?,?,?,?,?,?,?,1)`).run(
    fragment_id, project_id, content_hash, entry.content_type, content.length, entry.source_ref, content, nowIso()
  );
  return { fragment_id, content_hash, content_type: entry.content_type, content_length: content.length, ref_count: 1, original_ref: entry.source_ref };
}

function buildManifest(db, meta, sections) {
  const entries = [];
  const fragments = [];
  for (const section of sections) {
    const content = section.content || '';
    const body = content || stableJson({ empty: section.id });
    const content_hash = sha256(body);
    const entry = {
      source_ref: (section.source_refs && section.source_refs[0]) || 'packet:' + section.id,
      source_version: String(section.source_version || meta.source_version || 'v0'),
      content_hash,
      content_type: TYPE_MAP[section.kind] || 'reference',
      inclusion_reason: section.inclusion_reason || section.title || 'compiled',
      token_estimate: section.token_estimate || 0,
      visibility: section.visibility || 'project',
      status: section.status || 'approved',
      section: section.id
    };
    if (content) {
      const fragment = upsertFragment(db, meta.project_id, { ...entry, content_type: entry.content_type }, content);
      entry.fragment_id = fragment.fragment_id;
      fragments.push(fragment);
    }
    entries.push(entry);
  }
  const manifest = {
    manifest_id: newId('man_'),
    project_id: meta.project_id,
    task_id: meta.task_id,
    role_id: meta.role_id,
    run_id: meta.run_id || undefined,
    session_id: meta.session_id || undefined,
    created_at: nowIso(),
    token_budget: meta.token_budget,
    tokens_estimated: meta.tokens_estimated,
    estimate_label: '[ESTIMATE]',
    entries,
    fragments
  };
  // 可选字段为空时移除，保持 additionalProperties=false 兼容
  for (const key of ['run_id', 'session_id']) if (manifest[key] === undefined) delete manifest[key];
  assertManifest(manifest, resolveManifestSchema(meta));
  db.prepare(`INSERT INTO manifests (manifest_id, project_id, task_id, role_id, run_id, session_id, created_at, token_budget, tokens_estimated, entries_json, fragments_json)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    manifest.manifest_id, manifest.project_id, manifest.task_id, manifest.role_id,
    manifest.run_id || null, manifest.session_id || null, manifest.created_at,
    manifest.token_budget, manifest.tokens_estimated,
    JSON.stringify(entries), JSON.stringify(fragments)
  );
  return manifest;
}

function restoreFragment(db, principal, role_id, project_id, fragment_id, routing) {
  if (!principal || !Array.isArray(principal.project_ids) || !principal.project_ids.includes(project_id)) {
    throw new Error('PROJECT_DENIED');
  }
  const row = db.prepare('SELECT * FROM fragments WHERE fragment_id = ?').get(fragment_id);
  if (!row || row.project_id !== project_id) throw new Error('FRAGMENT_NOT_FOUND');
  if (!Array.isArray(principal.roles) || !principal.roles.includes(role_id)) throw new Error('ROLE_DENIED');
  const profile = routing && ((routing.roles || {})[role_id] || routing.default);
  const evidenceDirect = !!(profile && profile.evidence_direct);
  if (!evidenceDirect) throw new Error('EVIDENCE_DENIED');
  audit(db, {
    principal_id: principal.principal_id,
    project_id,
    role_id,
    action: 'memory.get',
    target: fragment_id,
    result: 'restore'
  });
  return { content: row.content, content_hash: row.content_hash, original_ref: row.original_ref, content_type: row.content_type };
}

function manifestByFragment(db, fragment_id) {
  const rows = db.prepare('SELECT manifest_id, entries_json FROM manifests').all();
  return rows.filter(r => r.entries_json.includes(fragment_id)).map(r => r.manifest_id);
}

module.exports = { buildManifest, restoreFragment, manifestByFragment, assertManifest, resolveManifestSchema };
