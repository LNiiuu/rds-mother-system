# MARS 跨项目共享与隔离（P5 / WP-3）

版本：v1.0（2026-11-03）
原则：**默认拒绝；显式导出；目标方审批；全程可审计；撤销立即生效。**

## 1. 项目注册表

| 字段 | 含义 |
|---|---|
| project_id | 项目命名空间（如 `rds-m1`、`proj-a`） |
| display_name | 显示名 |
| owner_principal | 项目所有者（注册时的 principal） |
| share_policy | `deny`（默认）/`explicit` |
| created_at | 注册时间 |

- 未注册项目不能创建共享，也不能作为共享目标。
- 注册/更新：`node src/cli.js project register --project <id> --name <name> --token <token> --role R0`；查询：`project list`。

## 2. 共享记录（shares）

| 字段 | 含义 |
|---|---|
| share_id | `shr_` + 随机 id |
| source_project / target_project | 源/目标项目，禁止自共享 |
| memory_ids | 显式列出的记忆 ID（≤200，必须全部属于源项目且 approved） |
| memory_types | 允许共享的记忆类型（属于 L1–L4） |
| roles | 目标项目中可见角色（必须显式给出） |
| status | `proposed` → `approved` → `revoked`（默认 `proposed` 不可见） |
| created_by / created_at | 提议者 |
| approved_by / approved_at | 目标方审批者 |
| expires_at | 可选有效期，过期即失效 |
| revoked_by / revoked_at | 撤销者与时间 |
| reference_chain | 审批链（JSON） |
| note | 备注 |

## 3. 授权规则

- 创建：源项目 R0（或项目所有者），且必须是源项目成员。
- 审批：目标项目 R0（或所有者）；提议者不能自批（`SELF_REVIEW_DENIED`）。
- 撤销：源项目或目标项目的 R0/所有者；撤销后立即不可检索。
- 读取：目标项目成员，且角色在 `shares.roles` 内，记忆类型在 `shares.memory_types` 且该角色 `allowed_types` 内。
- 角色限定记忆（`visibility=role`）仅当目标角色在 `role_scope` 内才可见。
- `private` 记忆暂不参与共享（默认拒绝）。
- 跨项目直连检索/`FTS`/别名/统计/元数据：默认不返回任何源项目记录（无 active share 时结果为空）。

## 4. 生命周期

```
propose ──target R0 approve──▶ approved ──revoke──▶ revoked
   │                              │
   └────────revoke────────────────┘
                          expires_at 到期 → 不再返回（状态仍 approved，可按规则清理）
```

## 5. 审计

- `share.create` / `share.approve` / `share.revoke` / `memory.share.read` 全部写 `audit`。
- `memory.share.read` 的 `result` 记录被读取的 share_id 集合，便于追溯“哪次共享被谁读取”。
- 审计不记录记忆正文与 token。

## 6. 间接泄漏防护（已测试）

| 通道 | 防护 | 测试 |
|---|---|---|
| 直接检索 | 无 active share 直接返回空 | `tests/phase3/sharing.test.js` 用例 1 |
| FTS5 全文 | 查询固定 `project_id`，不跨项目连表 | 用例 1 |
| 别名 | 别名表带 `project_id`，按目标项目过滤 | 用例 1 |
| 统计 | `dbStats` 按 project_id 过滤 | 用例 1 |
| Manifest/编译包 | 共享记录带 `source_project`、`share_id`、`via` | 用例 2 |
| 错误消息 | 统一 `PROJECT_DENIED`/`SHARE_*`，不暴露记忆存在性 | 用例 3 |
| 审批链 | 审批者写入 `approved_by` 与 `reference_chain` | 用例 2、4 |

## 7. 接口

- 模块：`src/sharing.js`（`registerProject/listProjects/createShare/approveShare/revokeShare/listShares/activeShares/sharedRecords`）。
- 检索集成：`src/retrieval.js` 在项目检索后追加 `sharedRecords(...)`；`shared:false` 可关闭（CLI `search --shared false`）。
- CLI：`project register|list`、`share create|approve|revoke|list`。
- MCP：暂不暴露共享读写（`memory.get/list/stats` 仍只作用于绑定项目）；共享读取仅通过检索/编译路径，且仅在存在明确 share 时生效。

## 8. 已验证

- `node --test tests/phase3/sharing.test.js` → **5/5 通过**（默认拒绝、显式共享、自批/未注册目标拒绝、撤销、过期与类型范围）。
- `node scripts/phase3-sharing-smoke.js` → `ok:true`（default_deny / pending_not_visible / approved_visible / revoked_hidden / share_audited）。
- 全量测试 **80/80 通过**（新增 5 条 P5 用例；历史值 71/71 为加入 WP-1/P6 用例前口径）。
- 共享只使用合成项目 `proj-a`/`proj-b`，不读取 `D:\Projects\xingrixiao` 与真实数据。

## 9. 限制（P5 时点）

- 共享为“显式 ID 列表”模式，尚未实现按标签/查询条件导出。
- 无跨项目“引用链可视化”页面，链信息存放在 `reference_chain` JSON。
- 撤销只阻止后续读取；已生成的上下文包/摘要不做追溯删除（可追踪 `memory.share.read` 审计）。
- 共享读取经检索/编译路径，不提供独立的 `memory.share.get` CLI。
- `private` 可见性共享未实现（安全默认）。
