# M11 封版记录：Multi-Agent Orchestration

**日期**：2026-11-12（+08:00）
**判定**：**`COMPLETED WITH WARNINGS`**
**原因**：角色/任务/调度/交接/成本已落地并有测试；**多 Agent 执行是模拟的**，且没有重试退避。

---

## 1. 交付内容

| 能力 | 实现 | 强度 |
|---|---|---|
| R0–R7 角色表 | `rds role list|show`，含职责、权限、禁止项 | **代码校验**（新命令走 `assertPermission`） |
| 任务状态机 | 11 态、合法迁移表、`task_events` | **代码强制** |
| 任务拆分 | `task plan`：确定性规则，实现+测试拆 R2/R3 | **代码强制** |
| 显式覆盖 | `task plan --to-role` 优先于所有规则 | **代码强制** |
| 交接 | `handoff create`：为下一角色编译最小上下文 | **代码强制**（摘要只取已记录事实） |
| 成本账本 | `cost record/report`：estimated 与 provider 分离 | **代码强制** |
| 失败处理 | `task block/fail`，必须给原因；失败保留 `failure_reason` | **代码强制** |
| R7 远程权限 | 只有 `git.commit`/`git.status`；`git.push` 在禁止项 | **代码声明 + 权限表** |

### 1.1 调度规则（修复 M7/M8 的误判）

| 输入 | 拆分结果 |
|---|---|
| 「实现导出功能并补测试」 | **R2 实施 + R3 验证**（不再整体判为 verification） |
| 「只做回归测试」 | R3 |
| 「设计接口并实现，再补测试和安全检查」 | R1 + R2 + R3 + R6 |
| 显式 `--to-role R1` | 只派 R1（用户指定优先） |
| 「看看这个」 | R0 triage，`needs_review=true` |

## 2. 演示证据（simulated=true）

`npm run demo:m9-m11` 的实际输出：

```json
{"step":"task.plan","parent":"tsk_829aeca5c717","roles":["R2","R3"],"needs_review":false}
{"step":"task.state_machine","status":"COMPLETED","events":6}
{"step":"handoff","to_role":"R3","packet":"pkt_217a757590a9","tokens":184}
{"step":"cost.report","rows":2,"input":1800,"top_task":"tsk_c6b4476d1f93"}
{"step":"audit","entries":20}
{"step":"isolation.final","a_memories":1,"b_memories":1,"tasks_in_b":0}
```

- 状态机走了 `PLANNED → ASSIGNED → RUNNING → REVIEW_PENDING → VERIFICATION_PENDING → COMPLETED`，6 条事件。
- 交接只给 R3 编译了 184 tokens 的包，没有复制整段会话。
- 成本按 Agent/任务汇总；`proj-b` 没有任何任务（隔离）。

## 3. 权限的真实强度（必须说清）

| 层 | 强度 | 例子 |
|---|---|---|
| 文档约定 | 弱 | `core/roles/*.md` 的角色卡 |
| CLI 校验 | 中 | `task assign` 需要 `task.assign`；R2 被拒 |
| 代码强制 | 中 | 状态机、审批、项目过滤、证据必填 |
| 进程/OS 隔离 | **无** | 同一用户拿到 token 就能切角色；不是沙箱 |

**不能**把 R0–R7 描述成「系统已具备多角色安全隔离」。它只保证：
**按当前身份角色，某些命令会被拒绝**，并留下审计记录。

## 4. 未实现 / 限制

| 项 | 状态 | 说明 |
|---|---|---|
| 真实多模型/多 Agent 执行 | **NOT RUN** | 演示是同进程顺序模拟，`simulated=true` |
| 重试与退避 | **NOT IMPLEMENTED** | 只有 block/fail；没有 `retry` 命令 |
| 超时与心跳 | **NOT IMPLEMENTED** | 无守护进程 |
| 交接包自动投递 | **NOT IMPLEMENTED** | 只生成 packet + 记录，不推送给外部 Agent |
| 成本自动采集 | 部分 | 需手工 `cost record`；`feedback` 仍要填 token |
| R7 远程操作 | **禁止** | 权限表里没有 `git.push`，文档也写明需人工授权 |
| 进程级隔离 | **无** | 见 §3 |

## 5. 结论

M11 把「Markdown 约定」推进到了「可执行的状态机 + 权限校验 + 可追溯事件 + 可编译的交接包」。
这是一套**协作治理骨架**，不是 Agent 运行时。它的价值在于：
任务不会静默跳状态、越权命令会被拒、交接有最小上下文、成本有账可查。
