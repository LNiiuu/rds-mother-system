# M12-1 Agent Runtime 架构设计

**日期**：2026-11-12（+08:00）
**性质**：`DESIGN`（实现见 `mars/src/runtime/`，验收见 `M12-closure.md`）
**前置**：[M12-0 基线审计](M12-0-baseline-audit.md) §5 已确认：M11 交付的是账本与状态机，**执行层是空的**。

---

## 1. 设计约束（来自既有资产，不是偏好）

| 约束 | 来源 | 后果 |
|---|---|---|
| 域模块不得 require `node:fs` / `node:child_process` | `tooling/layering-check.mjs` L3 | 执行逻辑不能自己读文件、起进程 |
| 域模块不得读 `process.env` | 同上 L4 | 凭据与端点必须由组合根注入 |
| 域模块不得 require 适配器 | 同上 L5 | Provider 必须通过端口拿到 |
| 端口方法数 ≤ 5、零 require | 同上 L1/L2 | 端口要拆到最小面 |
| 组合根 ≤ 120 行 | 同上 L6 | 装配要克制 |
| 零运行时依赖 | `package.json` | HTTP 只能用手写 `fetch`，不引 SDK |

**不接受为新功能开白名单豁免**。这条决定了下面的分层。

---

## 2. 三层职责

```
CLI (cli.js / cli-agent.js)           ← 解析参数、读文件、打印；cli.js 是唯一允许碰 fs 的入口
        │  只传已解析的数据
        ▼
Runtime (runtime/agent-runtime.js)    ← 状态机 + 会话 + 权限 + 用量 + 事件；不碰 IO
        │  通过端口调用
        ▼
Adapters                              ← provider-mock / provider-openai-compat / fs-tool-executor
        ▲
        │ 组合根注入（composition.js 是唯一读 env 的地方）
```

### 2.1 为什么 `execute` 不在端口里

端口是「Provider 必须实现、Runtime 无法合成」的最小面：

| 端口方法 | 为什么必须是 Provider 实现 |
|---|---|
| `createSession` | 会话边界在 provider 侧（或至少由它决定 external_id） |
| `sendMessage` | 唯一的网络/模型交互点 |
| `cancel` | 中止能力只有 provider 知道怎么表达 |
| `getUsage` | 用量口径只有 provider 知道 |
| `healthCheck` | 凭据与连通性只有 provider 知道 |

`execute` / `getStatus` / `getResult` / `stream` 由 Runtime 组合：它们是**同一套状态机**，放进端口会让每接一个厂商就重写一遍。

---

## 3. 数据模型（Schema v6，只加表）

```
agents ──1:N──> agent_sessions ──1:N──> agent_runs ──1:N──> run_events
   │                                        │
   └────────────── project_id ──────────────┴──> agent_usage
                                                workspace_locks
```

| 实体 | 关键字段 | 说明 |
|---|---|---|
| **AgentDefinition** (`agents`) | agent_id, project_id, role_id, provider, model, definition_json, status | 一个角色可以有多份定义（不同 provider/model/工具面）。`definition_json` 存 permissions/tools/budget/mock 脚本 |
| **AgentSession** (`agent_sessions`) | session_id, agent_id, provider, model, external_id, status, turn_count, tokens_in/out | 会话边界。不同 Agent 不共享；同一 Agent 的多 run 可续用（本次未做续用） |
| **AgentRun** (`agent_runs`) | run_id, agent_id, session_id, task_id, handoff_id, status, idempotency_key, attempt, timeout_ms, budget_tokens, cancel_requested, heartbeat_at, output_json, error_code | 一次执行。`idempotency_key` 在项目内唯一 |
| **RunEvent** (`run_events`) | run_id, seq, kind, payload_json | 追加写，seq 单调。kind ∈ STATE / SESSION / CONTEXT / USAGE / TOOL / HANDOFF_IN / HANDOFF_OUT / ERROR / CANCEL_REQUESTED |
| **Usage** (`agent_usage`) | run_id, input/output/cached tokens, tool_calls, usage_source | 三值：`provider` / `estimated` / `unknown`。**不相加** |
| **Handoff** (`handoffs`，扩列) | from_agent, to_agent, from_run, to_run, packet_id, summary_json | 结构化交接，绑定来源 run |
| **Lock** (`workspace_locks`) | project_id, scope, target, run_id, expires_at | M13 用；本批建表 |

