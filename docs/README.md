# RDS 文档入口

这是本仓库**唯一的文档索引**。其他入口（根 `README.md`、`mars/README.md`）都是摘要，细节以这里指向的文档为准。

如果你只读一份文档，读这一份。

---

## 1. 三条阅读路径

### 我想把它装起来用

1. [docs/quickstart.md](quickstart.md) —— 10 分钟跑通最小闭环，每一步都给出预期输出
2. [docs/install.md](install.md) —— 安装、配置、初始化、MCP 接入、升级卸载（**唯一权威安装文档**）
3. 出问题了 → [docs/maintainer-guide.md](maintainer-guide.md) §2「按症状查」与 §3「72 个错误码表」，或 [install.md](install.md) §12「故障排查」
4. `rds doctor` —— 装完先跑这一条，它会把 Node 版本、FTS5、zstd、目录可写、版本一致性、三类路径卫生、身份与数据库一次报清

不需要读 `core/`、`mars/docs/`、`docs/checks/` 中的任何内容。

### 我想改它

1. [docs/PROJECT-MAP.md](PROJECT-MAP.md) —— RDS 与 MARS 是什么关系、代码分成哪几层、改一处会牵动哪里
2. [docs/testing.md](testing.md) —— 测试怎么分类、门禁判据为什么是四个计数
3. [docs/versioning.md](versioning.md) —— 三个版本号各自代表什么，改哪个会破坏什么
4. [docs/architecture/m3/host-adapter-design.md](architecture/m3/host-adapter-design.md) —— 五个端口与八个适配器的设计意图（**注意**：该文首标注「未实现」，实际已在 M3-2 落地，见 §4）
5. [docs/PROJECT-MAP.md](PROJECT-MAP.md) §5「改动影响面」 —— 改 CLI / Schema / 契约 / MCP 之前必读

### 我想核对它是否可信

1. [docs/checks/README.md](checks/README.md) —— 全部验收证据的索引（按里程碑分组，标注结论与生效范围）
2. [docs/checks/productization/](checks/productization/) —— M1–M5 各阶段的验收报告
3. [docs/architecture/m3/baseline/](architecture/m3/baseline/) —— 7 个对外面的行为基线快照，`npm run baseline` 每次都会比对

---

## 2. 四类文档

本仓库的文档不是同一种东西。混读会得出错误结论，所以先分类：

| 类型 | 定义 | 会不会随代码更新 | 位置 |
|---|---|---|---|
| **正式文档** | 描述**当前**如何安装、使用、维护。与代码不一致即为缺陷 | **会**，每个里程碑同步 | `README.md`、`docs/*.md` |
| **架构设计** | 描述某一版设计的目标、约束与取舍。可能含「设计时尚未实现」的内容 | 部分：设计意图不变，实现状态会变 | `docs/architecture/` |
| **验收证据** | 带日期的、一次性的检查记录。**结论只对当时有效** | **不会**。改写等于篡改证据 | `docs/checks/`、`docs/M1-0-*.md`、`docs/acceptance/` |
| **历史材料** | 项目早期的完整过程记录，含已废弃的项目名与机器路径 | **不会**，且**未纳入版本控制** | `docs/history/`、`docs/analysis/`、`docs/runs/` |
| **子系统文档** | MARS 的历史设计、评审与运行记录。部分是当前架构，部分是当时快照 | 混合 | `mars/docs/` |

### 状态图例

读到任何一份文档，先看它属于哪一类：

| 标记 | 含义 | 你应该怎么用 |
|---|---|---|
| `CURRENT` | 当前有效，与代码同步 | 可以直接照做 |
| `DESIGN` | 设计文档，描述目标而非现状 | 看意图，实现状态另查 |
| `EVIDENCE` | 带日期的证据，只对当时有效 | 引用时带上日期与结论 |
| `HISTORICAL` | 历史材料，描述当时状态 | 不要当作当前事实 |
| `LOCAL` | 仅存在于工作区，未纳入版本控制 | 干净克隆中不存在 |

---

## 3. 文档地图

### 3.1 正式文档（`CURRENT`）

