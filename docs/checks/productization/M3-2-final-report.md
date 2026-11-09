# M3-2 最终验收报告：宿主适配层重构

**执行日期**：2026-11-09
**开工 HEAD**：`91e1a41`（= M3-1 设计文档提交，本地领先 origin/main 1 个提交）
**结束状态**：**已提交并推送**。六个批次各一个提交 + 一个 annotated tag（`m3-b0`…`m3-b5`），
另有一个文档回填提交（即本文件所在提交）。`main` 与 `origin/main` 一致（ahead/behind `0/0`）。
**结论**：**READY WITH WARNINGS**（主体完成、四组 CI 全绿并已入库；剩余警告为 macOS 与真实宿主注册表写入未验证、
中间 Tag 不可独立运行、CI 逐行日志因权限不可读 —— 见 §7）

---

## 1. 执行总览

### 1.1 批次完成情况

| 批 | 主题 | 状态 | 主要交付 |
|---|---|---|---|
| B0 | 观测基线与门禁 | 完成 | `errors.js`、`layering-check.mjs`、`baseline-capture.mjs`（7 面基线）、pack-check 扩展、CI 增加分层步骤 |
| B1 | AssetResolver | 完成 | 端口 + fs/memory 适配器 + 组合根雏形；store/compiler/manifest 去掉加载期读盘 |
| B2 | IdentityProvider 与配置统一 | 完成 | 端口 + cli/token-file 适配器；`paths.js` 单一路径解析；配置启动快照；移除 `ledger.read` |
| B3 | SessionSource 与数据源契约 | 完成 | 端口 + dsh 适配器 + 注册表；ledger 变纯计算；`rds ledger` 不再开库 |
| B4 | AuditSink 与 HostRegistry | 完成 | 两个端口 + 四个适配器；`mars-mcp-disable.js` + PS 转调 |
| B5 | 结构切分与收尾 | 完成 | db 拆为 `db/schema`、`db/ratelimit`、`db/stats` + 兼容壳；两个脚本去宿主运行时/猜路径 |

**实际顺序与计划一致**（B0→B5 串行）。过程中未改变已批准的架构边界。

### 1.2 规模

| 项 | 数值 |
|---|---|
| 已跟踪文件修改 | 38 个（+451 / −591 行） |
| 新增文件 | 39 个（+3,500 行，含基线快照与测试） |
| 端口 | 5 个（`ports/*.js`） |
| 适配器 | 8 个（`adapters/*.js`） |
| 测试 | 88 → **128**（+40），fail=0，skip=0 |
| 组合根 | 83 行（上限 120） |

修改明细见 §6。

### 1.3 每批技术变化

- **B0**：48 个散落的错误码收敛为 `PUBLIC_CODES`；两个网关的 14/20 项内联白名单删除，改用 `toPublicCode`。
  7 个对外面（CLI 帮助 / JSON 键树 / MCP 工具集 / 错误码 / 包清单 / 契约哈希 / 退出码）冻结为基线，之后每批复采比对。
- **B1**：`ROOT + 加载期 readFileSync` 改为组合根注入 `assets`；缺契约从 ENOENT 变成 `ASSET_MISSING`。
- **B2**：路径/配置/身份三类解析从 4 处收敛到 `paths.js` + 组合根；`store` 不再读 `MARS_ROUTING`；
  `ledger.read` 从未执行的动作删除，`audit.principal_id` 由 `'cli'` 改为哨兵 `'local'`。
- **B3**：DSH 词汇（zstd 多帧、`assistant/message`、`inputTokens`）全部移入适配器；`ledger.js` 只剩汇总/对账/CSV；
  `rds ledger` 先校验文件再解析，库不存在时不创建库。
- **B4**：24 个 `audit()` 调用点统一经 `AuditSink`；注册表写入从 PowerShell 整文件重写改为
  备份 → 结构校验 → 临时文件 + rename → 写后回读；未知顶层字段保留。
