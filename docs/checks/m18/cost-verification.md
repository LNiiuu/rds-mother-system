# M18 成本验证

**结论**：每个 job 的用量写入 `agent_usage`，按 run/agent 可查；本机全部为 `estimated`，没有 provider 真实用量，也没有费用。不能写成“真实成本已验证”。

---

## 1. 实测汇总

`docs/checks/m18/execution-record.json`：

| plan | runs | model calls | input tokens | output tokens | usage sources |
|---|---:|---:|---:|---:|---|
| serial | 3 | 6 | 141 | 15 | estimated ×3 |
| parallel | 3 | 6 | 102 | 15 | estimated ×3 |
| hybrid | 7 | 15 | 307 | 48 | estimated ×7 |
| conflict | 2 | 4 | 62 | 8 | estimated ×2 |

- 全部 `provider=0`、`unknown=0`，即没有任何真实 Provider 用量混入。
- 费用：**0 元**；未发起付费 API 请求。
- 预算：M13 的 `budgetGate` 四档（NORMAL/WARNING/CRITICAL/EXCEEDED）测试通过；项目预算拒绝路径已修为 `FAILED / PROJECT_BUDGET_EXCEEDED`，不再留下 PENDING run。
- 成本账本：每个 job 的 `run_id` 可通过 `rds usage show --run <id>` 反查。

## 2. 口径

- `estimated` 来自 `util.estimateTokens`（字符启发式），不是 tokenizer。
- mock 的 `capabilities.usage=false`，其 `usage_source` 固定 `estimated`。
- 真实 Provider 只有响应带 usage 时才记 `provider`；没有则 `unknown`，由 Runtime 落 estimated。
- 三者永不混算；`usageOfProject` 按 source 分组。

## 3. 限制

- 没有真实 tokenizer，估算与真实计费可能有偏差。
- 没有模型单价表，未计算金额（报告中的 0 元是“未调用付费服务”，不是“调用后免费”）。
- 预算按 token 数，不按金额；并发 plan 的总预算没有跨 job 的硬上限（每个 job 自己的 budget）。
