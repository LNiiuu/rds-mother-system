# RDS/MARS 最终验收报告（M12–M17）

**日期**：2026-11-12（+08:00）
**验收基线**：代码提交 `5a71cad`（M16 封版）。其后为文档批次，验收规则同 M6-closure §7——文档提交不改变功能结论。
**最终状态**：**READY FOR USER AUTHORIZATION**

> 本报告只写真实执行过的结果。未运行的一律标 `NOT RUN`，被阻塞的标 `BLOCKED`，部分达成的标 `PARTIAL`。
> 不把 mock 结果写成真实模型结果，不把本地结果写成 CI 结果。

---

## A. 最终产品能力总览

RDS/MARS 现在是一个**本地可运行的多 Agent 执行与上下文治理平台**：

| 层 | 能力 | 强度 |
|---|---|---|
| 入口 | `rds` 33 个命令，`--help` 覆盖全部且无副作用 | 代码 |
| 执行 | Agent 定义 → 会话 → run → 工具调用 → 用量 → 事件流 | 代码 |
| 上下文 | 项目隔离、L0–L3 分层、预算、确定性压缩、原文恢复（SHA-256） | 代码 |
| 协作 | 11 态任务机、R0–R7 权限表、结构化交接、交接链 | 代码（权限）/ 约定（角色分工） |
| 治理 | 工作区锁、重试退避、心跳与失联回收、预算闸门、敏感动作矩阵 | 代码 |
| 专业引擎 | REA 六套工作流（4 可执行 / 2 阻塞）、证据三件套 | 代码 |
| 适配器 | 3 个 provider（1 模拟 + 2 真实协议），能力清单显式声明 | 代码（协议）/ NOT RUN（真实调用） |

**它不做什么**：不提供模型，不提供进程沙箱，不做并发编排，不解密流量，不替人做 git 操作。

---

## B. 里程碑状态

| 里程碑 | 判定 | 依据 |
|---|---|---|
| M12 Agent Runtime | `COMPLETED` | Schema v6、2 端口、3 适配器、6 态 run、4 Agent 交接链实跑 |
| M13 可靠调度 | `COMPLETED` | 锁/重试/心跳/预算/权限，9 类故障注入有测试 |
| M14 REA | `COMPLETED` | 统一接口 + 4 套真跑（PARTIAL）+ 2 套 BLOCKED（原因具体） |
| M15 联合 | `COMPLETED` | 8 种任务类型 + 强校验 + 逆向→审核→重构实跑 |
| M16 适配器 | `COMPLETED WITH WARNINGS` | 两协议已实现并契约测试；**真实调用 NOT RUN** |
| M17 产品化 | `COMPLETED` | 干净克隆 + 独立安装 + 全门禁 |
| **总体** | **`COMPLETED WITH WARNINGS`** | 工程完整可复现；「真实多 Agent」未验证 |

---

## C. 多 Agent 真实执行证据

### C.1 执行层是真的

`docs/checks/m12/demo-chain.json`（`npm run demo:m12`）：

| 项 | 值 |
|---|---|
| Agent 数 | 4（R1/R2/R3/R4） |
| 独立 session | **4/4**（`sessions_distinct: true`） |
| 自动交接 | **3 次** |
| 工具调用 | R1 写 DESIGN.md、R2 改 src/sum.js、R3 跑测试、R4 读两个文件 |
| 测试 | **before `fail=1` → after `pass=1`** |
| 用量来源 | 全部 `estimated`（mock 的 `capabilities.usage=false` 是代码强制） |
| 执行性质 | `execution_kind: simulated` |

run 的 trace 逐条可查：`STATE → CONTEXT → SESSION → USAGE → TOOL → … → STATE`，工具事件带 `meta.sha256`。

### C.2 什么是真的，什么是模拟

| 真 | 模拟 |
|---|---|
| 文件真的被写、测试真的被执行 | 模型回复是脚本化文本 |
| 会话隔离、run 状态机、权限判定、审计 | 用量数字（标 estimated，不与 provider 混算） |
| 交接包重新编译（不是复制聊天记录） | 「决策质量」——mock 不会真的做设计判断 |

### C.3 未验证的那一条

