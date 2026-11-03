# MARS MCP 接入说明（DSH，Local stdio）

版本：v0.2（Phase 2 / G1–G4 验证后更新）
适用：DSH 0.2.1-rc.5，Windows 10/11，MARS 运行于 D:\M1\mars。

## 1. 接入形态

- 传输：本地 stdio（JSON-RPC 2.0，newline-delimited）。
- 启动器：`C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe`（Electron-as-node）。
  环境变量 `ELECTRON_RUN_AS_NODE=1` 使其按 Node v24.21.0 执行 `src/mcp-stdio.js`。
- 服务端：`D:\M1\mars\src\mcp-stdio.js`，`serverInfo = {name:"mars", version:"0.2.0"}`，
  协议版本 `2024-11-05`。
- 不监听端口、不访问外网、不下发文件内容到远端；所有读写均在本机 `mars/var/mars.db`。

## 2. 身份与权限映射

每个 DSH MCP 服务实例绑定单一角色，身份不在请求参数中传递：

| MCP 服务名 | MARS principal | 角色 | 项目 | evidence_direct | 工具 |
|---|---|---|---|---|---|
| mars-r0 | mcp-R0 | R0 | rds-m1 | 是 | get/list/stats/propose/compile |
| mars-r1 | mcp-R1 | R1 | rds-m1 | 否 | 同上 |
| mars-r2 | mcp-R2 | R2 | rds-m1 | 否 | 同上 |
| mars-r3 | mcp-R3 | R3 | rds-m1 | 是 | 同上 |
| mars-r4 | mcp-R4 | R4 | rds-m1 | 是 | 同上 |

- 身份由 `MARS_TOKEN_FILE`（每角色 44 B 随机 token）与 `MARS_ROLE` 共同确定；
  `principals.json` 只保存 `token_sha256`，不保存明文 token。
- 客户端传入的 `role_id` / `project_id` 不作为授权依据；服务端以绑定的 principal
  校验项目、角色、可见性（project/role/private）与审批关系。请求体中的未知字段或越权字段
  由服务端参数校验拒绝（`INVALID_ARGUMENT`），不静默忽略。
- `memory_propose` 只能写入 `proposed`，且必须落在该角色 `allowed_types` 内（越界 `ROLE_TYPE_DENIED`）；
  `approved` 必须由 R0/R4 通过 CLI/审批路径完成，自审 `SELF_REVIEW_DENIED`。
  实现约束（N-03 已关闭）：`store.propose()` 缺省经 `resolveRouting()` 从 `MARS_ROUTING`/
  `config/role-routing.json` 加载路由，加载失败即 `ROUTING_UNAVAILABLE`，不再跳过类型校验。
- 网关 fail-closed：`createGateway` 启动时必须成功加载 `routingPath`（默认 `config/role-routing.json`）；
  缺失或损坏以 `ROUTING_UNAVAILABLE` 退出，不回退默认策略。重启后 5 个服务均按 v4 引擎重建，
  抽验：R3 `context_compile` → `pkt_4554676788d5`（406 tokens，role 限定记忆可见、无越权），
  R4 `memory_stats` → 9 memories / 8 approved / 1 proposed。
- role 限定记忆（`visibility=role`）只进入 `role_scope` 内角色的上下文；
  即使 R0/R4 具备审批读取权，也不会进入其角色 packet。
- 审批状态迁移受服务端校验：`proposed→approved/rejected`、`approved→superseded/deprecated`；
  同态返回 `STATE_UNCHANGED`（写 `noop` 审计），非法迁移 `INVALID_TRANSITION`。

## 3. 注册与启用（当前已注册 5 个服务）

```powershell
# 以 DSH 的 MCP 管理能力注册（等价于 profile cordis.patch.yml 的 insert 条目）
mcp_register name=mars-r0 tier=on-demand transport=stdio `
  command="C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe" `
  args='["D:\\M1\\mars\\src\\mcp-stdio.js"]' `
  env=@{ ELECTRON_RUN_AS_NODE="1"; MARS_ROLE="R0";
          MARS_TOKEN_FILE="D:\M1\mars\var\mcp\tokens\R0.token";
          MARS_DB="D:\M1\mars\var\mars.db";
          MARS_PRINCIPALS="D:\M1\mars\config\principals.json";
          MARS_ROUTING="D:\M1\mars\config\role-routing.json";
          MARS_ALLOWED_ROOTS="D:\M1" }