- **B5**：`db.js` 218 行拆为 4 个文件（DDL 逐字节未变），保留转发壳使 9 个依赖方零改动；
  `phase2-g1-verify.js` 改用当前 Node；`phase4-usage.js` 不再猜 `~/.dsh/sessions`。

---

## 2. 架构对照

### 2.1 五个端口落地情况

| 端口 | 方法 | 方法数 | 生产实现 | 测试替身 | 是否真正接入调用链 |
|---|---|---|---|---|---|
| `AssetResolver` | contract / config / rootPath | 3 | `FsAssetResolver` | `memoryAssets()` | 是：cli、mcp、mcp-stdio、全部脚本与测试 |
| `IdentityProvider` | resolve / source | 2 | `cli-identity`、`token-file-identity` | `StaticIdentity` 等价物（测试内联） | 是：CLI 与 MCP 两条入口 |
| `SessionSource` | kind / sniff / parse | 3 | `DshSessionSource` | 合成 fixture 源 | 是：`rds ledger`、`phase4-usage`、外部测试 |
| `AuditSink` | record | 1 | `DbAuditSink` | `NullAuditSink`、内存 sink | 是：生产连接由组合根绑定；24 个调用点全部经此 |
| `HostRegistry` | detect / list / backup / removeByPrefix | 4 | `DshRegistryAdapter` | `NullHostRegistry`、临时目录夹具 | 是：`mars-mcp-disable.js`（PS 转调） |

**与 M3-1 设计的一处调整（已记录理由）**：`IdentityProvider` 返回**凭证**（token + role）而非 principal。
原因：认证是纯函数，若在适配器里做，适配器就要 import 域模块 `authz`，形成反向依赖。
认证仍在 `authz.js`，端口只负责「凭证从哪来」。

### 2.2 依赖方向

迁移前：域模块在加载期 `require('node:fs')` 读契约、读环境变量、读外部注册表。

迁移后（`node tooling/layering-check.mjs` 实测）：

```
端口 5 个（零 require）/ 域文件 21 个 / 组合根 83 行
LAYERS PASS  problems=0 warnings=2
  WARN L3-fs mars/src/cli.js   已声明为边界代码（永久允许）
  WARN L3-fs mars/src/util.js  已声明为边界代码（永久允许）
```

债务条目从 B0 的 12 条降到 2 条，且两条都是**边界代码**（入口写 `--out` 产物；`guardSourceRef` 的 `realpath` 与原子写），
不是业务耦合。`mars/src` 内**无循环依赖**（L7 实测 0）。

### 2.3 仍然存在的直接宿主耦合

| 位置 | 性质 | 处理 |
|---|---|---|
| `adapters/dsh-*.js`（3 个） | 宿主格式解码 | **应当存在**——适配器的职责 |
| `mars/docs/**` 中的 DSH 描述 | 历史文档 | 属 M5，本轮不改 |
| `mars/scripts/seed-phase2.js` | **开工前即语法损坏**（见 §7） | 记为技术债，未修（内容不可恢复） |

---

## 3. 风险处理

