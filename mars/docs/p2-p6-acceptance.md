# MARS P2–P6 最终验收报告（候选版本冻结）

日期：2026-11-03
范围：`D:\M1\mars`（MARS 子系统，schema v4）
依据：《MARS P2–P6 一体化自主执行总任务书 v1.0》（`mars/var/taskbook-p2-p6.txt`）
状态：**候选版本已冻结，等待用户最终确认；未 commit、未 push。**

## 1. 合规与边界

| 约束 | 结果 |
|---|---|
| 仅改 `D:\M1` 下 MARS 与必要的本地 MCP 注册 | 是；`mars/` 全部未跟踪、未提交 |
| 保护 Phase 0 的 71 个非 mars 记录 | 71 行未变（70 未跟踪 + 1 `tests/self/run.ps1` 修改） |
| 不访问旧项目 `rwgl` | 未访问 |
| 不改 `D:\Projects\xingrixiao` | 未改（Windows git 状态干净；WSL 侧既有 CRLF 差异未触碰） |
| DSH 侧改动最小化 | 仅通过 `mcp_register` 注册 5 个 MARS stdio 服务（`registry.json` 因此更新，属预期）；未改 Profile/权限/插件 |
| 不引入付费/外部服务、不联网 | 未使用；Embedding/向量库未引入 |
| 不删除历史/审计 | 未删除；新增仅追加 |
| 不执行 `git add -A`/reset/clean/commit/push | 未执行；暂存 0 |
| 不读取/输出 token 明文 | 未输出；报告中 token 均脱敏 |

## 2. 十项交付映射

| # | 交付 | 路径 | 状态 |
|---|---|---|---|
| 1 | P2 遗留关闭/接受风险矩阵 | `docs/plan/p2-legacy-matrix.md` | 完成（9/9 low、5/5 medium 关闭；4 条接受项） |
| 2 | P3 记忆治理文档 | `docs/governance.md` | 完成（状态机/可见性/过期/审计/迁移） |
| 3 | P4 成本/质量对照原始数据、脚本、分析、结论 | `docs/p4-cost-quality-report.md` + `experiments/p4/`（fixtures/prompts/results/score/usage）+ `scripts/phase4-*.js` | 完成（6 任务×2 臂，质量 22/24 vs 23/24；用量 618,767 vs 702,203） |
| 4 | P5 共享与隔离证据 | `docs/sharing.md` + `tests/phase3/sharing.test.js` + `scripts/phase3-sharing-smoke.js` | 完成（5/5 用例 + smoke `ok:true`） |
| 5 | P6 路由/预算/反馈/评估 | `docs/orchestration.md` + `src/orchestrator.js` + `tests/phase4/orchestrator.test.js` | 完成（7/7 用例；高风险审批门、超预算暂停、离线建议） |
| 6 | 完整测试报告 | `docs/plan/test-report.md` | 完成（80/80、安全、E2E、压力、长会话、回滚） |
| 7 | R4 独立审查报告与问题关闭证据 | `docs/plan/wp5-review.md` + `docs/plan/wp1-review.md` + `docs/phase2-review*.md` | 见 §6 |
| 8 | 架构/接口/安装/禁用/运行/回滚说明 | `docs/architecture.md` v1.4、`docs/interfaces.md`、`docs/mcp-access.md`、`README.md`、`docs/plan/rollback-drill.md`、`docs/plan/wp5-integration.md` | 完成 |
| 9 | 最终 Git 状态、文件级变更清单、候选指纹 | `docs/plan/candidate-manifest.json` + 本报告 §5 | 完成 |
| 10 | 面向用户总结：完成/未完成/风险/成本质量/发布建议 | 本报告 §7、§8 + 聊天总结 | 完成 |

## 3. 门槛判定

| 门槛 | 要求 | 结果 |
|---|---|---|
| Blocker/High | 0 | **0**（R4 两轮、WP-1 复核、终审均无 blocker/high 残留；WP-1 的 F-01 为过程性条件，已由冻结快照处置） |
| Medium | 全修或用户接受 | 5/5 修复；接受项 4 条见交付 1 |
| Low | 有处置/责任人/影响 | 9/9 关闭 |
| G1 安全 | 独立测试、默认拒绝 | PASS（`docs/phase2-g1-security-report.md`） |
| P4 | 可复现多任务对照、区分实际/缓存/估算成本 | PARTIAL 偏 PASS（6 任务、3 类；真实 usage 复算；n=1 非盲评已披露） |
| P5 | 默认隔离、显式授权、撤销、间接泄漏 | PASS（5 用例 + smoke） |
| P6 | 解释/预算/熔断/人工覆盖/回滚 | PASS（规则解释、预算暂停、高风险审批门、`plan` 可重算回退、`suggest` 建议模式） |
| 全套测试 | 通过 | **80/80 PASS** |
| R4 直接检查 | 源码/DB/证据/Git | 见 §6 |

