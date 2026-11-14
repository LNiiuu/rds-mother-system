# M12-0 基线审计（只读）

**日期**：2026-11-12 22:24–22:40（+08:00）
**性质**：`EVIDENCE`。本文所有数字均为本轮实测，不采信历史报告。
**范围**：只读。本轮未修改任何业务文件（唯一例外：执行了数据库文件复制备份，未写入原库）。

---

## 1. Git 状态

| 项 | 实测值 |
|---|---|
| 分支 | `main` |
| HEAD | `61590c71964b6b11bd6826ec04a5413ef45edfe8` |
| HEAD 标题 | `docs(m9-m11): 基线、三个封版记录与总验收` |
| origin/main | `ada78488513db88d3eefb5f89ffdc070c4454331` |
| ahead / behind | **5 / 0** |
| 暂存区 | **0** |
| 工作区条目（`-uall`） | **50** |
| 历史 Tag | **20**（`m3-b0`…`m5-b6`，全部 annotated） |
| 指向 `ebcdaa3` 之后区间的 Tag | **0** |

### 1.1 工作区 50 项的构成

| 类别 | 数量 | 说明 |
|---|---|---|
| 未跟踪的受保护工作 | **49** | `docs/checks/git-review/`、`docs/history/`、`docs/analysis/`、`docs/runs/`、`tooling/agent-runtime/` |
| 已跟踪文件的未提交修改 | **1** | `docs/checks/productization/M9-M11-final-acceptance.md` |

**关于那 1 项修改**：差异为 **103 增 / 101 删，全部是 Markdown 表格的对齐与行尾空格**，无任何文字或数字变化。来源判断：编辑器/预览器的表格格式化。本轮**不还原、不提交**，按「用户未提交工作」对待。

### 1.2 受保护工作指纹

基线文件 `<LOCAL_EVIDENCE>/m5-protected-baseline.txt`（51 条，M5 时点建立）。

| 项 | 结果 |
|---|---|
| 内容变化 | **0** |
| 新增 | **1**（即上面那份被格式化的已跟踪文档，不在旧基线范围内） |
| 已入库 | **2**（`core/templates/role-packet.md`、`core/templates/run-record.json`，M5-B6 有意提交） |

即：**49 项未跟踪受保护工作，逐字节零漂移**。本轮已重建 `<LOCAL_EVIDENCE>/m12-protected-baseline.txt`（50 条）作为 M12–M17 的比对基准。

---

## 2. 数据安全前置动作

| 动作 | 结果 |
|---|---|
| 本机开发库 | `mars/var/mars.db`，589,824 B |
| 备份路径 | `<LOCAL_EVIDENCE>/m12-backup/mars-before-m12.db` |
| SHA-256（原库 = 副本） | `9e810fa555b2ceec1891c73491052a2c6d63472fa1a4d928b340af7d1ec0cecc` |
| 副本 `PRAGMA integrity_check` | `ok` |
| 副本 `meta.schema_version` | `4` |
| 副本 memories 行数 | `31` |

**发现一处待处理的不一致**：代码 `SCHEMA_VERSION = 5`，而本机库为 **4**，`doctor` 已报警（`database warn 结构版本 4 < 5`）。库中只有 17 张表，缺 M9–M11 的 6 张（`context_runs`/`compressions`/`tasks`/`task_events`/`handoffs`/`costs`）。

结论：迁移是「只加表 / 只加列」的幂等迁移，下次打开会自动执行；但因涉及本机真实数据（31 条记忆），**先备份再让任何命令打开该库**。备份已完成且校验通过，可安全进入 M12。

---

## 3. 测试与门禁基线

| 项 | 实测值 |
|---|---|
| `npm test`（test-gate） | **`GATE PASS tests=228 pass=228 fail=0 skipped=0`** |
| 测试文件数 | 35 |
| 分布 | arch 131、phase1 50、ledger 12、phase2 12、mcp 11、phase4 7、phase3 5 |
| `rds doctor` | `status: ok (fail=0 warn=2 checks=11)` |
| Node | v22.22.2（`engines: >=22.15.0`） |
| 运行时依赖 | **0 个**（`dependencies` / `devDependencies` 均为空） |

