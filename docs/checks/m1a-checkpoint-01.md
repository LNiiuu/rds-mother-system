# M1-A 检查点 01：母体系骨架、自检与本地仓库初始化

- 时间：2026-11-01 20:1x（+08:00）
- 任务：T-M1-0 / M1-A A-01（骨架 + git init）
- 范围：仅 D:\M1 与 D:\M1-backups；未 commit、未 push、未改 Profile/MCP/REA、未触碰业务代码与 旧项目（名称不入库）。
- 执行依据：m00378 连续执行授权（AUTH-03/AP-11）；AP-12 未批，故无 commit。

## 1. 骨架
- 66 文件 / 50,083 B，顶层：README、VERSION(0.1.0)、CHANGELOG、.gitignore、core/、tooling/、stacks/、rea/、docs/、tests/。
- core：policies 8（permissions/task/acceptance/mcp/download/git-remote/handoff/conflicts）、protocols 2、roles 8（R0–R7）+模板+roster、workflows WF1–WF4、templates 6、bootstrap、scripts/new-project.ps1。
- tooling：manifest 8 JSON + probe/backup/restore/sync.ps1 + mcp-lifecycle.md。
- rea：baseline/evidence/samples + W-01…W-06 六套 REA 工作流。
- 自检命令：`powershell -NoProfile -ExecutionPolicy Bypass -File D:\M1\tests\self\run.ps1`
- 结果：**RESULT: PASS**（required 39 项、role 8、workflow 6、manifest 8、禁用串、project.yaml）。
- 首轮曾 8 项 FAIL（r1–r7 缺权限段、run.ps1 自含禁用串），修复后复跑 PASS；修复内容已并入交付物。

## 2. Git
- `D:\Tools\Git\bin\git.exe -C D:\M1 init` → `Initialized empty Git repository in D:/M1/.git/`
- 分支：`git symbolic-ref --short HEAD` → **main**
- commit：**无**（`git rev-parse --verify HEAD` = fatal: Needed a single revision，预期；AP-12 待身份确认）
- `git status --porcelain`：10 条（顶层目录折叠）；tracked 0。

## 3. ZIP 备份
- 路径：`D:\M1-backups\rds-20261101-2011-v0.1.0.zip`
- 大小：42,939 B；SHA-256：`BAF48014BE9615E000781E14A0F3AF8D9B7F15690B0B47B5598095418932F7E6`

## 4. 新项目初始化脚本实测（A-01 之外的前置验证）
- 命令：`new-project.ps1 -Target %TEMP%\rds-init-test-201219 -Stack weapp`
- 结果：生成 `project.yaml`，内容含 `schema: rds/project/v1`、`name`、`root`（绝对路径注入）、`stack: weapp`、`language: zh-CN`；UTF-8 有效性已用字节复核。
- 未清理临时目录（跨目录递归删除被 CC Safety Net 拦截；保留不影响仓库）。

## 5. 遗留与下一步
- A-08 首次 commit：待 AP-12 身份确认。
- WF1–WF4 真实运行证据：尚无（等 0C/临时项目）。
- 下一步：M1-0A REA 基线审计（provider 状态、六能力域现状、0B 缺口计划）。
