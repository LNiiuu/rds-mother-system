# M3 宿主适配层设计

**状态**：设计草案（M3-1 产出，**未实现**）
**基线**：`51a562e`
**约束**：不引入第三方依赖；不引入云服务与 AI API；本地优先；不改变现有 CLI / MCP / 发行包对外行为。

> 本文所有接口都是**设计**，不是已实现代码。任何"将支持"的表述都不代表当前可用。

---

## 1. 设计目标与非目标

**目标**（只解决 `coupling-map.md` 里的 14 个点）

1. 域逻辑不再知道"文件在哪、进程环境是什么、外部产品叫什么"。
2. 换宿主（DSH → 其他 Agent 客户端 → 无宿主）只新增适配器，不改域代码与契约。
3. 每个耦合点都有对应的测试替身，且替身不读盘、不读环境变量。
4. 对外行为零变化：CLI 参数、退出码、JSON 形状、MCP 工具集与错误码、发行包内容。

**非目标**（写死在设计里，防止范围膨胀）

| 不做 | 理由 |
|---|---|
| 插件运行时 / 动态加载适配器 | 会带来打包、安全、版本协商三重成本，当前只有 1 个真实宿主 |
| 抽象文件系统 | `node:fs` 是稳定内建；注入会让 9 个模块改签名而无收益（见 §6） |
| 抽象时钟 / 随机 ID | 见 §6，属"为抽象而抽象" |
| 引入 DI 容器 / 装饰器 / 元编程 | 单进程、15 个模块，手工装配足够 |
| 把 `core/` 变成可执行模块 | `core/` 目前是提示词资产，由 AI 会话读取，不存在运行时边界 |
| 改数据库 schema | M3 不动数据；迁移属 M4 |

---

## 2. 分层与依赖方向

