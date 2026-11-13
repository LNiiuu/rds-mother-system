# 验收证据索引

**性质**：`EVIDENCE`。本目录下的文档是**带日期的一次性记录**，结论只对当时有效。

**不要做的事**：

- 不要用这里的历史结论覆盖当前事实（例如 `GITHUB.md` 说「未接入」，而仓库早已推送）
- 不要改写证据正文来「修正」它。发现错误就新增勘误段，并登记到 [docs/README.md](../README.md) §4
- 不要把这里的数字当作当前数字（测试数是 78 → 88 → 128 → 173，引用时必须带日期）

**当前事实去哪看**：[docs/README.md](../README.md) → 正式文档区。

---

## 1. 按里程碑

### M1-0 / M1-A：母体系骨架与 REA 能力基线（2026-11-01）

| 文档 | 内容 | 结论 | 现在还有效吗 |
|---|---|---|---|
| [../M1-0-ACCEPTANCE.md](../M1-0-ACCEPTANCE.md) | M1-0 验收报告：12 项对照 | **有条件通过**（PCAP 项 BLOCKED） | 有效作为历史；PCAP 至今未解决 |
| [../M1-0-DELIVERABLES.md](../M1-0-DELIVERABLES.md) | 交付清单与回滚索引 | — | 历史 |
| [../M1-0-PROGRESS.md](../M1-0-PROGRESS.md) | 子阶段状态、能力矩阵 | — | 历史 |
| [m1a-checkpoint-01.md](m1a-checkpoint-01.md) | 骨架与自检建立 | PASS | 历史 |
| [m1a-checkpoint-02.md](m1a-checkpoint-02.md) | 0A 基线完成、0B 阻塞 | PARTIAL | 历史 |
| [m1-0b-checkpoint.md](m1-0b-checkpoint.md) | JADX / Frida / 样本 | PASS | 历史 |
| [m1-0c-checkpoint.md](m1-0c-checkpoint.md) | 六套工作流建立并运行 | PASS（W-05 BLOCKED） | 历史 |
| [m1-0d-checkpoint.md](m1-0d-checkpoint.md) | 回归、重复验证、证据抽查、回滚 | PASS | 历史 |
| [v1.3.1-crosscheck.md](v1.3.1-crosscheck.md) | 与 v1.3.1 任务书的交叉检查 | — | 历史 |

> **为什么保留**：这些是 RDS 从「一份任务书」变成「一个仓库」的全部过程记录。删掉它们，M1-0 的「有条件通过」就无法复核。

### AP-12：首次提交与远程接入（2026-11-01）

| 文档 | 内容 | 现在还有效吗 |
|---|---|---|
| [AP-12-first-commit-review.md](AP-12-first-commit-review.md) | 首次提交准备与内容审查（含 R-01…R-06 风险登记） | 历史；其中 R-02「机器路径」与 R-06「CRLF」至今仍是技术债 |
| [AP-12-first-commit-executed.md](AP-12-first-commit-executed.md) | 首次提交执行记录 | 历史 |
| [AP-12-final-review.md](AP-12-final-review.md) | R-05 修正后的最终复核 | 历史 |
| [GITHUB.md](GITHUB.md) | GitHub 远程接入记录 | **已失效**：文首写「状态：未接入」，实际早已推送并跑通 CI。当前事实见 [M2.1 CI 报告](productization/M2.1-ci-validation-report.md) |
| [sync-log.md](sync-log.md) | 同步记录表（空表） | 未启用 |

### M1 / M2：可部署化与测试可靠性（2026-11-08）

| 文档 | 内容 | 结论 |
|---|---|---|
| [productization/M1-M2-final-report.md](productization/M1-M2-final-report.md) | M1+M2 最终验收 | 通过；测试 78/80 → 88/88 |
| [productization/test-reliability-report.md](productization/test-reliability-report.md) | 测试可靠性：去环境化、消灭静默 skip | 通过 |
| [productization/remaining-issues.md](productization/remaining-issues.md) | M1/M2 遗留的 10 项问题 | 6 项已关闭，4 项仍在（见 §2） |
| [productization/change-attribution.md](productization/change-attribution.md) | 变更归属与 51 项原有工作保护 | 方法沿用至 M5 |

### M2.1：CI 实证（2026-11-08）

| 文档 | 内容 | 结论 |
|---|---|---|
| [productization/M2.1-ci-validation-report.md](productization/M2.1-ci-validation-report.md) | 四组矩阵在 GitHub Actions 真实跑通 | 通过；run `42479193137` |
| [productization/M2.1-final-status.md](productization/M2.1-final-status.md) | M2.1 最终状态与剩余项 | 7 项，多数已由 M3/M4 关闭 |
| [productization/M2.1-release-validation.md](productization/M2.1-release-validation.md) | 发行包验收 | 通过 |
| [productization/ci-validation-report.md](productization/ci-validation-report.md) | 早期 CI 验证（M2） | 历史 |

