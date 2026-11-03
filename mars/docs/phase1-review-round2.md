# MARS Phase 1 第二轮独立审查（P1–P12 修复复核）

> 审查角色：R4-审查（独立复核，不采信 R0/R1/R2 自述）
> 任务：MARS-P1-R2-R4（t88），复核对象为 R4 首轮审查 `docs/phase1-review.md`（t85）所列 P1–P12 的修复
> 审查时间：2026-11-03 19:40–19:55（+08）
> 审查方式：源码逐行核对 + 本人复跑 + API/CLI 双路径探测；所有结论附复现命令与退出码

## 0. 快照与审查对象

### 0.1 代码与文档快照（R4 实测，`[IO.File]::ReadAllLines`，2026-11-03 19:52）

| 文件 | 行数 | 字节 | SHA-256 前 16 | mtime |
|---|---:|---:|---|---|
| `src/manifest.js` | 114 | 5,593 | `2be48825604d48c0` | 19:33:56 |
| `src/retrieval.js` | 102 | 3,960 | `86244c740fbdb6f2` | 19:33:56 |
| `src/compiler.js` | 140 | 6,583 | `61f980302bd684dd` | 19:34:06 |
| `src/validate.js` | 95 | 4,290 | `6a4a6d9d713306fe` | 19:34:16 |
| `src/cli.js` | 213 | 8,863 | `b4d45ca3441a66e6` | 19:36:00 |
| `src/store.js` | 177 | 9,111 | `6ff8cdba4b509ded` | 19:23:45 |
| `docs/architecture.md` | 594 | 40,096 | `b61b201d49f4aade` | 19:39:39 |
| `docs/interfaces.md` | 104 | 6,133 | `4bc253b19ec23268` | 19:36:17 |
| `README.md` | 68 | 3,110 | `a58e4df3469d1dbc` | 19:37:51 |
| `.gitignore`（新增） | 5 | 145 | `c18a8d0a9df1391b` | 19:36:12 |
| `tests/phase1/remediation.test.js`（新增） | 71 | 3,666 | `8894bb167be0b5d3` | 19:35:19 |
| `docs/phase1-review.md`（首轮） | 203 | 20,064 | `894dd80680067a20` | 19:33:28 |

说明：R1（t87）报 architecture.md 为 595 行；R4 以 `ReadAllLines` 实测 594 行、字节 40,096 B 与其一致，差值来自行尾计数口径，不构成缺陷。

### 0.2 Git 状态（WSL 只读，`/mnt/d/M1`）

- `HEAD` = `07f0a1e`，`origin/main` = `07f0a1e`，**无 ahead/behind、无 push**。
- `git status --porcelain -uall`：129 行，其中 `mars/` **44 个文件全部未跟踪**，`mars/` 下**已跟踪文件修改数 = 0**。
- 结论：本轮修复全部位于未跟踪工作区（`mars/` 从未入库），**未发生 git 写/提交/推送**；这与 R1 的「仅改 architecture.md」陈述一致（`mars/src/*` 属他人任务修复，非 R1 改动）。

## 1. 结论

**verdict：PARTIAL（修复轮有条件通过；Phase 1 整体不升级为 PASS）**

- **P1–P9、P11：已修复**（0 blocker / 0 high / 0 medium 残留），每条均有本人复跑或代码级证据。
- **P10（review 状态迁移未校验）：未修复**，保留为 known limitation（low）。
- **P12（测试报告未覆盖 query 污染路径）：未修复**，保留为 info/known limitation。
- Phase 1 整体维持首轮 **PARTIAL**：`docs/acceptance.md` 仍缺、模型级 Token 基线未做、L-14（ledger reconcile 占位）/L-15（MCP 暴露 propose）仍开放；本轮**不提升结论**。

## 2. 复跑记录（R4 本人执行）

