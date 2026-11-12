# 多 Agent 使用说明（M12–M13）

> 适用版本：Schema v7 / `rds` 0.1.0
> 本文所有命令都在本机实测过；未能实测的部分在 §7 明确标出。

---

## 1. 它是什么，不是什么

**是**：一个执行层。它负责「谁在什么会话里、用什么上下文、调了哪些工具、花了多少、留下了什么证据」。

**不是**：Agent 运行时沙箱，也不是模型。真正的推理由外部 provider 完成，代码执行由受控工具完成。

| 你可能以为 | 实际 |
|---|---|
| 有了 `agent` 命令就能自动多 Agent 协作 | 需要你定义 Agent、给出任务、发起链；系统负责隔离、权限、交接、审计 |
| 角色 = 权限沙箱 | 角色是**权限声明 + 运行时校验**；同一 OS 用户换个 token 就能换角色 |
| `R7` 能帮你 push | **不能**。`git.push` 没有任何角色拥有，永远拒绝 |
| mock 跑通 = 真实模型跑通 | 不等价。mock 的用量标 `estimated`，执行记录标 `simulated` |

---

## 2. 五分钟跑通（不花钱）

```bash
export MARS_DB=/tmp/demo/mars.db
export MARS_PRINCIPALS=/tmp/demo/principals.json

rds init
rds init-dev --principal demo-r0 --projects demo --roles R0,R1,R2,R3,R4
export MARS_TOKEN=<上一步打印的 token>

rds project create --project demo --name Demo --project-root ./

# 建两个 Agent：R2 写代码，R3 跑测试
rds agent create --project demo --to-role R2 --name impl --provider mock --mock-file ./r2.json
rds agent create --project demo --to-role R3 --name verify --provider mock --mock-file ./r3.json

# 串成交接链
rds agent chain --agents <r2-id>,<r3-id> \
  --objective "实现并验证" --task T-1 --task-file ./TASK.md --workspace ./
```

`r2.json` 的形状（确定性脚本，用于把执行层跑通）：

```json
{
  "turns": [
    { "text": "写实现", "toolCalls": [{ "name": "write_file", "args": { "path": "src/a.js", "content": "module.exports={}\n" } }] },
    { "text": "实现完成", "usage": { "input": 400, "output": 80 } }
  ]
}
```

跑完看结果：

```bash
rds run list --project demo
rds trace inspect --run <run_id>
rds usage show --project demo
```

---

## 3. 接真实模型

只支持 OpenAI Chat Completions 形状与 Anthropic Messages 形状两种协议。**不绑定厂商**，换 baseUrl 即可。

```bash
export MARS_LLM_BASE_URL=https://api.deepseek.com/v1
export MARS_LLM_API_KEY=sk-...
export MARS_LLM_MODEL=deepseek-chat

rds agent providers            # 先看是否 configured=false
rds agent create --project demo --to-role R2 --name impl-real \
  --provider openai-compat --model deepseek-chat
rds agent start --agent <id> --objective "..." --workspace ./
```

Anthropic 形状：

```bash
export MARS_ANTHROPIC_API_KEY=sk-ant-...
export MARS_ANTHROPIC_MODEL=claude-...
# --provider anthropic
```

**凭据只从环境变量读，不写进仓库、不打印到日志。** 缺凭据时 `agent start` 直接失败（`PROVIDER_UNAVAILABLE`），**不会静默降级成 mock**。

---

## 4. 上下文从哪来

`agent start / chain` 有三条路，按优先级：

1. `--packet <json>`：用现成上下文包（跳过编译）
2. `--task-file <md>`：任务正文写进 `sec_task`，再按角色与预算编译
3. 都不给：编译一个只有任务 ID 的包

第二种是推荐做法。编译产物会写一条 `context_runs`（项目/任务/角色/估算 token/预算状态），可在 `rds context list --project demo` 查到。

预算两种：`--budget`（本次 run）与项目级 `config_json.budget_tokens`（累计）。超了就是 `FAILED / BUDGET_EXCEEDED`，不会"跑完再说"。

---

## 5. 工具面：四个工具，没有 shell

| 工具 | 谁有权限 | 说明 |
|---|---|---|
| `read_file` | 全部角色 | 200 KB 上限，二进制拒绝 |
| `list_dir` | 全部角色 | 最多 500 项 |
| `write_file` | R1 / R2 | 400 KB 上限，自动建父目录，返回 SHA-256 |
| `run_test` | R2 / R3 | 只跑 `node --test`，120 s 超时 |

**没有 `run_command`**。这是刻意的：模型要求执行 `rm -rf` 时，协议层无处表达。

路径约束：`realpath` 后比较相对路径，`../` 与绝对路径都拒绝（`TOOL_PATH_ESCAPE`）。

---

## 6. 可靠性与治理（M13）

| 机制 | 行为 |
|---|---|
| 工作区锁 | 执行前按项目拿写锁；拿不到 → `FAILED / WORKSPACE_LOCKED`，不排队、不覆盖 |
| 重试 | 只对 5xx / 不可达 / 超时；退避 250→500→1000→上限 4000 ms；`--max-attempts` |
| 心跳 | 每次循环刷新；`rds agent reap --stale 120000` 把心跳停止的 run 标 `FAILED / AGENT_LOST` |
| 取消 | `rds agent cancel --run <id>`，在下一个检查点收敛 |
| 幂等 | `--idempotency-key` 同项目内唯一，重复提交返回同一 run |
| 敏感操作 | `rds policy list` 看全矩阵；`file.delete` / `git.push` / `release` / `network` **任何角色都没有** |

---

## 7. 已知边界（不承诺的部分）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实模型调用 | **NOT RUN** | 本机无任何 provider 凭据，全部验证基于 mock |
| 流式输出 | 未实现 | 能力清单里 `stream: false`，不谎称 |
| 会话恢复 | 未实现 | `resume: false` |
| 并发执行 | 未实现 | 有锁防止互相覆盖，但不做并行调度 |
| 进程级隔离 | **不做** | 与本地优先冲突；明确声明不是沙箱 |
| Windows 以外 | 未跑 M12–M17 | M6 的 macOS 结论不覆盖本轮新增代码 |
