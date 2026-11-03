# MARS Phase 2 · 第二轮独立复审（R4）

- 复审日期：2026-11-03
- 复审对象：`D:\M1\mars`（Phase 2：DSH MCP 接入、G1–G4）
- 上一轮报告：`docs/phase2-review.md`（总体 PARTIAL；0 blocker / 0 high / 5 medium / 9 low；56/56 测试）
- 本轮触发：R0 声称已修复 F-01…F-09 并更新文档。本报告不复用其自述，全部结论来自源码、测试、数据库、会话账本与真实 MCP 调用的独立复核。
- 约束：未改任何代码/配置/数据库；未做 git 写操作；未打印 token 明文。本轮唯一写入即本文件。

## 1. 复审方法与命令

### 1.1 源码与文档

逐行读取（未借助实现者摘要）：

- `src/mcp-stdio.js`（378 行；工具定义、`validateToolArgs`、`callTool`、审计边界）
- `src/store.js`（193 行；`propose`/`review`/`canRead`/`list`/`get`）
- `src/authz.js`、`src/cli.js`、`src/ledger.js`、`src/retrieval.js`（涉及处）
- `contracts/memory.schema.json`、`config/role-routing.json`、`config/principals.json`（仅结构，不看 token 哈希值之外的敏感内容）
- `tests/phase2/mcp-stdio.test.js` 及既有 phase1/ledger/mcp 测试
- Phase 2 文档：`mcp-access.md`、`phase2-g1-security-report.md`、`phase2-g2-runs.md`、`phase2-g3-workflow.md`、`phase2-g4-ab-report.md`、`README.md`

### 1.2 测试

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe' --test `
  D:\M1\mars\tests\ledger\ledger.test.js D:\M1\mars\tests\mcp\mcp.test.js `
  D:\M1\mars\tests\phase1\authz.test.js D:\M1\mars\tests\phase1\budget.test.js `
  D:\M1\mars\tests\phase1\ledger-reconcile.test.js D:\M1\mars\tests\phase1\lifecycle.test.js `
  D:\M1\mars\tests\phase1\manifest.test.js D:\M1\mars\tests\phase1\mcp-server.test.js `
  D:\M1\mars\tests\phase1\remediation.test.js D:\M1\mars\tests\phase1\retrieval.test.js `
  D:\M1\mars\tests\phase1\rollback-offline.test.js D:\M1\mars\tests\phase2\mcp-stdio.test.js
```

结果：**tests 60 / pass 60 / fail 0 / cancelled 0 / skipped 0，exit 0（1755.97 ms）**。

### 1.3 真实 MCP 进程探测

经 `mcp_load` 加载 `mars-r0`、`mars-r2` 后调用真实 stdio 服务（非离线 harness）：

| 调用 | 结果 |
|---|---|
| `mars-r0 memory_list {project_id:'rds-m1', status:'bogus'}` | `INVALID_ARGUMENT`：`status must be one of proposed/approved/rejected/superseded/deprecated` |
| `mars-r0 memory_list {project_id:'rds-m1', token:'BOGUS'}` | `INVALID_ARGUMENT`：`unexpected field: token` |
| `mars-r0 memory_list {project_id:'rds-m1', limit:9999}` | `INVALID_ARGUMENT`：`limit must be an integer 1..200` |
| `mars-r2 memory_list {project_id:'xingrixiao'}`（跨项目） | `PROJECT_DENIED` |
| `mars-r2 memory_propose L3`（无 source_version） | `SOURCE_VERSION_REQUIRED` |
| `mars-r2 memory_propose L3`（带 source_version v0.1） | `ROLE_TYPE_DENIED`；memories 计数保持 9，未插入 |
| `mars-r2 memory_get mem_0db463660da4` | `ok`（R2 可读该 L3 项目可见记忆；说明 L3 仅约束 propose/路由，不约束 `memory_get`） |

探测产生 4 条审计（见 §4/N-01），但 3 次 `INVALID_ARGUMENT` + 1 次 `PROJECT_DENIED` **没有**审计记录。

### 1.4 数据库只读核对

`D:\M1\mars\var\mars.db` 以 readonly 方式读取（better-sqlite3，未写库）。探测前后：