## 4. 关键实测数字

| 项 | 数值 |
|---|---|
| 测试 | 80/80 PASS（ledger 8 / mcp 6 / phase1 42 / phase2 6 / phase3 5 / phase4 7 / wp1 6） |
| 生产库 | schema 4；2026-11-03T21:34 只读快照 memories 9 / fragments 21 / manifests 23 / audit 201 / rate_limits 2 |
| 迁移前备份 | `var/backups/mars-2026-11-03T13-20-52-532Z.db`，245,760 B，sha256 `4ee89fd25b4c5c9d22735fc62fab78d911240682971688f96786498c3b8d114d` |
| 压力 | 240 编译 + 80 检索（db+wal+shm 一致快照），通用泄漏判据 0 命中，p50 19.18 ms / p95 22.67 ms / max 61.52 ms |
| 长会话 | `ab2cb09e` 会话 6,467,396 B（SHA-256 `f2d4c809…aee17`）→ 682 usage 事件、total 114,188,173 |
| P4 载荷 | base 24,763 B vs mars 7,233 B（−70.8%） |
| P4 真实 usage | base 618,767 vs mars 702,203（+13.5%，n=1，不宣称节省） |
| P4 质量 | 22/24 vs 23/24（规则 rubric） |

## 5. 候选版本指纹与 Git 状态

- 候选清单：`docs/plan/candidate-manifest.json`（每文件 path/size/sha256；排除 `var/**`、`experiments/p4/var/**`、`config/principals.json`、清单自身与 0 字节文件；清单不含自身哈希，最终 SHA-256 由冻结命令在交付消息中给出，避免自指）。
- 文件数：**120**（清单 `file_count`，含两份 R4 审查报告）；总字节：约 **780 KB**（精确值见 `total_bytes`）；manifest SHA-256：见冻结交付消息（清单不含自身，SHA 由外部 `Get-FileHash` 计算）。
- Git：HEAD `07f0a1e`、`status -uall` 192 行 = 121 mars 未跟踪（120 个清单文件 + 清单自身）+ 71 非 mars、暂存 0、无 push。
- 未提交：符合任务书“冻结候选版本，等待用户最终确认”；未执行 `git add`/`commit`/`push`。

## 6. R4 独立审查（终审）

- 报告：`docs/plan/wp5-review.md`（独立 subagent，只读；亲自跑测试、核对清单/指纹、DB 只读、压力复跑、文档一致性、敏感信息）。
- 首轮终审结论：**PARTIAL**（0 blocker/0 high；6 项 must-fix：F-01 清单自指与垃圾文件、F-02 验收占位符、F-03 长会话证据、F-04 压力泄漏判据、F-05 回滚文档/脚本、F-06 文档数值）。
- 处置：F-01…F-06 已修复并提交定向复核；Round-2 结论见 `docs/plan/wp5-review-round2.md`（F-01/F-04/F-05/F-06 PASS、F-02/F-03 PARTIAL）；其残留项 M-1（F-03 路径）、M-2（F-02 引用）、M-3（清单一致性）、M-4（压力数字）已修正并获 Round-3 只读复核 PASS，随后重生成冻结清单。

## 7. 残余风险与 Phase 2.1 建议

1. P4 为单角色、单任务×3、规则 rubric，非盲评；建议后续做 2–3 角色、工具型任务、盲评扩展。
2. 多 Agent 并发写入只有双连接限流用例，没有压力级并发验证。
3. 编排器高风险判定依赖关键词，极端表述会误判；建议维护可配置规则表。
4. `tools/list` 未认证、无 token 自动轮换、限流为“持久 + 进程内”双口径，均已在文档披露。
5. 历史 2 条越权类型 L3 记忆保留（内容可信、创建者标注失真），建议 deprecated 后由 R1 重提。

## 8. 发布建议

- 建议以 **PASS（有条件）** 接受 P2–P6：条件为上述残余风险纳入 Phase 2.1 计划。
- 候选版本可进入纳入版本库流程：获批后按 `candidate-manifest.json` 逐文件 `git add`，提交信息与分支策略由用户确认；push 需另行授权。
- 在用户确认前，冻结不变：不再改 `mars/` 文件、不重建 MCP、不迁移生产库。
