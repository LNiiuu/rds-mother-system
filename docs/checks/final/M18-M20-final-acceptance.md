# M18–M20 最终验收报告

**日期**：2026-11-13（+08:00）
**范围**：M18 多 Agent 混合编排 / M19 REA 工具集成 / M20 Development + REA 联合场景
**起点**：`06b2a29`（M9–M17 末次提交）
**撰写时 HEAD**：`6dcf565`（领先 `origin/main` 18 个提交）
**总体判定**：**`PARTIAL`**
**远程写入**：**未执行**。本轮只做本地提交，Push / PR / Merge / Release / Tag 推送全部未做。

> 本报告只写实际执行过的结果。`PASS` 必须有本机输出；工具或凭据缺失一律 `BLOCKED`；
> 只完成一部分的写 `PARTIAL`；没跑的写 `NOT RUN`。mock 不计入真实模型能力。

---

## A. 总体结果

| 阶段 | 判定 | 依据 | 主要缺口 |
|---|---|---|---|
| M18 | **`PARTIAL`** | 调度器、依赖 DAG、并发、冲突、恢复、成本账本真实执行 | **T18-01 真实模型调用 BLOCKED**（无凭据） |
| M19 | **`PARTIAL`** | 统一工具层 + W-01/W-02/W-04 真实工具输出 | Ghidra / JADX / TShark / Frida 未安装；W-03/W-06 BLOCKED |
| M20 | **`PARTIAL`** | 真实 REA + 真实调度/文件/证据链跑通 | 多 Agent 的模型仍是 mock；T20-02 BLOCKED |
| **整体** | **`PARTIAL`** | 工程链路真实可复现，真实模型与四项专业工具未验证 | 见 §G |

**为什么不是 `COMPLETED`**：M18 的验收第一条要求“至少一个真实 Provider 成功”，本机没有任何
Provider 凭据，也没有本地模型；M19 的六条工作流里有四条缺工具；M20 的“多个真实 Agent”依赖前两者。
把 mock 或“能构造命令”写成 PASS 会直接造假，因此整体只能 `PARTIAL`。

---

## B. 多 Agent 能力

### B.1 R0–R7 角色（以仓库原始定义为准）

来源：`core/roles/roster.md`、`core/roles/r0..r7-*.md`、`mars/config/role-routing.json`；
代码权限表在 `mars/src/collab.js`。

| 角色 | 原始名称 | 原始职责 | 当前实现 | 缺口 |
|---|---|---|---|---|
| R0 | 总控 | 拆解、派发、汇总、越界审计、对外汇报 | Agent 实例 + 任务编排 + 汇总 job | 拆解由计划 JSON/调用方给出，不是模型自主拆解 |
| R1 | 架构 | 需求分析、方案、影响面、风险、备选 | Agent 实例；设计 job 写设计文件 | 原始定义偏只读，代码允许 `write_file`，靠 `writable_paths` 收窄 |
| R2 | 实现 | 按任务卡实现、自测、变更清单 | Agent 实例 + 写文件/跑测试 | 无 Git diff 审查；变更清单来自工作区快照 |
| R3 | 验证 | 独立测试、回归、边界、数据安全 | Agent 实例 + `run_test` | 只跑 `node --test`；无跨语言测试 |
| R4 | 审查 | 独立复核证据、裁决冲突、准入门 | Agent 实例；审查 job 读报告与证据 | 本轮审查是 mock 决策，不是独立模型/人审 |
| R5 | 研究 | 多方向调研、竞品/协议/算法 | Agent 实例；只读 job | 无联网检索工具；只能读本地证据 |
| R6 | 逆向/安全 | 二进制/APK/流量/运行时分析 | Agent 实例 + REA 工作流（runner 调用） | 模型不直接调用工具；工具由编排层执行 |
| R7 | 发布/运维 | 构建、发布准备、回滚、备份 | 权限表存在 | 未建 R7 实例；发布动作不在工具面内 |

角色定义未被改写；M18 只增加实例化、调度与写路径约束。