- `memories` 9（8 approved + 1 proposed）、`manifests` 22、`audit` 188→192、`aliases` 0。
- `audit` 列：`audit_id, ts, principal_id, project_id, role_id, action, target, result, reason`。
- `manifests` 列：`manifest_id, project_id, task_id, role_id, run_id, session_id, created_at, token_budget, tokens_estimated, entries_json, fragments_json`——**没有 `packet_id` 列**，文档中的 `pkt_*` 无法从库中直接核对，只能核对 manifest。
- G2 的 6 条 manifest 全部存在且 role/token 与报告一致（`man_5c8fcae8eb4b` R0/357、`man_1dda2266ed88` R0/333、`man_e3d4b6c08872` R1/359、`man_4de1dfbfdc04` R2/201、`man_00b7f697b6b9` R3/431、`man_3116d304e49d` R4/358）。

### 1.5 G4 复算

用 `src/ledger.js` 的 `parseSession()` 直接读取 6 个 `session.v4.jsonl.zstd`（`C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\<id>\`），逐项复算 usage（见附录 B）。

### 1.6 关闭脚本

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\M1\mars\scripts\mars-mcp-disable.ps1 -WhatIf
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\M1\mars\scripts\mars-mcp-disable.ps1 -Yes -WhatIf
```

`-WhatIf`：`registry entries: 6; mars entries: 5; will remove: 5`，`WHATIF: no write`，exit 0。
`-Yes -WhatIf`：ShouldProcess 返回 false → `ABORTED`，exit 0。
执行前后 registry SHA-256 均为 `E10F7849…18E9F`，未变化。

### 1.7 Git 边界

`git.exe` 不在 PATH，使用 WSL git 直接调用（不经 shell，避免引号污染）：

```powershell
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/M1 status --porcelain -uall -- mars
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/M1 ls-files mars
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/M1 log --all --oneline -- mars
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/M1 check-ignore -v -- mars/var/mcp/tokens/R0.token mars/config/principals.json mars/var/mars.db
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/Projects/xingrixiao status --porcelain -uall
wsl.exe -d Ubuntu-24.04 -- git -C /mnt/d/Projects/xingrixiao diff
```

## 2. 结论摘要

- **F-01…F-09 关闭 8/9**：F-01～F-08 已关闭；**F-09 未关闭**（`memory_stats` 仍为项目级全量计数）。
- 上一轮 5 个 medium（F-01～F-05）全部关闭，0 blocker / 0 high 维持。
- 测试 **60/60 PASS**；新增 `tests/phase2/mcp-stdio.test.js` 4 例真实覆盖 F-02/F-03/F-04/F-07。
- 本轮新发现 **7 个 low，0 medium/high**：审计缺口、成功调用双审计、类型门 opt-in、G1/G2/G3 文档漂移、propose schema 少 required 字段。
- G 门槛复核：**G1 PASS（有条件）、G2 PASS（受控范围）、G3 PASS（单样本）、G4 PARTIAL**。
- **总体：PARTIAL**。具备“有条件验收”条件，不具备无条件 PASS；条件见 §7。

## 3. F-01～F-09 逐项核验