### G1：Git 审查工作流（2026-11-08）

| 文档 | 内容 | 结论 |
|---|---|---|
| [productization/G1-adoption-report.md](productization/G1-adoption-report.md) | G1 整体入库验收：六个夹具真实执行 | PASS；CI 中 g1 job 耗时 27s（非跳过） |
| [productization/g1-path-resolution.md](productization/g1-path-resolution.md) | G1 路径解析修复说明 | 归档 |
| [git-review/README.md](git-review/README.md) | 运行证据目录说明与扫描范围限制 | 持续有效 |
| `git-review/run-20261101-*` | 9 次审查运行的完整输出（`review-report.json` / `.md`、`diff.patch`、`commands.log`） | 一次性证据，**含本机绝对路径**，属 `doctor` 的 `paths:docs` warn |
| `git-review/rollback/` | 实施前的文件副本与 SHA-256 清单 | 本机回滚依据，不参与提交 |

### M3：宿主适配层（2026-11-09）

| 文档 | 内容 | 结论 |
|---|---|---|
| [productization/M3-2-final-report.md](productization/M3-2-final-report.md) | 五端口 + 八适配器 + 组合根落地 | 通过；测试 128/128，7 面基线零漂移 |
| [../architecture/m3/](../architecture/m3/) | 6 份设计文档 + 7 份基线快照 | 见 [docs/README.md](../README.md) §3.2 |

### M4：可维护性（2026-11-09）

| 文档 | 内容 | 结论 |
|---|---|---|
| [productization/M4-closure.md](productization/M4-closure.md) | **M4 最终封版记录**（七项核实 + 6 项已知限制） | `COMPLETED WITH WARNINGS` |
| [productization/M4-final-acceptance.md](productization/M4-final-acceptance.md) | 15 项验收逐条对照 | 15 PASS |
| [productization/M4-maintainability-audit.md](productization/M4-maintainability-audit.md) | B0 审计：16 项问题清单（无 S1） | 基线 |
| [productization/M4-schema-contract-report.md](productization/M4-schema-contract-report.md) | B1 契约与 Schema 一致性 | 通过 |
| [productization/M4-script-governance-report.md](productization/M4-script-governance-report.md) | B2 脚本治理（删除损坏脚本、加固身份签发） | 通过 |
| [productization/M4-database-maintenance-report.md](productization/M4-database-maintenance-report.md) | B3 数据库生命周期 | 通过 |
| [productization/M4-version-compatibility-report.md](productization/M4-version-compatibility-report.md) | B4 配置、版本与兼容性 | 通过 |
| [productization/M4-observability-report.md](productization/M4-observability-report.md) | B5 可观测性与故障诊断矩阵 | 通过 |
| [productization/M4-test-report.md](productization/M4-test-report.md) | 测试报告（128 → 173） | 通过 |
| [productization/M4-rollback-report.md](productization/M4-rollback-report.md) | 逐批回滚演练（暴露 2 个真缺陷，B6 修复） | 通过，含 1 项条件 |
| [productization/M4-ci-validation-report.md](productization/M4-ci-validation-report.md) | 四组 CI 实证 | run `42583081805` / `42583509413` 全绿 |
| [productization/M4-architecture-review.md](productization/M4-architecture-review.md) | 架构复核 | 通过 |

### M5：可发现性（2026-11-09）

| 文档 | 内容 |
|---|---|
| [productization/M5-final-acceptance.md](productization/M5-final-acceptance.md) | **M5 最终验收**：10 项交付物对照、七批次、修掉的 12 类缺陷、未完成事项、技术债、目标达成判定 |
| [productization/M5-docs-audit.md](productization/M5-docs-audit.md) | B0 只读审计：44 项发现（1 项 S1），每项带 file:line 与承接批次 |
| [productization/M5-information-architecture.md](productization/M5-information-architecture.md) | B1 信息架构：四类分离、状态图例、为什么用索引而不是移动文件 |
| [productization/M5-cli-coverage.md](productization/M5-cli-coverage.md) | B3 CLI 帮助覆盖：1/19 → 22/22，修掉 `init-dev --help` 覆盖身份文件的 S1 缺陷 |
| [productization/M5-path-portability.md](productization/M5-path-portability.md) | B4 路径与可移植性：doctor 补两个扫描盲区、ledger 绝对路径的六方案评估 |
| [productization/M5-clean-clone.md](productization/M5-clean-clone.md) | B6 干净克隆：342 文件、0 脏状态、196 项全过、照文档 10 步逐步对照 |
| [productization/M5-test-report.md](productization/M5-test-report.md) | B6 测试：173 → 196，三个新文件的用例逐个说明守什么 |
| [productization/M5-ci-validation-report.md](productization/M5-ci-validation-report.md) | B6 CI：run 42594239389，6/6 job，1m23s，四条「真跑过」的证据 |