### B.2 独立实例与会话

`docs/checks/m18/execution-record.json`（演示库实测）：

| 计划 | job 数 | run 数 | 不同 session 数 |
|---|---:|---:|---:|
| serial | 3 | 3 | **3** |
| parallel | 3 | 3 | **3** |
| hybrid | 7 | 7 | **7** |
| conflict | 2 | 2 | **2** |

每个 job 有独立 `agent_run`、`session`、上下文包 `packet_id`、工作区（copy 模式）与用量记录。
这证明的是**执行层隔离**，不是“不同模型人格”；模型文本仍来自确定性脚本。

### B.3 真实 Provider 调用

| 项 | 结果 | 说明 |
|---|---|---|
| OpenAI-compatible 调用路径 | 代码真实 | `POST {base}/chat/completions`、Bearer、tools/tool_calls、usage、AbortController |
| Anthropic 调用路径 | 代码真实 | `POST {base}/v1/messages`、`x-api-key`、`anthropic-version`、tool_use/tool_result |
| 真实网络调用 | **NOT RUN** | `MARS_LLM_*`、`MARS_ANTHROPIC_*` 全部未设置；本地 11434 无服务 |
| 多轮工具循环 | 契约测试 PASS | 第二轮不再重复 system/user；OpenAI 4 条、Anthropic 3 条 |
| 真实 4 Agent 链 | **BLOCKED** | 依赖真实凭据 |

本轮修复了一个真实缺陷：旧 Provider 把 Runtime 每轮传入的完整 `messages` 再追加到 session，
第二轮请求出现重复的 `system/user`，重试会继续膨胀。修复后适配器不再累计历史，历史只由 Runtime 提供；
新增 2 个契约测试锁住该行为。

### B.4 三种协作模式

| 模式 | 结果 | 证据 |
|---|---|---|
| Serial | **PASS** | design→impl→verify：`SUCCEEDED`；R2 的 `write_file` 改了 `src/sum.js`；R3 的 `run_test` 返回 `tests=1 pass=1 fail=0` |
| Parallel | **PASS** | 3 个 job 同时 RUNNING，`overlapping_pairs=3`（两两重叠），`max_concurrency=3` |
| Hybrid | **PASS** | 7 个 job：R1 串行准备 → R2/R5/R6 并发 → R3 验证 → R4 审查 → R0 汇总；plan `SUCCEEDED`，`merge_status=CLEAN` |

并发是**单进程事件循环内的真实时间重叠**：三个 run 的 `started_at` 落在同一秒，
`finished_at` 晚于其他 job 的 `started_at`。不是“同时创建任务”，也不是多进程/分布式调度。

### B.5 并发安全

- 工作区：`shared`（串行/单写者）、`copy`（默认并发）、`worktree`（基于 HEAD，失败降级 copy）。
- 写边界：job 的 `writable_paths` 注入执行器；越界返回 `TOOL_PATH_DENIED`。
- 冲突：两个 job 改同一文件，先合并者成功，后者 `BLOCKED / MERGE_CONFLICT`（`DUPLICATE_PATH`），
  不写任何冲突文件，base 保留第一个值。
- 锁：隔离 job 用 `lockScope=workspace` + `lockTarget=<workspace>`，不再被项目级锁串行化；
  共享工作区仍用 `*`。
- 跨进程竞争：`INSERT OR IGNORE` + 重查收敛，不再把 `SQLITE_CONSTRAINT` 抛给上层。
- 锁续期：TTL 不随心跳自动延长；每轮心跳后按同一 `run_id` 续期，续不上则 `FAILED / WORKSPACE_LOCK_LOST`，
  避免长 run 过期后被第二个写者进入。

### B.6 故障恢复

