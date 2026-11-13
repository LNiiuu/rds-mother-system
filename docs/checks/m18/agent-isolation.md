# M18 Agent 隔离

**结论**：独立 Agent 实例、独立 session、独立 run、独立上下文包、任务级写路径已实现；7 个 job 的 session 全部不同。模型仍是 mock，隔离的是执行层，不是“不同模型人格”。

---

## 1. 角色来源

原始定义：`core/roles/roster.md` + `core/roles/r0..r7` + `mars/config/role-routing.json`。
代码权限：`mars/src/collab.js`。

| 角色 | 名册职责 | 代码权限（摘要） |
|---|---|---|
| R0 | 总控：拆解/派发/汇总/越界审计 | task.plan/assign、context、cost、memory、read/list |
| R1 | 架构：需求/方案/影响面/风险 | read/list/write_file（M18 用 writable_paths 收窄到设计文件） |
| R2 | 实现：按任务卡实现/自测 | read/list/write_file/run_test |
| R3 | 验证：独立测试/回归 | read/list/run_test |
| R4 | 审查：复核证据/裁决 | memory.review、read/list |
| R5 | 研究：多方向调研 | read/list、memory.write |
| R6 | 逆向/安全：二进制/APK/流量/运行时 | read/list（M19 工具执行由 REA 适配层承担） |
| R7 | 发布/运维：构建/备份/回滚 | git.status/commit（无 push/release） |

## 2. 隔离维度

| 维度 | 实现 | 证据 |
|---|---|---|
| Agent 定义 | `agents` 表，一角色一实例，可多个同角色实例 | `m18-orchestration-demo` 创建 9 个 Agent |
| Session | 每个 run 新建 session；`sessions_distinct` 检查 | hybrid 7 个 job，7 个 session |
| Run | 每个 job 一个 `agent_runs`，独立状态/事件/用量 | `execution-record.json` 的 run_id |
| 上下文包 | scheduler 为每个 job 调 `compilePacket`；CLI 用 `compileContext` | 每个 job 传独立 packet_id |
| 写路径 | `writable_paths` → `TOOL_PATH_DENIED` | 测试覆盖越界拒绝（见 `scheduler.test.js` / fs executor 现有测试） |
| 工作区 | shared/copy/worktree | parallel/hybrid 用 copy，冲突测试用 copy |
| 锁 | 隔离 job 用 `lockScope=workspace`、`lockTarget=<path>` | 三个 job 同时 RUNNING |

## 3. 实测

`docs/checks/m18/execution-record.json`：

- serial：3 个 job、3 个 run、3 个 session；
- parallel：3 个 job、3 个 run、3 个不同 session，3 对时间重叠；
- hybrid：7 个 job、7 个 run、7 个不同 session；
- conflict：2 个 job 改同一文件，1 个成功、1 个 `BLOCKED / MERGE_CONFLICT`。

## 4. 限制

- 没有进程级隔离；同一 OS 用户可切换 token。
- `R1` 的 `tool.write_file` 仍大于原始“只读架构”定义；M18 用 `writable_paths` 收窄，但没有改变角色权限表本身。
- 上下文包在 demo 中是轻量包（任务正文）；CLI 路径用 `compileContext`。两者都不是“模型自己决定上下文”。
- 同角色多实例是允许的；审查与实现分离靠 job 角色/agent 分配，不靠进程边界。
