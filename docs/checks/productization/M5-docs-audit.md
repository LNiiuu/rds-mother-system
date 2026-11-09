# M5-B0 只读基线审计

**日期**：2026-11-09（+08:00）
**批次**：M5-B0
**性质**：只读审计。本批次不修改任何被审计文件、不移动目录、不删除内容。
**起点**：`b89cbb2`（M4 封版点，与 `origin/main` 一致）
**目的**：让「文档能不能让一个新人独立上手」这个问题，从主观判断变成可核对的清单。

---

## 0. 审计方法

| 手段 | 说明 |
|---|---|
| 文件盘点 | `git ls-files '*.md'` + `find docs -type f`，区分「已跟踪 / 未跟踪」 |
| 链接可达性 | 自写脚本扫描 165 个 Markdown 的 Markdown 相对链接（方括号 + 圆括号形式），逐个 `fs.existsSync` |
| 引用一致性 | 扫描反引号包裹的文件名，比对仓库内实际文件 |
| 命令真实性 | 从文档中提取全部 `rds <sub>` 引用，与 `mars/src/cli.js` 的 `KNOWN_COMMANDS` 求差 |
| 行为实测 | 对 19 个命令逐个执行 `--help`，记录真实输出与副作用 |
| 路径卫生 | `rds doctor`（`paths:code` / `paths:docs`）+ 全仓正则交叉验证 |
| 打包实测 | `npm pack --dry-run --json`，比对各文件是否在 git 跟踪内 |

---

## 1. 文档资产盘点

### 1.1 总量

| 范围 | 文件数 | 说明 |
|---|---|---|
| 全仓 Markdown（含未跟踪） | 165 | 扫描链接时的基数 |
| 已跟踪 Markdown | 约 150 | `git ls-files '*.md'` |
| `docs/` | 113 | 含 3 个未跟踪子目录 |
| `mars/docs/` | 40 | Phase 1–P6 的设计、评审与验收记录 |
| `core/` | 46 | 策略、协议、角色、工作流、模板 |

### 1.2 `docs/` 内部分布

| 目录 | 文件数 | 实际性质 |
|---|---|---|
| `docs/` 根 | 6 | 4 份正式文档（`install` / `testing` / `versioning` + 无 README）+ 3 份 M1-0 阶段报告 |
| `docs/architecture/m3/` | 14 | 6 份设计文档 + 7 份行为基线快照 + 1 份 `approved-additions.json` |
| `docs/checks/` | 74 | 验收证据：`productization/` 24、`git-review/` 39、根目录 11 |
| `docs/acceptance/` | 1 | M1-0 验收材料索引 |
| `docs/analysis/` | 1 | **未跟踪**，DSH 运行时核查报告 |
| `docs/history/` | 14 | **未跟踪**，初始部署的完整史料（含 session JSONL） |
| `docs/runs/` | 4 | **未跟踪**，一次角色包渲染的运行记录 |

### 1.3 入口缺口

**A-01｜`docs/` 没有 `README.md`。**
74 份验收证据 + 6 份架构设计 + 3 份阶段报告，没有任何索引。新读者进入 `docs/` 只能看到一堆文件名，无法判断「哪份是当前有效文档、哪份是三个月前的一次性记录」。

**A-02｜文档之间几乎不互相引用。**
165 个 Markdown 文件中，相对链接共 **5 个**。`README.md` 只链接到 `docs/install.md` 与 `docs/testing.md`；从这两份文档出发，无法到达 `docs/versioning.md`、`docs/architecture/m3/`、`docs/checks/` 或 `mars/docs/`。
结论：现有文档是「一堆并列的文件」，不是「一棵可导航的树」。

**A-03｜四类内容混在同一层级，无分类标记。**
正式文档、架构设计、验收证据、历史材料在目录结构上没有区分。`docs/checks/` 里既有 M1 阶段的一次性检查点（`m1-0b-checkpoint.md`），也有 M4 的最终验收（`M4-final-acceptance.md`），二者对读者的价值完全不同。

**A-04｜`mars/docs/` 40 份文件无索引，且「当前架构」与「历史评审」混放。**
`mars/docs/architecture.md`（673 行，Phase 1 架构设计，标注 v1.2）与 `mars/docs/phase1-review.md`、`phase2-review.md` 等同处一层。前者仍部分有效，后者是带日期的一次性评审记录。

**A-05｜根 `README.md` 的「结构」表只到目录级。**
表格列出 `docs/` 之外的目录，但 `docs/` 一行未列（实际是列了 `core/`、`stacks/`、`mars/src`、`tooling/`、`rea/`、`tests/self`，缺 `docs/` 与 `bin/` 之外的全部文档说明）。读者无法从 README 知道 `docs/` 里有什么。

---

## 2. 事实性错误与过期内容

