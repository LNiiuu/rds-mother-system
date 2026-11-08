# M3-1 宿主耦合点清单

**基线**：`51a562e`。行号仅对该 commit 有效。
**等级**：S1 = 阻断通用部署或造成外部状态风险；S2 = 可运行但会漂移/不可信；S3 = 认知与维护成本。
**类型**：`资产` / `配置` / `外部状态` / `数据源` / `错误模型` / `结构` / `入口`

> 判定口径：只看"换个宿主、换个目录、换个安装方式时会不会失效或说谎"，不看代码是否优雅。

## 汇总

| 类型 | S1 | S2 | S3 | 合计 |
|---|---|---|---|---|
| 资产定位 | 0 | 2 | 0 | 2 |
| 配置解析 | 0 | 2 | 0 | 2 |
| 外部状态 | 1 | 0 | 0 | 1 |
| 数据源 | 1 | 2 | 1 | 4 |
| 错误模型 | 0 | 1 | 0 | 1 |
| 结构 | 0 | 2 | 0 | 2 |
| 入口 | 0 | 1 | 1 | 2 |
| **合计** | **2** | **10** | **2** | **14** |

两个 S1 分别是 **H-04（直接改写外部产品注册表）** 与 **H-05（数据源语义写进契约）**。
其余 12 项都不阻塞"能跑"，但会让"跑出来不可信"或"换环境就失效"。

---

## H-01 契约在模块加载期按安装目录读取

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/store.js:9-10`、`mars/src/compiler.js:13-14`、`mars/src/manifest.js:8-10` |
| 当前行为 | `ROOT = path.resolve(__dirname,'..')`，随后 `JSON.parse(fs.readFileSync(path.join(ROOT,'contracts',…)))` 在 **require 阶段**执行 |
| 失败形态 | 文件缺失时抛原生 `ENOENT: no such file or directory`，**没有错误码**，调用方只能看到栈 |
| 已发生 | M1 首次 `npm pack` 漏了 `mars/contracts/`，从 tarball 安装后 `rds put` 直接 ENOENT（记录于 `docs/checks/productization/M1-M2-final-report.md`） |
| 影响范围 | 模块（store / compiler / manifest 三个域模块） |
| 等级 | S2 |
| 说明 | 同时导致：① 模块与安装路径绑定；② 测试无法替换契约；③ 错误在 `require` 期而非调用期暴露，两者时间语义不同 |

## H-02 配置解析有四处实现，优先级互不相同

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/cli.js:36-44`（`args > env > 默认`）、`mars/src/mcp-stdio.js:416-421`（仅 env）、`mars/src/store.js:19`（仅 env，且在域内）、`bin/doctor.mjs:192`（仅 `MARS_DB`） |
| 当前行为 | 四段代码各自决定"从哪取值"，没有共享解析器 |
| 可观测后果 | 同一台机器上，`rds doctor` 报的数据库路径（`doctor.mjs:192`）与 `rds put --db X` 实际写入的库可以不同；`MARS_ROUTING` 在 CLI 与 stdio 中生效方式不同（CLI 传给路由对象，store 自己再读一次环境变量） |
| 影响范围 | 模块（cli / mcp-stdio / store / doctor） |
| 等级 | S2 |