M12 验收要求「不同 Agent 真实调用模型」。本环境 `MARS_LLM_*` / `MARS_ANTHROPIC_*` 全部未设置，实际跑的是 mock。
**结论：`NOT RUN: credentials unavailable`。** 因此总体判定带 WARNINGS。

---

## D. REA 六套工作流验收

| 工作流 | 状态 | 实测 | 证据 |
|---|---|---|---|
| W-01 代码理解 | `PARTIAL` | 509 文件 / 207 md / 132 js / 49 测试；入口与 manifest 识别 | `docs/checks/m14/W-01/` |
| W-02 原生静态 | `PARTIAL` | `where.exe`：`pei-x86-64`、7 段、7 个导入 DLL、206 字符串、符号 0（已剥离） | `docs/checks/m14/W-02/` |
| W-03 APK | **`BLOCKED`** | 缺 jadx/java；仍给 ZIP 事实：2 dex、二进制 manifest、native 库、签名文件 | `docs/checks/m14/W-03/` |
| W-04 调用链 | `PARTIAL` | 12795 指令 → 92 推断边界 / 277 直接边 / 23 间接调用点未解析 | `docs/checks/m14/W-04/` |
| W-05 PCAP | `PARTIAL` | 合成样本 4 包：UDP 2 / TCP 2 / DNS 2 / HTTP 1；启发式触发 | `docs/checks/m14/W-05/` |
| W-06 Frida | **`BLOCKED`** | 缺 frida/adb；**无 execute 实现**，拒绝模拟 | `docs/checks/m14/W-06/` |

### D.1 可复核性

每次分析的 `evidence.json` 含：样本 SHA-256、工具版本与路径、argv 级命令、三步复核方法、限制清单。
`rea_runs` 表存 `sample_sha256` / `tool_versions_json` / `evidence_dir`，可用 `rds rea inspect` 反查。

### D.2 一个交叉验证

W-02 对 `C:\Windows\System32\where.exe` 算出 SHA-256 `f51fab8041e5023d…`，与 2026-11-01 的历史证据
`EV-20261101-006` **完全一致**。同一份样本、同一哈希，说明本轮分析对象与历史一致，不是换了个文件。

### D.3 明确不做的

- 不解密 TLS、不解析 SNI（W-05）
- 不解析间接调用目标（W-04）
- 不做反编译/类型恢复（W-02，需 Ghidra）
- 不做恶意判定（W-05 的 `heuristics` 是带阈值的启发式）

---

## E. 研发与 REA 联合案例

`docs/checks/m14/joint-demo.json`（`npm run demo:m15`）：

```
案例 A（binary_analysis）
  W-02=PARTIAL  W-04=PARTIAL
  样本 SHA-256 f51fab80…
  R4 审核 → SUCCEEDED，verdict = "审核通过：结论未超出证据范围"

案例 B（development）
  R1 → R2 → R3 → R4，4 步全 SUCCEEDED，3 次交接，4 个独立 session
  测试 before: pass=1  →  after: pass=1
  重构生效：true（src/cmd.js 出现 quote()，对外仍是 string）
```

关键点：R1 拿到的上下文是**经 R4 审核**的逆向结论摘要（含证据目录与哈希），不是原始 JSON，也不是未经验证的推断。

诚实标注：模型是 mock，重构代码是预置脚本，不是模型生成。

---

## F. 跨平台接入

| 适配器 | 协议 | 契约测试 | 真实调用 |
|---|---|---|---|
| `mock` | 确定性脚本 | 全链路（M12 19 例 + M15 联合） | —（本就是模拟） |
| `openai-compat` | Chat Completions | 4 例（形状/工具/用量/状态码） | **NOT RUN** |
| `anthropic` | Messages | 3 例（system/input_schema/tool_result/tool_use） | **NOT RUN** |

`rds agent providers` 可现场核对：

```
mock:ready  openai-compat:not_configured  anthropic:not_configured
```

**结论**：协议层已实现且被契约测试覆盖；**「两个平台的 Agent 真实交接」未执行**，因为没有任何平台凭据。不记为通过。

---

## G. 测试、CI、安装与部署

### G.1 测试

| 项 | 值 |
|---|---|
| 总数 | **290** |
| PASS / FAIL / SKIP | **290 / 0 / 0** |
| 本轮新增 | 62（M12 19、M13 16、M14 14、M15+M16 13） |
| 门禁 | `tests>0 && fail=0 && skipped=0`（`tooling/test-gate.mjs`） |

