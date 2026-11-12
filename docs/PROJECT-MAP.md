# RDS 与 MARS：结构与改动地图

**性质**：`CURRENT`。改代码前先读这一份。
**回答三个问题**：这个仓库里到底有哪几个东西？代码分成哪几层？改一处会牵动哪里？

---

## 1. 一个仓库，两个东西

```
rds-mother-system
├─ RDS  ── 研发流程资产（Markdown）＋ 统一入口 `rds`
└─ MARS ── 本地记忆与上下文引擎（Node 子系统，位于 mars/）
```

| | RDS | MARS |
|---|---|---|
| 是什么 | 角色卡、工作流、任务协议、证据规范、项目模板 | 记忆存储、检索、上下文编译、Token 账本、MCP 网关 |
| 形态 | Markdown 为主 + 少量 PowerShell 脚本 | Node.js 代码，零第三方依赖 |
| 运行时 | 无。由「会读文件的 AI 会话」或人消费 | 有。`node:sqlite` + FTS5，单进程本地运行 |
| 会不会自己跑 | **不会** | 会（一次 CLI 调用 = 一次完整进程） |
| 入口 | 复制 `core/` 到你的项目，或 `core/scripts/new-project.ps1` | `rds <命令>` |

**常见误解**：以为装完 `rds` 就有了一个自动运转的研发系统。不是。`rds` 命令只驱动 MARS（记忆引擎）；`core/` 里的角色与流程需要人来执行或喂给 AI 会话。

---

## 2. 目录职责

| 目录 | 属于 | 职责 | 进发行包 |
|---|---|---|---|
| `bin/` | 入口 | `rds.mjs`（版本门禁 + 内建命令 + 转交）、`doctor.mjs`、`validate.mjs` | 是 |
| `core/` | RDS | 策略、协议、8 席角色卡、工作流 WF1–WF5、模板、`new-project.ps1` | 是 |
| `stacks/` | RDS | 技术栈适配（`weapp`、`native-bin`），供 `rds validate` 校验 `project.yaml` | 是 |
| `mars/src/` | MARS | 引擎全部实现 | 是 |
| `mars/contracts/` | MARS | 4 份 JSON Schema（memory / context-packet / manifest / ledger）+ role-routing | 是 |
| `mars/config/` | MARS | `role-routing.json`（角色路由）、`principals.example.json`（身份示例） | 是（仅这两个） |
| `mars/tests/` | MARS | 173 项 Required 测试 + External 测试 | **否** |
| `mars/scripts/` | MARS | 运维脚本（备份、回滚、MCP 注册表操作、开发期压测） | **否** |
| `mars/docs/` | MARS | 历史设计与评审记录（40 份） | **否** |
| `tooling/` | 仓库 | 门禁与检查脚本（测试门禁、分层、基线、打包、配置、smoke） | 仅 `manifest/` |
| `tests/` | 仓库 | 母体系结构自检（PowerShell）+ G1 六夹具 | **否** |
| `docs/` | 仓库 | 文档（见 [docs/README.md](README.md)） | 仅 `docs/install.md` |
| `rea/` | RDS | 逆向工程能力基线与六套分析工作流（文档态） | 否 |

**发行包只含运行必需**：`bin/`、`core/`、`stacks/`、`mars/src/`、`mars/contracts/`、两份 config、`tooling/manifest/`、`docs/install.md`、`VERSION`、`CHANGELOG.md`、`README.md`。完整白名单在 `package.json.files`。

---

## 3. MARS 的分层

MARS 的代码不是按「文件类型」分的，是按**依赖方向**分的。这个方向由 `npm run layers` 强制检查（`tooling/layering-check.mjs`）。

