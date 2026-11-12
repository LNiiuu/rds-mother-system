# M7-0 环境与基线核实

**日期**：2026-11-12（+08:00）
**性质**：`EVIDENCE`。只读核实 + 能力探针，未修改任何产品代码、未提交、未推送。
**用途**：为 M7 实验划定「可以作为前提的真实能力」与「只能算设计设想的部分」。

---

## 1. Git 与工作区

| 项 | 实测值 | 命令 |
|---|---|---|
| HEAD | `ada78488513db88d3eefb5f89ffdc070c4454331` | `git rev-parse HEAD` |
| 分支 | `main` | `git rev-parse --abbrev-ref HEAD` |
| `origin/main` | 同上 | `git rev-parse origin/main` |
| 同步 | `0 0`（本地无领先、无落后） | `git rev-list --left-right --count origin/main...main` |
| 暂存区 | **0** | `git diff --cached --name-only \| wc -l` |
| 工作区未跟踪 | **49** | `git status --porcelain -uall \| wc -l` |
| Tag 总数 | **20**（M3 6 + M4 7 + M5 7） | `git tag -l \| wc -l` |
| 核实时刻 | 2026-11-12T12:09:33Z（20:09 +08） | `date -u` |

### 1.1 49 项受保护工作的指纹

基线文件 `D:/M1-migration/m5-protected-baseline.txt` 共 51 项（M5 起点快照）。

| 项 | 结果 |
|---|---|
| 内容变化 | **0** |
| 新增 | **0** |
| 已入库（即不在工作区） | **2**：`core/templates/role-packet.md`、`core/templates/run-record.json` |
| 结论 | 51 − 2 = **49 项零漂移**（逐项比对 SHA-256 前 16 位 + 字节数） |

这 49 项包括 Git 审查历史、初始部署档案、运行记录，以及一个**未入库**的 PowerShell 渲染器
`tooling/agent-runtime/rds-render-role.ps1`。

---

## 2. 测试与门禁基线

| 项 | 实测 |
|---|---|
| `npm test` | `GATE PASS tests=196 pass=196 fail=0 skipped=0` |
| `rds doctor` | `status: ok (fail=0 warn=1 checks=11)`；唯一 warn 为 `paths:docs`（源码树含历史证据文档，预期行为） |
| 代码规模 | `mars/src` 共 **4 442 行**（22 个域模块 + 5 端口 + 8 适配器） |
| 文档规模 | `docs/` 下 **87 个** Markdown |
| 依赖 | **0 个第三方运行时依赖**（只用 Node 内置模块，含 `node:sqlite`） |

---

## 3. M1–M6 封版状态

| 阶段 | 判定 | 依据 |
|---|---|---|
| M5（可发现性） | **COMPLETED** | `M5-closure.md`，最终 run 43042736329 6/6 |
| M6（macOS 兼容性） | **COMPLETED** | `M6-closure.md`，验收 run 43051690255 7/7，1m06s |
| M1–M4 | 已封版 | `docs/checks/README.md` 索引；20 个 annotated Tag 为证 |

M6 之后**没有新的能力开发**，只有文档收尾。当前 HEAD 处于「M6 已完成、M7 未开始」的状态。

---

## 4. 能力盘点：真实 / 文档层 / 未实现

这一节是实验设计的前提。**只有「实现（有代码路径且有实测）」才能作为 B 组的手段。**

### 4.1 真实实现（本次探针逐条跑过）

| 能力 | 证据 | 备注 |
|---|---|---|
| `rds init` / `init-dev` | 探针中建库、生成身份成功 | `init-dev` **整个覆盖** `principals.json`（见 §5.1） |
| `rds project register` | 返回 `project_id` / `owner_principal` / `share_policy` | 编排的前置条件 |
| `rds put` | 返回 `memory_id` + `status=proposed` + `duplicate` | 默认不生效 |
| `rds review` | R4 审批后 `status=approved`；同身份自审被拒 | 双人审批是硬约束 |
| `rds search` | 只返回 approved；中文查询命中 | FTS5 + unicode61 |
| `rds compile` | 产出 packet + manifest + budget；`tokens=57/4000` | 含 `missing` 阻塞项、`prohibited` 禁止项 |
| `rds orchestrate plan` | 返回 task_class / risk / agents / context_policy / gates | 规则引擎，离线可解释 |
| 权限 | R4 执行 `compile` 被 `AUTHZ_DENIED ROLE_DENIED` | 角色边界真实生效 |
| `rds --help` | 22 个命令全部有详细帮助 | 帮助先于副作用 |

### 4.2 只是文档层（无代码强制）

| 资产 | 实际形态 | 对实验的含义 |
|---|---|---|
| 8 席角色卡（R0–R7） | `core/roles/*.md` | 是**约定**，不是运行时约束。代码里只有 R0/R4 两类权限 |
| WF1–WF4 工作流 | `core/workflows/*.md` | 同上，靠执行者遵守 |
| 证据分级 E1–E4 | `core/protocols/*.md` | 同上 |
| 交接单 / 验收单 / 测试报告模板 | `core/templates/*` | 同上 |

