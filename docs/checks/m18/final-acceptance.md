# M18 最终验收

**判定**：`PARTIAL`
**原因**：多 Agent 调度、隔离、并发、混合、冲突、恢复均在本机真实执行层验证；**真实模型调用 T18-01 因无凭据 BLOCKED**。不能判 `COMPLETED`。

---

## 1. 验收表

| 编号 | 项目 | 结果 | 证据/说明 |
|---|---|---|---|
| T18-01 | 至少一个真实 Provider 成功 | **BLOCKED** | 无凭据；未发起网络请求 |
| T18-02 | 至少三个独立 Agent 实例 | **PASS** | hybrid 7 个 job/7 个 agent；serial/parallel 也有多实例 |
| T18-03 | Session 隔离 | **PASS** | 7 个 job 的 session_id 全部不同 |
| T18-04 | 串行模式 | **PASS** | design→impl→verify，时间顺序成立 |
| T18-05 | 并发模式（真实时间重叠） | **PASS** | 3 个 job，3 对时间重叠 |
| T18-06 | 混合模式 | **PASS** | 7 job：串行准备→3 路并发→验证/审查/汇总 |
| T18-07 | 冲突保护 | **PASS** | 同文件第二个 job `BLOCKED/MERGE_CONFLICT` |
| T18-08 | 故障恢复 | **PASS** | recover REQUEUE + AGENT_LOST；重试/锁/取消测试 |
| T18-09 | 成本治理 | **PARTIAL** | 估算用量可追踪；真实 Provider 用量/费用 NOT RUN |
| T18-10 | 回归 | **PASS** | 全量 302/302（见最终报告；本轮新增 6 个调度测试 + 1 个锁续期测试 + 2 个 Provider 多轮测试 + 3 个工具测试） |

## 2. 交付物

- `architecture.md`
- `provider-verification.md`
- `agent-isolation.md`
- `scheduling-verification.md`
- `concurrency-verification.md`
- `recovery-verification.md`
- `cost-verification.md`
- `execution-record.json`

## 3. 代码/测试

- `runtime/scheduler.js`（新）
- `adapters/fs-workspaces.js`（新）
- `adapters/fs-tool-executor.js`（allowedWritePaths）
- `runtime/agent-runtime.js`（lockScope/lockTarget）
- `runtime/locks.js`（INSERT OR IGNORE 竞态收敛）
- `cli-agent.js`（预算拒绝落 FAILED）
- `provider-*.js`（多轮历史去重）
- `mars/tests/arch/scheduler.test.js`（5 例）
- `mars/tests/arch/provider-adapters.test.js`（+2 例）
- `tooling/m18-orchestration-demo.cjs`

## 4. 不能声称的事

- 不能声称“真实模型多 Agent 协作已验证”。
- 不能声称“并发是真实模型并发”；本轮是调度层 + mock 异步延迟。
- 不能声称“跨进程调度/租约已实现”。
- 不能声称“合并会自动处理删除/二进制冲突”；删除一律冲突。