| 编号 | 原始问题 | 处理方式 | 修改文件 | 测试证据 | 是否彻底 |
|---|---|---|---|---|---|
| **H-04** | `mars-mcp-disable.ps1` 整文件重写外部注册表 | 端口 + DSH 适配器：备份 → 结构校验 → 原子写 → 写后回读；PS 只转调 | `ports/host-registry.js`、`adapters/dsh-registry.js`、`adapters/null-host-registry.js`、`mars/scripts/mars-mcp-disable.js`、`mars/scripts/mars-mcp-disable.ps1` | `arch/host-registry.test.js` 8 例（含 dry-run 字节不变、未知字段保留、无临时残留） | 是 |
| **H-05** | `ledger.schema.json` 用 `const` 锁死 `dsh-session` | **按任务书 §五「本轮不改 schema」**：契约保持 `const`，解耦通过代码契约实现（端口 + 注册表） | `ports/session-source.js`、`adapters/dsh-session-source.js`、`session-registry.js`、`ledger.js` | `arch/sessions.test.js` 7 例；契约哈希与基线一致 | **部分**：代码层已解耦，契约仍单值（技术债 M4） |
| **S-02** | `principal_id: 'cli'` 字面量 + `ledger.read` 声明未执行 | 移除该动作；审计主体改哨兵 `'local'`，并在测试中断言不是伪装主体 | `authz.js`、`cli.js` | `arch/identity.test.js`：`ACTIONS.has('ledger.read') === false`；审计行 `principal_id === 'local'` | 是 |
| **配置解析** | 4 处实现、优先级不同 | 单点 `resolvePaths`；启动快照；域内禁止读 env | `paths.js`、`composition.js`、`cli.js`、`mcp-stdio.js`、`bin/doctor.mjs`、`store.js` | `arch/identity.test.js` 6 例；`store` 无 routing 时稳定 `ROUTING_UNAVAILABLE` | 是 |
| **错误码** | 两份白名单漂移，6 个码退化 | `errors.js` 单一真相，两网关共用 | `errors.js`、`mcp.js`、`mcp-stdio.js` | `mcp/errors.test.js` 5 例（含两个码在旧网关真实返回） | 是 |
| **ledger** | 读会话依赖 DSH 语义 + 强制开库 | 数据源端口化；先校验文件；库不存在不创建 | `ledger.js`、`cli.js`、`adapters/dsh-session-source.js` | `arch/sessions.test.js`：`--source nope` → exit 4；`arch/identity.test.js`：ledger 不创建库 | 是 |

---

## 4. 测试报告