| ID | 原发现（severity） | 独立核验证据 | 判定 |
|---|---|---|---|
| **F-01** | 文档称 `mcp-stdio.js` 需 `--enable`，实际无此开关；G1 报告称“进程级默认禁用”（medium） | `docs/mcp-access.md:103` 已改为准确口径：“MCP 服务本身**没有** `--enable` 开关；未注册即不存在，‘默认关闭’指默认不注册 + 每实例 token/角色绑定；`cli.js mcp` 的 `--enable` 只针对旧版离线网关”。`phase2-g1-security-report.md:74`（§6.1）已删除“MCP 服务需 `--enable`”。全仓 `--enable` 命中仅余旧 `src/mcp.js`/`cli.js`/Phase 1 架构文档与上述已修正句。`src/mcp-stdio.js` 无任何开关，`main` 仅读 `MARS_*` 环境变量与 token 文件。 | **PASS**（残留措辞见 N-06） |
| **F-02** | 服务端不校验 inputSchema；非法 status 返回成功空集，额外 `token`/`role_id` 被静默忽略（medium） | `src/mcp-stdio.js:144-190` 新增 `validateToolArgs()`：未知字段、非法枚举、越界 limit、confidence 非 number/越界、task 未知字段均返回 `INVALID_ARGUMENT`；`callTool:218-219` 在 store 之前调用。真机 3 次探测全部拒绝（§1.3）。`tests/phase2/mcp-stdio.test.js:20-28` 固化负例。 | **PASS** |
| **F-03** | R2 的 allowed_types 为 L1/L2/L4，却成功 propose L3；`store.propose` 不校验（medium） | `src/store.js:56-57`：`roleTypes = options.routing…allowed_types`，越界抛 `ROLE_TYPE_DENIED`。真机 `mars-r2` propose L3 → `ROLE_TYPE_DENIED`，未插入（计数 9 不变）。`tests/phase2/mcp-stdio.test.js:31-41` 覆盖 R2/L3 拒绝与 L2 允许。 | **PASS**（残留见 N-03：门是 opt-in；库中 2 条历史 L3 行） |
| **F-04** | `review` 无迁移校验：同态直接返回不审计，任意状态可 UPDATE（medium） | `src/store.js:157-163` TRANSITIONS：`proposed→approved/rejected`、`approved→superseded/deprecated`，其余空。`:168-171` 同态先写 `result='noop'` 审计再抛 `STATE_UNCHANGED`；`:172-173` 非法迁移抛 `INVALID_TRANSITION`。独立 in-memory 复核：approved→approved `STATE_UNCHANGED`（有 noop 审计）、proposed→superseded `INVALID_TRANSITION`、approved→superseded 成功。`tests/phase2/mcp-stdio.test.js:43-58` 覆盖。 | **PASS** |
| **F-05** | G4 报告缺 6 个 session_id、均值标签错误、cacheRead 区间错误、质量分人工（medium） | `docs/phase2-g4-ab-report.md:33-42` 已列 6 个 session_id + usage；`:45` 全量均值 74,057.7/88,216.7 明确标注“被首次冷启动拉偏”；`:46` 剔除首次 88,930.5/87,466.0（−1.65%），output 1,560/904，并同时给出全量 output 1,495/1,279；`:47` cacheRead 占比 15.3%–84.9%，与复算逐项一致（B1 15.31%、T1 57.35%、B2 84.43%、B3 84.12%、T2 84.89%、T3 84.72%）；`:61` 明确质量分为人工判定、无脚本，Phase 2.1 自动化。6/6 usage 复算与报告精确一致。 | **PASS** |
| **F-06** | 关闭脚本不支持 `-WhatIf`，文档却写 `-WhatIf` 预演（low） | `scripts/mars-mcp-disable.ps1:4` 已为 `[CmdletBinding(SupportsShouldProcess=$true)]`；`:30` 调 `ShouldProcess`。实测 `-WhatIf` exit 0 且 registry 哈希不变；`-Yes -WhatIf` 打印 `What if…` 后 ABORTED，exit 0。`docs/mcp-access.md:65` 的 `-WhatIf` 命令现已真实可用。 | **PASS** |
| **F-07** | 跨项目返回 `AUTH_DENIED`，与契约 `PROJECT_DENIED` 不一致（low） | `src/mcp-stdio.js:220-224` 在 authorize 之前先判项目归属并返回 `PROJECT_DENIED`。真机 `mars-r2 memory_list {project_id:'xingrixiao'}` → `PROJECT_DENIED`。`tests/phase2/mcp-stdio.test.js:60-79` 断言错误码。 | **PASS**（文档残留见 N-04） |
| **F-08** | 工具 status enum 含 rejected、缺 deprecated；confidence 声明 string 而 store 只收 number（low） | `src/mcp-stdio.js:63,135`：status enum = proposed/approved/rejected/superseded/deprecated；`contracts/memory.schema.json:20` 也含 rejected，两者一致。`confidence` 已为 `type:"number", minimum:0, maximum:1`（`mcp-stdio.js:92`），服务端 `:173` 拒绝非 number/越界；`tests/phase2/mcp-stdio.test.js:25` 覆盖 confidence=7。 | **PASS** |
| **F-09** | `memory_stats` 直接按 project_id 统计全部 memories/aliases，不按 role/visibility/`canRead` 过滤（low） | **实现未变**：`src/mcp-stdio.js:240-251` 仍是 4 条 `SELECT COUNT(*) … WHERE project_id = ?`，无可见性/role 过滤；role 限定记忆与 proposed 仍计入。Phase 2 文档未补充“计数含调用者不可见记忆”的说明（`docs/mcp.md:104` 只说“项目级计数，不做跨项目聚合”，并未回应可见性）。无 stats 差异测试（`tests/phase2/mcp-stdio.test.js` 4 例均不涉及 stats）。 | **FAIL（未关闭）** |

**关闭数：8/9。** F-09 与 R0“F-01…F-09 已修复”的自述不符；它不属于 blocker/high，但必须在验收记录中显式处置（修复、或书面接受并写明统计口径）。

## 4. 新发现问题（7 low，0 medium/high）

