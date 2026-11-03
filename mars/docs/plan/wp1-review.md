# MARS WP-1 独立复核报告（R4）

| 项 | 值 |
|---|---|
| 复核角色 | R4（独立审查，不实现） |
| 复核时间 | 2026-11-03 21:09–21:26（Asia/Shanghai；§8 含 21:2x 当前树复测） |
| 仓库 / 工作目录 | `D:\M1` / `D:\M1\mars` |
| 基线 HEAD | `07f0a1e03cc9425c5ab4092f15e6778264b7b523`（与 WP-0 记录一致） |
| 复核对象 | WP-1：P2 遗留加固 + P3 治理（8 项声称改动、7 项必做核验） |
| **结论** | **PASS（有条件）** |
| 问题统计 | blocker 0 / high 1 / medium 5 / low 6 / info 5（共 17 项） |
| 当前树复测 | 79/79 通过（§8；WP-1 时点为 66/66） |
| 阻断项 | 1 项：F-01（流程，工作树在复核期间被并行工作包改写） |

> 约束声明：本轮只读源码、只读查询生产库、测试与行为探针均在 `%TEMP%` 副本上执行；未修改 `src/`、`contracts/`、`scripts/`；未执行 `git add/commit/push/reset/clean`；未向生产库、生产 `principals.json` 或生产审计写入。报告内不含任何 token 明文。

## 0. 结论摘要

WP-1 声称的 8 项改动**均能在源码、数据库、测试与临时副本上找到对应实现与证据**，不是仅凭实施者总结：schema v2 的 `expires_at`/`rate_limits` 已落在生产库，`consumeRateLimit` 跨连接/重启有效，过期记录不进入 `retrieve`/`compileContext` 但审批者可 `get`，MCP 边界类型门与 `ROLE_TYPE_DENIED` 生效，`--revoke` 能删除 principal 与 token 文件，备份快照可用 `--verify` 验证，测试 66/66 通过，历史两条 L3 全字段未被改写。

但复核期间**工作树不是静止的**：并行工作包在 WP-1 门禁签收前就改写了 `src/db.js`（schema v2→v3→v4）、`src/retrieval.js`、`src/cli.js`、`src/compiler.js` 并新增 phase3/phase4 产物；首次全量测试因此在一个被并发重写的文件上失败。**因此 WP-1 的“66/66”只能在混合树上复现，不能在纯 WP-1 快照上复现**。加上限流函数非原子、生产 MCP 进程仍是旧代码、治理文档两处口径与实现不符，结论为 **PASS（有条件）**，不建议在冻结快照前直接签收 WP-1 门禁。

## 1. 复核方法与证据快照