| 故障 | 行为 | 证据 |
|---|---|---|
| Provider 5xx/不可达/超时 | Runtime 单次重试 + 调度级 `max_attempts` | `reliability.test.js` 16 例 |
| job 超时 | run `TIMEOUT` → job `FAILED/RUN_TIMEOUT`，可重试则重试 | 调度器 + runtime 检查点 |
| 心跳陈旧 | `recover` 把 run 标 `FAILED/AGENT_LOST`，job 回 `READY` 或 `FAILED` | `recovery.recovered=[{action:REQUEUE}]` |
| 取消 | READY/WAITING 立即 `CANCELLED`；RUNNING 下一检查点收敛 | `cancel-job` |
| 依赖失败 | 下游 `BLOCKED/DEPENDENCY_FAILED` | `promoteReady` |
| 合并冲突 | job `BLOCKED/MERGE_CONFLICT`，plan `PARTIAL` | conflict 计划 |

### B.7 成本

| 计划 | runs | calls | input | output | usage source |
|---|---:|---:|---:|---:|---|
| serial | 3 | 6 | 141 | 15 | estimated ×3 |
| parallel | 3 | 6 | 102 | 15 | estimated ×3 |
| hybrid | 7 | 15 | 307 | 48 | estimated ×7 |
| conflict | 2 | 4 | 62 | 8 | estimated ×2 |

全部为 `estimated`，`provider=0`、`unknown=0`；**没有真实 token 计费，也没有费用金额**。
项目预算拒绝已修为 `FAILED / PROJECT_BUDGET_EXCEEDED`，不再留下 `PENDING` run。

---

## C. REA 能力

工具检测（`rds rea tools` 与 `docs/checks/m19/execution-record.json` 同源）：

| 工具 | 安装 | 版本 | 真实执行 | 用于 |
|---|---|---|---|---|
| objdump | 是 | GNU Binutils 2.39 | 是 | W-02 结构/导入/符号、W-04 反汇编 |
| Ghidra / analyzeHeadless | **否** | — | 否 | W-02 反编译（BLOCKED 原因） |
| jadx / java / apktool | **否** | — | 否 | W-03 反编译（BLOCKED 原因） |
| tshark | **否** | — | 否 | W-05 交叉核验（可选） |
| frida / adb | **否** | — | 否 | W-06 动态插桩（BLOCKED 原因） |

| 工作流 | 工具安装 | 样本 | 真实执行 | 结果 | 证据 | 状态 |
|---|---|---|---|---|---|---|
| W-01 代码理解 | 内置 fs | 本仓库 | 是 | 584 文件 / 146 依赖节点 / 376 边 / 100 符号 / 54 测试文件 | `m19/W-01/` | **PARTIAL**（依赖图为正则推断，无 AST） |
| W-02 二进制 | objdump | `%SystemRoot%\System32\where.exe` | 是（objdump） | 7 段 / 7 导入 DLL / 206 字符串 / 0 符号；SHA-256 `f51fab80…fa29` | `m19/W-02/` | **PARTIAL**（Ghidra 缺失，无反编译） |
| W-03 APK | **缺 jadx** | 合成 ZIP 容器 | 否（仅 ZIP 事实层） | 7 条目 / 2 dex / native 库 / 签名文件 | `m19/W-03/` | **BLOCKED**（`TOOL_MISSING:jadx`） |
| W-04 调用链 | objdump | 同 W-02 样本 | 是 | 12,795 指令 / 92 推断函数 / 277 直接边 / 23 间接调用点 | `m19/W-04/` | **PARTIAL**（间接目标未解析） |
| W-05 PCAP | 内置 libpcap 解析；tshark 缺 | `tooling/make-pcap-fixture.cjs` 合成 4 包 | 是（内置解析） | UDP 2 / TCP 2 / DNS 2 / HTTP 1 | `m19/W-05/` | **PARTIAL**（无 TCP 重组/TLS 解密） |
| W-06 Frida | **缺 frida/adb** | 无授权设备 | 否 | preflight 拒绝，无可执行入口 | `m19/W-06/` | **BLOCKED**（`TOOL_MISSING:frida`） |

**事实/推断分层**：W-02 的段表、导入、字符串是工具事实；字符串分类是正则推断；反编译与运行时行为
未验证。W-04 的函数边界是“入口 + 调用目标 + 符号”的启发式，不是编译器符号。W-05 的启发式不是恶意判定。

