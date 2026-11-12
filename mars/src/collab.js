'use strict';
// M11：角色、任务状态机、确定性调度、交接与成本账本。
//
// 能力强度必须说清楚：
//   - 角色权限表是**代码校验**（新命令都走 assertPermission）
//   - 它不是进程级沙箱：同一个人拿到 token 就能切换角色
//   - R7 只有本地提交权限，没有 push 权限；远程操作永远需要人

const { nowIso, newId } = require('./util');

const ROLES = {
  R0: {
    name: '协调者',
    duty: '任务拆分、上下文分发、协调',
    permissions: ['project.create', 'project.remove', 'task.plan', 'task.create', 'task.assign', 'context.compile', 'context.compress', 'context.restore', 'handoff.create', 'cost.record', 'cost.read', 'memory.write', 'tool.read_file', 'tool.list_dir'],
    forbidden: ['memory.review', 'git.push', 'release'],
  },
  R1: {
    name: '架构师',
    duty: '架构与接口设计',
    permissions: ['context.compile', 'context.restore', 'handoff.create', 'memory.write', 'cost.record', 'tool.read_file', 'tool.list_dir', 'tool.write_file'],
    forbidden: ['git.push', 'release', 'task.assign'],
  },
  R2: {
    name: '实施者',
    duty: '代码与接口实现',
    permissions: ['context.compile', 'context.restore', 'handoff.create', 'memory.write', 'cost.record', 'tool.read_file', 'tool.list_dir', 'tool.write_file', 'tool.run_test'],
    forbidden: ['memory.review', 'git.push', 'release'],
  },
  R3: {
    name: '验证者',
    duty: '测试与验收',
    permissions: ['context.compile', 'context.restore', 'handoff.create', 'memory.write', 'cost.record', 'tool.read_file', 'tool.list_dir', 'tool.run_test'],
    forbidden: ['memory.review', 'git.push', 'release'],
  },
  R4: {
    name: '评审者',
    duty: '需求核对与变更审查',
    permissions: ['memory.review', 'context.compile', 'context.restore', 'handoff.create', 'cost.read', 'tool.read_file', 'tool.list_dir'],
    forbidden: ['git.push', 'release'],
  },
  R5: {
    name: '研究者',
    duty: '技术调研与证据收集',
    permissions: ['context.compile', 'context.restore', 'handoff.create', 'memory.write', 'cost.record', 'tool.read_file', 'tool.list_dir'],
    forbidden: ['git.push', 'release', 'memory.review'],
  },
  R6: {
    name: '安全审查',
    duty: '风险与权限检查',
    permissions: ['context.compile', 'context.restore', 'handoff.create', 'cost.read', 'tool.read_file', 'tool.list_dir'],
    forbidden: ['git.push', 'release', 'memory.review'],
  },
  R7: {
    name: '交付管理',
    duty: '本地 Git 与版本整理',
    permissions: ['git.status', 'git.commit', 'context.compile', 'context.restore', 'handoff.create', 'tool.read_file', 'tool.list_dir'],
    forbidden: ['git.push', 'release', 'memory.review'],
  },
};

function role(id) {
  if (!ROLES[id]) throw new Error('ROLE_UNKNOWN ' + id);
  return { role_id: id, ...ROLES[id] };
}

function listRoles() {
  return Object.keys(ROLES).map((id) => ({ role_id: id, ...ROLES[id] }));
}

function assertPermission(roleId, action) {
  const profile = ROLES[roleId];
  if (!profile) throw new Error('ROLE_UNKNOWN ' + roleId);
  if (!profile.permissions.includes(action)) {
    throw new Error(`ROLE_DENIED ${roleId} 没有 ${action} 权限`);
  }
  return true;
}

