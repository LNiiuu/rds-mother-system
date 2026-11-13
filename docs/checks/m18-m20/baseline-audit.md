# M18–M20 基线审计

**日期**：2026-11-12（+08:00）
**审计性质**：只读基线审计 + 本轮实施准备
**当前 HEAD**：`06b2a29e33324578ae2fcdcf2908adafc534074e`
**origin/main**：`ada78488513db88d3eefb5f89ffdc070c4454331`
**结论**：M9–M17 的本地工程基础可用；M18–M20 可以在不推翻现有架构的前提下增量实施。真实模型调用与 W-02/W-03/W-05/W-06 的专业工具执行受本机环境阻塞，不能伪造 PASS。

---

## 1. Git 基线

| 项 | 实测 |
|---|---|
| 分支 | `main` |
| HEAD | `06b2a29` |
| origin/main | `ada7848` |
| 领先 / 落后 | **14 / 0** |
| merge commit | 0 |
| 20 个 Tag | 未动；无 Tag 指向新提交 |
| 暂存区 | 空 |
| 工作区 | 51 项：原有 50 项 + `docs/checks/final/pre-push-independent-audit.md` |
| 远程写操作 | 未执行 |

原有 50 项：

- 49 项未跟踪受保护文件：`docs/checks/git-review/` 30、`docs/history/` 14、`docs/runs/` 4、`docs/analysis/` 1、`tooling/agent-runtime/` 1。
- 1 项已跟踪格式化修改：`docs/checks/productization/M9-M11-final-acceptance.md`（103 增 / 101 删，归一化后内容相同）。
- 50/50 与 `D:/M1-migration/m12-protected-baseline.txt` 的 SHA-256 前 16 位 + 字节数一致。
- 49 项中含两个约 18.5 MB 的会话转录；本任务禁止 `git add -A`。

**保护规则**：本轮只 `git add` 明确列出的 M18–M20 文件；不 stage 上述 50 项，不 stage 上一轮审计报告。

---

## 2. M9–M17 实际实现

### 2.1 模块与接口

| 层 | 文件 | 现状 |
|---|---|---|
| 域 / 上下文 | `projects.js`、`context-budget.js`、`context-ops.js`、`compiler.js` | 多项目、预算、L0–L3、确定性压缩/恢复已实现 |
| 协作 | `collab.js` | R0–R7 权限表、11 态任务机、交接、成本账本 |
| 执行 | `runtime/agent-runtime.js`、`handoff.js`、`chain.js` | Agent 定义/会话/run/工具/事件/用量；串行交接链 |
| 可靠性 | `runtime/locks.js`、`reliability.js`、`policy.js` | 项目级互斥锁、Provider 重试、心跳陈旧标记、预算、权限矩阵 |
| REA | `adapters/rea/*`、`cli-rea.js` | W-01..W-06 统一接口；W-01/W-02/W-04/W-05 可执行；W-03/W-06 阻塞 |
| Provider | `provider-mock.js`、`provider-openai-compat.js`、`provider-anthropic.js` | 1 个 mock + 2 个真实协议；真实网络调用 NOT RUN |
| Tool | `fs-tool-executor.js` | 4 个白名单工具；realpath 根约束 |
| CLI | `cli.js`、`cli-agent.js`、`cli-rea.js` | `agent/run/trace/usage/lock/policy/rea` 等 |
| Schema | `db/schema.js` | v7；只加表/列，幂等迁移 |

### 2.2 测试与门禁基线

| 项 | 实测 |
|---|---|
| `npm test` | `GATE PASS tests=290 pass=290 fail=0 skipped=0` |
| `npm run layers` | `LAYERS PASS problems=0 warnings=2`（两条永久边界） |
| `npm run docs:check` | 218 个 Markdown，`DOCS PASS` |
| `npm run config` | `CONFIG PASS` |
| `npm run baseline` | `BASELINE PASS` |
| `npm pack --dry-run` | 141 文件 / 207.4 kB |

### 2.3 三个历史问题的确认

**A. M13 并发**

- 没有并发调度器；没有队列、`QUEUED` 状态、`Promise.all`、worker pool。
- 工作区锁是项目级互斥锁；拿不到即 `FAILED / WORKSPACE_LOCKED`，不排队。
- 重试/超时/心跳/崩溃标记存在，但只覆盖 Provider 单次调用与人工 `agent reap`，没有超时恢复、没有自动重跑。
- M12 设计把“并发执行”划给 M13，M13 封版记录又写“并发调度未实现”。M13 不能无前缀判 `COMPLETED`。

**B. M12 真实模型**