**安全边界**：样本只读、SHA-256、临时目录、`execFile` 超时 120 s、输出上限 24 MB、argv 不经 shell；
**没有容器/OS 隔离**，不能当作恶意样本沙箱。

---

## D. 联合工作流

`docs/checks/m20/execution-record.json`：

- 计划 `plan18dc9c2820cb`：mode=`hybrid`，status=`SUCCEEDED`，merge=`CLEAN`。
- 6 个 job 全部 `SUCCEEDED`：design(R1) → research(R5)/security(R6) 并发 → report(R2) → review(R4) → final(R0)。
- REA：W-01 / W-02 / W-04 真实执行；W-03 因缺 jadx `BLOCKED`，只保留 ZIP 事实。
- 产物：`JOINT-PLAN.md`、`JOINT-REPORT.md`、`evidence/SUMMARY.md` 均存在；R2 的报告经受控合并写回 base。
- 用量：6 runs / 13 calls / input 1,166 / output 56（全部 estimated）。
- 证据链：样本哈希、工具版本、argv、限制、报告与执行记录可互相回溯。

**真实与模拟的边界**：文件写入、测试执行、SQLite、调度、合并、REA 工具调用是真实的；
Agent 的模型文本与“审查判断”是 mock 脚本。因此 T20-02（多个真实 Agent）`BLOCKED`，
T20-01（模型自主拆解）与 T20-07（独立模型审查）只能 `PARTIAL`。

---

## E. 测试结果

### E.1 全量

| 指标 | 数值 |
|---|---|
| 测试总数 | **302** |
| PASS | **302** |
| FAIL | 0 |
| SKIP | 0 |
| 本轮新增 | 12（调度 6、锁续期 1、Provider 多轮 2、工具适配 3） |

命令：`npm test`（`node --test mars/tests`）。本文件落盘后复跑为 301/301；
补锁续期测试后最终为 **302/302**。

### E.2 验收项的四值统计

| 值 | 数量 | 项 |
|---|---:|---|
| PASS | 17 | T18-02/03/04/05/06/07/08/10；T19-01/08/09；T20-03/04/05/06/09/10 |
| PARTIAL | 6 | T18-09；T19-04/07；T20-01/07/08 |
| BLOCKED | 6 | T18-01；T19-02/03/05/06；T20-02 |
| NOT RUN | 3 | 远程 CI、macOS、真实 Provider 多 Agent 链 |

`BLOCKED` / `NOT RUN` 不计入 PASS。M19 的 T19-01 为 PASS（真实仓库扫描），
但 W-01 工作流整体仍标 `PARTIAL`（依赖图能力不完整），两者不矛盾：前者是“真实执行”，后者是“能力完整度”。

### E.3 其他门禁

| 门禁 | 结果 |
|---|---|
| `npm run layers` | PASS（域层不依赖 fs/child_process/env） |
| `npm run docs:check` | PASS（本文件落盘后） |
| `npm run config` | PASS |
| `npm run baseline` | PASS（新文件已登记 `approved-additions.json`） |
| `npm run pack:check` | PASS（144 文件 / 224.9 kB packed / 682.3 kB unpacked） |
| `git diff --check` | 本轮新增/修改文件无空白错误；受保护的 M9–M11 工作区版本有既存行尾空格（未改动） |

---

## F. Git 状态

**快照时间**：2026-11-13 23:0x（+08:00），撰写时 HEAD `6dcf565`。

| 项 | 值 |
|---|---|
| 分支 | `main` |
| HEAD（快照） | `6dcf565` |
| origin/main | `ada7848` |
| 领先 / 落后 | **18 / 0**（快照）→ **20 / 0**（本报告所在提交） |
| merge commit | 0（线性历史） |
| Tag | 20 个，全部在 `origin/main` 历史内；无 Tag 指向新提交 |
| 暂存区 | 空（提交后） |
| 未提交 | 50 项受保护工作 + 1 份上一轮独立审计报告（未跟踪） |

