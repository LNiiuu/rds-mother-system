# M4-B3 数据库与存储维护报告

**批次**：m4-b3
**基线**：`0614385`（m4-b2）
**结论**：3 个数据库缺陷修复；1 个"更新版库被静默降级"的隐患关闭；备份/恢复链路在隔离环境验证通过。
**未改**：任何 SQL、DDL、`SCHEMA_VERSION`、数据迁移。

---

## 1. 核查发现的四个问题

| ID | 现象 | 触发 | 影响 |
|---|---|---|---|
| M4-D1 | 打开损坏库抛 `ERR_SQLITE_ERROR` 原始异常 | 文件不是 SQLite | CLI 打印 Node 栈 + 安装绝对路径，无错误码、无下一步 |
| D-new | **更新的库被静默降级** | 用旧版 rds 打开 `schema_version=9` 的库 | `initSchema` 无条件把版本号写回 4，等于把一个更新的库标注成旧结构 |
| M4-D2 | 没有 `busy_timeout` | MCP 常驻 + CLI 同时写 | 立即 `SQLITE_BUSY`，随机失败 |
| M4-D3 | 审计写入 `catch {}` 全吞 | 磁盘满 / 锁冲突 / 表被改 | 审计链静默断裂，无人知晓 |

D-new 不在 B0 清单里，是本批做迁移验证时实测发现的。证据（修复前）：

```
$ openDb('future.db')            # 库内 schema_version = 9
（打开成功）
$ 库内 schema_version 现为 4      ← 被写回旧值
```

---

## 2. 改动

| 文件 | 改动 |
|---|---|
| `mars/src/db.js` | `openDb` 增加：`busy_timeout=5000`；打开/PRAGMA/initSchema 三段 try-catch 统一翻译为 `DB_OPEN_FAILED`（区分"不是数据库/损坏"与"打不开/权限"）；打开后先读 `schema_version`，高于代码支持版本则抛 `DB_SCHEMA_NEWER` 并**不写入任何东西** |
| `mars/src/db.js` | 审计失败：保留"不阻断调用"不变量，但增加 `__auditFailures` 计数 + 每连接一次 stderr 提示（MCP 的 JSON-RPC 走 stdout，stderr 安全）；新增 `auditStats(db)` |
| `mars/src/errors.js` | 新增 `DB_OPEN_FAILED`、`DB_SCHEMA_NEWER` 两个公开码 |
| `bin/doctor.mjs` | 数据库检查从"看文件是否存在"改为**只读打开**：读 `schema_version` 与 `PRAGMA quick_check`，按"版本过高=FAIL / 版本偏低=WARN / 损坏=FAIL"分级，并给出恢复命令 |
| `bin/doctor.mjs` | 去掉顶层 `require('composition')`。它会把 `node:sqlite` 一起拉进来 —— 于是"诊断工具"在 `node:sqlite` 不可用的机器上会先崩，正是它要诊断的场景 |
| `mars/scripts/mars-db-backup.js` | 未知参数报错（此前 `--out X` 被静默忽略，备份落进默认 `var/backups`） |
| `docs/architecture/m3/baseline/approved-additions.json` | 登记两个新增错误码 |

### 为什么"版本过高"必须拒绝而不是继续

`initSchema` 的语义是"确保当前版本的结构存在"。它不认识的表/列可能属于更高版本，
继续执行会让旧代码按旧结构解释新数据；更糟的是结尾那句
`INSERT OR REPLACE INTO meta (schema_version, 4)` 会把版本标记抹掉 ——
之后连"这个库需要新版"这个唯一线索都没了。

拒绝的代价是用户必须升级；不拒绝的代价是静默的数据结构错配。选前者。

---

## 3. 验证

### 3.1 三个故障场景（故障注入，隔离临时库）

