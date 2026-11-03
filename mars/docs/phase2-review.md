# MARS Phase 2 独立审查报告（R4）

- 审查日期：2026-11-03
- 审查角色：R4（独立审查，未参与 Phase 2 实现）
- 审查对象：`D:\M1\mars`，MARS Phase 2（DSH MCP 正式接入 + G1–G4）
- 总体结论：**PARTIAL**
- 发现：blocker 0 / high 0 / medium 5 / low 9（共 14）
- 测试：亲自运行 11 个测试文件，**56/56 PASS**（fail 0）

> 本报告的所有结论来自本次审查亲自读取的源码/文档、亲自执行的命令/探测、以及只读查询的 SQLite/会话数据；没有把 R0 的自述或 G1–G4 报告本身当作结论依据。G1–G4 报告只作为“待核对的主张”。

## 1. 审查范围与方法

### 1.1 读取范围

- 源码（重点核对）：`mars/src/mcp-stdio.js`、`mcp.js`、`authz.js`、`retrieval.js`、`store.js`、`db.js`、`compiler.js`、`util.js`、`cli.js`、`ledger.js`。
- 配置与契约：`mars/config/principals.json`、`mars/config/role-routing.json`、`mars/contracts/memory.schema.json`。
- 脚本：`mars/scripts/mars-mcp-disable.ps1`、`mars-issue-mcp-identity.js`、`seed-phase2.js`、`phase2-g1-verify.js`。
- 文档：`docs/phase2-g1-security-report.md`、`phase2-g2-runs.md`、`phase2-g3-workflow.md`、`phase2-g4-ab-report.md`、`mcp-access.md`、`security.md`、`architecture.md`。
- 测试：`tests/ledger/ledger.test.js`、`tests/mcp/mcp.test.js`、`tests/phase1/` 下 9 个测试文件与 `helpers.js`。
- 运行环境：`C:\Users\liuch\.dsh\skill-mcp-manager\registry.json`、`D:\M1\mars\var\mars.db`、`D:\M1\mars\var\mcp\tokens\`（只检查路径/大小，不读取 token 内容）、`~/.dsh/sessions/` 下 6 个 G4 会话。

### 1.2 执行的方法与命令

1. **自动化测试**（亲自跑，未改测试）：
   ```powershell
   $env:ELECTRON_RUN_AS_NODE='1'
   & 'C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe' --test `
     'D:\M1\mars\tests\ledger\ledger.test.js' `
     'D:\M1\mars\tests\mcp\mcp.test.js' `
     (Get-ChildItem 'D:\M1\mars\tests\phase1\*.test.js').FullName
   ```
   结果：`tests 56 / pass 56 / fail 0 / cancelled 0 / skipped 0`，duration 1648.232ms，exit 0。

2. **直接 stdio 身份/授权探测**：在 `%TEMP%` 写一次性 Node 脚本，spawn `DSH.exe` 执行 `mars/src/mcp-stdio.js`，通过 JSON-RPC 发送 `initialize`、`tools/list`、`tools/call`。env 只设 `MARS_DB`、`MARS_PRINCIPALS`、`MARS_ROUTING`、`MARS_ALLOWED_ROOTS`、`MARS_ROLE`、`MARS_TOKEN_FILE`；token 只以文件路径传入，未读取/打印内容。覆盖：无 token、无效 token、token/角色不匹配、R2 正常、R3 正常、R4 正常、R2 伪造 `role_id=R3`、跨项目 `xingrixiao`、非法 `status`、额外字段。

3. **数据库只读查询**：用 `node:sqlite` 以只读方式打开 `D:\M1\mars\var\mars.db`，查询 `manifests`、`memories`、`audit` 等表；核对 packet/manifest/task/token/audit 计数与 G2/G3/G4 报告。

