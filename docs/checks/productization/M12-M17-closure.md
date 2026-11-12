# M12–M17 封版记录

**日期**：2026-11-12（+08:00）
**范围**：M12 Agent Runtime / M13 可靠调度 / M14 REA / M15 联合 / M16 适配器 / M17 产品化
**起点**：`61590c7`（M11 封版）
**性质**：`EVIDENCE`。所有数字来自本机真实执行；未运行项一律标 NOT RUN。

---

## 0. 判定

| 里程碑 | 判定 | 一句话依据 |
|---|---|---|
| **M12** | `COMPLETED` | 执行层从零建立：Schema v6、2 端口、3 适配器、6 态 run 状态机、4 Agent 交接链实跑 |
| **M13** | `COMPLETED` | 锁/重试/心跳/预算/权限五类机制均可用，9 类故障注入有测试 |
| **M14** | `COMPLETED` | 六套工作流具备统一接口；4 套真实执行（PARTIAL），2 套 BLOCKED 且原因具体 |
| **M15** | `COMPLETED` | 8 种任务类型 + 类型-工作流强校验；逆向→审核→重构案例实跑 |
| **M16** | `COMPLETED WITH WARNINGS` | 两个真实协议适配器已实现并契约测试；**真实网络调用 NOT RUN** |
| **M17** | `COMPLETED` | 干净克隆 + 独立安装 + 全部门禁通过；文档与命令一致 |
| **总体** | `COMPLETED WITH WARNINGS` | 本地工程完整可复现；但「真实多 Agent」未验证（无凭据），跨平台未跑 |

**为什么总体不是 `COMPLETED`**：M12 的验收标准之一是「不同 Agent 真实调用模型」。本环境没有任何 provider 凭据，实际跑的是确定性 mock。把 mock 全链路写成「真实多 Agent 已验证」是造假，所以给 WARNINGS。

---

## 1. M12：Agent Runtime

### 目标
把 M11 的「账本 + 状态机」升级为真正的执行层：独立会话、独立 run、逐次工具权限、用量三值分离、结构化交接。

### 变更文件
| 文件 | 作用 |
|---|---|
| `mars/src/db/schema.js` | v5 → **v6**：`agents`/`agent_sessions`/`agent_runs`/`run_events`/`agent_usage`/`workspace_locks`；`handoffs` 加 5 列、`costs` 加 `run_id` |
| `mars/src/ports/model-provider.js` | 5 方法 + 8 项能力清单 + `validateProvider` |
| `mars/src/ports/tool-executor.js` | `list`/`invoke`/`healthCheck` |
| `mars/src/adapters/provider-mock.js` | 确定性脚本；`capabilities.usage=false` |
| `mars/src/adapters/provider-openai-compat.js` | Chat Completions 形状 |
| `mars/src/adapters/fs-tool-executor.js` | 4 个白名单工具，realpath 根约束 |
| `mars/src/runtime/agent-runtime.js` | 域逻辑：状态机/会话/权限/用量/事件/执行 |
| `mars/src/runtime/handoff.js` | 结构化交接 + 为下一棒重编译上下文 |
| `mars/src/runtime/chain.js` | 交接链执行 |
| `mars/src/cli-agent.js` | `agent`/`run`/`trace`/`usage` 的 CLI |

### 关键决策
1. **端口只留 5 个方法**：`execute`/`getStatus`/`getResult` 由 Runtime 组合。理由：那是同一套状态机，放进端口会让每接一个厂商重写一遍。
2. **工具被拒不是抛异常**：把 `DENIED` 作为工具结果回灌给模型，同时在 trace 留 `allowed=false`。这样既能收敛，又有硬记录。
3. **不申请分层豁免**：新增 9 个文件全部落在 ports/adapters/runtime，`npm run layers` 仍只有 2 条永久边界。

### 测试
新增 19 例（`mars/tests/arch/agent-runtime.test.js`）：定义/隔离/执行/幂等/状态机/权限/路径/失败/用量/契约。

### 失败与修复
| 现象 | 根因 | 修复 |
|---|---|---|
| mock 只跑出 1 次调用、0 工具 | provider 实例没拿到该 Agent 的脚本 | `providerFor(name, agent)` 注入 `scriptByAgent` |
| `run_test` 报「递归调用 test runner」 | 子进程继承 `NODE_TEST_CONTEXT` | 执行器 spawn 前删除该变量 |
| 无执行器时报 `TOOL_NOT_AVAILABLE` | 判定顺序：先查 spec 后查 executor | 改为先查 executor |

### 证据
`docs/checks/m12/demo-chain.json`：4 Agent、4 独立 session、3 次交接、测试 `fail=1 → pass=1`。

---

## 2. M13：可靠调度

### 变更文件
`runtime/locks.js`、`runtime/reliability.js`、`runtime/policy.js`、`agent-runtime.js`（锁与重试）、`cli-agent.js`（reap/providers）、`cli.js`、`cli-help.js`

