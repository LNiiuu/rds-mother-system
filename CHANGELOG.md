# CHANGELOG

## Unreleased — M9–M11 上下文基础设施与协作

新增
- `rds project create|show|use|current|remove`：项目根 resolve + realpath；删除是软删除
  （只改 status，不删源码与记忆），必须 `--confirm <project_id>`
- `rds budget show|models`：模型窗口/输出/系统/工具/安全余量/可用输入/使用率/5 档状态
- `rds context list|show|restore|analyze|compress`：编译监控、压缩与原文恢复（SHA-256）
- `rds role list|show`：R0–R7 权限表（代码校验，不是进程沙箱；R7 无 push）
- `rds task plan|create|list|show|events|assign|start|block|submit|verify|complete|fail`：
  11 态状态机、事件表、complete 必须 `--evidence`
- `rds handoff create|list`：为下一角色编译最小上下文
- `rds cost record|report`：estimated / provider 分离，只有 provider 可记 actual_cost
- `npm run demo:m9-m11`：双项目 + 模拟角色演示（`simulated=true`）

变更（需要知道）
- **Schema 4 → 5**：只加表（context_runs / compressions / tasks / task_events / handoffs / costs）
  与 projects 的 4 个列；`migrate()` 幂等，旧数据不改写
- `rds compile` 新增 `--auto-compress` / `--model`；每次编译写一条 `context_runs`
- 项目根参数是 `--project-root`；`--root` 仍是安装根（避免语义冲突）
- `--role` 仍是当前执行角色；`task assign/plan/create` 的目标角色用 `--to-role`

未实现（不提供空壳）
- 语义摘要（模型生成）、摘要过期判断、重试/超时/心跳、真实多 Agent 执行、
  进程级隔离、项目级 ACL、`project use` 自动生效

## Unreleased — M8 最小可用

目标：按 M7 的实测发现，修掉数据安全问题与上下文包的三个结构缺陷，使核心流程可独立使用。
不新增 AI 接入、不引入向量库、不做大规模重构。

数据安全（**行为变更，默认更安全**）
- `rds init-dev` **默认拒绝覆盖已有身份**：目标已有 principal 时直接失败（`IDENTITY_EXISTS`），
  文件逐字节不变，旧 token 继续有效
- 新增 `--add`：追加一个身份，保留原有 token；新增 `--replace`：显式重建，旧 token 全部失效
- 坏文件（非 JSON / 非 principals 文档）同样默认拒绝，只有 `--replace` 才重建
- 兼容性影响：依赖「重复执行 init-dev 来重置身份」的脚本会失败，需改用 `--replace`。
  首次初始化（文件不存在或 principals 为空）行为不变

上下文包（**对外输出变更**）
- 新增 `rds compile --task-file <md|txt>`：任务正文原样写入 `sec_task`，
  包不再只有「任务: ID」；缺正文时给出非阻塞的 `task_text` 缺失项
- 新增 `--format md`：输出精简 Markdown（元信息表 + 分节正文 + 缺失项），
  内容不改写、不截断；`--format json` 仍是默认
- 新增 `--no-manifest`：JSON 写出时省略 manifest；`manifest_id` 仍在 packet 中，DB 可追溯
- **`--out` 的 `budget` 不再包含 `sections`**（此前与 `packet.sections` 完全重复），
  只保留 `tokens / truncated / protected_kept / over_budget`
- 兼容性影响：读取 `<out>.budget.sections` 的调用方需改用 `packet.sections`。
  默认 stdout 输出仍是 packet 本体，未变
- 新增 `mars/src/render-md.js`，已登记进 `approved-additions.packFiles`
- 实测（M7 项目同一份记忆）：同内容 JSON 11 101 B → 8 074 B（−27.3%）；
  带任务正文的 Markdown 6 589 B，替代「旧包 + 任务书」的 15 332 B（−57.0%）
- 编译耗时不退化：中位 368 ms → 374 ms（JSON）/ 369 ms（Markdown），差异在 Node 启动抖动内

测试
- 196 → **210**（新增 7 例身份数据保护、7 例上下文包格式）

## Unreleased — M5 可发现性

目标：让一个没参与过 M1–M4 的人，仅凭仓库里的正式文档就能理解、安装、启动、使用、排查和维护。
不加功能、不改 Schema、不改 JSON 输出形状。