### 3.1 状态机

```
PENDING ──> RUNNING ──> SUCCEEDED
   │           ├──────> FAILED
   │           ├──────> TIMEOUT
   │           └──────> CANCELLED
   ├──────> CANCELLED
   └──────> FAILED
终态不可再变（INVALID_RUN_STATE）
```

与 M11 的任务状态机**并列而非替代**：task 说「要做什么」，run 说「谁真的做了」。

---

## 4. 一次执行的时序

```
startRun()            → PENDING，写 STATE 事件，幂等键查重
  ↓
executeRun()
  ├─ PENDING→RUNNING，写 started_at 与 heartbeat
  ├─ 无 session 则 createSession（保证 run 之间不共享）
  ├─ provider.createSession → 存 external_id
  ├─ 计算可用工具 = 工具白名单 ∩ 角色 tool.* 权限 ∩ Agent 显式收窄
  └─ 循环（≤ maxToolRounds，默认 6）
       ├─ 检查点①：cancel_requested → CANCELLED
       ├─ 检查点②：now-started > timeout_ms → TIMEOUT
       ├─ 检查点③：spent > budget_tokens → FAILED/BUDGET_EXCEEDED
       ├─ heartbeat 刷新
       ├─ provider.sendMessage
       ├─ recordUsage（带 usage_source）
       ├─ 无工具调用 → SUCCEEDED，结束
       └─ 有工具调用 → 逐个：
            permission? ──否──> TOOL_DENIED（回灌给模型，不执行）
            spec?       ──否──> TOOL_NOT_AVAILABLE
            executor?   ──否──> TOOL_EXECUTOR_MISSING
            执行 → TOOL 事件（含 meta.sha256 / 测试摘要）
            回灌 tool 消息
```

**关键设计点**：工具被拒不是「抛异常终止」，而是**把拒绝作为工具结果回灌**。这样模型能看到「我没有这个权限」，而不是让整个 run 崩掉——同时 trace 里留下 `allowed=false` 的硬记录。

---

## 5. 权限的强度（不许含糊）

| 层 | 机制 | 强度 |
|---|---|---|
| 角色 → 工具 | `ROLES[role].permissions` 含 `tool.<name>` | **代码强制**，每次调用都查 |
| Agent → 工具面 | `definition.tools` 数组收窄 | 代码强制 |
| 工具 → 能力 | 白名单只有 read_file / list_dir / write_file / run_test | **协议层无处表达**「执行任意命令」 |
| 路径 → 工作区 | `realpath` 后比较相对路径 | 代码强制，符号链接逃逸被拦 |
| 身份 | token → principal → roles | 代码强制 |
| **不是** | 进程隔离、OS 级沙箱、网络隔离 | **没有**。同一 OS 用户换个 token 就能换角色 |

结论：**角色是权限声明 + 运行时校验，不是安全沙箱**。这句话必须原样进报告。

---

## 6. Provider 能力清单

每个适配器必须显式声明 8 个布尔键（缺一个即 `PROVIDER_CONTRACT_INVALID`）：

`sessions` / `tools` / `stream` / `cancel` / `resume` / `usage` / `concurrency` / `multiTurn`

| 适配器 | usage | 说明 |
|---|---|---|
| `mock` | **false** | 确定性脚本；产出的用量一律 `estimated` |
| `openai-compat` | true（响应带 usage 时） | 通用 OpenAI Chat Completions 形状；换 baseUrl 即接不同厂商 |

`usage=false` 的语义是「**不能提供真实用量**」，上层据此把 `usage_source` 落成 `estimated`。这是代码强制的诚实性，不是文档约定。

---

## 7. 错误码（新增）

