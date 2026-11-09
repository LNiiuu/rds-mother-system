# RDS 母体系（Reusable Development System）

**RDS 不是服务，不监听端口，也不需要联网。** 它是一套可以复制进你自己项目的研发流程资产，外加一个可直接运行、可独立部署的记忆与上下文引擎（MARS）。

- **版本**：见 `VERSION`（当前 0.1.0）
- **许可**：MIT（见 `LICENSE`）
- **安装**：`npm install -g .`（Node >= 22.15，无第三方依赖）→ 详见 **[docs/install.md](docs/install.md)**
- **范围**：只含通用资产；不含任何具体项目的业务代码、数据与需求

## 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 一套角色卡、流程、任务协议、证据规范（Markdown 资产） | 不是 Agent 运行时——**不会**装完就自己跑起来干活 |
| 一个可独立运行的本地记忆引擎 MARS（SQLite + FTS5，零依赖、零网络） | 不是云服务，不做同步、不做多租户 |
| 一个把提示词资产渲染成交付物的素材库 | 不绑定任何特定 AI 客户端；DSH 只是参考实现之一 |

> 关键区分：`core/roles/` 里的 8 席角色是**提示词与职责约定**，消费主体是"会读文件的 AI 会话"或人，不是调度器。
> 行为保证来自证据校验与审批流，不来自提示词本身。

## 5 步跑通

```bash
git clone https://github.com/LNiiuu/rds-mother-system.git && cd rds-mother-system

npm install -g .                                  # 1. 安装（Node >= 22.15）
rds doctor                                        # 2. 自检：Node / sqlite+FTS5 / 版本 / 路径卫生

mkdir -p ./mars-data
export MARS_DB="$PWD/mars-data/mars.db"            # 3. 数据放到仓库外，升级才不会被覆盖
export MARS_PRINCIPALS="$PWD/mars-data/principals.json"
rds init                                          #    建库

rds init-dev --principal dev-r0 --projects demo --roles R0   # 4. 生成身份
#    上一步会打印一行 DEV_TOKEN=xxxx，复制 xxxx 后：
export MARS_TOKEN="把上一步打印的 DEV_TOKEN 原样粘贴到这里"

rds put --project demo --type L3 \
  --content "示例决策" --source docs/d.md --version v1        # 5. 写入一条 proposed 记忆
rds list --project demo --status proposed          #    应能看到刚写入的 memory_id
```

> **Windows PowerShell 对应写法**：`$env:MARS_DB="$PWD\mars-data\mars.db"`、`$env:MARS_TOKEN="..."`。
> 不要写成 `export MARS_TOKEN=<DEV_TOKEN>` —— `<` 在 bash 里是重定向符，会报语法错误。

完整链路（含检索、上下文包、审批、MCP 接入、升级卸载、故障排查）见 **[docs/install.md](docs/install.md)**。

## 两种用法

**A. 当模板用**——把 `core/`、`stacks/` 复制进你的项目，用 `project.yaml` 注入项目差异：

```powershell
powershell -NoProfile -File core/scripts/new-project.ps1 -Target ./my-app -Stack weapp
```

生成骨架 + `project.yaml`，并自动用 `rds validate` 校验顶层契约。

**B. 当引擎用**——只用 MARS 管理"什么被批准为事实"：

```bash
rds put      # 写入 → proposed
rds review   # 由**另一个身份**审批 → approved（自审会被拒绝）
rds search   # 只返回 approved
rds compile  # 按角色与预算编译上下文包，带 manifest 与哈希
```

## 结构

| 目录 | 内容 |
|---|---|
| `bin/` | 统一入口 `rds`（版本门禁、`doctor`、`validate`、子命令分发） |
| `core/policies` | 权限、任务管理、验收、MCP、下载、Git 远程、交接、冲突 |
| `core/protocols` | 任务卡、证据协议（E1–E4 分级） |
| `core/roles` | 8 席角色卡（4 常设 + 4 轮换）与变量化模板 |
| `core/workflows` | WF1 需求交付、WF2 多方向研究、WF3 缺陷修复、WF4 方案评审、WF5 Git 审查 |
| `core/templates` | `project.yaml`、交接单、验收单、测试报告、缺陷单 |
| `stacks/` | 技术栈适配（weapp、native-bin） |
| `mars/src` | MARS 引擎：存储、鉴权、检索、上下文编译、账本、MCP 服务 |
| `mars/docs` | MARS 的设计与历史评审记录（索引见 `mars/docs/README.md`） |
| `tooling/` | 门禁与检查（测试门禁、分层、基线、打包、配置、smoke）、工具清单、探针、备份/恢复 |
| `docs/` | 文档。**入口是 [`docs/README.md`](docs/README.md)**：正式文档 / 架构设计 / 验收证据 / 历史材料 四类分开索引 |
| `rea/` | REA 能力基线与六套分析工作流（文档层） |
| `tests/self` | 母体系结构自检（PowerShell） |