新增
- `docs/README.md`：唯一文档入口。三条阅读路径（装起来用 / 改它 / 核对可信度）、
  四类文档定义、状态图例（CURRENT/DESIGN/EVIDENCE/HISTORICAL/LOCAL）、已知失效清单
- `docs/PROJECT-MAP.md`：RDS 与 MARS 的关系、目录职责、MARS 五层结构、
  L1–L7 分层规则、一条记忆的生命周期、改动影响面矩阵、6 条红线
- `docs/quickstart.md`：10 分钟最小闭环，每步带预期输出
- `docs/maintainer-guide.md`：按症状查、72 个错误码全表、备份与恢复、
  版本与兼容、发布九步、回滚、什么时候该停手
- `docs/checks/README.md`、`docs/architecture/README.md`、`mars/docs/README.md`：三份索引
- `mars/src/cli-help.js`：22 个命令的帮助文本单一真相（此前 bin 与 cli 各一份且已分叉）
- `tooling/docs-check.mjs`：Markdown 相对链接检查，进 verify 与 CI
- `docs/checks/productization/M5-*.md`：8 份验收证据

变更（对外可见）
- **`--help` 先于一切副作用**。修复前：`rds init-dev --help` 会生成身份并**整个覆盖**
  `principals.json`；`rds init --help` 会建库；其余 15 个命令报「认证失败」；
  `rds mcp --help` 返回「网关默认禁用」。现在统一：打印用法、退出 0、不碰文件
- **22 个命令全部有 `--help` / `-h`**（此前 1/19）
- **`rds help <命令>` 与 `rds <命令> --help` 输出逐字节相同**
- **`rds doctor` 从 10 项检查增到 11 项**：新增 `paths:assets`（活跃文档，`fail` 级）；
  `paths:docs` 改为也扫 `.md`（此前只扫 json 与脚本）
- **顶层帮助文本更新**：补 `orchestrate`、`project`/`share` 子命令说明、`help` 命令；
  变更登记在 `approved-additions.helpText`
- **发行包文件数 108 → 109**：新增 `mars/src/cli-help.js`（已登记）
- **`core/templates/role-packet.md` 与 `run-record.json` 入库**：此前未跟踪但随包分发，
  导致「同一提交在两种工作区里打出的包不同」
- **`npm run verify` 增加一步** `docs:check`

删除 / 修正
- `mars/README.md` 全文重写：此前示例用具体项目 ID 与作者机器路径，测试数写「80 用例」
- `mars/config/principals.example.json` 的 `project_ids` 改为 `demo` / `example`
  （该文件随发行包分发）
- `core/bootstrap/bootstrap.md`、`core/policies/download.md` 去掉硬编码的机器路径
- `tests/self/run.ps1` 的关键词表补上拼音形式，并排除 `.git`/`node_modules`/`var`
  与本地身份文件——此前拼音名从未被捕获
- `docs/install.md` 修掉 6 处失真（doctor 样例重复行、`checks=9`、41 个文件、
  「M3 尚未跑过 CI」、`--token (cat ...)` 无效语法、`render-role` 表述）

不变
- 任何 SQL / DDL / `SCHEMA_VERSION` / 数据迁移；CLI 参数名与语义；JSON 输出形状；
  MCP 工具面；五个端口边界；零第三方依赖；`ledger.json` 的 path 语义（仍为绝对路径）

测试
- 173 → **196**（+23：CLI 帮助 12、ledger 路径 4、文档检查 7）；`fail=0`、`skipped=0`
- 干净克隆同样 196/196（无 `principals.json`、无历史材料）
- 分层 0 违规；7 面行为基线零漂移（含已登记增项）；文档 180 个 md / 199 个链接全可达
- CI run `42594239389` @ `72b13d5`：6 个 job 全 success，1 分 23 秒

## Unreleased — M4 可维护性

目标：让下一阶段的开发更容易定位问题、更容易安全修改。不加功能、不加依赖、不改 Schema。