```
┌──────────────────────────────────────────────────────────┐
│ L0 入口层                                                 │
│   bin/rds.mjs        版本门禁 / version / doctor / validate│
│                      / test，其余原样转交                  │
│   mars/src/cli.js    33 个 MARS 子命令的分发              │
│   mars/src/mcp-stdio.js  MCP stdio 服务（5 个工具）        │
└───────────────────────┬──────────────────────────────────┘
                        │ 只调组合根
┌───────────────────────▼──────────────────────────────────┐
│ L1 组合根  mars/src/composition.js（82 行，上限 120）      │
│   唯一允许读 process.env 的地方                            │
│   职责：解析路径 → 加载契约 → 冻结配置快照 → 选身份/数据源  │
│        → 返回一个 runtime 对象                            │
└───────┬───────────────────────────────┬──────────────────┘
        │ 注入                            │ 注入
┌───────▼──────────┐          ┌─────────▼──────────────────┐
│ L2 端口（5 个）   │          │ L2 适配器（8 个）           │
│ ports/*.js        │◄─────────│ adapters/*.js               │
│ 零 require        │  实现     │ 唯一碰宿主的地方             │
└───────┬──────────┘          └────────────────────────────┘
        │ 被域模块使用
┌───────▼──────────────────────────────────────────────────┐
│ L3 域（22 个文件）                                        │
│   store / retrieval / compiler / manifest / budget        │
│   authz / sharing / orchestrator / ledger / validate      │
│   db.js（外观）+ db/{schema,ratelimit,stats}               │
│   硬约束：不 require fs / child_process（2 处永久豁免）    │
│            不读 process.env                               │
│            不 require 适配器                              │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│ L4 存储  node:sqlite（内置）+ FTS5 + JSON 文件            │
└──────────────────────────────────────────────────────────┘
```

### 五个端口

| 端口 | 方法 | 隔离的是什么宿主 |
|---|---|---|
| `AssetResolver` | `contract` / `config` / `rootPath` | 契约文件从哪来（文件系统 / 内存 / 测试替身） |
| `IdentityProvider` | `resolve` / `source` | 凭证从哪来（`--token` / `MARS_TOKEN` / token 文件） |
| `SessionSource` | `kind` / `sniff` / `parse` | 会话数据源（当前只有 DSH v4） |
| `AuditSink` | `record` | 审计写到哪（SQLite / 空实现） |
| `HostRegistry` | `detect` / `list` / `backup` / `removeByPrefix` | 外部宿主注册表（DSH 的 MCP 配置） |

端口准入规则（三条至少满足一条）：≥2 个真实实现、需要测试替身、存在安全边界。每端口 ≤5 个方法，端口之间零依赖。

**刻意不做的抽象**（不是遗漏）：`FileSystem`、`Clock`、`IdGen`、`Logger`、`PluginLoader`、把 `authz` 包成端口、`Repository` 层。理由见 [architecture/m3/host-adapter-design.md](architecture/m3/host-adapter-design.md) §3。

### 分层检查规则（`npm run layers`）

| 规则 | 内容 | 当前状态 |
|---|---|---|
| L1 | 端口模块零 `require` | 通过 |
| L2 | 单端口方法数 ≤ 5 | 通过（最大 4） |
| L3 | 域模块不得 `require` fs / child_process | 通过，2 条永久豁免（`util.js` 的原子写与符号链接逃逸检测、`cli.js` 的输出 I/O） |
| L4 | 域模块不得读 `process.env` | 通过 |
| L5 | 域模块不得 `require` 适配器 | 通过 |
| L6 | 组合根 ≤ 120 行 | 通过（82 行） |
| L7 | `mars/src` 内无循环依赖 | 通过 |

豁免登记在 `tooling/layering-check.mjs` 的 `ALLOW` 数组，标注 `until: 'permanent'` 与理由。**不允许新增条目**。

---

## 4. 一条记忆的生命周期

```
rds put ──► store.propose ──► memories 表 (status=proposed)
                                    │
                                    │  rds review --decision approved
                                    │  （必须换一个身份；同 principal 自审被拒）
                                    ▼
                              status=approved
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        rds search            rds compile           rds audit
     （只返回 approved）   （retrieval + manifest  （谁在什么时候
                            + budget → packet      读了什么）
                            + manifest 哈希）
```

关键约束：

- **写入不等于生效**。`proposed` 不进上下文。
- **审批必须换身份**。`SELF_REVIEW_DENIED` 是设计行为，不是 bug。
- **检索只返回 `approved`**。刚 `put` 完 `search` 查不到，是正常的。
- **编译产物带 manifest 与哈希**，可复现。

数据流涉及的模块：`store` → `retrieval` → `manifest` → `budget` → `compiler`，全部经 `authz` 校验，全部写 `audit`。

---

## 5. 改动影响面

改一处之前，先看这张表。

