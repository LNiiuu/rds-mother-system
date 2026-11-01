# 任务卡协议

## 必填字段

| 字段 | 说明 |
|---|---|
| `id` | `T-YYYYMMDD-NNN` |
| `title` | 一句话任务名 |
| `assignee` | 角色代号（R0–R7） |
| `objective` | 可验收的目标 |
| `inScope` | 允许修改的路径（相对项目根） |
| `outOfScope` | 明确禁止的路径 |
| `acceptance` | 验收标准（逐条可测） |
| `verify` | 验证命令与期望输出 |
| `evidence` | 证据要求（E1–E4、存放目录） |
| `dependencies` | 前置任务 |
| `rollback` | 回滚方式 |
| `deadline` | 可选 |

## 契约

- 缺任一必填项，实现角色可拒绝开工。
- inScope 之外的修改一律视为越界；越界即打回。
- 任务完成后由审查角色核对 `acceptance` 与 `verify`，逐条给结论。

## 模板

见 `core/templates/task-card.md`。

