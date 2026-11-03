# MARS 数据库备份与回滚演练（v4，2026-11-03）

本文件对应 MARS P2–P6 冻结候选（schema v4）。演练全部在 `%TEMP%` 副本上进行，生产库 `var/mars.db` 未写入。

## 1. 基线

- 迁移前备份：`var/backups/mars-2026-11-03T13-20-52-532Z.db`
  - 245,760 B；SHA-256 `4ee89fd25b4c5c9d22735fc62fab78d911240682971688f96786498c3b8d114d`
  - 只读检查：`schema_version=2`、`integrity_check=ok`、行数 memories 9 / fragments 20 / manifests 22 / audit 196 / rate_limits 0
- 更早快照：`mars-2026-11-03T13-06-51-559Z.db`（schema v1，229,376 B，SHA-256 `48b9836f…d2`），仅保留，不再作为回滚目标。
- 当前生产库：schema 4，表 memories/fragments/manifests/aliases/audit/meta/projects/shares/orchestrator_runs/rate_limits。

## 2. 迁移步骤（v2 → v4）与验证

1. `node scripts/mars-db-backup.js` 生成一致快照（`VACUUM INTO`）。
2. 启动任一入口（CLI/MCP/脚本）调用 `openDb('var/mars.db')`；`migrate()` 幂等补齐：
   `expires_at`（v3）、`projects`/`shares`（v3）、`orchestrator_runs`（v4）、`rate_limits`（v2）。
3. 验证：`meta.schema_version = 4`、`PRAGMA integrity_check = ok`、原有行数不变、新表存在且为空。

## 3. 恢复/回滚演练（已执行）

1. 复制备份 `mars-2026-11-03T13-20-52-532Z.db` 到 `%TEMP%\rollback\mars.db`。
2. `node -e "require('D:/M1/mars/src/db').openDb('...')"` 打开 → 自动迁移到 schema 4。
3. 校验：`integrity_check=ok`、行数保持 9/20/22/196、新表 0 行、`expires_at` 为 TEXT。
4. `node scripts/mars-db-backup.js --verify <备份文件>` → exit 0，SHA-256 与行数一致。

结论：备份可恢复且迁移幂等；旧快照恢复后会自动升级到当前 schema。

## 4. 生产回滚步骤（仅在需要撤销 P2–P6 时）

1. 关闭 MCP：`powershell -File mars/scripts/mars-mcp-disable.ps1 -Yes`（先备份 `registry.json`）。
2. 再备份当前库：`node mars/scripts/mars-db-backup.js`。
3. 停止所有使用 `mars.db` 的进程，覆盖 `mars/var/mars.db`（同时删除残留 `mars.db-wal`、`mars.db-shm`）。
4. 恢复代码到候选清单对应版本：按 `docs/plan/candidate-manifest.json` 逐文件核对 SHA-256；不一致即停。
5. 运行全量测试 `node --test`（应 80/80），并确认 `meta.schema_version = 4`。
6. 需要时用 `mars/scripts/mars-issue-mcp-identity.js` 重签身份，再重新注册 MCP 服务。

## 5. 运行时清理（非回滚）

`mars/scripts/mars-rollback.ps1` 默认干跑（exit 2，仅列出目标）：

- 删除 `mars/var` 顶层的 `mars.db`、`mars.db-wal`、`mars.db-shm`、`*.json`、`*.csv`（`var/backups/*.db` 不在匹配范围）。
- `-RemoveTokens`：删除 `mars/var/mcp/tokens/*.token`。
- `-RemovePrincipals`：删除 `mars/config/principals.json`。
- `-Yes`：执行删除；全部路径校验必须位于 `D:\M1\mars` 内。

## 6. 演练记录

| 项 | 结果 |
|---|---|
| 备份 SHA 复核 | 与记录一致 `4ee89fd2…d114d` |
| 恢复演练 | schema 4、integrity ok、行数 9/20/22/196 |
| 全量测试 | 80/80 PASS（见 `docs/plan/test-report.md`） |
| 生产库写入 | 无（仅 `%TEMP%` 副本） |
