# MARS 记忆治理规则（P3）

版本：v1.0（P3 工作包，2026-11-03）
适用：`rds-m1` 及后续所有 MARS 项目；所有写入、审批、编译与审计必须遵守本文件。

## 1. 记忆分层（L0–L4）

| 层 | 含义 | 典型来源 | 默认可见性 |
|---|---|---|---|
| L0 | 会话/过程记忆（不进入正式上下文） | 临时观察 | 不入库 |
| L1 | 项目事实（代码库、环境、路径） | 架构/实现角色 | project |
| L2 | 任务事实与实现约束 | 任务执行 | project |
| L3 | 决策（含理由与替代方案） | R0/R1/R4、人工 | project |
| L4 | 知识/模式/经验 | 任一角色经审批 | project 或 role |

- L0–L4 是**记忆分层**，与研发流水线六层（需求/架构/任务/实现/测试/审查）是不同维度，不得混用。
- 推测、未验证结论、普通对话不得直接 `approved`。

## 2. 状态机

```
proposed ──approve──▶ approved ──supersede──▶ superseded
    │                    │
    ├──reject──▶ rejected └──deprecate──▶ deprecated
```

- 迁移矩阵（服务端强制）：

| from \ to | approved | rejected | superseded | deprecated |
|---|---|---|---|---|
| proposed | ✅ | ✅ | ❌ | ❌ |
| approved | ❌（STATE_UNCHANGED 同态） | ❌ | ✅ | ✅ |
| rejected | ❌ | ❌ | ❌ | ❌ |
| superseded | ❌ | ❌ | ❌ | ❌ |
| deprecated | ❌ | ❌ | ❌ | ❌ |

- 同态迁移返回 `STATE_UNCHANGED` 并写 `noop` 审计；非法迁移返回 `INVALID_TRANSITION`。
- 审批仅 R0/R4 可执行，且 `created_by == reviewer` 时 `SELF_REVIEW_DENIED`；审批记录写入 `provenance.approved_by/approved_at`。

## 3. 可见性

| visibility | 语义 | 读取规则 |
|---|---|---|
| `project` | 项目内可见 | 同项目且角色被授权 |
| `role` | 角色限定 | 仅 `role_scope` 内角色；审批者也不进入其角色 packet |
| `private` | 私有 | 未实现授权读取（默认拒绝） |

- 编译上下文与检索只返回 `approved` 且未过期、可见、类型在角色 `allowed_types` 内的记录（R0/R4 也不例外）。
- `memory.get` 是显式读取路径：审批者（R0/R4）可读取任意状态（含 `proposed`/过期）记录；创建者可读取自己 `proposed` 记录，但记录过期后创建者也不可读；每次读取写审计。
- 跨项目一律 `PROJECT_DENIED`；身份只来自绑定的 token/角色，客户端参数不作授权依据。

## 4. 过期与保留

- `expires_at`（ISO date-time，可空）：到期后不再进入检索/编译上下文；记录与审计保留，审批者仍可显式读取。
- 过期不等于删除；删除历史记忆、审计日志或改写给过去状态均禁止（除用户明确批准的迁移）。
- 保留目标：正式记忆长期保留；`superseded/deprecated` 保留用于追溯；审计日志至少保留一个发布周期。

## 5. 审批与来源

- 每条记忆必须带 `source_ref`、`source_version`、`content_hash`、`created_by`、`provenance.origin`。
- 审批前必须能定位来源；无法定位来源的提议不得批准。
- 审批是人工授权动作，Agent 只能 propose；MCP 不暴露 review 工具，审批走服务端 CLI。

## 6. 版本与取代

- 同 `(project, content_hash, source_ref, source_version)` 视为同一条，重复提议返回 `duplicate=true`。
- 新版本应新增 `source_version`，并在审批后把旧版本 `superseded`；关系可用 `relations` 标注 `supersedes/superseded_by`。
- 内容发生变化必须产生新 `memory_id`（hash 变化），不得原地改写。

## 7. 审计

- 必须记录：propose、review、get、list、compile、stats、边界拒绝（`target='boundary'`）。
- 审计字段：时间、principal、项目、角色、动作、目标、结果、原因；不记录 token 明文与完整敏感内容。
- 审计只追加，不更新/删除。

## 8. 迁移与备份

- 任何 schema 变更前必须 `node scripts/mars-db-backup.js` 生成快照，记录 SHA-256 与行数。
- 迁移只允许**加列/加表/加索引**，不得删除列、改写语义或批量改状态。
- 恢复演练：`node scripts/mars-db-backup.js --verify <backup>` 必须 `integrity=ok` 且行数与快照一致。
- 回滚：代码按文件清单恢复；数据按快照恢复；运行产物用 `scripts/mars-rollback.ps1 -Yes`。

## 9. 已知边界（P3 时点）

- `private` 可见性未实现授权读取。
- MCP 无 review 工具（审批走服务端 CLI）。
- token 吊销需 `mars-issue-mcp-identity.js --role R --revoke` 后重启对应服务。
- 限流为持久化固定窗口（120 次/分钟/principal），非分布式。