严重度：**S1** 误导到无法使用 / **S2** 可用但结论错误 / **S3** 认知成本 / **S4** 排版瑕疵。

| 编号 | 位置 | 现状 | 实测事实 | 级别 |
|---|---|---|---|---|
| **B-01** | `docs/install.md:71-83` | doctor 样例输出中 `node:sqlite` 出现两次；末尾 `checks=9` | 实际输出 10 项检查，`checks=10`；`node:sqlite` 只出现一次 | S4 |
| **B-02** | `docs/install.md:78` | `paths:code ok 已扫描 41 个代码/配置文件` | 源码树实测 **138**；发行包实测 **62**。41 是 M1 时的数字 | S3 |
| **B-03** | `docs/install.md:270` | 「M3 的改动尚未在任何 CI 上运行」 | M3 与 M4 均已跑过 CI；最新 `run 42583509413` @ `b89cbb2` 全绿 | S2 |
| **B-04** | `docs/install.md:255` | 「`rds upgrade` / `rds uninstall` 尚未实现（路线图 M5）」 | M5 已到，本轮不实现这两条命令。写成「路线图 M5」会让读者以为下个版本就有 | S3 |
| **B-05** | `docs/install.md:189` | 「`rds principal add` ... 属于后续版本（路线图 M5）」 | 同上 | S3 |
| **B-06** | `docs/install.md:182` | `rds review --token (cat $MARS_PRINCIPALS.r4token)` | 该写法不是合法的 bash 参数展开（`(cat …)` 是子 shell，不会作为参数值）。直接复制会得到 `--token` 缺值 | S2 |
| **B-07** | `README.md:83` | CI 链接指向 `run 42583081805` @ `d7cba45` | 最新为 `run 42583509413` @ `b89cbb2`（封版点） | S3 |
| **B-08** | `README.md:86` | 「`render-role` 等投递命令 **未实现**（路线图 M4）」 | M4 已关闭；工作区存在未入库实现 `tooling/agent-runtime/rds-render-role.ps1`。准确表述应为「未纳入仓库与发行包」 | S2 |
| **B-09** | `README.md:32` | `export MARS_TOKEN=<DEV_TOKEN>` | `<` `>` 在 bash 中是重定向符，照抄会报 `syntax error near unexpected token 'newline'` 或创建空文件 | S2 |
| **B-10** | `docs/testing.md:3` | 「适用版本：0.1.0（M2）」 | 已过 M3、M4 两个里程碑 | S4 |
| **B-11** | `docs/testing.md:26` | `npm run verify` = 「doctor + 配置校验 + 门禁」 | `package.json` 实际为 `doctor && config && layers && test`，漏了 `layers` | S3 |
| **B-12** | `docs/testing.md:101` | 「路线图 M3/M5 的范围」 | M3 已完成 | S3 |
| **B-13** | `docs/checks/GITHUB.md` | 「状态：**未接入**（A-07 未执行）」 | 仓库已推送，CI 已真实运行 6 个 job | S2 |
| **B-14** | `mars/README.md` 全篇 | `D:\M1\mars\var\mars.db`、`--project xingrixiao`、`node D:\M1\mars\src\cli.js`、「全量：80 用例」、「Node.js v24」 | 实际 173 用例；路径应参数化；项目名应为 `demo` | S2 |
| **B-15** | `mars/docs/architecture.md` 头部 | 「代码快照 2026-11-03，全量测试 54/54」 | 历史快照，但与当前代码差异已跨越 M1–M4 | S3 |

**B-13 的处理原则**：`GITHUB.md` 是带日期的历史记录，不改写正文。在索引中标注「已被 M2.1 之后的事实覆盖」。

---

## 3. 项目名与机器路径污染

### 3.1 会进发行包的活跃资产（必须修）

| 编号 | 位置 | 内容 | 为什么严重 |
|---|---|---|---|
| **C-01** | `mars/config/principals.example.json:7,14` | `"project_ids": ["xingrixiao", "m1-dev"]`、`["xingrixiao"]` | 该文件在 `package.json.files` 白名单内，**随发行包分发**。等于把某个具体项目名作为「默认示例」发给所有用户，直接违反 README 的三条底线之一「仓库内不得出现具体项目名」 |
| **C-02** | `core/bootstrap/bootstrap.md:5` | 「母体系目录可读（默认 `D:\M1`）」 | `core/` 整目录进包 |
| **C-03** | `core/policies/download.md:4` | 「下载到隔离目录（默认 `D:\Downloads\rds`）」 | 同上 |

### 3.2 不进发行包但属仓库文档

