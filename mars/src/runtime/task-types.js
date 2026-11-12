'use strict';
// 统一任务类型（M15-1）。
//
// 解决的问题：M11 的调度只认关键词，把「实现…并补测试」判成 verification。
// 做法：显式声明八种任务类型，每种类型固定「用哪些工作流 / 谁负责 / 要什么证据」。
// 关键词只用于**建议类型**，真正决定流程的是 task_type 字段——可被审计、可被测试。
//
// 强度说明：这是规则表 + 代码校验，不是意图理解。类型判错时人会看到，
// 而不是被悄悄按错流程执行。

const { ROLES } = require('../collab');

/** 八种任务类型。workflows 为空表示不涉及 REA。 */
const TASK_TYPES = {
  development: {
    label: '软件研发',
    default_role: 'R2',
    chain: ['R1', 'R2', 'R3', 'R4'],
    workflows: [],
    evidence_required: ['test'],
    note: '设计与实施与验证与评审四棒'
  },
  code_analysis: {
    label: '代码库分析',
    default_role: 'R5',
    chain: ['R5', 'R4'],
    workflows: ['W-01'],
    evidence_required: ['rea_report', 'sample_hash'],
    note: '分析结论必须经 R4 复核才能交给研发'
  },
  binary_analysis: {
    label: '二进制静态分析',
    default_role: 'R5',
    chain: ['R5', 'R4'],
    workflows: ['W-02', 'W-04'],
    evidence_required: ['rea_report', 'sample_hash', 'tool_version'],
    note: '结构事实 + 调用图；反编译需 Ghidra，本环境不可用'
  },
  apk_analysis: {
    label: 'APK 静态分析',
    default_role: 'R5',
    chain: ['R5', 'R4'],
    workflows: ['W-03'],
    evidence_required: ['rea_report', 'sample_hash'],
    note: '缺 jadx 时为 BLOCKED，只能给包结构'
  },
  callgraph_analysis: {
    label: '调用链分析',
    default_role: 'R5',
    chain: ['R5'],
    workflows: ['W-04'],
    evidence_required: ['rea_report', 'sample_hash'],
    note: '静态推断，不含间接调用目标'
  },
  network_analysis: {
    label: '网络流量分析',
    default_role: 'R5',
    chain: ['R5', 'R4'],
    workflows: ['W-05'],
    evidence_required: ['rea_report', 'sample_hash'],
    note: '不解密 TLS；样本若为合成必须标注'
  },
  dynamic_analysis: {
    label: '动态分析',
    default_role: 'R6',
    chain: ['R6', 'R4'],
    workflows: ['W-06'],
    evidence_required: ['rea_report', 'authorization'],
    note: '必须有授权声明；本环境缺 frida 故 BLOCKED'
  },
  security_review: {
    label: '安全审查',
    default_role: 'R6',
    chain: ['R6', 'R4'],
    workflows: ['W-02', 'W-05'],
    evidence_required: ['rea_report', 'sample_hash', 'tool_version'],
    note: '只给事实与启发式，不做恶意判定'
  }
};

const TYPE_IDS = Object.keys(TASK_TYPES);

function get(type) {
  const t = TASK_TYPES[type];
  if (!t) {
    const err = new Error('TASK_TYPE_UNKNOWN ' + type + '（可用：' + TYPE_IDS.join(',') + '）');
    err.code = 'TASK_TYPE_UNKNOWN';
    throw err;
  }
  return { task_type: type, ...t };
}

function list() {
  return TYPE_IDS.map((id) => ({ task_type: id, ...TASK_TYPES[id] }));
}

/**
 * 关键词只用于「建议」，不用于决定流程。
 * 返回 {suggested, reason}，调用方可以忽略。
 */
