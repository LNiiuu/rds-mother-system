'use strict';
// 端口：HostRegistry（M3 / B4）
//
// 职责：读写「宿主产品的 MCP 注册表」。这是全仓库唯一会触碰外部产品状态的边界。
// 为什么需要它：B4 之前由 PowerShell 直接 ConvertFrom-Json → 过滤 → ConvertTo-Json → 覆盖整文件，
// 没有版本协商、没有格式校验、没有原子写，对方改结构就会静默写坏。
//
// 硬要求：
//   1. 调用方**只能看到条目名**，看不到内部结构；格式归适配器所有；
//   2. 默认 dry-run，写入必须显式要求；
//   3. 写入前必须备份，写入必须原子（临时文件 + rename）；
//   4. 未知的顶层字段必须保留，不得因为「不认识」而丢弃。
//
// 约束：本文件零 require；方法数 <= 5；不依赖其他端口。

const METHODS = ['detect', 'list', 'backup', 'removeByPrefix'];

const ERRORS = Object.freeze({
  NOT_FOUND: 'HOST_REGISTRY_NOT_FOUND',
  INVALID: 'HOST_REGISTRY_INVALID',
  READONLY: 'HOST_REGISTRY_READONLY',
  WRITE_REFUSED: 'HOST_WRITE_REFUSED'
});

module.exports = { METHODS, ERRORS };