| 编号 | 位置 | 内容 | 处理 |
|---|---|---|---|
| **C-04** | `mars/README.md:20,24,27,28` | `--project xingrixiao`、`--task T-XRX-001`、`D:\M1\…` | 重写为参数化示例 |
| **C-05** | `tests/self/run.ps1:49` | `$forbidden = @('rwgl','星日晓','miniprogram/pages','计划qpp')` | 列表用中文名与旧项目代号，**不含拼音 `xingrixiao` 与 `m1-dev`**，因此 C-01/C-04 从未被自检捕获。这是「检查存在但漏检」 |

### 3.3 检查器盲区

| 编号 | 位置 | 盲区 |
|---|---|---|
| **C-06** | `bin/doctor.mjs:26`（`CODE_EXT` 不含 `.md`）与 `:53`（`excludeDocs` 只排除 `docs/`、`mars/docs/`） | `core/**/*.md`、`mars/README.md`、根 `README.md` **不参与任何路径检查**。C-02/C-03 就是这样漏过的 |
| **C-07** | `docs/` 下 11 个文档含本机路径 | `doctor` 报 `paths:docs warn`。这些是**带日期的证据**（G1 运行报告、AP-12 首次提交记录），改写等于篡改证据 → 处理方式是「归档 + 索引标注」，不是删除或替换 |

---

## 4. CLI 帮助覆盖（实测）

### 4.1 覆盖矩阵

对 19 个命令逐个执行 `rds <cmd> --help`：

| 命令 | `--help` 实际行为 | 判定 |
|---|---|---|
| `init` | **创建/打开数据库并输出 stats** | ❌ 有副作用 |
| `init-dev` | **覆盖 `principals.json` 并打印新 token** | ❌ 有破坏性副作用 |
| `put` / `get` / `list` / `search` / `review` / `alias` / `compile` / `fragment` / `stats` / `audit` | `ERROR 认证失败：TOKEN_MISSING` | ❌ 把帮助请求诊断成凭证问题 |
| `project` / `share` / `orchestrate` | 同上 | ❌ |
| `mcp` | `ERROR MCP 网关默认禁用…`（exit 5） | ❌ |
| `ledger` | 正确的用法说明 | ✅ 唯一完整 |
| `help` | 等同顶层帮助 | ✅ |

覆盖率：**1 / 19 完整**，**1 / 19 顶层**，**17 / 19 无帮助**。

### 4.2 缺陷编号

| 编号 | 缺陷 | 证据 | 级别 |
|---|---|---|---|
| **D-01** | `rds init-dev --help` 忽略 `--help`，直接生成身份并**覆盖已有 `principals.json`** | 实测：执行前 6 个 principal，执行后剩 1 个（`dev-r0`/`demo`）。已从 `D:\M1-backup-20261108-162614` 完整恢复 | **S1**（数据丢失） |
| **D-02** | `rds init --help` 打开/创建数据库并输出统计 | 实测输出 `{"db": "...", "stats": {...}}` | S2 |
| **D-03** | 12 个命令的 `--help` 返回 `TOKEN_MISSING`（exit 3） | 见矩阵 | S2 |
| **D-04** | `rds mcp --help` 返回「网关默认禁用」（exit 5） | 见矩阵 | S3 |
| **D-05** | 只有 `ledger` 有子命令帮助；`project` / `share` / `orchestrate` 的 5+4+6 个子命令无任何帮助 | `rds share bogus` → 需先通过认证才报「未知 share 子命令」 | S3 |
| **D-06** | 顶层帮助未列 `orchestrate`；`project`/`share` 只以并列名出现，未说明其子命令 | `bin/rds.mjs:39` | S3 |
| **D-07** | 两份用法文本已分叉：`bin/rds.mjs:22-47`（完整版，含分类）vs `mars/src/cli.js:83`（简版，**缺 orchestrate**） | 直接跑 `node mars/src/cli.js help` 得到简版 | S3 |

**D-01 的根因**：`bin/rds.mjs` 把除 `version`/`doctor`/`validate`/`test` 之外的全部命令转交给 `mars/src/cli.js`，而 `cli.js` 只在 `ledger` 分支里检查 `args.help`；其余分支直接进入业务逻辑。`init-dev` 的业务逻辑是「无条件写文件」，于是 `--help` 变成了「写文件」。

---

## 5. 未实现功能的口径问题

从文档中提取全部 `rds <sub>` 引用，与 `KNOWN_COMMANDS` 求差：

| 命令 | 文档引用次数 | 实现状态 | 当前文档表述 | 问题 |
|---|---|---|---|---|
| `rds principal` | 5 | 不存在 | 「属于后续版本（路线图 M5）」 | M5 已到，本轮不实现 |
| `rds uninstall` | 3 | 不存在 | 「尚未实现（路线图 M5）」 | 同上 |
| `rds upgrade` | 2 | 不存在 | 同上 | 同上 |
| `rds backup` | 2 | 不存在（有 `tooling/backup.ps1`） | 作为脚本给出 | 易被误读为子命令 |
| `rds restore` | 1 | 不存在（有 `tooling/restore.ps1`） | 同上 | 同上 |

