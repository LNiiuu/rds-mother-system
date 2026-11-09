# M4 维护性审计（B0 基线）

**执行日期**：2026-11-09
**HEAD**：`9c5e4ab`（= `origin/main`，ahead/behind `0/0`）
**开工工作区**：51 项受保护未提交工作，暂存区空
**结论**：无 S1；6 项 S2、7 项 S3、3 项 S4。S2 全部落在 M4 范围内。

---

## 1. 基线实测（不引用历史报告，全部现跑）

| 项 | 实测结果 |
|---|---|
| HEAD / 分支 | `9c5e4ab6…` / `main` |
| origin/main | `9c5e4ab6…`（与本地一致，ahead/behind `0/0`） |
| 工作区 / 暂存区 | 51 项 / 0 项 |
| Tags | `m3-b0`…`m3-b5`，指向 `c342636`/`35c286b`/`1b56fca`/`88599d4`/`6cdadbc`/`9a6b4a8` |
| Required 测试 | `GATE PASS tests=128 pass=128 fail=0 skipped=0` |
| 分层检查 | `LAYERS PASS problems=0 warnings=2`（2 条为永久边界声明：`util` 的 realpath/原子写、`cli` 的 `--out`） |
| 配置检查 | `CONFIG PASS` |
| doctor | `status: ok（fail=0 warn=1）`，warn 为 11 个历史文档含本机路径（M5） |
| 行为基线 | `BASELINE PASS 7 个面均与基线一致（含已登记增项）` |
| 发行包 | `PACK PASS`（必需文件齐全，禁止项 0 命中）+ `SMOKE PASS`（安装→doctor→init→写入→审批→检索→编译） |
| G1 | 上次真实执行在 CI（run 42576621217），本地可用 `tooling/git-review/review.ps1` 复跑 |
| 规模 | `mars/src` 35 文件 / 3,812 行；tracked `.js`+`.mjs` 80 个；测试 25 文件；契约 5 个；`.ps1` 17 个 |

---

## 2. 问题清单

编号规则：`M4-<域><序号>`。域：C=契约、S=脚本、D=数据库、V=版本、O=可观测性、X=文档。
「M4」列标注本轮是否处理。

### 2.1 S1（数据丢失 / 安全 / 核心不可用）

**无。** 未发现会导致数据丢失、越权或核心功能不可用的问题。

### 2.2 S2（结果不可信 / 行为不一致 / 跨环境不可用）

| ID | 文件:行 | 现象 | 触发条件 | 影响 | 修复建议 | 兼容性风险 | 对应测试 | M4 |
|---|---|---|---|---|---|---|---|---|
| M4-C1 | `mars/contracts/ledger.schema.json`（全文件） | **契约无执行点**：`grep` 全仓，只有 `docs/*` 与基线哈希引用它，`mars/src` 零引用；ledger 输出从未被校验 | 任何 ledger 输出 | 契约与实现可静默漂移；评审者以为有约束，实际没有 | 用 `validate.js` + `AssetResolver.contract('ledger')` 在 CLI 出口校验一次 | 若现有输出不合契约，会立刻暴露——需先自测 | 新增 `mars/tests/arch/contracts.test.js` | 是 |
| M4-C2 | `ledger.schema.json:11`、`:22` | `source` / `source_kind` 用 `const: "dsh-session"`，而 `session-registry` 已支持多来源 | 注册第二种数据源 | 新来源的输出必然违反契约；H-05 遗留 | `const` → `pattern`（形状约束），并加"kind 必须在注册表内"的测试 | 放宽只增不减：旧输出仍通过 | 契约测试 + 注册表测试 | 是（B1） |
| M4-D1 | `mars/src/db.js:25-32` | `openDb` 只对 `require('node:sqlite')` 做了兜底，`new DatabaseSync(file)` / `PRAGMA` 失败直接抛原始异常 | 打开损坏或非 SQLite 文件 | 用户看到 Node 栈 + 安装绝对路径，无错误码、无可操作提示；实测 `rds init --db <corrupt>` 输出 `Error: file is not a database` + 4 行栈，exit 1 | 捕获并转成 `AppError('DB_OPEN_FAILED')`，带路径与"可能不是 SQLite 库/已损坏，用 rds doctor 检查"提示 | 错误文本变化（退出码仍非 0） | 故障注入测试 | 是（B3/B5） |
| M4-D2 | `mars/src/db.js:28-29` | 只设 `journal_mode=WAL` 与 `foreign_keys=ON`，**没有 `busy_timeout`** | MCP 长驻进程与 CLI 同时写 | 并发写入立即 `SQLITE_BUSY`，不重试 | 加 `PRAGMA busy_timeout`（毫秒级，非 Schema 变更） | 仅行为更宽容；无数据格式变化 | 并发写测试（隔离临时库） | 是（B3） |
| M4-D3 | `mars/src/db.js:53-57` | 审计写入 `catch {}` 全吞，无计数、无痕迹 | 审计表写入失败（磁盘满、锁冲突、表被改） | 审计链静默断裂而无人知晓，违反"不允许静默吞掉异常" | 保留"审计不阻断调用"语义，但记录失败计数并让 `doctor` 暴露 | 无（新增计数器） | 注入会抛错的 sink，断言调用不抛但计数+1 | 是（B3/B5） |
| M4-S1 | `mars/scripts/seed-phase2.js` | **语法损坏**：`node --check` 失败；文件内中文曾按 GBK 解释，含不可逆 `?`。全仓 80 个 JS 里唯一一个 | 任何执行 | 脚本完全不可用；是仓库里唯一的"活跃损坏文件" | 见 §3 决策：删除 | 删除后无调用方（引用只存在于历史文档） | 新增"脚本可解析"测试 | 是（B2） |

