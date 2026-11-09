'use strict';
const { nowIso, newId, estimateTokens, clampInt } = require('./util');
const { validate } = require('./validate');
const { audit } = require('./db');
const { retrieve } = require('./retrieval');
const { applyBudget } = require('./budget');
const DEFAULT_PROTECTIONS = ['task', 'decisions', 'evidence', 'prohibitions'];
const { buildManifest } = require('./manifest');
const { authorize, roleProfile } = require('./authz');
const { AppError } = require('./errors');

// M3 / B1：packet schema 由调用方注入（params.assets），模块不再在加载期读盘。
function resolvePacketSchema(params) {
  const assets = params && params.assets;
  if (!assets || typeof assets.contract !== 'function') {
    throw new AppError('ASSET_MISSING', 'context-packet schema 未注入（调用方需传 params.assets）');
  }
  return assets.contract('context-packet').value;
}

function sectionFromMemories(kind, title, records) {
  const lines = records.map(r => `- [${r.memory_id}] (${r.memory_type}, ${r.source_project ? r.source_project + ':' : ''}${r.source_ref}@${r.source_version}) ${r.content}`);
  return {
    id: 'sec_' + kind,
    title,
    kind,
    content: lines.join('\n'),
    token_estimate: estimateTokens(lines.join('\n')),
    source_refs: records.map(r => `${r.source_ref}@${r.source_version}`),
    source_version: records[0] ? (records[0].source_version || 'current') : 'current',
    visibility: records[0] ? (records[0].visibility || 'project') : 'project',
    status: records[0] ? (records[0].status || 'approved') : 'approved'
  };
}

function compileContext(db, principal, routing, params) {
  const project_id = params.project_id;
  const role_id = params.role_id;
  const check = authorize(principal, { project_id, role_id, action: 'context.compile', routing });
  if (!check.ok) throw new Error('AUTHZ_DENIED ' + check.reason);
  const profile = roleProfile(routing, role_id);
  const budget = clampInt(params.budget || profile.budget_default, 256, 200000);
  const task = params.task || {};
  const sections = [];
  const missing = [];

  sections.push({
    id: 'sec_task',
    title: '任务要求',
    kind: 'task',
    content: [
      `任务: ${task.id || params.task_id || 'UNKNOWN'}`,
      task.objective ? `目标: ${task.objective}` : null,
      Array.isArray(task.acceptance) && task.acceptance.length ? '验收标准:\n' + task.acceptance.map(a => '- ' + a).join('\n') : null,
      Array.isArray(task.scope) && task.scope.length ? '范围: ' + task.scope.join(', ') : null
    ].filter(Boolean).join('\n'),
    token_estimate: 0,
    source_refs: [task.source_ref || 'task-card:' + (task.id || 'unknown')]
  });

  if (params.state) {
    sections.push({ id: 'sec_state', title: '当前状态', kind: 'state', content: String(params.state), token_estimate: 0, source_refs: ['state:current'] });
  } else {
    missing.push({ kind: 'state', description: '未提供当前任务状态', blocking: false });
  }

  const query = params.query || task.query || '';
  const facts = retrieve(db, principal, role_id, routing, { project_id, query, type: 'L2', limit: 20 });
  if (facts.length) sections.push(sectionFromMemories('facts', '相关项目事实', facts));
  else missing.push({ kind: 'facts', description: '无 approved L2 事实', blocking: false });

  const decisions = retrieve(db, principal, role_id, routing, { project_id, query, type: 'L3', limit: 11 });
  if (decisions.length) sections.push(sectionFromMemories('decisions', '已批准决策', decisions));
  else missing.push({ kind: 'decisions', description: '无 approved L3 决策', blocking: true });

  const knowledge = retrieve(db, principal, role_id, routing, { project_id, query, type: 'L4', limit: 8 });
  if (knowledge.length) sections.push(sectionFromMemories('knowledge', '必要知识', knowledge));

  const prohibitions = (profile.prohibited || []).concat(params.prohibitions || []);
  if (prohibitions.length) {
    sections.push({
      id: 'sec_prohibitions', title: '禁止事项', kind: 'prohibitions',
      content: prohibitions.map(p => '- ' + p).join('\n'), token_estimate: 0, source_refs: ['role-routing:' + role_id]
    });
  }

  const evidence = Array.isArray(params.evidence) ? params.evidence : [];
  const evidenceSection = {
    id: 'sec_evidence', title: '证据引用', kind: 'evidence',
    content: evidence.length
      ? evidence.map(e => `- ${e.ref} [${e.kind || 'file'}]${e.note ? ' — ' + e.note : ''}`).join('\n') +
        (profile.evidence_direct ? '\n（本角色可直接访问原始证据）' : '\n（本角色仅见引用，原始证据由 R0/R3/R4 提供）')
      : '（未提供证据引用）',
    token_estimate: 0, source_refs: evidence.map(e => e.ref)
  };
  sections.push(evidenceSection);
  if (profile.evidence_direct && evidence.length === 0) {
    missing.push({ kind: 'evidence', description: '本角色需要可直接访问的原始证据，但未提供', blocking: true });
  }

  const budgeted = applyBudget(sections, { budget, protections: profile.protections || DEFAULT_PROTECTIONS });
  const tokens = budgeted.tokens;
  const manifest = buildManifest(db, {
    project_id, task_id: task.id || params.task_id || 'UNKNOWN', role_id,
    run_id: params.run_id, session_id: params.session_id,
    token_budget: budget, tokens_estimated: tokens,
    assets: params.assets
  }, budgeted.sections.map(s => ({
    ...s,
    visibility: s.visibility || 'project',
    source_version: s.source_version || params.source_version || 'current'
  })));

  const packet = {
    packet_id: newId('pkt_'),
    manifest_id: manifest.manifest_id,
    project_id, task_id: task.id || params.task_id || 'UNKNOWN', role_id,
    role_profile: profile.role_name || role_id,
    created_at: nowIso(),
    compiler_version: 'mars-compiler/0.1.0',
    token_budget: budget,
    tokens_estimated: tokens,
    estimate_label: '[ESTIMATE]',
    sections: budgeted.sections.map(s => ({
      id: s.id, title: s.title, kind: s.kind,
      content: s.content, token_estimate: s.token_estimate,
      source_refs: s.source_refs || [], truncated: Boolean(s.truncated) || budgeted.truncated.includes(s.id)
    })),
    missing,
    prohibited: prohibitions,
    evidence_refs: evidence.map(e => Object.assign({ ref: e.ref, kind: e.kind || 'file' }, e.note ? { note: e.note } : {}))
  };
  const result = validate(packet, resolvePacketSchema(params));
  if (!result.valid) {
    const head = result.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error('PACKET_SCHEMA_INVALID ' + head);
  }
  audit(db, {
    principal_id: principal.principal_id, project_id, role_id,
    action: 'context.compile', target: packet.packet_id,
    result: `tokens=${tokens}/${budget} missing=${missing.length}`
  });
  return { packet, manifest, budget: budgeted };
}

module.exports = { compileContext, resolvePacketSchema };
