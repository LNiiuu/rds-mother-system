# M18 调度验证

**结论**：任务队列、依赖、优先级、READY 识别、最大并发、取消、超时、重试、状态追踪、结果收集均已实现；串行/并发/混合三种模式用同一调度器跑通。

---

## 1. 调度语义

- 依赖 DAG：创建时检查未知依赖、自依赖、环。
- READY：所有依赖 `SUCCEEDED`。
- WAITING：依赖未完成。
- BLOCKED：依赖失败/取消/阻塞，或合并冲突。
- 优先级：数值大优先；同优先级按 created_at、job_key。
- 最大并发：`max_concurrency`，默认 serial=1，其它=3。
- 重试：调度级重试，`max_attempts`；只对 `RUN_TIMEOUT` / Provider 可重试错误；不可重试错误一次失败。
- 取消：`cancel-job` 置 `cancel_requested`，READY/WAITING 立即 CANCELLED；RUNNING 调 `requestCancel`，在 run 的下一个检查点收敛。
- 超时：`timeout_ms` 传给 run；run 落 `TIMEOUT`，job 落 FAILED/RUN_TIMEOUT（可重试时重试）。
- 恢复：`recover` 扫描 RUNNING 且心跳陈旧的 job；run 标 `AGENT_LOST`，job 重排队或 FAILED。
- 结果收集：每个 job 的 run_id、usage、changes、workspace、error 落 `orchestration_jobs.result_json`。

## 2. 串行证据

`docs/checks/m18/execution-record.json` 的 `serial`：

```text
plan status = SUCCEEDED
jobs = design:SUCCEEDED → impl:SUCCEEDED → verify:SUCCEEDED
R1 finished_at 2026-11-13T14:44:17.716Z
R2 started_at  2026-11-13T14:44:17.749Z
R3 started_at  2026-11-13T14:44:18.090Z
```

依赖顺序成立；R2 的 `write_file` 真的改了 `src/sum.js`；R3 的 `run_test` 返回 `tests=1 pass=1 fail=0`。

## 3. 混合证据

`hybrid`：7 个 job，plan `SUCCEEDED`，`merge_status=CLEAN`。

- R1 `arch`（shared）先写 `DESIGN.md`；
- R2 `impl`、R5 `research`、R6 `security` 依赖 arch，并发（copy）；
- R2 的 `src/sum.js` 合并回 base；
- R3 `verify` 依赖三者，`run_test` 通过；
- R4 `review` 读 `src/sum.js`；
- R0 `summary` 读 `DESIGN.md` 与 `src/sum.js`。

## 4. 命令

```bash
rds orchestrate dispatch --project demo --plan-file plan.json --max-concurrency 3
rds orchestrate jobs --plan <plan_id>
rds orchestrate job --job <job_id>
rds orchestrate cancel-job --job <job_id> --reason "user cancel"
rds orchestrate recover --plan <plan_id> --stale 120000
rds orchestrate merge --plan <plan_id> --apply
```

## 5. 限制

- 单进程调度；多进程同时 dispatch 同一 plan 未做租约/抢占。
- 取消只在 run 检查点收敛；不中断正在进行的单次 Provider HTTP（Provider 自己的 AbortController 才管）。
- 调度级重试会新建 run；旧 run 保留，不覆盖。
- `worktree` 基于 HEAD，不包含未提交修改。
