# MARS Phase 1 独立测试与验收报告（R3）

- 版本：v1.0
- 日期：2026-11-03
- 角色：R3（独立验证）；任务：MARS-P1-T84
- 被测目录：`D:\M1\mars`（源码/契约/配置只读）
- 结论：**PARTIAL（有条件通过）** — 7 项 PASS、3 项 PARTIAL（A2/A9/A10），0 FAIL、0 BLOCKED
- 证据：本报告 + `tests/phase1/` 新增测试 + 命令记录；未执行项目中标注 UNRUN，不以人工确认代替断言

## 1. 结论摘要

| 项 | 判定 | 摘要 |
|---|---|---|
| A1 Token Ledger 对账 ≤1% | **PASS** | 真实 DSH R7 会话 323 条 usage，Ledger 合计 41,597,577，与 Phase 0 原始 usage 完全一致（diff 0，0.000%）；R3 独立解码一致 |
| A2 固定任务/模型/工具基线 | **PARTIAL** | 仓库仅有 git status 基线脚本；本轮未执行固定任务+固定模型的模型级基线（UNRUN），无异常样本集 |
| A3 去重与原文恢复 | **PASS** | 同内容不同来源不合并；同内容同来源同版本不重复落库；同 hash 复用 fragment；R3/R4 可 restore 原文，R2 被拒 |
| A4 跨项目/未知身份/越权拒绝 | **PASS** | 未知/短 token、跨项目、角色不匹配、R2 review、自审均被拒；R5 读不到 L3 |
| A5 未批准不入正式 Packet | **PASS** | propose 后 compile 不含该记忆；R4 批准后才进入 |
| A6 Manifest 可追溯 | **PASS** | 每条 entry 含 source_ref/source_version/content_hash；manifest 落库且与 packet.manifest_id 一致 |
| A7 R1–R4 角色上下文 | **PASS** | R1/R2/R3/R4 role profile 与 packet 不同；R2 无 L3 决策段；R3/R4 evidence_direct 可 restore，R2 被拒 |
| A8 离线/无凭据/不改 DSH | **PASS** | 源码静态扫描无网络客户端、无 `.env` 读取、无 DSH 路径；MCP CLI 默认禁用；回滚脚本不触 DSH |
| A9 Token 优化不牺牲质量 | **PARTIAL** | 仅完成 Token 计量链路验证；未建立任务质量指标/对照，无法量化“质量不降”（UNRUN） |
| A10 完整回滚 | **PARTIAL** | 回滚脚本 dry-run 安全（exit 2，不删除）；临时仓库真实删除仅限 var 运行时文件；principals 删除与安装/DSH 注册反演未演练 |

**验收建议（给 R4/R0）**：Phase 1 核心能力（A1/A3/A4/A5/A6/A7/A8）可判定通过，可进入下一阶段设计评审；A2/A9/A10 需作为 Phase 2 准入门槛补齐（固定任务基线、质量对照、完整回滚演练），在补齐前不建议把 Phase 1 标为“已验收完成”。

## 2. 环境与边界

- 操作系统：Windows（`D:\M1` 所在主机），Shell：PowerShell 5.1 / Node v24.21.0
- 运行时：`node:sqlite`（SQLite 3.x，FTS5 可用；测试通过 FTS5 + LIKE 回退验证）
- 仓库：`D:\M1`，分支 `main`，HEAD `07f0a1e03cc9425c5ab4092f15e6778264b7b523`；`mars/` 整体为未跟踪目录（`git status --porcelain -uall` 114 行，含 `?? mars/`）
- 网络：测试全程未联网；无 npm 依赖、无 `package.json`，用系统 Node 直接运行
- 身份/凭据：测试使用临时生成的 fixture token（仅存 sha256），不读取 `.env`、不接触 DSH 配置
- 写入边界：仅新增 `D:\M1\mars\tests\phase1\**` 与本报告；未改 `src/**`、`contracts/**`、`config/**`、既有测试
- 已知限制：MARS 未纳入 git 跟踪（`mars/` 未跟踪），无法给出提交级 diff；本轮以文件哈希记录

## 3. 测试执行记录（R3 独立复跑）