| 场景 | 构造 | 结果 |
|---|---|---|
| 损坏库 | 写入 `this is not a sqlite database` | `db.fail 无法打开 …：file is not a database。不是有效的 SQLite 数据库或已损坏；从备份恢复（node mars/scripts/mars-db-backup.js）` → `status: fail` |
| 更新库（v9） | 复制基准库后 `UPDATE meta SET value='9'` | `db.fail 结构版本 9 高于当前代码支持的 4…请升级 rds` → `status: fail`；`openDb` 抛 `DB_SCHEMA_NEWER`，**库内版本仍为 9** |
| 旧库（v3，缺 `expires_at`） | 复制基准库后 `DROP COLUMN expires_at` + 版本改 3 | `db.warn 结构版本 3 < 4…建议先备份`；`openDb` 打开后 `expires_at` 已补、版本升到 4 |

### 3.2 备份 / 恢复（隔离目录）

```
$ node mars/scripts/mars-db-backup.js --db <tmp>/live.db --out-dir <tmp>/backups
{ "file": "...mars-2026-11-09T07-46-22-939Z.db", "bytes": 151552,
  "integrity": "ok", "counts": {...} }

$ 把快照作为新库打开
还原库 integrity: ok
schema_version: 4
memories 表可查: 0
```

`VACUUM INTO` 快照 + `integrity_check` + 回读，三段都过。

### 3.3 新增测试 `mars/tests/arch/db-lifecycle.test.js`（9 例）

损坏库的错误码与提示 / 更新库被拒绝且字节不变 / 旧库迁移补列 / 重复打开幂等 /
`busy_timeout>0` / 审计失败计数且不阻断 / 无失败时计数为 0 / 备份快照 integrity=ok 且可回读 /
备份脚本拒绝未知参数。

---

## 4. 一次真实误操作（如实记录）

核查备份脚本时我传了 `--out`（正确参数是 `--out-dir`）。由于脚本当时**静默忽略未知参数**，
备份写进了默认的 `mars/var/backups`。我随后为"清理自己产生的文件"执行了
`rm -rf mars/var/backups` —— 该目录里还有 4 个 2026-11-03 的历史文件（3 个 .db + 1 个 principals 快照）。

处理：立即从 `D:\M1-backup-20261108-162614\mars\var\backups` 逐文件 `cp -a` 恢复
（mtime 保持 11-03），并逐个 `PRAGMA integrity_check` → 全部 `ok`。
`mars/var` 被 gitignore，未影响任何提交内容。

根因已修：备份脚本现在拒绝未知参数（`ERROR 未知参数 --out …`，exit 2）。
教训写进本报告而不是藏起来：**删除前必须确认目录里是否只有自己刚生成的文件**。

---

## 5. 验收对照（任务书 §7.4）

| 要求 | 结果 |
|---|---|
| 数据库初始化可重复 | 是。连续打开同一库 3 次，版本稳定，无报错（测试覆盖） |
| 只读操作不会意外创建数据库 | 是（M3 已修，本批回归仍通过） |
| 写入失败不会留下半成品 | 审计失败不写半行（sink 抛错即放弃该条），计数可查 |
| 事务失败有明确回滚行为 | 未新增事务；现有写入均为单语句或 `INSERT OR REPLACE`。**未验证多语句事务**——见遗留 |
| 备份和恢复可在隔离环境验证 | 是（§3.2） |
| 原有 DDL 和数据兼容性有证据 | 是。`SCHEMA_VERSION` 仍为 4；`db/schema.js` 未改一行；旧库迁移只 `ADD COLUMN` |

---

## 6. 遗留

| 项 | 说明 |
|---|---|
| CLI 顶层仍会打印 Node 栈 | 本批错误文本已可操作，但未捕获的 `AppError` 仍以栈形式输出。去栈化属 M4-O1，在 B5 处理 |
| 多语句事务未覆盖 | 现有代码没有显式 `BEGIN/COMMIT`；如将来引入，需要事务边界测试 |
| `db/ratelimit.js` 的窗口语义未测并发 | 属既有实现，本轮不改 |
| 备份保留策略 | 脚本只做单次快照，不清理旧快照（避免误删）；轮转策略属 S4 |
