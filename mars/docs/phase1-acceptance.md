# MARS Phase 1 验收汇总（R0）

- 日期：2026-11-03
- 范围：`D:\M1\mars`（MARS 记忆/检索/上下文编译子系统 Phase 1）
- 依据：任务书 m04696；R3 测试报告 `phase1-test-report.md`；R4 首轮 `phase1-review.md`；R4 第二轮 `phase1-review-round2.md`
- 结论：**PARTIAL（有条件通过）** —— 0 blocker / 0 high / 0 medium 残留；3 项验收为 PARTIAL（A2/A9/A10），2 项已披露限制（P10/P12），2 项低风险残余（R-88-01/R-88-02）。未提交、未推送，等待用户验收。

## 1. 交付物（14 项）

| # | 交付 | 位置 |
|---|---|---|
| 1 | 架构与接口文档 | `docs/architecture.md`（v1.2，595 行）、`docs/interfaces.md`（6,133 B） |
| 2 | 统一数据契约 | `contracts/{memory,manifest,context-packet,role-routing,ledger}.schema.json` |
| 3 | Memory Store | `src/store.js`、`src/db.js`（7 表：memories/aliases/fragments/manifests/audit/meta + FTS5 虚表） |
| 4 | Retrieval | `src/retrieval.js`（ID/结构化/FTS5/别名；type 双校验） |
| 5 | Context Compiler | `src/compiler.js`（角色差异、budget、missing、evidence_direct） |
| 6 | Manifest 与去重 | `src/manifest.js`（hash 复用、片段原文恢复、roles 校验） |
| 7 | Budget | `src/budget.js`（保护 decision/security/acceptance/interface/evidence） |
| 8 | Usage Ledger | `src/ledger.js`（多帧 zstd/JSONL、对账、CSV） |
| 9 | MCP Gateway | `src/mcp.js`（memory.get/list/stats/propose/context.compile；默认禁用） |
| 10 | 安全权限测试 | `tests/phase1/authz.test.js`、`remediation.test.js`、G2 探针记录 |
| 11 | Token 基线与对比 | `docs/token-baseline.md` |
| 12 | 独立审查报告 | `docs/phase1-review.md`、`docs/phase1-review-round2.md` |
| 13 | 完整测试 | `tests/**`（54 用例）+ `docs/phase1-test-report.md` |
| 14 | 修改文件/Git/回滚 | 本文件 §5–§7；`scripts/mars-{baseline,install,rollback}.ps1` |

## 2. 验收 A1–A10

| 项 | 判定 | 证据 |
|---|---|---|
| A1 Token 对账 ≤1% | PASS | R4 独立复算：R3 会话 `events=323/total=41,597,577`，逐帧复算误差 0；`tests/phase1/ledger-reconcile.test.js` |
| A2 固定任务基线 | PARTIAL | 仅有字符估算对照（`token-baseline.md`：角色包 679–812 est vs MARS packet 114–189），未做同任务真实 provider usage 前后对照 |
| A3 跨项目/未知身份/越权拒绝 | PASS | G2 探针（AUTH_DENIED/PROJECT_DENIED/SOURCE_REF_DENIED/REVIEW_DENIED/SELF_REVIEW_DENIED/EVIDENCE_DENIED）；R4 第二轮 P1/P2 复现通过 |
| A4 同文本仅一份且可恢复 | PASS | `manifest.test.js`；R4 复核 fragment hash 唯一与原文恢复 |
| A5 未批准记忆不进上下文 | PASS | `lifecycle.test.js`、`compiler` 仅 approved；R4 复核 |
| A6 Manifest 可追溯 | PASS | packet `manifest_id` + entries fragment_id/content_hash；R4 复核 |
| A7 角色上下文符合职责、R3/R4 可读原文 | PASS（修复后） | P1 修复 `manifest.js:94` roles 校验；P2 修复 `retrieval.js:40-41` type 双校验；R4 第二轮复跑 |
| A8 离线/无凭据/无 DSH 配置变化 | PASS | 全部测试离线；未读 .env；git status 无 DSH/M1 全局改动 |
| A9 优化未牺牲质量 | PARTIAL | 未设质量对照组；仅以 54 测试与固定任务结构验证 |
| A10 回滚方案可验证 | PARTIAL | `mars-rollback.ps1` 干跑 exit 2；临时库 `-Yes` 演练 exit 0（R3）；principals 删除与安装反演未演练 |

最终：**7 PASS / 3 PARTIAL / 0 FAIL / 0 BLOCKED**。

## 3. R4 问题闭环（P1–P12）

