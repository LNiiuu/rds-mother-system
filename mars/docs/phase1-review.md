# MARS Phase 1 独立审查（R4）

版本：v1.0（2026-11-03 19:2x–19:3x +08）
审查对象：`D:\M1\mars`（Phase 1 实现与文档）
审查人：R4（独立复核；未参与实现、未修改任何源文件）

## 0. 快照与方法

审查时快照（`lines / bytes / sha256前16`）：

| 文件 | 行 | 字节 | SHA16 |
|---|---|---|---|
| docs/architecture.md | 583 | 37,710 | `79EB0762BC526004` |
| docs/interfaces.md | 102 | 5,988 | `2013C79A96A3DB59` |
| docs/security.md | 63 | 3,882 | `271728487C902E8E` |
| docs/mcp.md | 104 | 5,366 | `8CA4A4DA3AA8E489` |
| docs/phase1-test-report.md | 208 | 18,836 | `AF4444943A452EC6` |
| contracts/context-packet.schema.json | 69 | 2,518 | `D4F75AE3DD686B79` |
| contracts/memory.schema.json | 54 | 2,331 | `DE22C01AC8DE1A4A` |
| src/retrieval.js | 101 | 3,907 | — |
| src/compiler.js | 137 | 6,344 | — |
| src/manifest.js | 113 | 5,466 | — |
| src/validate.js | 74 | 3,164 | — |

方法：静态阅读全部 `src/*.js`、`contracts/*`、`config/*`、`scripts/*`、关键文档；在内存/临时库上运行探针（不落 `mars/var`）；亲自复跑 CLI 与测试；用只读方式核对 Git（`wsl.exe git` 读取，Windows 侧 `D:\Tools\Git\bin\git.exe` 核对基线）。

边界：本审查只读；未修改 `src/`、`tests/`、`contracts/`、`config/`；未联网；未改 DSH 配置；未 git 写。

## 1. 结论

**PARTIAL（有条件通过）**：0 blocker / **2 high** / 4 medium / 5 low / 2 info。

按任务规则「0 blocker + 0 high 才能 PASS」，本审查**不能**给出 PASS。两条 high 均为**未在 `architecture.md` §9 披露**的授权/编译语义缺陷，必须在启用（或 A2 基线）前修复：

- **P1 high**：`restoreFragment` 只校验 `principal.project_ids` 与角色 profile，**不校验 principal 是否真的持有该 role_id**；任一项目成员可用 `--role R3/R4/R6` 读出本应仅 `evidence_direct` 角色可见的片段原文。
- **P2 high**：`compileContext` 把 `query` 传给每个按类型检索，而 `retrieve()` 只在结构化分支按 `type` 过滤；FTS/LIKE 分支会把**任意 allowed 类型**压入结果，导致同一 L2 事实同时出现在 facts/decisions/knowledge 三段，并使 `decisions` 缺失的 blocking 阈值被错误满足。

其余 4 项 medium 为契约执行缺口（`maxItems` 等未实现）、manifest 状态写死、以及两处文档 [FACT] 陈述与实现不符；low/info 为可用性与一致性问题。

