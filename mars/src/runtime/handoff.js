'use strict';
// 结构化交接（M12-5）。
//
// 交接不是「把上一个 Agent 的聊天记录复制给下一个」，而是：
//   1. 上一棒写下结构化的事实（做了什么 / 没做什么 / 决策 / 改了哪些文件 / 证据在哪）
//   2. 系统据此为下一棒**重新编译**一份最小上下文（按下一棒的角色与预算裁剪）
//   3. 交接包入库，下一棒的 run 通过 handoff_id 指回来，链条可追溯
//
// 硬性约束：摘要里的每一项都必须来自可核对的事实（run 输出、工具事件的 meta、任务卡），
// 不允许由这里"推断"出没发生过的事。

const { nowIso, newId, stableJson } = require('../util');

const FIELDS = [
  'objective', 'completed', 'incomplete', 'decisions', 'files',
  'acceptance', 'evidence', 'budget_remaining'
];

function asList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

/** 把上一棒的 run 事实提炼成交接摘要（只取已记录的东西）。 */
function summaryFromRun(run, extra = {}) {
  const output = run.output || {};
  const toolEvents = extra.toolEvents || [];
  const files = toolEvents
    .filter((e) => e.kind === 'TOOL' && e.payload && e.payload.allowed && e.payload.tool === 'write_file' && e.payload.meta)
    .map((e) => ({ path: e.payload.meta.path, sha256: e.payload.meta.sha256, bytes: e.payload.meta.bytes }));
  const testRuns = toolEvents
    .filter((e) => e.kind === 'TOOL' && e.payload && e.payload.tool === 'run_test' && e.payload.meta)
    .map((e) => e.payload.meta);

  return {
    objective: extra.objective || run.objective || null,
    completed: asList(extra.completed != null ? extra.completed : (output.text ? [output.text] : [])),
    incomplete: asList(extra.incomplete),
    decisions: asList(extra.decisions),
    files: extra.files != null ? asList(extra.files) : files.map((f) => f.path),
    acceptance: asList(extra.acceptance),
    evidence: asList(extra.evidence).concat(
      files.map((f) => `file:${f.path}#sha256=${f.sha256}`),
      testRuns.map((t) => `test:tests=${t.tests},pass=${t.pass},fail=${t.fail}`),
      [`run:${run.run_id}`]
    ),
    budget_remaining: extra.budget_remaining != null ? Number(extra.budget_remaining) : null,
    // 便于审计：这一棒到底花了多少
    run: {
      run_id: run.run_id,
      agent_id: run.agent_id,
      role_id: run.role_id,
      status: run.status,
      session_id: run.session_id,
      tool_rounds: run.tool_rounds,
      tokens_used: output.tokens_used || null,
      execution_kind: output.execution_kind || null
    },
    created_at: nowIso()
  };
}

/** 交接摘要渲染成给下一棒读的正文。结构化字段进去，正文出来。 */
function renderSummary(summary) {
  const block = (title, items) => (items && items.length ? `\n### ${title}\n` + items.map((x) => '- ' + x).join('\n') : '');
  return [
    `## 交接：${summary.run.role_id} → 下一棒`,
    `目标：${summary.objective || '(未提供)'}`,
    block('已完成', summary.completed),
    block('未完成', summary.incomplete),
    block('关键决策', summary.decisions),
    block('相关文件', summary.files),
    block('验收标准', summary.acceptance),
    block('证据', summary.evidence),
    summary.budget_remaining != null ? `\n剩余预算：${summary.budget_remaining} tokens` : '',
    `\n来源 run：${summary.run.run_id}（${summary.run.status}，工具轮次 ${summary.run.tool_rounds}）`
  ].filter(Boolean).join('\n');
}

/**
 * 建一条交接：写库 + 为下一棒编译上下文包。
 *
 * @param {object} db
 * @param {object} input  { task_id, objective, from_agent, from_run, to_agent, to_run, summary }
 * @param {object} deps   { compilePacket }
 */
function createHandoff(db, input, deps = {}) {
  if (!input.to_agent) throw new Error('HANDOFF_TARGET_REQUIRED');
  const summary = input.summary || summaryFromRun({ run_id: input.from_run || 'unknown', ...input.fromRunFacts });
  const handoffId = input.handoff_id || newId('ho');

  let packet = null;
  if (typeof deps.compilePacket === 'function') {
    packet = deps.compilePacket({
      project_id: input.project_id,
      task_id: input.task_id || null,
      role_id: input.to_agent.role_id,
      budget: input.budget || undefined,
      task: {
        id: input.task_id || 'T-UNKNOWN',
        text: renderSummary(summary),
        objective: input.objective || summary.objective || null,
        acceptance: summary.acceptance
      }
    });
  }

  db.prepare(`INSERT INTO handoffs (handoff_id, task_id, from_role, to_role, packet_id, summary_json,
    created_at, from_agent, to_agent, from_run, to_run, objective)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(handoffId, input.task_id || 'T-UNKNOWN',
      summary.run ? summary.run.role_id : (input.from_role || null),
      input.to_agent.role_id,
      packet ? packet.packet_id : null,
      stableJson(summary), nowIso(),
      summary.run ? summary.run.agent_id : (input.from_agent || null),
      input.to_agent.agent_id,
      summary.run ? summary.run.run_id : (input.from_run || null),
      input.to_run || null,
      input.objective || summary.objective || null);

  return {
    handoff_id: handoffId,
    task_id: input.task_id || 'T-UNKNOWN',
    from_agent: summary.run ? summary.run.agent_id : (input.from_agent || null),
    to_agent: input.to_agent.agent_id,
    from_run: summary.run ? summary.run.run_id : (input.from_run || null),
    packet_id: packet ? packet.packet_id : null,
    tokens: packet ? packet.tokens_estimated : null,
    summary,
    packet
  };
}

function getHandoff(db, handoffId) {
  const r = db.prepare('SELECT * FROM handoffs WHERE handoff_id = ?').get(handoffId);
  if (!r) return null;
  return { ...r, summary: JSON.parse(r.summary_json) };
}

function listHandoffsOfTask(db, taskId) {
  return db.prepare('SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at').all(taskId)
    .map((r) => ({ ...r, summary: JSON.parse(r.summary_json) }));
}

module.exports = { FIELDS, createHandoff, getHandoff, listHandoffsOfTask, summaryFromRun, renderSummary };