### M6：macOS 兼容性验证（2026-11-11）

| 文档 | 内容 |
|---|---|
| [productization/M6-macos-acceptance.md](productization/M6-macos-acceptance.md) | **M6 验收**：runner 架构与版本、FTS5 探针六条断言、doctor/测试/smoke 结果、过程中修掉的过强断言、已验证与未验证的边界 |
| [productization/M6-closure.md](productization/M6-closure.md) | **M6 收尾**：最终 run 43051690255 @ `b904842` 的 run/job/步骤三级证据、`COMPLETED` 判定、六项复核（HEAD / 工作区 / 49 项指纹 / 20 个 Tag / 报告一致性 / 链接） |
| [productization/M5-macos-assessment.md](productization/M5-macos-assessment.md) | 前置评估（M5 收尾时做的只读分析）：八维度静态核对、8 条平台差异、成本收益、最小方案 |

> M6 与 M5 并列，不是 M5 的一部分。M5 的验收范围明确不含 macOS（见 [M5-closure.md](productization/M5-closure.md) §4.2）。

### M7：真实长任务验证与价值评估（2026-11-12）

| 文档 | 内容 |
|---|---|
| [productization/M7-0-baseline.md](productization/M7-0-baseline.md) | M7-0 基线：Git/工作区/测试/封版核实，真实能力与设计设想的划分，探针发现的 4 个问题 |
| [productization/M7-1-protocol.md](productization/M7-1-protocol.md) | M7-1 预注册方案：假设、A/B 定义、9 项指标口径、验收阈值、7 条混杂因素 |
| [productization/M7-2-experiment-record.md](productization/M7-2-experiment-record.md) | M7-2 原始记录：两组时间线、MARS 拓扑、真实 token/字节/读取数据、V1–V5 合规检查 |
| [productization/M7-3-analysis.md](productization/M7-3-analysis.md) | M7-3 分析：逐指标对比、协调成本拆解、7 个问题逐条回答、判定 H0 |
| [productization/M7-final-report.md](productization/M7-final-report.md) | **M7 最终报告**：阶段 COMPLETED / 假设 NOT SUPPORTED，六个问题的回答与 P0–P2 建议 |

> M7 的结论是**负向**的（未证明 MARS 有可测价值），不是「未完成」。
> 实验按预注册完成，四个预注册哈希执行前后一致；结论的局限写在最终报告 §3。

### M8：最小可用产品落地（2026-11-12）

| 文档 | 内容 |
|---|---|
| [productization/M8-implementation-record.md](productization/M8-implementation-record.md) | M8-1 身份数据保护（默认拒绝覆盖、`--add` / `--replace`、7 例测试）+ M8-2 上下文包改动与兼容性 |
| [productization/M8-packet-comparison.md](productization/M8-packet-comparison.md) | M8-4 前后对比：同内容 JSON −27.3%、读取成本 −57.0%、实测 token −56.3%、编译无退化 |
| [productization/M8-e2e-verification.md](productization/M8-e2e-verification.md) | M8-3 九环节强制/约定划分 + M8-5 干净克隆、安装流程、备份恢复、CI 状态 |
| [productization/M8-final-acceptance.md](productization/M8-final-acceptance.md) | **M8 验收**：五个必答问题、交付物清单、已知限制、发布阻塞项 |

> M8 判定：阶段 `COMPLETED`，产品「达到 MVP，未达正式发布」。
> 唯一未闭环的验收项是 **CI**——M8 改动未推送，CI 无法运行，不得记为通过。
> 原始数据在 [m8/](m8/)。

### M9–M11：上下文基础设施、压缩与多 Agent 协作（2026-11-12）