| 你想改 | 主要文件 | 会牵动 | 必须同步 |
|---|---|---|---|
| 新增上下文/协作能力 | `mars/src/projects.js`、`context-budget.js`、`context-ops.js`、`collab.js`、`adapters/fs-project-roots.js` | DB Schema（只加表/列）、`cli-help.js`、基线 packFiles、M9–M11 文档 |
| 新增执行层能力（Agent/Run） | `mars/src/runtime/agent-runtime.js`、`chain.js`、`handoff.js`、`locks.js`、`reliability.js`、`policy.js`、`task-types.js`；适配器 `provider-*`、`fs-tool-executor` | run 状态机、run_events、agent_usage、组合根装配 | `cli-agent.js`、帮助、基线 packFiles、`docs/agents.md` |
| 新增/修改 REA 工作流 | `mars/src/adapters/rea/w0*.js`、`registry.js` | workflow 接口（schema/preflight/execute/render）、四值状态、`rea_runs` | `cli-rea.js`、`docs/rea.md`、任务类型的 workflows 白名单 |
| 改 Provider 协议 | `mars/src/adapters/provider-*.js`、`ports/model-provider.js` | 能力清单 8 个布尔键、usage_source 三值、重试判定 | 契约测试、`agent providers`、`docs/agents.md` |
| 新增一个 CLI 子命令 | `mars/src/cli.js`（`KNOWN_COMMANDS` + 分发分支）、`bin/rds.mjs`（内建命令表） | 顶层帮助文本、`docs/architecture/m3/baseline/cli-help.txt`、`exit-codes.json` | 帮助文本、基线、CHANGELOG |
| 改 CLI 参数或输出形状 | 对应域模块 + `cli.js` | **公开契约**：`cli-json-keys.json` 基线、`docs/install.md` 示例、下游脚本 | 基线登记（`approved-additions.json`）→ 需授权 |
| 改数据库表结构 | `mars/src/db/schema.js`（`SCHEMA_VERSION` + `migrate`） | 旧库兼容、`DB_SCHEMA_NEWER` 分支、备份恢复 | `docs/versioning.md`、迁移说明、测试 |
| 改数据契约 | `mars/contracts/*.json` | `contracts-sha256.json` 基线、`ledger` 的契约校验、MCP 工具 schema | `approved-additions.json.contractChanges` 登记 |
| 改 MCP 工具面 | `mars/src/mcp-stdio.js`（`TOOLS`） | `mcp-tools.json` 基线、客户端兼容 | 需授权（公开接口） |
| 改角色路由 | `mars/config/role-routing.json` | 授权判定、检索过滤、编译预算 | 重启 MCP（配置是启动快照） |
| 新增宿主耦合 | 新建 `mars/src/adapters/*.js` + 端口 | 分层检查、`pack-files.txt` 基线 | `approved-additions.json.packFiles` 登记 |
| 改 RDS 流程资产 | `core/**` | 结构自检（必需文件清单）、`npm pack` 内容 | `tests/self/run.ps1` 的 `$required` |
| 改测试 | `mars/tests/**` | 门禁计数（`tests` 只许升不许降） | `docs/testing.md` 的分类说明 |

**红线**（改了就破坏对外兼容）：

1. 已有子命令的参数名与语义
2. JSON 输出的键名与嵌套形状
3. 退出码语义（2 用法错误 / 3 认证失败 / 4 运行期失败 / 5 策略拒绝）
4. 错误码拼写（在 `mars/src/errors.js` 的 `PUBLIC_CODES` 里）
5. MCP 工具名与必填字段
6. `SCHEMA_VERSION` 只升不降

---

## 6. 命名约定

| 前缀 / 形态 | 含义 | 例 |
|---|---|---|
| `*_UNAVAILABLE` | 依赖的资产/配置缺失或不可读 | `ROUTING_UNAVAILABLE`、`ASSET_MISSING` |
| `*_INVALID` | 输入或数据形状不合法 | `LEDGER_CONTRACT_INVALID`、`HOST_REGISTRY_INVALID` |
| `*_DENIED` | 授权拒绝 | `AUTH_DENIED`、`SELF_REVIEW_DENIED` |
| `DB_*` | 数据库生命周期 | `DB_OPEN_FAILED`、`DB_SCHEMA_NEWER` |
| `*_UNSUPPORTED` | 能力不存在（而非输入错误） | `ZSTD_UNSUPPORTED`、`SOURCE_UNSUPPORTED` |

错误码的唯一真相是 `mars/src/errors.js` 的 `PUBLIC_CODES`。新增错误码必须同时登记到行为基线（`approved-additions.json.errorCodes`）。

---

## 7. 相关文档

- 安装与使用：[install.md](install.md)
- 排障：[install.md](install.md) §12「故障排查」
- 测试与门禁：[testing.md](testing.md)
- 版本维度：[versioning.md](versioning.md)
- 设计意图（端口为什么是这五个）：[architecture/m3/host-adapter-design.md](architecture/m3/host-adapter-design.md)
- 分层检查实现：`tooling/layering-check.mjs`
