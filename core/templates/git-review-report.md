# Git 变更审查报告

- 报告版本（schemaVersion）：1.0.0
- 任务 ID：`{{taskId}}`
- 审查 ID：`{{reviewId}}`
- 时间：`{{timestamp}}`
- 仓库：`{{repositoryRoot}}`
- 分支：`{{branch}}`
- HEAD：`{{head}}`
- 授权级别：`{{authorizationLevel}}`

## 1. 结论

**{{verdict}}**

{{verdictReason}}

## 2. 检查项

| 检查 | 状态 | 说明 |
|---|---|---|
{{checksTable}}

## 3. 发现

| ID | 规则 | 严重级 | 类别 | 文件 | 原因 |
|---|---|---|---|---|---|
{{findingsTable}}

## 4. 基线对比

| 项 | 审查前 | 审查后 | 一致 |
|---|---|---|---|
| 暂存文件数 | {{indexBeforeStaged}} | {{indexAfterStaged}} | {{indexSame}} |
| index 摘要 | `{{indexBeforeDigest}}` | `{{indexAfterDigest}}` | {{indexDigestSame}} |
| staged diff 摘要 | `{{stagedBeforeDigest}}` | `{{stagedAfterDigest}}` | {{stagedSame}} |
| 工作区变更数 | {{wtBeforeChanged}} | {{wtAfterChanged}} | {{wtSame}} |
| 工作区清单摘要 | `{{wtBeforeDigest}}` | `{{wtAfterDigest}}` | {{wtDigestSame}} |

## 5. 证据

{{evidenceList}}

## 6. 限制

{{limitationsList}}

## 7. 声明

- 本报告只覆盖本次审查的变更集合；输出工件在检查完成后写入，不参与基线对比。
- G1 不实现完整指纹绑定、文档事实核对与 Git 历史检查（归 G2）。
- 报告不含秘密明文，命中项仅保留掩码与哈希。