| 文档 | 内容 |
|---|---|
| [../m9/M9-0-baseline.md](m9/M9-0-baseline.md) | M9 开工前的 Git/测试/架构/风险基线 |
| [productization/M9-closure.md](productization/M9-closure.md) | 多项目、路径安全、预算、监控、分层；5 项隔离测试 |
| [productization/M10-closure.md](productization/M10-closure.md) | 确定性压缩（去重/折叠/归档）、恢复与哈希校验；语义摘要未做 |
| [productization/M11-closure.md](productization/M11-closure.md) | R0–R7、11 态任务机、调度拆分、交接、成本账本；多 Agent 为模拟 |
| [productization/M9-M11-final-acceptance.md](productization/M9-M11-final-acceptance.md) | **总验收**：A–H 八节，含 Git 状态与 GitHub 提交准备 |
| [m9-m11/demo.json](m9-m11/demo.json) | 双项目 + 模拟角色演示的原始 JSON（`simulated: true`） |

> 总判定 **COMPLETED WITH WARNINGS**：CI 未运行；Linux/macOS 未跑本轮；
> 真实模型对照 NOT RUN；语义摘要未实现。不得把这些写成通过。

---

### M12–M17：执行层、专业引擎与产品化（2026-11-12）

| 文档 | 内容 |
|---|---|
| [m12/M12-0-baseline-audit.md](m12/M12-0-baseline-audit.md) | 只读基线审计：Git/指纹/数据库备份、分层约束、**执行层为空的证据**、外部能力可用性 |
| [m12/M12-1-runtime-design.md](m12/M12-1-runtime-design.md) | Runtime 架构：端口为什么只有 5 个方法、状态机、权限强度、兼容性、测试矩阵 |
| [productization/M12-M17-closure.md](productization/M12-M17-closure.md) | **六个里程碑的封版记录**：目标/变更/决策/测试/失败/CI/成本/安全/Git/未完成 |
| [final/RDS-MARS-final-acceptance.md](final/RDS-MARS-final-acceptance.md) | **最终验收报告 A–L**：能力总览、里程碑状态、多 Agent 证据、REA 六套证据、联合案例、跨平台、测试/CI/安装、费用、安全、Git、限制、推送方案 |
| [m12/demo-chain.json](m12/demo-chain.json) | 4 Agent 交接链原始输出（独立 session 4/4、3 次交接、测试 fail=1 → pass=1） |
| [m14/](m14/) | REA 六套工作流的真实 result.json / report.md / evidence.json |
| [m14/joint-demo.json](m14/joint-demo.json) | M15 联合演示原始输出（逆向 → 审核 → 重构） |

> 本轮判定（已按 2026-11-13 审计修正）：M12/M13 为 `COMPLETED WITH WARNINGS` / `PARTIAL`
> （真实模型未跑、M13 当时无并发调度），M14/M15/M17 `COMPLETED`（有明确边界），M16 `COMPLETED WITH WARNINGS`
> （两个 Provider 协议已实现并契约测试，但**真实网络调用 NOT RUN**，无凭据）。
> 总体 `COMPLETED WITH WARNINGS`：不允许把 mock 全链路写成「真实多 Agent 已验证」。
> 当前状态与并发调度补齐情况见 [final/M18-M20-final-acceptance.md](final/M18-M20-final-acceptance.md)。

### M21–M25：本地模型、平台适配与发布审核（2026-11-14）

| 文档 | 内容 |
|---|---|
| [m21-m25/baseline-audit.md](m21-m25/baseline-audit.md) | 环境/硬件/平台/工具/凭据审计 |
| [m21/final-acceptance.md](m21/final-acceptance.md) | Ollama Provider；真实推理 `BLOCKED`（模型下载损坏） |
| [m21/download-failure.log](m21/download-failure.log) | 模型哈希不符与下载中断原始回显 |
| [m22/architecture.md](m22/architecture.md) | 平台端口/注册表/四适配器/契约测试 |
| [m23/toolchain-audit.md](m23/toolchain-audit.md) | TShark 4.6.9 真实执行；Ghidra/JADX/Frida 阻断 |
| [m23/final-acceptance.md](m23/final-acceptance.md) | W-01..W-06 四值状态（`PARTIAL`） |
| [m24/final-acceptance.md](m24/final-acceptance.md) | 真实模型多 Agent `BLOCKED`；编排/REA 真实 |
| [m24/scenario.md](m24/scenario.md) | 平台→RDS 端到端 `NOT RUN` |
| [m25/independent-review.md](m25/independent-review.md) | 第一轮独立审核（不可发布 → 整改项） |
| [m25/second-review.md](m25/second-review.md) | 第二轮复核（待生成） |
| [final/pre-push-release-audit.md](final/pre-push-release-audit.md) | 当前 HEAD 发布审计（待生成） |

> M21/M22/M23/M24 判定均为 **`PARTIAL`**；M21 真实推理、M23 W-03/W-06、M24 真实模型多 Agent 为 `BLOCKED`。
> 平台层是“库 + 契约测试”，尚未接入 runtime/scheduler。

