# 版本策略

本文只回答一件事：**哪个数字代表什么**。此前仓库里有三个"版本号"互不相干，
`serverInfo.version` 长期是硬编码的 `0.2.0`，和 `VERSION` 的 `0.1.0` 并存而无任何说明。

---

## 1. 三个版本命名空间

| 名称 | 位置 | 含义 | 谁改它 |
|---|---|---|---|
| **产品版本** | `package.json.version`（真相源）<br>`VERSION`（镜像） | RDS 这个软件本身的版本，语义化版本 | 发布时 |
| **MCP 服务版本** | `serverInfo.version`（`initialize` 响应） | **就是产品版本**，用于让 MCP 客户端识别服务实现 | 不单独维护，随产品版本 |
| **数据格式版本** | `mars/contracts/ledger.schema.json` 的 `version` 常量<br>`meta.contract_version` | 账本 JSON 的输出格式版本 | 输出形状不兼容变化时 |
| **数据库结构版本** | `mars/src/db/schema.js` 的 `SCHEMA_VERSION`<br>`meta.schema_version` | SQLite 表结构的版本 | 表结构变化时 |

**不共用**：`SCHEMA_VERSION`（4）与产品版本（0.1.0）是两个维度，不要试图对齐。
`ledger.schema.json` 的 `version` 同理 —— 它是文件格式，不是产品。

---

## 2. 规则

1. **产品版本只有一个真相源**：`package.json.version`。`VERSION` 是给人看的镜像文件；
   `rds --version` 优先读 VERSION，因此两者**必须一致** —— `rds doctor` 会校验并在不一致时 `fail`。
2. **MCP 报告产品版本**：`mars/src/version.js` 从 `package.json` 读出 `PRODUCT_VERSION`，
   `mcp-stdio` 的 `serverInfo.version` 直接使用它。**不允许**再出现第二个硬编码版本常量。
3. **发布才升版本**：日常提交不改 `version`；发布时同时改 `package.json` 与 `VERSION`，
   并在 `CHANGELOG.md` 增加对应条目。
4. **数据格式版本只在破坏兼容时升**：放宽校验（例如把 `const` 改为 `pattern`）不算破坏，
   因为旧输出仍然通过新契约，所以 `ledger.schema.json.version` 保持 `0.1.0`。
5. **数据库结构版本只在表结构变化时升**：迁移必须是增量且幂等（只 `ADD COLUMN`）。
   旧版本代码遇到更高版本的库会**拒绝打开**（`DB_SCHEMA_NEWER`），不会静默降级。

---

## 3. Node 版本承诺

`package.json.engines.node` = `>=22.15.0`。

| 能力 | 最低版本 | 用途 |
|---|---|---|
| `node:sqlite`（`DatabaseSync`） | 22.5.0 | 全部持久化 |
| FTS5 虚拟表 | 随 `node:sqlite` | 检索 |
| `zlib.zstdDecompressSync` / `zstdCompressSync` | **22.15.0**（v23.8.0 引入、回移植到 v22.15.0） | `rds ledger` 解析会话；测试样本生成 |

**为什么不是 22.5**：22.5–22.14 能装、能跑大部分命令，但 `rds ledger` 会以
`ZSTD_UNSUPPORTED` 失败。声明 22.5 等于承诺一个跑不全功能的版本区间。
`rds doctor` 会分别检查 `node:sqlite` 与 `zlib:zstd`，让这个差异在安装时就暴露。

**为什么不是更高**：CI 矩阵跑 22.x 与 24.x 的最新补丁版；没有证据表明 22.15 以上还有额外要求。

---

## 4. 当前状态

| 项 | 值 |
|---|---|
| 产品版本 | `0.1.0`（未发布；CHANGELOG 中为 Unreleased 段落） |
| MCP `serverInfo.version` | `0.1.0`（由 `mars/src/version.js` 派生） |
| `SCHEMA_VERSION` | `4` |
| 账本格式版本 | `0.1.0` |

---

## 5. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-09（M4-B4） | 建立本策略；`serverInfo.version` 从硬编码 `0.2.0` 改为派生自产品版本；`engines.node` 从 `>=22.5.0` 收紧为 `>=22.15.0` |