| 项 | 级别 | 状态 | 修复/证据 |
|---|---|---|---|
| P1 restoreFragment 无 roles 校验 | high | 已修复 | `src/manifest.js:94` → `ROLE_DENIED`；`remediation.test.js` P1 |
| P2 query 跨类型污染 | high | 已修复 | `src/retrieval.js:40-41`；`remediation.test.js` P2 |
| P3 manifest status 硬写 approved | medium | 已修复 | `src/manifest.js:51` 透传；`remediation.test.js` P3 |
| P4 validate 关键字缺失 | medium | 已修复 | `src/validate.js` 支持 maxItems/uniqueItems/format/oneOf；`remediation.test.js` P4 |
| P5 architecture 类型过滤表述 | medium | 已修复 | `architecture.md` v1.2 L306/L310 |
| P6 architecture 用例数表述 | medium | 已修复 | `architecture.md` v1.2 L85/L526（54/54） |
| P7 estimateTokens 归属 | low | 已修复 | `docs/interfaces.md` 归 util.js |
| P8 mcp.start 缺 allowedRoots | low | 已修复 | `src/cli.js`、`src/mcp.js` |
| P9 help/exit、stats 无鉴权 | low | 已修复 | help exit 0；`stats` 需 token+project 并 authorize+audit |
| P10 review 状态迁移未校验 | low | 保留（已披露） | `architecture.md` L516/L-03；不阻断 |
| P11 运行产物进提交范围 | info | 已修复 | `mars/.gitignore`（var/、principals.json） |
| P12 测试报告未含修复用例 | info | 保留（info） | 修复用例见 `tests/phase1/remediation.test.js` 与本文件 |

## 4. 测试与安全证据

- `node --test`（`D:\M1\mars`）：**54/54 pass**，0 fail，0 skipped，EXIT=0（R0、R4 各自复跑一致）。
- CLI：`mcp` 无 `--enable` → exit 5；`stats` 无 token → exit 3；`help` → exit 0；`rollback` 干跑 → exit 2 且不删除。
- G2 拒绝矩阵（临时库）：badToken、跨项目、`../etc/passwd`、`C:/Windows/system.ini`、R5 审批、自审、R2 恢复原文、MCP 未知 token 全部拒绝。
- 基线：`mars-baseline.ps1` → preMars 70 未跟踪 + 1 修改 + 0 暂存，`preMarsSha256=8159a7ad39c0…6c5fa`，`matchesPhase0=true`。
- 敏感信息：仓库无 token 明文（仅 `token_sha256` 占位/哈希）；`config/principals.json` 已被 `.gitignore` 排除。

## 5. Token 基线（估算，方向性）

| 指标 | 改造前（角色执行包） | 改造后（MARS packet） |
|---|---|---|
| 角色包字节 | 2,715–3,247 B | — |
| 估算 tokens | 679–812（字节/4） | R0 189 / R1 153 / R2 116 / R3 176 / R4 177 / R5 116 / R6 143 / R7 114 |

说明：两者口径不同（角色包含完整角色卡，MARS packet 不含角色卡），不可直接相减；真实节省需 A2 的真实 provider usage 对照。

## 6. Git 状态

- HEAD `07f0a1e03cc9425c5ab4092f15e6778264b7b523` = `origin/main`（无 ahead/behind）。
- `mars/`：45 条未跟踪（`git status --porcelain -uall`），0 已跟踪修改；`mars/var/` 与 `config/principals.json` 已忽略。
- 非 `mars/`：71 条 = 70 未跟踪 + 1 已跟踪修改 `tests/self/run.ps1`（G1 遗留，非本任务产生）。
- 未 commit、未 push、未改 DSH/REA/MCP 配置、未触碰星日晓与旧项目。

## 7. 回滚

1. 删除 `D:\M1\mars` 整个目录（本任务新增，全部未跟踪）。
2. 无需恢复任何已跟踪文件（本任务未修改 `mars/` 以外文件）。
3. 运行时库 `mars/var/mars.db` 与本地 `config/principals.json` 在目录内，随目录删除。
4. 如只清运行产物：`scripts/mars-rollback.ps1 -Yes`（仅删 `var/` 与可选 principals，不删源码/文档）。

## 8. 残余风险与限制

- P10（review 状态迁移未校验）、P12（测试报告未同步新增用例）— 已披露，不阻断。
- R-88-01：`init`/`ledger`/`audit` 本地 CLI 未要求 token（low）。
- R-88-02：非记忆段 manifest status 默认 approved（low）。
- A2/A9/A10 为 PARTIAL，需 Phase 2 前或后续迭代补：真实 token 前后对照、质量对照、完整回滚演练。
- MCP 未注册 DSH、无 token 发放/吊销/限流；`cacheWrite` 费率按 0。

## 9. 结论

Phase 1 功能与安全闭环达到“有条件通过”标准：54/54 测试通过、R4 两轮独立审查无 blocker/high/medium 残留、Git 与回滚边界清晰。等待用户验收；未获授权前不提交、不推送、不启动 Phase 2。