| # | 命令 | 退出码 | 结果摘要 |
|---|---|---|---|
| 1 | `node --test <tests 下全部 10 个 *.test.js>` | 0 | tests 50 / pass 50 / fail 0 / skipped 0；duration 1,568.79 ms（含既有 14 + 新增 36） |
| 2 | `node --test <tests\phase1\*.test.js>`（新增测试子集） | 0 | tests 36 / pass 36 / fail 0；duration 1,501.97 ms |
| 3 | `node src/cli.js ledger --session <R7 会话> --out <temp> --db <temp>` | 0 | 写出 `ledger.json` 与 `ledger.csv`；`usage.total = 41597577`；CSV 表头与 TOTAL 行符合 `ledger.js` 固定格式 |
| 4 | `powershell -File scripts\mars-rollback.ps1 -Repo D:\M1`（dry-run） | 2 | 列出 `var\baseline-now.json`、`var\mars.db`；输出“未加 -Yes，未执行删除”；文件保持不变 |
| 5 | `powershell -File scripts\mars-rollback.ps1 -Repo <temp repo> -Yes` | 0 | 仅删除临时 `mars\var` 下 2 个运行时文件；`src` 源码仍在 |
| 6 | `node src/cli.js mcp --db <temp> --principals <temp>`（无 `--enable`） | 5 | stderr `MCP 网关默认禁用（Phase 1 安全要求）…`；未创建数据库文件 |

说明：`node --test tests` 直接把目录当模块会报 `Cannot find module`，因此统一传文件列表；Windows PowerShell 输出为 GBK，回滚测试以 GBK 解码避免中文断言误判。

### 3.1 开发过程中的失败与根因（测试缺陷，均已修正；非产品缺陷）

| # | 失败用例/现象 | 根因 | 处理 |
|---|---|---|---|
| F-1 | `A3 identical content reuses one fragment` 断言 fragments 长度=2，实际 3 | `buildManifest` 按 entry 返回 fragment 引用，同 fragment 会被返回两次（DB 仍只有 1 条） | 改为断言唯一 fragment_id 数=2、DB 行数=2、复用处 ref_count=2 |
| F-2 | 回滚测试中文断言失败（输出乱码） | PowerShell 5.1 控制台输出 GBK，Node 以 UTF-8 解码 | 测试改为 buffer 读取 + `TextDecoder('gbk')` |
| F-3 | R3 解析断言 `model='deepseek-flash'` 失败（undefined） | R3 会话事件中无 `request/header.model`，Ledger 不臆造 model | 删除该断言，保留 session_id 与 usage 自洽断言 |
| F-4 | R1 evidence 段断言“仅见引用”失败 | 未传 evidence 时 evidence 段为“（未提供证据引用）”，只有传证据才拼角色可见性说明 | 测试补 evidence fixture 后再断言角色措辞 |

修正后复跑：全量 50/50、新增子集 36/36；未修改任何 `src/**` 实现来让测试通过。

## 4. 新增测试清单（`D:\M1\mars\tests\phase1`）

| 文件 | 用例数 | 主要覆盖 | SHA-256 |
|---|---:|---|---|
| `authz.test.js` | 5 | 未知/短 token、跨项目、角色不匹配、R2 review、自审、R5 看不到 L3 | `5262475fe9100a9622f77cdcdb88396d9acb0a6288c2031d3af4ed01cf6fa0dd` |
| `lifecycle.test.js` | 5 | propose→approved 门控、visibility=role、路径穿越/绝对路径/符号链接、同内容不同来源不合并 | `7dc861bc1b0bfe6747bae77f79de3a7111c296ec0ee10c83f8e4a3d1a443cba9` |
| `retrieval.test.js` | 6 | FTS5、CJK LIKE 回退、术语别名、结构化过滤、proposed 不可检索、角色类型过滤 | `a5f7ed896d1b1a16efa5fade12eebea648f53bce50f9c7d4b000eb87665648f7` |
| `manifest.test.js` | 5 | Manifest 追溯、fragment 去重、restore 权限（R3/R4 允许、R2 拒绝）、packet↔manifest、R1–R4 角色上下文差异 | `a7ed167847c969609b34235fe10a3cf337ce9001a59e75c541d8410882cf2202` |
| `budget.test.js` | 3 | 小预算裁剪非保护段、保护段不裁、超限提示、`[ESTIMATE]` 标注 | `d2bd1bf421c232788f5b0fea42240b2ab22377f863b69e43cadf3f851dc3a53f` |
| `ledger-reconcile.test.js` | 4 | 真实会话解析 vs 独立逐帧解码、Phase 0 对账 ≤1%、CLI CSV | `a657a9f12b3243f7ff88deb4d279e6d7fc9b5d5ffd572f5eb112490a82460338` |
| `mcp-server.test.js` | 4 | 默认禁用、身份/项目/方法拒绝、propose 仅 proposed、错误码稳定不泄露路径、context.compile | `0b339d0e303e71424a14316d26975509c6ff415a410a8a43b79a759d872a8e2b` |
| `rollback-offline.test.js` | 4 | 回滚 dry-run/临时仓库删除、源码无网络客户端与 `.env`、README 离线边界 | `7e278b60fcf0b34aca4e568d736acfda2550b4eafddb70337bcf81cd02b55f44` |
| `helpers.js`（非测试夹具） | — | 临时 DB、fixture principals、propose/approve 封装 | `0cea7086ea2dc56676a34d2beaa91847991e0a050c2810b7134753ae10f31637` |