### 关键决策
1. **锁是项目级不是文件级**：工具面没有「一次改多文件」的原子性，文件级锁会给人「已经安全」的错觉。
2. **锁拿不到就失败，不排队**：排队需要队列与调度器，超出本轮范围；失败是明确且可重试的。
3. **重试只对 5xx/不可达/超时**：`TOOL_DENIED` / `BUDGET_EXCEEDED` / 4xx 是确定性拒绝，重试只会重复犯错还烧预算。
4. **四类动作永远拒绝**：`file.delete` / `git.push` / `release` / `network` 没有任何角色拥有——没有授权路径，比文档约定强一档。

### 测试
新增 16 例（`mars/tests/arch/reliability.test.js`）：重试 3、退避 1、锁 2、崩溃 2、预算 2、重复提交 1、权限 2、故障注入 3。

### 失败与修复
| 现象 | 根因 | 修复 |
|---|---|---|
| 锁过期测试没拿到 busy | 第一条锁 TTL=1ms 立即过期 | 改 5000ms，再手工把过期时间推到过去 |
| 读不存在文件返回 `ENOENT` | 直接透传 Node errno | 收敛为 `TOOL_NOT_FOUND`/`TOOL_ACCESS_DENIED` |

### 未做
超时后的任务恢复、并发调度器、重试的幂等性保证（写操作重试可能重复写）。

---

## 3. M14：REA

### 起点事实
`rea/` 17 个文件全是 Markdown；无 schema、无 preflight、无 execute。历史证据来自 WSL 内外部 `rea-agents`，本仓库没有可执行代码。

### 变更文件
`adapters/rea/{tools,evidence,w01-code,w02-binary,w03-apk,w04-callchain,w05-pcap,w06-frida,registry}.js`、`cli-rea.js`、Schema v7 `rea_runs`

### 真实执行结果
| 工作流 | 状态 | 实测 |
|---|---|---|
| W-01 | PARTIAL | 仓库扫描 509 文件 / 207 md / 132 js / 49 测试 |
| W-02 | PARTIAL | `where.exe`：`pei-x86-64`、7 段、7 个导入 DLL、206 字符串、符号 0（已剥离） |
| W-03 | **BLOCKED** | 缺 jadx/java；仍给出 ZIP 事实：2 dex、二进制 manifest、native 库、签名文件 |
| W-04 | PARTIAL | 12795 条指令 → 92 个推断边界 / 277 条直接边 / 23 个间接调用点未解析 |
| W-05 | PARTIAL | 合成 pcap 4 包：UDP 2 / TCP 2 / DNS 2 / HTTP 1；长标签启发式触发 |
| W-06 | **BLOCKED** | 缺 frida/adb，**不实现 execute** |

**交叉验证**：W-02 测出的 `where.exe` SHA-256 = `f51fab80…`，与 2026-11-01 历史证据 `EV-20261101-006` 完全一致——独立复现了同一份样本。

### 关键决策
1. **PARTIAL 不是 PASS**：四套可执行工作流全部标 `partial`，各自 `not_done` 列明未做项。
2. **W-06 不实现 execute**：动态插桩的结论只能来自真实运行时；模拟数据会让人误以为验证过。
3. **W-05 不依赖 tshark**：自写 libpcap 解析，跨平台一致；pcapng 明确报 `UNSUPPORTED_FORMAT`。
4. **剥离二进制用启发式划函数边界**，规则写进结果（`inference.boundary_rule`）。

### 失败与修复
| 现象 | 根因 | 修复 |
|---|---|---|
| W-04 只有 2 个"函数"、0 条边 | `.text` 标签后所有指令都归给它 | 重写为「边界 = 入口 + 调用目标 + 符号」，按地址二分归属 |
| W-03 解析不出 native 库 | 打包工具写反斜杠路径 | 归一化 `/` |
| 自建 tar 包报 `ZIP_EOCD_NOT_FOUND` | `tar -a` 对 `.apk` 不产 ZIP | preflight 加 PK 头校验（`SAMPLE_NOT_APK`） |

---

## 4. M15：联合

### 变更
`runtime/task-types.js`、`tooling/m15-joint-demo.cjs`、`cli.js`（`task types` / `--type`）、`cli-rea.js`（`--task-type`）

### 关键决策
- 八种任务类型固定「角色链 / 允许的工作流 / 必需证据」
- 类型与工作流不匹配 **抛错**（`WORKFLOW_NOT_IN_TASK_TYPE`），不是警告
- 关键词只用于 `suggest()`，不决定流程；顺带修掉 M11「实现并补测试被判成 verification」

### 证据
`docs/checks/m14/joint-demo.json`：案例 A（W-02+W-04 → R4 审核）→ 案例 B（R1→R2→R3→R4，3 次交接、4 独立 session、重构后测试仍通过）。

### 诚实标注
模型是 mock，重构代码是预置脚本而非模型生成。

---