function suggest(objective) {
  const text = String(objective || '');
  const rules = [
    [/pcap|流量|抓包|网络包/i, 'network_analysis'],
    [/apk|安卓|android/i, 'apk_analysis'],
    [/反编译|二进制|样本|binar/i, 'binary_analysis'],
    [/调用链|call\s*chain/i, 'callgraph_analysis'],
    [/frida|插桩|动态/i, 'dynamic_analysis'],
    [/安全|漏洞|风险/i, 'security_review'],
    [/理解|读懂|梳理|代码库/i, 'code_analysis'],
    [/实现|开发|重构|修复|新增/i, 'development']
  ];
  for (const [re, type] of rules) {
    if (re.test(text)) return { suggested: type, reason: '关键词命中 ' + re.source };
  }
  return { suggested: 'development', reason: '无关键词命中，默认 development' };
}

/**
 * 校验某工作流是否属于该任务类型。
 * 这是 M15-1 的代码强制点：类型为 binary_analysis 的任务不能悄悄跑 W-05。
 */
function assertWorkflowAllowed(type, workflowId) {
  const t = get(type);
  const wf = String(workflowId).toUpperCase();
  if (!t.workflows.length) {
    throw new Error('TASK_TYPE_NO_WORKFLOW ' + type + ' 是研发类任务，不涉及 REA 工作流');
  }
  if (!t.workflows.includes(wf)) {
    throw new Error(`WORKFLOW_NOT_IN_TASK_TYPE ${type} 只允许 ${t.workflows.join(',')}，收到 ${wf}`);
  }
  return true;
}

/** 该类型需要的证据是否齐备。缺什么就明说，不默认通过。 */
function checkEvidence(type, provided = {}) {
  const t = get(type);
  const missing = t.evidence_required.filter((k) => !provided[k]);
  return { ok: missing.length === 0, required: t.evidence_required, missing };
}

/** 角色是否能承接该任务类型（角色必须在类型声明的链上，或具备管理权）。 */
function assertRoleCanOwn(type, roleId) {
  const t = get(type);
  if (!ROLES[roleId]) return { ok: false, reason: 'ROLE_UNKNOWN' };
  if (roleId === 'R0') return { ok: true, reason: 'COORDINATOR' };
  if (t.chain.includes(roleId)) return { ok: true, reason: 'IN_CHAIN' };
  return { ok: false, reason: `角色 ${roleId} 不在 ${type} 的链上（${t.chain.join(',')}）` };
}

module.exports = {
  TASK_TYPES, TYPE_IDS, get, list, suggest, assertWorkflowAllowed, checkEvidence, assertRoleCanOwn
};

// ---------------------------------------------------------------- 按类型建任务

const collab = require('../collab');

/**
 * 按任务类型建任务树：一个父任务 + 类型声明的角色链各一个子任务。
 * 与 collab.planTasks（关键词拆分）并行存在：给了 --type 就走这里，结果更可预测。
 */
function planByType(db, input) {
  const t = get(input.task_type);
  const objective = String(input.objective || '').trim();
  if (!objective) throw new Error('OBJECTIVE_REQUIRED');

  const parent = collab.createTask(db, {
    project_id: input.project_id,
    title: objective,
    description: t.note,
    assigned_role: 'R0',
    input_context: { task_type: input.task_type, workflows: t.workflows },
    actor: input.actor || 'system'
  });

  const tasks = t.chain.map((role, i) => collab.createTask(db, {
    project_id: input.project_id,
    parent_task_id: parent.task_id,
    title: `${t.label} · ${role}`,
    description: i === 0 && t.workflows.length
      ? `执行 ${t.workflows.join(' / ')}；证据要求：${t.evidence_required.join(', ')}`
      : t.note,
    assigned_role: role,
    acceptance_criteria: i === t.chain.length - 1 ? '证据齐备且复核通过' : null,
    input_context: { task_type: input.task_type, order: i },
    actor: input.actor || 'system'
  }));

  return {
    task_type: input.task_type,
    label: t.label,
    parent: { task_id: parent.task_id, title: parent.title },
    tasks: tasks.map((x) => ({ task_id: x.task_id, title: x.title, assigned_role: x.assigned_role, status: x.status })),
    chain: t.chain,
    workflows: t.workflows,
    evidence_required: t.evidence_required,
    suggestion: suggest(objective),
    note: t.note
  };
}

module.exports.planByType = planByType;