## 2. 复跑记录（本机，2026-11-03）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `node --test`（cwd `D:\M1\mars`，无参数） | 0 | `tests 50 / pass 50 / fail 0 / skipped 0 / 1,518.8ms` |
| `node --test tests/ledger/ledger.test.js tests/mcp/mcp.test.js "tests/phase1/*.test.js"`（README 命令） | 0 | 同上 50/50（glob 可用） |
| `node --test tests/`、`node --test tests/phase1/` | 1 | `MODULE_NOT_FOUND`（目录参数不被接受；报告 §3 已自注） |
| `node src/cli.js ledger --session <R7 会话> --out <temp> --db <temp>` | 0 | `total=41,597,577`、`events=323`、`sid=adc6af6c…` |
| 独立逐帧 `zstdDecompressSync` 复算（R4 自写脚本） | 0 | `events 323 / input 812,781 / output 499,100 / cacheRead 40,285,696 / cacheWrite 0 / total 41,597,577`（与 CLI/R3 完全一致） |
| `node src/cli.js mcp`（无 `--enable`） | 5 | `MCP 网关默认禁用…` |
| `node src/cli.js mcp --enable`（stdin 空） | 0 | 启动后打印 `MARS_MCP_NOT_REGISTERED` 警告，无监听 |
| `powershell -ExecutionPolicy Bypass -File scripts/mars-rollback.ps1`（干跑） | 2 | 列出 `var/baseline-now.json`、`var/mars.db`；`未加 -Yes，未执行删除` |
| `powershell -ExecutionPolicy Bypass -File scripts/mars-baseline.ps1` | 0 | `preMarsUntracked 70 / preMarsModified 1 / preMarsSha256 8159a7ad… / matchesPhase0 true` |
| CLI 端到端（临时库：init→put→review→compile→fragment→audit） | 0 | 见 §3.4、§4.2、§5.4 |

> 说明：本机 PowerShell 默认执行策略禁止运行 `.ps1`，上述脚本以 `-ExecutionPolicy Bypass` 只读干跑；未使用 `-Yes`，未删除任何文件。

## 3. 必查项 1：契约一致性

### 3.1 interfaces.md 声明 vs 实现

逐条核对 `docs/interfaces.md` §3 的签名：`loadPrincipals/loadRouting/authenticate/authorize/roleProfile/isApprover`、`propose/get/list/review/canRead/addAlias`、`retrieve`、`applyBudget`、`buildManifest/restoreFragment`、`compileContext`、`parseSession/buildLedger/reconcile/toCsv`、`createServer/start` 全部存在且签名一致。

**不一致 1 处（P7 low）**：`docs/interfaces.md:53-55` 把 `estimateTokens(text)` 标注在 `// budget.js` 下，实际实现位于 `src/util.js`（`budget.js` 仅导出 `applyBudget`、`KIND_PRIORITY`、`isProtected`）。调用方按文档写 `require('./src/budget').estimateTokens` 会得到 `undefined`。

### 3.2 contracts vs 实际产出

- `context-packet`：`compileContext` 生成后调用 `validate(packet, PACKET_SCHEMA)`，失败抛 `PACKET_SCHEMA_INVALID`（`src/compiler.js:124-128`）；实测 5 个角色 packet 均通过校验。
- `manifest`：实测条目含 `source_ref/source_version/content_hash/content_type/inclusion_reason/token_estimate/visibility/status/section/memory_id/fragment_id`，并落库（`manifests` 表）。
- `ledger`：`buildLedger()` 输出经 `validate(book, LEDGER_SCHEMA)` 为 `valid=true`；键为 `version/generated_at/source/sessions/totals/cost/reconcile/warnings`。
- `memory`：`store.propose` 用 `MEMORY_SCHEMA` 校验；`memory_type='L9'` 被拒（`MEMORY_SCHEMA_INVALID`），枚举生效。
- **schema 关键字执行不完整（P4 medium）**：`src/validate.js` 只实现 `type/const/enum/pattern/min|maxLength/min|maximum/required/properties/additionalProperties/items`，**未实现** `format/maxItems/minItems/uniqueItems/oneOf/$ref`。实测 `memory.schema.json` 的 `tags: maxItems 32` 未被执行——提交 33 个 tags 被接受（探针 `tags:Array.from({length:33})` → `ACCEPTED`）。

### 3.3 packet 结构与 manifest

- 段落 `kind` 固定 7 值，均通过 packet schema；`truncated` 字段由 `budgeted.truncated` 映射（`src/compiler.js:115-119`）。
- **P3 medium**：`buildManifest` 对每条 entry **硬写 `status: 'approved'`**（`src/manifest.js:51`），而不是取来源记忆的真实状态。当前 compiler 只读 approved，故不产生越权内容；但 manifest 因此无法记录「某条内容来自 proposed/已废弃」的追溯信息，未来接入非 approved 通道时会产生错误 provenance。
- **P5 medium（文档）**：`docs/architecture.md:309` 的 **[FACT]**「`compileContext` 仅通过 type 查询 L2/L3/L4，SQL 带 `status='approved'`；因此 `proposed` 不会进入 packet」——状态过滤正确，但「仅通过 type 查询」不成立（见 P2）；该 [FACT] 会误导读者认为按类型分段的语义已闭合。

