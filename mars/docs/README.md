# mars/docs 索引

**性质**：混合。这里既有**仍可参考的子系统设计**，也有**带日期的历史评审记录**。两者价值不同，读之前先分清。

**当前代码的模块与分层，以 [docs/PROJECT-MAP.md](../../docs/PROJECT-MAP.md) 为准**；本文档只是历史材料的导航。

---

## 1. 仍有参考价值（`DESIGN`，但部分内容已过期）

| 文档 | 内容 | 过期点 |
|---|---|---|
| [architecture.md](architecture.md) | MARS Phase 1 架构设计（v1.2，673 行，最完整的一份） | 模块清单只有 10 个域文件；缺 M3 的 `ports/`、`adapters/`、`composition.js`、`paths.js`、`session-registry.js`；§9 的「已知限制」部分已关闭 |
| [security.md](security.md) | 安全边界与威胁模型：默认拒绝、token 只存哈希、审计、限流 | 基本仍有效；限流实现已从 `db.js` 拆到 `db/ratelimit.js` |
| [mcp-access.md](mcp-access.md) | MCP 接入、身份映射、关闭与回滚、token 轮换 | 基本仍有效；`MARS_ROLE` 与 `MARS_TOKEN_FILE` 的语义见 [docs/install.md](../../docs/install.md) §9 |
| [governance.md](governance.md) | 记忆状态机、可见性、过期、审批、审计 | 仍有效 |
| [sharing.md](sharing.md) | 跨项目共享：默认拒绝、双项目审批、撤销与过期 | 仍有效 |
| [orchestration.md](orchestration.md) | 编排器：分类、最小 Agent 集、风险门、预算、反馈 | 仍有效（规则引擎 `rule/1.0.0`，不自动应用） |
| [interfaces.md](interfaces.md) | 模块接口契约（函数签名） | **部分过期**：`ledger.read` 授权动作已在 M3 移除，改为 `ledger.parse`；模块清单缺 M3 新增文件 |

## 2. 历史评审与验收（`EVIDENCE`，一次性）

| 文档 | 阶段 | 内容 |
|---|---|---|
| [phase1-review.md](phase1-review.md) | Phase 1 | 独立审查（首轮 PARTIAL） |
| [phase1-review-round2.md](phase1-review-round2.md) | Phase 1 | 第二轮审查 |
| [phase1-test-report.md](phase1-test-report.md) | Phase 1 | 测试报告（50/50） |
| [phase1-acceptance.md](phase1-acceptance.md) | Phase 1 | 验收 |
| [phase2-review.md](phase2-review.md) | Phase 2 | 审查（含 xingrixiao 项目名） |
| [phase2-review-round2.md](phase2-review-round2.md) | Phase 2 | 第二轮审查 |
| [phase2-acceptance.md](phase2-acceptance.md) | Phase 2 | 验收 |
| [phase2-g1-security-report.md](phase2-g1-security-report.md) | Phase 2 | 安全报告（G1-F01…F09 已修复） |
| [phase2-g2-runs.md](phase2-g2-runs.md) | Phase 2 | 真实运行记录 |
| [phase2-g3-workflow.md](phase2-g3-workflow.md) | Phase 2 | 工作流验证 |
| [phase2-g4-ab-report.md](phase2-g4-ab-report.md) | Phase 2 | Token/质量 A/B（质量 22/24 → 23/24，载荷 −70.8%） |
| [phase2-git-status.md](phase2-git-status.md) | Phase 2 | 当时的 git 状态快照 |
| [p2-p6-acceptance.md](p2-p6-acceptance.md) | P2–P6 | 治理/成本/共享/编排的验收 |
| [p4-cost-quality-report.md](p4-cost-quality-report.md) | P4 | 6 任务 × 双臂真实运行 |
| [token-baseline.md](token-baseline.md) | Phase 1 | Token 前后对照（估算，非精确 tokenizer） |
| [baseline.md](baseline.md) | Phase 0/1 | 基线核验（含 `D:\Projects\xingrixiao` 等本机路径） |

## 3. 计划与执行记录（`HISTORICAL`）

| 文档 | 内容 |
|---|---|
| [plan/p2-p6-execution-plan.md](plan/p2-p6-execution-plan.md) | P2–P6 执行计划 |
| [plan/p2-legacy-matrix.md](plan/p2-legacy-matrix.md) | 遗留项矩阵 |
| [plan/p2-legacy-annotations.md](plan/p2-legacy-annotations.md) | 遗留项标注 |
| [plan/wp1-review.md](plan/wp1-review.md) | WP1 审查 |
| [plan/wp5-review.md](plan/wp5-review.md) | WP5 审查（含 `D:\新建文件夹 (6)\wxxcx\rwgl` 等旧项目路径） |
| [plan/wp5-review-round2.md](plan/wp5-review-round2.md) | WP5 第二轮审查 |
| [plan/wp5-integration.md](plan/wp5-integration.md) | WP5 集成 |
| [plan/test-report.md](plan/test-report.md) | 计划期测试报告 |
| [plan/rollback-drill.md](plan/rollback-drill.md) | 迁移与恢复演练 |
| [plan/candidate-manifest.json](plan/candidate-manifest.json) | 待迁移文件清单（含本机路径） |

## 4. 机器可读证据

| 路径 | 内容 |
|---|---|
| `checks/phase2/g1/role-R0.json` … `role-R4.json` | Phase 2 G1 安全核验的逐角色结果 |
| `checks/phase2/g1/summary.json` | 上述结果的汇总 |

---

## 5. 为什么这些文档没有被清理

1. **带日期的评审记录是证据**。它们记录了「当时认为哪里有问题、修没修、谁确认的」。改写等于篡改。
2. **历史项目名与机器路径无法安全替换**。替换后无法证明记录的真实性；而且这些文件不进发行包，不构成对外污染。
3. **`doctor` 的 `paths:docs` 只告警不失败**，正是为了保留这类证据（见 [docs/README.md](../../docs/README.md) §4）。

如果你要查「当前 MARS 怎么分层、模块有哪些」，看 [docs/PROJECT-MAP.md](../../docs/PROJECT-MAP.md)。
如果你要查「M3 为什么这么改」，看 [docs/architecture/m3/](../../docs/architecture/m3/)。
