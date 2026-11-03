'use strict';
// WP-4 / P6: explainable, rule-based agent orchestration with budgets and feedback.
// Deliberately deterministic: classification, routing and gating are inspectable rules.
// Learning is offline-only (`suggest`), never applied automatically.
const crypto = require('node:crypto');
const { audit } = require('./db');

const RISK_ORDER = { low: 1, medium: 2, high: 3 };

const CLASS_RULES = [
  { cls: 'architecture', words: ['架构', '设计', '选型', '接口契约', '数据模型', '路由策略'], capabilities: ['architecture', 'review'] },
  { cls: 'verification', words: ['测试', '审查', '验收', '复核', '质量'], capabilities: ['test', 'review'] },
  { cls: 'implementation', words: ['实现', '修改', '修复', '编码', '重构', '补丁'], capabilities: ['implementation', 'test'] },
  { cls: 'research', words: ['调研', '分析', '盘点', '评估'], capabilities: ['research'] }
];

const HIGH_RISK_WORDS = ['支付', '权限', '密钥', '迁移', '删除', '生产', '发布', '共享', '安全边界', '跨项目'];
const MEDIUM_RISK_WORDS = ['数据库', '接口', '依赖', '外部', '并发', '回滚'];

// Minimal built-in capability registry; external registries can be merged in.
const DEFAULT_AGENTS = [
  { role_id: 'R0', capabilities: ['coordination', 'approval'], max_risk: 'high', projects: ['*'] },
  { role_id: 'R1', capabilities: ['architecture', 'review'], max_risk: 'medium', projects: ['*'] },
  { role_id: 'R2', capabilities: ['implementation'], max_risk: 'medium', projects: ['*'] },
  { role_id: 'R3', capabilities: ['test'], max_risk: 'medium', projects: ['*'] },
  { role_id: 'R4', capabilities: ['review'], max_risk: 'high', projects: ['*'] },
  { role_id: 'R5', capabilities: ['research'], max_risk: 'low', projects: ['*'] },
  { role_id: 'R6', capabilities: ['analysis'], max_risk: 'medium', projects: ['*'] },
  { role_id: 'R7', capabilities: ['release'], max_risk: 'medium', projects: ['*'] }
];

const DEFAULT_BUDGET = { task_tokens: 200000, session_tokens: 1000000, project_tokens_per_day: 5000000 };

function classify(input) {
  const text = [input.objective, input.title, input.description].filter(Boolean).join(' ');
  const rules = CLASS_RULES.filter((r) => r.words.some((w) => text.includes(w)));
  const task_class = rules.length ? rules[0].cls : 'research';
  const capabilities = rules.length ? rules[0].capabilities : ['research'];
  let risk = 'low';
  if (HIGH_RISK_WORDS.some((w) => text.includes(w)) || input.risk_hint === 'high') risk = 'high';
  else if (MEDIUM_RISK_WORDS.some((w) => text.includes(w)) || input.risk_hint === 'medium') risk = 'medium';
  const sensitivity = input.sensitive || risk === 'high' ? 'restricted' : 'internal';
  return {
    task_class,
    risk,
    sensitivity,
    required_capabilities: capabilities,
    acceptance_mode: task_class === 'verification' ? 'review' : task_class === 'implementation' ? 'test+review' : 'review',
    rationale: [
      '分类依据关键词：' + (rules.length ? rules[0].words.filter((w) => text.includes(w)).join('、') : '无匹配，默认研究类'),
      '风险等级：' + risk + '（' + (risk === 'high' ? '命中高风险关键词' : risk === 'medium' ? '命中中风险关键词' : '未命中风险关键词') + '）',
      '敏感度：' + sensitivity
    ]
  };
}

function validateProject(project_id, allowed_projects) {
  if (!project_id) throw new Error('PROJECT_REQUIRED');
  if (!Array.isArray(allowed_projects) || allowed_projects.length === 0) throw new Error('PROJECT_UNKNOWN');
  if (!allowed_projects.includes(project_id)) throw new Error('PROJECT_DENIED');
}

