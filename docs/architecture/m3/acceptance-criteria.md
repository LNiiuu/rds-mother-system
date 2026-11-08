# M3 验收标准（可机械判定）

**原则**：每条都是"跑一条命令，看退出码或计数"，不写"应当合理""符合预期"这类无法判定的表述。
**图例**：✅ = 现已存在可跑；🆕 = 由 B0 交付；⛔ = 不得作为通过依据。

---

## 0. 全局门（每批都必须全过）

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| G1 | Required 测试全绿且无跳过 | `node tooling/test-gate.mjs` | 输出 `GATE PASS`，且 `fail=0 skipped=0 tests>0`；`tests` 不得低于 **88** |
| G2 | 环境自检无 fail | `node bin/rds.mjs doctor` | 退出码 `0`；输出中无 `fail`；`paths:code` 为 `ok` |
| G3 | 配置合法 | `node tooling/config-check.mjs` | 退出码 `0` |
| G4 | 发行包端到端 | `bash tooling/ci-smoke.sh` | 退出码 `0`；末行 `SMOKE OK` |
| G5 | 门禁自身没被改坏 | `node tooling/test-gate-selfcheck.mjs` | 4/4 反向用例通过（全绿→0、失败→1、跳过→1、空集→1） |
| G6 | 原有 51 项工作未动 | `git status --porcelain -uall \| wc -l` | 恒为 **51**（本阶段结束时应仍为 51） |
| G7 | 无新增第三方依赖 | `npm pkg get dependencies devDependencies` | 两者均为空（`{}` 或 undefined） |
| G8 | 无网络调用 | `grep -rn "fetch(\|http\.request\|https\.request\|net\.connect" mars/src` | 0 行 |

> G1 的 88 是**下限**。允许因新增测试而上升，不允许下降。

⛔ **不得作为通过依据**：`node --test` 的原始输出（可能全 skip 仍返回 0）、CI 里 `conclusion=success` 但 job 被条件跳过、本地通过代替 CI。

---

## B0 观测与门禁

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B0-1 | 错误模型落地 | `node -e "const e=require('./mars/src/errors');console.log(typeof e.toPublicCode, e.PUBLIC_CODES.size)"` | 输出两个值，`PUBLIC_CODES.size >= 20` |
| B0-2 | 两处白名单已消除 | `grep -c "message.match(/\^(" mars/src/mcp.js mars/src/mcp-stdio.js` | 两个文件均为 **0** |
| B0-3 | 旧网关不再退化 6 个码 | 单测：对 `EXPIRES_AT_INVALID / INVALID_TRANSITION / RATE_LIMITED / ROLE_TYPE_DENIED / ROUTING_UNAVAILABLE / STATE_UNCHANGED` 各构造一次错误，`mcp.js` 的响应码等于原码 | 6/6 相等 |
| B0-4 | 分层检查可运行 | `node tooling/layering-check.mjs` 🆕 | 退出码 `0`（B0 为 warn 模式，允许输出警告但不得 error） |
| B0-5 | 基线已冻结 | `ls docs/architecture/m3/baseline/` | 含 7 个文件：`cli-help.txt`、`cli-json-keys.json`、`mcp-tools.json`、`error-codes.json`、`pack-files.txt`、`contracts-sha256.json`、`exit-codes.json` |
| B0-6 | 发行包断言已扩展 | `node tooling/pack-check.mjs` | 退出码 `0`，且断言列表含 `mars/contracts/` |
| B0-7 | 基线可复采 | 重跑采集脚本 → 与 `baseline/` diff | diff 为空（时间戳类字段已归一化） |

**B0 特有前提**：`G1`–`G8` 全过，且 `tests` 仍为 88（B0 只允许新增错误模型单测，故应 ≥88）。

---

