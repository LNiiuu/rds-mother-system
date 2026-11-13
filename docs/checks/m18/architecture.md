# M18 架构：多 Agent 混合编排

**状态**：`IMPLEMENTED / VERIFIED WITH MOCK`
**Schema**：v7 → v8（只加表）
**代码**：`mars/src/runtime/scheduler.js`、`mars/src/adapters/fs-workspaces.js`、`mars/src/cli.js`（orchestrate 扩展）

---

## 1. 分层

| 层 | 模块 | 职责 |
|---|---|---|
| 域 | `runtime/scheduler.js` | 计划、依赖 DAG、READY/WAITING/RUNNING、优先级、最大并发、重试、取消、恢复、合并编排 |
| 适配器 | `adapters/fs-workspaces.js` | shared/copy/worktree 工作区、快照、变更、冲突检测、受控合并 |
| 执行 | `runtime/agent-runtime.js` | 每个 job 一个 Agent run/session；锁按工作区区分 |
| 工具 | `adapters/fs-tool-executor.js` | 4 个白名单工具；新增任务级 `allowedWritePaths` |
| 入口 | `cli.js` + `cli-help.js` | `rds orchestrate dispatch/plans/jobs/job/cancel-job/recover/merge` |

域模块不 require fs/child_process/env；工作区操作全部在适配器。

## 2. 数据模型（Schema v8）

- `orchestration_plans`：plan_id、project_id、objective、mode、status、max_concurrency、workspace_mode、auto_merge、base_root、merge_status、meta_json、时间戳。
- `orchestration_jobs`：job_id、plan_id、job_key、role_id、agent_id、deps_json、priority、isolation、writable_paths_json、status、cancel_requested、run_id、attempt、max_attempts、timeout_ms、budget_tokens、workspace、result_json、错误与时间戳。
- `orchestration_events`：plan/job 级事件流。

迁移只 `CREATE TABLE IF NOT EXISTS`，不修改既有行；旧库打开时幂等创建。

## 3. 状态机

Plan：`CREATED → RUNNING → SUCCEEDED | PARTIAL | FAILED | CANCELLED`

Job：`CREATED → READY | WAITING → RUNNING → SUCCEEDED | FAILED | CANCELLED | BLOCKED`

- `WAITING`：依赖未满足。
- `READY`：依赖全部 `SUCCEEDED`，可被调度。
- 依赖任一 `FAILED/CANCELLED/BLOCKED`：job → `BLOCKED / DEPENDENCY_FAILED`。
- `PARTIAL`：至少一个 job 成功，但不是全部成功。
- `BLOCKED` 不是 `FAILED`：合并冲突、依赖失败、不可恢复的治理拒绝都单独标记。

## 4. 三种模式

| 模式 | 行为 | 工作区默认 |
|---|---|---|
| serial | 每个 job 依赖前一个；`max_concurrency=1` | shared |
| parallel | 无依赖 job 同时进入 READY，受 max_concurrency 限制 | copy |
| hybrid | 串行准备 → 并行独立任务 → 串行验证/审查/汇总 | 混合（job 可指定 shared/copy/worktree） |

调度循环每轮：

1. `promoteReady()` 推进依赖；
2. 按 priority 降序、created_at/job_key 升序选 READY；
3. 用空闲 slot 启动 job；
4. `Promise.race` 等待任一完成或 50ms tick；
5. 全部终态后聚合 plan 状态。

## 5. 工作区与并发安全

- `shared`：直接使用项目根，只适合串行/单写者。
- `copy`：只复制 git 跟踪文件到临时目录；不带未跟踪用户数据；非 git 目录按过滤规则复制。
- `worktree`：`git worktree add --detach <dir> HEAD`；失败时降级为 copy 并记录原因。
- 每个 job 的写权限通过 `writable_paths` 收窄；越界返回 `TOOL_PATH_DENIED`。
- 变更 = job 启动快照 vs 结束快照；记录 added/modified/deleted + SHA-256。
- 合并前校验 base 当前哈希与 job 启动时一致；同一路径被两个 job 修改 → `DUPLICATE_PATH`；删除 → `DELETE_NOT_AUTO_MERGED`。
- 有冲突时不写任何文件，plan `merge_status=CONFLICT`。
- 工作区锁：默认项目级；M18 隔离 job 用 `lockScope='workspace'` + `lockTarget=<workspace path>`，避免同一项目并行 job 被项目锁串行化。共享工作区仍用 `*`。

## 6. 明确边界

- 单进程事件循环并发，不是分布式调度器；没有跨机器队列。
- 没有数据库级 job 抢占/租约；多进程同时 dispatch 同一 plan 未实现。
- `worktree` 基于 HEAD，不包含用户未提交修改；需要未提交文件时用 `copy` 或 `shared`。
- 合并只处理新增/修改；删除一律冲突，不自动删除。
- Agent 角色权限仍以 `collab.js` 代码表为准；“角色分工”不是进程沙箱。