B 组使用这些资产是合法的，但报告必须写明：**它们是流程约定，不是被代码保证的能力**。

### 4.3 未实现（不得作为实验前提）

| 能力 | 状态 |
|---|---|
| `rds principal add` | 无此命令；身份靠 `init-dev` 脚本化追加 |
| `rds upgrade` / `rds uninstall` | 无此命令 |
| `render-role` 渲染器 | 只有本地未入库的 `.ps1`，不随包分发，**不纳入实验** |
| MCP 网关 | 代码存在且冒烟通过，但默认禁用，实验不接客户端 |
| 跨机器/多进程并发编排 | 未验证 |

---

## 5. 探针发现（会影响实验成本的真实问题）

### 5.1 `init-dev` 覆盖身份文件

第一次探针里，我在同一目录第二次执行 `init-dev`（换个 principal 名），结果 `principals.json`
被**整个覆盖**，之前的 R0 token 立即失效（后续命令全部 `TOKEN_MISSING`）。
这正是 M5-B3 修过的 `--help` 缺陷的邻近行为：命令本身没错，但**没有追加模式**。
对实验的影响：B 组必须一次性规划好身份，并把 token 立即落到变量或文件，否则要重来。

### 5.2 `compile` 的 `missing` 会给出阻塞项

空任务状态下，packet 的 `missing` 含一条 `blocking: true`：「本角色需要可直接访问的原始证据，但未提供」。
这意味着 B 组要产出可用上下文包，必须**主动提供证据引用**，不能只写决策。

### 5.3 编排器的任务分类是关键词规则，会误判

用 objective「实现账单聚合 CLI 并补测试」调用 `orchestrate plan`，返回
`task_class=verification`、`risk=low`、只派 `R3`（测试/验证）。
这是一个**实现任务**，却被分类成验证任务。规则引擎是真实可用的，但**分类准确性有限**。
实验里要记录这一点：如果 B 依赖编排器派角色，可能派错。

### 5.4 未发现文档所称的「名誉/评分模块」

`mars/src` 下只有 `db/ratelimit.js`、`db/schema.js`、`db/stats.js`，
`reputation` 只在 `cli.js` / `orchestrator.js` 的字符串里出现。**不存在独立的名誉系统。**
`orchestrate feedback` 记录 `quality` / `rework`，但没有回写任何评分模型。

---

## 6. 度量可行性：Token 数据是不是真的

这是 M7 能否成立的关键。结论：**能拿到真实逐次调用用量，但不是供应商账单级对账。**

WorkBuddy 的会话记录（JSONL）里，每个 `function_call` 都带 `providerData.rawUsage`：

```json
{"prompt_tokens":32847,"completion_tokens":239,"total_tokens":33086,
 "prompt_tokens_details":{"cached_tokens":8064},
 "prompt_cache_hit_tokens":8064,"prompt_cache_miss_tokens":24783,
 "completion_thinking_tokens":41}
```

同时 `function_call_result` 带 `callId`、`timestamp`、`output.text`，可以还原：
调用了哪个工具、参数是什么、输出多少字节。

**能测的**：
- 每次模型调用的 input / output / cache-hit token（真实，来自运行时）
- 每次工具调用的名称、参数、输出字节（真实）
- 每段实验窗口的墙钟时长（真实时间戳）

**不能测的**：
- 供应商账单金额（`credit` 字段存在，但不做货币换算）
- 单独归因到某一组的「净成本」——因为两组在**同一个会话**里顺序执行，
  后一组天然背上前一组的历史上下文

这条限制决定了实验口径：Token 对比是**方向性证据**，不是因果结论。
具体处理见 [M7-1-protocol.md](M7-1-protocol.md) §4。

---

## 7. 顺带发现的文档偏差

`README.md` 的「当前状态」表仍写着 **「CI … 6 个 job 全 success，1m21s」** 并指向 run 42595065685。
M6 之后实际是 **7 个 job**（含 macOS），最近一次全绿为 run 43051690255。
M6 的文档同步只改了 macOS 行，漏了 CI 行。**本轮不修**（避免与实验混在一起），
登记在此，留给 M7 文档批次或后续清理。

---

## 8. M7-0 结论

| 问题 | 答案 |
|---|---|
| 仓库是否干净可复现 | 是：HEAD = origin/main，暂存区空，49 项受保护工作零漂移，20 个 Tag 未动 |
| 测试基线 | 196/196，`fail=0 skip=0`，Windows 实机 |
| B 组可用的真实能力 | 记忆写入/审批/检索/上下文编译/编排计划/权限，全部实测可用 |
| B 组不可用的能力 | 角色卡与工作流的**强制力**、`principal add`、`render-role`、MCP 客户端接入 |
| Token 数据 | 有真实逐次用量；但同会话顺序执行导致归因受限，只能作方向性证据 |
| 是否具备开始实验的条件 | **具备**，但必须预先登记口径与局限 |
