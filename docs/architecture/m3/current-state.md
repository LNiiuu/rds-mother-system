# M3-1 现状：RDS / MARS 的真实架构与依赖

**阶段**：M3-1（只读调查 + 接口设计），不包含任何代码改动
**基线**：commit `51a562e`（= `origin/main`），工作区 51 项原有未提交工作未触碰
**调查时间**：2026-11-08
**证据等级**：E1 = 本次实跑；E2 = 读码 + 行号可核对；E3 = 静态推断，未运行

> 本文只写能从代码、配置、测试或实际命令输出中证实的内容。无法证实的一律标 `待确认`。

---

## 0. 文档地图

| 文件 | 回答什么 |
|---|---|
| `current-state.md`（本文） | 现在由什么组成、谁依赖谁、哪些是真实可运行的 |
| `coupling-map.md` | 14 个宿主耦合点，逐条给 file:line 与等级 |
| `host-adapter-design.md` | 5 个端口、数据契约、错误模型、以及**拒绝**了哪些抽象 |
| `migration-plan.md` | B0–B5 六批，每批"对外零变化" |
| `acceptance-criteria.md` | 每批可机械判定（0/1）的退出条件 |
| `risk-and-rollback.md` | 风险、回滚粒度、停止条件 |

---

## 1. 一句话现状

RDS 是**一套 Markdown 流程资产 + 一个可独立运行的 Node 记忆引擎（MARS）**。MARS 的模块依赖是干净的（无环、无第三方依赖、无网络），
真正的耦合不在模块之间，而在**四类边界**上：资产定位、配置解析、外部产品状态、数据源语义。

---

## 2. 组成与规模（E1）

```
<repo root>         安装位置由 RDS_HOME 或包自身路径决定，不假设盘符
├── core/            流程资产：角色卡、工作流、策略、模板（Markdown + JSON）
├── stacks/          技术栈说明（weapp / native-bin / …）
├── mars/            MARS 记忆引擎（唯一运行时）
│   ├── src/         15 个 .js，2,741 行 —— 业务实现
│   ├── scripts/     10 个 .js + 4 个 .ps1，1,017 行 —— 运维/验证脚本
│   ├── contracts/   5 个 JSON Schema —— 数据契约
│   ├── config/      role-routing.json（契约资产）+ principals.json（本机身份，gitignore）
│   ├── tests/       15 个 .test.js，1,937 行，88 个用例
│   ├── docs/        26 份历史设计与验收记录（含已失效状态，属 M5 清理范围）
│   └── var/         运行时数据库与产物（gitignore）
├── bin/             547 行 —— rds 统一入口 + doctor + validate
├── tooling/         测试门禁、配置校验、发行包检查、G1 审查器
├── docs/            install / testing / checks / history / architecture（本目录）
└── .github/         CI：windows + ubuntu × node 22/24
```

| 指标 | 值 | 来源 |
|---|---|---|
| 运行时模块 | 15 个 `.js` / 2,741 行 | `wc -l mars/src/*.js` |
| 第三方运行时依赖 | **0**（`dependencies` / `devDependencies` 均未定义） | `package.json` |
| 网络调用 | **0**（`mars/src` 内无 `fetch` / `http.request` / `net`） | 全目录 grep |
| Required 测试 | **88 pass / 0 fail / 0 skipped** | `node tooling/test-gate.mjs`（E1，本次实跑） |
| 发行包 | 87 文件 / 77,362 B | `docs/checks/productization/M2.1-release-validation.md` |
| CI | 6 job 全绿 ×2 轮 | `M2.1-ci-validation-report.md` |

---

## 3. 模块依赖图（E2，脚本生成，非手绘）

`require('./x')` 的静态解析结果：

```
                    ┌──────────┐
                    │  bin/    │ rds.mjs（spawn 转交）/ doctor.mjs / validate.mjs
                    └────┬─────┘
                         │ spawn（进程边界，非 import）
                    ┌────▼─────┐
                    │ cli.js   │ ← 唯一聚合入口，import 11 个模块
                    └────┬─────┘
        ┌────────────┬───┴────┬───────────┬──────────┬─────────┐
        ▼            ▼        ▼           ▼          ▼         ▼
   compiler.js   mcp-stdio  mcp.js    orchestrator  sharing  ledger.js
        │            │        │           │          │      （零本地依赖）
        ├────────────┴────────┘           │          │
        ▼                                 │          │
   retrieval.js ── store.js ──────────────┴──────────┘
        │            │
        └────────────┴────────► authz.js ──► util.js
                                    │
                              db.js ┴──────────► util.js
```

被依赖次数（越靠下越"重"）：

| 模块 | 被几个模块依赖 | 定位 |
|---|---|---|
| `util.js` | 8 | 纯函数（sha256 / 时间 / 估算 / 原子写） |
| `db.js` | 9 | 驱动 + DDL + 迁移 + 审计 + 限流 + 统计 |
| `authz.js` | 7 | 身份与授权（纯函数） |
| `store.js` | 4 | 记忆读写与可见性 |
| `validate.js` | 3 | JSON Schema 子集，无依赖 |
| `ledger.js` | 1 | **零本地依赖**，只 require `fs/path/zlib` |

**结论**：没有循环依赖。`ledger.js` 在模块层面已经是最孤立的一个——它的问题不在 import，而在语义（见 H-05）。

---

## 4. 四种运行形态（E1/E2）