### 3.4 CLI 端到端（临时库）

`init → put(L2) → put(L3) → review(approved) ×2 → compile --query → fragment → compile（无 query）` 全部按预期返回；`compile` 输出 `tokens=72/5000`（含 query）与 `41/5000`（无 query），差异来自 P2 的重复段落。`audit`（无 token）返回 `AUTH_DENIED`，`stats`（无 token）返回成功（见 P9）。

## 4. 必查项 2：安全

### 4.1 身份与默认拒绝

- token 仅存 `sha256`：`config/principals.json` 无明文；`authenticate` 按 sha256 查找，长度 <16 直接拒绝（`src/authz.js`）。
- 未知/短 token → `AUTH_DENIED`；跨项目 → `PROJECT_DENIED`；角色不匹配 → `ROLE_DENIED`；均实测。
- `review` 仅 R0/R4（`isApprover`）+ 禁自审（`SELF_REVIEW_DENIED`）；实测 R0 principal 以 `--role R4` 调 review 被拒（principal 不持有 R4）。
- **P1 high（restoreFragment 角色伪造）**：`src/manifest.js:88-105` 只校验 `principal.project_ids` 包含 project、`role_id` 的 profile `evidence_direct` 为真，**未校验 `principal.roles.includes(role_id)`**。实测：R2 principal 以 `--role R3`（或 R4/R6）调 `fragment` → exit 0 返回原文；以 `--role R2` → `EVIDENCE_DENIED`。修复：在 L88 开头加 `if (!principal.roles.includes(role_id)) throw new Error('ROLE_DENIED')`，并补用例。

### 4.2 未批准记忆与 packet

- A5 成立：propose 后 compile（R2/R4）**不含** proposed 文本；SQL 的 type/FTS/LIKE 路径均带 `status='approved'`（`src/retrieval.js:50,66,78`）。
- `ids` 调试路径无状态过滤（`src/retrieval.js:55-58`），但 compiler 不调用；仅创建者/R0/R4 可经 `retrieve` 读到 proposed → 低风险，已在架构 §4.2 披露。

### 4.3 路径穿越

- `src/util.js:59-84` 的 `guardSourceRef` 拒绝绝对路径/盘符/UNC/`..`，跨 roots 校验并 `realpath` 防符号链接逃逸。实测：`source_ref='../../etc/passwd'` → `SOURCE_REF_DENIED TRAVERSAL_DENIED`；`source_ref='D:/M1/mars/README.md'`（绝对路径）→ `ABSOLUTE_PATH_DENIED`。
- **P8 low**：CLI `mcp --enable` 调 `mcp.start({dbPath, principalsPath})` 未传 `allowedRoots`（`src/cli.js:123`），MCP `memory.propose` 因此必失败（`SOURCE_REF_DENIED`）。属**fail-closed 可用性缺口**，不是越权；建议 `start()` 传入与 CLI 一致的 `allowedRoots` 并在 `docs/mcp.md` 声明。

### 4.4 审计

`audit` 表覆盖 `memory.propose`（created/duplicate）、`memory.get`、`memory.list`（含检索）、`memory.review`、`memory.alias`、`context.compile`、`memory.get result=restore`、`ledger.read`；不含正文（`src/db.js:98-104`）。**注意**：`audit` CLI 需 token（走 `loadAuth`），`stats`/`init`/`ledger` 不鉴权（`src/cli.js:94-115`），其中 ledger 已在架构 L-04 披露，`stats` 未披露（P9 low）。

## 5. 必查项 3：能力

### 5.1 Token 对账（A1）——PASS