| # | 命令 | 退出码 | 关键输出 |
|---|---|---:|---|
| 1 | `node --test`（cwd `D:\M1\mars`） | 0 | `tests 54 / pass 54 / fail 0 / skipped 0`，duration 1,513 ms |
| 2 | 用例分布（静态计数 `^\s*test\(`） | — | ledger 8 + mcp 6 = **14 旧**；phase1 40（含 remediation 4）= **36 R3 + 4 R0**；合计 **54** |
| 3 | API 探针：P1 `restoreFragment`（R2 token） | 0 | `--role R3` → `ROLE_DENIED`；R3 token `--role R3` → 成功；R3 token `--role R4` → `ROLE_DENIED`；R4 token `--role R4` → 成功 |
| 4 | CLI：`node src/cli.js fragment get … --token <R2> --role R3` | **4** | `ERROR ROLE_DENIED` |
| 5 | CLI：`node src/cli.js fragment get … --token <R3> --role R3` | **0** | 返回 fragment `content/content_hash/original_ref`（content 为 packet 任务段原文） |
| 6 | API 探针：P2 `retrieve(..., {query:'ALPHA', type:'L3'})`（R1 身份） | 0 | 仅返回 `L3:DECISION-ALPHA`；`type='L2'` 仅 `L2`；`type='L4'` 仅 `L4` |
| 7 | API 探针：P2 `compileContext`（R1 + query） | 0 | `facts` 仅 `(L2,`、`decisions` 仅 `(L3,`、`knowledge` 仅 `(L4,`；无跨类型混入 |
| 8 | API 探针：P2 `compileContext`（R2 + query） | 0 | `decisions` 缺失且 `missing=["decisions*"]`（R2 `allowed_types` 不含 L3，行为正确） |
| 9 | API 探针：P3 `buildManifest` 传入 `status:'deprecated'` 段 | 0 | entry `status=deprecated`（不再硬写 approved） |
| 10 | API 探针：P4 `validate`（memory schema） | 0 | `tags` 33 个 → `valid=false`；`memory_type='L9'` → `invalid`；`created_at` 非 date-time → `invalid` |
| 11 | CLI：`node src/cli.js help` / 无参数 | **0** / **0** | 打印用法（首轮为 exit 1） |
| 12 | CLI：`node src/cli.js stats --project p1`（无 token） | **3** | `ERROR 认证失败：TOKEN_MISSING_OR_TOO_SHORT`（首轮无鉴权） |
| 13 | CLI：`node src/cli.js mcp`（无 `--enable`） | **5** | `MCP 网关默认禁用…`（安全默认保持） |

## 3. P1–P12 逐项复核

| ID | 首轮严重级 | 状态 | 证据（代码/文档/复跑） |
|---|---|---|---|
| P1 | high | **已修复** | `src/manifest.js:94` 新增 `if (!Array.isArray(principal.roles) \|\| !principal.roles.includes(role_id)) throw new Error('ROLE_DENIED')`；CLI 复跑：R2 token + `--role R3` → exit 4 `ROLE_DENIED`，R3 token + `--role R3` → exit 0 成功（第 3–5 条）；`tests/phase1/remediation.test.js:20-33` 覆盖 |
| P2 | high | **已修复** | `src/retrieval.js:40-41` 双校验：先 `profile.allowed_types.includes(record.memory_type)`，再 `if (type && record.memory_type !== type) return;`；`src/compiler.js:62-72` 仍按 L2/L3/L4 分检索但不再跨类型；探针：type=L3 仅 L3，编译 sections 内各类型互不混入（第 6–8 条）；`remediation.test.js:35-48` 覆盖 |
| P3 | medium | **已修复** | `src/compiler.js:16-29` `sectionFromMemories` 透传 `source_version/visibility/status`；`src/manifest.js:51` 改为 `status: section.status \|\| 'approved'`；探针 entry=`deprecated`（第 9 条）；`remediation.test.js:50-60` 覆盖 |
| P4 | medium | **已修复** | `src/validate.js:5-6,33-63` 新增 `oneOf`、`format(date-time)`、`minItems/maxItems/uniqueItems`；探针三条非法值全部拒绝（第 10 条）；`remediation.test.js:62-71` 覆盖 |
| P5 | medium | **已修复（文档）** | `docs/architecture.md:306` 规则行改为「compiler 的 L2/L3/L4 查询均带 `status='approved'`；`retrieval.push()` 同时校验 `allowed_types` 与本次显式 `type`」；`:310` [FACT] 引用 `src/retrieval.js:40-41` 与 `tests/phase1/remediation.test.js:35-40`；全文已无「仅通过 type 查询」表述 |
| P6 | medium | **已修复（文档）** | `docs/architecture.md:85`、`:526`（L-13）改为「`node --test` 54/54（14 旧 + 36 R3 phase1 + 4 R0 remediation）」；`README.md:51-52` 同步 54 用例说明；实测计数一致（第 2 条） |
| P7 | low | **已修复（文档）** | `docs/interfaces.md:15` 将 `estimateTokens` 归入 `util.js`；`:53-54` 置于 `// util.js` 段，`:56` 起为 `// budget.js`，与 `src/util.js:26-35`、`src/budget.js` 导出一致 |
| P8 | low | **已修复** | `src/cli.js:130` `mcp.start({…, allowedRoots: allowedRoots()})`；`src/mcp.js:109` `store.propose(…, { allowedRoots })` 已接线；`src/cli.js:43-46` 允许根默认 `D:\M1`（`MARS_ALLOWED_ROOTS` 可覆盖） |
| P9 | low | **已修复** | `src/cli.js:62-65` help/无命令 `exit(0)`；`src/cli.js:100-103` `stats` 走 `loadAuth` 并写 `memory.stats` 审计；复跑第 11–12 条 |
| P10 | low | **未修复（known limitation）** | `src/store.js:153` 仅校验 decision 枚举（`DECISION_INVALID`），仍无状态迁移矩阵（`deprecated→approved` 可直转）；`docs/architecture.md:516`（L-03）已披露为设计接受项（P1 优先级） |
| P11 | low | **已修复** | 新增 `mars/.gitignore`：`var/`、`*.log`、`config/principals.json`；`mars/var/mars.db`（98,304 B）仍存在但已被忽略；`git status` mars 全部未跟踪、无已跟踪污染 |
| P12 | info | **未修复（known limitation）** | `docs/phase1-test-report.md:68` 仍只列 manifest 测试，未见 query 污染/类型过滤条目；`tests/phase1/remediation.test.js` 已覆盖 P2，但测试报告未同步（info 级，不影响功能） |

