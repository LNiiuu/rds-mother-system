# MARS WP-5 最终独立审查报告（R4-审查）

- 审查对象：MARS P2–P6 收尾 / WP-5 集成
- 审查者：RDS 母体系 R4-审查（独立安全/质量审查）
- 审查时间：2026-11-03 21:26–21:35（Asia/Shanghai）
- 仓库：`D:\M1`；MARS 根：`D:\M1\mars`
- 结论：**PARTIAL**

## §0 结论

**总体结论：PARTIAL。当前候选版本不具备冻结条件。**

代码主路径与 80 项测试均通过，网关 fail-closed、生产库完整性、备份 SHA 与恢复演练均经独立复核成立。但候选冻结清单在审查期间被重生成，且新清单的自指条目大小与 SHA-256 均错误，并包含两个 0 字节垃圾文件；验收报告仍有未替换的模板占位符；长会话压力证据当前不可复现；压力测试的 `leaks=0` 判据为空转；回滚与部分文档存在过时/过宽描述。上述问题修复并重新发布冻结指纹前，不应宣布冻结。

| # | 核验项 | 结论 |
|---|---|---|
| 1 | 全量测试 80/80、EXIT=0 | PASS |
| 2 | 候选冻结清单 117 文件 / 913,402 B / SHA-256 55cae3…6544 | PARTIAL |
| 3 | Git HEAD、分支、暂存、跟踪状态、origin 无新 push | PASS |
| 4 | 网关 fail-closed，先 routing 后开库，不泄漏 DB | PASS |
| 5 | 生产库 schema 4、8 表、声明行数、integrity ok | PARTIAL |
| 6 | 回滚文档/步骤可执行、备份 SHA 与恢复数值 | PARTIAL |
| 7 | 压力脚本可复跑、leaks=0、p50/p95、长会话证据 | PARTIAL |
| 8 | README 与 docs 同实现/测试一致 | PARTIAL |
| 9 | 明文凭据扫描与 `.gitignore` 覆盖 | PASS |
| 10 | 边界：未访问旧项目、无 commit/push、未改 DSH 全局配置 | PARTIAL |

## §1 方法与检查清单

- 所有结论来自本次亲自读取文件、运行命令、查询数据库副本；未采信 R0 自述。
- 运行环境：Windows；Git `D:\Tools\Git\bin\git.exe`；Node `node v24.21.0`（PATH）。`DSH.exe` 以 `ELECTRON_RUN_AS_NODE=1` 运行测试时无输出且 `$LASTEXITCODE` 为空，未采信该次结果，改用 PATH 中 node 重跑。
- 数据库一律只读：生产库先复制 `mars.db` 与 `-wal`/`-shm` 到 `%TEMP%` 再查询；备份在 `%TEMP%` 副本上做迁移演练；未对 `var/mars.db` 执行任何写操作。
- 未执行任何 git 写操作（add/commit/push/reset/clean 均未运行）；HEAD 审查前后不变。
- 全程未联网；未访问 `D:\Projects\xingrixiao` 与 `D:\新建文件夹 (6)\wxxcx\rwgl`。
- 未打印 `config/principals.json` 与 `var/mcp/tokens/*` 的明文；仅检查存在性、大小、ACL、`.gitignore` 覆盖和（分类后的）模式命中。
- 本报告是本轮唯一新建的仓库文件（UTF-8 无 BOM）。临时探针脚本、数据库副本均在 `%TEMP%` 且已删除；`var/` 下无审查写入。
- 候选清单是移动目标：本报告采用 2026-11-03T21:34:07+08:00 的读取值，并在 §2.2 同时记录 21:27 与 21:29 两个快照。报告写入后，清单需要再次重生成才能覆盖 `wp5-review.md`。

## §2 逐项结果

### 2.1 全量测试 — PASS

命令：

```powershell
cd D:\M1\mars
node --test
```

结果：`tests 80`、`pass 80`、`fail 0`、`EXIT=0`、`duration_ms 2037.86`。共 15 个 `tests/**/*.test.js`。

