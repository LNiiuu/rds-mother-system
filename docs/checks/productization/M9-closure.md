# M9 封版记录：Context Infrastructure

**日期**：2026-11-12（+08:00）
**判定**：**`COMPLETED`**
**起点**：`ebcdaa3`；实现提交 `76eee98`

---

## 1. 交付内容

| 能力 | 实现 | 强制程度 |
|---|---|---|
| 多项目注册 | `project create/register/list/show/use/current/remove` | **CLI + 代码校验** |
| 项目根安全 | resolve + `realpath`（消符号链接/别名）；必须是已存在目录；`..` 拒绝 | **代码强制** |
| 项目删除 | 软删除：只改 `status=removed`；必须 `--confirm <project_id>` | **代码强制** |
| 项目隔离 | 记忆/上下文/任务全部按 `project_id` 过滤；权限仍由 `principals.project_ids` 决定 | **代码强制** |
| 上下文预算 | `budget show|models`：窗口、输出/系统/工具预留、安全余量、可用输入、使用率、状态 | **代码强制** |
| 上下文监控 | 每次 `compile` 写 `context_runs`（项目/任务/角色/模型/估算/状态/压缩前后）；不存正文 | **代码强制** |
| 上下文分层 | `task|prohibitions=L0`、`decisions=L1`、`facts|state|knowledge=L2`、`evidence|reference=L3` | **代码强制**（压缩与监控使用） |

### 1.1 关键设计

- **项目根不是显示名**：`project_id` 有严格字符集，安全边界用 `project_id` + 根路径，
  不用 `display_name`。
- **删除不碰用户代码**：`remove` 返回 `source_deleted:false`、`memories_deleted:false`；
  测试断言源目录仍存在、记忆仍在库中。
- **预算不假装精确**：输出 `estimationMethod: chars-heuristic@1`，明确「不是 provider 用量」。

---

## 2. 验收证据

| 项 | 结果 |
|---|---|
| 项目注册/列表/详情 | 通过（`projects.test.js`） |
| 重复 ID / 非法 ID / 根不存在 | 全部按预期拒绝 |
| 符号链接（junction） | 存的是 `realpath`，不是链接路径 |
| 软删除二次确认 | 错 confirm 拒绝；正确后源目录与记忆都在 |
| 双项目隔离 | A 的决策不进 B 的包；B 库中 0 条 A 记忆 |
| 预算阈值 | NORMAL/WARNING/HIGH/CRITICAL/EXCEEDED 逐档断言 |
| 监控记录 | 每次 compile 一条；压缩时带 compression_id 与前后 token |
| 演示 | `npm run demo:m9-m11`：两个项目、各自编译、交叉读取均为 false |

原始演示输出（2026-11-12）：

```json
{"step":"project.create","a":"proj-a","b":"proj-b"}
{"step":"context.compile.isolation","a_tokens":245,"b_tokens":245,
 "a_has_a":true,"a_has_b":false,"b_has_b":true,"b_has_a":false}
```

---

## 3. 未实现 / 边界

| 项 | 状态 | 说明 |
|---|---|---|
| 项目级 ACL（比 project_ids 更细） | 未实现 | 当前安全边界仍是身份文件里的项目成员关系 |
| `project use` 自动作用到后续命令 | 未实现 | 只写 `current-project` 指针；命令仍要显式 `--project` |
| 项目配置的 schema 校验 | 部分 | `--config` 只做 JSON 解析，不校验字段 |
| 删除项目时清理记忆 | **刻意不做** | 审计与恢复需要；只软删除 |
| 跨项目共享记忆 | 已有 `share`（M3），本轮未扩展 | — |

## 4. 结论

M9 的目标（多项目、隔离、预算、监控、分层）已达到，且有 5 个项目测试 + 预算/监控断言 + 演示脚本为证。
「项目隔离」是**数据层隔离**，不是操作系统级隔离。
