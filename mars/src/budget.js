'use strict';
const { estimateTokens, clampInt } = require('./util');

const KIND_PRIORITY = { prohibitions: 0, task: 1, state: 2, decisions: 3, facts: 4, evidence: 5, knowledge: 6, reference: 7 };

function isProtected(section, protections) {
  if (section.protected === true) return true;
  return Array.isArray(protections) && protections.includes(section.kind);
}

function applyBudget(sections, { budget, protections = [] } = {}) {
  const limit = clampInt(budget, 0, 2_000_000);
  const prepared = sections.map(s => ({
    ...s,
    token_estimate: (Number(s.token_estimate) > 0) ? Number(s.token_estimate) : estimateTokens(s.content || ''),
    protected: isProtected(s, protections),
    truncated: false
  }));
  const total = prepared.reduce((sum, s) => sum + s.token_estimate, 0);
  if (total <= limit) {
    return { sections: prepared, tokens: total, truncated: [], protected_kept: prepared.filter(s => s.protected).map(s => s.id), over_budget: false };
  }
  const kept = prepared.filter(s => s.protected);
  const candidates = prepared.filter(s => !s.protected)
    .sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9) || a.token_estimate - b.token_estimate);
  let used = kept.reduce((sum, s) => sum + s.token_estimate, 0);
  const truncated = [];
  for (const section of candidates) {
    if (used + section.token_estimate <= limit) {
      kept.push(section);
      used += section.token_estimate;
    } else {
      truncated.push(section.id);
    }
  }
  const order = new Map(prepared.map((s, i) => [s.id, i]));
  kept.sort((a, b) => order.get(a.id) - order.get(b.id));
  return {
    sections: kept,
    tokens: kept.reduce((sum, s) => sum + s.token_estimate, 0),
    truncated,
    protected_kept: kept.filter(s => s.protected).map(s => s.id),
    over_budget: used > limit,
    note: used > limit ? 'PROTECTED_SECTIONS_EXCEED_BUDGET' : undefined
  };
}

module.exports = { applyBudget, KIND_PRIORITY, isProtected };