逐文件 TAP 计数：`ledger 8`、`mcp 6`、`phase1 42`（authz 5、budget 3、ledger-reconcile 4、lifecycle 5、manifest 5、mcp-server 4、remediation 6、retrieval 6、rollback-offline 4）、`phase2/mcp-stdio 6`、`phase2/wp1 6`、`phase3 5`、`phase4 7`；合计 80。

说明：测试总数与 R0 声明一致；但 `ledger 7 + mcp 7` 的分布错误，实际为 `8 + 6`（见 2.8）。

### 2.2 候选冻结清单 — PARTIAL

**21:27 快照（R0 声明值）**

- `file_count = 117`，`files` 数组 117 条，声明字节和 `913,402`。
- 清单文件 SHA-256：`55cae3bdd69f76157bb038f6b4477b402ddb211f95da4fcc62b0c67fac596544`，与 R0 声明一致。
- 对全部 117 个文件逐一重算 SHA-256 与大小：`missing=0`、`mismatched=0`，抽查要求（≥5）由全量复核覆盖。
- `excluded = ["var/**", "config/principals.json"]`，清单不含 `var/**` 与 `config/principals.json`。
- 但清单包含两个 0 字节垃圾文件：仓库根 `c.name).join('`（mtime 21:14:44）与 `x.name)`（mtime 21:20:57），二者 SHA-256 均为空串哈希 `e3b0c442...b855`；还包含本地 `experiments/p4/var/bench.db`（196,608 B）。
- 清单未包含自身与 `docs/plan/wp5-integration.md`（后者 21:26:09 生成，晚于清单 21:25:55）。

**21:29:10 重生成快照（审查期间）**

- 文件数 `121`；声明总字节 `770,071`，实际求和 `769,871`。
- 清单文件实际大小 `30,091 B`，SHA-256 `fae89b0bb2cca674da627da29cc1818dda6ca00e779c0ef9a6336638db09b98a`。
- `excluded = ["var/**", "experiments/p4/var/**", "config/principals.json"]`；当前无 `var/` 条目，`experiments/p4/var/bench.db` 已排除。
- 仍包含两个 0 字节垃圾文件；开始包含自身与 `wp5-integration.md`。
- 逐文件校验：`missing=0`、`mismatched=1`。唯一不一致就是清单自身：条目声明 `size 30,291`、`sha256 acfa1d63ade2b9e069613c1a70f8a27a915142b0672fad5c5247b0a3cdef3669`；实际 `30,091`、`fae89b0b...b98a`。这是自指哈希/大小的生成器设计错误，导致冻结指纹不可验证。

**21:34:07 最终读取**：mtime 仍 `2026-11-03T21:29:10`，size `30,091`，SHA-256 `fae89b0b...b98a`，`declared 121 / 770,071`，`actual 121 / 769,871`，`mismatched=1`；`wp5-review.md` 当时尚不存在。

结论：R0 声明的旧指纹在其读取时点成立，但当前候选清单已不是该指纹；当前清单无法通过其自身条目验证，且把垃圾文件冻结进候选。故 PARTIAL，不能作为可冻结候选。

### 2.3 Git 状态 — PASS

命令与结果：

```powershell
D:\Tools\Git\bin\git.exe rev-parse HEAD
# 07f0a1e03cc9425c5ab4092f15e6778264b7b523
git branch --show-current            # main
git diff --cached --stat             # 空，暂存 0
git status --porcelain -uall         # 192 行
git remote -v                        # origin https://github.com/LNiiuu/rds-mother-system
git rev-list --left-right --count HEAD...origin/main   # 0    0
```

- `mars/` 侧 121 条全部未跟踪；`mars` 下被 git 跟踪文件数为 0。
- 非 `mars` 侧 71 条：70 条未跟踪 + 1 条修改（`tests/self/run.ps1`）。
- 当前 121 个 `mars` 未跟踪路径与清单 121 条完全相等（`only_git=0`、`only_manifest=0`）；但两者都包含上述垃圾文件。
- 本地与远端 reflog 只有 2026-11-01 的初始提交/推送记录；`origin/main = HEAD`，无 P2–P6 的新 commit，也没有新 push。

### 2.4 网关 fail-closed — PASS