| 项 | 结果 |
|---|---|
| 原有基线（M3 开工） | 88 tests / 88 pass / 0 fail / 0 skip |
| 新增测试 | **+40**（`mars/tests/arch/*` 5 个文件 34 例 + `mcp/errors.test.js` 5 例 + 1 例并入 identity） |
| 全量测试 | **GATE PASS tests=128 pass=128 fail=0 skipped=0** |
| G1 审查（隔离副本，**77 文件** diff） | **verdict = PASS**，checks 7/7 passed，findings=1（`ENCODING-BOM-REQUIRED`，severity=info，属"已按约定使用 BOM"的确认，非缺陷） |
| 四组 CI（[run 42575344428](https://github.com/LNiiuu/rds-mother-system/actions/runs/42575344428) @ `9a6b4a8`） | **四组全 success**：Windows/Node 22、Windows/Node 24、Ubuntu/Node 22、Ubuntu/Node 24；同一 run 内 `structure self-check` 与 `g1`（六夹具）亦 success |
| 结构检查 | `LAYERS PASS problems=0 warnings=2`；无循环依赖；组合根 83/120 行 |
| 配置检查 | `CONFIG PASS json=51 yaml=4` |
| 环境自检 | `doctor status: ok（fail=0 warn=1）` |
| 发行包端到端 | `PACK PASS` + `SMOKE PASS`（107 文件 / 95,705 B，安装→doctor→init→写入→审批→检索→编译） |
| 行为基线 | `BASELINE PASS`：7 个面零漂移，仅 19 个新增文件（全部登记在 `approved-additions.json`） |
| 回滚演练 | **PASS**：128 → revert → 88 → revert-revert → 128 |

**PASS / FAIL / WARN / SKIP / NOT RUN 的区分**：

- PASS：本地实跑或 CI 实跑且断言通过（含本次四组 CI）。
- WARN：`doctor` 的 `paths:docs`（历史文档本机路径，M5 范围）；分层检查的 2 条边界代码声明。
- SKIP：**0**。门禁强制 `skipped=0`，任何 skip 都会让门禁变红。
- NOT RUN：macOS；真实宿主注册表上的写入（只做隔离目录验证）。

---

## 5. 兼容性报告

| 面 | 是否变化 | 说明 |
|---|---|---|
| CLI 参数与子命令 | **不变** | 帮助文本与基线逐字节一致（`cli-help.txt` 比对通过） |
| CLI JSON 输出形状 | **不变** | 8 个子命令的键树与基线完全一致（`cli-json-keys.json`） |
| CLI 退出码 | **不变** | 10 个场景与基线一致（`exit-codes.json`） |
| MCP 工具集 | **不变** | 5 个工具的名称/必填/属性/additionalProperties 与基线一致 |
| MCP 错误码 | **变（修复）** | 6 个曾退化为 `INTERNAL_ERROR` 的码现在正确返回；属 B0 批准的修复 |
| ledger 读取 | **行为变化** | ① 不再创建数据库（库已存在才写审计）；② `--source` 未知时 exit 4 并列出已注册来源；③ 审计主体 `'cli'`→`'local'`、动作 `ledger.read`→`ledger.parse` |
| 配置优先级 | **不变**，但改为启动快照 | `--x > MARS_X > 安装根默认`；**长驻 MCP 改 `role-routing.json` 需重启**（此前"即时生效"未文档化、无测试覆盖） |
| 域模块 `store.propose` 契约 | **变严格** | 不传 `routing` 由"读环境变量兜底"改为稳定 `ROUTING_UNAVAILABLE`（fail-closed 更彻底） |
| 审计主体表达 | **变（修复）** | 本地未认证调用记为 `'local'` 哨兵，不再伪装成已认证 principal |
| 现有用户数据 | **未受影响** | 无 schema 变更、无 SQL 改动、无迁移；`SCHEMA_VERSION` 仍为 4；DDL 逐字节一致 |
| 发行包 | 文件数 88 → 107 | 新增端口/适配器；`PACK PASS`，禁止项 0 命中 |

---

## 6. Git 变更报告

| 项 | 值 |
|---|---|
| 开工前 HEAD | `91e1a41` |
| 当前 HEAD | `9a6b4a8`（M3-2 六个批次提交） |
| 当前分支 | `main`，与 `origin/main` 一致（ahead/behind `0/0`） |
| 提交与 Tag | B0 `c342636`/`m3-b0`、B1 `35c286b`/`m3-b1`、B2 `1b56fca`/`m3-b2`、B3 `88599d4`/`m3-b3`、B4 `6cdadbc`/`m3-b4`、B5 `9a6b4a8`/`m3-b5`；另有 1 个文档回填提交（本文件所在提交，SHA 见该提交本身） |
| 暂存区 | **空** |
| 工作区 | 51 项 = 原有 51 项（本轮 77 项已全部入库） |
| 原有 51 项 | **未被改动，也未混入任何提交**：50 个文件按 SHA-256 逐一比对一致；第 51 个（`docs/analysis/M1-DSH运行时与插件能力核查.md`，此前因 git 八进制转义无法还原路径）已与备份 `M1-backup-20261108-162614` 逐字节比对一致（24288 B、`825c5515…`、mtime 2026-11-02） |
| 本轮范围外变化 | 无 |
| 提交内容一致性 | 77 个文件在 `HEAD` blob 与提交前工作区之间逐文件比对 0 差异（按路径排序的内容指纹均为 `0813a6fb…41ba3`） |

**本轮修改的 38 个已跟踪文件**：`.github/workflows/ci.yml`、`package.json`、`bin/doctor.mjs`、`mars/src/{authz,cli,compiler,db,ledger,manifest,mcp,mcp-stdio,store}.js`、
`mars/scripts/{mars-mcp-disable.ps1,phase2-g1-verify,phase3-sharing-smoke,phase4-build,phase4-usage,seed-phase2,wp5-stress}.js`、
`mars/tests/**`（13 个）、`tooling/{pack-check}.mjs`、`README.md`、`CHANGELOG.md`、`docs/install.md`、`docs/checks/productization/M3-2-final-report.md`。

**本轮新增的 39 个文件**：5 个端口、8 个适配器、`composition.js`、`paths.js`、`session-registry.js`、`errors.js`、
`db/{schema,ratelimit,stats}.js`、5 个 `tests/arch/*`、`tests/helpers/assets.js`、`tests/mcp/errors.test.js`、
`tooling/{layering-check,baseline-capture}.mjs`、`mars/scripts/mars-mcp-disable.js`、`docs/architecture/m3/baseline/*`（8 个）。

---

## 7. CI 实证结果与未完成 / 未验证项

### 7.1 四组 CI 实证结果

工作流：`.github/workflows/ci.yml`，`push` 到 `main` 触发（Tag 推送不触发，`on.push.branches` 限定）。

Run：[42575344428](https://github.com/LNiiuu/rds-mother-system/actions/runs/42575344428) @ commit `9a6b4a8`

| Job | 结果 | 时长 |
|---|---|---|
| required (windows-latest / node 22.x) | **success** | 48s |
| required (windows-latest / node 24.x) | **success** | 53s |
| required (ubuntu-latest / node 22.x) | **success** | 8s |
| required (ubuntu-latest / node 24.x) | **success** | 10s |
| structure self-check (windows-latest) | **success** | 33s |
| g1 (windows-latest / powershell) | **success** | 31s |

**6/6 job success，首轮即全绿，未出现需要修复的失败。**

required job 的 7 个步骤在两个平台上全部 success：
环境信息 → `doctor` → 配置校验 → **分层检查** → **Required 测试门禁** →
门禁反向验证 → 发行包端到端。M3 新增的分层检查已在 CI 中真实执行。

`g1` job 的「G1 六个夹具」步骤 success。workflow 里原先「文件不存在则 SKIP」的分支
已在本轮之前的提交中删除，耗时 31s 也说明夹具真实执行（跳过会在 1s 内结束）。

### 7.2 证据强度的边界（不得声称已人工检查全部日志）

`GET /repos/{owner}/{repo}/actions/jobs/{id}/logs` 需要 admin 权限，本次匿名访问返回 **403**。
因此**没有逐行读取 CI 日志**，也就没有目视确认 `GATE PASS tests=128`、`SMOKE PASS`
或六夹具逐项 PASS 的文本行。

可用的判据是四条间接证据：

1. job 与 step 的 `conclusion` 均为 `success`；
2. 步骤没有 `if` 跳过条件（`ci.yml` 里 required job 的 7 步对两个平台无差别执行）；
3. `tooling/test-gate.mjs` 强制 `tests>0 && fail=0 && skipped=0`，空集或全 skip 都会让它变红；
4. `tooling/ci-smoke.sh` 用 `set -euo pipefail`，缺 tarball 或找不到 `rds` 可执行文件都会 `exit 1`，
   且脚本内无任何早退分支。

**一处如实记录的观察**：Ubuntu 上「Required 测试门禁」与「发行包端到端」步骤各约 1–2s，
而 Windows 上为 10–20s（本机实测 `npm test` 3.9s、`ci-smoke.sh` 11.5s）。差异可归因于
Linux 进程启动与 npm 调用开销显著低于 Windows，未发现跳过迹象，但**无法用日志逐行确认**。

### 7.3 关于六个 Tag 的定位（重要）

六个 Tag 是**审阅用的批次边界标记**，不是六个独立可发布版本，也不是可 `git bisect` 的历史点。

原因：77 个改动在同一工作区一次性完成，没有保留每批的中间文件快照；而
`cli.js`、`mcp.js`、`mcp-stdio.js`、`composition.js`、`tooling/layering-check.mjs`、
`tooling/pack-check.mjs`、`mars/src/db.js` 跨批次共享，在每个提交里承载的是**最终内容**。
因此中间提交的树不自洽。

从各 Tag 用 `git archive` 解出独立目录后的实测结果：

| Tag | `rds --version` | `rds doctor` | `test-gate` |
|---|---|---|---|
| `m3-b0` | OK | OK（当时 doctor 尚未改造） | FAIL `tests=89 pass=88 fail=1` |
| `m3-b1` | OK | OK（同上） | FAIL `tests=94 pass=87 fail=7` |
| `m3-b2` | OK | FAIL `Cannot find module './adapters/dsh-session-source'` | — |
| `m3-b3` | OK | FAIL 同上 | — |
| `m3-b4` | OK | FAIL `Cannot find module './db/schema'` | — |
| `m3-b5` | OK | OK | **PASS `tests=128 pass=128 fail=0 skipped=0`** |

结论：**只有 `m3-b5` 是完整可运行且全绿的状态**。`m3-b0`…`m3-b4` 用于回答
"这一批改了哪些文件"，**不能用于单批回滚或 `git bisect`**。若要得到真正可 bisect 的
六段历史，需要按批次重做实现（每批留下中间快照），属独立的返工项。

### 7.4 仍未完成 / 未验证

| 项 | 状态 | 原因 | 影响 | 补救 |
|---|---|---|---|---|
| macOS | **NOT RUN** | 无设备；CI 矩阵未包含 | 不作承诺 | 需要时加 `macos-latest` 到矩阵 |
| 真实宿主注册表写入 | **未执行** | 只允许隔离目录验证；真实写入会改外部产品状态 | 无 | 由用户确认后自行执行 `--yes`（写入前后均有备份与回读校验） |
| `ledger.schema.json` 的 `const: dsh-session` | **保持原样** | 任务书 §五明确本轮不改 schema | 第二种数据源仍无法通过契约校验（代码层已解耦） | M4 升版时改 `pattern` |
| `mars/scripts/seed-phase2.js` | **开工前即语法损坏**，未修 | 文件内中文曾经历编码损坏（UTF-8 字节被按 GBK 读后再存），含不可逆的替换字符，**原文不可恢复**；它是直写生产库的开发脚本 | 该脚本不可运行，属 M1 之前的既有状态；本轮只加了 2 行 import + 1 个 options 字段，未触碰损坏字符串 | 重写种子内容或删除脚本；建议列入 M4 |
| 单批回滚 | **不可用** | 见 §7.3：中间 Tag 的树不自洽 | 只能整体回滚（依次 revert 六个提交，或回到 `91e1a41`）；单独 revert 某一批会破坏其他批次的引用 | 若需要批次粒度回滚，需重做分批 |
| CI 逐行日志 | **不可读（403）** | 无仓库 admin 权限 | 只能给出结论级证据，不能给出逐行证据 | 由仓库管理员下载日志归档 |

---

## 8. 结论

**READY WITH WARNINGS**

理由：

- 五个端口全部落地并接入真实调用链，不是空壳（每个都有生产实现 + 替身 + 断言）；
  分层检查从 12 条债务降到 2 条**边界代码声明**，`mars/src` 无循环依赖。
- 七个对外面零漂移（帮助文本、JSON 键树、MCP 工具集、错误码集合、包清单、契约哈希、退出码），
  证明"重构未改行为"不是口号。
- 六个已知风险里 5 个彻底解决，H-05 按任务书要求只做代码层解耦（契约留待 M4）。
- 回滚演练证明可恢复性：回滚后测试数正好回到 M3 开工基线 88。
- 四组 CI 在 `9a6b4a8` 上一次通过（`42575344428`），双平台 × 双 Node 版本全 success。
- **警告项**：macOS 与真实宿主注册表写入未验证；`m3-b0`…`m3-b4` 不是可独立运行的中间状态
  （见 §7.3）；CI 逐行日志因 403 不可读；`seed-phase2.js` 是开工前就坏的历史脚本。

**已按批准执行**：六个批次各一个提交 + 一个 annotated tag 并推送到 `origin/main`，
另加一个文档回填提交（本文件）。`main` 与 `origin/main` 一致，工作区保留原有 51 项未提交工作。
