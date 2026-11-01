# EV-20261101-004 W-01 代码理解与依赖分析（运行记录）

- 时间：2026-11-01 21:38（+08:00）
- 工作流：`core/workflows/w-01-code-understanding.md`
- 目标：业务小程序源码（只读，未修改）
- 执行角色：R2；复核：R6（抽查 3 条依赖边）

## 入口清单（来自 app.json）

- 页面 10 个：pages/today、pages/month、pages/year、pages/view、pages/me、pages/task-edit、pages/task-detail、pages/data、pages/settings、pages/habit。
- tabBar 5 个：today / month / year / view / me。
- 启动入口：`app.js:12` → `require('./core/repo/index.js')`。

## 依赖边（路径:行号 → 目标）

| 边 | 目标 | 含义 |
|---|---|---|
| app.js:12 | core/repo/index.js | 全局 store 入口 |
| core/repo/index.js:9 | core/repo/repo.js | 仓储聚合 |
| core/repo/index.js:10-14 | settings/task/daily/habit/event | 六类仓储挂载 |
| core/repo/repo.js:17 | core/repo/adapter.js | 默认存储适配器 |
| core/repo/repo.js:18-19 | shard.js / codec.js | 分片与编解码 |
| core/backup/export.js:31-33 | codec / shard / format | 备份导出链 |
| core/backup/restore.js:35-36 | codec / shard | 备份恢复链 |
| core/models/index.js:8-9 | id.js / date.js | 模型基础工具 |
| core/repo/task.js:24-27 | models / date / event | 任务仓储依赖 |

## 分层结论

- 核心层（被多处依赖）：`core/repo/index.js`、`core/repo/repo.js`、`core/codec.js`、`core/id.js`、`core/date.js`。
- 叶子层（无出边）：`core/repo/adapter.js`、`core/models/task.js`。
- 未覆盖：wxml/wxss 视觉依赖、运行时注入与条件加载（未做，不声称覆盖）。

## 复核

- R6 抽查 3 条：repo.js:17、export.js:31、task.js:24-27，均可在源文件中复现，判定 PASS。
- 证据强度：E1（直接读取源码行）。