代码：`src/mcp-stdio.js:194-214` 的 `createGateway` 先 `loadRouting(...)`，成功后才 `openDb(...)`；routing 加载/解析失败进入 catch，构造 `new Error('ROUTING_UNAVAILABLE: routing config missing or invalid: ' + resolvedRoutingPath)` 并设置 `e.code = 'ROUTING_UNAVAILABLE'`，此时尚未打开 DB。只有 principals 加载失败的分支才调用 `db.close()`。`src/authz.js:15-19` 的 `loadRouting` 校验 `data.roles`。

独立探针（临时目录，未使用生产库）：routing 文件缺失与 malformed JSON 两种情形均返回 `code=ROUTING_UNAVAILABLE`，且探测 `db_exists=false`。即失败时没有创建/泄漏 DB 文件。

测试：`tests/phase2/mcp-stdio.test.js:89-107` 有 `assert.throws(/ROUTING_UNAVAILABLE/)` 断言，但未断言“DB 文件未创建/句柄未泄漏”。实际行为已由代码与独立探针覆盖，故该项整体 PASS；测试缺口列为 acceptable（A-03）。

### 2.5 生产库只读检查 — PARTIAL

对 `var/mars.db` 连同 `-wal`/`-shm` 复制到 `%TEMP%` 后只读查询（生产库未写）：

- `meta.schema_version = 4`。
- `PRAGMA integrity_check = ok`。
- 表 `memories`、`fragments`、`manifests`、`audit`、`projects`、`shares`、`orchestrator_runs`、`rate_limits` 均存在。
- 行数：`memories 9`、`fragments 21`、`manifests 23`、`audit 201`、`rate_limits 2`；`projects`、`shares`、`orchestrator_runs`、`aliases` 均为 0。
- 主库 176,128 B；WAL 2,710,992 B（未 checkpoint）。

R0/文档声明为 `9 / 20 / 22 / 196`、`rate_limits 0`。差异可由文档 §2 记录的两笔合法调用解释：`2026-11-03T13:21:56` 的 `context_compile`（packet `pkt_4554676788d5`，406 tokens）和 `13:22:06` 的 `memory.stats`，合计新增 1 fragment、1 manifest、5 audit、2 rate_limits。独立查到 `man_ebb8876ea5fd`（task `WP5-R3-RESTART-001`、role R3、`tokens_estimated=406`、`budget=600`、created `2026-11-03T13:21:56.188Z`），与文档 406 tokens 一致。

结论：库结构、完整性与数据本身 PASS；“声明行数”已过时，故该项 PARTIAL。修复方式是将验收文档改成带时点的快照，而不是改库。

### 2.6 回滚证据 — PARTIAL

- 备份 `var/backups/mars-2026-11-03T13-20-52-532Z.db`：245,760 B，SHA-256 `4ee89fd25b4c5c9d22735fc62fab78d911240682971688f96786498c3b8d114d`，与要求完全一致。
- 该备份只读检查：`schema_version=2`、`integrity_check=ok`、行数 `9/20/22/196`、`rate_limits=0`，无 `projects/shares/orchestrator_runs`。
- 另一个 `mars-2026-11-03T13-06-51-559Z.db`：229,376 B，SHA-256 `48b9836f75eb1002ef653b4330bf6aea1f07158a3dd2929989f88e4d2ec735d2`，`schema_version=1`，同计数。
- 恢复演练：备份复制到 `%TEMP%` 后调用 `openDb` 迁移，结果 `schema_version=4`、`integrity=ok`，行数保持 `9/20/22/196`，新表为 0，`expires_at` 为 TEXT。`node scripts/mars-db-backup.js --verify <13-20-52 备份>` 退出 0，SHA 与计数和实测一致。
- `docs/plan/wp5-integration.md:34-40` 的 5 步回滚可执行：`mars-mcp-disable.ps1 -Yes` 支持 `SupportsShouldProcess` 且先备份 registry；`mars-db-backup.js` 支持 `--db/--out-dir/--verify`；手工覆盖主库并删除 `-wal`/`-shm`；按清单复核；全量测试与 schema 校验。
- 但 `docs/plan/rollback-drill.md` 已陈旧：标题仍为 WP-1，§2 写 v1→v2，§3 期望 schema 2，§5.6 又写确认 schema 4；§1 快照指向 13-06-51（schema v1），与当前 v4/最终快照 13-20-52 不一致。
- `scripts/mars-rollback.ps1:15` 实际只删除 `var` 内匹配 `^mars\.db(\.|$)|\.json$|\.csv$` 的文件；不删除 `mars.db-wal`/`mars.db-shm`（文件名中的 `-` 不匹配），也不删除 token 目录。`README.md:61` 的“删除 var/ 与可选 principals”、`docs/mcp-access.md:80-81` 的“仅删除 mars/var/，可选删除 MCP token 目录”均比脚本实际能力宽。