新增
- `mars/src/version.js`：产品版本的单一读取点；`serverInfo.version` 不再硬编码
- `docs/versioning.md`：三个版本命名空间（产品 / 数据格式 / 数据库结构）与五条规则
- `tooling/baseline-capture.mjs` 支持「登记过的契约变更」（`approved-additions.json.contractChanges`）
- 六类新测试：契约一致性、脚本可解析、数据库生命周期、版本一致性、配置一致性、故障诊断矩阵
- 文档：`M4-*.md` 报告 8 份（审计 / 契约 / 脚本 / 数据库 / 版本 / 观测 / 测试 / 最终验收）

变更（对外可见）
- **`rds ledger` 输出按契约校验**：不符合 `ledger.schema.json#/properties/sessions/items` 时
  `LEDGER_CONTRACT_INVALID` + exit 4。契约此前在 `mars/src` 零引用，等于没有约束
- **`ledger.schema.json` 的 `source` / `source_kind` 由 `const: dsh-session` 放宽为 `pattern`**，
  与已支持多数据源的 `session-registry` 一致（H-05 关闭）
- **`serverInfo.version` 由 `0.2.0` 改为 `0.1.0`**（派生自产品版本）。仓库内无依赖方
- **`engines.node` 由 `>=22.5.0` 改为 `>=22.15.0`**：zstd 到 22.15 才进 v22 分支，
  22.5–22.14 上 `rds ledger` 会失败
- **打开更新版本的数据库会被拒绝**（`DB_SCHEMA_NEWER`），不再把 `schema_version` 静默写回旧值
- **数据库打开失败给出可操作错误**（`DB_OPEN_FAILED`），CLI 不再打印 Node 栈
- **审计写入失败不再完全静默**：计数 + 每连接一次 stderr 提示
- **CLI 顶层异常出口覆盖全部子命令**；栈只在 `--debug` 时输出
- **未知命令先于身份检查**：`rds typo` 报「未知命令」而不是「认证失败」
- **`rds ledger --help`**、`mars-issue-mcp-identity.js --help` 可用
- **`mars/scripts/mars-db-backup.js` 与身份签发脚本拒绝未知参数**（此前静默忽略并写默认位置）
- **`mars-issue-mcp-identity.js` 不再在 principals.json 损坏时重置为空表**（此前会静默抹掉所有身份）

删除
- `mars/scripts/seed-phase2.js`：语法损坏（中文曾被按 GBK 解码，含不可逆 `?`）、无调用方、
  直写默认库。替代路径：`rds init-dev` → `rds put` → `rds review`

不变
- 任何 SQL / DDL / `SCHEMA_VERSION` / 数据迁移；CLI 参数与 JSON 形状；MCP 工具面；
  五个端口边界；零第三方依赖

测试
- 128 → **173** 项，`fail=0`、`skipped=0`；分层 0 违规；7 面行为基线零漂移（仅登记增项）
- 回滚演练：逐批 revert → 验证 → revert-revert → 验证（结果见 `M4-rollback-report.md`）

## Unreleased — M3 宿主适配层

目标：把宿主相关的实现收进适配器，域逻辑不再直接依赖 DSH、文件系统布局与进程环境。

新增
- 5 个端口（`mars/src/ports/`）：AssetResolver / IdentityProvider / SessionSource / AuditSink / HostRegistry
- 8 个适配器（`mars/src/adapters/`）：fs-asset-resolver、cli-identity、token-file-identity、
  dsh-session-source、db-audit-sink、null-audit-sink、dsh-registry、null-host-registry
- 组合根 `mars/src/composition.js`（83 行）+ 路径规则 `mars/src/paths.js` + 数据源注册表 `mars/src/session-registry.js`
- `mars/src/errors.js`：错误码唯一真相，替换 mcp / mcp-stdio 中两份内联白名单
- `tooling/layering-check.mjs`：分层与循环依赖检查（CI 已接入）
- `tooling/baseline-capture.mjs` + `docs/architecture/m3/baseline/`：7 个对外面的行为基线
- `mars/scripts/mars-mcp-disable.js`：注册表移除的 Node 实现（PS 脚本改为转调）

变更（对外可见，逐条说明）
- **配置改为启动快照**：路径/身份/路由在进程启动时解析一次；修改 `role-routing.json` 后需重启 MCP 才生效
  （此前的"即时生效"未文档化、无测试覆盖）