测试全部使用 `node:test` + `assert/strict`，不引入第三方依赖；临时数据库与时间戳目录均在系统临时目录，测试结束不残留对仓库的写入。

## 5. A1–A10 逐条判定与证据

A1–A10 的任务书原文取自 captain 会话 m04696（2026-11-03 归档），原文见附录 A；本仓库 `docs/` 未收录该定义，本报告以“任务书 + interfaces/security 契约”为判定依据。

### A1 Token Ledger 对账 ≤1% — PASS

- 证据：`ledger-reconcile.test.js` 4 条全通过；R7 会话（`adc6af6c-…`）323 条 `assistant/message` usage，`parseSession` 合计与独立逐帧 zstd 解码（`zstdFrames` + `zlib.zstdDecompressSync` + 手写求和）完全一致；`buildLedger` 总计 41,597,577，`reconcile(ledger, 41,597,577)` → `matched=1, diff_ratio=0`。
- 原始字段：`data.usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens}`；R7 合计 input 812,781 / output 499,100 / cacheRead 40,285,696 / cacheWrite 0 / total 41,597,577。
- 成本仅本地估算（`ledger.js` 费率 .15/.6/.003/0 USD/百万），不是 provider 发票；报告不把本地 cost 当账单。
- 复跑命令见 §3 #1/#3。

### A2 固定任务/模型/工具基线 — PARTIAL

- 已执行：读取 `scripts/mars-baseline.ps1`（仅捕获 git status/HEAD 的仓库基线），记录 HEAD `07f0a1e`、114 条 status、`mars/` 未跟踪；基线脚本逻辑本身不使用模型/工具。
- 未执行（UNRUN）：固定任务卡 + 固定模型 + 固定工具条件下的端到端运行；异常样本（超时/限流/上下文溢出）保留与说明。该运行需要 DSH 会话与模型调用，超出本任务“离线、不改 DSH 配置”的边界。
- 风险：缺少该基线，无法用同一任务对比不同编译策略的完成质量。

### A3 去重与原文恢复 — PASS

- `A3 same content from different sources is not merged`：同文本、不同 `source_ref` → 两个不同 `memory_id`；同 `project+content_hash+source_ref+source_version` → `duplicate=true` 且返回旧 id。
- `A3 identical content reuses one fragment`：Manifest 两条 entry 指向同一 `fragment_id`，DB 中 fragment 1 条、`ref_count=2`；不同内容生成独立 fragment。
- `restoreFragment`：R3/R4 返回原文与 `content_hash` 一致；R2 抛 `EVIDENCE_DENIED`。
- 实现证据：`src/manifest.js` L20-34 upsertFragment、L88-106 restoreFragment；`src/store.js` L84-90 去重查询。

### A4 跨项目/未知身份/越权拒绝 — PASS

- 未知 token → `UNKNOWN_PRINCIPAL`；短 token → `TOKEN_MISSING_OR_TOO_SHORT`；不返回“token 是否存在”等细节。
- 跨项目：`R2`（仅 p1）读 p2 → `PROJECT_DENIED`；角色不匹配 `R2` 声明 `R3` → `ROLE_DENIED`。
- review：R2 调 `memory.review` → `REVIEW_DENIED`；R0 自审 → `SELF_REVIEW_DENIED`；R4 独立批准成功并写 `provenance.approved_by`。
- 可见性：R5 检索 L3 返回 0；R3 返回该 L3（角色 profile 过滤生效）。
- 对应：`authz.test.js` 5 条；`src/authz.js` L21-51、`src/store.js` L107-160。

### A5 未批准不入正式 Packet — PASS

