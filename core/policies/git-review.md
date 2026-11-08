# Git 变更审查纪律（WF5）

## 1. 定位

本纪律约束“变更完成之后、提交之前”的自动审查。它是证据生成器与硬停点，不是系统级安全边界；系统级边界仍由 DSH 沙箱与审批策略提供。

审查器与报告属于母体系资产，项目通过 `project.yaml` 复用，不复制到业务仓库。

## 2. 授权级别（机读）

每次任务必须单独签发 `git-authorization.json`，禁止从历史任务推断授权。

| 级别 | 含义 | 允许动作 |
|---|---|---|
| **L0** | 只读审查 | 读取工作区/暂存区/提交，生成报告；**不写 index、不 commit、不 push** |
| L1 | 审查并暂存 | L0 + 按 `allowedPaths` 逐文件 `git add --`（禁 `-A`/`.`） |
| L2 | 审查并提交 | L1 + 用户批准 + 父提交=审查 HEAD |
| L3 | 审查、提交并推送 | L2 + 远程审批 + 快进核验 + 认证可用 |

当前阶段仅实现并授权 **L0**；L1–L3 另行设计、另行授权。

## 3. 结论聚合

结论只能是 `PASS`、`PARTIAL`、`BLOCKED`、`FAIL`，按 `FAIL > BLOCKED > PARTIAL > PASS` 聚合：

- 任一范围越界、未授权删除、高置信秘密命中 → `FAIL`；
- 二进制/超大文件、不可读/不可解析文件、index 被改动 → `BLOCKED`；
- 仅编码/格式问题（CRLF、BOM、末尾空行）→ `PARTIAL`，只记录不直接判失败；
- 未执行的检查必须记 `not_run`，不得视为通过；存在 `not_run` 时不得给 `PASS`；
- 下游不得把 `PARTIAL`/`BLOCKED`/`FAIL` 提升为 `PASS`。

## 4. 报告

报告必须包含 `schemaVersion`、`taskId`、`reviewId`、`timestamp`、`repository`、`branch`、`head`、`authorizationLevel`、`verdict`、`findings`、`checks`、`indexBefore/indexAfter`、`worktreeBefore/worktreeAfter`、`evidence`、`limitations`，并通过 `git-review-report.schema.json` 校验。

`ConvertFrom-Json` 只负责解析，不得把“JSON 可解析”等同于“Schema 校验通过”。

报告只输出掩码片段（如 `sk-…a9f2`），不得回显秘密原值；无法安全判断时记 `PARTIAL` 交人工。

## 5. 证据与指纹

- 证据沿用 `EV-YYYYMMDD-NNN` 编号与 E1–E4 强度。
- **G1** 只记录 HEAD、分支、暂存区摘要、工作区清单摘要。
- **G2** 才实现完整审查指纹（HEAD + 暂存树 + 工作区清单）的生成、绑定与独立复算。
- G1 报告必须声明完整指纹、文档事实核对、Git 历史检查尚未实施。

## 6. 停止条件

任一命中即停止并报告：

1. 需要修改 outOfScope 文件；
2. 需要网络、提权、安装依赖或改系统配置；
3. 发现其他任务/用户并行修改同一文件；
4. 需要访问隔离项目目录；
5. 需要 Git 写操作（add/commit/push/reset 等）；
6. 文件无法读取、无法解析或无法安全扫描；
7. 发现凭据或敏感数据泄露风险；
8. 测试结果与预期不一致且授权范围内无法修复。

不得为了让测试变绿而降低判定标准或隐藏失败。

## 7. G1/G2/G3 边界

- **G1**：范围检查、完整 diff（含未跟踪）、新文件全文、二进制/大文件识别、基础敏感扫描、L0 报告、WF5 基础流程。
- **G2**：完整指纹、文档事实核对、Git 历史完整性检查、质量门。
- **G3**：远端身份、快进核验、自动推送、`sync.ps1` 集成、跨项目复用。

G1 不得提前修改 `tooling/sync.ps1`。
