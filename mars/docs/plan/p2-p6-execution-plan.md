# MARS P2–P6 执行计划（WP-0 只读盘点结论）

> 依据：`MARS_P2-P6_一体化自主执行总任务书_v1.0.docx`（sha256 `824759a4…`）。
> 本文件是 WP-0 的唯一盘点结论与后续工作包契约；任何 WP 开工前须复核对应前置条件。

## 1. 当前真实状态（WP-0 实测，2026-11-03）

### 1.1 Git

| 项 | 实测 |
|---|---|
| 仓库/分支 | `D:\M1`，`main` |
| HEAD | `07f0a1e03cc9425c5ab4092f15e6778264b7b523`（`docs: 补全 M1-0 首次提交审查与执行记录`） |
| 工作区 | `status --porcelain -uall` 138 行 = 67 `mars/` 未跟踪 + 71 非 mars（70 未跟踪 + 1 修改 `tests/self/run.ps1`，44 行新增，G1 遗留） |
| tracked diff | 仅 `tests/self/run.ps1`（+44），非本任务产生，保持不动 |
| remote | `origin https://github.com/LNiiuu/rds-mother-system`（未 push） |
| 跟踪状态 | `mars/` 0 跟踪、0 提交；`mars/var/`、`mars/config/principals.json` 已被 `mars/.gitignore` 忽略 |

### 1.2 MARS 代码与测试

| 类别 | 数量/状态 |
|---|---|
| `mars/` 文件 | 80（src 13、contracts 5、config 3、scripts 7、tests 13、docs 18、README/.gitignore 2、var 19） |
| 测试 | 61/61 PASS（ledger 7 + mcp 7 + phase1 42 + phase2 5；13 个文件） |
| 基线核验 | `preMars 70 未跟踪 + 1 修改`、`preMarsSha256=8159a7ad…`、`matchesPhase0=true` |
| MCP | `mars-r0`…`mars-r4` 已注册（on-demand，5 工具/实例）；DSH 全局配置未改 |

### 1.3 数据（`mars/var/mars.db`，只读实测）

| 表 | 行数 | 备注 |
|---|---|---|
| memories | 9 | approved 8（L1 1、L2 2、L3 3、L4 1、L4-role 1）、proposed 1 |
| fragments | 20 | 含 R4-PROBE 与 G1/G2/G3 编译产物 |
| manifests | 22 | 含 3 条 R4-PROBE（`man_543a53420f11`/`man_b68cb004f36a`/`man_8136c5d708cd`） |
| aliases | 0 | 无别名数据 |
| audit | 196 | memory.list 102、context.compile 42、memory.get 18、memory.propose 13、memory.stats 12、memory.review 8、ledger.read 1 |
| 索引 | 4 | `idx_memories_project_status`、`idx_memories_type`、`idx_memories_hash`、`idx_audit_project_ts` |

- **历史遗留违反项（只标注、不删除）**：`mem_0db463660da4` 与 `mem_3bc9a242489d` 均为 `created_by=mcp-R2`、`memory_type=L3`、`status=approved`；R2 的 `allowed_types` 为 `['L1','L2','L4']`，故按 P2 修复后的规则属于“历史越权类型”。处置：保留原记录与审计，写来源标注与复核建议，不改变语义、不删除。

## 2. P2 遗留矩阵（WP-1 输入）

| ID | 问题 | 现状 | WP-1 处置 |
|---|---|---|---|
| N-03 | `store.propose` 在未传 `routing` 时跳过类型门 | 未关闭（fail-open） | 改为 fail-closed：缺省从受信配置解析，解析失败拒绝 `ROUTING_UNAVAILABLE`；补测试与文档 |
| N-08 | `memory_stats` 曾受 `store.list` 200 上限少计 | 已改全量 + `canRead` 过滤，缺 >200 行压力用例与口径说明 | 补压力测试（>200 条）、多角色口径、文档定义 |
| N-09 | G1 报告“60/60”与当前 61/61 不一致 | 已改 61/61，缺历史标注 | 文档注明“60/60 为历史值、61/61 为当前”，不覆盖历史 |
| N-01/N-02 | 边界拒绝不审计 / 成功调用双审计 | 已修复（fail() 审计、成功仅 stats 补审计） | 保持，补审计口径说明 |
| L-tools | `tools/list` 未认证 | 开放（仅结构，无数据） | 记录接受风险 + 后续评估（P3 安全基线决定） |
| L-revoke | 无 token 吊销/轮换命令 | 仅重签覆盖 | 增加 `--rotate/--revoke` 子命令与操作说明 |
| L-ratelimit | 限流仅进程内 | 未持久化 | 评估：DB 计数（跨进程）或明确接受风险 |
| L-review | MCP 无 review 工具 | 开放 | 维持：审批走服务端 CLI（人工授权），文档写明理由 |
| L-realtask | G2 为 MCP 身份调用，非 R1–R4 各自会话执行任务 | 未做 | 由 P4/P6 实验补“真实任务”证据；不足则报告差距 |
| L-multi | 多 Agent 协作仅 R0 单线程 | 未做 | P4 起引入真实并发 subagent（R1–R4 真实参与） |