| 形态 | 入口 | 身份来源 | 数据库 | 说明 |
|---|---|---|---|---|
| CLI | `bin/rds.mjs` → `mars/src/cli.js` | `--token` > `MARS_TOKEN` | `--db` > `MARS_DB` > `mars/var/mars.db` | 每个命令一个进程 |
| MCP stdio | `node mars/src/mcp-stdio.js` | `MARS_TOKEN_FILE` + `MARS_ROLE`（**进程级绑定**） | `MARS_DB` | 单一 principal + 单一角色，调用方无法指定 |
| 旧网关 | `rds mcp --enable` → `mars/src/mcp.js` | 每个请求带 `token` | `--db` | **默认禁用**，文档标注为"另一套实现" |
| 库调用 | `require('mars/src/*')` | 由调用方传入 `principal` | 由调用方传入 `db` | 测试与实际脚本走这条路 |

**两套 MCP 实现并存**是既成事实：`mcp.js`（160 行，请求级 token）与 `mcp-stdio.js`（439 行，进程级绑定）。
它们的错误码白名单已经漂移（H-10），但工具集语义一致（5 个方法同名同参）。

---

## 5. 数据流：一条记忆的生命周期（E2）

```
propose ──► memories(proposed) + memories_fts + audit
   │            ▲
   │            │ canRead 过滤（项目 + 角色 + 可见性 + 过期）
review ──► approved / rejected（自审被 SELF_REVIEW_DENIED 拦截）
   │
retrieve ──► FTS5 + 别名 + 共享记录 ──► compiler ──► packet + manifest + fragments
                                                          │
                                                    restoreFragment 可还原原文
```

关键不变量（现有测试已覆盖，迁移中必须保持）：

1. `proposed` 永不进入正式上下文（`retrieval` 只取 approved）。
2. `SELF_REVIEW_DENIED`：写入者不能审批自己的记录（`store.js:187`）。
3. `schema_version = 4`，迁移**只增不改**（`db.js:156-163`）。
4. 审计永不阻断调用（所有 `audit(...)` 外层都有 try/catch）。

---

## 6. 配置与资产的真实来源（E2）

| 资产 | 解析方式 | 位置 |
|---|---|---|
| 数据契约 5 个 schema | 模块加载期 `fs.readFileSync` | `store.js:10`、`compiler.js:14`、`manifest.js:10` |
| 角色路由 | 构造参数 > `MARS_ROUTING` > 默认路径 | `cli.js:42`、`mcp-stdio.js:419`、`store.js:19` |
| 身份 | `--token` / `MARS_TOKEN` / `MARS_TOKEN_FILE` | `cli.js:56`、`mcp-stdio.js:32-43` |
| 数据库 | `--db` / `MARS_DB` / 仓库内 `var/mars.db` | `cli.js:40`、`mcp-stdio.js:417`、`doctor.mjs:192` |
| 允许根（source_ref 守卫） | `MARS_ALLOWED_ROOTS` > 仓库父目录 | `cli.js:46-50` |

**注意**：上表四行的默认值都写成 `path.join(ROOT, ...)`，而 `ROOT = path.resolve(__dirname, '..')` 在 6 个模块里各写一遍
（`cli.js:15`、`compiler.js:13`、`manifest.js:8`、`mcp-stdio.js:20`、`mcp.js:12`、`store.js:9`）。
这既是"安装位置耦合"，也是"发行包白名单必须手工覆盖运行时资产"的根因（H-01 / H-13）。

---

## 7. 文档与代码的三处不一致（E2）

| 文档声明 | 代码事实 | 影响 |
|---|---|---|
| `mars/docs/interfaces.md`："ledger 仅依赖 util" | `ledger.js` 不 require 任何本地模块（连 util 都没用） | 低，仅误导 |
| `docs/install.md` §9："旧网关是另一套 JSON-RPC 实现" | 属实，但未说明两者错误码不一致 | 中，接入方会踩 |
| `mars/docs/architecture.md` 描述的 Phase 1 状态 | 部分已过期（M1/M2/M2.1 已改变入口与测试形态） | 中，属 M5 清理 |
| `cli.js:66` 的 usage 列 16 个子命令 | 实际实现 **17 个**——`orchestrate`（`:253-297`）从未写进 usage | 低，但会让人以为该功能不存在 |

本次不修改上述文档——M3-1 只新增设计材料，状态类文档的更新属于 M3 各批的"文档同步"步骤。

---

## 8. 真实可运行的边界（E1）

本次实际执行过的命令与结果：

```
node tooling/test-gate.mjs        → GATE PASS  tests=88 pass=88 fail=0 skipped=0
node -e "openDb(tmp)"             → openDb 后文件存在: true   （顺带证实 openDb 有创建副作用）
```

未在本次执行、因此不能声称"已验证"的：

- MCP stdio 的端到端调用（本次只读码；上一轮 M2.1 验证过，但不在本次证据内）
- 发行包在干净目录的安装（同上，证据在 `M2.1-release-validation.md`）
- macOS 上的任何行为（**从未验证**，E3）

---

## 9. 由此得出的设计约束

1. 模块图是干净的，**不要动依赖结构**；只动"边界上的取值方式"。
2. `db.js` 被 9 个模块依赖 —— 拆分它必须是最后一批，且只做"文件内职责切分"，不改任何 SQL。
3. `ledger.js` 已经零依赖 —— 它的改造是"把 I/O 拿出来"，不是"把模块拆开"。
4. 两套 MCP 并存 —— 新的错误模型必须**同时**喂给两者，否则漂移会继续。
5. `core/` 没有任何运行时代码 —— 不要为它发明接口（"RDS Core"目前是提示词资产，不是可执行边界）。
