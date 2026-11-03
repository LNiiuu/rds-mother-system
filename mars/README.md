# MARS — Memory & Retrieval Subsystem (RDS 内部子系统)

MARS Phase 1：记忆存储、检索、上下文编译、清单去重、预算、Token 账本与 MCP 网关。
MARS Phase 2：已接入 DSH，5 个本地 stdio MCP 服务（`mars-r0`…`mars-r4`）按角色绑定身份，默认只读 + propose。

## 状态

- 部署：Local（Node.js v24，内置 `node:sqlite`，FTS5 可用）
- 接入：MCP 本地 stdio，已注册 `mars-r0`…`mars-r4`（见 `docs/mcp-access.md`）；未注册即不可用，关闭/回滚见同文
- 数据：SQLite（`var/mars.db`，可配置）+ JSON + FTS5
- 向量检索：未实现（Phase 2 再评估）

## 快速开始

```powershell
# 初始化数据库（默认 D:\M1\mars\var\mars.db）
node D:\M1\mars\src\cli.js init

# 以测试身份写入一条 proposed 记忆
node D:\M1\mars\src\cli.js put --token <dev-token> --project xingrixiao --type L3 `
  --content "示例决策：..." --source "docs/decision.md" --version v1

# 检索（只返回 approved；proposed 不进入正式上下文）
node D:\M1\mars\src\cli.js search --token <dev-token> --project xingrixiao --query "示例"

# 编译上下文包（含 manifest 与预算）
node D:\M1\mars\src\cli.js compile --token <dev-token> --project xingrixiao `
  --task T-XRX-001 --role R2 --budget 4000 --out .\var\packet.json

# 解析 DSH 会话 usage，生成账本
node D:\M1\mars\src\cli.js ledger --session <session.v4.jsonl.zstd> --out .\var\ledger
```

开发身份映射见 `config/principals.example.json`（只存 token 的 SHA-256，不存明文）。

## 目录

- `contracts/` — 统一数据契约（JSON Schema）
- `docs/` — 架构、接口、安全、MCP、基线与验收记录
- `src/` — 实现（模块见 `docs/interfaces.md`）
- `tests/` — Node 内置测试（`node --test`）
- `config/` — 角色路由与身份映射示例（不含真实凭据）
- `var/` — 运行时数据库与产物（`mars/.gitignore` 排除，不纳入版本管理）

## 边界

仅本地离线运行；不访问网络；不读取 `.env`/凭据；不修改 DSH 全局配置；不部署公网。

## Phase 1 验证（本地）

```powershell
node --test D:\M1\mars\tests\ledger\ledger.test.js D:\M1\mars\tests\mcp\mcp.test.js `
  'D:\M1\mars\tests\phase1\*.test.js' 'D:\M1\mars\tests\phase2\*.test.js'
# 全量：80 用例（8 ledger + 6 mcp + 42 phase1 + 6 phase2 + 5 phase3 + 7 phase4 + 6 wp1）
```

- 独立测试报告：`docs/phase1-test-report.md`（R3，首轮 50/50）
- 独立审查报告：`docs/phase1-review.md`（R4，首轮 PARTIAL）；`tests/phase1/remediation.test.js` 覆盖 P1–P4 回归
- Token 前后对照（估算）：`docs/token-baseline.md`
- 基线核验：`docs/baseline.md`（pre-MARS 70 未跟踪 + 1 修改，SHA-256 与 Phase 0 一致）
- 回滚：`scripts/mars-rollback.ps1`（默认干跑；`-Yes` 删除 `var/` 顶层 mars.db*（含 -wal/-shm）、*.json、*.csv；`-RemoveTokens`/`-RemovePrincipals` 可选删除 token 与 principals）

## Phase 2（DSH MCP 接入，2026-11-03）

- 接入说明与身份映射：`docs/mcp-access.md`（含关闭、回滚、token 轮换、网关 fail-closed）
- 安全报告：`docs/phase2-g1-security-report.md`（PASS 有条件；G1-F01…F09 已修复）
- 真实运行记录：`docs/phase2-g2-runs.md`；工作流：`docs/phase2-g3-workflow.md`
- A/B 报告：`docs/phase2-g4-ab-report.md`（质量 22/24 → 23/24；载荷 −70.8%；单次 token 差异在噪声内）
- 关闭：`scripts/mars-mcp-disable.ps1`（默认干跑，`-Yes` 先备份注册表再移除 `mars-*` 条目）

## P3–P6（2026-11-03 起）

- P3 治理：`docs/governance.md`（状态机、可见性、过期、审批、审计）；迁移与恢复演练：`docs/plan/rollback-drill.md`
- P4 成本/质量：`docs/p4-cost-quality-report.md`（6 任务 × 双臂真实运行，`experiments/p4/`）
- P5 跨项目共享：`docs/sharing.md`（默认拒绝、双项目审批、撤销与过期、共享审计）
- P6 编排：`docs/orchestration.md`（分类、最小 Agent 集、风险门、预算、反馈、离线建议）
- 全量测试：`node --test`（ledger + mcp + phase1–4）**80 用例**
- 生产库：schema v4（`expires_at`、`projects`、`shares`、`orchestrator_runs`、`rate_limits`）；备份/校验：`scripts/mars-db-backup.js`

## 已知限制（Phase 1–P6 明示）

- token 轮换=重签 token 文件并重建服务（`mars-issue-mcp-identity.js --revoke` 可吊销）；限流按进程+持久窗口，无分布式配额。
- 无向量检索；中文全文依赖 FTS5 + 分段 LIKE 回退；token 为字符估算。
- 上下文 packet 不含完整角色卡；角色卡仍由 RDS 渲染器注入。
- MCP 服务无 `--enable` 开关：默认关闭=默认不注册 + 每实例 token/角色绑定；网关启动强制加载 routing（缺失即退出）。
- 编排器为可解释规则引擎（`rule/1.0.0`），`suggest` 仅离线建议、不自动应用；高风险任务必须人工审批。