分布：arch 各文件 + phase1/2/3/4 + ledger + mcp。无 skip、无 mock 掉的关键路径。

### G.2 CI

**未运行（NOT RUN）**。CI 由 `push` 触发，本轮未获授权 push。
本地等价门禁全绿不等于 CI 通过——这一点不合并表述。

### G.3 干净克隆

```
HEAD=5a71cad  dirty=0  跟踪文件 455
doctor   status: ok (fail=0 warn=1 checks=11)   # warn 为源码树预期的 paths:docs
CONFIG PASS / LAYERS PASS (problems=0) / DOCS PASS
GATE PASS  tests=290 pass=290 fail=0 skipped=0
BASELINE PASS  7 个面均与基线一致
npm run demo:m12 → 修复生效 true
npm run demo:m15 → 重构生效 true
```

### G.4 独立安装

```
npm pack → 安装到临时前缀 → doctor: status ok (fail=0 warn=0 checks=11)
init / init-dev / project create                          全 exit=0
agent providers  → mock:ready openai-compat:not_configured anthropic:not_configured
agent create/start → status=SUCCEEDED kind=simulated tokens=188/22, 文件真的写入
run list → 1 条 SUCCEEDED
policy check --role R7 --action git.push → allowed=false
rea status → W-01+ W-02+ W-03- W-04+ W-05+ W-06-
rea run --workflow W-01 --path ./ws → PARTIAL, files=1
task types → 8
```

原始日志：`docs/checks/m12/install-flow.txt`

### G.5 安装验证抓到并修掉的 bug

`rds rea run --root <dir>` 会被当成安装根 → 契约加载失败 → 报
`ASSET_MISSING contract:memory … \ws\mars\contracts\memory.schema.json`。
错误信息把人引向完全错误的方向。修复：代码根改用 `--path`，并在 `createRuntime` 之前拦截 `--root`：

```
ERROR rea 的代码根请用 --path <dir>；--root 是安装根（会改变安装目录）   # exit 2
```

---

## H. 费用与资源

| 项 | 值 |
|---|---|
| 模型调用费用 | **0 元**（全程 mock，未发起任何付费 API 请求） |
| 网络访问 | 无（REA 分析为本地工具；provider 未配置故未联网） |
| 新增依赖 | **0 个**（`dependencies` / `devDependencies` 仍为空） |
| 磁盘 | 发行包 200 KB 级；证据目录百 KB 级 |
| 数据库 | 本机开发库 589,824 B → 迁移后新增 7 张表（只加表） |

---

## I. 安全、权限与风险

### I.1 已实现的边界

| 机制 | 强度 |
|---|---|
| 工具白名单（4 个，无 shell/网络/git） | 代码；「执行任意命令」在协议层无处表达 |
| 路径约束（realpath + 相对路径） | 代码；`../` 与绝对路径均拒 |
| 角色权限（含 `tool.*`） | 代码；逐次校验，拒绝也入 trace |
| 敏感动作矩阵 | 代码；`file.delete`/`git.push`/`release`/`network` **无任何角色拥有** |
| 凭据 | 只读环境变量；不进仓库、不进日志 |
| 样本 | 只读；SHA-256 入库 |
| W-06 授权 | 无 `--authorization` 直接拒绝 |

### I.2 明确不是边界的东西

1. **没有进程隔离**。同一 OS 用户换个 token 就能换角色。
2. **角色分工靠提示词 + 权限表**，不是沙箱；R1–R7 的"职责"是约定。
3. **不防护恶意模型输出**：模型可以要求写任意文件（限工作区内），系统只保证不越界、不执行命令。
4. **不防护供应链**：无依赖，但也未做自身完整性签名。

### I.3 风险清单

| 风险 | 等级 | 处置 |
|---|---|---|
| 真实 provider 未验证，接上后可能暴露协议差异 | 中 | 契约测试覆盖 5 处已知差异；接上后需一次真实冒烟 |
| 写操作重试可能重复写 | 中 | 已声明；写工具当前是幂等覆盖，风险有限 |
| 剥离二进制的函数边界是启发式 | 中 | 结果里写明规则与"不是符号" |
| 无并发调度，多任务只能串行 | 低 | 明确声明 |
| 本机库迁移后旧备份未清理 | 低 | 备份保留在 `D:/M1-migration/m12-backup/` |

