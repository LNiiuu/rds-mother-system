# MARS Phase 1 — 安全设计（R0）

对应任务书 §6 十五条安全要求。实现位置：`src/authz.js`、`src/store.js`、`src/retrieval.js`、`src/util.js`（source guard）、`src/db.js`（audit）。

## 1. 身份与授权

- 调用方必须提供 opaque token（≥16 字符）；服务端仅保存 `sha256(token)`，映射文件为 `config/principals.json`（不存明文）。
- `authenticate`：未知 token → `UNKNOWN_PRINCIPAL`，默认拒绝（要求 1）。
- `authorize`：`project_id` 必须属于该 principal；`role_id` 必须属于该 principal 的 roles；`memory.review` 仅 R0/R4（要求 2/3/4/5）。
- **project_id 不是授权凭据**：每次调用都要求 principal 的项目集合包含它，否则 `PROJECT_DENIED`。
- 角色权限在服务端 `retrieval.js` 中执行：按 `config/role-routing.json` 的 `allowed_types` 与 `visibility` 过滤；`role` 可见性要求 role_scope 命中且 principal 拥有该角色。

## 2. 数据访问

- 记忆按 `status` 控制：`proposed` 永不进入正式上下文；`approved` 才可被检索与编译（要求 12）。
- 审批：`review` 仅 R0/R4；**创建者不得自审**（`SELF_REVIEW_DENIED`）；审批人写入 provenance（要求 13）。
- 跨项目：所有查询以 `project_id` 为第一过滤条件，且先通过 principal 项目校验（要求 8）。
- 原始证据只读：MARS 不修改证据文件；`evidence_refs` 只存引用（要求 10）。

## 3. 路径防护

`guardSourceRef(ref, allowedRoots)`：
- 拒绝绝对路径/盘符/UNC/`..`；
- 解析后必须位于允许根（默认 `D:\M1`；可用环境变量 `MARS_ALLOWED_ROOTS` 覆盖，测试用）；
- 存在时用 `realpath` 校验，拒绝符号链接逃逸（要求 6/7）。

## 4. 审计

- `audit` 表记录：时间、principal、project、role、action、target、result、reason。
- `memory.get/list/propose/review`、`context.compile`、`ledger.read` 全部落审计（要求 11）。
- 审计不含记忆正文，仅 ID/计数/原因，避免二次泄露。

## 5. MCP 网关

- 代码提供 stdio 网关（`src/mcp.js`，R2 实现），但 **Phase 1 默认不注册、不启用**（要求 14/15）。
- 启用前置条件：可验证的调用身份（服务端 token→principal 映射）、独立审批、明确的项目/角色白名单。
- **不得用提示词模拟权限**：网关未启用期间，所有 CLI/测试走同一套服务端授权；若无法取得可靠调用身份，保持未启用并在报告中记录阻塞原因。

## 6. 不触碰的边界

- 不修改 DSH Profile/MCP 注册/REA/权限/插件。
- 不读取 `.env`、密钥、密码、Token 明文；不写入任何凭据。
- 不联网；不安装依赖；不 Open 公网端口。

## 7. 威胁与缓解（摘要）

| 威胁 | 缓解 | 测试（R3） |
|---|---|---|
| 未知身份调用 | token 校验、默认拒绝 | 未知 token 拒绝 |
| 跨项目读取 | project/role 双校验 | 跨项目拒绝 |
| 越权角色读取 | role_routing allowed_types/visibility | R2 读 L3 被拒、R3 可读证据 |
| 未批准记忆进入上下文 | status 过滤 + manifest 仅收 approved | proposed 不入 packet |
| 路径穿越/符号链接 | guardSourceRef + realpath | `../`、绝对路径、链接逃逸拒绝 |
| 自审绕过 | created_by != reviewer | 自审拒绝 |
| 审计缺失 | 全动作落 audit | audit 行数与动作对应 |
| 凭据泄露 | 仅存 token hash；CLI 不回显 token（init-dev 仅一次） | 静态扫描 |

## 8. 残余风险（Phase 1 接受）

- 本地单实例，无并发隔离（SQLite WAL 已启用）。
- FTS5 unicode61 不切分中文，使用分段 LIKE 回退，性能与召回有限。
- Token 为估算（[ESTIMATE]），真实 usage 仅来自 DSH 会话解析。
- 无加密存储（本地开发环境）；若迁移到共享环境需磁盘加密与密钥管理方案。