**50 项受保护工作**：49 项未跟踪 + 1 项已跟踪格式化修改（`M9-M11-final-acceptance.md`）。
对 `<LOCAL_BASELINE>` 逐字节复核 **50/50 一致**；49 项未跟踪文件没有进入任何提交。
唯一路径相交的 M9–M11 报告：提交的是 7,869 B 未格式化版本，工作区 11,308 B 受保护版本未被提交。

**提交内容边界**：

- 快照 18 个 = M7–M17 的 14 个 + 本轮 M18–M20 的 4 个；收尾再加 2 个（锁续期、验收文档），最终 **20 个**；无 merge，线性历史。
- 新增代码集中在 `mars/src/runtime/scheduler.js`、`mars/src/adapters/fs-workspaces.js`、
  `mars/src/adapters/rea/tool-registry.js`，以及既有 Provider/锁/预算/CLI 的小改。
- 未修改数据库迁移历史：Schema v7→v8 只 `CREATE TABLE IF NOT EXISTS`，不重写旧表。
- 未删除、未覆盖任何用户数据。

**敏感信息**：

- 未发现 API key、私钥、`ghp_`/`AKIA`/`sk-ant-` 等真实令牌；未发现邮箱/手机号。
- **已修复**：本轮 4 个提交的 M18/M19 证据里含 7 处 Windows 临时绝对路径
  （`C:\Users\<user>\AppData\Local\Temp\...`）与 2 处 `<LOCAL_BASELINE>` 路径，
  已在后续提交替换为 `<TEMP>` / `<LOCAL_BASELINE>`；JSON 仍可解析，数字未变。
- **残留**：M12–M15 的 9 个历史证据文件（`m12/demo-chain.json`、`m12/M12-0-baseline-audit.md`、
  `m14/W-03/*`、`m14/W-05/*`、`m14/joint-demo.json`）与 `m12/install-flow.txt` 的旧 blob，
  仍含本机临时路径或 `D:/M1-migration/...`。它们属前 14 个提交的历史证据，未改写以避免变更证据内容；
  不含密钥、账号或个人数据。
- `docs/checks/m12/install-flow.txt` 另有一处 `ASSET_MISSING` 是**修复前复现**，已在文件内标注。

**Fast-forward 条件**：`git merge-base origin/main HEAD = ada7848`，`0 behind`，远程 `refs/heads/main`
在审计开始时实时读取为 `ada7848`。**技术上满足 fast-forward**。
注意：收尾时两次 `git ls-remote` 均因 `schannel: server closed abruptly` 失败，未能再次实时确认；
Push 前应重新执行一次只读查询。内容上是否 Push 由 §H 决定。

---

## G. 剩余问题

### 已完成

- 单进程多 Agent 调度：DAG、优先级、`max_concurrency`、重试、取消、恢复、结果收集。
- 工作区隔离（shared/copy/worktree）、任务级写路径、冲突检测、受控合并。
- Provider 多轮历史去重；锁跨进程竞态收敛；预算拒绝不再留 PENDING。
- REA 统一工具层与六套工作流的四值状态；W-01 依赖图/符号；W-02/W-05 可选工具探测。
- M20 联合场景与完整证据链；全量 302 测试与五道门禁。

### 部分完成

- 真实模型接入：代码路径完整，**无凭据，未发过一次真实请求**。
- W-01：有依赖图与符号，但无 AST/类型解析。
- W-02/W-04：只有 objdump 级事实，无反编译、无间接调用解析。
- W-05：只有内置解析器与合成样本，无 TShark、无真实流量。
- 安全隔离：有只读/哈希/超时/输出上限，无容器或 OS 级隔离。
- 成本：有估算用量与预算门，无真实 token 计费与金额。

### 被阻塞

- T18-01 / T20-02：无任何 Provider 凭据，未注册账号、未购买服务。
- T19-02：Ghidra / analyzeHeadless 未安装。
- T19-03：jadx / java / apktool 未安装。
- T19-05：tshark 未安装。
- T19-06：frida / adb 未安装，且无授权测试设备。