- 用例：R2 propose L2（`lifecycle-marker`）→ compile（R3）包内无该文本；R4 approve 后再次 compile，facts 段包含该文本。
- 实现：`retrieval.js` 各检索路径只取 `status='approved'`（L50/L67/L78），`push()` 对非 approved 仅创建者或 R0/R4 可见（L42），因此正式 packet 不引用未批准记忆。

### A6 Context Manifest 可追溯 — PASS

- 用例：3 段 sections → manifest 3 entries，每条含 `source_ref`、`source_version`、`content_hash`、`content_type`、`inclusion_reason`、`status='approved'`；manifest 落库 `manifests` 表，`packet.manifest_id` 与之相等；evidence 段 `source_refs` 保留原始引用。
- 角色/任务：manifest 行含 `role_id='R3'`、`task_id='T-P1-MAN'`；schema 校验由 `buildManifest` 内部完成（`manifest.schema.json` required 字段）。

### A7 角色上下文与独立证据 — PASS

- R2 与 R3 编译同一任务：`role_profile` 不同；R3 有 `decisions` 段，R2 无 L3 段且 `missing` 中 `decisions` 为 blocking=true（角色 allowed_types 不含 L3）。
- R1 vs R4：profile 不同；含证据时 R1 的 evidence 段为“仅见引用”，R4 为“可直接访问原始证据”；`evidence_direct` 与 `config/role-routing.json` 一致。
- 原始证据访问：`restoreFragment` R3/R4 成功、R2 被拒（同 A3 用例）。

### A8 离线/无凭据/不改 DSH — PASS

- 静态扫描（`rollback-offline.test.js`）：`src/`、`scripts/`、`config/` 中无 `http/https/net/tls/dns/dgram` require、无 `fetch(`、无 WebSocket；无 `'.env'` 读取；无 `process.env.DSH_*` 与 `C:\Users\…\.dsh` 写入路径。
- 运行时：CLI `mcp` 无 `--enable` → exit 5 且不创建 DB；测试全部使用临时 fixture token（只存 sha256），未读取真实凭据。
- 未做：socket 级抓包证明“零网络”（静态 + 无网络依赖已足够，但本报告不宣称已完成抓包验证）。

### A9 Token 优化不牺牲质量 — PARTIAL

- 已完成：Token 计量（A1）与预算裁剪（`applyBudget`/`compile`）行为验证；packet 标注 `[ESTIMATE]`，超预算时只裁非保护段。
- 未执行（UNRUN）：任务完成质量指标（如验收清单通过率、人工评分、回归用例）与“优化前/后”对照；因此无法证明“质量不降”。MARS Phase 1 本身不含模型生成，质量对照需在 Phase 2 的固定任务基线上做。

### A10 完整回滚 — PARTIAL

- 已验证：dry-run 只列出 `mars\var` 运行时文件并 exit 2（不删除）；临时仓库 `-Yes` 仅删除 2 个 var 文件、源码保留；脚本有路径越界检查（`StartsWith($resolved)`）。
- 未演练（UNRUN）：`-RemovePrincipals` 删除 `config/principals.json`；`mars-install.ps1` 的安装反演/DSH 注册撤销（安装本身未执行，避免改 DSH 配置）；数据库内容级回滚（当前仅删除文件）。

## 6. Token 对账表（provider usage 原始值）

快照时间：2026-11-03T11:22:04.605Z（本报告撰写前）；会话文件为 DSH 原生多帧 zstd，Ledger 逐帧解析。

| 会话 | usage 事件 | input | output | cacheRead | cacheWrite | total | 对照值 | 误差 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R7 `adc6af6c…` | 323 | 812,781 | 499,100 | 40,285,696 | 0 | **41,597,577** | Phase 0 原始合计 41,597,577 | **0（0.000%）** |
| R3 `ab2cb09e…` | 654 | 2,167,465 | 769,465 | 104,611,456 | 0 | 107,548,386 | 无固定对照（会话仍在增长） | 自洽（独立解码一致） |

结论：A1 的 ≤1% 阈值在 R7 上以 0 误差满足；R3 用于交叉验证解析器一致性，不作为固定基线（该会话在本次运行期间仍在追加）。

## 7. 未覆盖项与风险

