# MARS P2–P6 完整测试报告

日期：2026-11-03
范围：`D:\M1\mars`（schema v4）
运行方式：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
$exe='C:\Users\liuch\AppData\Local\Programs\DSH\DSH.exe'
cd D:\M1\mars
& $exe --test (Get-ChildItem -Recurse -Filter *.test.js -Path tests | % FullName)
```

结果：**80 / 80 PASS，EXIT=0**（约 2.1 s；失败 0）。

## 1. 单元与集成（node --test）

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `tests/ledger/ledger.test.js` | 8 | usage 解析、多帧 zstd、CSV、reconcile、空/损坏会话 |
| `tests/mcp/mcp.test.js` | 6 | 旧离线 MCP 网关：token/项目/角色、propose 只写 proposed、越权拒绝 |
| `tests/phase1/authz.test.js` | 5 | 身份、项目、角色、未认证、跨项目 |
| `tests/phase1/lifecycle.test.js` | 5 | proposed→approved/rejected、自审、非法迁移、同态 |
| `tests/phase1/retrieval.test.js` | 6 | 结构化/ID/FTS/CJK LIKE/别名/状态与可见性过滤 |
| `tests/phase1/budget.test.js` | 3 | 预算裁剪、保护段、估算标注 |
| `tests/phase1/manifest.test.js` | 5 | 去重、跨项目不撞、fragment 恢复权限、source_version |
| `tests/phase1/ledger-reconcile.test.js` | 4 | 解析与对账、总账口径 |
| `tests/phase1/mcp-server.test.js` | 4 | 旧网关默认禁用与错误码 |
| `tests/phase1/rollback-offline.test.js` | 4 | 回滚脚本干跑/临时库、离线守卫 |
| `tests/phase1/remediation.test.js` | 6 | role_scope 隔离、task 映射、review 迁移、manifest status、validate 关键字 |
| （phase1 合计） | 42 | |
| `tests/phase2/mcp-stdio.test.js` | 6 | 参数校验、越权类型、review 迁移、跨项目、stats 可见性、网关 fail-closed |
| `tests/phase3/sharing.test.js` | 5 | 默认隔离、显式共享、自批拒绝、撤销、过期/类型范围 |
| `tests/phase4/orchestrator.test.js` | 7 | 分类、最小集合、风险门、审批、未知项目、超预算、离线建议 |
| `tests/phase2/wp1.test.js` | 6 | routing fail-closed、stats 可见计数、过期、持久限流（含跨连接窗口）、迁移幂等、revoke |

## 2. 安全（G1 独立测试报告）

`docs/phase2-g1-security-report.md`：未知/缺失/角色不匹配/伪造 role/跨项目均拒绝；`role_scope` 隔离；
proposed 仅创建者与审批者可见；自审拒绝；参数与大小限制；审计可追溯；网关 fail-closed；
token 吊销与持久限流已补测。

## 3. 真实 MCP 调用（E2E）

| 场景 | 证据 |
|---|---|
| R0 首次真实调用 | `pkt_8289b7fe4b92`（修复前，暴露 task 映射与 role_scope 两个问题） |
| R0 修复后 | `pkt_ebb345b28cdc`（333 tokens，task_id 正确、R3 限定记忆不外泄） |
| R1/R2/R3/R4 | `pkt_c717f0768966`(359) / `pkt_d689daff8de2`(201) / `pkt_d924afb386c6`(431) / `pkt_eb8a60e3735a`(358) |
| G3 工作流 | R2 经 MCP propose `mem_0db463660da4` → R0 经 CLI 审批 approved → R3 复编译 packet 可见该决策 |
| 重启抽验 | `pkt_4554676788d5`（406 tokens，v4 引擎 + R3 role 限定可见） |
| R4 stats | 9 memories / 8 approved / 1 proposed；`scope=visible_to_caller` |

## 4. 压力与长会话

- 压力：`scripts/wp5-stress.js`（240 次编译 + 80 次检索，5 角色；已复制 `-wal`/`-shm`）→ `leaks=0`，`forbidden_checked` R0 2 / R1 2 / R2 2 / R3 1 / R4 2，p50 19.21 ms / p95 22.62 ms / max 27.32 ms；
  packet tokens 稳定（R0 353–354、R1 345–346、R2 189–190、R3 393–394、R4 341–342）。旧版脚本（未复制 wal/shm）的 p50 20.76 / p95 25.83 / max 49.4 ms 历史值已废弃。
- 长会话（可复现）：`C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef\session.v4.jsonl.zstd`，
  2026-11-03T21:37 时点 6,467,396 B、SHA-256 `f2d4c809…aee17`，解析得 682 个 usage 事件、total 114,188,173（会话文件会随运行增长，按 SHA 复核）。

## 5. 回滚与迁移

- v2→v4 迁移：备份 `var/backups/mars-2026-11-03T13-20-52-532Z.db`（245,760 B，sha256 `4ee89fd2…d114d`，integrity ok，行数 9/20/22/0/196）。
- 恢复演练：复制快照 → `openDb` 自动 v4 → `integrity=ok`、行数保持 9/20/22/196，新表为空。
- 回滚步骤见 `docs/plan/rollback-drill.md`；集成与压力证据见 `docs/plan/wp5-integration.md`。

## 6. 未覆盖与限制

- 多 Agent 并发写入压测未做压力级验证（仅顺序/双连接限流用例）。
- P4 为单角色、单任务重复 3 次，非盲评；质量评分为规则 rubric。
- 编排器 `high` 判定依赖关键词，极端表述可能误判为 medium。
- 真实 provider 账单/配额无法读取（只有本地估算与 DSH usage）。