**E-01｜`render-role` 的状态描述与实际不符。**
README 写「未实现」，但工作区存在 `tooling/agent-runtime/rds-render-role.ps1`（未跟踪），且 `core/templates/role-packet.md` 与 `run-record.json` 是它的产物模板。准确状态是：**实现存在但未纳入版本控制与发行包**。

**E-02｜不存在「空壳命令」。**
核查结论：`KNOWN_COMMANDS` 中的 18 个命令全部有真实实现分支，没有「注册了但只打印 TODO」的情况。这一点是好的，M5 不得引入空壳命令。

---

## 6. 工作区与仓库的不一致

| 编号 | 现象 | 后果 |
|---|---|---|
| **F-01** | `core/templates/role-packet.md`、`core/templates/run-record.json` 未跟踪，但 `package.json.files` 含 `core/`，`npm pack` 会把它们打进包 | **打包结果依赖工作区状态**：同一提交，在工作区与干净克隆中打出的包内容不同（实测：当前包含这两个文件，干净克隆不会） |
| **F-02** | `docs/history/`（14 文件）、`docs/analysis/`（1）、`docs/runs/`（4）未跟踪 | 干净克隆看不到这些史料；但 `tests/self/run.ps1:52` 已把它们列为「历史前缀」 |
| **F-03** | `pack-check.mjs` 的 `REQUIRED` 不含这两个模板 | 缺了也不报错，问题不会被门禁发现 |

---

## 7. 门禁缺口

| 编号 | 缺什么 | 现有门禁为何没发现 |
|---|---|---|
| **G-01** | 文档链接有效性检查 | 无此检查。当前 5 个相对链接恰好都有效，属运气 |
| **G-02** | 帮助文本与文档一致性检查 | 无。D-06/D-07 的分叉因此长期存在 |
| **G-03** | 活跃资产项目名检查覆盖拼音与旧代号 | `tests/self/run.ps1` 的关键词表手工维护，漏了 `xingrixiao` / `m1-dev` |
| **G-04** | `core/**/*.md` 的路径卫生检查 | `doctor` 的扫描范围把它排除了（C-06） |
| **G-05** | 打包内容 ⊆ git 跟踪文件 | 无此检查（F-01/F-03） |

---

## 8. 发现汇总

| 类别 | 条数 | 其中 S1 | S2 |
|---|---|---|---|
| A 信息架构 | 5 | 0 | 0 |
| B 事实性错误 | 15 | 0 | 5 |
| C 污染与盲区 | 7 | 0 | 1 |
| D CLI 帮助 | 7 | **1** | 2 |
| E 未实现功能口径 | 2 | 0 | 1 |
| F 工作区一致性 | 3 | 0 | 1 |
| G 门禁缺口 | 5 | 0 | 0 |
| **合计** | **44** | **1** | **10** |

---

## 9. 批次映射（B0 结论 → 后续批次）

| 批次 | 承接的发现 |
|---|---|
| **B1 信息架构** | A-01…A-05、B-13（索引标注） |
| **B2 安装与快速开始** | B-01…B-09、E-01、C-04 |
| **B3 CLI 与功能发现** | D-01…D-07、E-01、E-02、B-04、B-05 |
| **B4 路径与可移植性** | C-02、C-03、C-06、C-07、F-01、F-03 |
| **B5 维护者体验** | B-10…B-12、B-14、B-15 |
| **B6 最终验收** | G-01…G-05（可自动化的部分转为检查脚本） |

**C-01（示例身份文件的项目名）归 B3**：它是「功能发现」的一部分——新用户第一次读 `principals.example.json` 就应当看到 `demo`，而不是某个陌生项目名。

---

## 10. 本批次明确不做的事

1. 不修改任何被审计文件（本报告为唯一新增文件）。
2. 不移动、不删除 `docs/history/`、`docs/analysis/`、`docs/runs/` 与 `docs/checks/git-review/run-*`。
3. 不改写带日期的历史证据正文（`GITHUB.md`、`AP-12-*`、`m1-0*-checkpoint.md`、`mars/docs/*`）。
4. 不重命名命令、不新增公开参数、不改 JSON 输出格式。
5. 不处理 `ledger.json` 的路径格式（B4 先出分析，改与不改都要有依据）。

---

## 11. 审计产物

- 本报告：`docs/checks/productization/M5-docs-audit.md`
- 链接扫描脚本：`C:\Users\liuch\AppData\Local\Temp\linkcheck.mjs`（临时，不纳入仓库）
- 引用扫描脚本：`C:\Users\liuch\AppData\Local\Temp\refcheck.mjs`（临时）
- 51 项保护基线：`D:\M1-migration\m5-protected-baseline.txt`（仓库外）