### M18–M20：编排、REA 工具与联合场景（2026-11-13）

| 文档 | 内容 |
|---|---|
| [m18-m20/baseline-audit.md](m18-m20/baseline-audit.md) | M18–M20 基线：Git/角色/环境/阻塞项/保护清单 |
| [m18/architecture.md](m18/architecture.md) | M18 调度器、Schema v8、工作区隔离与冲突合并 |
| [m18/provider-verification.md](m18/provider-verification.md) | Provider 真实路径与 T18-01 BLOCKED；多轮历史修复 |
| [m18/agent-isolation.md](m18/agent-isolation.md) | 独立 Agent/Session/Run/上下文/写路径 |
| [m18/scheduling-verification.md](m18/scheduling-verification.md) | DAG、优先级、并发上限、取消、重试 |
| [m18/concurrency-verification.md](m18/concurrency-verification.md) | 3 个 job 的真实时间重叠与冲突保护 |
| [m18/recovery-verification.md](m18/recovery-verification.md) | 心跳陈旧、重试、AGENT_LOST、合并冲突 |
| [m18/cost-verification.md](m18/cost-verification.md) | 估算用量、预算、无真实 Provider 费用 |
| [m18/final-acceptance.md](m18/final-acceptance.md) | M18 T18-01..10：`PARTIAL`（真实模型 BLOCKED） |
| [m19/tool-adapter-architecture.md](m19/tool-adapter-architecture.md) | 统一工具适配层与能力清单 |
| [m19/security-verification.md](m19/security-verification.md) | 样本只读/临时目录/超时；无容器隔离 |
| [m19/evidence-model.md](m19/evidence-model.md) | 事实/推断/未验证分层与证据文件 |
| [m19/final-acceptance.md](m19/final-acceptance.md) | W-01..W-06 四值状态：`PARTIAL`（W-02/03/05/06 BLOCKED） |
| [m20/scenario.md](m20/scenario.md) | Development + REA 联合场景 |
| [m20/final-report.md](m20/final-report.md) | 联合执行报告（真实 REA + mock Agent） |
| [m20/final-acceptance.md](m20/final-acceptance.md) | M20 T20-01..10：`PARTIAL`（真实 Agent BLOCKED） |
| [final/M18-M20-final-acceptance.md](final/M18-M20-final-acceptance.md) | M18–M20 最终验收 A–H 与 Git 状态 |

> M18/M19/M20 判定：均为 **`PARTIAL`**。原因是真实模型凭据、Ghidra/JADX/TShark/Frida 工具缺失；
> 调度、工作区隔离、并发、冲突、恢复、W-01/W-02/W-04 证据为真实执行。

## 2. 旧遗留清单的现状

[M1/M2 遗留清单](productization/remaining-issues.md) 列了 10 项。截至 M6 收尾：

| # | 问题 | 现状 |
|---|---|---|
| 1 | CI 未真实运行 | **已关闭**（M2.1） |
| 2 | Ubuntu / macOS 未实机验证 | **已关闭（有限范围）**：Ubuntu 由 CI 覆盖；macOS 由 `macos-latest`（macos26 / arm64 / Node 22）覆盖。Intel Mac 与其他 macOS 版本仍不承诺，见 [M6-closure.md](productization/M6-closure.md) §5 |
| 3 | `tests/self/run.ps1` 有 1 项 FAIL | **已关闭**（M2.1 拆分活跃/历史） |
| 4 | `serverInfo.version` 不一致 | **已关闭**（M4-B4） |
| 5 | G1 工作流未提交 | **已关闭**（G1 整体入库） |
| 6 | 11 个文档含本机路径 | **未关闭**（M5 处理：归档 + 标注，不改写） |
| 7 | 缺 `rds principal` 命令 | **未关闭**（M5 只登记，不实现） |
| 8 | 运维脚本不进发行包 | **未关闭**（M5 只登记，不实现） |
| 9 | Node 版本下界未全区间实测 | **未关闭**（`engines` 已收紧到 22.15，但未实机验证 22.15.0） |
| 10 | 版本号体系未定型 | **已关闭**（M4-B4 + `docs/versioning.md`） |

---

## 3. 引用证据的规矩

1. **带日期**。「测试 173 项通过」必须写成「173 项通过（2026-11-09，`b89cbb2`）」。
2. **带结论强度**。`PASS` / `PARTIAL` / `BLOCKED` / `FAIL` 是四件事，不要合并成「完成」。
3. **区分「当时通过」与「现在仍通过」**。前者是证据，后者要重新跑命令。
4. **不复用旧数字**。测试数、文件数、包大小都会变。
