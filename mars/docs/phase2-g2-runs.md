# Phase 2 · G2 真实 Agent 小范围运行记录

> 目的：记录 R0–R4 经 DSH MCP 真实调用 MARS、按权限获取上下文的一次性证据。
> 方式：`mcp_load mars-rN` → `mcp_call mars-rN.context_compile`（真实 stdio 进程，非离线 harness）。
> 说明：所有 packet/manifest ID 来自 MARS 数据库；token 数为 `[ESTIMATE]`（估算器口径），不是 provider 计费值。

## 1. 运行清单

| # | 角色 | 任务 ID | packet_id | manifest_id | tokens_estimated | sections | missing（blocking） |
|---|---|---|---|---|---|---|---|
| 0 | R0 | G1-REAL-CALL-001 | pkt_8289b7fe4b92 | man_5c8fcae8eb4b | 357 | task/facts/decisions/knowledge/prohibitions/evidence | evidence（true） |
| 0F | R0 | G1-REAL-CALL-002 | pkt_ebb345b28cdc | man_1dda2266ed88 | 333 | task/facts/decisions/knowledge/prohibitions/evidence | evidence（true） |
| 1 | R1 | G2-R1-RUN-001 | pkt_c717f0768966 | man_e3d4b6c08872 | 359 | task/facts/decisions/knowledge/prohibitions/evidence | 无 blocking |
| 2 | R2 | G2-R2-RUN-001 | pkt_d689daff8de2 | man_4de1dfbfdc04 | 201 | task/facts/knowledge/prohibitions/evidence | decisions（true，符合 R2 路由） |
| 3 | R3 | G3-R3-CHECK-001 | pkt_d924afb386c6 | man_00b7f697b6b9 | 431 | task/facts/decisions/knowledge/prohibitions/evidence | evidence（true） |
| 4 | R4 | G2-R4-RUN-001 | pkt_eb8a60e3735a | man_3116d304e49d | 358 | task/facts/decisions/knowledge/prohibitions/evidence | evidence（true） |

## 2. 权限与路由核对

- **R2 无 decisions 段**：R2 `allowed_types` 为 L1/L2/L4，L3 决策对其不可见；`missing.decisions.blocking=true` 是路由的结果，不是缺陷。
- **R3 knowledge 含 mem_90fc3b64dacf**：该记忆 `visibility=role`、`role_scope=['R3']`；仅 R3 的 **packet** 可见；R0/R3/R4 可经审批者 `memory_get` 读取原文（R1/R2 不可）。
- **R0/R3/R4 `evidence_direct=true`**：可经 `memory_get` / 片段恢复读取原文；R1/R2 只能看到引用。
- **默认拒绝**：未知 token、缺失 token、token 与角色不匹配 → `AUTH_DENIED`；跨项目 → `PROJECT_DENIED`（详见 `phase2-g1-security-report.md`）。

## 3. 修复前后对比（G1-F02）

| 项 | 修复前 | 修复后 |
|---|---|---|
| R0 packet | pkt_8289b7fe4b92（357 tokens） | pkt_ebb345b28cdc（333 tokens） |
| knowledge 段 | 含 mem_90fc3b64dacf（R3 限定，越权） | 仅含 mem_ed4161d14f43（project） |
| task_id | `UNKNOWN`（task 对象未映射） | `G1-REAL-CALL-002`（正常回显任务/目标/验收/范围） |

## 4. 结论

- G2 目标“R0–R4 能按权限获取正确上下文、无越权和静默失败”在受控范围内成立：5 个角色各完成一次真实调用，越权项已修复并复验。
- 限制：每个角色仅 1 次真实调用；未覆盖并发与长会话；token 数为估算值。

复现：`mcp_load mars-rN` 后调用 `context_compile {project_id:'rds-m1', budget:800, task:{task_id:'…'}}`；或离线 `node mars/scripts/phase2-g1-verify.js`。