结论：备份 SHA 与恢复演练数值 PASS；回滚文档/脚本描述不一致，故 PARTIAL。

### 2.7 压力与长会话证据 — PARTIAL

压力复跑：

```powershell
cd D:\M1\mars
node scripts/wp5-stress.js
# EXIT=0, 5129ms
# {"ok":true,"leaks":0,
#  "latency_ms":{"p50":19.52,"p95":22.85,"max":66.46},
#  "tokens_by_role":{"R0":"305-306","R1":"297-298","R2":"189-190","R3":"345-346","R4":"293-294"}}
```

- token 范围与 `wp5-integration.md` 完全一致。
- p50/p95/max 与文档的 20.76/25.83/49.4 同量级但不同，属可接受的跑间波动（A-01）；但文档若声称可精确复现，应改为区间或同机多次统计。
- `scripts/wp5-stress.js:13-16` 只复制 `var/mars.db`，不复制 `-wal`/`-shm`，临时库可能落后于生产已提交数据。
- `:40` 的泄漏判据只检查 `mem_251512804a4f`，且只对非 R0/R4 角色检查。查库确认该记忆为 `proposed` 且 `visibility=project`，永远不可能进入编译上下文，因此 `leaks=0` 是空转判据，不能证明角色隔离。应改为通用判据：任何非 approved 或不可见记录不得出现在其他角色的 packet 中。
- 长会话证据不可复现：文档称 R3 会话 `session.v4.jsonl.zstd` 6,382,820 B → 586 usage 事件、total 92,650,303。实测 `C:\Users\liuch\.dsh\sessions` 下 119 个 `*.jsonl.zstd`，无 6,382,820 B 文件；逐个解析全部 119 个，`events=586` 或 `total=92,650,303` 的匹配为 0，events 560–610 的也没有；`D:\M1` 与 `AppData\Roaming\DSH` 也未找到该精确大小文件。该证据目前无副本、无哈希，不能作为冻结依据。

结论：脚本可复跑且 p50/p95 有记录，但泄漏判据空转、快照不含 WAL、长会话证据缺失，故 PARTIAL。

### 2.8 文档一致性 — PARTIAL

- `docs/governance.md:48` “编译上下文与检索只返回 approved”：与 `src/retrieval.js:51` 的 `if (record.status !== 'approved') return;`、`src/sharing.js:158` 的 `if (row.status !== 'approved') continue;` 一致；`src/store.js:130-139` 的审批者/创建者/过期规则也与 governance §3（行 49）一致。**核心安全声明一致。**
- `docs/sharing.md:82` 的 5/5 与实测 `tests/phase3/sharing.test.js` 5 项一致。
- `docs/orchestration.md:65` 的 7 用例与实测 phase4 7 项一致。
- `README.md:54` 仍写“全量 61 用例（14 ledger/mcp + 36 phase1 + 6 remediation + 5 Phase 2）”，与实测 80 不符；同文件 `:77` 又写 80。
- `README.md:61` 与 `docs/mcp-access.md:80-81` 的回滚/删除范围比脚本实际能力宽（见 2.6）。
- `docs/mcp-access.md:88` 称“未实现调用频率的持久化计数（当前按进程内每分钟 120 次）”，但 `src/mcp-stdio.js:250` 已调用 `consumeRateLimit(db, principal.principal_id, MAX_CALLS_PER_MINUTE, 60000)` 写入持久表 `rate_limits`（当前 2 行）；同文件 `:36-39` 又正确描述 fail-closed。该句必须改为“已持久化限流”。
- `docs/plan/test-report.md:20-21`、`docs/p2-p6-acceptance.md:55`、`docs/plan/wp5-integration.md:11` 的 `ledger 7 + mcp 7` 分布与实测 `8 + 6` 不符。
- `docs/plan/wp5-integration.md:12` 的库计数 `9/20/22/196, rate_limits 0` 已过时；`:15` 的 `117 / 913,402 / 55cae3 / 28,940 B` 随 21:29 重生成而失效（当前 121 / 770,071 / fae89b0b / 30,091 B，且自指条目错误）；`:21` 的 406 tokens 已验证正确。
- `docs/p2-p6-acceptance.md` 仍有未替换占位符：`:67` `{{MANIFEST_FILES}}`/`{{MANIFEST_BYTES}}`/`{{MANIFEST_SHA}}`，`:68` `{{GIT_LINES}}`/`{{MARS_LINES}}`，`:74` `{{R4_VERDICT}}`，`:75` `{{R4_ISSUES}}`；§6 仍等待本报告，不能称“最终验收完成”。
- `docs/p4-cost-quality-report.md` 行 13 的“12 条相关已批准记忆”与 fixture 不符：`experiments/p4/var/bench.db` 中 32 条记忆，approved 31、proposed 1；相关 approved 约为 9 条 D/F/K + S1 + T1 = 11 条，N1 为 proposed。其余 P4 数字复核正确：base 22/24（92%）、mars 23/24（96%）；usage 与 prompts 字节数均与报告一致。