function pickAgents(task_class, risk, registry) {
  const need = {
    architecture: ['R1'],
    implementation: ['R2', 'R3'],
    verification: ['R3'],
    research: ['R5']
  }[task_class] || [];
  let chosen = [...need];
  if (risk === 'high') {
    // High risk always escalates to R0 approval + R4 review; under-privileged
    // execution roles are replaced rather than silently used.
    chosen = ['R0', ...chosen.filter((r) => (registry.find((a) => a.role_id === r) || {}).max_risk === 'high'), 'R4'];
    chosen = [...new Set(chosen)];
  } else if (risk === 'medium' && !chosen.includes('R4')) {
    chosen.push('R4');
  }
  if (chosen.length === 0) throw new Error('AGENT_UNAVAILABLE');
  for (const role of chosen) {
    const agent = registry.find((a) => a.role_id === role);
    if (!agent) throw new Error('AGENT_UNAVAILABLE:' + role);
    if (RISK_ORDER[risk] > RISK_ORDER[agent.max_risk || 'low']) {
      // escalate instead of silently using an under-privileged agent
      throw new Error('AGENT_RISK_MISMATCH:' + role);
    }
  }
  return chosen;
}

function plan(input, { registry = DEFAULT_AGENTS, allowed_projects = [] } = {}) {
  validateProject(input.project_id, allowed_projects);
  const cls = classify(input);
  const agents = pickAgents(cls.task_class, cls.risk, registry);
  const budget = Object.assign({}, DEFAULT_BUDGET, input.budget || {});
  const per_agent = Math.max(500, Math.floor(budget.task_tokens / agents.length));
  const planObj = {
    plan_id: 'pln_' + crypto.randomUUID().slice(0, 12),
    task_id: input.task_id || 'task_' + Date.now(),
    project_id: input.project_id,
    task_class: cls.task_class,
    risk: cls.risk,
    sensitivity: cls.sensitivity,
    agents: agents.map((role) => ({
      role_id: role,
      reason: explainRole(role, cls.task_class, cls.risk),
      required: true
    })),
    context_policy: {
      per_agent_budget: per_agent,
      task_budget: budget.task_tokens,
      session_budget: budget.session_tokens,
      memory_types: cls.task_class === 'implementation' ? ['L2', 'L3', 'L4'] : ['L3', 'L4'],
      evidence_direct: agents.includes('R4') || agents.includes('R3')
    },
    gates: {
      requires_r4: agents.includes('R4'),
      requires_human_approval: cls.risk === 'high',
      approval_scope: cls.risk === 'high' ? ['high_risk_write', 'permission_change', 'data_migration', 'cross_project_share'] : [],
      stop_on_budget_exceeded: true
    },
    explanation: [
      ...cls.rationale,
      '最小充分 Agent 集合：' + agents.join('、'),
      '质量门：' + (agents.includes('R4') ? '包含 R4 独立审查' : '低风险，无需 R4'),
      '预算：task=' + budget.task_tokens + ' tokens, 每 Agent=' + per_agent
    ]
  };
  return planObj;
}

function explainRole(role, taskClass, risk) {
  const map = {
    R0: '高风险任务需要总控审批与范围控制',
    R1: '架构/契约类任务由 R1 负责',
    R2: '实现类任务由 R2 负责',
    R3: '需要独立测试/验证',
    R4: '风险等级 ' + risk + '，需要独立审查',
    R5: '研究类任务由 R5 承担'
  };
  return map[role] || '按任务类别 ' + taskClass + ' 分配';
}

function startRun(db, planObj, { principal_id } = {}) {
  const run_id = 'run_' + crypto.randomUUID().slice(0, 12);
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO orchestrator_runs
    (run_id, project_id, task_id, task_class, risk, plan_json, agents_json, budget_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    run_id, planObj.project_id, planObj.task_id, planObj.task_class, planObj.risk,
    JSON.stringify(planObj), JSON.stringify(planObj.agents), JSON.stringify(planObj.context_policy),
    planObj.gates.requires_human_approval ? 'awaiting_approval' : 'running', ts, ts
  );
  audit(db, {
    principal_id: principal_id || 'orchestrator', project_id: planObj.project_id, role_id: 'R0',
    action: 'orchestrator.plan', target: run_id, result: planObj.gates.requires_human_approval ? 'awaiting_approval' : 'running',
    reason: planObj.task_class + '/' + planObj.risk
  });
  return { run_id, status: planObj.gates.requires_human_approval ? 'awaiting_approval' : 'running' };
}

function approveRun(db, run_id, { approver, reason } = {}) {
  if (!approver) throw new Error('APPROVER_REQUIRED');
  const row = db.prepare('SELECT * FROM orchestrator_runs WHERE run_id = ?').get(run_id);
  if (!row) throw new Error('RUN_NOT_FOUND');
  if (row.status !== 'awaiting_approval') throw new Error('INVALID_RUN_STATE');
  db.prepare('UPDATE orchestrator_runs SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE run_id = ?')
    .run('running', approver, new Date().toISOString(), new Date().toISOString(), run_id);
  audit(db, { principal_id: approver, project_id: row.project_id, role_id: 'R0', action: 'orchestrator.approve', target: run_id, result: 'running', reason: reason || null });
  return { run_id, status: 'running', approved_by: approver };
}

