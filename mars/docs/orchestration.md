# P6 任务编排（可解释规则引擎）

版本：v0.1（P6 / WP-4，2026-11-03）
实现：`src/orchestrator.js`（`rule/1.0.0`），数据表 `orchestrator_runs`（schema v4），CLI `orchestrate`。

## 1. 定位

P6 只做**任务分类、最小 Agent 集、风险门、预算与反馈**，不调度真实 Agent 会话（R0 仍负责实际派发）。
规则全部可解释：每个 plan 返回 `explanation` 与 `sensitivity`，便于 R0/用户复核。

## 2. 分类（classify）

按关键词顺序匹配，先命中先返回：

| 类别 | 关键词（示例） | 默认 Agent |
|---|---|---|
| `verification` | 测试、验证、审查、复现、回归 | R3（中等风险加 R4） |
| `implementation` | 实现、开发、修复、重构、迁移代码 | R2 + R3 |
| `architecture` | 架构、设计、接口、契约、方案 | R1 |
| `research` | 调研、评估、对比、选型 | R5 |

未命中归 `research`（低风险）。风险等级：

- `high`：支付、权限、密钥、迁移、删除、生产、发布、共享、跨项目、安全边界；
- `medium`：数据库、接口、依赖、外部、并发、回滚；
- 其余 `low`。

## 3. 计划（plan）

输入：`{project_id, task_id, objective, description?, budget?}`。

- `PROJECT_REQUIRED`：缺 `project_id`；`PROJECT_DENIED`：项目不在注册表（`projects`）。
- Agent 最小集合：architecture→R1、implementation→R2+R3、verification→R3、research→R5；
- `medium` 增加 R4；`high` 强制 R0+R4，并替换低权限角色（避免 `AGENT_RISK_MISMATCH`）。
- 输出 `context_policy`（`per_agent_budget`、`memory_types`、`evidence_direct`）、
  `gates`（`requires_r4`、`requires_human_approval`、`approval_scope`）、`explanation`。

## 4. 运行与状态

| 状态 | 含义 | 进入条件 |
|---|---|---|
| `planned` | 已生成计划 | `startRun` 生成 |
| `awaiting_approval` | 高风险待人工审批 | risk=high |
| `running` | 已审批/低中风险 | `approveRun` 或自动 |
| `paused_budget` | 超预算 | `recordFeedback` 累计 token 超 `task_tokens` |
| `closed` | 反馈完成 | 反馈记录后 |

- `approveRun` 记录 `approved_by/approved_at`；未审批的 `recordFeedback` 返回 `NOT_APPROVED`。
- `budgetStatus` 返回累计 `tokens_total`、预算与剩余；兼容 `task_tokens` / `task_budget` 字段名。
- `suggest` 只读历史反馈，输出 `{mode:'suggestion_only', applied:false, suggestions:[...]}`，不自动改计划。

## 5. CLI

```powershell
node src/cli.js orchestrate plan  --project rds-m1 --task T-1 --objective "实现 token 轮换说明"
node src/cli.js orchestrate start --project rds-m1 --task T-1 --objective "..." --by R0
node src/cli.js orchestrate approve --run run_xxx --by R0 --reason "高风险审批"
node src/cli.js orchestrate feedback --run run_xxx --tokens 12000 --quality 0.9 --rework 0
node src/cli.js orchestrate status --run run_xxx
node src/cli.js orchestrate suggest --project rds-m1
```

## 6. 验证与限制

- 测试：`tests/phase4/orchestrator.test.js` 7 用例（分类、最小集、medium 加 R4、high 审批门、未知项目、预算暂停、反馈与离线建议）。
- 限制：规则引擎非学习模型；`high` 判定依赖关键词，措辞变化可能误判（`sensitivity` 明示）；
  不落真实 Agent 派发；`suggest` 不自动应用；预算为 token 累计而非成本。