| ID | severity | 文件:行 | 问题 | 建议 |
|---|---|---|---|---|
| **N-01** | low | `src/mcp-stdio.js:212-226`、`:275-285` | **参数/项目级拒绝不落审计**：`AUTH_DENIED`、`METHOD_NOT_FOUND`、`INVALID_ARGUMENT`、`PROJECT_REQUIRED`、`PROJECT_DENIED` 在审计块之前 `return`；实测 3 次 `INVALID_ARGUMENT` + 1 次 `PROJECT_DENIED` 产生 0 条审计。只有进入执行段后的业务异常（如 `SOURCE_VERSION_REQUIRED`、`ROLE_TYPE_DENIED`）才落审计（audit 189/190）。 | 在早退分支写一条 `result=code` 的边界审计，或把审计前移到 `callTool` 入口（无 principal 时用 `principal_id=null`/token 指纹的不可逆标识）。 |
| **N-02** | low | `src/mcp-stdio.js:275-285`；`src/store.js:107,132,150,181` | **成功 MCP 调用被双重审计**：store 层与边界层各写一条。实测 `memory_get` 一次成功产生 2 行（191 `reason=null` + 192 `reason=mcp:stdio`）；list 的 `count` 行 + 边界 `ok` 行、propose 的 `created` 行 + 边界 `ok` 行同理。导致 `SELECT action, COUNT(*)` 无法区分“真实调用次数”与“内部 store 调用次数”，G3 的计数口径因此天然膨胀。 | 明确单一审计所有者（建议只在边界审计，store 审计加 `origin` 字段），或在文档中定义“store 行 / boundary 行”的计数规则。 |
| **N-03** | low | `src/store.js:56-57`；`scripts/seed-phase2.js:50` 调用点；DB `mem_0db463660da4`、`mem_3bc9a242489d` | **类型门是 opt-in**：只有 `options.routing` 存在时才校验 `allowed_types`；`seed-phase2.js` 调 `store.propose(..., { allowedRoots })` 未传 routing，内部调用可绕过。库中仍有 2 条 `created_by=mcp-R2` 的 L3 记忆（R2 allowed_types 不含 L3），是修复前遗留数据。外部 MCP/CLI 路径都传 routing，故不构成外部越权。 | `propose` 内部缺省加载 routing（或强制要求 routing 参数），并迁移/标注 2 条历史行；补 seed 路径回归。 |
| **N-04** | low | `docs/phase2-g2-runs.md:21,23` | **G2 文档漂移**：`:23` 仍写“跨项目访问均为 `AUTH_DENIED`”，与修复后实际 `PROJECT_DENIED`（F-07）矛盾；`:21` 写“R3 可见、R0/R1/R2/R4 不可见”，但 `:22` 自己承认 R0/R3/R4 可经 `memory_get` 读取原文——`:21` 未限定“packet”。 | 改为“跨项目 → PROJECT_DENIED”；`:21` 改为“仅 R3 的 packet 可见；R0/R3/R4 可经 `memory_get` 审批读取”。 |
| **N-05** | low | `docs/phase2-g3-workflow.md:10,13,18,32` | **G3 文档漂移**：`:10` 的“R2 经 MCP propose L3”在新门禁下不可复现；`:13` 审计计数 `list=67, compile=29` 是旧快照且无时间戳（本轮末实际 100/42）；`:18` “R2 因路由不含 L3，仍不可见”仅对 packet 成立（真机 `memory_get` 返回 ok）；`:32` 复现命令会先 `SOURCE_VERSION_REQUIRED` 再 `ROLE_TYPE_DENIED`。P10 描述本身（`:26` TRANSITIONS、同态 STATE_UNCHANGED 写审计）是准确的。 | 给历史步骤加“修复前快照”标注；更新计数与时间戳；把不可见限定为 packet；修正复现示例。 |
| **N-06** | low | `docs/phase2-g1-security-report.md:87` | G1 结论仍写“冻结默认禁用……均有真实进程证据”。在 `mcp-stdio.js` 没有进程级开关的前提下，该措辞仍容易被读成“进程级默认禁用”；§6.1:74 已修正核心表述，但 §8 未同步。 | 改为“默认不注册 + 每实例 token/角色绑定”；或明确“冻结”指注册表策略，不是进程门。 |
| **N-07** | low | `src/mcp-stdio.js:96`；`src/store.js:50` | `memory_propose.inputSchema.required` 未包含 `source_version`，但 store 强制要求（缺失 → `SOURCE_VERSION_REQUIRED`，真机已复现）。`tools/list` 宣称的必填项与实际行为不一致。 | 把 `source_version` 加入 schema required（与 store 策略一致）；或如果允许缺省则 store 给默认值并写文档。 |

### 4.1 既有低风险遗留（非本轮新发现，未被 R0 列入 F-01…F-09）