const TASK_STATUS = ['CREATED', 'PLANNED', 'READY', 'ASSIGNED', 'RUNNING', 'BLOCKED', 'REVIEW_PENDING', 'VERIFICATION_PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const TRANSITIONS = {
  CREATED: ['PLANNED', 'CANCELLED', 'FAILED'],
  PLANNED: ['READY', 'ASSIGNED', 'CANCELLED', 'FAILED'],
  READY: ['ASSIGNED', 'CANCELLED', 'FAILED'],
  ASSIGNED: ['RUNNING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  RUNNING: ['BLOCKED', 'REVIEW_PENDING', 'FAILED', 'CANCELLED'],
  BLOCKED: ['RUNNING', 'FAILED', 'CANCELLED'],
  REVIEW_PENDING: ['VERIFICATION_PENDING', 'RUNNING', 'FAILED', 'CANCELLED'],
  VERIFICATION_PENDING: ['COMPLETED', 'RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

function parseTask(row) {
  if (!row) return null;
  return {
    ...row,
    input_context: row.input_context_json ? JSON.parse(row.input_context_json) : null,
    output_refs: row.output_refs_json ? JSON.parse(row.output_refs_json) : [],
  };
}

function createTask(db, input) {
  const taskId = newId('tsk_');
  const now = nowIso();
  db.prepare(`INSERT INTO tasks
    (task_id, project_id, parent_task_id, title, description, acceptance_criteria, assigned_role,
     assigned_agent, status, priority, input_context_json, output_refs_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId,
    input.project_id,
    input.parent_task_id || null,
    input.title,
    input.description || null,
    input.acceptance_criteria || null,
    input.assigned_role || null,
    input.assigned_agent || null,
    'PLANNED',
    input.priority || 3,
    JSON.stringify(input.input_context || {}),
    JSON.stringify([]),
    now,
    now
  );
  addEvent(db, taskId, null, 'PLANNED', input.actor || 'system', 'created');
  return getTask(db, taskId);
}

function getTask(db, taskId) {
  return parseTask(db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId));
}

function listTasks(db, filter = {}) {
  let sql = 'SELECT * FROM tasks WHERE project_id = ?';
  const params = [filter.project_id];
  if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filter.limit || 50);
  return db.prepare(sql).all(...params).map(parseTask);
}

function addEvent(db, taskId, from, to, actor, note) {
  db.prepare('INSERT INTO task_events (task_id, from_status, to_status, actor, note, created_at) VALUES (?,?,?,?,?,?)')
    .run(taskId, from, to, actor || 'system', note || null, nowIso());
}

function transition(db, taskId, to, actor, note) {
  const task = getTask(db, taskId);
  if (!task) throw new Error('TASK_NOT_FOUND ' + taskId);
  const allowed = TRANSITIONS[task.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`TASK_TRANSITION_INVALID ${task.status} -> ${to}（允许：${allowed.join(',') || '无'}）`);
  }
  const now = nowIso();
  const completedAt = to === 'COMPLETED' ? now : task.completed_at;
  db.prepare('UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE task_id = ?')
    .run(to, now, completedAt, taskId);
  addEvent(db, taskId, task.status, to, actor, note);
  return getTask(db, taskId);
}

function assign(db, taskId, { role: roleId, agent, actor }) {
  const task = getTask(db, taskId);
  if (!task) throw new Error('TASK_NOT_FOUND ' + taskId);
  role(roleId);
  if (task.status !== 'PLANNED' && task.status !== 'READY') {
    throw new Error(`TASK_TRANSITION_INVALID ${task.status} -> ASSIGNED`);
  }
  db.prepare('UPDATE tasks SET assigned_role = ?, assigned_agent = ?, status = ?, updated_at = ? WHERE task_id = ?')
    .run(roleId, agent || null, 'ASSIGNED', nowIso(), taskId);
  addEvent(db, taskId, task.status, 'ASSIGNED', actor || 'system', `assign ${roleId}${agent ? '/' + agent : ''}`);
  return getTask(db, taskId);
}

function complete(db, taskId, { evidence, actor }) {
  const refs = Array.isArray(evidence) ? evidence : [];
  if (refs.length === 0) throw new Error('EVIDENCE_REQUIRED 完成任务必须给 --evidence');
  const task = getTask(db, taskId);
  if (!task) throw new Error('TASK_NOT_FOUND ' + taskId);
  db.prepare('UPDATE tasks SET output_refs_json = ?, updated_at = ? WHERE task_id = ?')
    .run(JSON.stringify(refs), nowIso(), taskId);
  return transition(db, taskId, 'COMPLETED', actor, 'evidence: ' + refs.join(','));
}

function fail(db, taskId, reason, actor) {
  if (!reason) throw new Error('FAILURE_REASON_REQUIRED');
  db.prepare('UPDATE tasks SET failure_reason = ?, updated_at = ? WHERE task_id = ?')
    .run(String(reason), nowIso(), taskId);
  return transition(db, taskId, 'FAILED', actor, String(reason));
}

function events(db, taskId) {
  return db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY event_id').all(taskId);
}

// ---- 调度：确定性规则，先拆再派；出现「实现…并补测试」时拆成两个任务 ----

function dispatch(objective, options = {}) {
  const text = String(objective || '');
  if (options.role) {
    role(options.role);
    return { needs_review: false, uncertainty: 'none', tasks: [{ role: options.role, kind: 'single', reason: '用户明确指定' }], reasons: ['用户显式指定优先于所有规则'] };
  }
  const hasImpl = /实现|新增|开发|改造|修复|重构|编写/.test(text);
  const hasTest = /测试|验证|验收/.test(text);
  const hasArch = /架构|设计|接口|方案/.test(text);
  const hasSec = /安全|权限|风险|合规/.test(text);
  const hasGit = /提交|合并|发布|版本|tag/i.test(text);

  const tasks = [];
  if (hasArch) tasks.push({ role: 'R1', kind: 'design', reason: '含架构/设计类词汇' });
  if (hasImpl) tasks.push({ role: 'R2', kind: 'implementation', reason: '含实现类动词' });
  if (hasTest) tasks.push({ role: 'R3', kind: 'verification', reason: '含验证类要求' });
  if (hasSec) tasks.push({ role: 'R6', kind: 'security', reason: '含安全/权限类词汇' });
  if (hasGit) tasks.push({ role: 'R7', kind: 'delivery', reason: '含提交/发布类词汇' });

  if (tasks.length === 0) {
    return {
      needs_review: true,
      uncertainty: 'high',
      tasks: [{ role: 'R0', kind: 'triage', reason: '无法从描述判定任务类型' }],
      reasons: ['未命中任何确定性规则，交回 R0 澄清'],
    };
  }
  const reasons = [];
  if (hasImpl && hasTest) {
    reasons.push('实现与验证被拆成两个任务：不因为出现「测试」就把整体判为 verification');
  }
  return { needs_review: false, uncertainty: tasks.length > 2 ? 'medium' : 'low', tasks, reasons };
}

function planTasks(db, { project_id, objective, role: explicitRole, actor }) {
  const result = dispatch(objective, { role: explicitRole });
  const parent = createTask(db, {
    project_id,
    title: objective.slice(0, 80) || '未命名任务',
    description: objective,
    acceptance_criteria: null,
    assigned_role: null,
    actor,
  });
  const created = [];
  for (const item of result.tasks) {
    const child = createTask(db, {
      project_id,
      parent_task_id: parent.task_id,
      title: `[${item.role}] ${objective.slice(0, 60)}`,
      description: objective,
      assigned_role: item.role,
      input_context: { kind: item.kind, reason: item.reason },
      actor,
    });
    created.push({ ...child, dispatch_reason: item.reason, kind: item.kind });
  }
  return { parent, tasks: created, needs_review: result.needs_review, uncertainty: result.uncertainty, reasons: result.reasons };
}

// ---- 交接包：只带下一角色需要的东西，不复制整段会话 ----

function buildHandoffSummary(db, task) {
  const ev = events(db, task.task_id);
  return {
    task_id: task.task_id,
    project_id: task.project_id,
    title: task.title,
    objective: task.description,
    acceptance_criteria: task.acceptance_criteria,
    status: task.status,
    assigned_role: task.assigned_role,
    assigned_agent: task.assigned_agent,
    // 下面这些字段只来自已记录的事实；没有记录就是空数组，不编造
    completed_work: ev.filter((e) => ['REVIEW_PENDING', 'VERIFICATION_PENDING', 'COMPLETED'].includes(e.to_status)).map((e) => `${e.from_status}->${e.to_status}: ${e.note || ''}`.trim()),
    modified_files: task.output_refs || [],
    key_decisions: [],
    open_items: task.failure_reason ? [task.failure_reason] : [],
    test_results: [],
    risks: [],
    next_actions: TRANSITIONS[task.status] || [],
    evidence_refs: task.output_refs || [],
    event_count: ev.length,
    note: 'key_decisions / test_results / risks 未记录时为空数组，不自动生成',
  };
}

function saveHandoff(db, { task, toRole, fromRole, packetId, summary }) {
  const handoffId = newId('hof_');
  db.prepare('INSERT INTO handoffs (handoff_id, task_id, from_role, to_role, packet_id, summary_json, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(handoffId, task.task_id, fromRole || task.assigned_role || null, toRole, packetId || null, JSON.stringify(summary), nowIso());
  return { handoff_id: handoffId, task_id: task.task_id, to_role: toRole, packet_id: packetId || null };
}

function listHandoffs(db, taskId) {
  return db.prepare('SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at').all(taskId).map((row) => ({
    ...row,
    summary: JSON.parse(row.summary_json),
  }));
}

// ---- 成本账本：估算与实际必须分开 ----

function recordCost(db, input) {
  const source = input.usage_source || 'estimated';
  if (source !== 'estimated' && source !== 'provider') throw new Error('USAGE_SOURCE_INVALID estimated|provider');
  if (input.actual_cost !== undefined && input.actual_cost !== null && source !== 'provider') {
    throw new Error('ACTUAL_COST_REQUIRES_PROVIDER 只有 provider 用量才能记 actual_cost');
  }
  db.prepare(`INSERT INTO costs
    (project_id, task_id, agent_id, model, provider, input_tokens, output_tokens, cached_tokens,
     tool_calls, estimated_cost, actual_cost, usage_source, created_at, run_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.project_id,
    input.task_id || null,
    input.agent_id || null,
    input.model || null,
    input.provider || null,
    input.input_tokens || 0,
    input.output_tokens || 0,
    input.cached_tokens || 0,
    input.tool_calls || 0,
    input.estimated_cost === undefined ? null : input.estimated_cost,
    input.actual_cost === undefined ? null : input.actual_cost,
    source,
    nowIso(),
    input.run_id || null
  );
  return { recorded: true, usage_source: source };
}

function costReport(db, filter = {}) {
  const rows = filter.project_id
    ? db.prepare('SELECT * FROM costs WHERE project_id = ?').all(filter.project_id)
    : db.prepare('SELECT * FROM costs').all();
  const total = { input: 0, output: 0, cached: 0, tools: 0, estimated: 0, actual: 0 };
  const byModel = {};
  const byAgent = {};
  const byTask = {};
  let providerRows = 0;
  let estimatedRows = 0;
  for (const row of rows) {
    total.input += row.input_tokens || 0;
    total.output += row.output_tokens || 0;
    total.cached += row.cached_tokens || 0;
    total.tools += row.tool_calls || 0;
    if (row.estimated_cost !== null) total.estimated += row.estimated_cost;
    if (row.actual_cost !== null) total.actual += row.actual_cost;
    if (row.usage_source === 'provider') providerRows += 1; else estimatedRows += 1;
    const m = row.model || 'unknown';
    byModel[m] = byModel[m] || { input: 0, output: 0, rows: 0 };
    byModel[m].input += row.input_tokens || 0;
    byModel[m].output += row.output_tokens || 0;
    byModel[m].rows += 1;
    const a = row.agent_id || 'unknown';
    byAgent[a] = byAgent[a] || { input: 0, output: 0, rows: 0 };
    byAgent[a].input += row.input_tokens || 0;
    byAgent[a].output += row.output_tokens || 0;
    byAgent[a].rows += 1;
    const t = row.task_id || 'unassigned';
    byTask[t] = byTask[t] || { input: 0, output: 0, rows: 0 };
    byTask[t].input += row.input_tokens || 0;
    byTask[t].output += row.output_tokens || 0;
    byTask[t].rows += 1;
  }
  const topTask = Object.entries(byTask).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))[0] || null;
  return {
    rows: rows.length,
    usage_source: { provider: providerRows, estimated: estimatedRows },
    total,
    by_model: byModel,
    by_agent: byAgent,
    by_task: byTask,
    top_task: topTask ? { task_id: topTask[0], ...topTask[1] } : null,
    note: 'estimated_cost / actual_cost 只汇总已记录的值；没有价格数据时保持 0 而不是编造',
  };
}

module.exports = {
  ROLES, role, listRoles, assertPermission,
  TASK_STATUS, TRANSITIONS, createTask, getTask, listTasks, transition, assign, complete, fail, events,
  dispatch, planTasks,
  buildHandoffSummary, saveHandoff, listHandoffs,
  recordCost, costReport,
};
