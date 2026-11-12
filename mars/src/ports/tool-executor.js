'use strict';
// 工具执行器端口（M12）。
//
// 为什么只有 3 个方法：工具面的差异在**适配器**里吃掉，不在端口上暴露。
//   list         列出可用工具及其参数 schema（上层据此决定能做什么）
//   invoke       执行一次，返回结构化结果
//   healthCheck  逐个工具的就绪状态（缺二进制就报缺，不假装可用）
//
// 关键安全约束：端口不接收「任意命令」。具体能执行什么由适配器的白名单决定，
// 上层只能按名字调用。这样「模型要求执行 rm -rf」在协议层就无处表达。
//
// 本文件必须零 require（layering-check L1）。

const METHODS = ['list', 'invoke', 'healthCheck'];

/** 工具调用的统一结果形状。适配器必须遵守，Runtime 依赖它做判定。 */
const RESULT_SHAPE = {
  ok: 'boolean',
  output: 'string',
  error_code: 'string|null',
  meta: 'object'
};

/** 校验工具执行器契约。返回缺失项数组。 */
function validateExecutor(executor) {
  const missing = [];
  if (!executor || typeof executor !== 'object') return ['executor'];
  for (const m of METHODS) {
    if (typeof executor[m] !== 'function') missing.push(m);
  }
  if (typeof executor.root !== 'string' || !executor.root) missing.push('root');
  return missing;
}

module.exports = { METHODS, RESULT_SHAPE, validateExecutor };