| 文档 | 内容 | 何时读 |
|---|---|---|
| [README.md](../README.md) | 定位、5 步跑通、文档地图、能力状态表 | 第一次接触 |
| [docs/quickstart.md](quickstart.md) | 10 分钟最小闭环：建库→建身份→写入→审批→检索→编译，每步带预期输出 | 要立刻跑起来 |
| [docs/install.md](install.md) | 唯一权威安装文档：前置条件、安装、配置、初始化、最小闭环、新项目接入、MCP 接入、升级卸载、故障排查 | 要装、要用 |
| [docs/maintainer-guide.md](maintainer-guide.md) | 维护者指南：按症状查、72 个错误码表、备份与恢复、版本与兼容、发布流程、回滚、什么时候该停手 | 出问题、要发版、要交接 |
| [docs/testing.md](testing.md) | 三类测试、门禁判据、fixture 约定、覆盖范围声明 | 要改测试 |
| [docs/versioning.md](versioning.md) | 三个版本命名空间、五条规则、Node 版本承诺 | 要发版、要改 Schema |
| [docs/PROJECT-MAP.md](PROJECT-MAP.md) | RDS/MARS 关系、目录职责、分层规则、数据流、改动影响面 | 要改代码 |
| [CHANGELOG.md](../CHANGELOG.md) | 每个里程碑的变更、删除、不变与测试数字 | 要知道「什么时候变的」 |

### 3.2 架构设计（`DESIGN`，部分实现状态已变）

| 文档 | 内容 | 实现状态 |
|---|---|---|
| [architecture/m3/current-state.md](architecture/m3/current-state.md) | M3 起点的真实架构与耦合点 | 描述 `51a562e` 时点 |
| [architecture/m3/coupling-map.md](architecture/m3/coupling-map.md) | 宿主耦合点清单（S1/S2/S3 分级） | 同上 |
| [architecture/m3/host-adapter-design.md](architecture/m3/host-adapter-design.md) | 五端口 + 八适配器的设计 | **已实现**（M3-2），文首「未实现」是设计时状态 |
| [architecture/m3/migration-plan.md](architecture/m3/migration-plan.md) | B0–B5 分批迁移方案 | **已执行完毕** |
| [architecture/m3/acceptance-criteria.md](architecture/m3/acceptance-criteria.md) | M3 可机械判定的验收标准 | 已用于 M3 验收 |
| [architecture/m3/risk-and-rollback.md](architecture/m3/risk-and-rollback.md) | M3 风险与回滚方案 | 已执行 |
| [architecture/m3/baseline/](architecture/m3/baseline/) | 7 个对外面的行为基线 | **持续有效**，`npm run baseline` 每次比对 |

索引与「为什么保留已过期的设计文档」见 [docs/architecture/README.md](architecture/README.md)。

### 3.3 验收证据（`EVIDENCE`）

完整索引见 [docs/checks/README.md](checks/README.md)。这里只给入口：

| 范围 | 位置 |
|---|---|
| M5（进行中） | `docs/checks/productization/M5-*.md` |
| M4 封版 | [checks/productization/M4-closure.md](checks/productization/M4-closure.md) |
| M4 明细 | `docs/checks/productization/M4-*.md`（9 份） |
| M3 | [checks/productization/M3-2-final-report.md](checks/productization/M3-2-final-report.md) |
| M2 / M2.1 | `docs/checks/productization/M2.1-*.md`、`test-reliability-report.md` |
| M1 / M1-0 | `docs/checks/productization/M1-M2-final-report.md`、`docs/M1-0-*.md` |
| G1（Git 审查） | `docs/checks/productization/G1-adoption-report.md`、`docs/checks/git-review/` |

### 3.4 历史材料（`HISTORICAL` / `LOCAL`）

| 位置 | 内容 | 在版本库里吗 |
|---|---|---|
| `docs/history/initial-deployment/` | 初始部署的完整时间线、角色与工作流、问题与修复、原始会话导出 | **否**（本地） |
| `docs/analysis/` | M1 阶段对 DSH 运行时与插件能力的核查 | **否**（本地） |
| `docs/runs/` | 一次角色包渲染的运行记录（`RUN-20261102-P1B`） | **否**（本地） |

这三处**不随发行包分发**，也不在干净克隆中出现。它们含早期项目名与作者机器路径，属于「过程留痕」，不作为当前事实依据。

