'use strict';
// M9：上下文预算。
//
// 只做「按配置算账」，不假装知道 Provider 的精确分词。
// 估算方法固定为 util.estimateTokens（CJK 按 1 token、其他按 3 字符 1 token），
// 输出里必须带 estimationMethod，调用方不得把它当成 provider 实际用量。

const { estimateTokens, clampInt } = require('./util');

const THRESHOLDS = { warning: 0.6, high: 0.75, critical: 0.85, exceeded: 0.95 };

const MODELS = {
  'deepseek-v4.1-flash': {
    context_window: 131072,
    max_output: 8192,
    system_reserve: 3000,
    tool_reserve: 6000,
    safety_margin: 6000,
  },
  'generic-128k': {
    context_window: 128000,
    max_output: 8192,
    system_reserve: 4000,
    tool_reserve: 6000,
    safety_margin: 6000,
  },
  'generic-32k': {
    context_window: 32768,
    max_output: 4096,
    system_reserve: 2000,
    tool_reserve: 3000,
    safety_margin: 2000,
  },
};

function listModels() {
  return Object.entries(MODELS).map(([id, profile]) => ({ id, ...profile }));
}

function profileFor(model) {
  const id = model || 'generic-128k';
  const base = MODELS[id];
  if (!base) throw new Error('MODEL_UNKNOWN ' + id);
  return { id, ...base };
}

function statusFor(ratio, thresholds = THRESHOLDS) {
  if (ratio >= thresholds.exceeded) return 'EXCEEDED';
  if (ratio >= thresholds.critical) return 'CRITICAL';
  if (ratio >= thresholds.high) return 'HIGH';
  if (ratio >= thresholds.warning) return 'WARNING';
  return 'NORMAL';
}

/**
 * @param {object} input
 * @param {string} [input.model]
 * @param {number} input.estimatedInputTokens  待注入上下文的估算量
 * @param {object} [input.override]            覆盖模型配置（context_window 等）
 */
function compute(input) {
  const base = profileFor(input.model);
  const p = { ...base, ...(input.override || {}) };
  const window = clampInt(p.context_window, 1, 10_000_000);
  const reservedOutputTokens = clampInt(p.max_output, 0, window);
  const reservedSystemTokens = clampInt(p.system_reserve, 0, window);
  const reservedToolTokens = clampInt(p.tool_reserve, 0, window);
  const safetyMarginTokens = clampInt(p.safety_margin, 0, window);
  const availableInputTokens = Math.max(0, window - reservedOutputTokens - reservedSystemTokens - reservedToolTokens - safetyMarginTokens);
  const estimatedInputTokens = Math.max(0, Math.round(Number(input.estimatedInputTokens) || 0));
  const utilizationRatio = availableInputTokens === 0 ? 1 : Number((estimatedInputTokens / availableInputTokens).toFixed(4));
  return {
    model: p.id,
    estimationMethod: 'chars-heuristic@1 (util.estimateTokens; not provider usage)',
    modelContextWindow: window,
    reservedOutputTokens,
    reservedSystemTokens,
    reservedToolTokens,
    safetyMarginTokens,
    availableInputTokens,
    estimatedInputTokens,
    utilizationRatio,
    budgetStatus: statusFor(utilizationRatio),
    thresholds: THRESHOLDS,
  };
}

function estimateText(text) {
  return estimateTokens(text);
}

module.exports = { compute, listModels, profileFor, statusFor, estimateText, THRESHOLDS, MODELS };
