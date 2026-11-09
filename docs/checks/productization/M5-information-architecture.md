# M5-B1 文档信息架构报告

**日期**：2026-11-09（+08:00）
**批次**：M5-B1
**起点**：`9c0d1e3`（B0 审计提交）
**终点**：本批次提交
**性质**：只新增索引与改写根 README。**未移动、未删除、未改写任何历史证据。**

---

## 1. 要解决的问题

B0 审计给出三条事实：

| 事实 | 数据 |
|---|---|
| `docs/` 没有入口 | 113 个文件，0 个 `docs/README.md` |
| 文档之间几乎不互链 | 165 个 md，**5** 个相对链接 |
| 四类内容混放 | 正式文档 4 份、架构设计 6 份、验收证据 74 份、历史材料 19 份，同一层级无标记 |

后果：一个没参与过 M1–M4 的开发者打开仓库，能读到 README 的「5 步跑通」，但读不到「为什么这样分层」「哪些结论还成立」「改一处会坏什么」。他只能靠 `ls` 猜。

这不是「文档写得不好」，是**没有导航结构**。

---

## 2. 设计

### 2.1 先分类，再导航

信息架构的第一步不是建目录，是**让读者知道自己在读什么**。四类文档的可靠性完全不同：

| 类型 | 会随代码更新吗 | 读错会怎样 |
|---|---|---|
| 正式文档 `CURRENT` | 会 | 不会错 |
| 架构设计 `DESIGN` | 部分 | 可能把「设计目标」当成「已实现」 |
| 验收证据 `EVIDENCE` | 不会 | 可能把三个月前的数字当成当前数字 |
| 历史材料 `HISTORICAL` / `LOCAL` | 不会，且不在版本库 | 可能引用一个干净克隆里不存在的文件 |

因此 `docs/README.md` 的第一节不是目录，是**分类表 + 状态图例**。

### 2.2 三条阅读路径，而不是一份总目录

一份 74 行的总目录对读者没有帮助——他不需要知道全部文件，他只需要知道自己下一步读什么。所以入口按**意图**分三条：

| 意图 | 路径 |
|---|---|
| 装起来用 | `install.md` → `install.md §12 故障排查` → `rds doctor` |
| 改它 | `PROJECT-MAP.md` → `testing.md` → `versioning.md` → `host-adapter-design.md` → `PROJECT-MAP.md §5 改动影响面` |
| 核对它可信吗 | `checks/README.md` → `checks/productization/` → `architecture/m3/baseline/` |

每条路径都明确写「**不需要**读什么」。例如「装起来用」这条直接说：不需要读 `core/`、`mars/docs/`、`docs/checks/`。这比列出一堆「可选阅读」有用。

### 2.3 用索引区分，而不是移动文件

**为什么不做目录重组（如 `docs/current/`、`docs/evidence/`、`docs/archive/`）**：

| 方案 | 收益 | 代价 |
|---|---|---|
| 移动文件到分类目录 | 结构直观 | ① 破坏所有既有引用与外部书签；② `docs/checks/git-review/run-*` 共 36 个文件是 G1 审查的原始产物，路径写在其 `review-report.json` 里，移动即自相矛盾；③ 51 项未跟踪材料中有 19 项在 `docs/` 下，移动会改变「受保护工作」的路径指纹；④ `docs/` 下 11 个文件含本机绝对路径，移动不解决污染，只改变污染位置 |
| **原地保留 + 索引标注** | 零破坏，读者仍能按性质分流 | 需要读者先读索引（成本：一次点击） |

选后者。**证据的价值在于「原样」**，路径本身就是证据的一部分。

### 2.4 「已知失效」单列一节

这是本次设计里最关键的一节。四类文档加起来 172 份，其中至少 7 份已知与当前事实不符（`GITHUB.md` 说「未接入」、`mars/README.md` 说「80 用例」、`interfaces.md` 还有已删除的 `ledger.read` 动作）。

处理方式三选一：

| 方案 | 问题 |
|---|---|
| 改写原文改正 | 篡改证据，且抹掉「什么时候变的」 |
| 删除 | 丢失历史 |
| **新增一节集中登记「哪里失效、当前事实是什么、去哪看」** | 读者在入口处就知道，不必读完才发现 |

选第三个。这一节同时是一个**技术债清单**：每一条都是一个待还的账。

---

## 3. 产出

| 文件 | 行数 | 作用 |
|---|---|---|
| `docs/README.md` | 165 | 唯一入口：三条路径、四类定义、状态图例、文档地图、已知失效、维护规则 |
| `docs/PROJECT-MAP.md` | 198 | RDS/MARS 关系、目录职责、五层结构、L1–L7 分层规则、记忆生命周期、改动影响面、红线 |
| `docs/checks/README.md` | 129 | 验收证据索引：按 8 个里程碑分组，逐份标日期/结论/是否仍有效；旧遗留清单 10 项现状 |
| `docs/architecture/README.md` | 60 | 架构文档索引 + 7 个行为基线的比较方式 + 「为什么保留『未实现』标注」 |
| `mars/docs/README.md` | 73 | 40 份子系统文档分四类：仍有参考价值 / 历史评审 / 计划记录 / 机器可读证据 |
| `README.md`（改） | +50/−10 | 补「文档地图」；修正 `export MARS_TOKEN=<…>` 语法错误、CI 链接、`render-role` 表述 |