`doctor` 的 2 个 warn：① 上述结构版本落后；② 源码树 `paths:docs` 命中历史证据文档（既有设计，非缺陷）。

---

## 4. 代码结构实况

| 项 | 实测值 |
|---|---|
| `mars/src/*.js` | 26 个文件，4,978 行 |
| `mars/src/db/*.js` | 316 行 |
| 端口 | 5 个：`asset-resolver`、`audit-sink`、`host-registry`、`identity-provider`、`session-source` |
| 适配器 | 9 个：`cli-identity`、`token-file-identity`、`db-audit-sink`、`null-audit-sink`、`dsh-registry`、`dsh-session-source`、`fs-asset-resolver`、`fs-project-roots`、`null-host-registry` |
| 契约（JSON Schema） | 5 个：`context-packet`、`ledger`、`manifest`、`memory`、`role-routing` |
| 组合根 | `composition.js`，85 行（上限 120） |

### 4.1 分层规则（`tooling/layering-check.mjs`，可执行）

- L1 端口零 require；L2 单端口方法数 ≤ 5
- **L3 域模块不得 require `node:fs` / `node:child_process`**
- **L4 域模块不得读 `process.env`**
- **L5 域模块不得 require 适配器**
- L6 组合根 ≤ 120 行；L7 无循环依赖

白名单仅 2 条（`util.js`、`cli.js` 的 fs，标为永久边界）。

> **这是 M12 设计的硬约束**：Agent Runtime 的域逻辑不能直接碰文件系统、子进程、环境变量或适配器。模型调用与工具执行必须做成端口 + 适配器，由组合根注入。这条约束决定了下面 §6 的架构。

---

## 5. 现有 Agent / 任务 / 成本能力实况

### 5.1 真实存在且可执行的

| 能力 | 位置 | 强度 |
|---|---|---|
| 角色权限表 R0–R7 | `collab.js` `ROLES` | 代码校验（CLI 调用前 `assertPermission`） |
| 11 态任务状态机 | `collab.js` `TRANSITIONS` | 代码强制，非法迁移抛 `INVALID_TRANSITION` |
| 任务事件流 | `task_events` 表 | 每次迁移写一行 |
| 确定性调度 + 拆分 | `collab.js` `dispatch` / `planTasks` | 代码强制（关键词规则） |
| 交接包（最小上下文） | `collab.js` `buildHandoffSummary` + `compiler` | 代码强制编译，摘要取自已记录事实 |
| 成本账本 | `costs` 表 + `costReport` | 区分 `estimated` / `provider` |
| 上下文预算 | `context-budget.js` | 代码计算，5 档状态 |
| 上下文压缩/恢复 | `context-ops.js` | 确定性算法，SHA-256 校验 |
| 编排 run 记录 | `orchestrator.js` + 表 | 有 `plan`/`start`/`approve`/`feedback` |

### 5.2 **不存在**的（必须明说）

| 声称的能力 | 实况 |
|---|---|
| 「Agent 实例」 | **没有**。`orchestrator.js` 的 `DEFAULT_AGENTS` 是 8 条**静态常量**（role_id + capabilities + max_risk），只是查表用的配置，不是运行实体。 |
| 「Agent 会话」 | **没有**。无 `session` 表、无会话对象、无多轮上下文。 |
| 「Agent 运行（run）」 | **没有**真正执行。`orchestrator_runs` 只记录计划的元数据，没有任何模型调用。 |
| 「真实多 Agent 执行」 | **同进程顺序模拟**。`tooling/m9-m11-demo.cjs` 的 `simulated: true` 已如实标注。 |
| 「工具调用权限检查」 | **没有运行时检查**。角色权限只在 CLI 命令入口检查，不覆盖「Agent 要执行某工具」这一层。 |
| 「并发 / 重试 / 超时 / 心跳」 | **全部没有**。 |
| 「模型 Provider」 | **完全没有**。仓库内 0 处 HTTP 模型调用。 |
| 「工作区锁 / 文件冲突处理」 | **没有**。 |