### 未执行

- 远程 CI；Linux/macOS 全量回归；真实 Provider 的多 Agent 链；真实 APK/PCAP/设备样本。

### 代码审计发现（2026-11-13）

| 检查项 | 结论 |
|---|---|
| 重复实现 | `rds agent chain`（串行）与 `rds orchestrate`（DAG）并存，入口不同、未合并；调度逻辑本身无第二份 |
| 未接入代码 | `policy.check` 只被 `rds policy` 查询调用，Runtime 不调用；因为工具面没有敏感动作，不构成绕过，但**不能宣传为运行时策略引擎** |
| 资源清理 | `workspace.cleanup()` 未被 scheduler 调用；copy 工作区保留在临时目录以便事后合并/审计，会累积磁盘占用，需人工清理 |
| 危险默认 | `workspace.merge` 默认 `apply=true`（scheduler 依赖）；`mergePlan` 默认 dry-run（`apply=false`）。两者语义不同，已在文档写明 |
| 状态转换 | plan 终态短路；job 重试期间保持 `RUNNING` 并记录 attempt；`recover` 只处理 RUNNING + 陈旧心跳；未发现非法转换 |
| 并发竞态 | 同一 plan 被两个进程同时 `executePlan` 没有租约/抢占，可能双调度；已列为限制，未修 |
| 数据安全 | 合并先校验后写；冲突 job 不写，但已成功合并的其他 job 不回滚；删除一律冲突，不自动删 |
| 未处理异常 | job 级 try/catch 覆盖 prepare/run/merge；`executePlan` 顶层异常由 CLI 捕获；仅“取消时 run 已结束”的 catch 是有意忽略 |
| 迁移兼容 | v7→v8 只 `CREATE TABLE IF NOT EXISTS`，旧库打开时幂等建表；未做“旧库升级回放”自动测试 |
| 测试遗漏 | 无真实 Provider、无真实专业工具、无跨进程并发、无同 plan 双调度测试；均已标 `NOT RUN`/`BLOCKED` |

### 需要用户决策

1. 是否提供真实模型凭据（或允许接本地模型），以完成 T18-01 / T20-02。
2. 是否安装 Ghidra / JADX / TShark / Frida，并准备授权测试设备与样本。
3. 是否接受“当前能力边界”直接 Push，还是先补上述真实调用再 Push。

---

## H. 最终建议

1. **是否达到本轮工程目标？**
   工程目标中的“调度、隔离、并发、冲突、恢复、工具适配、证据链”已达到；
   “真实模型多 Agent 协作”和“四类专业工具真实执行”未达到。**整体 `PARTIAL`，不是完成。**
2. **是否可以进入 GitHub 提交审批？**
   **可以进入审批**，但审批材料必须按本报告的 `PARTIAL` 口径，而不是“全部完成”。
3. **是否存在必须先解决的阻塞项？**
   代码层面没有阻断 Push 的缺陷；**报告口径**必须先统一（§7 勘误已写入本文件与两份旧报告的顶部声明）。
   若坚持声称 M12/M13 `COMPLETED` 或“真实多 Agent 已验证”，则必须先补真实调用，不能只改文字。
4. **是否有尚未纳入提交的工作？**
   有：50 项受保护工作（49 未跟踪 + 1 格式化修改）与上一轮 `pre-push-independent-audit.md`。
   除这份审计报告外，均不属于 M18–M20，**不应混入提交**。
5. **如果现在 Push，可能产生什么影响？**
   - 技术上是一次 fast-forward，不会覆盖远程已有提交；
   - 公开仓库会新增本轮的调度器、REA 工具层与证据；不含密钥；
   - 仍会公开 `PARTIAL` 的真实边界（无真实模型、四项工具 BLOCKED）；
   - 若未来补上凭据/工具，应新增提交与证据，不要改写已推送历史。

**结论：技术 FF 成立；内容口径已校正；建议由用户审批后再 Push。**

---

## 7. 对 M9–M17 报告的勘误