function recordFeedback(db, run_id, feedback) {
  const row = db.prepare('SELECT * FROM orchestrator_runs WHERE run_id = ?').get(run_id);
  if (!row) throw new Error('RUN_NOT_FOUND');
  if (row.status === 'awaiting_approval') throw new Error('NOT_APPROVED');
  const budget = JSON.parse(row.budget_json);
  const taskBudget = Number(budget.task_tokens != null ? budget.task_tokens : budget.task_budget);
  const tokens = Number(feedback.tokens_total || 0);
  const exceeded = tokens > taskBudget;
  const status = exceeded ? 'paused_budget' : (feedback.status || 'completed');
  const fb = {
    tokens_input: Number(feedback.tokens_input || 0),
    tokens_output: Number(feedback.tokens_output || 0),
    tokens_cache_read: Number(feedback.tokens_cache_read || 0),
    tokens_total: tokens,
    agents_used: feedback.agents_used || [],
    quality_score: feedback.quality_score == null ? null : Number(feedback.quality_score),
    rework_count: Number(feedback.rework_count || 0),
    duration_ms: Number(feedback.duration_ms || 0),
    failure_reason: feedback.failure_reason || null,
    recorded_at: new Date().toISOString()
  };
  db.prepare('UPDATE orchestrator_runs SET status = ?, feedback_json = ?, updated_at = ? WHERE run_id = ?')
    .run(status, JSON.stringify(fb), new Date().toISOString(), run_id);
  audit(db, { principal_id: 'orchestrator', project_id: row.project_id, role_id: 'R0', action: 'orchestrator.feedback', target: run_id, result: status, reason: exceeded ? 'BUDGET_EXCEEDED' : null });
  return { run_id, status, tokens_total: tokens, task_budget: budget.task_tokens };
}

function budgetStatus(db, run_id) {
  const row = db.prepare('SELECT * FROM orchestrator_runs WHERE run_id = ?').get(run_id);
  if (!row) throw new Error('RUN_NOT_FOUND');
  const budget = JSON.parse(row.budget_json);
  const taskBudget = Number(budget.task_tokens != null ? budget.task_tokens : budget.task_budget);
  const sessionBudget = Number(budget.session_tokens != null ? budget.session_tokens : taskBudget);
  const fb = row.feedback_json ? JSON.parse(row.feedback_json) : null;
  const used = fb ? fb.tokens_total : 0;
  return {
    run_id,
    used,
    task_budget: taskBudget,
    session_budget: sessionBudget,
    remaining: Math.max(0, taskBudget - used),
    exceeded: used > taskBudget,
    paused: row.status === 'paused_budget'
  };
}

// Offline-only learning: aggregates history into suggestions; nothing is applied.
function suggest(db, { project_id } = {}) {
  const sql = "SELECT * FROM orchestrator_runs WHERE status IN ('completed','paused_budget')" + (project_id ? ' AND project_id = ?' : '');
  const rows = db.prepare(sql).all(...(project_id ? [project_id] : []));
  const by = new Map();
  for (const r of rows) {
    if (!r.feedback_json) continue;
    const fb = JSON.parse(r.feedback_json);
    const key = r.task_class + '/' + r.risk;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(fb);
  }
  const suggestions = [];
  for (const [key, list] of by) {
    const avgTokens = Math.round(list.reduce((n, f) => n + f.tokens_total, 0) / list.length);
    const avgQuality = list.filter((f) => f.quality_score != null).reduce((n, f, _i, arr) => n + f.quality_score / arr.length, 0);
    const rework = list.reduce((n, f) => n + f.rework_count, 0) / list.length;
    suggestions.push({
      pattern: key,
      runs: list.length,
      avg_tokens: avgTokens,
      avg_quality: Number(avgQuality.toFixed(3)),
      avg_rework: Number(rework.toFixed(2)),
      suggestion: rework > 0.5 ? '考虑增加 R3/R4 提前介入或拆分任务' : (avgTokens > 150000 ? '任务偏大，建议拆分或收紧上下文预算' : '维持当前路由')
    });
  }
  return { mode: 'suggestion_only', applied: false, suggestions };
}

module.exports = {
  classify, plan, startRun, approveRun, recordFeedback, budgetStatus, suggest,
  DEFAULT_AGENTS, DEFAULT_BUDGET, RISK_ORDER
};
