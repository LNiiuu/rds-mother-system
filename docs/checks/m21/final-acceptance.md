# M21 本地模型接入与验证

**状态**：**`PARTIAL`**
**已真实完成**：Ollama 安装、服务健康检查、Provider 协议实现、6 个契约测试。
**未完成**：真实推理——下载的模型 blob 哈希不符/下载中断，未产生任何有效模型输出。
**未使用云端**：没有任何云端 Provider 凭据，也没有发生付费调用。

---

## 1. 环境与硬件

| 项 | 值 |
|---|---|
| OS | Windows 11 家庭版 10.0.26200 |
| CPU | i5-12500H，12 核 / 16 线程 |
| RAM | 15.8 GB |
| GPU | RTX 3050 Ti Laptop，约 4 GB 显存 |
| 磁盘 | C: 49.3 GB / D: 56.2 GB 可用 |
| Ollama | **0.40.16**，`127.0.0.1:11434` 健康 |
| Node | v22.22.2 |

**模型推荐**：4 GB 显存优先 `qwen2.5:3b`（Q4 约 1.9 GB，工具调用支持较好）；
备选 `llama3.2:3b`。7B 会大量 CPU 卸载，不适合本机交互。

---

## 2. Provider 实现

代码：`mars/src/adapters/provider-ollama.js`；注册：`mars/src/composition.js` 的 `providerFactories.ollama`。

- 端点：`POST /api/chat`（`stream:false`）、`GET /api/tags` 健康检查；
- 工具：`tools[].function` 请求，`message.tool_calls` 解析；
- 用量：`prompt_eval_count` / `eval_count`，`usage_source='provider'`；
- 超时/取消：`AbortController`，错误码 `PROVIDER_TIMEOUT` / `PROVIDER_UNREACHABLE` / `PROVIDER_HTTP_<status>`；
- 多轮：历史完全由 Runtime 提供，适配器不重复追加；
- 能力：`sessions/tools/cancel/usage/concurrency/multiTurn=true`，`stream/resume=false`。

**测试**：`node --test mars/tests/arch/provider-ollama.test.js` → **6/6 PASS**（全部注入 fetch，真实协议未核验）。
覆盖请求形状、工具解析、用量来源、多轮去重、健康检查、超时/取消/HTTP 错误映射。

---

## 3. 真实推理尝试（BLOCKED）

### 3.1 qwen2.5:3b

- `ollama pull` 下载模型层 `sha256:5ee4f07c…`，文件大小达到 **1,929,903,008 B**（与清单一致）；
- 实际 SHA-256：`f5960d1d3a1798926e6b471c16b75de85798b9cffb72fa11f5a61337357e6310`；
- 期望 SHA-256：`5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6`；
- **哈希不符 → 模型损坏**。

推理表现（同一损坏文件）：

```text
CUDA error: device kernel image is invalid
（强制 num_gpu:0 后）
message.content = "88888888888888888888888888888888"
done_reason = "length"
```

损坏模型已 `ollama rm qwen2.5:3b` 删除，不作为任何验证结果。

### 3.2 qwen2.5:0.5b

- 清单大小 397,807,936 B；下载到 77%（约 304 MB）后速度降到 20–30 KB/s；
- 已落盘 blob 的 SHA-256：`5a4b02dadc0bbbbdf0395eae6dc45dcf3bd6634535a2684a689595d3b4bb6716`；
- 期望：`c5396e06af294bd101b30dce59131a76d2b773e76950acc870eda801d3ab0515`；
- **哈希不符且未完成**，未注册为模型。

### 3.3 网络证据

- `ollama pull` 多次 `unexpected EOF` / `part stalled`；
- 并发分段下载（8 路、带 SHA-256 校验）仍未能完成；
- 同一时段 GitHub 大文件下载 `schannel: server closed abruptly` / 空响应。

**结论**：真实本地推理 `BLOCKED`，原因是模型下载在传输层被中断/损坏，不是 Provider 代码问题。
原始回显见 `docs/checks/m21/download-failure.log`。
未改用云端，未伪造任何模型输出。

---

## 4. 验收

| 项 | 结果 | 说明 |
|---|---|---|
| Ollama 安装/版本 | **PASS** | 0.40.16，服务可达 |
| 硬件盘点与模型建议 | **PASS** | 见 §1 |
| Provider 协议实现 | **PASS（离线契约；真实协议未核验）** | 5 方法 + 8 能力键，注册到组合根；测试注入 fetch |
| Provider 契约测试 | **PASS（离线）** | 6/6；均为注入 fetch，无真实 socket |
| 基础对话（真实） | **BLOCKED** | 无有效模型 |
| 长上下文（真实） | **BLOCKED** | 同上 |
| 结构化输出（真实） | **BLOCKED** | 同上 |
| Tool Calling（真实） | **BLOCKED** | 同上 |
| 多轮（真实） | **BLOCKED** | 同上 |
| 多 Agent 独立会话（真实） | **BLOCKED** | 同上 |
| 并发推理（真实） | **BLOCKED** | 同上 |
| 超时/失败恢复 | **PASS（协议层）** | 不可达端口 → `PLATFORM/PROVIDER_UNREACHABLE`；契约测试覆盖 |
| 资源消耗 | **PARTIAL** | 记录了安装/下载/损坏模型现象；无有效推理资源数据 |

**M21 判定：`PARTIAL`。** 代码路径与契约完成，真实推理被模型下载阻断。

---

## 5. 复现

```bash
# 服务
ollama --version
curl http://127.0.0.1:11434/api/tags

# 契约测试
node --test mars/tests/arch/provider-ollama.test.js

# 真实验证（模型有效时）
node tooling/m21-ollama-verify.cjs qwen2.5:3b
```

若网络恢复，先 `ollama pull qwen2.5:3b` 并核对 `ollama show`，再跑验证脚本；
脚本会把每次请求的 usage、耗时、并发重叠写入 `docs/checks/m21/execution-record.json`。