- **源码**：在 21:09–21:10 直接阅读 `src/`、`scripts/`、`config/`、`contracts/`、`tests/`、`docs/`；WP-1 时点文件 mtime 为 21:05:44–21:08:25。21:09:50 起同一工作树被其他进程改写，故本报告把“WP-1 时点实读”和“复核结束时当前树”分开记录（见 §1.2）。
- **数据库**：用 `node:sqlite` 以 `readOnly:true` 打开 `var/mars.db`；用 `VACUUM INTO` 生成 `%TEMP%` 副本做写操作探针；生产库只读，未执行任何写语句。
- **测试**：Node `v24.21.0`，`node --test`（未使用 `DSH.exe` 跑测试）。
- **行为探针**：临时库/临时 principals 上的限流、过期、routing、权限、revoke、审计覆盖、MCP 边界探针（脚本位于 `%TEMP%\wp1-r4\`）。
- **生产一致性**：生产库与迁移前备份快照逐表逐行比较全部公共列；生产 `principals.json`/token 文件哈希与 mtime 前后比较。
- **Git**：用 `D:\tools\git\bin\git.exe` 只读执行 `rev-parse HEAD`、`status --porcelain -uall`、`diff --cached`。

### 1.1 WP-1 时点（21:09:50 前）的关键文件

| 文件 | mtime | 说明 |
|---|---|---|
| `src/db.js` | 21:09 前后读到时为 157 行 / 6430 B | `SCHEMA_VERSION=2`、`migrate()`、`consumeRateLimit()`、`dbStats()` |
| `src/store.js` | 21:05:44 | `resolveRouting`、`propose` 类型门、`expires_at`、`canRead` |
| `src/mcp-stdio.js` | 21:06:32 | 持久化限流、stats、propose `expires_at` |
| `scripts/mars-issue-mcp-identity.js` | 21:06:38 | `--revoke` |
| `scripts/mars-db-backup.js` | 21:06:46 | `VACUUM INTO` + `--verify` |
| `tests/phase2/wp1.test.js` | 21:07:24 | 5 用例 |
| `docs/governance.md` 等 4 份文档 | 21:08:02–21:08:25 | WP-1 文档 |

### 1.2 复核结束时当前树（已被并行工作包改写，非纯 WP-1）

| 文件 | mtime | SHA-256 前 16 位 | 变化 |
|---|---|---|---|
| `src/db.js` | **21:17:30** | `E030B486AC8B4416` | `SCHEMA_VERSION=4`，新增 `projects`（:98）、`shares`（:105）、`orchestrator_runs`（:125） |
| `src/store.js` | 21:05:44 | `F96A16BB6B93A2AD` | 未变（仍是 WP-1 版本） |
| `src/retrieval.js` | **21:13:54** | `038C7120D197A713` | 被 P5 共享检索改写（顶部 require `./sharing`） |
| `src/compiler.js` | **21:10:45** | `F0EBDFCBB81FAB72` | 被并行工作包改写 |
| `src/cli.js` | **21:10:33** | `EEB5BCA69868DBA8` | 被并行工作包改写 |
| `src/mcp-stdio.js` | 21:06:32 | `30D84EEDE06B0B7B` | 未变（仍是 WP-1 版本） |
| `src/authz.js` | 19:04:48 | `47CE22CDB4BF3EE2` | 未变 |
| `tests/phase2/wp1.test.js` | 21:07:24 | `E544C65D5CF7EF6B` | 未变（5 用例） |

## 2. 逐项核验：WP-1 的 8 项声称

| # | 声称 | 证据 | 判定 |
|---|---|---|---|
| 1 | `src/db.js`：schema v2 迁移（`memories.expires_at`、`rate_limits` 表）、`consumeRateLimit`、`dbStats` 增 rejected/deprecated/superseded/expired | 生产库 `meta.schema_version='2'`、`memories` 末列 `expires_at`、`rate_limits(principal_id PK, window_start, count)` 存在；`migrate()` 幂等加列且 `initSchema` 末尾调用；`dbStats` 返回 `rejected/deprecated/superseded/expired`（当前树 `src/db.js:191`；WP-1 时点函数相同）；临时库迁移测试通过 | **PASS**（当前树已升 v4，见 F-01/F-15） |
| 2 | `src/store.js`：`resolveRouting()` fail-closed（无 routing 加载 config，失败抛 `ROUTING_UNAVAILABLE`）；propose 越权类型 `ROLE_TYPE_DENIED`；`expires_at` 校验；`canRead` 对非审批者排除过期 | `src/store.js:16` 无 routing 时 `loadRouting(MARS_ROUTING || DEFAULT_ROUTING)`，异常转 `ROUTING_UNAVAILABLE`；`src/store.js:65-69` 按角色 `allowed_types` 抛 `ROLE_TYPE_DENIED`；`src/store.js:72-73` 非法 `expires_at` 抛 `EXPIRES_AT_INVALID`；`src/store.js:130-134` 审批者先返回 true，之后才是过期判断，非审批者过期返回 false。临时库：`MARS_ROUTING` 指向不存在文件 → `ROUTING_UNAVAILABLE`；R2 propose L3 → `ROLE_TYPE_DENIED`；过期记录 R0 `get` 可见、创建者 `get` → `MEMORY_DENIED` | **PASS**（F-04/F-06/F-07 见问题清单） |
| 3 | `src/retrieval.js`：过期记忆不进检索/编译上下文 | `retrieval()` 的 `push()` 在 `canRead` 前执行 `if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return`；临时库探针：过期记录不进 `retrieve`，也不进 `compileContext` 的 facts；审批者 `store.get` 仍可见 | **PASS** |
| 4 | `src/mcp-stdio.js`：持久化限流（120/min/principal）；stats 字段；propose 支持 `expires_at` | `MAX_CALLS_PER_MINUTE=120`；`callTool` 在身份校验后调用 `consumeRateLimit(db, principal.principal_id, 120, 60000)`；MCP 端到端探针：前 120 次 `memory_stats` 成功，第 121 次 `RATE_LIMITED`；关闭 gateway 后新 gateway 再调 → 仍 `RATE_LIMITED`（count 124，跨连接/重启持久）；`memory_stats` 返回 memories/approved/proposed/rejected/deprecated/superseded/expired/aliases + `scope:'visible_to_caller'`（205 行测试返回 205，不受 list 200 clamp 限制）；`memory_propose` inputSchema 有 `expires_at`，非法值边界返回 `INVALID_ARGUMENT`，2030 年过期值成功落库为 `2030-01-01T00:00:00.000Z` | **PASS**（F-02 原子性见问题清单） |
| 5 | `scripts/mars-issue-mcp-identity.js`：`--revoke`（删除 principal 与 token 文件） | 在临时 principals/token 副本上执行 `--role R2 --revoke`：exit 0，`revoked:true`、`token_file_removed:true`，临时 principals 只移除 `mcp-R2`、`R2.token` 被删除；对不存在角色 R7 幂等返回 `revoked:false`；生产 `principals.json` sha256 与 R0–R4/UNKNOWN token 文件大小、mtime 前后完全一致 | **PASS** |
| 6 | `scripts/mars-db-backup.js`：`VACUUM INTO` 快照 + `--verify` | `--verify var/backups/mars-2026-11-03T13-06-51-559Z.db` → exit 0，bytes 229376，sha256 `48b9836f75eb1002ef653b4330bf6aea1f07158a3dd2929989f88e4d2ec735d2`，counts 9/20/22/0/196、`rate_limits=null`、`integrity=ok`；直接读快照：`schema_version='1'`、无 `expires_at` 列、无 `rate_limits` 表 → 确为迁移前快照，可用于回滚 | **PASS** |
| 7 | `tests/phase2/wp1.test.js` 5 用例；全量测试 66/66 | `node --test tests/phase2/wp1.test.js` → 5/5 PASS（N-03、N-08、过期、限流、迁移+revoke）；全量 66/66（21:18:27，`8+6+42+10`，见 §4）。首次全量运行因工作树被并发改写失败（F-01），不是 WP-1 逻辑缺陷 | **PASS**（F-09 测试质量见问题清单） |
| 8 | 文档：`docs/governance.md`、`docs/plan/rollback-drill.md`、`docs/plan/p2-legacy-annotations.md`、`docs/phase2-g1-security-report.md` §7/§9 更新 | 四份文档均存在且包含 WP-1 内容；rollback 快照 SHA-256/counts 与实测一致；p2-legacy 两条 L3 字段与实测一致；security report §7 第 1、2 条已标记关闭、新增第 5 条已接受风险；§9 有 WP-1 变更行。但 `governance.md:48/49` 与实现不符，`rollback-drill.md:47`、`security-report.md:91` 测试数表述有误 | **PARTIAL**（F-04/F-05/F-10/F-11） |

## 3. 必做核验（7 项）

| # | 核验项 | 结果 | 证据摘要 |
|---|---|---|---|
| 1 | 读源码确认实现；找 fail-open/绕过路径（空 routing、`MARS_ROUTING` 缺文件、role 与 principal 不一致、review 审批者绕过、直接调内部 API） | **通过（有 1 个网关级 fail-open 例外）** | 显式 `{}`/`null` routing → 回退 `config/role-routing.json`（设计如此，非按调用方拒绝）；`MARS_ROUTING` 指向不存在文件 → `ROUTING_UNAVAILABLE`（store 路径 ✓）；**但 createGateway 的 `routingPath` 缺失/损坏时静默 `routing=null`，propose 仍回退默认配置并成功（F-06）**；客户端传 `role_id` → `INVALID_ARGUMENT`（不能伪造角色）；token 绑定 R2 但 gateway role=R4 → `AUTH_DENIED`；自审 → `SELF_REVIEW_DENIED`；未发现 review 越权；内部 API（store/retrieval/compiler）信任传入的 principal 对象、不校验 token（本机信任模型，见 F-14/F-16） |
| 2 | 只读查询 `var/mars.db`：schema_version、expires_at 列、rate_limits 表、行数；2 条历史 L3 仍在且语义未改写 | **通过** | `meta.schema_version='2'`、`contract_version='0.1.0'`；`memories` 含 `expires_at`；`rate_limits` 存在且 0 行；memories 9、fragments 20、manifests 22、aliases 0、audit 196；`mem_0db463660da4`、`mem_3bc9a242489d` 均为 L3/approved/`expires_at=null`，content_hash 分别以 `9a285d9e…21bf`、`07de554a…6416` 开头；生产库与迁移前快照**逐表逐行、全部公共列比较 0 差异**（含 content/provenance/role_scope/tags/relations/evidence_refs），仅多 `expires_at` 列 |
| 3 | 亲自跑 `node --test tests/ledger/*.test.js tests/mcp/*.test.js tests/phase1/*.test.js tests/phase2/*.test.js` | **通过（重跑后）** | 21:18:27 → `tests 66 / pass 66 / fail 0`；运行前后 `db.js/retrieval.js/store.js/mcp-stdio.js` 哈希不变；分目录 8/6/42/10。**首次运行（21:10 左右）失败**：`ReferenceError: sharedRecords is not defined` at `D:\M1\mars\src\retrieval.js:100:26`，影响 `tests/phase1/retrieval.test.js:32/40/49/59` 与 `tests/phase2/wp1.test.js:67`——原因是运行中 `src/retrieval.js` 被并行工作包重写（F-01） |
| 4 | 临时库副本验证持久化限流与过期逻辑（不改生产库） | **通过** | 用 `VACUUM INTO` 生成 `%TEMP%\wp1-r4\mars-copy.db`（245760 B、integrity ok、schema 2）。限流：limit=2 → true/true/false；关闭连接重开 → `{allowed:false,count:4}`；另一 principal → count 1；80 ms 窗口 140 ms 后 → 重新 allowed。过期：propose 过去时间 + R0 审批 → `retrieve`/`compileContext` 均不含；R0 `get` 可见；创建者 `get` → `MEMORY_DENIED`；`dbStats` expired 计数 1 |
| 5 | 临时 principals 副本验证 `--revoke`，生产不动 | **通过** | 临时副本上删除 `mcp-R2` 与 `R2.token`（`revoked:true`、`token_file_removed:true`）；生产 principals sha256 仍为 `90701B3A9E37DB01459E2198DDEB9C70C6CA477B65753197030358F83C18FDB5`、mtime 20:04:41；生产 6 个 token 文件（R0–R4 + UNKNOWN）大小/mtime 未变 |
| 6 | `docs/governance.md` 与代码一致性（状态迁移、可见性、过期、审计、迁移/回滚） | **部分通过** | 状态迁移矩阵与 `TRANSITIONS` 一致；`private` 未实现、MCP 无 review、吊销需重启、限流 120/min/principal 均与代码/配置一致；迁移/备份/回滚步骤与脚本一致；**`governance.md:49` “创建者可读已过期”与 `canRead` 实现不符；`governance.md:48` “检索只返回 approved”与 retrieval ids 路径/R0/R4/创建者例外不符**；`rollback-drill.md:47` “63 用例确认 66/66”自相矛盾；`security-report.md:91` 的 66 组成（7+7+42+5+5）与实际（8+6+42+10）不符 |
| 7 | 是否有写入生产库/生产 principals/审计被改写的迹象；`git status -uall` 与 WP-1 开始时记录一致性 | **通过（内容零改写；仅文档化 additive schema 迁移）** | 生产库内容与迁移前快照逐行 0 差异，`audit MAX(ts)=2026-11-03T12:49:39.617Z` 未变，memories max(updated_at)=12:13:51.015Z 未变；`rate_limits` 0 行、`expires_at` 非空 0 行；`principals.json` 哈希/mtime 未变；生产库文件 mtime：`mars.db` 20:12:15、`-wal` 21:06:55、`-shm` 20:12:16（21:06:55 的 WAL 对应 WP-1 的 additive 迁移：加 `expires_at` 列、建 `rate_limits` 表、`meta.schema_version=2`，无内容行写入）。Git：HEAD 仍为 `07f0a1e0…`，`diff --cached` 0 个文件，非 mars 区 71 行（1 个修改 `tests/self/run.ps1`）与基线一致；**mars 未跟踪文件从基线 67 / 21:11 的 77 增长到 21:20 的 112，是并行 WP 产物，不是 WP-1 交付**（F-01） |

## 4. 发现的问题清单

> severity 定义：blocker=阻断 WP-1 验收；high=门禁/安全风险，需立即处理；medium=下一工作包前修复；low=文档/健壮性；info=记录项。所有 `file:line` 以复核时读到的版本为准，`src/db.js` 行号已因 P4/P5/P6 漂移，函数名不变。

| id | severity | 位置 | 问题 | 建议修复 | 阻断 |
|---|---|---|---|---|---|
| F-01 | **high** | 工作树（`docs/plan/p2-p6-execution-plan.md:61-67` 约束） | 复核期间并行工作包在 WP-1 门禁签收前改写工作树：`src/db.js` 21:09:50 由 v2 升 v3、21:17:30 再升 v4；`src/retrieval.js` 21:10:42/21:13:54 两次改写；`src/cli.js`/`src/compiler.js` 被改；新增 `src/sharing.js`、phase3/phase4 产物；mars 未跟踪 77→112。首次全量测试因 `retrieval.js` 被并发重写而失败。WP-1 的 66/66 无法在纯 WP-1 快照上复现，变更集边界与回滚清单已混 | 冻结工作树；为 WP-1 打快照并记录逐文件 SHA-256；在冻结快照上重跑 66/66 与门禁用例；把 WP-2/3/4 改动拆回各自变更集/分支；WP-1 门禁只对冻结快照签收 | **是**（流程门禁） |
| F-02 | medium | `src/db.js:160-181`（`consumeRateLimit`） | 持久化限流为“SELECT 后 UPDATE”的读改写，非原子；5 个 MCP 进程共享同一 SQLite 库，并发调用可能同时读到相同 count 后各写 +1，导致计数少记、120/min 上限可被并发突破 | 改成单语句原子 UPSERT：`INSERT ... ON CONFLICT(principal_id) DO UPDATE SET count = CASE WHEN excluded.window_start - window_start >= ? THEN 1 ELSE count + 1 END, window_start = CASE ... END RETURNING count`（或 `BEGIN IMMEDIATE` 事务） | 否（建议 G2 前修） |
| F-03 | medium | 生产进程/部署态 | 生产 5 个 DSH.exe MCP 进程 PID 32600/23424/9824/32604/9636 启动于 20:12:15–20:14:51，均早于 WP-1 代码（21:05–21:07）；WP-1 的 revoke、持久化限流、类型门在运行系统上尚未生效；`docs/phase2-g1-security-report.md:80-81` 写“WP-1 已关闭”未标注部署状态 | 重启 MCP 服务（先备份），用 121 次调用抽验 `RATE_LIMITED`、用临时角色验证吊销后 `AUTH_DENIED`；在报告中补“代码已交付、生产待重启验证” | 否（部署动作） |
| F-04 | low | `docs/governance.md:49` vs `src/store.js:130-134` | 文档称“`memory.get` 审批者/创建者可读取未批准或已过期记录”；实际 `canRead` 在 `created_by` 判断前先判过期，非审批者创建者读自己的过期记录 → `MEMORY_DENIED`（临时库实测） | 二者取一：改文档为“审批者可读过期；创建者可读自己未批准记录（过期后仅审批者）”，或调整 `canRead` 顺序并补测试 | 否 |
| F-05 | medium | `docs/governance.md:48` vs `src/retrieval.js:47-49,63-65` | 文档称“检索只返回 approved 且未过期”；实际 ids 路径 SQL 无 `status='approved'` 过滤，`push()` 允许创建者与 R0/R4 把非 approved 记录带进 packet（`retrieval.js:49`） | 收紧 ids 路径为 approved（或显式限制 R0/R4/创建者仅 `memory.get` 可见）；若属预期能力，在 governance 中写明例外 | 否 |
| F-06 | medium | `src/mcp-stdio.js:194-206`、`src/store.js:16-22` | `createGateway` 对 `routingPath` 缺失/损坏只 `catch { routing=null }`，不报错；`store.propose({routing:null})` 再回退 `config/role-routing.json` 并成功（实测 `routingPath=missing.json` 时 `context_compile` 返回 `ROUTING_UNAVAILABLE`，但 `memory_propose` 成功创建记录）。这是网关级配置失效时的 fail-open（静默改用默认策略） | 网关启动时对显式 `routingPath` 缺失/损坏直接失败退出或拒绝写工具；或把 `routingPath` 传入 `store.propose` 并在显式路径不可用时抛 `ROUTING_UNAVAILABLE`；至少向 stderr 打警告 | 否（与门禁直接相关，建议门禁前修） |
| F-07 | low | `src/store.js:65-66`、`src/mcp-stdio.js:291` | `store.propose` 用 `input.role_id || principal.roles[0]` 做 `allowed_types` 与 `provenance.agent_role`；MCP 边界删除 `role_id` 后不传绑定角色，多角色 principal（`dev-r0` roles `[R0,R4]`）会用 `roles[0]` 而非绑定角色。当前 `mcp-*` principal 均单角色，且客户端传 `role_id` 被 `INVALID_ARGUMENT` 拒绝，故暂无实际越权 | 显式接收/传递绑定角色（gateway 传 `role`，CLI 传 `--role`），并用该角色做类型门与 provenance | 否 |
| F-08 | low | `src/db.js:191`（`dbStats` expired）、`src/store.js:72-73` | `expires_at` 只做 `Date.parse` 合法性校验，不归一化；`dbStats` 用 SQL 字符串比较 `expires_at <= 'now ISO'`，与 `Date.parse` 在非规范格式（`2030-01-01`、带偏移时区）下可能不一致，导致统计与检索口径不同 | 写入时统一 `new Date(v).toISOString()`；SQL 比较也基于同一归一化格式 | 否 |
| F-09 | low | `tests/phase2/wp1.test.js` | 测试质量：revoke 用例硬编码 `DSH.exe`（依赖 `ELECTRON_RUN_AS_NODE`，未用 `process.execPath`）；限流用例只测同连接内存库，未测跨连接/重启（名称“persisted across windows”名不副实）；过期用例名称含 compiled context 但未调用 `compileContext`；迁移用例断言 `version === String(SCHEMA_VERSION)` 是自指，当前树 v4 后不再锁定 WP-1 的 v2 | 用 `process.execPath`；补跨连接/重启与窗口滚动用例；过期用例补 `compileContext`；迁移用例固定断言 v2（或按 change set 参数化） | 否 |
| F-10 | low | `docs/plan/rollback-drill.md:47` | “重新运行 `node --test`（63 用例）确认 66/66”自相矛盾（63 vs 66），且与实测 8+6+42+10=66 不符 | 改为“66 用例（ledger 8 + mcp 6 + phase1 42 + phase2 10）”并注明测试时点/树状态 | 否 |
| F-11 | low | `docs/phase2-g1-security-report.md:91` | WP-1 变更行写“66/66（ledger 7 + mcp 7 + phase1 42 + phase2 5 + wp1 5）”；实测 8+6+42+10=66，phase2 的 10 已含 wp1 5，且 ledger/mcp 数量不对 | 改为实测组成，并注明是否包含 WP-1 之外的用例 | 否 |
| F-12 | info | 生产库 | `rate_limits` 0 行、`expires_at` 全 NULL：持久化限流与过期路径没有生产数据证据（仅临时副本复现），与“旧 MCP 进程仍运行”一致 | 重启后跑一次真实调用/一条短 TTL 记忆，留存审计与行数证据 | 否 |
| F-13 | info | `config/principals.json` | `dev-r0` 的 `note` 为 mojibake（P2 遗留，非 WP-1 引入；文件本身是合法 UTF-8，Windows PowerShell 5.1 按 ANSI 读取时才显示乱码） | 可选：修正 note 编码 | 否 |
| F-14 | info | `src/store.js:135-136`、`:145-147` | `canRead` 在 `created_by` 返回后仍有 `status==='proposed'` 分支（对创建者已是死代码）；`get()` 重复校验项目（`assertProject` 后又有 `includes`） | 删除死代码/重复校验，降低后续误改风险 | 否 |
| F-15 | medium | 生产 schema v2 vs 当前树 `SCHEMA_VERSION=4`；`docs/plan/rollback-drill.md` | WP-1 交付的是 v2；当前树已是 v4（`projects`/`shares`/`orchestrator_runs`）。生产库仍 v2，下次用当前树启动会自动迁到 v4；WP-1 回滚演练只覆盖 1→2，未覆盖 2→4 与新增表回滚 | 明确部署产物：只部署 WP-1 快照，或为当前树补 v2→v4 备份/迁移/回滚演练与行数核验；部署前再备份并记录 SHA-256 | 否（部署前必须处理） |
| F-16 | info | `src/mcp-stdio.js:194-206`、内部 API | 网关对 routing 加载失败静默（无日志）；`store.get/list/review`、`retrieval.retrieve`、`compiler.compileContext` 接受调用方构造的 principal，不校验 token——本机信任模型下可接受，但任何本机脚本可直接读全部记忆（SQLite 文件亦未加密） | 明确记录信任边界；网关加 stderr 警告；如需更强隔离，后续引入进程级身份 | 否 |
| F-17 | info | `src/mcp-stdio.js` `tools/list` | `tools/list` 不需要 token（实测无 token 返回 5 个工具）；报告 §7 第 5 条已作为已接受风险记录，仅返回工具名与 inputSchema，不含项目数据 | 保持现状并在安全基线中保留该接受项 | 否 |

## 5. 对 WP-1 验收门的判定

| 验收门 | 判定 | 依据 |
|---|---|---|
| 所有安全写入入口 fail-closed | **PASS（有条件）** | propose 的类型门、`ROUTING_UNAVAILABLE`（env 场景）、角色/项目/权限校验均 fail-closed；客户端无法伪造 `role_id`；自审被拒。例外：网关 `routingPath` 缺失时静默回退默认配置仍可写（F-06），需按条件修复或在门禁记录该例外 |
| 权限测试 | **PASS** | 66/66 含角色/类型/过期/stats/revoke；手工补验：错 token → `AUTH_DENIED`、token 绑定 R2 + gateway role R4 → `AUTH_DENIED`、R2 propose L3 → `ROLE_TYPE_DENIED`、自审 → `SELF_REVIEW_DENIED`、跨项目 → `PROJECT_DENIED`、过期创建者 → `MEMORY_DENIED` |
| >200 条统计 | **PASS** | N-08 用例写入 205 条，`memory_stats` 返回 `memories=205`，不受 `list` 的 200 clamp 影响；代码按 `canRead` 过滤后全量计数 |
| 历史 L3 处置 | **PASS** | `mem_0db463660da4`、`mem_3bc9a242489d` 仍在且 approved；生产 vs 迁移前快照全表全列 0 差异；`docs/plan/p2-legacy-annotations.md` 记录来源、历史越权原因、保留/未来经批准 `deprecated` 的处置路径，可审计 |
| R4 复核 | **PASS** | 本报告；但门禁签收应在冻结快照上完成（F-01） |

**总判定：PASS（有条件）。条件（建议在 WP-1 门禁签收前完成）：**

1. 冻结并标记 WP-1 快照（逐文件 SHA-256），在冻结树上重跑 66/66 与 N-01/N-02/N-03/N-08；把 WP-2/3/4 改动从 WP-1 变更集中剥离（F-01）。
2. 把 `consumeRateLimit` 改为原子 UPSERT（F-02），并用并发/多进程探针验证 120/min 不被突破。
3. 修正 `docs/governance.md:48/49` 与实现的差异（F-04/F-05），以及 `rollback-drill.md:47`、`security-report.md:91` 的测试数表述（F-10/F-11）。
4. 网关显式 `routingPath` 缺失/损坏时 fail-closed（F-06），避免静默改用默认策略。
5. 重启生产 MCP 并用真实调用验证限流/吊销；若用当前树重启，先补 v2→v4 备份/迁移/回滚演练（F-03/F-15）。

## 6. 亲自执行的命令与关键输出（不含 token）

```
# 1) 全量测试（21:18:27；运行前后哈希不变）
node --test tests\ledger\*.test.js tests\mcp\*.test.js tests\phase1\*.test.js tests\phase2\*.test.js
→ tests 66 / pass 66 / fail 0
# 分目录：ledger 8/8、mcp 6/6、phase1 42/42、phase2 10/10

# 2) WP-1 专项
node --test tests\phase2\wp1.test.js
→ tests 5 / pass 5 / fail 0

# 3) 首次全量运行（工作树被并发改写时，21:10 左右）
→ ReferenceError: sharedRecords is not defined
   at D:\M1\mars\src\retrieval.js:100:26
   影响 tests\phase1\retrieval.test.js:32/40/49/59、tests\phase2\wp1.test.js:67

# 4) 生产库只读查询
meta schema_version='2'、contract_version='0.1.0'
counts: memories 9 / fragments 20 / manifests 22 / aliases 0 / audit 196 / rate_limits 0
expires_at 非空 0；audit MAX(ts)=2026-11-03T12:49:39.617Z
memories MAX(updated_at)=2026-11-03T12:13:51.015Z
历史 L3: mem_0db463660da4（hash 9a285d9e…21bf）、mem_3bc9a242489d（hash 07de554a…6416）均 approved、expires_at=null

# 5) 生产 vs 迁移前快照逐表逐行比较
memories 9/9、fragments 20/20、manifests 22/22、aliases 0/0、audit 196/196
所有公共列 rowDiffs=0；生产仅多 memories.expires_at 列；快照 schema_version='1'

# 6) 备份校验
node scripts\mars-db-backup.js --verify var\backups\mars-2026-11-03T13-06-51-559Z.db
→ exit 0；bytes 229376；sha256 48b9836f75eb1002ef653b4330bf6aea1f07158a3dd2929989f88e4d2ec735d2
  counts 9/20/22/0/196，rate_limits=null，integrity=ok

# 7) revoke（临时副本）
node scripts\mars-issue-mcp-identity.js --role R2 --revoke --principals <temp> --token-dir <temp>
→ {"principal_id":"mcp-R2","role":"R2","revoked":true,"token_file_removed":true,"token_value":"<redacted>"}
→ 临时 R2.token 已删除；生产 principals sha256/mtime、6 个 token 文件未变

# 8) MCP 限流/边界探针（临时库）
前 120 次 memory_stats 成功 → 第 121 次 RATE_LIMITED
关闭 gateway 重开 → 仍 RATE_LIMITED（count=124，跨连接/重启持久）
错 token → AUTH_DENIED（写 boundary 审计）
token 绑定 R2 + gateway role=R4 → AUTH_DENIED
客户端传 role_id → INVALID_ARGUMENT
非法 expires_at → INVALID_ARGUMENT（boundary 审计）
过期记忆：retrieve/compileContext 不含；R0 get 可见；创建者 get → MEMORY_DENIED
routingPath=missing.json：context_compile → ROUTING_UNAVAILABLE；memory_propose → ok（F-06）
显式空 routing {} → 回退 config 成功；MARS_ROUTING 缺文件 → ROUTING_UNAVAILABLE

# 9) 审计覆盖（临时库）
memory.propose / memory.review / memory.get / memory.list / context.compile / memory.stats 均有审计行
自审 → SELF_REVIEW_DENIED；tools/list 无 token 返回 5 个工具

# 10) Git（只读）
HEAD 07f0a1e03cc9425c5ab4092f15e6778264b7b523
staged 文件数 0；status --porcelain -uall：183 行 = mars 112 未跟踪 + 非 mars 71（1 个修改 tests/self/run.ps1）
```

## 7. 证据边界与限制

1. **工作树非静止**：WP-1 源码在 21:09:50 后被并行工作包覆盖，Git 中 MARS 全部为未跟踪文件，无法用 `git show` 重建纯 WP-1 快照；本报告对 WP-1 的判断基于 21:09–21:10 的直接阅读与 21:11:22 的临时快照（`%TEMP%\mars-snap-20261103-211122`，已含 P5 改动）。建议实施方立即补 WP-1 逐文件哈希与冻结快照（F-01）。
2. **生产环境仍是旧代码**：5 个 MCP 进程运行 20:12–20:14 版本，WP-1 的限流/吊销/类型门未在生产进程生效；生产库仍 schema v2，当前树 v4（F-03/F-15）。
3. **未做渗透/模糊测试**：仅覆盖任务指定的 bypass 场景（空 routing、`MARS_ROUTING` 缺文件、role 不一致、review 绕过、内部 API）与边界参数；未做并发压测（F-02 为代码级判断，建议补多进程并发验证）。
4. **临时副本探针**：所有写操作（propose/review/get/revoke/限流）均在 `%TEMP%` 副本；生产库只读。审计行数、count 等数字来自临时库，不能等同于生产运行证据（F-12）。
5. 报告写于 `D:\M1\mars\docs\plan\wp1-review.md`，新增文件，未 stage、未 commit。

## 8. R0 答复与当前树复测（不改判 §0–§7）

### 8.1 R0 答复记录（2026-11-03；仅记录，不作为验收证据）

R0 对四项问题的处置答复如下。均属后续动作，截至本报告落盘尚未执行，因此不改变 §0–§7 的判定与数值：

| 对应项 | R0 答复 | 状态 |
|---|---|---|
| F-01 | 确认 WP-1 后已并行推进 WP-3（sharing）与 WP-4（orchestrator），“纯 WP-1 树”不可复现；将在 WP-5 提供 WP-1 源码/测试的逐文件 SHA-256 快照清单与当时测试输出，不伪造“纯树复跑” | 未执行 |
| F-02 | 将 `consumeRateLimit` 改为事务内 upsert（单语句原子窗口）并补并发用例；`docs/governance.md` §3 两处口径核对后修正 | 部分已在当前树出现（见 8.2） |
| F-03 | 确认 5 个 MCP 进程启动于 20:12–20:14，早于 WP-1 代码；将在备份后重启 mars-r0…r4 并做真实调用抽验（role_scope/stats/限流），留存重启前后证据 | 未执行 |
| F-15 | 确认生产库 v2→v4 属部署风险；将在 WP-5 先用 `mars-db-backup.js` 生成快照，并补 v2→v4 迁移+恢复演练记录（含恢复回 v2 的步骤与校验值） | 未执行 |

### 8.2 当前树复测（R4 实测，2026-11-03 21:2x）

与 §1.1 的 WP-1 时点区分，以下为报告落盘后对**当前树**的再测量：

- **测试**：`node --test`（cwd `D:\M1\mars`）→ tests 79 / pass 79 / fail 0 / skipped 0。组成 = ledger 8 + mcp 6 + phase1 42 + phase2 11（mcp-stdio 5 + wp1 6）+ phase3 5 + phase4 7。相对 WP-1 时点 66/66（8+6+42+10）新增：wp1 第 6 例（跨连接窗口原子性）+ phase3/phase4 的 12 例。
- **wp1 测试**：`tests/phase2/wp1.test.js` 现 6 例、SHA16 `1B347BBE8C40CBB8`、mtime 21:20:34（WP-1 时点为 5 例 / 21:07:24）。
- **限流实现**：`src/db.js` 现 211 行、`SCHEMA_VERSION=4`；`consumeRateLimit`（L160-181）已是 `BEGIN IMMEDIATE` + 单条 `INSERT … ON CONFLICT(principal_id) DO UPDATE`（窗口滚动与计数在同一语句内）+ SELECT + COMMIT，异常 ROLLBACK，注释明示“one atomic UPSERT inside a write transaction”。→ **F-02 在当前树已修复**；§2 第 4 项仍按 WP-1 时点代码记为“非原子”，F-02 的最终状态应为“WP-1 时点缺陷、当前树已修复、待冻结快照复跑确认”。
- **迁移链**：仍无 `schema_migrations` 表；`initSchema` 对全部表 `CREATE TABLE IF NOT EXISTS` 后**无条件** `INSERT OR REPLACE meta.schema_version='4'`；v3/v4 仅新增表，无数据回填与逐版本迁移记录 → F-15 具体化：任何旧库首次以当前树启动都会被直接标记为 v4，且没有逐版本核验与回滚点。
- **Git（只读复核）**：HEAD 仍 `07f0a1e03cc9425c5ab4092f15e6778264b7b523`；暂存 0；`git ls-files mars` 为空（MARS 全部未跟踪，含本报告）；`git status --porcelain -uall` 201 行（随并行工作包产物增长，非本轮产生）→ 本轮无 commit/push，也未 `git add`。
- **部署态**：`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 当前 0 个 node.exe（mars-r0…r4 为 on-demand，已无常驻进程）；`rate_limits` 表仍 0 行 → F-03/F-12 的“生产运行证据缺失”依然成立；当前已无法在线复验 20:12–20:14 的旧进程，只能依赖原先记录的进程启动时间。

### 8.3 判定与条件状态（不变）

- **WP-1 结论：PASS（有条件）**；阻断项仍为 F-01。
- 条件状态（截至 21:2x）：

| # | 条件 | 状态 |
|---|---|---|
| 1 | 冻结 WP-1 快照（逐文件 SHA-256）并在冻结树重跑 66/66 | 未完成（待 WP-5） |
| 2 | `consumeRateLimit` 原子 UPSERT + 并发用例 | **当前树已满足**（db.js 原子 UPSERT + wp1 第 6 例），仍需在冻结快照上复跑 |
| 3 | 修正 `governance.md:48/49`、`rollback-drill.md:47`、`phase2-g1-security-report.md:91` 三处口径 | 未完成 |
| 4 | 网关 `routingPath` fail-closed（F-06） | 未完成（当前树未见该改动） |
| 5 | 重启生产 MCP 做真实调用验证 + 补 v2→v4 迁移/回滚演练 | 未完成（当前无常驻进程、`rate_limits` 0 行） |

- 综上：WP-1 **不因当前树的部分修复而升级为无条件通过**——条件 1/3/4/5 未关闭，且 F-01 属可复现性问题；但 8 项声称改动在 WP-1 时点均有实测证据，故维持 PASS（有条件），不下调为 PARTIAL。
- 边界：本节只追加复测记录，未修改 §0–§7 的判定与数值；未修改 `src/`、`contracts/`、`scripts/`；未 stage/commit/push。
