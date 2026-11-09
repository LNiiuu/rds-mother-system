'use strict';
// 产品版本的单一读取点（M4 / B4）。
//
// 版本体系（详见 docs/versioning.md）：
//   - 产品版本：`package.json.version` 是唯一真相源；`VERSION` 是给人看的镜像文件，
//     doctor 会校验两者一致。`rds --version` 也优先读 VERSION。
//   - MCP `serverInfo.version`：报告**产品版本**，因此这里导出同一个值。
//     此前它被硬编码成 '0.2.0'，与 0.1.0 长期不一致且没人发现。
//   - 数据格式版本：`mars/contracts/ledger.schema.json` 的 `version` 常量，属于另一套编号，
//     不随产品版本变化。
//
// 为什么用 require 读 JSON 而不是 fs：这样不触发分层检查的 L3-fs（域/入口不得直接碰文件系统），
// 且在源码树与安装包里的相对位置一致（mars/src → ../../package.json）。
const pkg = require('../../package.json');

const PRODUCT_VERSION = String((pkg && pkg.version) || '0.0.0');

module.exports = { PRODUCT_VERSION };