### 5.3 结论

M11 交付的是**协作的账本与状态机**，不是**执行**。M12 的实质工作是从零建立执行层，而不是给现有东西改个名字。这一点写进 §6 的设计前提。

---

## 6. M12 设计前提（由上面的事实推出）

1. **Runtime 必须在分层规则内落地**：域模块只做状态机 + 数据库 + 端口派发；HTTP、`child_process`、`fs` 全部进适配器；组合根注入。否则 `npm run layers` 会红，而这条门禁是既有资产，不能为新功能开豁免。
2. **端口方法数 ≤ 5**：模型端口压缩成 5 个最小方法（`createSession` / `sendMessage` / `cancel` / `getUsage` / `healthCheck`），`execute`/`getResult`/`getStatus` 由 Runtime 组合而成。这不是偷工，是把「Provider 必须实现的最小面」与「平台提供给上层的面」分开。
3. **零新依赖**：HTTP 用 Node 22 内建 `fetch`；mock provider 纯确定性。不引入 SDK。
4. **只加不改**：Schema v6 只新增 6 张表，不动既有表与既有行；旧库升级后 M9–M11 功能照旧。
5. **不伪造执行**：没有凭据就是 `NOT RUN: credentials unavailable`。Mock provider 产出的运行记录必须带 `provider=mock`，且 `usage_source=estimated`，与真实调用在任何查询里都可区分。

---

## 7. 外部能力可用性（决定 M14 的真实边界）

### 7.1 模型凭据

