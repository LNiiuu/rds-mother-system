# M3-2 最终验收报告：宿主适配层重构

**执行日期**：2026-11-09
**开工 HEAD**：`91e1a41`（= M3-1 设计文档提交，本地领先 origin/main 1 个提交）
**结束状态**：**未 commit、未 stage、未 push**（按任务书 §十）
**结论**：**READY WITH WARNINGS**（主体完成；CI 未运行、macOS 未验证）

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
| B5 | 结构切分与收尾 | 完成 | db 拆为 `db/schema|ratelimit|stats` + 兼容壳；两个脚本去宿主运行时/猜路径 |

**实际顺序与计划一致**（B0→B5 串行）。过程中未改变已批准的架构边界。

### 1.2 规模

| 项 | 数值 |
|---|---|
| 已跟踪文件修改 | 38 个（+451 / −591 行） |
| 新增文件 | 39 个（3,400+ 行，含基线快照与测试） |
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
| 四组 CI | **NOT RUN**（见 §7） |
| 结构检查 | `LAYERS PASS problems=0 warnings=2`；无循环依赖；组合根 83/120 行 |
| 配置检查 | `CONFIG PASS json=51 yaml=4` |
| 环境自检 | `doctor status: ok（fail=0 warn=1）` |
| 发行包端到端 | `PACK PASS` + `SMOKE PASS`（107 文件 / 95,705 B，安装→doctor→init→写入→审批→检索→编译） |
| 行为基线 | `BASELINE PASS`：7 个面零漂移，仅 19 个新增文件（全部登记在 `approved-additions.json`） |
| 回滚演练 | **PASS**：128 → revert → 88 → revert-revert → 128 |

**PASS / FAIL / WARN / SKIP / NOT RUN 的区分**：

- PASS：本地实跑且断言通过（上述除 CI 外全部）。
- WARN：`doctor` 的 `paths:docs`（历史文档本机路径，M5 范围）；分层检查的 2 条边界代码声明。
- SKIP：**0**。门禁强制 `skipped=0`，任何 skip 都会让门禁变红。
- NOT RUN：四组 CI（无提交/推送权限）；macOS；真实宿主注册表上的写入（只做隔离目录验证）。

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
| 当前 HEAD | `91e1a41`（**未新增提交**） |
| 当前分支 | `main`（本地领先 `origin/main` 1 个提交：M3-1 设计文档） |
| 暂存区 | **空**（`git diff --cached --name-only` = 0） |
| 工作区 | 124 项 = 原有 51 项 + 本轮 73 项 |
| 原有 51 项 | **未被改动**：50 个文件按 SHA-256 逐一比对一致；第 51 个（`docs/analysis/M1-DSH…md`）因快照脚本把反斜杠转成斜杠导致路径无法还原，改用 mtime（2026-11-02，早于本轮）与"本轮文件清单不含该路径"双重佐证 |
| 本轮范围外变化 | 无 |

**本轮修改的 38 个已跟踪文件**：`.github/workflows/ci.yml`、`package.json`、`bin/doctor.mjs`、`mars/src/{authz,cli,compiler,db,ledger,manifest,mcp,mcp-stdio,store}.js`、
`mars/scripts/{mars-mcp-disable.ps1,phase2-g1-verify,phase3-sharing-smoke,phase4-build,phase4-usage,seed-phase2,wp5-stress}.js`、
`mars/tests/**`（13 个）、`tooling/{pack-check}.mjs`、`README.md`、`CHANGELOG.md`、`docs/install.md`、`docs/checks/productization/M3-2-final-report.md`。

**本轮新增的 39 个文件**：5 个端口、8 个适配器、`composition.js`、`paths.js`、`session-registry.js`、`errors.js`、
`db/{schema,ratelimit,stats}.js`、5 个 `tests/arch/*`、`tests/helpers/assets.js`、`tests/mcp/errors.test.js`、
`tooling/{layering-check,baseline-capture}.mjs`、`mars/scripts/mars-mcp-disable.js`、`docs/architecture/m3/baseline/*`（8 个）。

---

## 7. 未完成 / 未验证（如实列出）

| 项 | 状态 | 原因 | 影响 | 补救 |
|---|---|---|---|---|
| 四组 CI（Win/Ubuntu × Node 22/24） | **NOT RUN** | 任务书禁止提交与推送；CI 只能由 commit 触发 | 本轮只能给出**单平台（Windows 22.22.2）**证据 | 批准提交后 push 即可跑；`ci.yml` 已加 `npm run layers` 步骤 |
| Ubuntu / Linux | **NOT RUN** | 同上（本机 `wsl.exe` 被安全策略拦截） | 跨平台结论仍为静态可移植性 | 同上 |
| macOS | **NOT RUN** | 无设备 | 不作承诺 | — |
| `ledger.schema.json` 的 `const` | **保持原样** | 任务书 §五明确本轮不改 schema | 第二种数据源仍无法通过契约校验 | M4 升版时改 `pattern` |
| 真实宿主注册表写入 | **未执行** | 只允许隔离目录验证；真实写入会改外部产品状态 | 无 | 由用户在确认后自行执行 `--yes` |
| `mars/scripts/seed-phase2.js` | **开工前即语法损坏**，未修 | 文件内中文曾经历编码损坏（UTF-8 字节被按 GBK 读后再存），**原文不可恢复**；它是直写生产库的开发脚本 | 该脚本不可运行（M1 之前的既有状态），M3 未使其更糟 | 若要恢复，需重写种子内容或删除脚本；建议列入 M4 |
| 逐批回滚 | 仅做**整体**回滚演练 | 未获准提交，无法形成 6 个独立提交 | 单批回滚粒度需在正式提交后按 §6 文件清单拆分 | 提交后每批一个 commit 即可获得粒度 |

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
- **警告项**：CI 未运行（无提交权限）、macOS 未验证、`seed-phase2.js` 是开工前就坏的历史脚本。

**未执行任何 `git add` / `commit` / `tag` / `push`**，工作区保留全部变更，等待一次性审核。
