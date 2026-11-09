'use strict';
// 端口：SessionSource（M3 / B3）
//
// 职责：把「某个宿主的会话文件」变成账本能用的会话用量记录。
// 为什么需要它：B3 之前 DSH 的事件词汇（session / request/header / assistant/message、
// inputTokens…）与 zstd 多帧布局直接长在 ledger.js 里，等于把「数据来源」和「账本算法」
// 焊在一起；想接第二种来源必须同时改域代码与契约。
//
// 边界：
//   - 端口只描述「怎么把字节解析成记录」，不做 I/O —— 读文件由调用方或适配器的 read 便捷方法负责；
//   - 账本的领域语义（五个 usage 字段、1% 对账阈值、CSV 列序）留在 ledger.js，不随宿主变。
//
// 约束（tooling/layering-check.mjs 检查）：本文件零 require；方法数 <= 5；不依赖其他端口。
//
// 契约形状：
//   kind()                 -> string            例：'dsh-session'
//   sniff(bytes)           -> boolean           能否解析这段字节
//   parse({bytes, ref})    -> SessionUsage      纯函数，不读盘、不写盘

const METHODS = ['kind', 'sniff', 'parse'];

const ERRORS = Object.freeze({
  CORRUPT: 'SESSION_CORRUPT',
  UNSUPPORTED: 'SOURCE_UNSUPPORTED',
  AMBIGUOUS: 'SOURCE_AMBIGUOUS'
});

// 会话用量记录（内存形状，不是文件格式）。
// usage 的五个字段必须是非负整数；缺失按 0，不做推断。
const USAGE_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite', 'total']);

module.exports = { METHODS, ERRORS, USAGE_FIELDS };