## B1 资产定位

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B1-1 | 域内已无模块级契约读取 | `grep -rn "^const [A-Z_]* = JSON.parse(fs.readFileSync" mars/src` | 0 行 |
| B1-2 | 域内无模块级 ROOT | `grep -rn "^const ROOT" mars/src` | 仅允许出现在 `composition.js`（0 或 1 处） |
| B1-3 | 缺资产有明确错误码 | 单测：`MemoryAssetResolver({})` 调 `contract('memory')` | 抛出的错误 `code === 'ASSET_MISSING'`，不是 ENOENT |
| B1-4 | 端到端不受影响 | `bash tooling/ci-smoke.sh` | 退出码 `0` |
| B1-5 | 发行包含 ports/adapters | `node tooling/pack-check.mjs` | 断言含 `mars/src/ports/`、`mars/src/adapters/` |
| B1-6 | 分层检查转 fail 且通过 | `node tooling/layering-check.mjs` | 退出码 `0`，且报告中 `mode=fail` |
| B1-7 | 契约内容未变 | `sha256sum mars/contracts/*.json` | 与 `baseline/contracts-sha256.json` **完全一致** |

---

## B2 配置与身份

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B2-1 | 路径解析只有一处实现 | `grep -rn "MARS_DB\|MARS_PRINCIPALS\|MARS_ROUTING" mars/src bin` | 命中仅出现在 `composition.js` 与两个 identity 适配器；`cli.js`/`mcp-stdio.js`/`store.js`/`doctor.mjs` 为 0 |
| B2-2 | 域内无 env 读取 | `grep -rn "process\.env\." mars/src`（排除 adapters/、composition.js） | 0 行 |
| B2-3 | 身份语义不变 | 4 个场景脚本：① `--token` ② `MARS_TOKEN` ③ `MARS_TOKEN_FILE`+`MARS_ROLE` ④ 全无 | ①②③ 认证成功，④ 返回 `AUTH_DENIED` |
| B2-4 | 优先级不变 | `--db A` 与 `MARS_DB=B` 同时给 | 写入 `A`（参数优先），且 `doctor` 报的也是 `A` |
| B2-5 | MCP 工具面未变 | `tools/list` 响应与 `baseline/mcp-tools.json` 规范化比对 | 逐字节一致 |
| B2-6 | 配置快照行为已记录 | `grep -n "快照" CHANGELOG.md` | 有该条目（唯一允许的对外行为变化） |

---

## B3 数据源与契约

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B3-1 | ledger 不再开库 | 在**空目录**执行 `rds ledger --session <fixture> --out out/`，随后 `ls *.db` | 无 `.db` 文件产生；命令退出码 `0` |
| B3-2 | 错误顺序正确 | 对不存在的会话文件执行 `rds ledger` | 退出码 `2`，报"会话文件不存在"，且**未**创建数据库 |
| B3-3 | 契约已放宽 | `grep -n '"const": "dsh-session"' mars/contracts/ledger.schema.json` | 0 命中；改为 `pattern` |
| B3-4 | 旧账本仍可校验 | 用 `baseline` 里的旧 ledger.json 跑 schema 校验 | 通过 |
| B3-5 | 拼错 kind 被拦截 | 单测：`source_kind='dsh-v5'` 的会话 | 抛 `SOURCE_UNSUPPORTED`，且错误信息列出已注册 kind |
| B3-6 | 账本输出不变 | 同一 fixture 生成的 `ledger.json` / `ledger.csv` 与基线比对 | 除 `generated_at`、`path` 前缀外逐字段相等；CSV 表头与列序完全一致 |
| B3-7 | 未授权动作已消除 | `grep -rn "ledger.read" mars/src` | 0 命中（或：存在但 `authorize` 真的被调用，二选一，需在 CHANGELOG 写明选了哪个） |
| B3-8 | 审计 principal 不再伪装 | `grep -n "principal_id: 'cli'" mars/src/cli.js` | 0 命中 |

---