---

## 4. 结构说明

### 4.1 PROJECT-MAP 的五层图

MARS 的分层不是按文件类型分的，是按**依赖方向**分的。原文用一张 ASCII 图表达：

```
L0 入口      bin/rds.mjs、cli.js、mcp-stdio.js
              ↓ 只调组合根
L1 组合根    composition.js（82 行，唯一读 process.env 的地方）
              ↓ 注入
L2 端口/适配器  ports/*.js（零 require）← adapters/*.js（唯一碰宿主）
              ↓ 被域模块使用
L3 域        22 个文件（不 require fs / 不读 env / 不 require 适配器）
              ↓
L4 存储      node:sqlite + FTS5 + JSON
```

这张图的价值：读者能一眼看出「为什么 `store.js` 里不能 `require('node:fs')`」——因为它在 L3，而 fs 属于 L2 的适配器职责。

### 4.2 改动影响面矩阵

B0 发现文档里没有「改 X 会影响 Y」的说明。`PROJECT-MAP.md` §5 补了一张 9 行的表：

| 改什么 | 牵动什么 | 必须同步什么 |
|---|---|---|
| 新增 CLI 子命令 | `KNOWN_COMMANDS` + 分发分支 | 顶层帮助、`cli-help.txt` 基线、`exit-codes.json` |
| 改 CLI 参数/输出 | 域模块 | `cli-json-keys.json` 基线、install 示例 → **需授权** |
| 改表结构 | `schema.js` | 旧库兼容、`DB_SCHEMA_NEWER`、迁移说明 |
| 改契约 | `contracts/*.json` | `contracts-sha256.json`、`approved-additions.contractChanges` |
| 改 MCP 工具面 | `mcp-stdio.js` 的 `TOOLS` | `mcp-tools.json` 基线 → **需授权** |
| … | | |

外加 6 条**红线**（已有参数名、JSON 键形状、退出码语义、错误码拼写、MCP 工具名、`SCHEMA_VERSION` 只升不降）。

这张表的实际作用：把「我以为只是改个名字」变成「我知道会红几个门禁」。

---

## 5. 验证

| 检查 | 结果 |
|---|---|
| 相对链接可达性 | **156 个链接，0 断链**（B0 时为 5 个链接） |
| 巡检文件数 | 172 个 md（含未跟踪的 19 份历史材料） |
| Required 测试 | `GATE PASS tests=173 pass=173 fail=0 skipped=0` |
| 分层检查 | `LAYERS PASS problems=0 warnings=2` |
| 行为基线 | `BASELINE PASS 7 个面均与基线一致` |
| 配置校验 | `CONFIG PASS json=57 yaml=4` |
| 受保护工作 | **51 项未变**，指纹逐项比对无差异 |
| 发行包 | 108 文件不变（新增的 5 个 md 均在 `files` 白名单外） |

**未做的验证**：没有用浏览器渲染检查排版。Markdown 表格与代码块在 GitHub 上会正常渲染，本地无渲染器，不做无依据的断言。

---

## 6. 故意没做的事

| 没做 | 原因 |
|---|---|
| 移动文件到 `current/` `evidence/` `archive/` | 见 §2.3。破坏引用、破坏证据自指、改变 51 项指纹 |
| 改写 `GITHUB.md` 等失效文档的正文 | 篡改证据 |
| 删除 `docs/history/`（14 份，含原始 session JSONL） | 任务书明令「不删除有历史价值的证据」；且它们是 `LOCAL`，不进包 |
| 给 `mars/docs/` 全部 40 份加状态头 | 会修改历史文件。改为在 `mars/docs/README.md` 集中标注 |
| 建 `docs/quickstart.md` | 属 B2 范围。B1 的入口先指向 `install.md §7`，B2 产出后再回填链接 |
| 建 `docs/maintainer-guide.md` | 属 B5 范围。同上 |
| 加链接检查到 CI | 属 B6 范围（`tooling/docs-check.mjs`） |

**关于「前向引用」**：B1 的文档里没有指向未创建文件的链接。每个批次的文档只引用当时存在的文件，后续批次产出后再回填。这样每一批都可独立验证。

---

## 7. 后续批次要回填的位置

| 批次 | 产出 | 回填位置 |
|---|---|---|
| B2 | `docs/quickstart.md` | `docs/README.md` §1 路径 1、§3.1 表；`README.md` 文档地图 |
| B5 | `docs/maintainer-guide.md` | `docs/README.md` §1 路径 1/2、§3.1 表；`README.md` 文档地图 |
| B6 | `M5-*.md` 七份报告 | `docs/checks/README.md` M5 节 |
| B6 | `tooling/docs-check.mjs` | `docs/README.md` §5 第 5 条；`package.json` scripts |

---

## 8. 一句话结论

信息架构的目标不是「把文档整理整齐」，是**让读者在读之前就知道该不该信它**。四类分离 + 状态图例 + 已知失效清单，都是为了这一件事。