- **F-10（数据残留）**：`scripts/seed-phase2.js` 已改为字符串 note，但库中 7 条 seed 记忆的 `provenance.review_note` 仍是 `[object Object]`（`mem_ce9d53d9a8cd`、`mem_cac528b1b6c1`、`mem_28a69d6965da`、`mem_3bc9a242489d`、`mem_ed4161d14f43`、`mem_da263b7afe65`、`mem_90fc3b64dacf`）。代码修复、数据未迁移。
- **F-11（tools/list 未认证）**：`initialize`/`ping`/`tools/list` 无需 token；`docs/mcp-access.md:85` 已明确记录“工具清单非敏感、调用需 token”，属已披露设计。
- **F-12（G3 计数快照）**：见 N-05，仍未标注时间戳。
- **F-13（packet 与 memory_get 措辞）**：见 N-04/N-05，仍未统一。
- **F-14（mcp-stdio 测试）**：已关闭——新增 4 例，覆盖 F-02/F-03/F-04/F-07。

## 5. 测试与门槛复核

### 5.1 测试明细（60/60）

| 范围 | 文件数 | 用例数 | 结果 |
|---|---:|---:|---|
| ledger + mcp | 2 | 14（8+6） | PASS |
| phase1（不含 remediation） | 8 | 36 | PASS |
| phase1 remediation | 1 | 6 | PASS |
| phase2（`mcp-stdio.test.js`） | 1 | 4 | PASS |
| **合计** | **12** | **60** | **60/60 PASS** |

`tests/phase2/mcp-stdio.test.js`：
- `:20-28` 未知字段/非法 status/limit 9999/L9/confidence 7/task 未知字段/缺 memory_id；合法 status 通过 → **F-02**。
- `:31-41` R2 propose L3 → `ROLE_TYPE_DENIED`，L2 → 成功 → **F-03**。
- `:43-58` approved 同态 `STATE_UNCHANGED`（noop 审计）、approved→superseded 成功、proposed→superseded `INVALID_TRANSITION`、proposed→rejected 成功 → **F-04**。
- `:60-79` 跨项目 `PROJECT_DENIED`、未知字段 `INVALID_ARGUMENT` 且不触达 store → **F-07/F-02**。

### 5.2 G1–G4 复核

| 门槛 | 独立判定 | 依据 |
|---|---|---|
| **G1 接入与安全** | **PASS（有条件）** | 身份只从 token 文件 + `MARS_ROLE` 推导；未知/缺失/角色不匹配 token 拒绝；跨项目 `PROJECT_DENIED`；参数校验真实生效；role_scope 隔离、proposed 隔离、自审拒绝均有真实进程/测试证据。上一轮 F-01/F-02/F-07 已关闭。残余：F-09（low 信息暴露）+ N-01/N-02（low 审计问题）。 |
| **G2 真实小范围运行** | **PASS（受控范围）** | 6 条 manifest 的 role/tokens 与文档逐一吻合；`man_5c8fcae8eb4b` 的 `task_id=UNKNOWN` 与文档 §3 的“修复前 UNKNOWN、修复后 G1-REAL-CALL-002”一致。R0 前后对比、R2 无 decisions、R3 role_scope 均有 DB/audit 证据；`session_id` 全为 NULL、`packet_id` 未持久化是已知证据边界。每角色仅 1 次调用。文档自评 PARTIAL（受控范围），与证据不矛盾。 |
| **G3 工作流** | **PASS（单样本）** | `mem_0db463660da4` 的 `created_by=mcp-R2`、`approved_by=mcp-R0`、`approved_at` 与 G3 文档一致；R3 packet decisions 含该记忆；审计链可追溯。P10 描述准确（TRANSITIONS + 同态审计）。限制：样本 1、rejected/superseded 无端到端。 |
| **G4 Token/质量 A/B** | **PARTIAL** | 6/6 usage 复算精确一致，均值标签与 cacheRead 区间已修正（F-05 关闭）；但质量分仍是单角色/单任务、每组 3 次的人工评分（`phase2-g4-ab-report.md:61`），token 差异 −1.65% 在冷启动噪声内，不能外推。 |

**总体门槛**：G1 PASS（有条件）、G2 PASS（受控范围）、G3 PASS（单样本）、G4 PARTIAL。

## 6. 边界与敏感检查

### 6.1 D:\M1 仓库

```text
git -C /mnt/d/M1 status --porcelain -uall -- mars  → 64 行，全部为 "?? mars/..."
git -C /mnt/d/M1 ls-files mars                      → 0（无跟踪文件）
git -C /mnt/d/M1 log --all --oneline -- mars       → 0（无提交触及 mars）
git -C /mnt/d/M1 status -sb                         → "## main...origin/main"（无 ahead/behind）
```