| 编号 | 类型 | 说明 | 建议 |
|---|---|---|---|
| U-01 | UNRUN | 固定任务/模型/工具基线与异常样本（A2） | Phase 2 准入前由 R0/R1 设计固定任务卡，R3 复跑 |
| U-02 | UNRUN | 质量不降对照（A9） | 与 U-01 同批设计验收清单与评分表 |
| U-03 | UNRUN | principals 删除、安装反演、DSH 注册撤销（A10） | 在隔离环境演练，另立任务 |
| U-04 | 环境 | 无 `package.json`/CI，测试依靠系统 Node 24 | 增加最小 `package.json` 与 CI 脚本（不改业务代码） |
| U-05 | 环境 | 测试依赖宿主真实 DSH 会话路径；文件缺失时 skip 而非 fail | CI 中用固定样本会话文件替代宿主路径 |
| U-06 | 实现 | MCP 测试走进程内 `handle()`，未覆盖 stdio 传输层 | Phase 2 增 stdio 集成测试 |
| U-07 | 实现 | 无 socket 级断网证明；无 provider 发票核对 | 安全测试补网络命名空间/抓包；成本以账单为准 |
| U-08 | 数据 | `var/mars.db` 与 `config/principals.json` 为运行产物/占位身份 | 部署时按 `principals.example.json` 重建，勿提交真实 token |

## 8. 复现命令

```powershell
cd D:\M1\mars
# 全量（既有 + Phase 1 新增）
$files = Get-ChildItem tests -Recurse -Filter *.test.js | ForEach-Object { $_.FullName }
node --test $files

# 仅新增 Phase 1 测试
node --test (Get-ChildItem tests\phase1 -Filter *.test.js | ForEach-Object { $_.FullName })

# Ledger CLI（离线；R7 会话为 Phase 0 快照）
node src/cli.js ledger --session "C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\adc6af6c-e78c-4df5-9da0-646fcd0abd74\session.v4.jsonl.zstd" --out "$env:TEMP\mars-ledger" --db "$env:TEMP\mars-ledger\cli.db"

# 回滚 dry-run（安全，不删除）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mars-rollback.ps1 -Repo D:\M1
```

## 9. 证据索引

- 测试：`D:\M1\mars\tests\phase1\{authz,lifecycle,retrieval,manifest,budget,ledger-reconcile,mcp-server,rollback-offline}.test.js`（哈希见 §4）
- 被测实现（只读引用）：`src/authz.js`、`src/store.js`、`src/retrieval.js`、`src/manifest.js`、`src/budget.js`、`src/compiler.js`、`src/ledger.js`、`src/mcp.js`、`src/cli.js`、`src/util.js`、`src/db.js`
- 契约：`contracts/{memory,manifest,context-packet,role-routing,ledger}.schema.json`；`docs/interfaces.md`、`docs/security.md`
- 配置：`config/role-routing.json`（角色 profile/evidence_direct/protected）；fixture principals 由测试临时生成
- 真实会话：`C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\adc6af6c-e78c-4df5-9da0-646fcd0abd74\session.v4.jsonl.zstd`（R7，3,827,765 B）、`…\ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef\session.v4.jsonl.zstd`（R3）
- 仓库边界：`D:\M1` 分支 `main`、HEAD `07f0a1e03cc9425c5ab4092f15e6778264b7b523`；`mars/` 未跟踪；本轮未 commit、未 push
- 命令输出摘要：50/50 pass（1.57 s）；36/36 pass（1.50 s）；R7 total 41,597,577；回滚 dry-run exit 2；MCP 默认禁用 exit 5

## 10. 越界声明

本轮只新增 `D:\M1\mars\tests\phase1\**` 与 `D:\M1\mars\docs\phase1-test-report.md`；未修改 `src/**`、`contracts/**`、`config/**`、既有测试，未联网，未执行 git 写操作，未改 DSH 全局配置。测试未覆盖项均以 UNRUN/PARTIAL 标注，未以人工确认代替断言，未通过修改实现使测试通过。

## 附录 A：A1–A10 任务书原文（captain 会话 m04696）

- A1：Token Ledger 与原始 DSH usage 对账误差 ≤1%。
- A2：固定任务、固定模型、固定工具条件下完成基线测试；异常样本保留并说明。
- A3：相同任务卡文本在存储层只保留一份，引用可以恢复原文。
- A4：跨项目读取、未知身份、越权角色读取全部拒绝。
- A5：未经批准的记忆无法被正式 Context Packet 引用。
- A6：Context Manifest 能追溯每段上下文的来源、版本、角色和任务。
- A7：R1–R4 获得符合各自职责的上下文，R3/R4 可访问独立验证所需原始证据。
- A8：离线运行，无凭据访问，无 DSH 全局配置变化。
- A9：Token 优化不能以牺牲任务完成质量为代价。
- A10：完整回滚方案通过验证。
