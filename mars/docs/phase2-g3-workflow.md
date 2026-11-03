# Phase 2 · G3 工作流跑通记录（提议 → 审批 → 入库 → 复编译）

> 目的：验证 Phase 2 核心链路在真实 DSH 调用中可执行、可追溯、可回滚。
> 结论：链路跑通（1 条完整样本），审批可见性按角色路由生效；仍为单样本，不代表规模结论。

## 1. 执行步骤与证据

| 步骤 | 执行者 | 动作 | 结果 |
|---|---|---|---|
| 1 | R2（MCP `mars-r2`） | `memory_propose`：L3 决策，source_ref `mars/docs/mcp-access.md`，source_version `v0.1` | `mem_0db463660da4`，`status=proposed`，`duplicate=false`（**修复前快照**：修复后 R2 的 allowed_types 不含 L3，同样的调用会返回 `ROLE_TYPE_DENIED`） |
| 2 | R0（CLI 服务端审批） | `review --memory mem_0db463660da4 --decision approved --json` | `status=approved`，`provenance.approved_by=mcp-R0`，`approved_at=2026-11-03T12:13:51.015Z`，`created_by=mcp-R2` |
| 3 | R3（MCP `mars-r3`） | `context_compile`（任务 G3-R3-CHECK-001） | packet `pkt_d924afb386c6` / manifest `man_00b7f697b6b9`；decisions 段包含 `mem_0db463660da4` |
| 4 | 审计核对 | `SELECT action, COUNT(*) FROM audit` | **旧快照（2026-11-03 12:14，修复前）**：memory.list=67, context.compile=29, memory.stats=11, memory.propose=11, memory.review=8, ledger.read=1；当前计数见 `phase2-review-round2.md` §1.4 |

## 2. 关键约束验证

- **Agent 不能自升**：`memory_propose` 只写 `proposed`；MCP 未暴露 review 工具；审批只能由 R0/R4 在服务端执行，且 `created_by == reviewer` 时 `SELF_REVIEW_DENIED`。
- **未批准不可见**：审批前，R2 的 packet 不包含 `mem_0db463660da4`；审批后 R3 的 decisions 段才出现该记忆（R2 因路由不含 L3，**packet** 仍不可见；`memory_get` 对项目内 L3 仍可读，属审批者路径而非上下文路径）。
- **可见性遵循路由**：R3 为验证角色，含 decisions（L3）；R2 为实现角色，无 decisions 且 `missing.decisions.blocking=true`。
- **审计可追溯**：propose / review / compile / list 均落 audit；报告与记录只引用 memory_id，不输出 token 明文。

## 3. 已知限制

- 样本量 1；未覆盖拒绝路径（rejected）、版本取代（superseded）的端到端流程（状态机已实现并有单测）。
- 审批由 CLI 完成，MCP 暂无 review 工具（`phase2-g1-security-report.md` 已列为残余项）。
- `review` 状态迁移校验已在 Phase 2 修复轮补齐（`store.review` TRANSITIONS；P10 关闭），重复审批返回 `STATE_UNCHANGED` 并写审计。

## 4. 复现命令（不打印 token）

```powershell
# 提议：由 mars-r3 经 MCP（L3 属 R3 allowed_types；R2 已不允许 propose L3）
# memory_propose {project_id:'rds-m1',memory_type:'L3',content:'…',source_ref:'mars/docs/mcp-access.md',source_version:'v0.1'}
# 审批：R0 CLI（token 从文件读取，输出中以 <redacted> 替换）
$t=(Get-Content 'D:\M1\mars\var\mcp\tokens\R0.token' -Raw).Trim()
node src/cli.js review --token $t --project rds-m1 --role R0 --memory mem_0db463660da4 --decision approved --json
```
