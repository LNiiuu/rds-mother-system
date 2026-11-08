# CHANGELOG

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
- 9 个 PowerShell 脚本的默认根：`D:\M1` → 按脚本位置推导，`RDS_HOME` 可覆盖（**参数默认值在 PS 5.1 下于调用方作用域求值，故改为脚本体内归一化**）
- 3 处 `D:\Tools\Git\bin\git.exe` → `Get-Command git` 探测
- `project.yaml` 与 `new-project.ps1`：本机路径改为 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>` 占位符，生成后自动校验
- `mars/src/cli.js`：移除默认项目名 `xingrixiao,m1-dev`；usage 改为 `rds`
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