完整的「改哪里会牵动哪里」见 **[docs/PROJECT-MAP.md](docs/PROJECT-MAP.md)**。

## 文档地图

`docs/` 里同时放着四类东西（正式文档、架构设计、验收证据、历史材料），混读会得出错误结论，所以先看分类：

| 你想做什么 | 读哪份 |
|---|---|
| 先跑起来 | [docs/quickstart.md](docs/quickstart.md) —— 10 分钟最小闭环，每步带预期输出 |
| 完整安装与配置 | [docs/install.md](docs/install.md) —— 唯一权威安装文档 |
| 出问题了 | [docs/install.md](docs/install.md) §12「故障排查」 —— 按现象查 |
| 改代码 | [docs/PROJECT-MAP.md](docs/PROJECT-MAP.md) → [docs/testing.md](docs/testing.md) |
| 核对它可不可信 | [docs/checks/README.md](docs/checks/README.md) —— 全部验收证据索引 |

完整索引、状态图例、以及「哪些文档已知失效」在 **[docs/README.md](docs/README.md)**。

> **发行包只带 `README.md` 与 `docs/install.md`**。上表中的其他文档在源码仓库里（`git clone` 后可见）。
> 只装了包、没 clone 仓库时，用 `npm view` 拿不到它们——请按需 clone 或直接看 GitHub。

## 当前状态（诚实表）

| 能力 | 状态 | 证据等级 |
|---|---|---|
| `rds` 入口 / `doctor` / `validate` | 已实现，Windows 实机通过 | E1 |
| MARS CLI 闭环（init→put→review→search→compile） | 已实现，Windows 实机通过 | E1 |
| MCP stdio 服务（initialize / tools/list / tools/call） | 已实现，冒烟通过 | E1 |
| 测试 | **173 项全通过，fail=0，skipped=0**（本地 Windows × Node 22.22.2，`b89cbb2`） | E1 |
| CI（Windows + Ubuntu × Node 22/24） | **四组全绿**：[run 42583509413](https://github.com/LNiiuu/rds-mother-system/actions/runs/42583509413) @ `b89cbb2`（6 个 job 全 success） | E1 |
| Linux / Ubuntu | 由 CI 实测通过（Node 22 / 24 各一格） | E1 |
| macOS | **未验证** | E3 |
| CLI 子命令帮助 | **22 个命令全部有 `--help` / `-h`**，且帮助先于任何副作用（不建库、不写文件） | E1 |
| `render-role` 角色包渲染 | **未纳入仓库与发行包**。工作区存在未入库的 PowerShell 实现（`tooling/agent-runtime/`），不随包分发 | — |
| `rds principal` / `rds upgrade` / `rds uninstall` | **未实现**。身份需用 `rds init-dev` 生成，升级为覆盖安装 | — |

未实现的能力不会以空壳命令出现：`rds <未知命令>` 直接报「未知命令」，不会假装已实现。

测试已完全去环境化：不再读取作者会话、不依赖 `DSH.exe`、不含本机绝对路径。
`npm test` 走门禁 `tooling/test-gate.mjs`，要求 `tests>0 && fail=0 && skipped=0`；
缺 fixture 或静默 skip 会让门禁失败，而不是显示绿灯。分类与运行方式见 [docs/testing.md](docs/testing.md)。

## 三条底线

1. **不绑定项目**：仓库内不得出现具体项目名、业务路径、业务数据。项目差异全部由 `project.yaml` 注入。
2. **不冒充权限隔离**：角色卡的只读/可写是提示词级约定；系统级边界只有沙箱与审批。任何"已实现权限隔离"的表述都必须附系统级证据。
3. **不把安装当能力**：工具装好 ≠ 可用；provider available ≠ 工作流通过；一次成功 ≠ 可复用。结论按 E1–E4 标注证据强度。

## 版本与备份

- 变更记录：`CHANGELOG.md`；破坏性变更升次版本并写迁移说明。
- 备份：`tooling/backup.ps1`（输出仓库外的 ZIP + SHA-256）。GitHub 不替代 ZIP。
- 0.x 期间可能破坏兼容；1.0 才承诺 SemVer。