---

## J. Git 状态与本地提交

| 项 | 值 |
|---|---|
| 分支 | `main` |
| 本轮起点 | `61590c7` |
| 本轮提交 | 6 个（见下表） |
| 相对 origin/main | **领先 11，落后 0**（含 M7–M11 的 5 个未推送提交） |
| 远程写操作 | **未执行** |
| 历史 Tag | 20 个，未动 |

| 提交 | 内容 |
|---|---|
| `b0b668f` | M12 执行层（21 文件，+3411/−20） |
| `6bd8efe` | M13 可靠调度（10 文件，+758/−30） |
| `96c289d` | M14 REA（35 文件，+4204/−8） |
| `c5c0d70` | M15 联合 |
| `5a71cad` | M16 适配器 |
| `<M17>` | M17 文档、验收报告、安装日志 |

受保护工作：49 项未跟踪文件逐字节未动（每次提交后核对）；本轮新增的报告与代码全部进 Git，不留散落文件。

---

## K. 未完成项与明确限制

| # | 项 | 状态 | 补齐需要什么 |
|---|---|---|---|
| 1 | 真实模型调用 | **NOT RUN** | 任一 provider 的 key + 一次冒烟 |
| 2 | 跨平台 Agent 交接 | **NOT RUN** | 两个平台凭据 |
| 3 | Linux / macOS 跑 M12–M17 | **NOT RUN** | 一台机器或一次 CI |
| 4 | 远程 CI | **NOT RUN** | push 授权 |
| 5 | W-03 完整分析 | **BLOCKED** | jadx + JDK **且需实现 execute** |
| 6 | W-06 动态分析 | **BLOCKED** | frida + adb + 授权设备 **且需实现 execute** |
| 7 | 流式输出 | 未实现 | 端口扩展 + 适配器实现 |
| 8 | 会话恢复 | 未实现 | provider 侧会话持久化 |
| 9 | 并发调度 | 未实现 | 队列 + 调度器 + 冲突解决 |
| 10 | 语义摘要压缩 | 未实现 | 需要模型或规则化摘要 |
| 11 | 进程级隔离 | 不做 | 与本地优先冲突 |
| 12 | Web 工作台 | 未做 | 需先有稳定的读模型 API |

---

## L. 远程 Push 与 CI 验证方案

### L.1 推送前检查（已做）

```bash
git rev-list --left-right --count origin/main...main   # 0  11（本地领先 11，无落后）
git status --porcelain -uall                            # 仅 49 项受保护工作
```

### L.2 推送步骤（需用户授权后执行）

```bash
# 1. 再确认一次远程没有新提交（避免非快进）
git fetch origin && git rev-list --left-right --count origin/main...main

# 2. 快进推送（不 force）
git push origin main

# 3. 观察 CI
gh run watch          # 或打开 https://github.com/LNiiuu/rds-mother-system/actions
```

### L.3 预计 CI 行为

| job | 预期 | 说明 |
|---|---|---|
| `required` × 4（Win/Ubuntu × Node 22/24） | 应通过 | 290 例在 Windows 通过；Ubuntu 有 binutils，REA 测试不依赖 jadx/frida |
| `structure self-check` | 应通过 | 项目名检查：本轮新增文档无项目名 |
| `g1` | 应通过 | 未改 git-review 逻辑 |
| `macos` | **可能失败** | 本轮新增代码未在 macOS 跑过；`fs-tool-executor` 的 `node --test` 调用与路径处理是主要风险点 |

### L.4 若 CI 失败

1. 先看 `步骤摘要`（M6 起 macos job 会把 TAP 摘要写进 step summary）
2. 本地用同样的 Node 版本复现：`nvm use 22 && npm test`
3. 跨平台差异优先怀疑：路径分隔符、`fs.realpath` 行为、`node --test` 参数
4. 修复后**追加提交**，不改历史、不 force push

### L.5 不建议现在做的事

- 不要给 M12–M17 打正式 Tag：CI 未验证前，Tag 会变成"看起来已验证"的假信号
- 不要发布 npm：`0.1.0` 从未在真实环境装过第三方项目
