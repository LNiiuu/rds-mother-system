# M22 通用平台适配架构

**状态**：`IMPLEMENTED / PARTIAL`
**判定依据**：端口、注册表、四种适配器、真实本地 HTTP/文件队列/桥协议契约测试通过；
WorkBuddy 真实宿主与 DSH 真实环境 **NOT RUN**。

---

## 1. 分层与依赖方向

```text
RDS Core（domain）
  platform-client / platform-registry（库；尚未接入 runtime/scheduler）
        │ 只依赖 ports/platform-adapter.js
        ▼
ports/platform-adapter.js   （5 方法、9 能力、10 消息类型、7 错误码）
        ▲
        │ 实现
adapters/platform-memory.js     参考实现（契约基线）
adapters/platform-http.js       通用 HTTP 平台（真实本地服务验证）
adapters/platform-dsh.js        DSH 文件队列（真实文件 I/O；宿主 NOT RUN）
adapters/platform-workbuddy.js  WorkBuddy guest bridge（协议契约；宿主 NOT RUN）
adapters/platform-factory.js    显式登记，不做目录扫描/动态加载
```

硬约束（`tooling/layering-check.mjs`）：

- 域层不 require `adapters/platform-*`；
- 端口零 require、方法数 ≤ 5；
- 组合根只暴露 `platformCatalog` / `platformFor`，不暴露平台协议细节。

---

## 2. 端口契约

| 方法 | 语义 | 失败码 |
|---|---|---|
| `describe()` | 名称、版本、类型、9 个能力布尔值 | `PLATFORM_INVALID`（注册时） |
| `healthCheck()` | 可达性/凭据；**不抛**，返回 `{ok,detail}` | — |
| `receive({cursor})` | 拉入站消息，返回 `{events,cursor}` | `PLATFORM_PROTOCOL_ERROR` / `TIMEOUT` |
| `send(message)` | 发出站消息，返回平台确认 | `UNAVAILABLE` / `UNAUTHORIZED` |
| `cancel(taskId,reason)` | 请求取消 | `NOT_FOUND` / `UNSUPPORTED` |

**能力键**：`sessions`、`lifecycle`、`submit`、`status`、`cancel`、`events`、`contextHandoff`、`tools`、`reconnect`。

**消息类型**：`agent.register`、`agent.offline`、`task.submit`、`task.status`、`task.cancel`、
`tool.call`、`tool.result`、`context.handoff`、`task.result`、`error`。

**为什么 Agent 注册/任务提交不是端口方法**：它们是消息语义，不是传输语义。新增一种协作语义
只加消息类型，不改端口，也不改所有适配器。

---

## 3. 适配器矩阵

| 适配器 | 传输 | 真实执行 | 状态 | 说明 |
|---|---|---|---|---|
| `memory` | 进程内队列 | 是 | **PASS** | 契约基线；自动回显结果，用于替换性测试 |
| `http` | HTTP + JSON | 是 | **PASS** | 测试起真实 `http.Server`，走 `127.0.0.1` 网络往返 |
| `dsh` | `inbox.jsonl` / `outbox.jsonl` | 文件 I/O 真实 | **PARTIAL** | 宿主 DSH 未安装；`sessions/lifecycle/tools=false`；真实 DSH 会话 `MOCK/NOT RUN` |
| `workbuddy` | `wb:invoke` 通道 | 桥协议真实 | **PARTIAL** | 使用 fake bridge 验证通道契约；`lifecycle/tools=false`；真实 WorkBuddy webview `NOT RUN` |

### 3.1 WorkBuddy 的两条接法

1. **Guest bridge（本适配器）**：WorkBuddy webview 内把 `window.__wbInvoke` 包成
   `{invoke(channel,payload)}`；通道为 `rds.health` / `rds.task.poll` / `rds.task.send` / `rds.task.cancel`。
   这是**双方约定**，不是 WorkBuddy 官方任务 API；真实宿主验证需要 webview。
2. **MCP 反向接入（已有）**：`mars/src/mcp-stdio.js` 作为 MCP server，WorkBuddy 作为客户端调用。
   这是当前唯一可由外部真实跑通的 WorkBuddy 接入面；M22 不把它伪装成“平台会话”。

### 3.2 DSH 的边界