CLI 与独立复算一致：`events 323`、`total 41,597,577`；`cache_hit_rate` 公式 `cacheRead/(input+cacheRead)` 正确；`reconcile()` 与 `buildLedger()` 分离，后者的 `reconcile` 为占位（`src/ledger.js:216`：`checked=matched=行数, diff_ratio:0`）。实测 `reconcile(book, book.totals.total)` → `{checked:1, matched:1, diff_ratio:0}`。即**契约结构成立、真实对账需显式调用**，与架构 L-14 一致。误差 0 ≤ 1% → A1 通过。

### 5.2 manifest 去重与恢复——PASS（附 P1/P3）

同 `project+content_hash+content_type` 复用 fragment 并 `ref_count+1`（`src/manifest.js:20-34`）；`restoreFragment` 能恢复 `content/content_hash/original_ref/content_type`；R2 以本角色调用被拒（`EVIDENCE_DENIED`），但见 P1。

### 5.3 预算与保护——PASS

`applyBudget` 保护段 `task/decisions/evidence/prohibitions` 不裁；实测 budget=200 被 clamp 到 256，内容 191 token 未触发裁剪；构造大内容后，`facts` 段被裁、`truncated=['sec_facts']`、保护段保留。注意 L-01：被裁段不进入 packet，`section.truncated=true` 不会出现在 packet 中，只能看 `budget.truncated`。

### 5.4 角色上下文差异——部分成立（P2）

无 query 时：R1/R3/R4 有 decisions 段，R2 无 decisions 且 `missing: decisions(blocking)`——与 `docs/architecture.md:242-255` 的角色表一致。
有 query 时：同一 L2 事实被压入 R2 的 facts/decisions/knowledge 三段（CLI 实测 `decisions :: - [mem_b0ca…] (L2, docs/a.md@v1) FACT-ONE…`），`missing=[]`，decisions 的 blocking 语义被绕过。根因：`src/compiler.js:59-69` 给每个 type 检索都传了 `query`；`src/retrieval.js:38-45` 的 `push()` 只按 `profile.allowed_types` 过滤，不校验本次请求的 `type`。修复：在 `push` 增加 `if (type && record.memory_type !== type) return;`，或在 compiler 侧对每段结果再按类型过滤，并补「query 下 decisions 段只含 L3」的用例。

## 6. 必查项 4：测试有效性

- 亲自运行 `node --test`：**50 tests / 50 pass / 0 fail / 0 skipped**；README 文档命令同样 50/50。
- 跳过调用共 6 处（1 个 `test.skip` + 5 个 `t.skip`：zstdCompressSync、R7/R3 会话缺失、junction），本机条件均不成立，实际未触发（`skipped 0`）；无「记录 PASS 但实际跳过」。
- 用例分布：ledger 8、mcp 6、phase1 36（authz 5 / budget 3 / ledger-reconcile 4 / lifecycle 5 / manifest 5 / mcp-server 4 / retrieval 6 / rollback-offline 4）。
- **P6 medium（文档陈旧）**：`docs/architecture.md:525` 的 L-13 仍写「tests 仅 ledger/mcp 14 用例，核心 `authz/store/compiler/retrieval` 无测试」，与现状（50 用例，覆盖 authz/retrieval/manifest/lifecycle/budget/rollback）不符，建议更新，否则 G2/G3 判定会被旧结论误导。
- **P12 info**：`docs/phase1-test-report.md` A7 的「R2 无 L3 决策段」在无 query 时成立；未覆盖「带 query 时 decisions 被 L2 填充」的路径（P2），建议补用例。

## 7. 必查项 5：约束

| 约束 | 实测 | 结论 |
|---|---|---|
| 未联网 | `src/*`、`tests/*`、`scripts/*` 无 `http/https/node:net/fetch`；仅测试用 `child_process` 起子进程 | 成立 |
| 未改 DSH 配置 | 本任务期间（19:0x–19:3x）无 DSH 文件写入；`baseline.md` 记录的 DSH 指纹与 Phase 0 一致 | 成立 |
| 未 push | `HEAD=07f0a1e`，`main...origin/main` 无 ahead/behind，`refs/remotes/origin/main` 与 HEAD 相同 | 成立 |
| 未改星日晓 | `D:\Projects\xingrixiao` HEAD `d168ef11…`、工作区干净（基线记录，未被本任务改动） | 成立 |
| 71 条基线未被覆盖 | Windows git：`preMarsUntracked=70 / preMarsModified=1 / preMarsSha256=8159a7ad…`，与 `docs/baseline.md` 完全一致（`matchesPhase0=true`）；MARS 新增 44 个未跟踪文件单独计入 | 成立 |