以下判定在 M12–M17 时点成立或表述不严谨，现以本报告为准。两份旧报告顶部已加“已被取代”声明。

| # | 位置 | 旧表述 | 更正 |
|---|---|---|---|
| 1 | `final/RDS-MARS-final-acceptance.md` 状态表 M12 行 | M12 `COMPLETED` | `COMPLETED WITH WARNINGS`：执行层完成，真实模型未验证；多轮历史缺陷已于 M18 修复 |
| 2 | 同上 M13 行；`M12-M17-closure.md` 判定表；`checks/README.md` | M13 `COMPLETED` | **`PARTIAL`（当时点）**：有锁/重试/心跳/预算，**没有并发调度器**；并发由 M18 补齐 |
| 3 | `final/RDS-MARS-final-acceptance.md` Git 段 | “领先 11，落后 0” | 截至 `1db2319` 为 11；截至 `06b2a29` 为 14；撰写本报告时 18，最终 **20** |
| 4 | 同上受保护工作段 | “49 项受保护工作” | **50 项 = 49 未跟踪 + 1 已跟踪格式化修改** |
| 5 | 同上提交表 | 提交表 7 条 | 补 `eb76946`、`06b2a29`；完整列表以 `git log origin/main..HEAD` 为准 |
| 6 | `final/RDS-MARS-final-acceptance.md` F 节 | “跨平台接入 / 两个平台” | 实为**第二个模型 Provider 协议**（Anthropic），不是 Work 平台适配器；无第二平台会话证据 |
| 7 | `M12-M17-closure.md` M16 段 | “7 例契约测试” | 实为 **6 个 `test()`**（OpenAI 3、Anthropic 2、能力清单 1）；M18 新增 2 个多轮测试后为 8 |
| 8 | `m14/W-01/result.json`、`m14/W-02/result.json` | `status: PASS` | 与报告/`docs/rea.md` 的 `PARTIAL` 冲突；M19 已重跑为 `PARTIAL`，旧快照仅作历史 |
| 9 | `m19/*` 早期文档 | W-01 “551 文件 / 374 边” | 复跑为 **584 文件 / 376 边**（随工作区文件变化）；已更正 |
| 10 | `docs/rea.md` W-01 行 | W-01 “未做模块依赖图与符号搜索” | M19 已提供静态依赖图与符号；仍无 AST/类型解析 |

---

## 8. 证据索引

| 内容 | 路径 |
|---|---|
| M18 架构/Schema v8 | `docs/checks/m18/architecture.md` |
| M18 Provider | `docs/checks/m18/provider-verification.md` |
| M18 隔离 | `docs/checks/m18/agent-isolation.md` |
| M18 调度 | `docs/checks/m18/scheduling-verification.md` |
| M18 并发 | `docs/checks/m18/concurrency-verification.md` |
| M18 恢复 | `docs/checks/m18/recovery-verification.md` |
| M18 成本 | `docs/checks/m18/cost-verification.md` |
| M18 原始记录 | `docs/checks/m18/execution-record.json` |
| M19 工具层 | `docs/checks/m19/tool-adapter-architecture.md` |
| M19 六套工作流 | `docs/checks/m19/W-01/` … `W-06/`（result/report/evidence/execution.log） |
| M19 安全 | `docs/checks/m19/security-verification.md` |
| M19 证据模型 | `docs/checks/m19/evidence-model.md` |
| M20 场景/报告/验收 | `docs/checks/m20/scenario.md`、`final-report.md`、`final-acceptance.md` |
| M20 原始记录 | `docs/checks/m20/execution-record.json`、`evidence/` |
| 基线审计 | `docs/checks/m18-m20/baseline-audit.md` |
| 上一轮独立审计 | `docs/checks/final/pre-push-independent-audit.md` |

**复现命令**：

```bash
npm test
npm run layers && npm run docs:check && npm run config && npm run baseline && npm run pack:check
node tooling/m18-orchestration-demo.cjs
node tooling/m19-rea-evidence.cjs
node tooling/m20-joint-demo.cjs
```