## 4. 文档与实现一致性抽查

| 断言 | 来源 | 实现 | 结论 |
|---|---|---|---|
| restoreFragment 校验 principal.roles | architecture v1.2 §1.3/§5 | `src/manifest.js:94` | 一致 |
| pair `allowed_types` + 显式 `type` | architecture L306/L310 | `src/retrieval.js:40-41` | 一致（行号逐字匹配） |
| 54 用例（14+36+4） | architecture L85/L526、README L52 | 实测 54（8+6+40） | 一致 |
| validate 关键字集（含 maxItems/format/oneOf/uniqueItems） | architecture §1.3/§7 | `src/validate.js:4-6,33-63` | 一致 |
| CLI stats 鉴权、help exit 0、mcp 默认禁用 | architecture §8.1 | `src/cli.js:62-65,100-103,127-130` | 一致 |
| MCP 默认不注册 DSH | architecture §8.1、security §5 | `src/mcp.js:136-140` + 复跑 exit 5 | 一致 |

## 5. 残余风险与 known limitation（本轮不修复，需登记）

| 编号 | 严重级 | 位置 | 说明 | 建议 |
|---|---|---|---|---|
| R-88-01 | low | `src/cli.js:68,107,201` | `init`/`ledger`/`audit` 三个本地命令仍不要求 token（首轮 P9 仅覆盖 `stats`） | 单用户本地工具可接受；如需共享部署，应在 CLI 层统一要求 `--token` |
| R-88-02 | low | `src/manifest.js:51` | 非记忆段（task/state/prohibitions/evidence）无 `status` 来源，entry 仍落 `approved`；当前均为合成段，语义可接受 | 若后续引入 draft 段，需显式传 status |
| P10 | low | `src/store.js:150-167` | review 无状态迁移校验（可 `deprecated→approved`） | Phase 2 引入状态机或显式白名单 |
| P12 | info | `docs/phase1-test-report.md` | 未登记 remediation 4 用例与 query 过滤覆盖 | 交付前补一节「修复回归」 |
| L-13/L-14/L-15 | 既有 | `docs/acceptance.md` 缺；`ledger.js:216` reconcile 占位；MCP 暴露 propose | 首轮已知，非本轮回归 | 按 v1.2 架构 §9.2 继续跟踪 |
| A2 模型级基线 | 既有 | — | 未执行模型级 Token 质量对照（仅会话解析/对账） | 列为 Phase 2 前置 |

## 6. 与首轮结论的差异

1. 首轮 2 high（P1/P2）均已关闭，且各有「代码行 + 用例 + 独立复跑」三重证据，本轮不再保留 high。
2. 首轮 4 medium（P3–P6）全部关闭：P3/P4 为代码修复，P5/P6 为文档与实现对齐（architecture v1.2）。
3. 首轮 5 low 中 P7/P8/P9/P11 关闭，**P10 保留**（状态迁移，属设计接受项）。
4. 首轮 2 info 中 P12 保留（测试报告未同步），不构成功能缺陷。
5. **结论维持 PARTIAL**：修复轮验证通过，但 Phase 1 整体「可交付」仍受 L-13（acceptance 文档）、L-14、L-15、模型级基线四项制约，不满足 PASS 条件。

## 7. 限制与边界

- 本审查只读：未修改 `mars/` 任何实现、测试、契约或文档（本轮新增本文件除外）；未联网；未执行 git 写。
- 探针均在 `%TEMP%` 下临时 DB/principals 中运行，未触碰 `mars/var/mars.db` 与 `config/principals.json`。
- 未做模型级 Token 对账（无模型调用），仅复算会话 usage 与预算裁剪逻辑。
- 未演练 `mars-rollback.ps1 -Yes` 的真实删除路径（仅干跑）。
- 快照以 §0.1 为准；若审查窗口后源码再变更，以变更后另行复核为准。