- **域内不再读环境变量**：`store.propose` 不传 `routing` 时稳定返回 `ROUTING_UNAVAILABLE`，
  不再回退到 `MARS_ROUTING`（fail-closed 更彻底）
- **ledger 不再创建数据库**：只读动作在没有库时不再顺手建一个空库；审计仅在库已存在时写入
- **ledger 审计标识**：`principal_id` 由字面量 `'cli'` 改为哨兵 `'local'`，动作名 `ledger.read` → `ledger.parse`
- **移除 `ledger.read` 授权动作**：它从未被 `authorize()` 校验过，保留会让人误以为受控
- **错误码修复**：6 个码（`EXPIRES_AT_INVALID`/`INVALID_TRANSITION`/`RATE_LIMITED`/`ROLE_TYPE_DENIED`/
  `ROUTING_UNAVAILABLE`/`STATE_UNCHANGED`）在旧网关不再退化为 `INTERNAL_ERROR`
- **`mars-mcp-disable` 写入更安全**：备份 → 结构校验 → 临时文件 + rename → 写后回读；未知顶层字段保留；
  默认仍是 dry-run
- **开发脚本**：`phase2-g1-verify.js` 改用当前 Node（不再依赖 DSH.exe）；
  `phase4-usage.js` 需显式提供 `RDS_SESSIONS_ROOT`（不再猜 `~/.dsh/sessions`）

不变
- CLI 参数、子命令、JSON 输出形状、退出码；MCP 工具集与契约；`SCHEMA_VERSION=4` 与全部 DDL；
  数据契约内容（`mars/contracts/*.json` 哈希未变）；发行包安装路径与使用方式

测试
- 88 → 128 项，`fail=0`、`skipped=0`；分层检查 0 违规、2 条边界代码声明；行为基线 7 面零漂移
- 回滚演练：128 → revert → 88 → revert-revert → 128

## Unreleased — M2.1 CI 实证

目标：四组 CI（Windows/Ubuntu × Node 22/24）在 GitHub Actions 上真实跑通。

修复
- `tooling/ci-smoke.sh`：npm 全局目录布局跨平台差异（Linux 为 `$PREFIX/lib/node_modules`），
  改为双候选 + `find` 兜底；失败时输出 `::error::` 注解与 prefix 目录树
- `tests/self/run.ps1`：项目名检查拆成「活跃资产硬门禁 / 历史记录告警」，
  不再让已提交的历史验收记录把自检永久钉在红色
- `.github/workflows/ci.yml`：G1 job 改为存在性检测（G1 未入库时打印 SKIP + warning）；
  `checkout`/`setup-node` 升到 v5；结构自检由 advisory 转为阻塞
- `.github/workflows/ci.yml`：G1 步骤正文改为纯 ASCII —— GitHub 把 `run:` 块写成
  UTF-8 无 BOM，Windows PowerShell 5.1 按 ANSI 解析，中文会破坏语法

结果
- run `42479193137` @ `afd423a`：6 个 job 全 success（四组矩阵 + 结构自检 + G1 跳过）
- 已知：G1 夹具在 CI 中未执行（文件未入库），本地六夹具 PASS

## Unreleased — M2 测试可靠性

目标是"两个平台、同一份代码，`fail=0 && skipped=0`"。不改 MARS 存储结构、Schema 与治理规则。

新增
- `tooling/test-gate.mjs`：Required 门禁。判据 `tests>0 && fail=0 && skipped=0 && 计数自洽`，失败时打印原始 TAP
- `tooling/test-gate-selfcheck.mjs`：门禁反向验证（全绿 / 失败 / 跳过 / 空集四种场景）
- `tooling/pack-check.mjs`：发行包内容断言（必需文件齐全 + 禁止项 0 命中）
- `tooling/config-check.mjs`：JSON 严格解析 + YAML 结构性 lint
- `tooling/ci-smoke.sh`：打包 → 内容检查 → 干净前缀安装 → doctor → 写入 → 审批 → 检索 → 编译
- `mars/tests/fixtures/ledger/make-session.js`：确定性多帧 zstd 会话生成器（不复制真实会话）
- `mars/tests/external/dsh-real-session.external.js`：真实会话核对，显式 opt-in，不进 Required 门禁
- `mars/scripts/mars-rollback.js`：跨平台回滚实现
- `docs/testing.md`：测试分类、门禁判据、fixture 约定
- `.github/workflows/ci.yml`：Windows + Ubuntu × Node 22/24，含 G1（仅 Windows）与非阻塞的历史自检

