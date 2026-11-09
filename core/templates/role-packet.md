# 角色执行包（role packet）

> 本文件由 `tooling/agent-runtime/rds-render-role.ps1` 生成，是一次性执行包，不是 DSH 注册 Agent。
> R0–R7 是提示词角色；运行时由主会话通过 subagent 或 AgentTeams 成员承载。

## 0. 执行包标识

| 字段 | 值 |
|---|---|
| 角色包版本 | 1.0.0 |
| 角色 ID | {{ROLE_ID}} |
| 角色名称 | {{ROLE_NAME}} |
| 角色卡文件 | `core/roles/{{ROLE_FILE}}` |
| 项目 ID | {{PROJECT_ID}} |
| 项目名称 | {{PROJECT_NAME}} |
| 项目根 | `{{PROJECT_ROOT}}` |
| 技术栈 | {{STACK}} |
| 任务 ID | {{TASK_ID}} |
| 执行模式 | {{MODE}} |
| 生成时间 | {{GENERATED_AT}} |

## 1. 系统提示词（来自角色卡，未改动原文件）

{{SYSTEM_PROMPT}}

## 2. 任务目标

{{TASK_OBJECTIVE}}

## 3. 输入

{{TASK_INPUTS}}

## 4. 输出与交付格式

{{TASK_OUTPUTS}}

## 5. 约束

{{TASK_CONSTRAINTS}}

## 6. 验收条件

{{TASK_ACCEPTANCE}}

## 7. 证据要求

{{TASK_EVIDENCE}}

## 8. 运行纪律（对执行者生效）

1. 只在任务 inScope 内操作；禁止 git add/commit/push/reset/clean。
2. 不读取、输出、传递任何凭据；真实数据与样本按项目 `data_policy`。
3. 结论必须带证据（命令/输出摘要/哈希/时间），未验证项单列，不得推断为已验证。
4. 完成后按 `run-record.json` 回填 evidence 与 review，交 R0 汇总。
5. 本执行包不改变任何 DSH 权限；权限仍由会话级 sandbox/approval 决定。
