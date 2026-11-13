# M18 并发验证

**结论**：三个独立 job 在真实时间窗内重叠执行（3 对重叠）；并发受 `max_concurrency=3` 限制；工作区隔离与冲突保护生效。模型为 mock，不能写成“真实模型并发”。

---

## 1. 实测

`docs/checks/m18/execution-record.json` → `parallel`：

| job | role | run | started_at | finished_at |
|---|---|---|---|---|
| research | R5 | run2e786c337a6e | 14:44:18.720Z | 14:44:19.067Z |
| security | R6 | runcd4bb236d5ec | 14:44:18.741Z | 14:44:19.152Z |
| write | R2 | rund2b6f153b726 | 14:44:18.762Z | 14:44:19.108Z |

- 3 个 job 全部 `SUCCEEDED`；
- `overlapping_pairs=3`（两两重叠）；
- 3 个不同 session；
- plan `merge_status=CLEAN`；
- R2 写入的 `out.txt` 合并回 base。

## 2. 为什么能重叠

`provider-mock` 增加了 `asyncDelay`：`setTimeout` 不阻塞事件循环。旧的 `Atomics.wait` 忙等会把 Node 事件循环阻塞，多个 job 只能串行，不能用来证明并发。

调度器在 `max_concurrency` 内启动 job；每个 job 的 `executeRun` 是 async，等待 mock 延迟时让出事件循环；三个 run 的 `started_at` 落在同一秒内，`finished_at` 晚于其他 job 的 `started_at`，因此是真实时间重叠，不是“同时创建任务”。

## 3. 隔离与锁

- parallel 使用 `copy` 工作区；每个 job 的 root 不同。
- `executeRun` 的锁：`lockScope='workspace'`、`lockTarget=<workspace path>`；不会因为同项目而互相 `WORKSPACE_LOCKED`。
- 共享工作区（serial）仍用 `*`，保持旧语义。

## 4. 冲突保护

`conflict` plan：两个 R2 job 写同一个 `conflict.txt`。

- 第一个合并成功；
- 第二个 `BLOCKED / MERGE_CONFLICT`，错误含 `conflict.txt:DUPLICATE_PATH`；
- plan `PARTIAL`，`merge_status=CONFLICT`；
- base 文件保留第一个写入的值，没有静默覆盖。

## 5. 限制

- 并发是单进程事件循环内的 I/O 并发；没有 worker 线程/多进程。
- mock 的 asyncDelay 只证明调度与时间重叠；真实模型并发未验证（无凭据）。
- 没有优先级抢占：RUNNING 的 job 不会被更高优先级 job 打断。
- 没有全局并发配额跨 plan；每个 plan 自己限制。