| 变量 | 状态 |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `MOONSHOT_API_KEY` / `DASHSCOPE_API_KEY` / `AZURE_OPENAI_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `MARS_LLM_API_KEY` | **全部 unset** |
| 本地模型运行时（ollama / llama-server / `127.0.0.1:11434`） | **不可用**（命令缺失，端口 000） |

**判定**：M12-3 的「真实模型调用」在本环境为 **NOT RUN: credentials unavailable**。必须完成 Adapter + Mock 测试 + 配置说明，并在验收中明确此限制。不得伪造调用结果。

### 7.2 逆向工具链

| 工具 | 本机 | 说明 |
|---|---|---|
| `ghidraRun` / `analyzeHeadless` | **MISSING** | |
| `jadx` | **MISSING** | |
| `tshark` | **MISSING** | |
| `frida` / `frida-ps` | **MISSING** | |
| `adb` / `apktool` / `java` | **MISSING** | |
| `objdump` / `nm` / `strings` | **可用** | `/d/MinGw/Mingw/mingw64/bin/` |
| `python3` | 可用 | 3.13.12 |
| WSL | **被安全策略拦截** | `wsl.exe` 在程序黑名单中，不可绕过 |

历史 REA 能力（Ghidra 12.1.4、REA 6.8.0）是在 **WSL 内经外部 `rea-agents` MCP** 达成的，本仓库内**没有**任何可执行的逆向代码。

### 7.3 REA 资产实况

`rea/` 共 17 个文件，**全部是 Markdown**：

| 路径 | 内容 |
|---|---|
| `rea/workflows/w-01..w-06` | 6 份**文档**（无 schema、无 preflight、无 execute） |
| `rea/evidence/EV-20261101-001..006` | 6 份**历史运行记录**（外部 REA MCP 产出） |
| `rea/baseline/audit-20261101.md` | 基线审计（同上环境） |
| `rea/samples/index.md` | 样本索引 |

历史证据等级（照抄证据文件，不改写）：

| 工作流 | 历史结论 | 依据 |
|---|---|---|
| W-01 代码理解 | 未跑真实目标（L2 待验） | baseline §3 |
| W-02 原生静态 | **PASS L3**：`where.exe` 198 procedures / 153 strings，含伪代码与两条调用链 | `EV-...-006` |
| W-03 APK 静态 | **PASS L3**（JADX 实调，真实 APK） | `EV-...-001` |
| W-04 调用链 | 需先 `open_binary`，未跑 | baseline §3 |
| W-05 PCAP | **BLOCKED**：agent 侧安全策略拦截 `.pcap` 路径（规则 `secret.ext.pcap`） | `EV-...-003`、baseline §4 |
| W-06 Frida | **PASS L2**（binding 加载 + 设备枚举），未做真实 hook | `EV-...-002` |

**M14 的起点因此是「6 份文档 + 6 份外部证据」，不是「6 个可运行工作流」。**

M14 可达成的真实范围（本轮环境）：

| 工作流 | 本轮可达 | 方式 |
|---|---|---|
| W-01 | **可真实执行** | 文件遍历 + 语言/依赖/入口识别（Node 即可） |
| W-02 | **部分真实**：格式/架构/符号/字符串/调用关系 | MinGW `objdump`/`nm`/`strings`，**无 Ghidra 反编译** |
| W-03 | **BLOCKED** | 无 jadx/apktool/java；preflight 必须检测并拒绝，不得假装 |
| W-04 | **部分真实**：静态调用图 | 从 `objdump -d` 的 `call` 指令构建，明确标注「静态推断」 |
| W-05 | **可真实执行** | 自写纯 Python pcap 解析（无 tshark），样本必须是明确标注的**合成 fixture** |
| W-06 | **BLOCKED** | 无 frida、无设备、无授权目标；preflight 必须拒绝 |

---

## 8. 风险与兼容性

| # | 风险 | 处置 |
|---|---|---|
| R1 | 本机库 v4 → v5 迁移 | 已备份并校验；迁移为只加表，幂等 |
| R2 | 新增 Runtime 触碰分层门禁 | 端口 + 适配器 + 组合根注入；不接受豁免 |
| R3 | 组合根 120 行上限 | 现 85 行，新增装配需控制在 ~30 行内，否则拆分 |
| R4 | 无模型凭据 → 真实多 Agent 无法验收 | Adapter + Mock + `NOT RUN` 标注；最终判定不得写「真实多 Agent 已验收」 |
| R5 | 无逆向工具链 → W-03/W-06 阻塞 | preflight 显式拒绝；不伪造 |
| R6 | 已有 20 个 Tag 与 M1–M11 基线 | 不修改、不重打；本轮如需 Tag 只加不改 |
| R7 | 工作区 1 个已跟踪文档被格式化 | 全程不纳入本轮提交；指纹比对单列 |
| R8 | pytest/子进程工具在 Windows 上的路径差异 | 工具执行器统一 `execFile` + 显式 cwd + 超时 |

---

## 9. 本轮可复用的既有能力（不重复造）

| 需要的东西 | 已有 | 直接复用 |
|---|---|---|
| 项目隔离 | `projects.js` + `projectRoots` | ✅ |
| 上下文编译 | `compiler.js`（含 `--task-file`、压缩、监控） | ✅ |
| 交接摘要结构 | `collab.buildHandoffSummary` | ✅ 扩展字段 |
| 任务状态机 | `collab.TRANSITIONS` | ✅ 扩展 run 态 |
| 成本账本 | `costs` 表 | ✅ 加 `run_id` 关联 |
| 审计 | `audit()` + `DbAuditSink` | ✅ |
| 身份/授权 | `authz.js` + `principals` | ✅ |
| 分层门禁 | `layering-check.mjs` | ✅ 作为设计约束 |
| 基线登记 | `approved-additions.json` | ✅ 新文件需登记 |

---

## 10. 结论

基线可信，可进入实施。三条硬事实约束了本轮能承诺什么：

1. **执行层是空的** —— M12 是建设，不是重构。
2. **没有模型凭据** —— 真实多 Agent 只能到「Adapter 就绪 + Mock 全链路验证 + 真实调用 NOT RUN」。
3. **没有逆向工具链，WSL 被策略封禁** —— W-01/W-05 可做真实实现，W-02/W-04 只能用 binutils 做部分真实，W-03/W-06 必须 BLOCKED。

这三条会原样进入最终验收报告的「未完成项」，不包装。