结论：治理/共享/编排核心实现一致；README、mcp-access、验收与测试报告存在多处事实性过时，故 PARTIAL。

### 2.9 安全 — PASS

- 对 `mars` 下文本文件（排除 `var/`、`.git/`，分类阶段排除 `config/principals.json`）扫描：`private-key`、`password`、`apikey`、`bearer` 等模式 0 命中；40+ 字符长串全部归类为十六进制 SHA/MD5（含 docs 基线、phase1 报告、checks、manifest 等），无 base64/其他 token 形态。`config/principals.example.json` 的 2 条均为 SHA-256 哈希。
- 未打印 `config/principals.json` 与 `var/mcp/tokens/*` 内容。token 文件存在：R0–R4 各 44 B（mtime 20:04:41），`UNKNOWN.token` 37 B（20:11:38）。
- `.gitignore`（实际 UTF-8，5 行）：`:2 var/`、`:3 *.log`、`:5 config/principals.json`。`git check-ignore -v` 确认 `var/mars.db`、`var/backups/x.db`、`var/mcp/tokens/R0.token`、`config/principals.json`、`experiments/p4/var/bench.db` 均被 `mars/.gitignore` 忽略；`mars` 下被跟踪文件为 0。
- `src`/`scripts`/`tests` 未发现 `node:http|https|net|dns|tls`、`fetch`、`XMLHttpRequest`、`WebSocket` 或 http(s) URL，代码层未见联网。
- 风险提示（acceptable）：`config/principals.json` 与 token 目录 ACL 为 Administrators/SYSTEM FullControl、Authenticated Users Modify、Users ReadAndExecute，偏宽；单机开发环境可接受，建议收紧到当前用户/管理员。

### 2.10 边界 — PARTIAL

- 未执行任何 git 写操作；HEAD 保持 `07f0a1e0...b523`，`origin/main = HEAD`，无新 commit/push。
- 未访问 `D:\Projects\xingrixiao` 与 `D:\新建文件夹 (6)\wxxcx\rwgl`；因此“R0 未访问/未改动这两个目录”无法由本审查独立核验（A-06）。
- 未联网；未修改 `mars` 中除本报告外的文件。
- 但 DSH 全局登记表 `C:\Users\liuch\.dsh\skill-mcp-manager\registry.json` 的 mtime 为 `2026-11-03T21:22:01.998`（审查期间），6 个 entry 中 5 个为 `mars-r0..r4`（on-demand/stdio，env 含 `MARS_*` 与 `MARS_BUILD`）。这说明 `mcp_register` 注册 5 个 MARS 服务时确实改动了 DSH 全局注册表。R0 的“不修改 DSH 全局配置”绝对表述不成立；若限定为“仅通过 mcp_register 注册 5 个 MCP 服务，不改 profile/插件/其他配置”，则与事实相符。故该项 PARTIAL。

