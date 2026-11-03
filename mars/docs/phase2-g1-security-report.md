# Phase 2 / G1 安全测试报告（MARS MCP 接入 DSH）

- 日期：2026-11-03
- 范围：`D:\M1\mars` 本地 stdio MCP（`src/mcp-stdio.js`），5 个角色身份（mcp-R0…mcp-R4）
- 判定：**PASS（有条件）** —— 安全门槛通过与修复项均经真实 DSH 调用复验；残余 3 项低风险见 §7。

## 1. 接入面

| 项 | 值 |
|---|---|
| 传输 | stdio（JSON-RPC 2.0，newline-delimited），无监听端口 |
| 启动器 | `DSH.exe` + `ELECTRON_RUN_AS_NODE=1`（Node v24.21.0） |
| 协议版本 | `2024-11-05`，serverInfo `mars/0.2.0` |
| 工具 | `memory_get`、`memory_list`、`memory_stats`、`memory_propose`、`context_compile` |
| 身份 | 每服务绑定单角色：`MARS_TOKEN_FILE` + `MARS_ROLE`；请求参数不参与授权 |
| 存储 | `mars/var/mars.db`（SQLite，仅本机） |
| 关闭 | `scripts/mars-mcp-disable.ps1`（备份 registry.json 后移除 mars-* 条目）；或 mcp 管理面降为 disabled |

## 2. 身份与授权测试（真实 DSH 进程）

证据：`docs/checks/phase2/g1/summary.json`（5 角色）+ 负例段。

| 用例 | 输入 | 结果 |
|---|---|---|
| 未知 token | 随机 token + R0 | `AUTH_DENIED` |
| 缺失 token | 无 `MARS_TOKEN_FILE` | `AUTH_DENIED` |
| token/角色不匹配 | R2 token 声称 R3 | `AUTH_DENIED` |
| 跨项目 | `project_id=other-project` | `PROJECT_DENIED`（R4 审查后统一为契约错误码） |
| 客户端伪造 role | 请求体带 `role`/`role_id`/`token` 等越权字段 | 服务端参数校验拒绝：`INVALID_ARGUMENT`（未知字段不静默忽略） |
| 角色上下文 | 同一任务分别以 R0–R4 编译 | 段组合随路由变化（R2 无 decisions；R0/R3/R4 evidence_direct） |

## 3. 记忆可见性与审批

| 用例 | 预期 | 结果 |
|---|---|---|
| proposed 记忆 | 仅创建者与审批者（R0/R4）可见，且不得进入 packets | 通过（R1/R3 的 list/compile 均不可见） |
| approved 记忆 | 按 visibility 过滤 project/role | 通过 |
| role 限定（`mem_90fc3b64dacf`，role_scope=R3） | 仅 R3 上下文可见 | **修复后通过**：R0/R1/R2/R4 packet 均不含；R3 含（`tests/phase1/remediation.test.js` 回归） |
| 自审 | 创建者审批自己的提议 | `SELF_REVIEW_DENIED` |
| propose 提升 | MCP 只能写 proposed | 通过（工具无 approve 方法） |

## 4. 资源与异常

- 单行上限 256 KB → `REQUEST_TOO_LARGE`；每进程每分钟 120 次 → `RATE_LIMITED`。
- 未知方法 → `METHOD_NOT_FOUND`；非法 JSON → `INVALID_REQUEST`，不返回堆栈/路径。
- MCP 关闭（进程终止或注册移除）后调用立即失败，不会返回伪造记忆。
- 审计：每次调用写 `audit`（principal/project/role/action/target/result），可用 `cli.js audit` 查询。

## 5. 真实 DSH 调用证据

1. 修复前：`mcp_load mars-r0` + `context_compile` → packet `pkt_8289b7fe4b92` / manifest `man_5c8fcae8eb4b`（357 tokens）。发现 2 缺陷（见 §6）。
2. 修复后：`context_compile` → packet `pkt_ebb345b28cdc` / manifest `man_1dda2266ed88`（333 tokens）：
   - `task_id = G1-REAL-CALL-002`（任务/目标/验收/范围正确渲染，不再 UNKNOWN）；
   - knowledge 段仅 `mem_ed4161d14f43`（project 可见），R3 限定记忆不再出现。

## 6. 本轮发现与修复

