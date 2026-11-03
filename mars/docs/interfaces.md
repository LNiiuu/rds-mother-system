# MARS Phase 1 — 架构与接口（R0 定义，v0.1.0）

本文件是并行开发的**唯一接口契约**。R1 补充架构说明；R2/R3 按此实现与测试。任何接口变更须先改本文件并在最终报告登记。

## 1. 运行形态

- 单进程 Node.js ≥ 22（本机 24.21），无第三方依赖（仅 `node:*` 内置模块）。
- 存储：SQLite（`node:sqlite`）+ JSON 文件 + FTS5。
- MCP：同一进程的 stdio 服务器（`src/mcp.js`），**默认不注册、不启用**；CLI 是唯一受支持的调用入口。
- 身份：调用方必须携带 opaque token；服务端仅存 `sha256(token)`，映射到 `{principal_id, project_ids[], roles[]}`。未知 token → 拒绝（默认拒绝）。

## 2. 模块与依赖

```
util.js       基础（sha256/时间/estimateTokens 字符估算/原子写）
validate.js   JSON Schema 子集校验（无依赖）
authz.js      身份与项目/角色授权（默认拒绝）
db.js         SQLite 打开与建表（memories/aliases/manifests/fragments/audit/meta）
store.js      M1 Memory Store（propose/get/list/approve/deprecate/supersede）
retrieval.js  M2 Retrieval（ID/结构化/FTS5/别名；角色与可见性过滤）
manifest.js   M4 Manifest 与片段去重/原文恢复
budget.js     M5 预算与保护裁剪
compiler.js   M3 Context Compiler（调用 retrieval + manifest + budget）
ledger.js     M6 Usage Ledger（DSH 会话 usage 解析/对账/导出）          [R2]
mcp.js        M7 MCP Gateway（memory.get/list/stats/propose，只读为主） [R2]
cli.js        命令行入口（R0）
```

依赖方向：`cli/mcp → compiler → retrieval/store/manifest/budget → db → util`；`ledger` 仅依赖 `util`。

## 3. 关键接口（函数签名）

```js
// authz.js
loadPrincipals(path) -> {version, principals[]}
loadRouting(path) -> {version, default, roles{}}
authenticate(principals, token) -> {ok, principal} | {ok:false, reason}
authorize(principal, {project_id, role_id, action, routing?}) -> {ok} | {ok:false, reason}
// action: memory.get|memory.list|memory.stats|memory.propose|memory.review|context.compile|ledger.read|audit.read

// store.js（principal = authenticate 返回的 principal 对象，含 principal_id/project_ids/roles）
propose(db, principal, input, {allowedRoots}?) -> {memory_id, status:"proposed", duplicate}
get(db, principal, role_id, project_id, memory_id) -> record | null
list(db, principal, role_id, project_id, {status?,type?,ids?,limit?}) -> records[]
review(db, principal, role_id, project_id, memory_id, decision, note) -> record
// decision: "approved"|"deprecated"|"superseded"；仅 R0/R4；同 principal 自审拒绝
addAlias(db, principal, role_id, project_id, term, alias, memory_id) -> void

// retrieval.js
retrieve(db, principal, role_id, routing, {project_id, query?, ids?, type?, alias?, limit?}) -> records[]
// 排序优先级：结构化 > ID > FTS5 > 别名；默认仅 approved；角色 allowed_types/visibility 在服务端过滤

// util.js
estimateTokens(text) -> integer   // 字符估算，标记 [ESTIMATE]

// budget.js
applyBudget(sections, {budget, protections}) -> {sections, tokens, truncated[], protected_kept[], over_budget, note?}

// manifest.js
buildManifest(db, {project_id, task_id, role_id, run_id?, session_id?, token_budget, tokens_estimated}, sections[]) -> manifest
restoreFragment(db, principal, role_id, project_id, fragment_id, routing) -> {content, content_hash, original_ref, content_type}
// 仅 role-routing 中 evidence_direct=true 的角色可恢复原文；其余 EVIDENCE_DENIED；每次恢复写 audit

// compiler.js
compileContext(db, principal, routing, {project_id, task_id, role_id, budget, task, state, evidence, query?, source_version?}) -> {packet, manifest, budget}

// ledger.js
parseSession(file) -> {session_id, path, usage_events, usage{input,output,cacheRead,cacheWrite,total}, source_kind}
buildLedger({sessions, rates}) -> ledger（符合 contracts/ledger.schema.json）
reconcile(ledger, rawUsageHints) -> {checked, matched, diff_ratio}
toCsv(ledger) -> string

// mcp.js
createServer({dbPath, principalsPath, routingPath?, allowedRoots?}) -> {handle(request)}
// request: {token, method:"memory.get"|"memory.list"|"memory.stats"|"memory.propose"|"context.compile", params}
start({dbPath, principalsPath, allowedRoots}) // stdio 单行 JSON；未注册 DSH，输出 MARS_MCP_NOT_REGISTERED
```

## 4. 数据契约

见 `contracts/memory.schema.json`、`manifest.schema.json`、`context-packet.schema.json`、`role-routing.schema.json`、`ledger.schema.json`。校验器 `validate.js` 覆盖 `required/type/enum/const/pattern/minLength/maxLength/minimum/maximum/minItems/maxItems/uniqueItems/format(date-time)/oneOf/items/properties/additionalProperties`；不支持 `$ref/$defs`（契约未使用）。

## 5. 文件所有权（并行开发边界）

| 路径 | 所有者 | 说明 |
|---|---|---|
| `contracts/**`, `config/role-routing.json`, `docs/interfaces.md`, `docs/architecture.md` | R0 定稿 → R1 可补文档 | 契约只由 R0 改 |
| `src/{util,validate,authz,db,store,retrieval,budget,manifest,compiler,cli}.js` | R0 | 核心链路 |
| `src/{ledger,mcp}.js` | R2 | Token 账本与 MCP 网关 |
| `tests/**` | R3 | 只新增测试，不改 `src/**`；缺陷提 issue |
| `docs/security.md`, `docs/mcp.md`, `docs/acceptance.md` | R1/R6 协作，R0 定稿 | 文档 |
| `scripts/*.ps1`（安装/回滚/基线） | R0 | 运维 |

R3/R6/R7 需要只读证据时，由 R0 提供 `var/` 产物或 CLI 输出；不得直接改 `src/`。

## 6. 集成关口

- **G1 契约一致性**：所有记录/清单/包通过 `validate.js` 对 `contracts/*.schema.json` 校验。
- **G2 安全**：跨项目/未知身份/未批准记忆/路径越界四类拒绝全部由 `authz.js` + `store.js` + `source-guard` 在服务端执行，测试覆盖。
- **G3 功能与成本**：账本对账 ≤1%、manifest 可追溯、去重可恢复、角色上下文不同、固定任务质量不下降。

## 7. 非目标（Phase 1）

向量检索、Embedding、Reranker、知识图谱、跨项目自动共享、自动改 DSH 配置、Git push。