- 现有 `dsh-session-source.js` 只解析 DSH **会话文件**，不是平台适配器；
- 本适配器实现 DSH 侧文件队列协议，真实文件读写已验证；
- 本机无 DSH 可执行文件，真实接入标 `MOCK/NOT RUN`，不宣称通过。

---

## 4. 注册与发现

```js
const { createPlatformRegistry } = require('./platform-registry');
const reg = createPlatformRegistry();
reg.register(createHttpPlatform({ baseUrl: 'http://127.0.0.1:8080' }));
reg.list();                        // ['http']
reg.requireCapability('http','tools'); // 缺能力直接抛 PLATFORM_UNSUPPORTED
```

- 重复注册 → `PLATFORM_DUPLICATE`；
- 未知适配器 → `PLATFORM_NOT_FOUND`；
- 形状不合格 → `PLATFORM_INVALID`（缺方法/能力键）。
- 不做自动发现：新增平台必须在 `adapters/platform-factory.js` 的 `CATALOG` 显式登记。

---

## 5. 可替换性验证

`mars/tests/arch/platform-adapters.test.js` 的“同一套 PlatformClient 在四种适配器上得到同样结果”：

| 适配器 | 提交 | 结果状态 | echo |
|---|---|---|---|
| memory | `same task` | succeeded | `same task` |
| http | `same task` | succeeded | `same task` |
| dsh | `same task` | succeeded | `same task` |
| workbuddy（fake bridge） | `same task` | succeeded | `same task` |

同一份 `platform-client.js` 没有按平台名分支；替换适配器不需要改客户端。

> 注意：DSH 行的结果是测试代码扮演宿主（写 inbox/outbox），WorkBuddy 行是 fake bridge；
> 这两行证明“协议可替换”，不证明“真实平台已接入”。

---

## 6. 断线与错误

- `cursor` 由适配器维护；`receive` 只返回游标之后的事件；DSH 用行号，HTTP 用平台游标。
- `healthCheck` 不抛：HTTP 503 → `PLATFORM_UNAVAILABLE`，WorkBuddy 超时 → `PLATFORM_TIMEOUT`。
- 未知消息/事件类型 → `PLATFORM_PROTOCOL_ERROR`，不静默丢弃。
- 平台断开后，RDS 的任务状态在本地 `agent_runs`/`orchestration_jobs` 中仍可查询；
  适配器重连后从 cursor 续读。

---

## 7. 安全与治理

- 平台凭据只来自适配器选项/环境变量，不写日志、不进 Git；
- `send` 只接受白名单消息类型；
- 平台错误必须翻译成统一错误码，不把 HTTP 原文/堆栈抛给域层；
- 不自动发现、不动态加载第三方适配器；
- 平台能力不足时显式拒绝，不做“尽力而为”的降级。
- **权限模型 NOT IMPLEMENTED**：没有 role/principal/租户/授权校验；当前只有凭据来源与消息类型白名单。

---

## 8. 限制（必须保留）

- WorkBuddy 真实 webview 会话未执行；guest 通道是 RDS 约定，需宿主页面实现。
- DSH 真实宿主未安装；文件队列协议不等于 DSH 官方 API。
- 没有跨平台消息持久化队列；cursor 存在客户端内存，进程重启需重新提交或由平台重放。
- 没有平台侧限流/重试策略；只在客户端做超时与错误映射。
- MCP 是反向工具面，不是双向平台适配器；未实现 MCP 平台适配器。
- **本层尚未接入 runtime/scheduler**：`platform-client`/`platform-registry` 目前是库 + 契约测试，
  没有任何生产路径把平台任务送进调度器；端到端平台联合场景 `NOT RUN`。

---

## 9. 测试与证据

```bash
node --test mars/tests/arch/platform-adapters.test.js
```

- 结果：**10/10 PASS**，耗时约 0.7 s。
- 覆盖：端口形状、注册表重复/未知/能力拒绝、内存提交+结果+取消、HTTP 真实服务往返、
  HTTP 503 错误映射、DSH 文件队列+游标续读、WorkBuddy bridge 四通道、WorkBuddy 缺失/超时、
  四适配器替换性、协议校验。
- 证据：`mars/tests/arch/platform-adapters.test.js`；组合根暴露见 `mars/src/composition.js`。
