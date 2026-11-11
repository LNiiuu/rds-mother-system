# 架构文档索引

**性质**：`DESIGN`。这些文档描述**设计意图与取舍**，不是当前实现的说明书。当前实现看 [docs/PROJECT-MAP.md](../PROJECT-MAP.md)。

---

## 1. M3：宿主适配层

M3 解决的问题：域逻辑直接依赖 DSH、文件系统布局与进程环境，导致「换个宿主就要改业务代码」。

产出：5 个端口 + 8 个适配器 + 组合根。**已全部实现并合入**（M3-2，tag `m3-b0` … `m3-b5`）。

| 文档 | 内容 | 实现状态 |
|---|---|---|
| [m3/current-state.md](m3/current-state.md) | M3 起点的真实架构：模块清单、依赖方向、耦合点分布 | 描述 `51a562e` 时点，**已被后续实现改变** |
| [m3/coupling-map.md](m3/coupling-map.md) | 宿主耦合点逐条清单（S1/S2/S3 分级，带 file:line） | 同上；绝大多数已消除 |
| [m3/host-adapter-design.md](m3/host-adapter-design.md) | 五端口设计：准入规则、方法签名、错误码、**明确拒绝的 7 类抽象** | **已实现**；文首「状态：设计草案（未实现）」是设计时标注 |
| [m3/migration-plan.md](m3/migration-plan.md) | B0–B5 分批迁移方案，每批「对外零变化」 | **已执行完毕** |
| [m3/acceptance-criteria.md](m3/acceptance-criteria.md) | 可机械判定的验收标准（每条是一个命令 + 一个计数） | 已用于 M3 验收 |
| [m3/risk-and-rollback.md](m3/risk-and-rollback.md) | 风险清单与回滚方案 | 已执行；实际结果见 [M4 回滚报告](../checks/productization/M4-rollback-report.md) |

### 为什么保留「未实现」的标注

`host-adapter-design.md` 与 `migration-plan.md` 是**设计阶段的产物**，日期在实现之前。把「未实现」改成「已实现」会抹掉「设计与实现之间隔了一个里程碑」这个事实。

正确用法：读设计意图 → 对照 [docs/PROJECT-MAP.md](../PROJECT-MAP.md) 看现状 → 若两者不一致，以 PROJECT-MAP 为准。

### 「属 M5 清理范围」是什么意思

M3 的设计文档里有几处写「属 M5 清理范围」（`current-state.md` 的目录树与失效项表、`migration-plan.md` 的「不做」清单），指的是当时的计划：由 M5 统一处理 `mars/docs/` 与 `docs/checks/` 里的过期内容与机器路径。

M5 已完成，但**清理方式不是删除或改写**：

| 做了什么 | 在哪 |
|---|---|
| 给每份文档标注性质（CURRENT / DESIGN / EVIDENCE / HISTORICAL）与生效范围 | [docs/checks/README.md](../checks/README.md)、[mars/docs/README.md](../../mars/docs/README.md) |
| 集中登记「已知失效：哪里失效、当前事实是什么、去哪看」 | [docs/README.md](../README.md) §4 |
| 保留全部历史文本原样——它们是带日期的证据 | 未改动 |
| 让 `rds doctor` 的 `paths:docs` 继续只告警不失败 | `bin/doctor.mjs` |

所以再看到「属 M5 清理范围」，正确理解是：**这件事已经处理过，处理方式是标注而非删除**。

---

## 2. 行为基线（`CURRENT`，持续有效）

[m3/baseline/](m3/baseline/) 是 7 个「对外面」的快照，`npm run baseline` 每次都会重新采集并比对。

| 文件 | 守护什么 | 比较方式 |
|---|---|---|
| `cli-help.txt` | CLI 顶层帮助文本（子命令与 flag 拼写） | **严格相等** |
| `cli-json-keys.json` | 8 个子命令的 JSON 键树（只看形状，不看值） | 严格相等 |
| `mcp-tools.json` | MCP 工具集（名称 / 必填 / 属性 / additionalProperties） | 严格相等 |
| `error-codes.json` | 对外错误码全集 | 集合：只允许登记过的**新增** |
| `pack-files.txt` | 发行包文件清单 | 集合：同上 |
| `contracts-sha256.json` | 4 份数据契约的内容哈希 | 哈希：只允许登记过的**变更** |
| `exit-codes.json` | 10 个场景的进程退出码 | 严格相等 |

`approved-additions.json` 是**唯一的变更登记处**：

| 字段 | 用途 |
|---|---|
| `errorCodes[]` | 允许新增的错误码 |
| `packFiles[]` | 允许新增的包内文件（每条要写批次与理由） |
| `contractChanges[]` | 允许的契约内容变更（`{file, sha256, batch, reason}`） |

**没有「帮助文本变更」的登记位**。改顶层帮助会导致 `cli-help.txt` 严格相等检查失败——这是有意的：帮助文本就是对外契约的一部分。要改就得同时更新基线文件，并在 CHANGELOG 里说明。

---

## 3. 想看别的

- 当前分层与依赖规则：[docs/PROJECT-MAP.md](../PROJECT-MAP.md)
- 版本维度（Schema 版本 vs 产品版本）：[docs/versioning.md](../versioning.md)
- 全部验收证据：[docs/checks/README.md](../checks/README.md)