> 注意：以 WSL git 读取时可见 15 个 ` M` 文件（行尾/`autocrlf` 差异假象，文件 mtime 均为 2026-11-01，早于本任务）；项目自带的 `mars-baseline.ps1` 用 Windows git，结果与基线一致。审查以项目脚本口径为准。

**P11 info**：`mars/var/mars.db`（98,304 B）与 `var/baseline-now.json` 存在于工作区，而 `mars/` 无 `.gitignore`，二者会作为未跟踪文件进入提交范围；t83 报告称已删除 `mars.db` 与实际不符。建议增加 `mars/.gitignore`（`var/*.db`、`var/ledger/` 等）或由 `mars-rollback.ps1 -Yes` 清理。

## 8. 必查项 6：A1–A10 复核表（R4 独立判定）

| 项 | R3 结论 | R4 判定 | 依据/差异 |
|---|---|---|---|
| A1 Token 账本 ≤1% | PASS | **PASS** | 亲自复算 41,597,577，误差 0 |
| A2 固定任务/模型基线 | PARTIAL | **PARTIAL（未执行）** | 无模型级基线样本，无法复核；同意 R3 |
| A3 去重与原文恢复 | PASS | **PARTIAL** | 去重/恢复成立；`restoreFragment` 角色伪造（P1）使「R2 被拒」只在自报角色时成立 |
| A4 跨项目/未知身份/越权 | PASS | **PASS**（附 P1） | 拒绝矩阵实测通过；角色伪造属另一向量，已单列 |
| A5 未批准不入 packet | PASS | **PASS** | 实测 proposed 不进入 packet |
| A6 manifest 可追溯 | PASS | **PASS**（附 P3） | 字段齐全；status 写死 approved 削弱追溯 |
| A7 R1–R4 角色上下文 | PASS | **PARTIAL** | 无 query 时成立；有 query 时跨类型串段（P2） |
| A8 离线/无凭据/不改 DSH | PASS | **PASS** | 静态扫描 + 期间无写入 |
| A9 Token 优化不牺牲质量 | PARTIAL | **PARTIAL** | 未建立质量指标，同意 R3 |
| A10 完整回滚 | PARTIAL | **PARTIAL** | 干跑 exit 2、仅列 var 产物、未删除；principals 删除与安装反演未演练 |

## 9. 与 R3 报告（docs/phase1-test-report.md）的差异

1. R3 记「50/50 PASS」——核实一致（含 skipped 0）。
2. R3 的 A3/A7 判 PASS 未覆盖两个新向量：restoreFragment 角色伪造（P1）、query 下跨类型串段（P2）；因此 R4 将 A3/A7 下调为 PARTIAL。
3. R3 未提及 `validate.js` 未实现 `maxItems/format/oneOf` 等关键字（P4），而 memory schema 中确有 `maxItems:32` 等约束。
4. R3 未提及 `buildManifest` 写死 `status:'approved'`（P3）。
5. R3 的 A10 结论与本审查一致（干跑安全，完整反演未演练）。

## 10. 问题清单