## 3. 工作包与依赖

```
WP-0（本文件）
  └─ WP-1  P2 遗留 + P3 治理（安全/迁移/回滚）
       ├─ WP-2  P4 成本与质量（≥3 类任务，对照/实验，≥3 次）
       └─ WP-3  P5 跨项目共享（命名空间/默认拒绝/显式共享/撤销/泄漏测试）
            └─ WP-4  P6 编排（可解释路由/预算/反馈），前置门通过后
                 └─ WP-5  集成、压力/并发/长会话/断连、回滚演练、R4 终审、冻结候选
```

**并行边界**：WP-2 与 WP-3 可在 WP-1 完成后并行；代码文件所有权：WP-2 主要动 `src/compiler.js`、`src/budget.js`（R1 契约侧），WP-3 动 `src/store.js`、`src/db.js`（R2 侧），两者不得同改 `src/cli.js` 与 `src/mcp-stdio.js`（由 R0 集成时统一改）；WP-4 新增 `src/orchestrator.js` 与契约，不与他包同文件。

## 4. 角色与真实执行要求

| 角色 | 职责 | 必须留下的证据 |
|---|---|---|
| R0（主控） | 拆分、集成、文档、Git 只读检查 | 计划、集成记录、Git 状态、变更清单 |
| R1（架构） | `compiler.js`/`routing`/契约/`docs/architecture.md` | 决策记录、契约 diff、测试 |
| R2（存储/MCP） | `store.js`/`db.js`/`mcp-stdio.js`/迁移 | 代码、迁移与回滚脚本、测试 |
| R3（测试/基准） | `tests/**`、基准数据、Token 账本 | 测试报告、原始数据、复核命令 |
| R4（独立审查） | 只读审查、复跑、门禁判定 | 报告与 findings（不得由 R0 代写） |

- R1–R4 必须使用真实 subagent 会话；任务记录 session_id；报告注明“谁执行、证据在哪”。
- R5–R7 未真实参与则不记录，不得虚构。

## 5. 风险登记

| ID | 风险 | 触发 | 缓解 |
|---|---|---|---|
| R-1 | 数据迁移破坏历史记忆/审计 | 加列/改索引 | 迁移前 `var/backups/` 备份 + 完整性校验 + 演练恢复；只加列不改语义 |
| R-2 | SQLite 并发写冲突 | WP-2/WP-3 并行 | 只读并行、写串行；`busy_timeout`；失败重试一次后报错 |
| R-3 | Token 指标噪声导致错误结论 | G4 式小样本 | ≥3 次、剔除首轮冷启动、报告原值、含质量维度 |
| R-4 | 跨项目泄漏 | WP-3 | 默认拒绝 + 五层泄漏测试（直查/FTS/别名/统计/错误文案） |
| R-5 | MCP 身份被绕过 | 任意 | 身份仅 env；客户端参数不授权；负例测试必须每次回归 |
| R-6 | 范围蔓延 | 新想法 | 记入 backlog，不扩当前 WP |
| R-7 | 误提交/推送 | 任意 | 禁止 add/commit/push；每 WP 结束记录 status 与 diff 摘要 |

## 6. 回滚点

1. 每个 WP 开工前：`node scripts/mars-db-backup.js`（新增）备份 `var/mars.db` 到 `var/backups/mars-<stamp>.db`，并记录 SHA-256 与表行数。
2. 代码回滚：`git status` 快照 + 文件级 SHA-256 清单；不执行 `git checkout/reset/clean`，按清单删除本 WP 新增文件、按备份内容恢复被改文件（先核对哈希未被他人改动）。
3. 运行回滚：`scripts/mars-rollback.ps1 -Yes`（删 `var/`，不含源码）。
4. 每次回滚演练记录到 `docs/plan/rollback-drill.md`。

## 7. WP-0 结论

- P2 本体（G1–G5）已完成并 PASS（有条件），本阶段不重启、不覆盖；WP-1 只做遗留加固与治理。
- 允许进入 WP-1；WP-2/WP-3 在 WP-1 门禁（测试全绿、迁移可回滚、R4 抽查通过）后启动。
- 冻结候选版本前不得 commit/push；P6 完成后提交发布建议，等待用户最终确认。
