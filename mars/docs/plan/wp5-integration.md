# WP-5 集成、压力与回滚演练（P2–P6 收尾证据）

日期：2026-11-03
范围：`D:\M1\mars`（生产库 `var/mars.db`、5 个 MCP 服务、schema v4）
Git：HEAD `07f0a1e03cc9425c5ab4092f15e6778264b7b523`（main），未 commit/push，暂存 0。

## 1. 集成状态

| 项 | 结果 | 证据 |
|---|---|---|
| 全量测试 | **80/80 PASS**，EXIT=0（duration ≈2,070 ms） | `ledger 8 + mcp 6 + phase1 42 + phase2 6 + phase3 5 + phase4 7 + wp1 6`，含新增网关 fail-closed 与跨连接限流用例 |
| 生产库 | schema v4；2026-11-03T21:34 只读快照：memories 9 / fragments 21 / manifests 23 / audit 201 / rate_limits 2（13:21–13:22 两次合法调用所致，非损坏） | 迁移前快照见 §3 |
| MCP 服务 | `mars-r0`…`mars-r4` 全部按 v4 引擎重建（`MARS_BUILD=wp5-v4` 触发重连） | 注册返回 5 tools；抽验见 §2 |
| 网关 fail-closed | routing 缺失/损坏在启动时 `ROUTING_UNAVAILABLE` 退出，且不泄漏 DB 句柄 | `tests/phase2/mcp-stdio.test.js` 新增用例；`src/mcp-stdio.js` 先加载 routing 再开库 |
| 候选冻结清单 | **120 文件**；总字节约 **780 KB**（精确值见清单 `total_bytes`）；清单不含自身哈希，最终 SHA-256 见冻结交付消息 | `docs/plan/candidate-manifest.json`（排除 `var/**`、`experiments/p4/var/**`、`config/principals.json`、清单自身与 0 字节文件） |

候选清单 SHA-256：见冻结交付消息（清单不含自身哈希，由外部 `Get-FileHash` 计算）。

## 2. 重启后真实调用抽验

| 角色 | 调用 | 结果 |
|---|---|---|
| R3 | `context_compile {project_id:'rds-m1', budget:600, task:{task_id:'WP5-R3-RESTART-001'}}` | `pkt_4554676788d5` / `man_ebb8876ea5fd`，406 tokens；decisions 含已批准决策；role 限定 `mem_90fc3b64dacf` 仅 R3 可见；evidence missing blocking=true |
| R4 | `memory_stats {project_id:'rds-m1'}` | 9 memories / 8 approved / 1 proposed / 0 rejected/deprecated/superseded/expired，`scope=visible_to_caller` |

## 3. 备份、迁移与回滚演练

- 迁移前快照：`var/backups/mars-2026-11-03T13-20-52-532Z.db`，245,760 B，
  SHA-256 `4ee89fd25b4c5c9d22735fc62fab78d911240682971688f96786498c3b8d114d`，
  `integrity=ok`，行数 9/20/22/0/196。
- 生产库迁移：`openDb('var/mars.db')` 自动升 v4（`SCHEMA_VERSION=4`、`meta.schema_version=4`），
  新增 `expires_at`、`projects`、`shares`、`orchestrator_runs`、`rate_limits`；原有行数不变。
- 回滚演练（临时路径，不碰生产库）：复制 v2 快照 → `openDb` 自动迁移 → `schema_version=4`、
  `integrity=ok`、行数保持 9/20/22/196，新增表为空。说明“恢复旧快照 + 重启即回到可用 v4”的路径成立。

回滚步骤（完整版见 `docs/plan/rollback-drill.md`）：

1. 关闭 MCP：`scripts/mars-mcp-disable.ps1 -Yes`（先备份 registry）。
2. 备份当前库：`node scripts/mars-db-backup.js`。
3. 覆盖库文件并删除 `-wal`/`-shm` 残留。
4. 恢复代码到候选清单对应版本（逐文件 SHA-256 校验，`docs/plan/candidate-manifest.json`）。
5. 全量测试 80/80 + `meta.schema_version=4` 校验后，再重建 MCP 服务。

## 4. 压力与长会话

- 压力（`scripts/wp5-stress.js`，复制 db + `-wal`/`-shm` 的一致快照，240 次编译 + 80 次检索，5 角色轮转）：
  复跑 `{"ok":true,"iterations":240,"leaks":0}`；延迟 p50 **19.18 ms** / p95 **22.67 ms** / max 61.52 ms（跑间波动见 R4 A-01）；
  packet tokens：R0 353–354、R1 345–346、R2 189–190、R3 393–394、R4 341–342。
  泄漏判据已改为通用断言：对每个角色，任何非 `approved` 或 role-scope 不含该角色的记忆 ID 都不得出现在 packet 中
  （`forbidden_checked` R0 2 / R1 2 / R2 2 / R3 1 / R4 2），240 次 0 命中。
- 长会话（可复现）：`C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef\session.v4.jsonl.zstd`
  在 2026-11-03T21:37 时点：6,467,396 B、SHA-256 `f2d4c809a8d620fc151631e11381394276a9e30643267da2c3df4fa74c6aee17`；
  `ledger.parseSession` → session `ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef`、682 个 usage 事件、total 114,188,173，无截断错误。
  注意会话文件随会话运行增长，复核请以文件 SHA-256 对齐（历史值 6,382,820 B / 586 事件为更早时点，已废弃）。

## 5. 残余与限制

- 编排器为规则引擎，`high` 判定依赖关键词；`suggest` 仅离线建议。
- 共享（P5）为项目间显式审批共享，不做全局聚合检索；`private` 仍默认拒绝。
- SQLite 单文件、无分布式配额；MCP 限流为“进程内分钟窗 + 持久窗口表”组合。
- `config/principals.json` 与 `var/**` 不进入候选清单（凭据/运行产物），需单独备份。