### 2.3 S3（维护成本 / 文档不一致 / 体验）

| ID | 文件:行 | 现象 | 影响 | M4 |
|---|---|---|---|---|
| M4-O1 | `mars/src/cli.js`（无顶层 catch） | 未捕获异常直接打印 Node 栈；只有显式 `die()` 的路径有干净错误 | 任何意外错误都变成栈回溯，用户无法据此行动 | 是（B5） |
| M4-O2 | `mars/src/cli.js:108-144` | `ledger` 子命令未支持 `--help`；实测 `rds ledger --help` 报 `ERROR ledger 需要 --session <文件>` | 子命令帮助缺失，`--source` 等参数无文档 | 是（B5，最小改动） |
| M4-V1 | `VERSION` / `package.json` / `mars/src/mcp-stdio.js:23` | 三处版本口径未定义：产品版本 `0.1.0`、MCP `serverInfo.version` `0.2.0`、`ledger.schema.json:9` 的 `version` 是**输出格式版本**（也 `0.1.0`） | 无法判断谁是真相；升级时容易只改一处 | 是（B4：先定策略再改） |
| M4-V2 | `package.json` `engines.node` | 声明 `>=22.5.0`，但 `dsh-session-source.js:81` 明确要求 `zlib.zstdDecompressSync`（无则抛 `ZSTD_UNSUPPORTED`） | `ledger` 是文档化功能，在 22.5–22.14 上会运行期失败，与 engines 承诺不符 | 是（B4：核实后调整声明） |
| M4-X1 | `docs/install.md:309` | 写"当前源码树为 88 项全通过"，实际 128 项 | 文档失真，读者据此判断质量门禁 | 是（B6） |
| M4-X2 | `README.md` 能力表 | CI 链接指向 M2.1 的 run `42479193137` @ `afd423a`，不是最新验证过的 run | 同上 | 是（B6） |
| M4-X3 | `docs/install.md:273` | 把 `serverInfo.version` 不一致记为"属 M5"，而 M4 就要定版本策略 | 批次归属错误 | 是（B4/B6） |

### 2.4 S4（纯优化 / 未来扩展，只记录）

| ID | 内容 | 为什么不现在做 |
|---|---|---|
| M4-S4-1 | `mars/scripts/` 里 6 个一次性开发脚本（`phase2-g1-verify`、`phase3-sharing-smoke`、`phase4-build`、`phase4-score`、`phase4-usage`、`wp5-stress`）无单测 | 它们是流程产物，不是产品能力；补测试收益低于成本 |
| M4-D4-1 | 无 `rds backup` / `rds restore` 子命令（只有 `mars/scripts/mars-db-backup.js`） | 属能力扩展，不属维护性 |
| M4-D4-2 | macOS 未验证 | 无设备；CI 矩阵未含 |
| M4-D4-3 | `render-role` 等投递命令未实现 | 路线图明确后置 |

### 2.5 已解决、不重复列入

M3 记录的以下问题已验证修复，本轮不再重复：错误码双白名单漂移、配置四处解析、`ledger.read` 空动作、审计主体伪装成 `'cli'`、`rds ledger` 顺手建库、注册表整文件覆盖、模块加载期读盘。

### 2.6 复核命令（每条问题都能重跑）