## §3 问题清单

### Must-fix（冻结前必须处理）

| ID | 严重度 | 证据 | 建议修复 |
|---|---|---|---|
| F-01 | 高 | 当前 `candidate-manifest.json` 自指条目声明 30,291 B / `acfa1d63...3669`，实际 30,091 B / `fae89b0b...b98a`；声明字节和 770,071 vs 实际 769,871；含两个 0 B 垃圾文件 `c.name).join('`、`x.name)`；清单在 21:29 审查期间被重生成，旧指纹 55cae3 失效 | 修改生成器：排除清单自身与 0 B 垃圾文件，删除两个垃圾文件，重生成并输出可独立复核的 SHA（不要把自身哈希写入自身）；将 `wp5-review.md` 纳入；更新 `wp5-integration.md`/acceptance 的清单数值 |
| F-02 | 高 | `docs/p2-p6-acceptance.md:67-68,74-75` 仍有 `{{MANIFEST_FILES}}`、`{{MANIFEST_BYTES}}`、`{{MANIFEST_SHA}}`、`{{GIT_LINES}}`、`{{MARS_LINES}}`、`{{R4_VERDICT}}`、`{{R4_ISSUES}}` 占位符；§6 仍称等待审查 | 用本报告与最终清单值替换全部占位符，明确验收日期/结论；不要在该文件仍含模板时宣称“最终验收完成” |
| F-03 | 高 | 长会话证据 6,382,820 B / 586 events / 92,650,303 在 `C:\Users\liuch\.dsh\sessions` 的 119 个 zstd 文件中均无匹配；无副本/哈希 | 提供该会话文件的副本与 SHA-256，或撤回该指标并删除对应文档数字；若保留，写明采集时间与可复现命令 |
| F-04 | 中高 | `scripts/wp5-stress.js:13-16` 不复制 `-wal/-shm`；`:40` 只检查固定 `mem_251512804a4f`，而该记忆为 proposed+project，永远不可见，`leaks=0` 为空转 | 复制 db+wal+shm（或用 SQLite backup API/VACUUM 生成一致快照）；改为通用断言：任何非 approved/不可见记录不得出现在其他角色 packet；至少覆盖一个真实 role-private 与一个 proposed 标记 |
| F-05 | 中 | `rollback-drill.md` 标题/版本/快照（WP-1、v1→v2、schema 2、13-06-51）与当前 v4/13-20-52 不一致；`mars-rollback.ps1:15` 不删 wal/shm 与 token 目录，但 README:61、mcp-access.md:80-81 声称可删 var/ 与 token | 重写 rollback-drill 为当前 v4/13-20-52 流程；修正脚本或把文档改成“仅删除指定数据库/JSON/CSV，wal/shm 与 token 需手工处理”；补一次在临时副本上的演练记录 |
| F-06 | 中 | 多处文档与实现/实测不一致：`mcp-access.md:88` 称限流未持久化（实际 `src/mcp-stdio.js:250` 已持久化）；`README.md:54` 仍 61 用例；`test-report.md:20-21`、`p2-p6-acceptance.md:55`、`wp5-integration.md:11` 的 7+7 分布（实际 8+6）；`wp5-integration.md:12` 旧库计数、`:15` 旧清单数值 | 统一改为 80/80 与 8+6；限流句改为“rate_limits 持久化，120 次/分钟”；库计数改为带时点快照（如 21:34 的 9/21/23/201/2）；清单数值等 F-01 重生成后同步 |

### Acceptable（记录，不阻塞冻结）

