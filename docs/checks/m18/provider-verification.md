# M18 Provider 验证

**结论**：Provider 协议路径已有真实代码；**本机无任何凭据，T18-01 真实模型调用 `BLOCKED`**。不得把 mock 结果写成真实模型 PASS。

---

## 1. 已有适配器

| Provider | 入口 | 鉴权 | 工具 | 用量 |
|---|---|---|---|---|
| `mock` | 确定性脚本 | 无 | 脚本化 toolCalls | `estimated`，`capabilities.usage=false` |
| `openai-compat` | `POST {base}/chat/completions` | `Authorization: Bearer` | OpenAI tools/tool_calls | `prompt_tokens/completion_tokens` |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | `input_schema` / `tool_result` | `input_tokens/output_tokens` |

健康检查只检查配置，不发探测请求；真实调用前由 Runtime 检查 `healthCheck().ok`，不可用则 `PROVIDER_UNAVAILABLE`，不静默降级为 mock。

## 2. 本机状态

```text
MARS_LLM_BASE_URL=unset
MARS_LLM_API_KEY=unset
MARS_LLM_MODEL=unset
MARS_ANTHROPIC_API_KEY=unset
MARS_ANTHROPIC_MODEL=unset
本地 Ollama 127.0.0.1:11434 -> connection refused
```

因此 T18-01 无法执行；没有注册账号、没有购买服务、没有发起付费请求。

## 3. 多轮历史修复（M18）

修复前：Provider 每次把 Runtime 传入的完整 `messages` 追加到自己的 session，第二轮出现重复 `system/user`。

修复后：Provider 不再累计 `payload.messages`，会话只保留身份/模型/累计用量；历史完全由 Runtime 提供。

新增契约测试（`mars/tests/arch/provider-adapters.test.js`）：

- OpenAI：第二轮请求 4 条（system/user/assistant/tool），system 仅 1 条、user 仅 1 条；
- Anthropic：第二轮 `system` 顶层仅 1 条，`messages` 3 条（user/assistant/user(tool_result)）。

## 4. 真实调用验收

| 项 | 状态 | 说明 |
|---|---|---|
| T18-01 至少一个真实 Provider 成功 | **BLOCKED** | 无凭据；未发起网络请求 |
| 真实多 Agent 连续调用 | **BLOCKED** | 依赖 T18-01 |
| Mock 全链路 | **PASS** | 文件、测试、会话、调度真实；模型文本是脚本 |
| 协议契约测试 | **PASS** | 8 个 test（含多轮历史 2 个） |

## 5. 接上真实模型后必须补做

1. 设置 `MARS_LLM_*` 或 `MARS_ANTHROPIC_*`；
2. `rds agent providers` 确认 `configured=true`；
3. 跑一次单 Agent 两轮工具调用；
4. 跑一次 2–3 Agent 链，核对 session、usage_source、错误码；
5. 若 Anthropic 多工具结果报 400，检查 tool_result 是否应合并到单条 user 消息。