- Provider 真实 HTTP 路径存在，但本机无任何凭据、无本地模型，真实调用 `NOT RUN`。
- 4 Agent 链、M15 联合案例均为 mock；`execution_kind: simulated`。
- 真实 Provider 多轮路径存在消息重复缺陷：Provider 会累计 Runtime 每次传入的完整 `messages`，第二轮出现重复 `system/user`。
- M12 执行层可判完成；M12 整体只能是 `COMPLETED WITH WARNINGS`。

**C. M16 跨平台**

- 第二个适配器是 `provider-anthropic`，属于 **Provider Adapter**，不是 Platform Adapter。
- 没有 Platform 端口，没有第二平台会话，没有跨平台交接证据。
- 6 个契约测试，全部注入 `fetch`；真实网络 `NOT RUN`。

---

## 3. R0–R7 原始角色定义

原始定义来源：

- `core/roles/roster.md`：角色、席位、职责、产出。
- `core/roles/r0-orchestrator.md` … `r7-release.md`：系统提示词、权限、禁止项。
- `mars/config/role-routing.json`：记忆类型、可见性、预算、禁止项。
- `mars/src/collab.js`：运行时代码权限表。

| 角色 | 原始名称 | 原始职责 | 当前实现 | 缺口 |
|---|---|---|---|---|
| R0 | 总控 | 拆解、派发、汇总、越界审计、对外汇报 | `collab.js` 名称“协调者”；权限含 task.plan/assign/context/cost/memory | 无真正的任务拆解器/调度器；当前 `orchestrate` 只是预算计划 |
| R1 | 架构 | 需求分析、方案、影响面、风险、备选 | 名称“架构师”；权限含 `tool.write_file` | 原始定义是“只读；仅 inScope 设计文档可写”，当前写权限没有路径边界 |
| R2 | 实现 | 按任务卡实现、自测、变更清单 | 名称“实施者”；读/写/run_test | 无任务级写路径边界；并发写需新增隔离 |
| R3 | 验证 | 独立测试、回归、边界、数据安全 | 名称“验证者”；读/run_test | 无独立证据目录约束；需调度器注入隔离工作区 |
| R4 | 审查 | 独立复核证据、裁决冲突、准入门 | 名称“评审者”；memory.review/read | 无“不得只看总结”的代码强制；需证据链检查器 |
| R5 | 研究 | 多方向调研、竞品/协议/算法 | 名称“研究者”；只读/记忆写 | 无外部研究工具；M18 中只能做只读分析 |
| R6 | 逆向/安全 | 二进制/APK/流量/运行时分析 | 名称“安全审查”；只读 | 无 REA 工具执行权限/工具面；M19 需补工具适配层 |
| R7 | 发布/运维 | 构建、发布准备、回滚、备份 | 名称“交付管理”；git.status/commit | 无 release/push；无备份/回滚执行器 |

**结论**：权限表可以复用，但显示名称与原始名册不完全一致；M18 的 Agent 定义应使用**原始名册的名称与职责**，权限仍以 `collab.js` 的代码表为准并做任务级收窄。不得自行编造 R5–R7 职责。

---

## 4. 当前运行环境

| 项 | 实测 |
|---|---|
| OS | Windows（`win32 x64`） |
| Node | `v22.22.2` |
| Git | `2.55.0.windows.3` |
| SQLite | Node `node:sqlite`（实验特性警告） |
| objdump | `D:\MinGw\Mingw\mingw64\bin\objdump.exe`（2.39） |
| Ghidra / analyzeHeadless | **缺失** |
| JADX / Java / apktool | **缺失** |
| TShark | **缺失** |
| Frida / frida-ps / adb | **缺失** |
| Docker | **缺失** |
| 真实模型凭据 | **全部 unset** |
| 本地 Ollama | 未运行（127.0.0.1:11434 拒绝连接） |

因此：

- T18-01（真实 Provider 调用）：**BLOCKED / NOT RUN**。
- T19-02（Ghidra）：**BLOCKED**（工具缺失）。
- T19-03（JADX）：**BLOCKED**（工具缺失）。
- T19-05（TShark）：**BLOCKED**；现有纯 JS pcap 解析可作 PARTIAL。
- T19-06（Frida）：**BLOCKED**（工具与设备缺失）。
- T20-02（多个真实 Agent）：**BLOCKED**；可用 mock 验证执行层与调度，但不能写成真实模型协作。

---

## 5. 未提交工作保护清单

| 类别 | 数量 | 处理 |
|---|---:|---|
| `docs/checks/git-review/` | 30 | 不 stage、不改写 |
| `docs/history/` | 14 | 不 stage；两个 18.5 MB 会话转录尤其禁止 |
| `docs/runs/` | 4 | 不 stage |
| `docs/analysis/` | 1 | 不 stage |
| `tooling/agent-runtime/` | 1 | 不 stage |
| `M9-M11-final-acceptance.md` | 1 | 保持工作区格式化版本，不 stage |
| `pre-push-independent-audit.md` | 1 | 上一轮审计产物；本轮不 stage（除非用户要求） |

