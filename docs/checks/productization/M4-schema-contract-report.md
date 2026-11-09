# M4-B1 契约与 Schema 一致性报告

**批次**：m4-b1
**基线**：`4eeddf2`（m4-b0）
**结论**：H-05 关闭；契约从「声明了但没人执行」变成「有执行点 + 有回归守卫」。

---

## 1. 核查：契约到底被谁用

```
$ grep -rn "ledger.schema" mars/src/
（无输出）
```

`ledger.schema.json` 在 M3 结束时**只被文档和基线哈希引用**，`mars/src` 零引用。
也就是说：契约里写着 `additionalProperties: false`、`required`、`const`，但没有任何代码读它。

进一步核对发现一个更根本的错位：

| 视角 | 实际形状 |
|---|---|
| `ledger.schema.json` 描述 | 聚合账本：`{version, generated_at, source, sessions[], totals, cost, reconcile, warnings}` |
| `rds ledger` 实际输出 | **单条会话记录**：`{session_id, path, usage_events, usage, source_kind, model, provider}` |
| `ledger.buildLedger()` | 聚合账本（与契约一致），但**只有测试在调** |

所以「契约与代码一致」这句话在 M3 结束时对 CLI 是不成立的：CLI 输出的根本不是契约描述的对象。

**处理方式**：不改 CLI 的 JSON 形状（那属于公开契约变更，需另行授权），
改为让契约**同时覆盖两层**：顶层描述聚合输出，`properties.sessions.items` 描述单条会话；
CLI 出口按 `sessions.items` 校验。这样两边都落进同一份契约，且不改变任何对外形状。

---

## 2. 方案比较

| 方案 | 做法 | 兼容性 | 迁移成本 | 旧数据 | 未来扩展 | 结论 |
|---|---|---|---|---|---|---|
| A 保持 `const` | 只做代码层解耦 | 最高 | 0 | 可读 | **新增数据源必然违反契约** | 否 |
| B 改为 `enum` | 列出所有已知 kind | 高 | 低 | 可读 | 每加一个源都要改契约并升版 | 否 |
| C 版本化数据源契约 | 引入 `contract_version` + 每源独立 schema | 中 | 高 | 需兼容矩阵 | 最灵活 | 否 |
| **D 放宽为 `pattern` + 运行时执行** | 形状约束写进契约，取值由注册表保证 | 高（只增不减） | 低 | 仍通过 | 新增源无需改契约 | **采用** |

**为什么不用 `enum`**：`enum` 把「实现清单」编进数据契约，每加一个数据源就要动契约文件并升版；
而契约该约束的是**形状**，不是**实现枚举**。代价是"拼错 kind 也能过 schema" ——
用一条测试兜住（`source_kind` 必须是注册表 `list()` 里的值），并在 CLI 出口做运行时校验。

**为什么没加 `contract_version`**：M3 设计文档建议加一个可选 `contract_version: const "0.2.0"` 作为锚点。
本轮**未采纳**，理由是它没有消费方：schema 自己的 `version`（`const "0.1.0"`）已经是格式版本，
再加一个"契约版本"会让两个版本号并存的歧义落到维护者身上。如果将来契约需要独立演进，
再引入并同时定义两者的关系 —— 现在加等于预留一个没人用的字段。

---

## 3. 实际改动

| 文件 | 改动 |
|---|---|
| `mars/contracts/ledger.schema.json` | `source`、`source_kind`：`const: "dsh-session"` → `{type: string, pattern: ^[a-z0-9][a-z0-9-]{0,31}$}`；新增顶层 `description` 说明契约覆盖「聚合输出 + sessions.items 两层」 |
| `mars/src/cli.js` | `ledger` 子命令在输出前按 `ledger.schema.json#/properties/sessions/items` 校验；不通过则 `LEDGER_CONTRACT_INVALID` + exit 4 |
| `tooling/baseline-capture.mjs` | 契约哈希从「严格相等」改为「允许在 `approved-additions.json.contractChanges` 里显式登记的变更」；登记项哈希不匹配当前文件时报「登记已过期」 |
| `docs/architecture/m3/baseline/approved-additions.json` | 登记本次契约变更（文件、新哈希、批次、理由） |
| `mars/tests/arch/contracts.test.js` | 新增 8 个用例 |

### 为什么改基线工具而不是直接重采基线

直接重采会把差异抹掉 —— 下次谁改了契约都不会有人知道。
改成"变更必须登记"后，改契约这件事会留在 `approved-additions.json` 里，
`BASELINE PASS` 的含义仍然是「没有未登记的漂移」。

---

## 4. 测试

`mars/tests/arch/contracts.test.js`（8 例）：

| 用例 | 断言 |
|---|---|
| 五个契约都能取出 | 端口声明与文件名一致；每个 hash 是 64 位 sha256 |
| 聚合输出符合契约 | `buildLedger()` 输出 `validate()` 零 error；`source` 跟随 `sessions[0].source_kind` |
| 单条会话符合 `sessions.items` | 零 error |
| 非法 `source_kind` | `'DSH Session!'` 被 pattern 拒绝 |
| 缺必需字段 | 删除 `source_kind` 后校验失败 |
| 注册表与契约对齐 | 已注册 kind 全部匹配 pattern；未注册 kind 抛 `SOURCE_UNSUPPORTED`；空输入也明确失败 |
| H-05 回归守卫 | 契约文本里不得再出现 `"const": "dsh-session"` |
| 端到端 | 真实 zstd 会话经适配器解析后满足 `sessions.items`，且 `usage.total` 与 fixture 期望一致 |

**没有 skip**：缺少 `zlib.zstdCompressSync` 时用例 `assert.fail`，不是跳过。

### 校验确实会触发的证据

把 `items.required` 临时塞一个不存在的字段：

```
$ node bin/rds.mjs ledger --session <fixture>
ERROR LEDGER_CONTRACT_INVALID $: missing required property "nonexistent_field"
```

（随后已还原，文件哈希回到 `4088f715…`。）

---

## 5. 验收对照（任务书 §5.4）

| 要求 | 结果 |
|---|---|
| Schema 与代码行为一致 | 是。CLI 单条输出按 `sessions.items` 校验；聚合输出按顶层契约校验（测试覆盖） |
| 发行包中的 Schema 与源码一致 | 是。tarball 内 `mars/contracts/ledger.schema.json` 与源码 sha256 均为 `4088f7150e0993f2…` |
| 旧数据仍可读取 | 是。`dsh-session` 匹配新 pattern；旧账本字段未变，无迁移 |
| 不允许未知数据源被静默接受 | 是。未注册 kind 由注册表抛 `SOURCE_UNSUPPORTED`；形状非法的 kind 被 pattern 拒绝 |
| 无效数据源有明确错误 | 是。`未知数据源 X（已注册: dsh-session）`，exit 4 |
| 所有契约变化都有测试 | 是。8 例，含 H-05 回归守卫 |

**未改**：数据库 Schema、DDL、`SCHEMA_VERSION`、任何 SQL、CLI 参数、JSON 形状、MCP 工具面。
**未做**：没有引入 `enum`、没有加 `contract_version`、没有为"多数据源"写新的适配器。

---

## 6. 遗留

| 项 | 说明 |
|---|---|
| `ledger.json` 里的 `path` 是本机绝对路径 | 属输出内容而非契约问题；改为相对路径会变更公开输出，需另行授权 |
| `rds ledger` 不支持 `--help` | 记在 M4-O2，B5 处理 |
| 聚合账本无 CLI 入口 | `buildLedger` 只有库 API 与测试在用；是否加 `rds ledger --all` 属能力扩展，不在 M4 |