| ID | 说明 | 依据 |
|---|---|---|
| A-01 | 压力 p50/p95/max 与文档不同：复跑 19.52/22.85/66.46，文档 20.76/25.83/49.4 | 同量级、不同跑次；建议文档写成区间/多次统计 |
| A-02 | 生产库计数相对验收声明漂移：9/21/23/201/2 vs 9/20/22/196/0 | 由 13:21:56 context_compile 和 13:22:06 memory.stats 的合法调用解释；非损坏 |
| A-03 | `tests/phase2/mcp-stdio.test.js:89-107` 只断言抛 `ROUTING_UNAVAILABLE`，未断言 DB 未创建 | 代码与独立探针已验证 fail-closed；建议补断言 |
| A-04 | `config/principals.json` 与 token 目录 ACL 偏宽（Authenticated Users Modify / Users Read） | 单机开发环境可接受；建议收紧 ACL |
| A-05 | DSH 全局 registry 在 21:22 被修改（注册 5 个 MARS 服务） | 属 `mcp_register` 的必要操作；但 README:47、acceptance:16 的“完全不改 DSH 全局配置”应改为限定表述 |
| A-06 | `xingrixiao` 与旧项目 `rwgl` 无法独立核验 | 任务禁止访问这两个目录；只能声明审查者未访问 |
| A-07 | P4 报告行 13 “12 条相关已批准记忆”不准确 | fixture 中 approved 31、proposed 1；相关 approved 约 11（9 D/F/K + S1 + T1）；不影响 P4 主结论 |

## §4 与 R0 自述的差异

1. **测试分布**：R0 称 `ledger 7 + mcp 7`；实测 `ledger 8 + mcp 6`。总数 80/80 一致。
2. **候选冻结指纹**：R0 声明 117 文件 / 913,402 B / SHA `55cae3...6544`。该值在 21:27 读取时成立；但清单于 21:29 被重生成，当前为 121 文件 / 770,071 声明 / `fae89b0b...b98a`，且自指条目大小与 SHA 均错误。R0 的“已冻结”结论在报告写入时点不成立。
3. **生产库计数**：R0 声明 9/20/22/196、rate_limits 0；当前只读快照为 9/21/23/201/2（可由 13:21/13:22 合法调用解释）。需要带时点表述，不能当作当前值。
4. **压力数字**：R0 文档写 p50 20.76 / p95 25.83 / max 49.4；复跑为 19.52 / 22.85 / 66.46。token 范围完全一致；`leaks=0` 因判据空转不能作为隔离证明。
5. **长会话证据**：R0 文档称 6,382,820 B / 586 events / 92,650,303；审查在 119 个会话文件中未找到任何匹配，当前不可复现。
6. **验收完成度**：R0/文档倾向“最终验收完成”；`p2-p6-acceptance.md` 仍含 7 个未替换占位符，§6 仍等待本审查，不能称最终完成。
7. **回滚描述**：R0 文档暗示脚本可清理 var/ 与可选 token 目录；实际 `mars-rollback.ps1` 不删 wal/shm，也没有 token 目录删除开关；`rollback-drill.md` 仍停留在 WP-1/v1→v2 叙事。
8. **DSH 全局配置**：R0 绝对表述“不修改 DSH 全局配置”；实际 `registry.json` 在 21:22 被 `mcp_register` 改动（仅注册 5 个 MARS 服务，未见 profile/插件改动）。
9. **P4 报告**：主要 score/usage/prompts 数字均可复算；“12 条已批准”应约为 11。
10. **网关**：R0 的 fail-closed 自述与实现、探针一致；仅测试断言强度不足，不影响实际安全属性。

## §5 证据边界

- 所有数据库检查均在 `%TEMP%` 的只读副本上进行；生产 `var/mars.db` 未被写入，审查前后主库/WAL 大小与内容未改动（WAL 未 checkpoint 属既有状态）。
- 备份恢复演练只在 `%TEMP%` 副本上执行，未覆盖、未替换生产库。
- 临时探针脚本与临时数据库副本均已删除；仓库内本轮唯一新增文件是本报告。
- 未执行 git add/commit/push/reset/clean；HEAD、分支、暂存区未变。
- 未联网；未访问任务禁止的两个目录；无法证明 R0 是否访问过它们，只能证明本审查者未访问。
- 未打印 `config/principals.json` 与 `var/mcp/tokens/*` 的明文；仅检查存在性、大小、ACL、`.gitignore` 与分类后的模式命中。
- 候选清单是活动文件：本报告数值截点为 2026-11-03T21:34:07+08:00。报告写入后，`wp5-review.md` 本身也会成为未跟踪文件，且不在当前清单中；必须在 F-01 修复后重生成清单，并重新发布清单 SHA。
- 测试运行使用 PATH 的 `node v24.21.0`；`DSH.exe` 直接跑测试未产生可用输出，故未将其结果作为证据。