结论：`mars/` 整体未跟踪，**无 commit、无 push**；本轮未做任何 git 写操作。

### 6.2 忽略规则

```text
mars/.gitignore:2:var/                     mars/var/mcp/tokens/R0.token
mars/.gitignore:2:var/                     mars/var/mars.db
mars/.gitignore:5:config/principals.json   mars/config/principals.json
```

token 文件（44 B）与 `principals.json` 仍被忽略；token 明文未读取、未出现在本报告。`var/mcp/` 下另有 `UNKNOWN.token`（37 B，测试遗留），同样受 `var/` 忽略。

### 6.3 D:\Projects\xingrixiao

- `git status --porcelain -uall`：17 个既存修改（`docs/design/*`、`docs/dev/a1/*`），与上一轮记录一致。
- `git diff` 全文检索 `mars`（大小写不敏感）：**0 命中**；无 `mars/` 路径改动。
- 结论：该仓库没有 MARS 相关改动，本轮亦未写入。

### 6.4 MCP 注册表

5 个 `mars-r*` 服务（R0–R4）仍为 on-demand、stdio、`DSH.exe` + `src/mcp-stdio.js`，env 仅含 `MARS_*` 与 token 文件路径；未见 token 明文。`mars-mcp-disable.ps1` 的 `-WhatIf` 未改动注册表（SHA-256 前后一致）。

## 7. 总体结论与验收条件

**总体：PARTIAL。**

- 上一轮 5 个 medium（F-01～F-05）全部真实修复；F-06～F-08 亦关闭；F-09 未修复，故“F-01…F-09 已修复”的自述**不成立**（8/9）。
- 未发现身份伪造、跨项目读取、未审批记忆进入 packet、自审成功、role_scope 越权进入其他角色 packet 等实质安全突破；0 blocker / 0 high。
- 测试 60/60；G2/G3 核心证据与 DB/audit 吻合；G4 统计证据已可复算。
- 新发现 7 个 low，集中在**审计边界**（拒绝不落审计、成功双审计）与**文档口径漂移**（G1 §8、G2/G3 复现与计数），不改变“控制有效”的结论，但影响可追溯性与验收材料严谨性。

**是否具备 Phase 2 验收条件：具备“有条件验收”，不具备“无条件 PASS”。**

建议的关闭条件（均为低风险，预计工作量小）：

1. **F-09**：二选一——① 按 `canRead`/role 过滤后再计数，并补 R2/R3/R4 stats 差异测试；或 ② 在 Phase 2 文档与工具描述中明确“计数含本项目全部 visibility/status，仅作运营统计”，并列为已接受风险。
2. 修正 **N-04/N-05/N-06** 三处文档漂移（G2 跨项目错误码、G3 历史步骤/计数/复现、G1 §8 措辞）。
3. 记录 **N-01/N-02/N-03/N-07** 为 Phase 2.1 前置项（审计边界、双审计口径、store.propose 强制 routing、schema required 对齐）。
4. 完成后重跑 60 个测试 + 本报告 §1.3 的拒绝探针，即可判 **PASS（有条件）**。

## 8. 未验证项

1. **限流/请求上限**：120 次/分与 256 KB 行上限只做了源码核对，未做并发/压力实测。
2. **关闭脚本写路径**：只跑 `-WhatIf` 与 `-Yes -WhatIf`，未执行真实备份+移除；备份完整性与原子性未验证。
3. **token 轮换/吊销**：未执行重签发与旧 token 失效测试；token 文件内容/熵未检查（按约束不读明文）。
4. **G4 质量分**：8/15→15/15 为报告人工评分，未独立阅读 6 份答案复评；只复算了 usage 与标签。
5. **G2 packet 正文**：未对 5 个角色逐一重新 compile 并逐段比对；`packet_id` 未入库，只能以 manifest/DB/audit 及上一轮证据核对。
6. **xingrixiao**：只做 status/diff 级检查（确认无 MARS 内容），未逐文件审阅其 17 个既存修改。
7. **DSH 客户端侧 schema 校验**：未用 DSH 客户端构造非法参数；服务端已独立验证。
8. **并发/长会话/多进程**：未测试 SQLite 锁、长会话预算衰减、跨进程限流。
9. **G3 rejected/superseded 端到端**：未跑真实 MCP/CLI 全链路（仅单测覆盖状态机），与文档自述一致。

## 附录 A：本轮审计增量（探测）

```text
探测前 audit = 188
189  memory.propose  SOURCE_VERSION_REQUIRED  reason=mcp:stdio
190  memory.propose  ROLE_TYPE_DENIED         reason=mcp:stdio
191  memory.get      ok                       reason=null        （store 层）
192  memory.get      ok                       reason=mcp:stdio   （MCP 边界层）
```