## B4 宿主注册表

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B4-1 | 默认 dry-run | 对含 `mars-*` 条目的夹具执行无 `--yes` | 退出码 `0`，打印将移除数量，**文件字节未变**（`sha256` 前后相同） |
| B4-2 | 写入是原子的 | 正常移除后检查同目录 | 无 `*.tmp*` 残留；`registry.json` 可被 `JSON.parse` |
| B4-3 | 有备份 | 移除后 | 备份文件存在，且其 `sha256` 等于原文件 |
| B4-4 | 未知格式拒绝写 | 在顶层加入未知键 `{"foo": 1}` 后执行 `--yes` | 退出码非 0，`code=HOST_WRITE_REFUSED`，原文件未变 |
| B4-5 | 无宿主不崩 | 指向不存在路径 | `code=HOST_REGISTRY_NOT_FOUND`，退出码非 0，无栈输出 |
| B4-6 | PS 与 Node 行为一致 | 同一夹具分别跑 `mars-mcp-disable.ps1` 与 `mars-mcp-disable.js` | 移除条目集合相同、备份文件数相同 |
| B4-7 | 不碰客户端配置 | `git status` + 对 `~/.workbuddy` / 客户端 `mcp.json` 的只读核对 | 无任何写入 |

---

## B5 结构切分

| # | 判据 | 命令 | 通过标准 |
|---|---|---|---|
| B5-1 | 转发壳可用 | `node -e "const d=require('./mars/src/db');console.log(Object.keys(d).sort().join(','))"` | 导出集合与 B0 基线**完全相同** |
| B5-2 | SQL 未变 | 抽取所有 `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE` 语句做文本比对 | 与基线逐字节一致 |
| B5-3 | schema 版本未变 | `node -e "...SCHEMA_VERSION"` | `4` |
| B5-4 | 脚本不再用外部运行时 | `grep -rn "DSH.exe\|ELECTRON_RUN_AS_NODE" mars/scripts` | 0 命中 |
| B5-5 | 会话目录不再猜默认值 | `grep -n "homedir(), '.dsh'" mars/scripts/phase4-usage.js` | 0 命中；无 `RDS_SESSIONS_ROOT` 时报明确错误 |
| B5-6 | 发行包含 db/ | `node tooling/pack-check.mjs` | 断言含 `mars/src/db/` |
| B5-7 | 端到端仍通 | `bash tooling/ci-smoke.sh` | 退出码 `0` |

---

## 跨批的"不得"清单

以下行为一旦出现，即判该批不通过（不论测试是否绿）：

| 禁止 | 检测方式 |
|---|---|
| 删测试 / 删断言 / 放宽断言 | `git diff` 中出现 `assert.` 删除或 `-` 行含 `test(` |
| 把必需测试改成 skip | `grep -rn "t\.skip\|test\.skip" mars/tests` 增加 |
| 用 `continue-on-error` 掩盖 CI 失败 | `grep -n "continue-on-error" .github/workflows/ci.yml` |
| 接口变更夹带在普通批次 | G1 授权未覆盖 `mars/contracts/**` 或 `mars/src/ports/**` 而 diff 触及它们 |
| 为过门禁而降低 Node 版本要求 | `package.json` 的 `engines.node` 变更 |
| 引入第三方运行时依赖 | G7 |
| 提交原有 51 项工作 | `git diff --cached --name-only` 与其交集非空 |
| 用"本地通过"替代 CI 结论 | 最终报告须分别标注本地 / CI |

---

## 进入 M3-2 的前置条件

M3-1 只是设计阶段。开始 B0 之前必须满足：

1. 本文与另外五份文档经用户审阅，**接口清单与批次顺序获得批准**；
2. "拒绝的抽象"清单（`host-adapter-design.md` §6）未被要求扩充 —— 若要求扩充，需重新评估；
3. `docs/architecture/m3/` 已提交（本阶段唯一允许的提交内容）；
4. 用户明确指定是否在每批后推送远程触发 CI（M3-1 自身不 push）。
