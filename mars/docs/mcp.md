# MARS MCP Gateway 与 Usage Ledger

版本：Phase 1 / v0.1.0。本文只描述已实现的本地接口，不构成对 DSH 的注册或授权。

## 1. 状态与安全边界

- MCP 网关**默认未注册、默认不启用**。CLI 只有在显式加 `--enable` 时才调用 `start()`；`start()` 启动时会在 stderr 打印 `MARS_MCP_NOT_REGISTERED` 警告。
- 身份由服务端校验：调用方必须携带 opaque token，服务端只保存 `sha256(token)`。未知/过短 token 一律返回 `{ "ok": false, "code": "AUTH_DENIED" }`。
- 项目和角色由 `authz.authorize` 在服务端校验；客户端传入的 `project_id` / `role_id` 不能扩大权限。
- 返回体只包含调用者有权读取的数据；内部路径、SQL、堆栈、原始异常不会出现在响应中。
- `memory.propose` 只写 `proposed`，不提供审批能力。审批必须由独立审查角色在 CLI/独立流程完成（见 `src/store.js`）。
- **不得用提示词、角色扮演或前端隐藏来模拟权限**；权限只认服务端 token + `principals.json` + `role_id`。
- 启用前置条件：调用方有可靠、不可伪造的身份分配；`principals.json` 只存 SHA-256；审批与实现由不同 principal 完成；不把 token 写入日志或提示词。

## 2. 启动方式

```powershell
# CLI 默认拒绝启动 MCP；确认身份链路可用后才显式启用
node src/cli.js mcp --enable --db var/mars.db --principals config/principals.json
```

`src/mcp.js` 的 `start({dbPath, principalsPath})` 是一个 stdio 单行 JSON 服务器：每行一个请求，每行一个响应。未显式调用 `start()` 时不会占用端口或监听 stdin。

## 3. JSON 请求/响应

请求：

```json
{"id":"req-1","token":"<opaque-token>","method":"memory.list","params":{"project_id":"xingrixiao","role_id":"R2","filter":{"status":"approved","limit":20}}}
```

成功：

```json
{"ok":true,"data":[...]}
```

失败（错误码固定，不附带堆栈/路径）：

```json
{"ok":false,"code":"AUTH_DENIED"}
```

支持的方法：

| method | 作用 | 关键 params | 服务端授权 |
|---|---|---|---|
| `memory.get` | 读取单条记忆 | `project_id`, `role_id`, `memory_id` | `memory.get` + `store.canRead` |
| `memory.list` | 列出可见记忆 | `project_id`, `role_id`, `filter{status,type,ids,limit}` | `memory.list` + 可见性过滤 |
| `memory.stats` | 仅本项目计数 | `project_id`, `role_id` | `memory.stats`，按 `project_id` 聚合 |
| `memory.propose` | 提交 proposed 记忆 | `project_id`, `role_id`, `input{content,source_ref,source_version,...}` | `memory.propose`，只写 `proposed` |
| `context.compile` | 编译角色上下文包 | `project_id`, `role_id`, `task`, `state`, `evidence`, `budget` | `context.compile` |

调用示例（逐行 stdin/stdout，不含真实 token）：

```text
{"id":"1","token":"...","method":"memory.get","params":{"project_id":"xingrixiao","role_id":"R2","memory_id":"mem_abc123"}}
{"ok":true,"data":{"memory_id":"mem_abc123","status":"approved",...}}
```

## 4. Usage Ledger（token 账本）

用途：从 DSH 会话文件读取每个 `assistant/message` 的 `data.usage`，汇总 token、估算成本、对账并导出 CSV。

- 输入兼容：DSH 多帧 zstd（文件头 `28 B5 2F FD`，逐帧 `zlib.zstdDecompressSync`）与纯 JSONL。
- 只读字段：`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`totalTokens`；缺失按 0，不推导、不编造。
- 对账：`reconcile(ledger, rawTotal)` 以 `diff_ratio <= 0.01` 为通过；`reconcile.checked/matched` 记录检查数。
- 成本是**本地估算，不是 provider 账单**：默认费率 `input 0.15`、`output 0.6`、`cacheRead 0.003`、`cacheWrite 0`（USD / 1M tokens）。

CLI：

```powershell
node src/cli.js ledger --session C:\Users\me\.dsh\sessions\...\session.v4.jsonl.zstd --out var\ledger
# 输出 var\ledger\ledger.json（parseSession 结果）与 var\ledger\ledger.csv
```

需要完整账本（`sessions[]` / `totals` / `cost` / `reconcile`）时使用 `buildLedger()`；`toCsv()` 同时接受完整账本和单个 `parseSession()` 结果，便于 CLI 直接导出。

Node API：

```js
const ledger = require('./src/ledger');
const session = ledger.parseSession('session.v4.jsonl.zstd');
const book = ledger.buildLedger({ sessions: [session] });
console.log(book.totals.cache_hit_rate);          // cacheRead / (input + cacheRead)
console.log(ledger.reconcile(book, 123456));      // { checked, matched, diff_ratio }
console.log(ledger.toCsv(book));
```

CSV 固定表头：

```text
session_id,path,usage_events,model,provider,input,output,cacheRead,cacheWrite,total
```

最后一行 `session_id=TOTAL` 为汇总行；含逗号/引号/换行的字段按 RFC 4180 转义。

## 5. 已知限制

- 未注册 DSH MCP，不提供 MCP 握手/工具发现；只提供 JSON 行协议与 `createServer().handle`。
- 不提供 token 发放、轮换、吊销服务；`principals.json` 由部署方维护。
- `cacheWrite` 默认费率为 0（未取得价目表），会导致成本略低；报告必须标注“本地估算”。
- 会话文件若被截断、混合格式或含非 UTF-8 行，解析会跳过坏行/报 `DSH_SESSION_CORRUPT`，不会补造 usage。
- `memory.stats` 只做项目级计数，不做跨项目聚合；`context.compile` 依赖 `config/role-routing.json`。