| 码 | 触发 |
|---|---|
| `AGENT_EXISTS` / `AGENT_NOT_FOUND` / `AGENT_STOPPED` | Agent 生命周期 |
| `PROVIDER_UNKNOWN` / `PROVIDER_NOT_CONFIGURED` / `PROVIDER_UNAVAILABLE` | Provider 装配与就绪 |
| `PROVIDER_SESSION_NOT_FOUND` / `PROVIDER_CANCELLED` / `PROVIDER_TIMEOUT` / `PROVIDER_UNREACHABLE` / `PROVIDER_HTTP_<n>` | 调用期 |
| `INVALID_RUN_STATE` / `RUN_NOT_FOUND` / `RUN_CANCELLED` / `RUN_TIMEOUT` / `RUN_NO_TERMINAL_STATE` | run 状态机 |
| `TOOL_DENIED` / `TOOL_NOT_AVAILABLE` / `TOOL_EXECUTOR_MISSING` / `TOOL_UNKNOWN` | 工具准入 |
| `TOOL_PATH_ESCAPE` / `TOOL_TOO_LARGE` / `TOOL_BINARY` / `TOOL_TEST_FAILED` / `TOOL_TEST_TIMEOUT` / `TOOL_NO_TESTS` | 工具执行 |
| `BUDGET_EXCEEDED` / `TOOL_ROUNDS_EXCEEDED` | 资源上限 |
| `CHAIN_EMPTY` / `HANDOFF_TARGET_REQUIRED` | 交接链 |

---

## 8. 兼容性与迁移

| 面 | 变化 | 兼容性 |
|---|---|---|
| Schema | v5 → **v6**，新增 6 张表 + `handoffs` 5 列 + `costs.run_id` | 只加不改；旧库打开时幂等迁移；已有行保持 NULL/默认值 |
| `collab.ROLES` | 每个角色新增 `tool.*` 权限 | 只增不减；M11 的 `assertPermission` 语义不变 |
| `costs` | 新增 `run_id` | 旧记录 `run_id` 为 NULL，按项目聚合不受影响 |
| CLI | 新增 `agent` / `run` / `trace` / `usage` | 既有命令未改；`KNOWN_COMMANDS` 扩展 |
| 端口 | 新增 2 个（`model-provider` / `tool-executor`） | 既有 5 个端口未改 |
| 发行包 | 新增 9 个文件 | 已登记 `approved-additions.packFiles` |

---

## 9. 测试矩阵（已实现）

| 维度 | 用例 |
|---|---|
| 定义 | 角色/Provider 校验、重复拒绝、停用后不可启动 |
| 隔离 | 项目隔离、会话隔离（两 Agent 不同 session） |
| 执行 | 三次调用两次工具、trace 顺序与哈希、文件真实落盘 |
| 幂等 | 相同 key 返回同一 run |
| 状态机 | 终态不可重入 |
| 权限 | R4 无写权限被拒且无副作用、未知工具不执行、无执行器明确拒绝 |
| 路径 | `../` 与绝对路径都拒绝 |
| 失败 | provider 报错、超时、取消、预算、工具轮次 |
| 用量 | provider/estimated/unknown 三分不混、非法来源落 unknown |
| 执行器 | 二进制/超限/越界/真实跑测试 |
| 契约 | provider 缺方法或能力键即判无效 |
| 链 | 4 Agent 独立 session、3 次自动交接、真实修复 + 测试由红转绿 |

结果：**19 例新增，全绿**；全仓 **247/247**。

---

## 10. 已知未做（明确列出）

| 项 | 状态 | 原因 |
|---|---|---|
| 真实模型调用 | **NOT RUN: credentials unavailable** | 环境无任何 provider key，也无本地 LLM |
| 会话续用（resume） | 未实现 | 需要 provider 侧会话持久化；两个适配器都不支持 |
| 流式输出 | 未实现 | 端口未暴露 stream；等真实 provider 需求再定 |
| 并发执行 | 未实现 | M13 范围 |
| 重试/退避 | 未实现 | M13 范围 |
| 崩溃检测 | 未实现 | M13 范围（心跳字段已就位） |
| 进程级隔离 | **不做** | 与「本地优先、零依赖」冲突；明确声明为不安全边界 |