修复
- `phase1/ledger-reconcile.test.js`：去掉作者真实会话路径与硬编码总量 `41,597,577`，改为 8 个 fixture 用例；缺文件/坏行/空会话均为硬断言
- `phase2/wp1.test.js`：不再用 `DSH.exe` 当 Node 运行时，改 `process.execPath`（`RDS_NODE_BIN` 可覆盖）
- `phase1/rollback-offline.test.js`：不再硬编码 `powershell.exe` 与作者机器上的仓库绝对路径；改为验证 `mars-rollback.js`
- `mars/scripts/mars-rollback.ps1`：改为转调 `mars-rollback.js`，避免两份实现分叉
- 消灭全部静默 `skip`：`ledger.test.js`、`phase1/lifecycle.test.js` 改为 `assert.fail` 并说明原因
- `package.json`：`test` 走门禁，新增 `test:raw` / `test:external` / `config` / `smoke`

结果
- Required：88 tests / 88 pass / 0 fail / 0 skipped（Windows 实机，Node 22.22.2）
- 发行包：87 文件，内容断言通过，干净前缀安装后全链路通过

## Unreleased — M1 可部署化

目标是"外部开发者在干净机器上只读 `docs/install.md` 就能跑到 `node --test` 有结果"。不改存储层与治理模型。

新增
- `LICENSE`（MIT）
- `package.json`：`engines.node >= 22.5`、`bin.rds`、`files` 白名单、`doctor`/`test`/`verify` 脚本
- `bin/rds.mjs`：统一入口，只做版本门禁与子命令分发，业务逻辑一律转交 `mars/src/cli.js`
- `bin/doctor.mjs`：`rds doctor`，检查 Node 版本、`node:sqlite`+FTS5、Git、目录可写、版本一致性、路径卫生；支持 `--json`
- `bin/validate.mjs`：`rds validate`，校验 `project.yaml` 顶层契约
- `docs/install.md`：唯一权威安装文档
- `.gitattributes`：统一 LF，`.ps1` 保持 CRLF

修复
- 9 个 Windows 脚本的默认根：硬编码的机器路径 → 按脚本位置推导，`RDS_HOME` 可覆盖（**参数默认值在 PS 5.1 下于调用方作用域求值，故改为脚本体内归一化**）
- 3 处硬编码的 git 可执行文件路径 → `Get-Command git` 探测
- `project.yaml` 与 `new-project.ps1`：本机路径改为 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>` 占位符，生成后自动校验
- `mars/src/cli.js`：移除默认项目名（此前硬编码了两个具体项目 ID，使 `--project` 在省略时静默指向某个项目）；usage 改为 `rds`
- `mars/src/db.js`：`node:sqlite` 引入失败时给出可读的 Node 版本提示，而非模块缺失栈
- `mars/scripts/phase4-usage.js`：个人会话路径改为 `RDS_SESSIONS_ROOT` + 家目录推导
- `README.md`：重写为"定位三边界 + 5 步跑通 + 两种用法 + 诚实状态表"

已知未达成（不隐瞒）
- 测试仍红：Windows 78/80、Linux 73/80（`ledger` 用例绑定作者 DSH 会话快照，M2 修）
- `tests/self/run.ps1` 的"无项目名"检查仍 FAIL（历史文档，M5 文档清理）
- `serverInfo.version` 仍为 0.2.0，与 `VERSION` 0.1.0 不一致（M5 对齐）

## 0.1.0 — 2026-11-01

首个可运行骨架（M1-A 阶段）：

- 目录骨架、README、VERSION、`.gitignore`
- 核心策略 8 份、协议 2 份、角色卡 8 份 + 变量化模板
- 工作流 WF1–WF4（去项目化）
- 项目模板 6 份、初始化脚本
- 工具清单 8 份、探针/备份/恢复/同步脚本
- 技术栈适配 weapp、native-bin
- REA 六套分析工作流（文档态，运行证据另行验收）
- 自检脚本

说明：本版本是**骨架**，尚无真实项目端到端运行记录；实际能力状态以 `docs/acceptance/` 为准。
