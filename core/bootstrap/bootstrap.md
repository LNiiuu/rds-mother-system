# 新项目加载母体系

## 前置

- 母体系目录可读。实际路径由安装形态决定：`rds doctor` 会打印 `root`，也可用 `RDS_HOME` 显式指定。
- 项目目录已存在或有明确创建授权。

## 步骤

1. **复制模板**：`core/templates/project.yaml` → `<项目根>/project.yaml`，填 name/root/stack/paths/toolchain。
2. **选栈**：读 `stacks/<stack>/stack.yaml`，确认工具链与验证命令；缺工具记 blocker，不假定可用。
3. **建骨架**：`core/scripts/new-project.ps1 -Target <项目根> -Stack <stack>`（只建目录与模板，不初始化 Git 业务操作）。
4. **定角色**：按项目规模选常设/轮换；写 `core/roles/roster.md` 的启用清单到项目交接单。
5. **验证挂载**：跑项目自检（若有）；确认 `project.yaml` 可解析、路径存在、命令可执行。
6. **首任务**：用 WF1 或 WF2 建第一张任务卡；证据目录就绪。
7. **记录**：在母体系 `docs/acceptance/` 记"项目接入"记录（项目名、栈、日期、结果），不写业务细节。

## 隔离

- 项目代码、数据、进度留在项目仓库；母体系只存通用资产与接入记录。
- 项目证据写项目 `evidence/`，不回写母体系。
- 母体系升级不自动改项目；项目按需升级并在交接单记录。