## 5. M16：适配器

### 变更
`adapters/provider-anthropic.js`、`cli-agent.js`（`agent providers`）、`tests/arch/provider-adapters.test.js`

### 两种协议的真实差异（都在适配器里吃掉）
1. system 是顶层字段
2. 工具定义是 `input_schema`
3. 工具结果是 `user` + `tool_result` 块
4. 用量字段名不同
5. 需要 `anthropic-version` 头

### 测试
7 例注入 fetch 的契约测试：请求形状、响应翻译、未配置拒绝、5xx/4xx 可重试性、能力清单。

### 未做（这是 WARNINGS 的来源）
- **真实网络调用 NOT RUN**：`MARS_LLM_*` / `MARS_ANTHROPIC_*` 全部未设置
- 跨平台联合任务（平台 A → 平台 B）未执行
- 流式、会话恢复未实现，能力清单里 `stream:false` / `resume:false`

---

## 6. M17：产品化

### 验证结果
| 项 | 结果 |
|---|---|
| 干净克隆 | 455 跟踪文件、`dirty=0`、**290/290**、BASELINE/PACK/SMOKE PASS |
| 发行包 | 安装到临时前缀，`doctor` **11 项 fail=0 warn=0** |
| 安装后流程 | init → init-dev → project → agent create/start（SUCCEEDED，文件真的写入）→ run list → policy → rea status → rea W-01（PARTIAL）→ task types |
| 文档 | `DOCS PASS`（215 个 Markdown） |

### 安装验证抓到的真 bug
`rds rea run --root <dir>` 会被当成安装根，导致契约加载失败并报 `ASSET_MISSING … \ws\mars\contracts\memory.schema.json`——错误信息把人引向完全错误的方向。修复：rea 的代码根改用 `--path`，并在 `createRuntime` 之前拦截 `--root`，给出明确提示（exit 2）。

### 文档
新增 `docs/agents.md`（多 Agent 使用）、`docs/rea.md`（REA 使用）；更新 `README.md`、`docs/README.md`、`docs/PROJECT-MAP.md`、`docs/checks/README.md`、`CHANGELOG.md`；两份新文档进发行包。

---

## 7. 汇总

### 测试
| 阶段 | 用例数 |
|---|---|
| M11 封版 | 228 |
| M12 | 247（+19） |
| M13 | 263（+16） |
| M14 | 277（+14） |
| M15 + M16 | **290**（+13） |

`fail=0`、`skipped=0`。测试门禁要求 `tests>0 && fail=0 && skipped=0`。

### Git
| 提交 | 内容 |
|---|---|
| `b0b668f` | M12 执行层 |
| `6bd8efe` | M13 可靠调度 |
| `96c289d` | M14 REA |
| `c5c0d70` | M15 联合 |
| `5a71cad` | M16 适配器 |
| 本次 | M17 文档与验收 |

### CI
**未运行**。CI 由 push 触发，本轮未获授权 push。`docs/checks/final/` 的报告里不把本地结果写成 CI 结果。

### 成本
本轮**零模型费用**：全部验证基于 mock provider，未发起任何付费 API 调用。REA 的分析是本地工具执行，无网络访问。

### 安全评估
| 项 | 结论 |
|---|---|
| 工具面 | 4 个白名单工具，无 shell、无网络、无 git |
| 路径 | realpath + 相对路径校验，逃逸被拒 |
| 权限 | 逐次校验；四类敏感动作无任何角色拥有；允许与拒绝都审计 |
| 凭据 | 只从环境变量读，不进仓库、不进日志 |
| 数据 | 本机库先备份再迁移（SHA-256 一致、integrity ok） |
| 不足 | **无进程隔离**；角色可被同 OS 用户切换；不构成安全沙箱 |

---

## 8. 未完成事项（全部为已知、已声明）

| # | 项 | 状态 | 影响 |
|---|---|---|---|
| 1 | 真实模型调用 | **NOT RUN**（无凭据） | 「真实多 Agent」未验证 |
| 2 | 跨平台联合任务 | **NOT RUN** | 跨平台能力未验证 |
| 3 | Linux / macOS 跑 M12–M17 | **NOT RUN** | 只有 Windows 证据 |
| 4 | 远程 CI | **NOT RUN**（未 push） | 无远程证据 |
| 5 | W-03 完整分析 | **BLOCKED**（缺 jadx） | 且需实现 execute |
| 6 | W-06 动态分析 | **BLOCKED**（缺 frida/adb） | 且需实现 execute |
| 7 | 流式 / 会话恢复 | 未实现 | 能力清单如实标 false |
| 8 | 并发调度 | 未实现 | 只有互斥锁，无并行编排 |
| 9 | 语义摘要压缩 | 未实现 | 只有确定性压缩 |
| 10 | 进程级隔离 | 不做 | 明确声明不是沙箱 |
| 11 | 失败重试的幂等性 | 未实现 | 写操作重试可能重复写 |