### 3.5 子系统文档（`mars/docs/`）

MARS 的历史设计与评审记录，共 40 份。索引见 [mars/docs/README.md](../mars/docs/README.md)。

其中仍具参考价值的只有：

- [mars/docs/architecture.md](../mars/docs/architecture.md) —— Phase 1 架构（**部分过期**：模块清单未含 M3 的 ports/adapters/composition）
- [mars/docs/security.md](../mars/docs/security.md) —— 安全边界与威胁模型
- [mars/docs/mcp-access.md](../mars/docs/mcp-access.md) —— MCP 接入与身份映射

其余为 Phase 1/2 的一次性评审与验收记录（`phase1-review*.md`、`phase2-review*.md`、`plan/wp*-review*.md`）。

### 3.6 流程资产（`core/`）

不是「关于项目的文档」，而是**给人或 AI 会话读的工作规则**：角色卡、工作流、任务协议、证据规范、模板。入口是 [core/README.md](../core/README.md)。

---

## 4. 已知失效内容（读之前先看这一节）

以下内容**已知与当前事实不符**，保留是因为它们是带日期的证据或待处理的技术债。逐条给出「哪里失效、当前事实是什么、去哪看」。

| 文档 | 失效点 | 当前事实 | 去哪看 |
|---|---|---|---|
| `docs/architecture/m3/host-adapter-design.md` 文首 | 「状态：设计草案（未实现）」 | M3-2 已全部实现并合入 | [M3-2 最终报告](checks/productization/M3-2-final-report.md) |
| `docs/architecture/m3/migration-plan.md` | 通篇为「将要做」 | 已执行完毕，B0–B5 各有 tag | `git tag -l 'm3-*'` |
| `mars/docs/architecture.md` | 模块清单只有 10 个域文件 | 现有 22 个域文件 + 5 端口 + 8 适配器 | [docs/PROJECT-MAP.md](PROJECT-MAP.md) |
| `mars/docs/interfaces.md` §3 | 授权动作含 `ledger.read` | 该动作已在 M3 移除，改为 `ledger.parse` | [CHANGELOG.md](../CHANGELOG.md) M3 段 |
| `docs/checks/GITHUB.md` | 「状态：未接入」 | 已推送，CI 已运行 6 个 job | [M2.1 CI 报告](checks/productization/M2.1-ci-validation-report.md) |
| `docs/checks/productization/remaining-issues.md` | M1/M2 时的 10 项遗留 | 6 项已关闭，4 项仍在 | [docs/checks/README.md](checks/README.md) §2 |

---

## 5. 维护规则

1. **新增正式文档**必须在本页 §3.1 登记；不登记的文档视为草稿。
2. **新增验收证据**必须放进 `docs/checks/` 并在 [docs/checks/README.md](checks/README.md) 索引一行。
3. **不改写带日期的证据**。发现证据有事实错误时，新增勘误段落，并在此页 §4 登记。
4. **不把历史材料移入正式文档区**。历史材料的价值在于「原样保留」。
5. **链接必须可点**。提交前自查相对链接是否指向真实文件（自动化检查在 M5-B6 加入 `tooling/docs-check.mjs`）。

---

## 6. 一句话总结每份正式文档

| 文档 | 一句话 |
|---|---|
| `README.md` | 它是什么、不是什么、5 步跑通、文档地图、当前能力与诚实状态 |
| `docs/quickstart.md` | 10 分钟从零到「一条记忆被批准并编译进上下文包」，每步都有预期输出 |
| `docs/install.md` | 从零到能写入第一条记忆的完整步骤，以及装不上时怎么办 |
| `docs/maintainer-guide.md` | 出了错先查这里；备份、发版、回滚、跑测试的标准动作 |
| `docs/testing.md` | 测试分三类，门禁只认四个计数，skip 等于失败 |
| `docs/versioning.md` | 产品版本、数据格式版本、数据库结构版本是三个独立维度 |
| `docs/PROJECT-MAP.md` | RDS 是流程资产，MARS 是引擎；五端口隔离宿主；改哪里会牵动哪里 |
| `CHANGELOG.md` | 每个里程碑改了什么、删了什么、什么没变 |