```

R1–R4 同形，仅替换服务名、`MARS_ROLE` 与 token 文件名。token 由
`scripts/mars-issue-mcp-identity.js` 生成，token 明文仅写入 `mars/var/mcp/tokens/`，
不进入对话、不进入 Git（`mars/.gitignore` 已忽略 `var/` 与 principals.json）。

## 4. 一键关闭

```powershell
# 方式 A（推荐，DSH 原生）：把 5 个服务降为 disabled，工具立即从目录隐藏
mcp_register name=mars-r0 tier=disabled ...   # 参数与注册时一致，仅 tier 改变

# 方式 B（冷备）：脚本先备份 registry.json 再移除 mars-r* 条目
.\scripts\mars-mcp-disable.ps1 -WhatIf        # 预演（SupportsShouldProcess）
.\scripts\mars-mcp-disable.ps1 -Yes           # 实际移除（需重启 DSH 会话使目录刷新）
```

关闭后 Agent 无法再调用 `mars-*` 工具；已写入 `mars/var/mars.db` 的记忆不受影响。

## 5. 回滚与恢复

1. 关闭 MCP（见 §4）。
2. 恢复数据库：`.\scripts\mars-rollback.ps1 -Repo D:\M1 -Yes`
   （默认删除 `mars/var/` 顶层的 mars.db*（含 -wal/-shm）、*.json、*.csv；`-RemoveTokens` 删除 token 目录，`-RemovePrincipals` 删除 principals.json；不触碰源码与其他未跟踪文件）。
3. 如需恢复注册：按 §3 重新 `mcp_register`，或在 DSH 会话中重新加载 MCP 目录。
4. 注册表备份：`mars/var/mcp/registry-backup-<时间>.json`（由关闭脚本生成）。

## 6. 已知限制

- 未实现 token 轮换 / 吊销命令（吊销 = 重新签发并重启服务，见 §7）。
- 限流：持久表 `rate_limits`（跨进程/重启保留）与进程内 120 次/分钟快速拒绝并存；无分布式配额。
- DSH 侧若删除了 MCP 注册条目，需重开会话才能刷新工具目录。
- 记忆写入为单机 SQLite，无跨机器同步；Phase 2 不引入外部服务。
- `tools/list` 不要求认证（无数据泄露）；工具调用一律要求 token。

## 7. Token 轮换与吊销（当前做法）

1. 重新运行 `node scripts/mars-issue-mcp-identity.js --role R0`（覆盖对应 token 文件，principals.json 只更新该角色 `token_sha256`）。
2. 重建对应 `mars-r*` MCP 服务（或重启 DSH 会话），旧 token 立即失效。
3. 轮换记录只写角色名与时间，不写 token 明文；不得在聊天、报告或 Git 中出现 token 内容。

## 8. G1–G4 验证状态（2026-11-03）

| 门槛 | 结论 | 主要证据 |
|---|---|---|
| G1 接入与安全 | PASS（有条件） | `docs/phase2-g1-security-report.md`；未知/缺失/mismatch token→AUTH_DENIED；跨项目→PROJECT_DENIED；5 角色真实调用 |
| G2 真实小范围运行 | PARTIAL（受控范围内成立） | `docs/phase2-g2-runs.md`：R0/R1/R2/R3/R4 各 1 次真实 packet；role_scope 越权已修复（pkt_8289b7fe4b92 → pkt_ebb345b28cdc） |
| G3 工作流 | PASS（单样本） | `docs/phase2-g3-workflow.md`：mem_0db463660da4 proposed→approved→R3 decisions 可见 |
| G4 Token/质量 A/B | PARTIAL | `docs/phase2-g4-ab-report.md`：质量 8/15→15/15；token −1.65%（噪声内）；单角色单任务 |

- 当前注册状态：`mars-r0`…`mars-r4` 均为 on-demand 可用。
- 关闭语义（准确口径）：MCP 服务本身**没有** `--enable` 开关；未注册即不存在，“默认关闭”指默认不注册 + 每实例 token/角色绑定（`cli.js mcp` 的 `--enable` 只针对旧版离线网关，不是 stdio 服务）。
- 测试：当前 `node --test`（ledger + mcp + phase1 + phase2 + phase3 + phase4 + wp1）**80/80**；G1 离线 harness 5 角色全部符合预期（历史值 61/61 见变更记录）。
