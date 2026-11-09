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

### M5：可发现性（2026-11-09，进行中）

| 文档 | 内容 |
|---|---|
| [productization/M5-docs-audit.md](productization/M5-docs-audit.md) | B0 只读审计：44 项发现（1 项 S1） |

本行以下文档随 M5 各批次产出后回填：信息架构报告（B1）、CLI 帮助覆盖报告（B3）、路径可移植性报告（B4）、干净克隆验证 / 测试报告 / CI 验证 / 最终验收（B6）。

---

## 2. 旧遗留清单的现状

[M1/M2 遗留清单](productization/remaining-issues.md) 列了 10 项。截至 M5 起点：

| # | 问题 | 现状 |
|---|---|---|
| 1 | CI 未真实运行 | **已关闭**（M2.1） |
| 2 | Ubuntu / macOS 未实机验证 | **部分关闭**：Ubuntu 由 CI 覆盖；macOS 仍未验证 |
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