```bash
# M4-C1：契约无执行点
grep -rn "ledger.schema" mars/src/ ; echo "exit=$?（1=零引用）"

# M4-C2：契约锁死单一数据源
grep -n '"const": "dsh-session"' mars/contracts/ledger.schema.json

# M4-D1：损坏库的原始栈
printf 'not sqlite' > /tmp/bad.db && node bin/rds.mjs init --db /tmp/bad.db; echo "exit=$?"

# M4-D2：无 busy_timeout
grep -n 'PRAGMA' mars/src/db.js

# M4-D3：审计吞异常
sed -n '53,58p' mars/src/db.js

# M4-S1：唯一语法损坏的脚本
for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f" >/dev/null 2>&1 || echo "FAIL $f"; done

# M4-V1/V2：版本与 engines
cat VERSION; node -p "require('./package.json').version + ' | ' + require('./package.json').engines.node"
grep -n 'SERVER_VERSION =' mars/src/mcp-stdio.js

# M4-X1：过期数字
grep -n '88 项' docs/install.md
```

---

## 3. `seed-phase2.js` 处理决策

**结论：删除（方案 B）。**

依据：

1. **无调用方**：全仓 grep 只有 `mars/docs/*` 的历史审查记录提及，`package.json`、CI、测试、其他脚本均不调用。
2. **无文档依赖**：`docs/install.md` 的快速开始不依赖它；`docs/testing.md` 的测试流程也不依赖。
3. **职责可替代**：它做的是"往默认库 `mars/var/mars.db` 灌 7 条 Phase-2 演示记忆（按内容哈希幂等）"。同样的效果用已文档化的 `rds init-dev` → `rds put` → `rds review` 三步即可复现，且不依赖 `rds-m1` 这个历史项目名。
4. **不可修复**：损坏来自"UTF-8 字节被按 GBK 解码后再存"，其中已出现 `?`（替换字符），原始字节不可逆；任何"编码回滚"都是伪造。
5. **风险**：它直写默认库，误跑会污染开发库。

配套动作（同批完成）：

- 删除文件；
- 在 `CHANGELOG.md` 记录删除与替代路径；
- 新增 `mars/tests/arch/scripts.test.js`：对 `mars/scripts/**`、`bin/**`、`tooling/**` 下所有 tracked `.js`/`.mjs` 做解析检查，防止再出现"入库即坏"的脚本；
- 不修改 `mars/docs/*` 的历史审查记录（那些是带日期的证据，属 M5 边界）。

---

## 4. M4 与 M5 的边界

| 事项 | 归属 | 理由 |
|---|---|---|
| `docs/analysis/` 历史材料 | M5 | 历史证据，不是当前维护对象 |
| `docs/history/` 归档 | M5 | 同上 |
| `mars/docs/` 里的历史项目名与 17 处命中 | M5 | 改写历史记录等于篡改证据 |
| 11 个历史文档中的本机绝对路径（doctor warn） | M5 | 同上 |
| 旧评审文档里过期的契约描述（如 `mars/docs/architecture.md:435`） | M5 | 有日期，属当时事实 |
| 当前文档的过期数字与失效链接（M4-X1/X2） | **M4** | 它们描述"现在"，错了就是错的 |
| 版本策略、engines 声明 | **M4** | 影响今天的安装与升级判断 |

---

## 5. 批次映射

| 批次 | 处理的问题 |
|---|---|
| B0（本文件） | 基线 + 清单，不改代码 |
| B1 契约与 Schema | M4-C1、M4-C2 |
| B2 脚本治理 | M4-S1 |
| B3 数据库维护 | M4-D1、M4-D2、M4-D3 |
| B4 配置与版本 | M4-V1、M4-V2 |
| B5 可观测性 | M4-O1、M4-O2（并与 B3 的 D1/D3 联动补故障注入测试） |
| B6 文档与验收 | M4-X1、M4-X2、M4-X3 |

---

## 6. 非目标（本轮明确不做）

- 不改任何 SQL、DDL、`SCHEMA_VERSION`；
- 不做数据迁移、不清历史行；
- 不新增端口、不改五端口边界；
- 不引入日志框架（用现有 `console` + 错误码）；
- 不引入第三方依赖（当前 `dependencies` 为空）；
- 不增加 CLI 子命令，不改既有参数语义与 JSON 形状；
- 不重写 `mars/docs/*` 历史记录；
- 不实现 `render-role`、备份子命令等新能力。

---

## 7. 本批不做的事

B0 只产出本文件，**不改任何代码**。下一批（B1）在本批提交之上开始。