| ID | 严重级 | 证据（file:line） | 问题 | 复现 | 修复建议 |
|---|---|---|---|---|---|
| P1 | **high** | `src/manifest.js:88-105` | `restoreFragment` 不校验 principal.roles 是否含所传 role_id，可伪造 evidence_direct 角色读原文 | R2 token + `fragment --role R3 --fragment <id>` → exit 0 | 增加 `principal.roles.includes(role_id)`；补用例 |
| P2 | **high** | `src/compiler.js:59-69`、`src/retrieval.js:38-53` | 带 query 时按类型检索被 FTS/LIKE 跨类型结果污染；同一 L2 事实进入 facts/decisions/knowledge，decisions blocking 被绕过 | `compile --role R2 --query approved` → decisions 段含 L2、missing=[] | `push()` 按请求 `type` 过滤；补「query 下类型纯净」用例 |
| P3 | medium | `src/manifest.js:51` | manifest entry 硬写 `status:'approved'`，不反映来源状态 | 代码阅读 + packet.manifest 检查 | 从记忆记录带 status；补用例 |
| P4 | medium | `src/validate.js:4-5,19-73` | 未实现 `maxItems/format/oneOf/uniqueItems/$ref`，契约约束未执行（tags≤32 不生效） | `store.propose` 传 33 个 tags → 接受 | 补实现或声明子集并移除 schema 中未实现的约束；补用例 |
| P5 | medium | `docs/architecture.md:305,309` | [FACT]「仅通过 type 查询…proposed 不会进入 packet」与实现不符（状态过滤成立、类型过滤不成立） | 对照 P2 | 修正表述并引用 P2 |
| P6 | medium | `docs/architecture.md:525` | L-13 称核心模块无测试、仅 14 用例，与实际 50 用例不符 | 对照测试目录与运行结果 | 更新 L-13 |
| P7 | low | `docs/interfaces.md:53-55` | `estimateTokens` 标在 budget.js，实为 util.js | `require('./src/budget').estimateTokens === undefined` | 修正文档归属 |
| P8 | low | `src/cli.js:123`、`src/mcp.js:104-111` | MCP start 未传 allowedRoots，propose 恒失败（fail-closed） | `mcp --enable` 后 propose → SOURCE_REF_DENIED | 传 allowedRoots 并在 mcp.md 声明 |
| P9 | low | `src/cli.js:62-65,94-98` | `--help`/无命令 exit 1；`stats` 无鉴权 | 直接运行 | help 正常退出；stats 增加鉴权或声明公开只读 |
| P10 | low | `src/store.js:150-167` | review 不校验状态迁移（架构 L-03 已披露，此处确认） | 代码阅读 | 按 L-03 处理，本审查不重复升级 |
| P11 | info | `mars/var/mars.db`、`mars/var/baseline-now.json`、缺失 `mars/.gitignore` | 运行产物会进入提交范围；t83 称已删除 mars.db 与实际不符 | `git status` 可见 | 增加 `.gitignore` 或清理 |
| P12 | info | `docs/phase1-test-report.md:20` | A7 未覆盖带 query 的类型污染路径 | 对照 P2 | 补用例并更新报告 |

## 11. 未验证/限制

- 未执行 DSH 侧 MCP 注册/握手（MCP 未注册，本任务不改变该状态）。
- 未做固定模型/固定任务的 Token 质量对照（A2/A9 维持 PARTIAL）。
- 未演练 `mars-rollback.ps1 -Yes` 的真实删除与 principals 删除（避免破坏工作区）；仅干跑。
- 未用真实 R6/R7 成员会话之外的更多样本做账本回归（已用 R7/R3 两个真实会话交叉复算）。
- 本机 PowerShell 执行策略禁止直接运行 `.ps1`，脚本以 `-ExecutionPolicy Bypass` 干跑；未修改执行策略。
- 审查期间另一任务在 `D:\M1\mars` 之外（无）与本目录内（无写入）未观察到并发改动；`mars/` 文件 mtime 与快照一致。

## 12. 建议的修复顺序

1. P1（高，1 行校验 + 用例）→ P2（高，`push` 类型过滤 + 用例 + packet 断言）。
2. P4（补 `maxItems` 等或声明子集）→ P3（manifest status）。
3. P5/P6/P7（文档修正，可与上面同批）→ P8/P9（可用性）。
4. P11/P12（卫生与用例补充）。

修复后可申请下一轮独立复核；届时建议同时补 `docs/acceptance.md`（架构 L-13 指出的 G2/G3 文档缺口）。
