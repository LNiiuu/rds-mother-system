'use strict';
// 交接链执行（M12-5 / M12-6）。
//
// 一条链 = 若干 Agent 依次执行，每一棒结束后自动：
//   1. 从这一棒的 run 事实生成结构化摘要
//   2. 为下一棒**重新编译**上下文包（按下一棒的角色与预算）
//   3. 记录 handoff，并把 handoff_id 写进下一棒的 run
//
// 不做的事：不把上一棒的完整消息数组传给下一棒。上下文永远是重新编译的。

const runtime = require('./agent-runtime');
const { createHandoff, summaryFromRun } = require('./handoff');

/**
 * @param {object} ctx
 * @param {object} ctx.db
 * @param {object[]} ctx.agents      按执行顺序
 * @param {string} ctx.objective
 * @param {string} [ctx.taskId]
 * @param {object} [ctx.initialPacket]  第一棒的上下文包（含任务正文）
 * @param {function} ctx.providerFor    (agent) => provider
 * @param {object} [ctx.executor]
 * @param {function} [ctx.compilePacket]
 * @param {number} [ctx.budget]
 * @param {number} [ctx.timeout]
 * @param {number} [ctx.maxToolRounds]
 * @param {function} [ctx.stopWhen]     (step) => boolean，返回 true 提前结束
 */
async function executeChain(ctx) {
  const { db, agents, objective, taskId, providerFor, executor, compilePacket } = ctx;
  if (!Array.isArray(agents) || !agents.length) throw new Error('CHAIN_EMPTY');

  const steps = [];
  const handoffs = [];
  let previous = null;

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    const isFirst = i === 0;
    const packet = isFirst ? (ctx.initialPacket || null) : (previous ? previous.packet : null);

    const { run } = runtime.startRun(db, {
      agent_id: agent.agent_id,
      project_id: agent.project_id,
      task_id: taskId || null,
      handoff_id: previous ? previous.handoff_id : null,
      objective,
      packet_id: packet ? packet.packet_id : null,
      input_tokens_est: packet ? packet.tokens_estimated : null,
      budget_tokens: ctx.budget || agent.definition.budget_tokens || null,
      timeout_ms: ctx.timeout,
      idempotency_key: ctx.idempotencyKeyPrefix ? `${ctx.idempotencyKeyPrefix}-${agent.agent_id}` : null
    });

    if (previous) {
      runtime.emit(db, run.run_id, 'HANDOFF_IN', {
        handoff_id: previous.handoff_id, from_agent: previous.from_agent,
        packet_id: previous.packet_id, tokens: previous.tokens
      });
    }

    const result = await runtime.executeRun({
      db, run, agent,
      provider: providerFor(agent),
      executor,
      packet,
      maxToolRounds: ctx.maxToolRounds
    });

    const step = {
      index: i,
      agent_id: agent.agent_id,
      role_id: agent.role_id,
      run_id: result.run.run_id,
      session_id: result.run.session_id,
      status: result.run.status,
      text: (result.output && result.output.text) || '',
      tool_rounds: result.run.tool_rounds,
      tokens_used: (result.output && result.output.tokens_used) || 0,
      execution_kind: (result.output && result.output.execution_kind) || null,
      error: result.run.error_code || null,
      handoff_in: previous ? previous.handoff_id : null
    };
    steps.push(step);

    if (ctx.onStep) ctx.onStep(step, result);

    const stop = typeof ctx.stopWhen === 'function' ? ctx.stopWhen(step) : false;
    const isLast = i === agents.length - 1;
    if (stop || isLast) break;

    const toolEvents = runtime.trace(db, result.run.run_id);
    const summary = summaryFromRun(result.run, {
      objective,
      toolEvents,
      acceptance: ctx.acceptance || [],
      budget_remaining: ctx.budget ? Math.max(0, Number(ctx.budget) - step.tokens_used) : null
    });
    const next = agents[i + 1];
    const handoff = createHandoff(db, {
      project_id: agent.project_id,
      task_id: taskId || null,
      objective,
      to_agent: next,
      summary
    }, { compilePacket });
    handoffs.push(handoff);
    runtime.emit(db, result.run.run_id, 'HANDOFF_OUT', {
      handoff_id: handoff.handoff_id, to_agent: next.agent_id, packet_id: handoff.packet_id, tokens: handoff.tokens
    });
    previous = handoff;
  }

  return {
    objective,
    task_id: taskId || null,
    steps,
    handoffs: handoffs.map((h) => ({
      handoff_id: h.handoff_id, from_agent: h.from_agent, to_agent: h.to_agent,
      from_run: h.from_run, packet_id: h.packet_id, tokens: h.tokens
    })),
    sessions_distinct: new Set(steps.map((s) => s.session_id)).size === steps.length,
    total_tokens: steps.reduce((a, s) => a + s.tokens_used, 0)
  };
}

module.exports = { executeChain };