4. **关闭脚本干跑**：
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File 'D:\M1\mars\scripts\mars-mcp-disable.ps1'
   powershell.exe -ExecutionPolicy Bypass -File 'D:\M1\mars\scripts\mars-mcp-disable.ps1' -WhatIf
   ```
   前者 dry-run，后者用于核对文档中的 `-WhatIf` 用法（结果见 F-06）。

5. **G4 会话复算**：用 `mars/src/ledger.js` 的 `parseSession()` 解析 `~/.dsh/sessions/--C-Users-liuch-Desktop-~8BA1~5212qpp--/` 下 6 个 `session.v4.jsonl.zstd`，逐项复算 usage；按 usage 与报告行匹配 6 个会话 ID。

6. **敏感信息与边界**：`git ls-files --others --exclude-standard -- mars`、`git check-ignore -v`、正则扫描 `.env`/私钥/43 字符 token 样式；通过 WSL Ubuntu-24.04 的 git 2.43.0 只读执行 `git -C /mnt/d/M1 status --porcelain=v1`、`git log --oneline -3 -- mars`、`git -C /mnt/d/Projects/xingrixiao status`。未做任何 git 写操作。

7. **未运行**：`scripts/phase2-g1-verify.js`（会写 `docs/checks/phase2/g1/*`，违反只写本报告的约束）；G4 没有评分脚本，未独立复算 6 份答案的质量分。

### 1.3 只读约束与副作用声明

- 本次只写了本文件 `D:\M1\mars\docs\phase2-review.md`；未修改任何 `src/`、`tests/`、`config/`、其他 `docs/` 文件；未 commit/push；未读取/输出 token 明文。
- **数据库副作用（必须披露）**：直接探测调用 `context_compile` 3 次，服务端按正常行为写入了 3 条 `R4-PROBE` manifest 与相应 audit：
  - `man_543a53420f11`、`man_b68cb004f36a`、`man_8136c5d708cd`（均 198 tokens，2026-11-03T12:21:40–12:22:13Z）
  - 对应 packet：`pkt_3d42987c62f6`、`pkt_715397f4d61e`、`pkt_896b542785e1`
  - 这些是服务正常审计，不是对源码/配置/文档的修改；报告中的 G3 历史计数以**探测前**快照为准。验收时应将 `R4-PROBE` 行视为审查噪声。

## 2. 逐项结论

| # | 核对项 | 结论 | 关键证据摘要 |
|---|---|---|---|
| 1 | 接入真实性（身份只来自 `MARS_TOKEN_FILE` + `MARS_ROLE`） | **PASS** | `src/mcp-stdio.js:32-43` 只读 `MARS_TOKEN_FILE`；`:140-150` 绑定 token/role；`:152-162` 用绑定身份授权；未知/缺失/不匹配 token 与角色伪造均拒绝；DSH registry 5 个服务均绑定角色与 token 文件 |
| 2 | 默认拒绝与禁用（无 `--enable` 是否拒绝） | **PARTIAL** | `mcp-stdio.js` 无 `--enable`，直接启动即可响应；仅 legacy `src/cli.js:124-132` 有 gate；`docs/mcp-access.md:97` 与实测不符；关闭脚本 dry-run 正常，`-WhatIf` 不可用 |
| 3 | 隔离（role_scope、跨项目、`memory_get`） | **PASS** | `retrieval.js:31-32` 项目/角色校验、`:44` role_scope 过滤；`store.get` 走 `assertProject` + `canRead`；R2 读 R3 role 记忆被拒；跨项目被拒；R4 packet 不含 R3 role 记忆 |
| 4 | 审批（propose 只能 proposed、自审拒绝、review 由 CLI 执行） | **PASS**（P10 仍开放） | `store.propose` 固定 `status='proposed'`（`store.js:68`）；MCP 工具表无 review；`store.js:156` 自审拒绝；CLI `review` 走 `store.review`；但状态迁移无校验（F-04） |
| 5 | 测试 | **PASS**（覆盖有缺口） | 11 个文件、56/56 PASS；但 mcp-stdio 的 gate/schema/跨项目无直接自动化测试（F-14） |
| 6 | G2/G3/G4 证据与数据库/会话事实 | **PARTIAL** | G2 6/6 packet/manifest/token/task/audit 吻合；G3 链路与 `mem_0db463660da4` 事实吻合；G4 usage 6/6 吻合，但报告缺会话 ID、统计标签错误、质量分不可复算 |
| 7 | 敏感信息 | **PASS** | 可提交范围无 token 明文、`.env`、私钥；`principals.json` 只存 sha256；`var/` 与 `config/principals.json` 被 `.gitignore` 覆盖；token 文件只在被忽略的 `var/mcp/tokens/` |
| 8 | 边界（未 commit/push、未改 DSH 全局、未触碰 xingrixiao） | **PASS**（附说明） | `D:\M1` 中 `mars/` 整体未跟踪、无 mars 提交；xingrixiao 只有既存 docs 修改；唯一 DSH 全局变更是 5 个 `mars-r*` 注册项（Phase 2 接入设计本身），本次审查未改 |

### 2.1 接入真实性（PASS）

- 身份推导链只使用进程 env：`tokenFromEnv()` 仅读 `process.env.MARS_TOKEN_FILE`，注释明确 token 不经命令行或工具参数（`src/mcp-stdio.js:32-43`）。`MARS_ROLE` 由注册项固定；`boundIdentity()` 要求 token 有效、role 非空且属于该 principal（`:140-150`）。
- DSH registry 的 5 个 `mars-r0`…`mars-r4` 条目均为 `tier=on-demand`、`transport=stdio`、`command=DSH.exe`、`args=D:\M1\mars\src\mcp-stdio.js`、`cwd=D:\M1\mars`；env 分别绑定 `MARS_ROLE=RN` 与 `MARS_TOKEN_FILE=D:\M1\mars\var\mcp\tokens\RN.token`，未见 token 明文值。
- 直接探测结果：
  - 无 token + R4：`initialize` 成功、`tools/list` 返回 5 个工具；`memory_list` → `AUTH_DENIED`。
  - 43 字符无效 token + R4：`memory_list` → `AUTH_DENIED`。
  - R2 token + `MARS_ROLE=R3`：`memory_list` → `AUTH_DENIED`（token/角色不匹配）。
  - R2 正常：`memory_list` 成功；`memory_get mem_90fc3b64dacf`（R3 role 限定）→ `MEMORY_DENIED`；`project_id=xingrixiao` → `AUTH_DENIED`。
  - R2 的 `memory_get` 带 `role_id=R3` → `MEMORY_DENIED`；`context_compile` 带 `role_id=R3` 时返回 packet 的 `role_id` 仍为 R2（绑定角色不可被参数覆盖）。
  - R3 正常：`memory_get mem_90fc3b64dacf` 成功。
- 结论：客户端参数不能伪造 role/project；未知/缺失/不匹配 token 均被拒绝。**PASS**。G1 报告 line 29 的“schema 拒绝”是另一问题（F-02），不影响身份绑定结论。

### 2.2 默认拒绝与禁用（PARTIAL）

- `src/mcp-stdio.js` 全文没有 `--enable` 参数或 gate；`main()` 只读取 DB/principals/routing/role/allowed-roots 后直接 `serve()`（`:296-310`）。实测不带 `--enable` 启动即可完成 `initialize`/`tools/list`/授权工具调用。
- 唯一的 `--enable` gate 在 legacy `src/cli.js:124-132` 的 `mcp` 子命令，针对旧的 `src/mcp.js`，不是当前注册的 `mcp-stdio.js`。测试 A8（`tests/phase1/mcp-server.test.js:69`）也只覆盖这个 CLI。
- 因此“默认拒绝”实际依赖两层：DSH 的 `on-demand` 注册（需 `mcp_load` 才暴露工具）+ token 身份；“MCP 进程级默认关闭开关”并不存在。`docs/mcp-access.md:97` 明确写“`mcp-stdio.js` 需 `--enable`”，与源码不符（F-01）。
- 关闭脚本干跑（无参数）输出：
  ```
  registry entries: 6; mars entries: 5; will remove: 5
  WHATIF: no write. Re-run with -Yes (registry.json is backed up first).
  backup target: D:\M1\mars\var\mcp\registry-backup-20261103-202402.json
  ```
  exit 0，未生成备份文件。`-WhatIf` 运行失败：`A parameter cannot be found that matches parameter name 'WhatIf'`，exit 1；文档 `docs/mcp-access.md:60-61` 的 `-WhatIf` 用法不成立（F-06）。
- 结论：legacy gate 与关闭脚本 dry-run 可用，但 Phase 2 服务的进程级默认拒绝缺失且文档失实。**PARTIAL**。

### 2.3 隔离（PASS）

- 检索入口先校验项目与角色：`retrieval.js:31-32` 对不在 `principal.project_ids` 的项目抛 `PROJECT_DENIED`，对不在 `principal.roles` 的角色抛 `ROLE_DENIED`。
- `push()` 的过滤顺序（`retrieval.js:38-49`）：角色 `allowed_types` → 类型 → `visibility=role` 时 `(record.role_scope||[]).includes(roleId)`（`:44`）→ `canRead` → `status=approved`。注释明确 R0/R4 也不能把 role 限定记忆带进上下文（审批读取走 `memory.get`/`review`）。
- `memory_get` 不是只校验 list/compile：`store.get`（`store.js:121-130`）先 `assertProject`（跨项目 → `PROJECT_DENIED`），再 `canRead`，最后审计；`memory_list` 也走项目校验与 `canRead`。
- 实测：R2 读 `mem_90fc3b64dacf`（role_scope=R3）→ `MEMORY_DENIED`；R3 读同一记忆成功；R4 通过 `memory_get` 也能读（这是 G1 报告 line 61 明示的审批者读取路径），但 R4 的 packet 经 `retrieval.js:44` 排除该记忆。G2 报告 line 21 的“R0/R1/R2/R4 不可见”若指 packet 成立，若指 `memory_get` 则不成立（F-13，文档精度问题）。
- 结论：跨项目、跨角色读取在上下文与 `memory_get` 路径均被阻断；role_scope 的 packet 隔离成立。**PASS**。

### 2.4 审批（PASS，P10 仍开放）

- `memory_propose`：MCP 侧删除 `input.token`/`input.role_id` 后交给 `store.propose`（`mcp-stdio.js:189-194`）；`store.propose` 固定写入 `status='proposed'`（`store.js:68`），并按 `(project, content_hash, source_ref, source_version)` 去重。工具表没有 `memory.review`（`mcp-stdio.js:115-121`），Agent 不能自升。
- 自审：`store.review` 中 `row.created_by === principal.principal_id` → `SELF_REVIEW_DENIED`（`store.js:156`）。审批只能由 R0/R4（`authz.isApprover`，`authz.js:48-51`），且由服务端 CLI `review` 执行（`cli.js:166-170`）。
- P10 现状：`store.review`（`store.js:150-167`）没有状态迁移校验。`row.status === decision` 时直接返回且不审计（`:157`）；否则对任意 `approved`/`deprecated`/`superseded` 直接 UPDATE（`:163`），因此可 `approved→superseded`、`superseded→approved`、`deprecated→approved`。这不是提权（仍需 R0/R4），但状态完整性/审计完整性不足（F-04，medium）。
- 结论：propose 只能写 proposed、自审拒绝、review 由服务端 CLI 执行这三项均通过；P10 仍未关闭，作为 medium 条件项。**PASS（附 P10）**。

### 2.5 测试（PASS，覆盖有缺口）

- 亲自运行 11 个测试文件，结果 `tests 56 / pass 56 / fail 0 / cancelled 0 / skipped 0`，duration 1648.232ms，exit 0；未修改任何测试来变绿。
- 覆盖缺口：`tests/mcp/mcp.test.js` 测的是 legacy `src/mcp.js`（`request.token`、`params.role_id`），不是 Phase 2 的 `src/mcp-stdio.js`；A8（`tests/phase1/mcp-server.test.js:69`）只测 legacy CLI 的 `--enable`；没有测试覆盖 mcp-stdio 的进程级 gate、服务端 inputSchema、`tools/list` 未认证、跨项目 MCP 调用（F-14，low）。
- 结论：既有测试全绿，但不能把 56/56 当作 mcp-stdio 安全面的完整证明。**PASS（覆盖有缺口）**。

### 2.6 G2/G3/G4 证据（PARTIAL）

**G2（证据一致性 PASS）**：

- `manifests` 表没有 `packet_id` 列，packet_id 只出现在 `audit` 的 `context.compile` 记录 target 中；manifest 侧用 `manifest_id`/`task_id`/`tokens_estimated` 核对。两者组合后 6 条运行全部吻合：
  - `pkt_8289b7fe4b92`/`man_5c8fcae8eb4b` 357 tokens（R0，G1-REAL-CALL-001）
  - `pkt_ebb345b28cdc`/`man_1dda2266ed88` 333（R0，G1-REAL-CALL-002）
  - `pkt_c717f0768966`/`man_e3d4b6c08872` 359（R1，G2-R1-RUN-001）
  - `pkt_d689daff8de2`/`man_4de1dfbfdc04` 201（R2，G2-R2-RUN-001，无 decisions）
  - `pkt_d924afb386c6`/`man_00b7f697b6b9` 431（R3，G3-R3-CHECK-001）
  - `pkt_eb8a60e3735a`/`man_3116d304e49d` 358（R4，G2-R4-RUN-001）
- `man_1dda2266ed88` 的 `entries_json` 含 `G1-REAL-CALL-002` 任务，且不含 R3 role 记忆；G2 报告 line 21 的 role_scope 结论与 `retrieval.js:44` 及 G1 summary 一致。
- 限制：每角色仅 1 次真实调用（G2 报告 line 36 自述）；manifest 的 `entries_json` 只存 source_ref/片段，不存 memory_id，不能单独凭 manifest 证明某条记忆被选中；本次通过 retrieval 代码、G1 summary 与直接探测交叉验证。

**G3（链路 PASS，单样本）**：

- `mem_0db463660da4` 的 DB 事实与报告完全一致：`memory_type=L3`、`status=approved`、`source_ref=mars/docs/mcp-access.md`、`source_version=v0.1`、`created_by=mcp-R2`、`approved_by=mcp-R0`、`approved_at=2026-11-03T12:13:51.015Z`。
- R3 的 `pkt_d924afb386c6`/`man_00b7f697b6b9`（431 tokens）decisions 段含该决策的 `mars/docs/mcp-access.md@v0.1` 片段；manifest/token/task 匹配。
- 审计计数：G3 报告 line 13 是 `memory.list=67, context.compile=29`；本次探测前实际为 `memory.list=79, context.compile=36`，`memory.propose=11`、`memory.review=8`、`memory.stats=11`、`ledger.read=1` 与报告完全相同。差异只出现在后段 list/compile，方向一致；报告是更早快照且未注明时间（F-12，low）。
- 单样本与 P10 为已知限制（G3 报告 line 24-26）；R2 提案 L3 与角色路由的类型边界问题见 F-03。

**G4（usage 真实，报告统计有误 → PARTIAL）**：

- 6 个会话的 usage 逐项复算与报告表完全一致（会话 ID 报告未列，本次反查补全，见附录 B）；`parseSession()` 读的是 `assistant/message.data.usage`，不是 provider 账单。
- 复算：剔除首次后基线均值 88,930.5、实验均值 87,466.0，差 −1.65%（−1464.5/88930.5=−1.647%），与该报告一致。
- 但报告 line 45 的“output 均值基线 1,495 vs 实验 1,279”实际是 3 次全量均值；按同一“剔除首次”口径应为 1,560 vs 904。line 46 的“cacheRead 占总 token 83%–95%”不成立：B1 为 15.3%，T1 为 57.4%，其余四次约 84.1%–84.9%。line 57 声称表中有“6 个 subagent 会话 ID”，实际表中没有 ID。质量 8/15 vs 15/15 明确是人工评分、无脚本（line 58），本次未独立复算 6 份答案（F-05，medium；质量分列入未验证项）。

### 2.7 敏感信息（PASS）

- `git ls-files --others --exclude-standard -- mars` 中，匹配敏感名的只有 `mars/docs/token-baseline.md`（文档名），未发现 `.env`、`BEGIN ... PRIVATE KEY`、credentials、`.pem`/`.key`/`.pfx`；除被忽略的 `var/` 外未发现 43 字符 token 样式字符串。
- `config/principals.json` 只存 `token_sha256`，未存明文；token 文件在 `D:\M1\mars\var\mcp\tokens\`，整目录被 `mars/.gitignore` 的 `var/` 覆盖（`git check-ignore` 命中 `mars/.gitignore:2:var/`）。
- `mars/var/mars.db`、`mars/var/mcp/tokens/R0.token`、`mars/var/ab-legacy-R1.txt` 均命中 `var/`；`mars/config/principals.json` 命中 `mars/.gitignore:5:config/principals.json`。因此这些文件不会进入可提交范围。
- 结论：可提交范围无 token 明文/私钥；本地 token 文件存在但被忽略，符合设计。**PASS**。

### 2.8 边界（PASS，附说明）

- `D:\M1` 根仓库：`git status --porcelain=v1` 显示 `?? mars/`（整个 `mars/` 未跟踪），`git log --oneline -3 -- mars` 无输出；没有 mars 的 commit/push。根仓库还有其他与 MARS 无关的既存修改/未跟踪文件，本次未触碰。
- `D:\Projects\xingrixiao`：只读 `git status` 显示既存 docs/design 修改，HEAD 提交 `d168ef1`/`f63f629`/`998c52d`，未发现 MARS 相关改动；本次未修改该目录。
- DSH 全局配置：唯一观察到的是 `C:\Users\liuch\.dsh\skill-mcp-manager\registry.json` 中 5 个 `mars-r*` 条目（rea 之外），这是 Phase 2 G1 的接入设计本身，不是审查期间的改动；本次审查未修改 registry，也未发现其他 DSH 配置改动（未做全量配置基线比对，见未验证项）。
- 结论：未 commit/push、未触碰 xingrixiao；DSH registry 的 mars 条目属于设计内的正式接入。**PASS**。

## 3. 发现的问题

### 3.1 Medium（5）

| ID | 严重度 | 文件:行 | 问题 | 修复建议 |
|---|---|---|---|---|
| F-01 | medium | `mars/src/mcp-stdio.js:296-310`；`mars/src/cli.js:124-132`；`mars/docs/mcp-access.md:97`；`mars/docs/phase2-g1-security-report.md:75` | Phase 2 注册的 `mcp-stdio.js` 没有 `--enable` gate，直接启动即可响应；文档却称“`mcp-stdio.js` 需 `--enable`”，G1 报告称“冻结默认禁用…有真实进程证据”。实际默认拒绝只来自 DSH on-demand 注册 + token，不是进程级开关；测试 A8 只覆盖 legacy CLI。 | 二选一：① 在 `mcp-stdio.js` 实现 `--enable`（无参数拒绝启动）并加回归测试；② 明确把 DSH on-demand 注册定义为唯一 enable 机制，修正 `mcp-access.md:97` 与 G1 报告 line 75，删除“进程级默认禁用”的表述。 |
| F-02 | medium | `mars/src/mcp-stdio.js:152-174`（无 schema 校验）、`:63`（status enum）、`:206`（错误码白名单）；`mars/docs/phase2-g1-security-report.md:29` | 服务端直接使用 `params`，不按 `TOOLS[].inputSchema` 校验。实测 R2 `memory_list {status:'bogus'}` → `{ok:true, count:0}`；额外 `token`/`role_id` 字段被静默忽略；没有 `INVALID_PARAMS`。G1 报告 line 29 的“schema 拒绝（additionalProperties:false）”在服务端不成立（DSH 客户端可能有校验，stdio 直连可绕过）。 | 在 `callTool` 前做服务端参数校验（可直接用工具 inputSchema 或小型 validator），非法 enum/未知字段返回稳定错误码（如 `INVALID_PARAMS`）；补负例测试。若刻意依赖 DSH 客户端校验，则报告必须限定“客户端侧”，并承认直连 stdio 不受该保护。 |
| F-03 | medium | `mars/config/role-routing.json:29-37`；`mars/src/store.js:44-105`；`mars/docs/phase2-g3-workflow.md:10` | R2 的 `allowed_types` 为 L1/L2/L4（不含 L3），但 G3 步骤 1 由 R2 成功 propose 了 L3 决策 `mem_0db463660da4`；`store.propose` 只校验 principal 是否拥有该 role，不校验 `allowed_types`。审批后 R2 仍不能读该 L3（路由使然），但提案权越过了角色类型边界，且 G3 证据本身依赖这一行为。 | 明确策略：若 propose 也应受 `allowed_types` 约束，则在 `store.propose` 校验并返回 `ROLE_DENIED`/`MEMORY_DENIED`；若 propose 故意类型无关，则修改 role-routing 的语义说明与 G3 文档，明确“propose 不受 allowed_types 限制”，并评估是否允许实现角色提案决策。补测试。 |
| F-04 | medium | `mars/src/store.js:150-167`（重点 `:157`、`:163`）；`mars/docs/phase2-g3-workflow.md:26` | `review` 无状态迁移校验：同状态直接返回且不审计；否则任意 `approved`/`deprecated`/`superseded` 直接 UPDATE，可 `approved→superseded`、`superseded→approved`、`deprecated→approved`。P10 在 G3 报告中已承认，但本次核实仍未关闭。需要 R0/R4 权限，不是提权，但状态完整性与审计链不足。 | 定义迁移矩阵（如 proposed→approved/deprecated/superseded；approved→superseded/deprecated；superseded→无等），非法迁移返回 `DECISION_INVALID`/`INVALID_TRANSITION`；同状态应拒绝或至少写审计；补状态机测试，列入 Phase 2.1 前置。 |
| F-05 | medium | `mars/docs/phase2-g4-ab-report.md:45-46`、`:57-58` | G4 报告的证据表述有误：① line 57 称表中有 6 个会话 ID，实际没有；② line 45 的 output 均值 1,495/1,279 是 3 次全量均值，却放在“剔除首次”段落（同口径应为 1,560/904）；③ line 46 的 cacheRead 占比 83%–95% 与数据不符（B1 15.3%、T1 57.4%、其余约 84.1%–84.9%）；④ 质量 8/15→15/15 是人工评分、无脚本。usage 6/6 与 −1.65% 本身已核实为真。 | 补上 6 个会话 ID（见附录 B）；把全量均值与剔除首次均值分开标注；把 cacheRead 范围改为实测值（15.3%–84.9%）并说明冷启动；把质量评分脚本/评分规则固化，或明确标注“质量分未独立复现”。 |

### 3.2 Low（9）

| ID | 严重度 | 文件:行 | 问题 | 修复建议 |
|---|---|---|---|---|
| F-06 | low | `mars/scripts/mars-mcp-disable.ps1:4-9`；`mars/docs/mcp-access.md:60-61` | 脚本只有 `[CmdletBinding()]` 和 `[switch]$Yes`，没有 `SupportsShouldProcess`，因此 `-WhatIf` 不是可用参数；文档却把 `-WhatIf` 写成预演命令。实测 `-WhatIf` exit 1（`A parameter cannot be found...`），默认干跑（无 `-Yes`）才正常。 | 修正文档为“直接运行（无 `-Yes`）即 dry-run”；或实现 `[CmdletBinding(SupportsShouldProcess=$true)]` 并让 `-WhatIf` 真正生效。 |
| F-07 | low | `mars/src/mcp-stdio.js:161-162`；`mars/docs/security.md:10`；`mars/docs/architecture.md:334` | 跨项目调用实际返回 `AUTH_DENIED`（authorize 失败被统一映射），但安全/架构文档写的是 `PROJECT_DENIED`。结果仍是拒绝，但契约与实现的稳定错误码不一致。 | 在 mcp-stdio 区分 `PROJECT_DENIED` 与 `AUTH_DENIED`（或统一文档为 `AUTH_DENIED`）；补精确断言错误码的测试。 |
| F-08 | low | `mars/src/mcp-stdio.js:63`、`:92`；`mars/contracts/memory.schema.json:20`；`mars/src/store.js:69` | 工具 schema 的 `status` enum 含 `rejected`、缺 `deprecated`，与 `memory.schema.json` 的 `proposed/approved/deprecated/superseded` 不一致；`review` 也从不产生 `rejected`。`memory_propose.confidence` 声明 `string`，store 只接受 number，字符串会被静默转成 0.5。 | 对齐状态枚举（以 `memory.schema.json` 为准，删 `rejected` 或全链路增加该状态）；`confidence` 改为 number（0–1）并校验；补契约测试。 |
| F-09 | low | `mars/src/mcp-stdio.js:176-187` | `memory_stats` 直接按 `project_id` 统计全部 memories/aliases，不按 role/visibility/`canRead` 过滤；role 限定记忆与 proposed 都计入。虽只返回计数，仍是低风险信息暴露。 | 明确文档为“项目级聚合计数”；或按 `canRead`/role 过滤后再计数；补 R2/R3/R4 stats 差异测试。 |
| F-10 | low | `mars/scripts/seed-phase2.js:50`；`mars/src/store.js:161` | seed 脚本把 `{ note: 'phase2 seed' }` 对象传给 `review` 的 `note` 参数，`store.review` 执行 `String(note)`，6 条 seed 记忆的 `provenance.review_note` 变成 `"[object Object]"`。 | 传字符串（`note: 'phase2 seed'`）；修正 `String(note)` 的调用方；清理/重写这 6 条 seed 数据的 provenance（不改变记忆内容）。 |
| F-11 | low | `mars/src/mcp-stdio.js:238-247` | `initialize`、`ping`、`tools/list` 不需要身份；无 token 进程也能拿到 5 个工具的名称/描述/schema。工具调用仍需认证，故只是低风险信息暴露。 | 如无兼容性要求，可让 `tools/list` 也要求 token；或明确记录“工具清单非敏感”，保持现状。 |
| F-12 | low | `mars/docs/phase2-g3-workflow.md:13` | 报告中的审计计数 `memory.list=67, context.compile=29` 是较早快照；探测前实际为 79/36，其余四项（propose 11、review 8、stats 11、ledger 1）不变。报告未注明快照时间，读者会误以为与当前库一致。 | 在计数处标注采集时间/快照 ID，或重新生成报告；说明后段 G2 运行与 G4 造成的 list/compile 增量。 |
| F-13 | low | `mars/docs/phase2-g2-runs.md:21`；`mars/docs/phase2-g1-security-report.md:38`、`:61`；`mars/src/store.js:109`；`mars/src/retrieval.js:44` | “R3 role 记忆仅 R3 可见/仅 R3 上下文可见”未区分 packet 与 `memory_get`。实际 R0/R4 作为审批者可经 `memory_get` 读取（G1 line 61 已说明），只有 packet 被 `retrieval.js:44` 排除。G2 line 21 的“R0/R1/R2/R4 不可见”若不限定 packet 则不成立。 | 统一表述为“仅 R3 的 packet 可见；R0/R4 审批读取走 `memory_get`，R1/R2 不可读”；在 G1/G2 报告中都加这一限定。 |
| F-14 | low | `mars/tests/phase1/mcp-server.test.js:69`；`mars/tests/mcp/mcp.test.js`；`mars/tests/phase1/remediation.test.js:94` | Phase 2 新增的 `mcp-stdio.js` 没有直接自动化测试：A8 测 legacy CLI；`mcp.test.js` 测 legacy `src/mcp.js`；remediation 只 import `normalizeTask`。gate/schema/跨项目/`tools/list` 均无覆盖。 | 新增 `tests/mcp/mcp-stdio.test.js`（或同等 harness）：spawn 服务测无 token 拒绝、非法参数拒绝、跨项目错误码、role_id 伪造、R3/R4 role_scope 行为；把 F-01/F-02/F-07 的回归固化。 |

## 4. G1–G4 门槛判定

| 门槛 | 判定 | 判定依据 |
|---|---|---|
| **G1 接入与安全** | **PARTIAL** | 身份绑定、跨项目/角色隔离、proposed 隔离、role_scope packet 隔离均有真实进程证据，2 个 high 修复可复核；但 `mcp-stdio` 无进程级 `--enable` 且文档/G1 报告称有（F-01），服务端不校验 inputSchema 而 G1 报告称 schema 拒绝（F-02），跨项目错误码与契约不一致（F-07）。未发现未认证调用成功或越权读取，故不是 BLOCKED/FAIL，但不能按报告原样判 PASS。 |
| **G2 真实小范围运行** | **PASS** | 6 条 packet/manifest/token/task 与 DB/audit 全部吻合；R2 无 decisions、R3 role_scope、R0 修复前后对比均可复核；每角色 1 次真实调用，报告已自述样本限制。证据一致性通过。 |
| **G3 工作流** | **PASS** | propose→review→compile 四步事实与 DB 完全一致：`mem_0db463660da4` 的 created_by/approved_by/approved_at、R3 packet 的 decisions 片段、审计记录均可追溯；单样本，P10/F-03 为条件项，不影响“链路可执行、可追溯”的判定。 |
| **G4 Token/质量 A/B** | **PARTIAL** | 6/6 会话 usage 与报告精确一致，−1.65% 可复算；但报告缺会话 ID、output 均值标签错误、cacheRead 占比错误，质量 8/15→15/15 为人工评分且无脚本，无法独立复现质量结论。 |

**总体门槛**：G1 PARTIAL、G2 PASS、G3 PASS、G4 PARTIAL。

## 5. 总体结论

**总体：PARTIAL。**

- 没有 blocker/high：未发现未认证调用成功、跨项目读取、未审批记忆进入 packet、自审成功、role_scope 越权进入其他角色 packet 等实质安全突破。
- Phase 2 的接入是真实的：5 个 `mars-r*` 服务经 DSH stdio 注册，身份只从 `MARS_TOKEN_FILE` + `MARS_ROLE` 推导；未知/缺失/不匹配 token 均拒绝，客户端不能用参数伪造 role/project。
- 证据总体可信：G2 6/6、G3 关键事实、G4 usage 6/6 均与 DB/会话数据吻合；测试 56/56 PASS。
- 但当前**不具备无条件 PASS 的验收条件**，主要因为 5 个 medium：F-01 默认禁用口径失实、F-02 服务端 schema 校验缺失、F-03 R2 越 allowed_types propose L3、F-04 P10 状态机仍未关闭、F-05 G4 报告统计/证据缺陷。
- **建议的验收路径**：先修复并复验 F-01/F-02/F-05；对 F-03/F-04 明确处置（修复或书面风险接受并列入 Phase 2.1 前置项）；然后重跑 56 个测试 + mcp-stdio 负例探测 + G1/G4 报告复算。完成这些后，可判 **PASS（有条件）**。当前不建议判 FAIL/BLOCKED：没有发现身份或隔离被突破，问题集中在控制声明、输入校验、角色类型边界、状态机与报告严谨性。
- 是否具备 Phase 2 验收条件：**具备“有条件验收”条件，不具备“无条件验收”条件**。

## 6. 未验证/无法验证项

1. **G4 质量分 8/15 vs 15/15**：报告自述人工评分、无脚本；本次只复算了 6 个会话的 usage，未独立阅读/评分 6 份答案，因此质量结论不可独立复现。
2. **限流与请求上限**：256 KB→`REQUEST_TOO_LARGE`、120 次/分→`RATE_LIMITED` 只做了源码核对，未做并发/压力实测。
3. **关闭脚本的 `-Yes` 写路径**：为避免修改 DSH registry，本次只跑了 dry-run 与 `-WhatIf` 失败对照；实际备份 + 移除未执行，因此写路径的原子性/备份完整性未验证。
4. **token 轮换/吊销**：没有独立命令；未执行重签发与旧 token 失效测试。
5. **多进程/并发/长会话**：未测试限流跨进程行为、长会话预算衰减、并发 compile 的 SQLite 锁行为。
6. **DSH 客户端侧 schema 校验**：服务端直连已证明不校验；G1 报告所称“schema 拒绝”是否在 DSH 客户端成立，本次未用 DSH 客户端构造非法参数复现，无法证实/证伪。
7. **DSH 全局配置全量基线**：只检查了 MCP registry；没有对 DSH 其他配置文件做全量 diff，因此“未改其他 DSH 配置”仅限于本次观察范围。
8. **G2 每个角色的完整 packet 内容**：本次核对了 DB/audit、G1 summary 与 R2/R3/R4 的直接探测，未对 5 个角色逐一重新 compile 并逐段比对；G2 的 manifest 也不存 memory_id，无法单独从 manifest 证明每条记忆被选中。
9. **xingrixiao 内容级 diff**：只读 `git status` 确认无 MARS 相关改动，未逐文件 diff 其既存修改。
10. **token 文件内容/熵**：按约束未读取 token 明文；只确认文件存在、大小 44B、签发脚本使用 32 字节随机数且 principals 只存 sha256，未验证每个 token 的唯一性/随机性。

## 附录 A：关键命令与输出摘要

### A.1 测试

```text
$env:ELECTRON_RUN_AS_NODE='1'
& 'C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe' --test <11 files>
tests 56
pass 56
fail 0
cancelled 0
skipped 0
duration_ms 1648.232
exit 0
```

### A.2 直接 stdio 探测矩阵

| 场景 | 结果 |
|---|---|
| 无 token + MARS_ROLE=R4，initialize/tools/list | 成功，返回 5 个工具 |
| 无 token，memory_list | `AUTH_DENIED` |
| 无效 43 字符 token + R4，memory_list | `AUTH_DENIED` |
| R2 token + MARS_ROLE=R3，memory_list | `AUTH_DENIED` |
| R2 正常，memory_list rds-m1 | 成功 |
| R2 读 `mem_90fc3b64dacf`（R3 role） | `MEMORY_DENIED` |
| R2 读 project=xingrixiao | `AUTH_DENIED`（非 `PROJECT_DENIED`） |
| R2 `memory_get` 带 `role_id=R3` | `MEMORY_DENIED` |
| R2 `context_compile` 带 `role_id=R3` | 成功，packet role 仍为 R2 |
| R3 读 `mem_90fc3b64dacf` | 成功 |
| R4 读 `mem_90fc3b64dacf` | 成功（审批者显式读取路径） |
| R2 `memory_list {status:'bogus'}` | `{ok:true, count:0}`（无参数错误） |
| R2 `memory_list` 带额外 `token`/`role_id` | 成功，额外字段被忽略 |

### A.3 数据库核对（探测前）

- `manifests` 19 行原始数据；G2/G3/G4 的 `manifest_id`/`task_id`/`tokens_estimated` 与报告逐一吻合。
- `audit` 的 `context.compile` target packet 与报告逐一吻合；G3 报告快照 `list=67/compile=29`，探测前 `list=79/compile=36`，其余四项相同。
- `memories` 9 条：8 approved + 1 proposed；`mem_0db463660da4` 的审批事实与 G3 完全一致；`mem_90fc3b64dacf` 为 L4/role/R3；`mem_251512804a4f` 为 L2/proposed/created_by=mcp-R2。
- 探测追加 3 条 `R4-PROBE` manifest（198 tokens）及 audit，已在 §1.3 披露。

### A.4 关闭脚本

```text
# 无参数（dry-run）
registry entries: 6; mars entries: 5; will remove: 5
WHATIF: no write. Re-run with -Yes (registry.json is backed up first).
backup target: D:\M1\mars\var\mcp\registry-backup-20261103-202402.json
exit 0

# -WhatIf
A parameter cannot be found that matches parameter name 'WhatIf'.
exit 1
```

### A.5 git 边界

```text
D:\M1:            ?? mars/        （mars 整体未跟踪；无 mars 提交）
mars git log:     空
xingrixiao:       既存 docs/design 修改（d168ef1/f63f629/998c52d），无 MARS 改动
check-ignore:     mars/.gitignore:2:var/  → mars/var/mars.db、var/mcp/tokens/R0.token
                  mars/.gitignore:5:config/principals.json → mars/config/principals.json
```

## 附录 B：G4 会话 usage 复算（报告未列 ID，本次补全）

按报告 usage 行与 6 个会话逐项匹配（非报告提供的 ID 列表，匹配依据为四元组完全一致）：

| 运行 | 会话 ID | input | output | cacheRead | cacheWrite | total |
|---|---|---|---:|---:|---:|---:|---:|
| B1 | `ba0573fd-08e3-465f-af19-183678ee3a34` | 36,163 | 1,365 | 6,784 | 0 | 44,312 |
| B2 | `13d40872-204a-4206-9981-256d585981ee` | 12,377 | 1,435 | 74,880 | 0 | 88,692 |
| B3 | `6e197937-8e7f-42b3-a151-7c565c97c402` | 12,476 | 1,685 | 75,008 | 0 | 89,169 |
| T1 | `a281dae2-fd02-47a4-bd4e-fa4a4363eb15` | 36,232 | 2,030 | 51,456 | 0 | 89,718 |
| T2 | `cbdee4e1-a934-43b4-aa46-517437f98b35` | 12,368 | 822 | 74,112 | 0 | 87,302 |
| T3 | `999bc624-09b4-4207-8748-4cebc42bcdaa` | 12,404 | 986 | 74,240 | 0 | 87,630 |

复算：基线剔除首次（B2,B3）均值 88,930.5；实验剔除首次（T2,T3）均值 87,466.0；差 −1,464.5，百分比 −1.647%。output 全量均值 1,495 / 1,279.33；剔除首次 1,560 / 904。cacheRead 占比：B1 15.3%、T1 57.4%、其余 84.1%–84.9%。

---

**审查者**：R4（独立审查）
**报告路径**：`D:\M1\mars\docs\phase2-review.md`