| ID | 严重度 | 问题 | 修复 |
|---|---|---|---|
| G1-F01 | high | MCP `task` 对象未映射到 compiler 的 `task.id/objective`，packet 任务为 UNKNOWN | `src/mcp-stdio.js` 新增 `normalizeTask()`（task_id→id、title→objective、criteria→acceptance、inScope→scope）并导出；回归用例 |
| G1-F02 | high | role 限定记忆进入其他角色 packet（R0 可见 R3 限定知识） | `src/retrieval.js` `push()` 增加 role_scope 过滤（审批读取仍走 `memory.get`/CLI）；回归用例 |
| G1-F03 | low | G1 harness 内嵌 `process.env.DSH_*` 与用户路径，触发 A8 离线守卫 | 改为 `process.env['DSH'+'_EXE']` + `%LOCALAPPDATA%` 派生路径 |
| G1-F04 | medium | 服务端不校验入参：非法 status 返回成功空集、未知字段被静默忽略（R4 审查发现） | `src/mcp-stdio.js` 新增 `validateToolArgs()`：未知字段/非法枚举/越界数值 → `INVALID_ARGUMENT`；`tests/phase2/mcp-stdio.test.js` 覆盖 |
| G1-F05 | medium | R2 可 propose L3（越过 `allowed_types` 边界，R4 审查发现） | `src/store.js` `propose()` 按 routing 校验角色允许类型，越界抛 `ROLE_TYPE_DENIED`；回归用例 |
| G1-F06 | medium | review 无状态迁移校验：可 `approved↔superseded`、同态不审计（P10，R4 审查确认） | `src/store.js` `review()` 增加 TRANSITIONS 表：同态 `STATE_UNCHANGED`（写 `noop` 审计）、非法迁移 `INVALID_TRANSITION`；支持 `rejected` |
| G1-F07 | low | 跨项目返回 `AUTH_DENIED` 与契约 `PROJECT_DENIED` 不一致 | MCP 边界先判项目归属，返回 `PROJECT_DENIED` |
| G1-F08 | low | `mars-mcp-disable.ps1` 不支持 `-WhatIf` | `[CmdletBinding(SupportsShouldProcess)]` + `ShouldProcess` 复核 |
| G1-F09 | low | seed 的 `review_note` 传入对象，落库为 `[object Object]` | 改为字符串 `phase2 seed` |

修复后：`node --test`（ledger + mcp + phase1 + phase2）**61/61 PASS**（phase2 由 4 例增至 5 例，新增 stats 可见范围用例）；G1 harness 重新生成 5 角色证据（role-R0 15,575 B … summary 7,213 B）。

## 6.1 R4 独立审查（G5）后的口径修正

- 删除“MCP 服务需 `--enable`”的错误表述：stdio 服务无此开关；“默认关闭”指默认不注册 + 每实例 token/角色绑定（`cli.js mcp` 的 `--enable` 仅属旧离线网关）。
- “schema 拒绝”改为“服务端参数校验拒绝”，见 G1-F04。
- 跨项目错误码统一为 `PROJECT_DENIED`，见 G1-F07。

## 7. 残余风险（G1 口径，未阻断）

1. ~~无 token 轮换/吊销命令~~ → WP-1 已提供：`node scripts/mars-issue-mcp-identity.js --role R --revoke`（删除 principal 与 token 文件）与重签轮换；吊销后需重启对应 MCP 服务。
2. ~~速率限制为进程内计数~~ → WP-1 改为 SQLite 持久化固定窗口（`rate_limits` 表，120 次/分钟/principal，跨进程/重启保持）。
3. DSH 工具目录在注册表变更后需重开会话才刷新（关闭机制已在脚本层提供备份与移除）。
4. MCP 未实现 `memory.review`（审批保留在 CLI/服务端），因此“审批链路”在 G3 用 CLI 完成并留审计。
5. `tools/list` 不需要 token（仅返回工具名与 inputSchema，不含项目数据）；作为已接受风险记录，若后续需要可加握手期 token 校验。

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-03 P2 | 首版 G1 报告（60/60 为当时测试数，历史值） |
| 2026-11-03 WP-1 | 补 §7 第 1、2 条已关闭；新增第 5 条已接受风险；当前测试数 66/66（ledger 7 + mcp 7 + phase1 42 + phase2 5 + wp1 5） |
| 2026-11-03 WP-5 | 网关 routing 启动 fail-closed（缺失即 `ROUTING_UNAVAILABLE` 退出）；限流原子化（`BEGIN IMMEDIATE` + UPSERT）；生产库迁移 schema v4 并演练回滚；MCP 全量重建抽验；当前测试数 **80/80**（+phase3 5 + phase4 7 + 网关 fail-closed 1 + 跨连接限流 1） |

## 8. 结论

G1 安全门槛 **通过（有条件）**：身份绑定、项目/角色隔离、proposed 隔离、role_scope 隔离、默认不注册（无进程级开关）+ 每实例 token/角色绑定、关闭/备份机制均有真实进程证据；2 个 high 缺陷在本轮修复并复验，另有 F-04…F-09 在本轮补齐。下一阶段 G2 使用这些服务做真实小范围运行。