## H-03 域模块读 `process.env`

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/store.js:16-23`，具体行为在 `:19` 的 `process.env.MARS_ROUTING` |
| 当前行为 | `resolveRouting()` 在域函数内部读环境变量，作为 fail-closed 的兜底 |
| 影响 | ① 域模块不再可单测（必须改进程环境）；② 进程级隐式状态，双实例共享同一 env；③ 与 H-02 叠加产生"配置来源不可枚举" |
| 影响范围 | 单文件（store.js） |
| 等级 | S2 |

## H-04 直接改写外部产品的注册表文件（S1）

| 项 | 内容 |
|---|---|
| 证据 | `mars/scripts/mars-mcp-disable.ps1:6`（默认 `%USERPROFILE%\.dsh\skill-mcp-manager\registry.json`）、`:39-41`（备份到 `mars/var/mcp`）、`:43-45`（`ConvertTo-Json -Depth 12` 后整文件重写） |
| 当前行为 | PowerShell 读取另一产品的私有注册表，用字符串前缀 `mars-` 过滤条目，全量重写该文件 |
| 风险 | ① 依赖对方未公开的格式，对方改结构即静默写坏；② `ConvertTo-Json` 会重排键序、可能改变数字/日期表示；③ 写入时机与对方进程无协调（脚本自己在 `:47` 提示"需重启会话"）；④ RDS 没有任何"注册表"概念，只有"改别人的文件" |
| 影响范围 | 跨产品（RDS → DSH 注册表） |
| 等级 | **S1** |
| 备注 | 这是全仓库唯一一处 RDS 对**外部产品状态**有写权限的代码 |

## H-05 数据源语义写进数据契约（S1）

| 项 | 内容 |
|---|---|
| 证据 | 词汇表 `mars/src/ledger.js:11-17`（`inputTokens`/`outputTokens`/…）、事件类型判定 `:119-124`（`session` / `request/header` / `assistant/message`）、常量 `:142`、`:185`、`:207`（`source_kind: 'dsh-session'`） |
| 契约冻结 | `mars/contracts/ledger.schema.json:11`（`"source": {"const": "dsh-session"}`）与 `:22`（`"source_kind": {"const": "dsh-session"}`） |
| 当前行为 | 解析器把 DSH 的事件词汇硬编码为唯一真相；账本契约用 `const` 把它固定成"只能有一种来源" |
| 后果 | 接入第二种会话格式必须**同时改域代码 + 改契约**，且 `const` 会让旧校验器拒绝新数据 |
| 影响范围 | 模块 + 契约 |
| 等级 | **S1**（唯一"数据结构层"的阻断：不改契约就永远只有一种数据源） |

## H-06 `ledger` 命令为写审计行而强制打开数据库

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/cli.js:114`（`openDb(p.db)` 在解析之前）、`:124`（写审计）；`mars/src/db.js:16-22`（`openDb` 内 `new DatabaseSync(file)`，会创建文件） |
| 实测 | `openDb(tmpPath)` 后文件确实存在（E1，本次执行） |
| 后果 | ① 只读会话文件却要求可写数据库；只读挂载 / 无盘容器下失败；② 错误顺序反转——先建库，再报"会话文件不存在"（`:114` 早于 `:115` 的 `existsSync`）；③ 账本这个纯计算能力被绑上了存储 |
| 影响范围 | 模块（cli.js）+ 行为（副作用） |
| 等级 | S2 |