3 次 `INVALID_ARGUMENT` + 1 次 `PROJECT_DENIED` 未产生审计行（N-01）。

## 附录 B：G4 会话复算（`ledger.parseSession`）

| 运行 | 会话 ID | input | output | cacheRead | cacheWrite | total |
|---|---|---:|---:|---:|---:|---:|
| B1 | `ba0573fd-08e3-465f-af19-183678ee3a34` | 36,163 | 1,365 | 6,784 | 0 | 44,312 |
| B2 | `13d40872-204a-4206-9981-256d585981ee` | 12,377 | 1,435 | 74,880 | 0 | 88,692 |
| B3 | `6e197937-8e7f-42b3-a151-7c565c97c402` | 12,476 | 1,685 | 75,008 | 0 | 89,169 |
| T1 | `a281dae2-fd02-47a4-bd4e-fa4a4363eb15` | 36,232 | 2,030 | 51,456 | 0 | 89,718 |
| T2 | `cbdee4e1-a934-43b4-aa46-517437f98b35` | 12,368 | 822 | 74,112 | 0 | 87,302 |
| T3 | `999bc624-09b4-4207-8748-4cebc42bcdaa` | 12,404 | 986 | 74,240 | 0 | 87,630 |

- 全量均值：基线 74,057.7 / 实验 88,216.7；output 1,495.0 / 1,279.3。
- 剔除首次：基线 88,930.5 / 实验 87,466.0（−1,464.5，−1.65%）；output 1,560 / 904。
- cacheRead/total：15.31%、84.43%、84.12%、57.35%、84.89%、84.72% → 15.3%–84.9%。

---

**审查者**：R4（独立复审，第二轮）
**报告路径**：`D:\M1\mars\docs\phase2-review-round2.md`

---

## 8. 定向补充复核（R0 修复复验 · 追加）

> 本节按父任务要求追加于文末，不回改前文；前文 §8 为原“未验证项”。复核只读源码/测试/DB，并用 `mars-r0` 做 3 次真实 MCP 调用；未改代码、配置或 DB 内容。

### 8.1 复验方法与命令

- 源码核对：`src/mcp-stdio.js:212-228`（`fail()` 边界审计）、`:257-275`（stats）、`:298-314`（成功调用审计）；`src/store.js:56-57`、`:111-119`；`scripts/seed-phase2.js:46`；`src/mcp-stdio.js:84-98`（propose schema）。
- 全量测试：`DSH.exe --test` 12 个文件（ledger + mcp + 9×phase1 + phase2），结果 **61/61 PASS**，`duration_ms 1537.9`，exit 0。新增用例为 `tests/phase2/mcp-stdio.test.js:89-129`（stats 可见范围）。
- 真机：`mcp_load mars-r0` 重载新进程（schema 已含 `source_version` required），随后调用 `memory_list {status:'bogus'}`、`memory_get mem_0db463660da4`、`memory_stats`。
- DB 只读：`SELECT COUNT(*), MAX(audit_id) FROM audit` 与 `GROUP BY action`；探测前后 audit 192 → 196。

### 8.2 逐项核验