基线哈希文件：`D:/M1-migration/m12-protected-baseline.txt`。每批提交前后复核 50/50。

---

## 6. M18–M20 实施建议

### M18

1. 新增 `runtime/scheduler.js`：计划、依赖 DAG、READY/WAITING/RUNNING 状态、优先级、最大并发、重试、取消、恢复。
2. 新增 `adapters/fs-workspaces.js`：`shared` / `worktree` / `copy` 三种工作区；变更快照、冲突检测、受控合并。
3. 扩展 `fs-tool-executor`：任务级 `allowedWritePaths`，把 R1/R2 的写权限收窄到任务卡范围。
4. 扩展 `provider-mock`：异步延迟模式，用于证明真实时间重叠；Real Provider 仍按 `NOT RUN` 记录。
5. 修复 M12/M13 已知缺陷：Provider 多轮重复、锁的跨进程唯一约束、预算拒绝留下 PENDING。
6. CLI 扩展 `rds orchestrate dispatch/jobs/job/cancel-job/merge/recover`，保留现有 `plan/start/approve/feedback/status/suggest`。
7. 交付 M18 八份文档 + 机器可读运行记录 + 测试。

### M19

1. 新增 `adapters/rea/tool-registry.js`：统一工具适配器（名称/版本/检测/能力/参数/执行/超时/退出码/stdout/stderr/结果文件/证据/安全）。
2. W-01 增加依赖图、符号检索、关键模块；在真实仓库上执行。
3. W-02 保留 objdump 真实路径，新增 Ghidra Headless 适配器；工具缺失时明确 BLOCKED。
4. W-03 新增 JADX 适配器；工具缺失时明确 BLOCKED，保留 ZIP 事实层。
5. W-04 保留 objdump 调用链；补真实样本证据。
6. W-05 新增 TShark 适配器；工具缺失时 BLOCKED，纯 JS 解析保留 PARTIAL。
7. W-06 新增 Frida 适配器与授权校验；工具/设备缺失时 BLOCKED，不模拟。
8. 安全隔离：样本哈希/类型/只读/临时目录/超时/输出上限/不执行样本；不声称容器级隔离。
9. 每次分析输出 `result.json`、`report.md`、`evidence.json`、`execution.log`。

### M20

1. 用真实 W-01/W-02/W-04 工具输出 + mock Agent 编排做联合场景；真实模型部分明确 BLOCKED。
2. 生成 `execution-record.json`、`evidence/`、`final-report.md`、`final-acceptance.md`。
3. 关键结论必须能回溯到 W 工作流证据或源文件。

---

## 7. 风险与阻塞

| 风险 | 等级 | 处置 |
|---|---|---|
| 无真实模型凭据 | 高 | T18-01/T20-02 标 BLOCKED；不把 mock 写成真实 |
| 无 Ghidra/JADX/TShark/Frida | 高 | W-02/W-03/W-05/W-06 标 BLOCKED；实现适配器但不伪造执行 |
| 并发写同一工作区 | 高 | 每任务独立工作区 + 变更快照 + 冲突检测；冲突时停止合并 |
| 现有 50 项未提交工作 | 高 | 只 stage 明确文件；每批前后哈希核对 |
| 锁跨进程竞态 | 中 | `INSERT OR IGNORE` + 重新 SELECT；补双连接测试 |
| Provider 多轮重复 | 中 | Provider 改为无状态使用 `payload.messages`；补两轮契约测试 |
| 预算拒绝悬挂 PENDING | 中 | 拒绝时落 `FAILED / PROJECT_BUDGET_EXCEEDED` |
| Schema 变更 | 中 | v7 → v8 只加表；幂等；不改旧行 |
| 公开仓库本机路径 | 低 | 新证据用 `<TEMP>`/相对路径；不新增 `C:\Users\...` |

---

## 8. 基线结论

- M9–M17 代码可复用，290 测试全绿，分层/文档/配置/基线门禁通过。
- M18 的调度与并发可以在 mock 下做**真实时间重叠**验证，但不能替代真实模型验收。
- M19 只能完成 W-01/W-04 的真实工具执行；W-02/W-03/W-05/W-06 受环境阻塞。
- M20 可以做“真实 REA 工具 + mock Agent”的联合链路，不能写成“真实多 Agent 联合”。
- 本轮最终状态预计为 **PARTIAL / BLOCKED**，而不是全部 `COMPLETED`；这是环境事实，不是实现失败。