```
┌──────────────────────────────────────────────────────────────┐
│ 入口层  bin/rds.mjs · bin/doctor.mjs · bin/validate.mjs      │
│ 只做：参数整形 → 调 composition → 输出 → 退出码              │
└───────────────────────────┬──────────────────────────────────┘
                            │ 只允许 import composition
┌───────────────────────────▼──────────────────────────────────┐
│ 组合根  mars/src/composition.js                              │
│ 只做：解析配置 → 选实现 → 立即解析资产（fail-fast）→ 返回     │
│ 硬约束：≤120 行；不含业务 if/else；不 import 域业务模块       │
└──────────┬───────────────────────────────┬───────────────────┘
           │ 创建                          │ 创建
┌──────────▼──────────┐        ┌───────────▼──────────────────┐
│ 适配器 adapters/    │        │ 域 domain/（现有 src/*.js）   │
│ 只依赖：ports + node │        │ 只依赖：ports + 彼此          │
│ 可依赖外部世界         │        │ 禁止：fs / child_process /    │
│                     │        │       process.env / adapters  │
└──────────┬──────────┘        └───────────┬──────────────────┘
           │ 实现                          │ 依赖
┌──────────▼───────────────────────────────▼───────────────────┐
│ 端口 ports/   纯契约：函数签名 + 错误码 + JSDoc 类型          │
│ 零 import（连 node: 都不 import）                             │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向的唯一规则**：箭头只能向下。`domain` 永远不知道 `adapters` 的存在。

这条规则不靠自觉，靠三条机械检查（见 `acceptance-criteria.md` A6/A7）：

1. `grep -rn "require('node:fs')\|require('node:child_process')" mars/src/domain` → 必须为 0
2. `grep -rn "process\.env\." mars/src/domain` → 必须为 0
3. `grep -rn "require('\.\./adapters" mars/src/domain` → 必须为 0

> 目录名用 `domain/` 还是保持 `src/*.js` 平铺？**决定：M3 不搬目录**。物理搬迁属 M3 之外的整理，且会让 6 个模块的 `__dirname` 变化。
> 检查脚本用"排除法"实现：`mars/src/` 下除 `adapters/`、`ports/`、`composition.js`、`bin` 侧之外的文件视为域。

---

## 3. 五个端口

### 准入规则（先立规矩，再列端口）

一个端口只有在满足**至少一条**时才允许存在：

- **A. 存在 ≥2 个真实实现**（不是假设的将来）；
- **B. 需要测试替身来移除磁盘/环境/进程依赖**；
- **C. 边界处存在安全或数据完整性风险，需要单点强制**。

外加三条硬约束：

1. 单端口方法数 **≤ 5**；
2. 端口之间**不得互相依赖**；
3. 端口模块**零 import**（不 import `node:*`，不 import 其他端口）。

不满足的直接不做——这是防"上帝模块"的第一道闸。

---

### P1 `AssetResolver` — 契约与配置的唯一定位点

| 项 | 内容 |
|---|---|
| 解决 | H-01、H-02 的一半 |
| 准入 | B（测试需要无盘替身）+ A（生产 fs / 测试内存 = 2 个实现） |
| 方法 | `contract(name)` · `config(name)` · `rootPath()` |
| 输入 | `contract('memory')` → 名字，不带扩展名、不带路径；`config('role-routing')` 同理 |
| 输出 | `{ value, source: 'file'\|'memory', hash }`；`value` 已 `JSON.parse` 且冻结（`Object.freeze` 浅层） |
| 错误 | `ASSET_MISSING`（名字不存在）、`ASSET_INVALID`（JSON 解析失败 / 顶层非对象）、`ASSET_HASH_MISMATCH`（仅当调用方传入期望 hash） |
| 生命周期 | 组合根创建一次，进程内不变；**创建时立即解析全部已知资产**（fail-fast，保持与今天 `require` 期报错相同的时间语义） |
| 同步性 | 同步。所有调用方都是同步代码；改异步会传染到 `propose`/`compileContext` 的签名 |
| 资源所有权 | 不持有文件句柄；读取后即关闭；返回值可被调用方长期持有 |
| 依赖方向 | 适配器实现 → 端口；域 → 端口 |
| 测试替身 | `MemoryAssetResolver(map)`：从对象取，缺键抛 `ASSET_MISSING` |
| 兼容性 | 今天的 `store.js:10` / `compiler.js:14` / `manifest.js:10` 三处模块级常量改为组合根注入；**schema 内容一字不改** |

**关键决策：配置用"启动快照"而非"每次读取"。**
理由：① 现有 `resolveRouting()` 每次调用读盘/读环境变量（`store.js:19`），在长驻 MCP 进程里意味着"改文件即时生效"——但没有测试覆盖这个行为，也无文档承诺；② fail-closed 要求启动时就要确定路由，否则第一次调用才发现配置坏了；③ 快照让行为可预测。
**兼容性影响**：MCP 长驻进程"改 role-routing.json 后无需重启"这一**未文档化**的行为会消失。B2 必须在 CHANGELOG 写明，并确认无测试依赖它（当前 88 个用例中没有）。

---

### P2 `IdentityProvider` — 身份只解析一次

| 项 | 内容 |
|---|---|
| 解决 | H-02、H-03、H-07 |
| 准入 | A（CLI 参数 / MCP token 文件 / 测试静态 = 3 个实现）+ C（身份是安全边界） |
| 方法 | `resolve()` · `source()` |
| 输入 | 无参数（provider 在构造时已接收它需要的东西：`{argv, env, tokenFile}`） |
| 输出 | `{ ok: true, principal, role, source }` 或 `{ ok: false, code }`；`principal` = `{principal_id, project_ids[], roles[]}` **冻结对象** |
| 错误 | `AUTH_DENIED`、`TOKEN_MISSING`、`ROLE_REQUIRED`、`ROLE_DENIED`、`PRINCIPALS_MISSING` |
| 生命周期 | 每次进程启动解析一次。MCP 在 `createGateway` 时解析并缓存；CLI 每命令解析一次（一进程一命令，等价） |
| 同步性 | 同步（读一个小 JSON 文件） |
| 资源所有权 | 只读；返回的 principal 是副本，调用方改不到原始配置 |
| 依赖方向 | 适配器 → 端口；组合根决定用哪个 |
| 测试替身 | `StaticIdentityProvider({principal, role})` |
| 兼容性 | `MARS_TOKEN` / `MARS_TOKEN_FILE` / `MARS_ROLE` / `--token` / `--role` 语义**逐字保持**；优先级规则从"两处各写"变成"两个 provider 各自声明" |

**为什么不把授权一起放进端口**：`authz.js` 已是纯函数（`authorize(principal, {...})`），无 I/O，且被 7 个模块调用。
为它加端口只会多一层转发。**授权留在域内**，身份通过端口进入域。

---

### P3 `SessionSource` — 会话数据源

| 项 | 内容 |
|---|---|
| 解决 | H-05、H-06 |
| 准入 | A（DSH 真实源 + 合成 fixture 源 = 2 个实现）+ B（必须能造测试数据） |
| 方法 | `kind()` · `sniff(bytes)` · `parse(input)` |
| 输入 | `parse({ bytes, ref })`；`ref` 只用于填入 `path` 字段与审计，不做 I/O |
| 输出 | `SessionUsage`（见 §4.1 数据契约） |
| 错误 | `SESSION_CORRUPT`、`SOURCE_UNSUPPORTED`、`SESSION_EMPTY`（无任何 usage 事件时由调用方决定是否警告，不由端口决定） |
| 生命周期 | 无状态；同一实例可并发调用（纯函数） |
| 同步性 | **同步且纯**。读取文件的责任移到调用方（CLI）或适配器的 `read(path)` 便捷方法 |
| 资源所有权 | 不持有 `Buffer`；返回全新对象树 |
| 依赖方向 | 适配器 → 端口；域（ledger 的汇总/对账/CSV）→ 端口 |
| 测试替身 | `SyntheticSessionSource`（用现有 `mars/tests/fixtures/ledger/make-session.js` 造字节） |
| 兼容性 | `rds ledger --session <path>` 参数、输出 JSON 字段、CSV 表头与列序**全部不变** |
| 注册 | `SessionSourceRegistry`：`register(source)` / `resolve(kind?)` / `list()`；**只有 1 个生产源**，注册在组合根 |

**只有一个生产源，为什么还要端口？**
不是为了"将来可能有别的宿主"，而是为了三件当下就成立的事：
① 把 `source_kind` 从契约里的 `const` 变成可枚举值（否则第二种数据永远进不来，见 H-05）；
② 把 ledger 的 I/O 与计算分开，从而让 `ledger` 命令不再需要数据库（H-06）；
③ 让测试能造"损坏帧""缺字段""空会话"这类输入而无需真实文件。
若只为 ①，改契约即可；三者合起来才构成建端口的理由。

**明确不做**：不做"自动探测所有已知格式"的插件注册表。`--source <kind>` 缺省时，按注册顺序 `sniff`，唯一命中即用；多命中或无命中都报 `SOURCE_UNSUPPORTED` 并列出候选 `kind`。

---

### P4 `AuditSink` — 审计出口

| 项 | 内容 |
|---|---|
| 解决 | H-06（让 ledger 不依赖 DB）、H-07（审计里的 principal 可信） |
| 准入 | A（DB sink / Null sink = 2 个实现） |
| 方法 | `record(event)` |
| 输入 | `{principal_id, project_id, role_id, action, target, result, reason}` |
| 输出 | 无返回值 |
| 错误 | **实现不得抛出**。契约写明：审计失败只允许写 stderr 一次（去重），不得影响调用结果 |
| 生命周期 | 由组合根创建，与进程同寿命 |
| 同步性 | 同步（写一行 SQLite；现有做法） |
| 资源所有权 | 持有组合根传入的 db 句柄，**不负责关闭** |
| 依赖方向 | 适配器 → 端口；域 → 端口 |
| 测试替身 | `MemoryAuditSink`（数组收集，测试断言条数与 result） |
| 兼容性 | `audit` 表结构与写入字段不变；现有"审计永不阻断"的 try/catch 语义上移到端口契约 |

**这条端口同时解决一个隐蔽问题**：现在 `audit()` 是 `db.js` 的导出，被 7 个模块直接调用，导致"想写审计就必须有 db"。
改用端口后，`store`/`compiler` 收到的是 sink，而不是 db —— 这也是 B5 拆分 `db.js` 的前置条件。

---

### P5 `HostRegistry` — 外部产品的注册表

| 项 | 内容 |
|---|---|
| 解决 | H-04（唯一 S1 之一） |
| 准入 | A（DSH registry / 无宿主 = 2 个实现）+ C（写外部产品状态） |
| 方法 | `detect()` · `list()` · `backup()` · `removeByPrefix(prefix, {dryRun})` |
| 输入 | 路径来自组合根（`RDS_HOST_REGISTRY` 或探测结果），**不由适配器自行猜测** |
| 输出 | `detect()` → `{present, path, format, writable}`；`list()` → `[{name, opaque:true}]`（**只暴露 name，不暴露原始条目**）；`removeByPrefix` → `{removed, kept, backupPath, changed}` |
| 错误 | `HOST_REGISTRY_NOT_FOUND`、`HOST_REGISTRY_INVALID`、`HOST_REGISTRY_READONLY`、`HOST_WRITE_REFUSED`（dryRun=false 但未显式确认） |
| 生命周期 | 每次调用现读现写，不缓存（外部文件可能被对方进程改动） |
| 同步性 | 同步（小文件） |
| 资源所有权 | 适配器独占"格式"；调用方 **只能看到 name**，拿不到内部结构 |
| 依赖方向 | 适配器 → 端口；调用方（脚本/CLI）→ 端口 |
| 测试替身 | 临时目录里的 JSON 夹具；`NullHostRegistry`（全部方法返回 `NOT_FOUND`） |
| 兼容性 | `mars-mcp-disable.ps1` 的 `-Registry` / `-BackupDir` / `-Yes` 参数与"默认 dry-run"语义保持；PS 脚本改为转调 Node 实现（与 M2 的 `mars-rollback.ps1` 同一模式） |

**为什么必须收口到端口**：现在是 PowerShell 用 `ConvertFrom-Json`/`ConvertTo-Json` 整文件重写外部配置，
既无版本号、也无原子写、也无"格式变了就停手"的检测。适配器可以做三件脚本做不到的事：
① 写入前记录文件哈希与格式版本；② 写临时文件再 `rename`（原子替换）；③ 识别到未知顶层键就拒绝写入而不是静默丢弃。

---

## 4. 数据契约

### 4.1 内部契约 `SessionUsage`

端口之间传递的最小形状（**不是**新文件格式，是内存对象）：

```js
{
  session_id: string,          // 必有；无法从内容推断时由 ref 的文件名兜底
  ref: string,                 // 调用方给的引用（今天的 path），仅用于展示与审计
  source_kind: string,         // 例：'dsh-v4'
  usage_events: number,        // 参与累加的事件条数
  usage: { input, output, cacheRead, cacheWrite, total },  // 全为非负整数
  model?: string,
  provider?: string
}
```

约束：

- 五个 usage 字段**必填且非负整数**；缺失按 `0`，不做推断（沿用 `toInt()` 的语义，`ledger.js:76-80`）。
- `total` 允许为 0 且 input/output 非 0 —— 由上层的 `buildLedger` 记 `warning`，端口不判断"合理性"。

### 4.2 对外契约 `ledger.schema.json` 的最小改动

| 位置 | 现在 | 改为 | 兼容性 |
|---|---|---|---|
| `:11` `source` | `{"const": "dsh-session"}` | `{"type":"string","pattern":"^[a-z0-9][a-z0-9-]{0,31}$"}` | 旧数据仍通过（`dsh-session` 匹配） |
| `:22` `source_kind` | `{"const": "dsh-session"}` | 同上 | 同上 |
| 新增 `contract_version` | 无 | `{"const":"0.2.0"}`，**可选字段** | 不设为 required，旧账本仍可校验 |

**为什么不用 `enum`**：`enum` 每加一个源就要改契约并升版；`pattern` 只约束形状，语义由运行时注册表保证。
代价是"拼错 kind 也能过 schema"——用一条测试兜住（`source_kind` 必须在注册表 `list()` 内）。

**为什么不升 `version`（`:9` 仍 `"0.1.0"`）**：放宽校验不改变任何已有字段的含义，不需要数据迁移；
新增的 `contract_version` 是给未来用的锚点。若评审要求更严格，改为 `enum` + `version: 0.2.0` 也可接受，代价是每次加数据源都要升版。

### 4.3 配置快照

组合根产出只读快照（不落盘）：

```js
{
  root,                       // 安装根
  db, principals, routing,    // 绝对路径
  allowedRoots: string[],     // source_ref 守卫用
  identity: {source, role},   // 仅记录来源，不含 token
  hostRegistry: {present, path} | null
}
```

**不含 token 本身**。token 只在 `IdentityProvider` 内部短暂存在，解析成 principal 后即丢弃。

---

## 5. 错误模型

### 5.1 现状问题（证据）

- 48 个不同错误码靠 `throw new Error('CODE detail')` 传递（`grep` 全量统计）。
- 对外映射靠正则前缀匹配，且**两份**：`mcp.js:27`（14 个码）与 `mcp-stdio.js:320`（20 个码）。
- 差集 6 个码在旧网关退化为 `INTERNAL_ERROR`（详见 H-10）。

### 5.2 设计

新增 `mars/src/errors.js`（域内，无 I/O，无依赖）：

```js
class AppError extends Error {
  constructor(code, detail)   // code 必须是 PUBLIC_CODES 成员，否则构造即抛
}
const PUBLIC_CODES: ReadonlySet<string>   // 唯一真相
function toPublicCode(err): string        // AppError.code | 旧式前缀匹配 | 'INTERNAL_ERROR'
function isPublicCode(code): boolean
```

规则：

1. **`PUBLIC_CODES` 是唯一真相**。`mcp.js` 与 `mcp-stdio.js` 都调 `toPublicCode`，删除各自的白名单。
2. **旧写法继续可用**：迁移期 `throw new Error('PROJECT_DENIED')` 仍被前缀匹配识别；逐批改成 `AppError`，不改外部行为。
3. **只增不减**：删除一个对外错误码属破坏性变更，必须升 `contract_version` 并在 CHANGELOG 登记。
4. **分类前缀**（仅用于阅读与分组，不参与匹配）：`AUTH_*` / `MEMORY_*` / `SESSION_*` / `HOST_*` / `ASSET_*` / `RATE_*` / `ROUTING_*` / `INTERNAL_*`。
5. **对外错误码不含细节**：`detail` 只进日志/审计，不进 MCP 响应（沿用 `mcp.js:28` 的"绝不回显路径和 SQL"）。

**网络与栈信息**：`toPublicCode` 之外的一切都是 `INTERNAL_ERROR`，与今天一致。

### 5.3 与退出码的关系

CLI 退出码是外部契约，**不变**：

| 场景 | 码 |
|---|---|
| 成功 | 0 |
| 用法错误 / 参数缺失 | 2 |
| 认证或授权失败 | 3 |
| 业务错误（catch 内 `die(err.message, 4)`） | 4 |
| MCP 默认禁用 | 5 |
| Node 版本过低 | 78 |

---

## 6. 明确拒绝的抽象（并说明为什么）

这一节是"不为抽象而抽象"的证据。每一条都评估过，结论是不做。

| 候选 | 拒绝理由 | 若将来要重新评估的条件 |
|---|---|---|
| `FileSystem` 端口 | 9 个模块、约 25 处 `fs.*` 调用；注入会让所有函数多一个参数，收益是"能在内存里跑测试"——但现有测试已用 `os.tmpdir()` 达到同样效果，且更快暴露真实 I/O 问题 | 需要 WebAssembly / 浏览器环境运行时 |
| `Clock` 端口 | 只有 `ledger.generated_at` 与 `nowIso()` 依赖时间；测试断言形状而非绝对值，已有 88 例全绿 | 需要"重放一段历史时间线"的回归测试时 |
| `IdGen` 端口 | `newId(prefix)` 用 `crypto.randomBytes`，测试靠"格式匹配"而非固定值 | 需要字节级可复现的 packet 快照时（届时优先做 golden 快照而非端口） |
| `Logger` 端口 | 当前没有日志设施：stdout 是协议输出，stderr 只用于致命错误。加端口等于新造需求 | 出现"需要按级别过滤的诊断输出"的真实需求 |
| 通用 `PluginLoader` | 见 §3 准入规则；动态加载会引入打包遗漏与信任问题 | 出现第三方适配器生态（当前明确不做） |
| 把 `authz` 包成端口 | 已是纯函数，无 I/O | 出现"外部授权服务"需求（与本地优先冲突，暂不考虑） |
| 统一 `Repository` 层包住 SQL | `db.js` 的 SQL 已被 9 个模块以 `db.prepare(...)` 直接使用；包一层会复制 200 行 SQL 且无收益 | 需要换存储引擎时（届时是重写，不是抽象） |

---

## 7. 七个重点设计问题的回答

### Q1 Ledger 是否应完全独立于 MCP？

**是，而且它今天在模块层面已经独立**（`ledger.js` 零本地 `require`），问题只在两处：

1. **CLI 把它和数据库绑在一起**（`cli.js:114` 先 `openDb`）→ B3 用 `AuditSink` 解掉，ledger 变成"读文件 → 纯计算 → 输出"；
2. **契约用 `const` 锁死单一数据源**（`ledger.schema.json:11,22`）→ B3 放宽。

**M3 不把 ledger 暴露为 MCP 工具**。理由：MCP 工具面是对外契约，新增工具要同步 5 个客户端的文档与测试；而 ledger 是"事后核算"，属本地运维动作，CLI 足够。若将来要暴露，走独立的 `ledger.summary` 只读工具，不复用 `memory_*` 命名空间。

### Q2 MCP 注册表是否应依赖宿主适配层，而不是直接读宿主全局状态？

**是。但先纠正一个事实：RDS 今天没有"自己的 MCP 注册表"。**
它做的是**改写另一个产品的注册表文件**（`mars-mcp-disable.ps1:6` 指向 `~/.dsh/skill-mcp-manager/registry.json`）。这比"读宿主全局状态"更糟：它写。

设计：`HostRegistry` 端口（P5）+ `DshRegistryAdapter`。
- RDS 侧只表达"移除名字以 `mars-` 开头的条目"这一意图；
- 格式、备份、原子写、未知字段拒绝，全在适配器内；
- 无宿主时用 `NullHostRegistry`，命令返回 `HOST_REGISTRY_NOT_FOUND` 而不是"文件不存在"这种无从处理的错误。

另有一件事必须说清：**MCP 服务本身的注册不由 RDS 完成**。`docs/install.md` §9 给的是用户自己往客户端 `mcp.json` 里加一段配置，RDS 不碰任何客户端全局配置。这个边界是对的，M3 保持。

### Q3 DSH 解析是否应独立为可替换的数据源适配器？

**是，但只抽一层，不做插件框架。**
- 抽：`SessionSource`（P3）+ `dsh-v4` 适配器；`source_kind` 由契约的 `const` 放宽为 `pattern`；注册表在组合根硬编码。
- 不抽：账本的领域模型（usage 五个字段、对账 1% 阈值、CSV 列序）保持原样——这些是**业务语义**，不随宿主变。
- 不做：自动探测、优先级链、格式版本协商。`--source` 缺省时按注册顺序 `sniff`，多命中即报错（宁可让用户显式指定，也不猜）。

### Q4 身份、权限、数据库、文件系统分别由谁持有？

| 能力 | 持有者 | 传递形式 | 域内可否自行获取 |
|---|---|---|---|
| 身份 | **组合根**（调 `IdentityProvider` 一次） | 冻结的 `principal` 值对象 + `role` 字符串 | 否。域内出现 `process.env` 即违规 |
| 权限 | **域**（`authz.js` 纯函数） | 调用时传入 principal 与 `{project_id, role_id, action, routing}` | 是（它本来就是域的一部分） |
| 数据库 | **组合根**创建句柄，注入 | `db` 句柄（`DatabaseSync` 实例） | 否。域不建连接、不解析路径 |
| 文件系统 | **适配器与入口** | 不出现在端口签名里 | 否。域内禁止 `require('node:fs')` |

一个刻意的例外：`guardSourceRef()`（`util.js:59-84`）用 `fs.realpathSync` 做符号链接逃逸检测。
它是安全函数，且已被 `store.propose` 以 `allowedRoots` 参数注入。M3 **不把它改成端口**（会削弱安全点），
但把它移入"允许 I/O 的域白名单"，并在检查脚本里显式豁免 + 注释原因。

### Q5 如何避免适配层最终变成另一个巨大的上帝模块？

五条规则 + 三条检查，全部可机械判定：

| 规则 | 判定方式 |
|---|---|
| R1 端口准入（§3） | 代码评审 + 本文档的端口清单；新增端口必须在 `host-adapter-design.md` 加一节 |
| R2 单端口 ≤5 方法 | `adapters-selftest`：读取端口模块导出的函数名数量 |
| R3 端口零 import | 同上：端口文件内 `require(` 出现次数 = 0 |
| R4 组合根 ≤120 行且无业务分支 | 行数检查 + `grep -c "if (\|switch" composition.js` ≤ 阈值 |
| R5 域不得 import 适配器 | 静态扫描（A6/A7） |

**为什么不把端口合并成一个 `Host` 接口**：那正是上帝模块的起点。
5 个端口分别对应 5 个**互不相干**的能力，任一能力缺失不应导致其他能力不可用
（例：没有宿主注册表时，记忆功能必须照常工作）。

### Q6 如何保持现有 CLI、MCP 和发行包行为兼容？

**冻结清单**（每批迁移都必须逐条核对，写入 `acceptance-criteria.md`）：

| 面 | 冻结内容 | 验证方式 |
|---|---|---|
| CLI 参数 | 16 个已文档化子命令 + 1 个未文档化的 `orchestrate`（`cli.js:253`），以及所有 `--flag` 拼写 | `rds --help` 输出与基线文本比对；`orchestrate` 的**存在性**必须保持（不因未文档化而删除） |
| CLI 输出 | `put`/`get`/`list`/`search`/`compile` 的 JSON **键集合**与嵌套层级 | golden 快照（键排序后比较，忽略时间/ID 值） |
| CLI 退出码 | §5.3 的 6 个码 | 逐场景脚本断言 |
| MCP 工具集 | 5 个工具名、`inputSchema`、`METHOD_BY_TOOL` 映射 | `tools/list` 响应 JSON 规范化后逐字节比对 |
| MCP 错误码 | 现有 20 个对外码只增不减 | 错误码集合断言 |
| 发行包 | 文件清单（相对路径集合）与总体积 ±5% | `tooling/pack-check.mjs` |
| 安装后行为 | `安装 → doctor → init → put → review → search → compile` | `tooling/ci-smoke.sh` |

**"零变化"的操作定义**：上述七项在 B0 记录为基线文件（`docs/architecture/m3/baseline/`），每批结束用同一脚本重采并 diff；
除"经批准的差异"外，diff 必须为空。

### Q7 如何利用 G1 审查器约束重构中的接口变化？

先说清 G1 现在**能**做什么、**不能**做什么（避免夸大）：

| 能力 | 现状 |
|---|---|
| 审 git diff 的范围/密钥/二进制/删除 | 能（`tooling/git-review/review.ps1`，6 个夹具已验证） |
| 静态分析代码层次 | **不能**，它不是 linter |
| 在 CI 里拦截每个 PR | **不能**，CI 只跑 6 个夹具（`ci.yml` 的 g1 job），不对任意 diff 触发审查 |

因此分两层用：

**第一层（过程门，用 G1 原生能力）**：把"接口面"纳入授权范围。
`core/templates/git-authorization.json` 的 `allowedPaths` 增加：

```json
"mars/contracts/**",
"mars/src/ports/**",
"mars/src/composition.js",
"mars/src/errors.js"
```

效果：任何改动这些文件的 diff，若授权未覆盖，G1 报 `SCOPE-OUTSIDE` 并 fail。
含义是**接口与契约的变更必须单独签发授权**，不能夹带在普通批次里。这正好对应"契约变更三重门"里的第一道。

**第二层（构建门，用 doctor + 测试）**：G1 做不到的静态层次检查，交给
`tooling/layering-check.mjs`（新增）→ 接入 `rds doctor` 的 `layers` 项与 `npm test` 的一个用例。
它检查：端口零 import、域无 `fs`/`env`/`adapters`、组合根行数、端口方法数。

**第三层（人工门）**：`host-adapter-design.md` 本身是契约文档，改动它需要评审。
这与仓库既有做法一致（`mars/docs/interfaces.md` 开头写着"任何接口变更须先改本文件"）。

---

## 8. 端口的测试替身与 fixture 策略

| 端口 | 生产实现 | 测试替身 | fixture 来源 | 是否读盘 |
|---|---|---|---|---|
| AssetResolver | `FsAssetResolver` | `MemoryAssetResolver` | 内联对象 | 否 |
| IdentityProvider | `CliTokenIdentity` / `TokenFileIdentity` | `StaticIdentityProvider` | 内联 principal | 否 |
| SessionSource | `DshSessionSource` | `SyntheticSessionSource` | `make-session.js` 现成生成器 | 否（内存字节） |
| AuditSink | `DbAuditSink` | `MemoryAuditSink` | 无 | 否 |
| HostRegistry | `DshRegistryAdapter` | `TempDirRegistry` / `NullHostRegistry` | 临时目录 JSON | 是（隔离在 tmpdir） |

原则：
1. 替身**不得**读环境变量、不得读仓库文件；
2. 需要真实文件的只有 `HostRegistry`（它本来就是文件格式适配器），且一律用 `mkdtempSync`；
3. 不新增"真实用户数据"类 fixture——现有 `make-session.js` 已证明可以纯合成。

---

## 9. 向后兼容策略（三档）

| 变更类型 | 处理 |
|---|---|
| **新增**端口 / 新增端口方法 / 新增错误码 | 直接做，记 CHANGELOG；不改调用方 |
| **修改**端口方法签名 | 禁止一次性替换。先加新方法（旧方法转调），下一批删旧方法；两批之间对外行为不变 |
| **修改**对外契约（`contracts/*.json`） | 走三重门：① G1 授权覆盖 `mars/contracts/**`；② 契约 hash 登记表更新；③ `acceptance-criteria.md` 的 A5 断言"变更已登记" |

`contract_version` 的用途：只在**破坏性**变更时升（删字段、改语义）。放宽校验不升。
当前的 `const → pattern` 属放宽，不升（但要在 CHANGELOG 写明"校验放宽"这一事实，避免下游误以为数据结构变了）。
