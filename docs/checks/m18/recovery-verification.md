# M18 故障恢复验证

**结论**：超时、重试、心跳陈旧、取消、合并冲突都有代码与测试；能恢复的 job 重排队，不能恢复的明确失败。没有“静默继续”。

---

## 1. 机制

| 故障 | 处理 | 证据 |
|---|---|---|
| Provider 5xx/不可达/超时 | Runtime 单次调用重试；调度级 `max_attempts` 再重试 | `reliability.test.js` 16 例；`scheduler.test.js` 恢复/重试路径 |
| job 超时 | run 落 `TIMEOUT`；job 落 FAILED/RUN_TIMEOUT，可重试则重试 | run timeout 检查点 |
| 心跳陈旧 | `recoverPlan` 把 run 标 `FAILED/AGENT_LOST`，job 重排队或 FAILED | `execution-record.json` recovery: `REQUEUE` |
| 取消 | READY/WAITING 立即 CANCELLED；RUNNING 请求取消，下一检查点收敛 | `cancel-job` |
| 合并冲突 | job `BLOCKED/MERGE_CONFLICT`；plan `PARTIAL`；不写冲突文件 | conflict plan |
| 依赖失败 | 下游 `BLOCKED/DEPENDENCY_FAILED` | `promoteReady` |
| 计划中断 | `recover` 扫描 RUNNING；不自动删数据 | `recoverPlan` |

## 2. 实测恢复

`execution-record.json` → `recovery`：

```json
{
  "recovered": [{ "job_key": "recover", "action": "REQUEUE", "run_id": "run..." }],
  "run": { "status": "FAILED", "error_code": "AGENT_LOST" },
  "job": { "status": "READY" }
}
```

构造：job 标 RUNNING、run 心跳设为 2000-01-01；`recover --stale 1000` 后 run `AGENT_LOST`，job 因 `attempt=1 < max_attempts=2` 回到 READY。

## 3. 测试

- `M18 恢复`：心跳陈旧 → REQUEUE + AGENT_LOST；
- `M13 重试`：可重试错误在 max_attempts 内成功；不可重试一次失败；尝试耗尽 FAILED；
- `M13 工作区锁`：第二个写 run 失败且无副作用；
- `M18 冲突保护`：同一文件第二个合并 BLOCKED。

## 4. 限制

- 没有自动后台 reaper；`recover` 需要显式调用。
- 长时间单次模型调用期间心跳不刷新；人工 recover 可能误杀（Provider 自身超时会先中止）。
- 重试没有写操作幂等保证；写工具重试可能重复写（当前 write_file 是覆盖，风险有限）。
- 没有跨进程租约；多进程 dispatch 同一 plan 未实现。