## H-07 `ledger.read` 是"声明但未执行"的权限动作

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/authz.js:6`（`ACTIONS` 含 `'ledger.read'`）；全仓库仅在 `mars/src/cli.js:124` 出现，且以字面量 `principal_id: 'cli'` 写审计 |
| 当前行为 | `ledger` 子命令不做任何认证/授权；`authz` 的 `ACTIONS` 里却登记了这项动作，给人"已受控"的错觉 |
| 后果 | 审计行里的 principal 不可信；权限模型存在死条目 |
| 影响范围 | 单文件 + 权限模型 |
| 等级 | S2（安全相关，但无越权写：ledger 只读文件 + 写一条审计） |
| 处理建议 | 二选一，**不要**保留现状：或在 B3 让 ledger 走 `IdentityProvider` 并真正 `authorize`，或从 `ACTIONS` 删除该项并在文档说明"ledger 是本地只读能力，不参与授权模型" |

## H-08 运维脚本用外部产品当 Node 运行时

| 项 | 内容 |
|---|---|
| 证据 | `mars/scripts/phase2-g1-verify.js:12`（`process.env['DSH'+'_EXE']` 或 `%LOCALAPPDATA%\Programs\DSH\DSH.exe`）、`:13-16`（`ELECTRON_RUN_AS_NODE: '1'`） |
| 对照 | 测试侧已改为 `process.execPath`（`mars/tests/phase2/wp1.test.js`，M2 改动），脚本侧未跟上 |
| 后果 | 该脚本只能在装有 DSH 的机器上执行；在其他机器上失败原因不直观 |
| 影响范围 | 单脚本 |
| 等级 | S2 |

## H-09 会话目录默认值写死为 `~/.dsh/sessions`

| 项 | 内容 |
|---|---|
| 证据 | `mars/scripts/phase4-usage.js:8`（`process.env.RDS_SESSIONS_ROOT \|\| path.join(os.homedir(),'.dsh','sessions')`） |
| 说明 | 已有环境变量逃生口，属"默认值偏向宿主"，不是硬耦合 |
| 等级 | S3 |

## H-10 错误码白名单两处实现，且已漂移

| 项 | 内容 |
|---|---|
| 证据 | `mars/src/mcp.js:27`（14 个码）、`mars/src/mcp-stdio.js:320`（20 个码） |
| 差集 | 仅 `mcp-stdio` 有：`EXPIRES_AT_INVALID`、`INVALID_TRANSITION`、`RATE_LIMITED`、`ROLE_TYPE_DENIED`、`ROUTING_UNAVAILABLE`、`STATE_UNCHANGED` |
| 后果 | 同样的失败，在 `mcp-stdio` 返回具体码，在旧网关退化成 `INTERNAL_ERROR`；调用方无法写稳定的错误处理 |
| 规模 | `mars/src` 内共 **48 个不同错误码**（`grep -rhoE "throw new Error\('[A-Z_]+"`），两处白名单合计只覆盖 20 个 |
| 影响范围 | 两个 MCP 实现 + 所有调用方 |
| 等级 | S2 |

## H-11 `db.js` 混合六种职责

| 项 | 内容 |
|---|---|
| 证据 | 驱动引入 `:4-11`；DDL `:25-154`；迁移 `:158-163`；限流 `:167-188`；审计 `:190-196`；统计 `:198-216` |
| 依赖度 | 被 9 个模块依赖（见 `current-state.md` §3） |
| 风险 | ① 任何"加一个审计字段"都要改这个 218 行文件；② 审计/限流是**治理**能力，与"打开数据库"混在一起；③ 若把适配层挂在这里，它会变成新的上帝模块 |
| 等级 | S2（结构性，非缺陷） |

## H-12 入口按路径 spawn 实现

| 项 | 内容 |
|---|---|
| 证据 | `bin/rds.mjs:19`（`CLI = path.join(ROOT,'mars','src','cli.js')`）、`:127-131`（`spawn(process.execPath, [...])`） |
| 说明 | 这是**有意保留**的设计：M1 明确要求"入口不复制业务逻辑"，物理拆分后才不会分叉 |
| 处理 | 不消除。仅在设计中登记为"契约"：`mars/src/cli.js` 的路径与参数透传语义属于对外接口 |
| 等级 | S3 |

## H-13 发行包白名单必须手工覆盖运行时资产

| 项 | 内容 |
|---|---|
| 证据 | `package.json` 的 `files` 数组显式列出 `mars/src/`、`mars/contracts/`、`mars/config/role-routing.json` 等 |
| 机制 | 新增任何运行时资产目录（如 B1 引入的 `mars/src/ports/`）都必须同步该白名单，否则"源码树能跑、发行包报 ENOENT" |
| 已发生 | 同 H-01 |
| 等级 | S2 |
| 缓解 | 已有 `tooling/pack-check.mjs` 做内容断言；设计需把它扩展为"断言 ports/ 与 contracts/ 存在" |

## H-14 测试直接读仓库真实配置

| 项 | 内容 |
|---|---|
| 证据 | `mars/tests/phase1/helpers.js:11-12`、`mars/tests/phase2/mcp-stdio.test.js:15-16`（`ROUTING = path.join(ROOT,'config','role-routing.json')`） |
| 说明 | 这是**可接受**的：`role-routing.json` 是契约资产（随包分发），不是宿主状态。但它意味着角色路由的改动会影响多组测试——迁移中必须把 `role-routing.json` 明确定位为"契约资产"，不得改成"用户配置" |
| 等级 | S3 |

---

## 耦合点与"是否要动"的对照

| ID | 是否在 M3 处理 | 归属批次 |
|---|---|---|
| H-01 | 是 | B1 |
| H-02 / H-03 | 是 | B2 |
| H-04 | 是 | B4 |
| H-05 | 是 | B3 |
| H-06 / H-07 | 是 | B3 |
| H-08 / H-09 | 是 | B5 |
| H-10 | 是 | B0 |
| H-11 | 是（仅文件切分，不改 SQL） | B5 |
| H-12 | **否**（有意保留，登记为契约） | — |
| H-13 | 是（扩展检查） | B0 |
| H-14 | **否**（定位为契约资产） | — |

**明确不动的两类**：H-12 的进程边界、H-14 的契约资产定位。动它们不会有收益，只会引入新风险。