| 项 | 判定 | 证据 |
|---|---|---|
| **F-09** stats 可见范围 | **PASS**（核心要求达成；残留 N-08） | `src/mcp-stdio.js:257-275` 改为先 `store.list` 再计数，返回 `scope:'visible_to_caller'`；R2 单测断言只计 1 条可见 project 记忆，R3 role-only 与他人 proposed 不计入。真机 R0 返回 `memories:9, approved:8`，与其可读范围一致。 |
| **N-01** 拒绝落审计 | **PASS** | `fail()`（`:212-228`）在返回前写 audit：`target='boundary'`、`result=code`、保留已知 principal/role/project，不写 content/token 等参数值（`project_id` 仅用于归属）。真机非法 `status:'bogus'` 后 audit 192→193：`193 memory.list / boundary / INVALID_ARGUMENT / mcp-R0 / R0 / rds-m1`，增量恰为 1。 |
| **N-02** 成功调用不双审计 | **PASS** | 成功 `memory_get` 后 audit 193→194：仅 `194 memory.get / mem_0db463660da4 / ok / reason=null`（store 层），**无**边界 `mcp:stdio` 重复行。`memory_stats` 因 store 未审计 stats，按设计保留 `memory.list`（store）+ `memory.stats`（边界）两行，非同一动作重复。 |
| **N-03** seed routing / 无 routing 行为记录 | **PARTIAL** | `scripts/seed-phase2.js:46` 已传 `{ allowedRoots, routing }`；数据库中 `mem_0db463660da4`、`mem_3bc9a242489d` 两条 `created_by=mcp-R2` 的 L3 历史行仍在（属修复前数据遗留）。但 `store.propose` 在 `options.routing` 缺失时仍**跳过** allowed_types 校验（`src/store.js:56-57`），源码与文档中均未找到对该内部缺省行为的说明/约束；`docs/mcp-access.md:32` 仍无条件声称 propose 必在 allowed_types 内。 |
| **N-07** propose schema required | **PASS** | `src/mcp-stdio.js:96` required 已含 `source_version`；`mcp_load mars-r0` 返回的 schema 同步显示该字段。 |
| **文档修正** G2 | **PASS** | `docs/phase2-g2-runs.md:23` 已改为“跨项目 → `PROJECT_DENIED`”。 |
| **文档修正** G3 | **PASS** | `docs/phase2-g3-workflow.md:10` 标“修复前快照”；`:13` 标“旧快照（2026-11-03 12:14，修复前）”并指向本报告 §1.4；`:18` 明确 packet 不可见但 `memory_get` 可读；`:31` 复现改为 `mars-r3` 提议 L3。 |
| **文档修正** G1 §8 | **PASS** | `docs/phase2-g1-security-report.md:87` 已改为“默认不注册（无进程级开关）+ 每实例 token/角色绑定”。 |

### 8.3 新增/遗留低风险

| 编号 | severity | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| **N-08** | low | `src/mcp-stdio.js:261-270`；`src/store.js:147` | stats 以 `store.list(..., {limit:100000})` 计数，但 `store.list` 将 limit 钳到 200，可见记忆 >200 时统计静默少计；且 `proposed` 只计调用者本人创建（`:270`），而 `memories` 含所有可读 proposed，导致 R0 真机结果为 `memories:9, approved:8, proposed:0`（8+0≠9）。 | 用带可见性条件的 `COUNT(*)` 直接统计（或分页累计），并把 `proposed` 口径写进工具描述/文档；补 >200 行与 approver 场景测试。 |
| **N-09** | low | `docs/phase2-g1-security-report.md:70` | 仍写“60/60 PASS”，而 README `:70`、mcp-access `:104` 已更新为 61/61；作为历史轮次记录可解释，但与当前验收材料不一致。 | 标注“G1 当时 60/60；追加 stats 用例后全量为 61/61”。 |
| **N-03 残留** | low | 同 8.2 | 无 routing 时的类型门行为未记录；两条历史 L3 行未标注。 | 在 `store.propose` 注释/文档中声明“仅当传入 routing 时校验”，或改为强制加载 routing；对历史行加迁移说明。 |

### 8.4 门槛与总体结论

- 测试：**61/61 PASS**（12 文件，phase2 由 4 例增至 5 例）。
- G1 **PASS（有条件）**；G2 **PASS（受控范围）**；G3 **PASS（单样本）**；G4 **PARTIAL**（统计证据可复算，质量分仍为人工评分）。
- **F-01…F-09：9/9 关闭**；上一轮报告 §7 的关闭条件 1（F-09）已满足，条件 2/3（N-04/N-05/N-06 文档、N-01/N-02/N-07）已复验通过；N-03 仅余 low 文档/数据遗留。
- **总体由 PARTIAL 更新为 PASS（有条件）**：0 blocker / 0 high；剩余 N-03/N-08/N-09 均为 low，列入 Phase 2.1 前置项，不阻断 Phase 2 有条件验收。
- **是否具备 Phase 2 验收条件：具备“有条件验收”，仍不具备“无条件 PASS”。**

建议关闭条件：
1. 记录 N-03：`store.propose` 无 routing 的语义，或强制传 routing；标注 2 条历史 L3 行。
2. 修 N-08：stats 用真实可见计数并明确 `proposed` 口径，补 >200 用例。
3. 修 N-09：G1 报告补“61/61（追加 stats 用例后）”。
4. G2/G4 的样本量与质量评分自动化仍按原报告作为 Phase 2.1 条件。

### 8.5 本次未验证

- 未执行真实 `seed-phase2.js`（会写生产 DB），仅核对调用参数。
- 未在 >200 条可见记忆的数据集上实测 stats 截断，结论来自 `store.list` 的 limit 钳制源码。
- 未构造 `AUTH_DENIED`/`PROJECT_DENIED` 的边界探针（N-01 的这两类由 `fail()` 同一路径覆盖，仅做源码核对）。
- 未做并发/压力与 token 轮换测试（沿用前文 §8 的未验证项）。
