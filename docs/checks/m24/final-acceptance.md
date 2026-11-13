# M24 真实多 Agent 与多平台联合验证

**状态**：**`PARTIAL`**
**真实完成**：调度、工作区隔离、冲突、恢复、REA 工具调用、证据链、平台适配层。
**未完成**：**真实模型驱动的多 Agent**——本地模型下载损坏，M21 真实推理 `BLOCKED`。
**未执行**：DSH 真实平台接入（环境不存在）。

---

## 1. 场景设计

目标：验证「平台提交 → RDS 接收 → R0/R1 分配 → Development 与 REA 并行 → R3 验证 → R4 审查 → R0 汇总」
的完整链路，并区分真实执行与模拟部分。

| 组件 | 本机能力 | 本轮结果 |
|---|---|---|
| 平台入口 | HTTP / DSH 文件队列 / WorkBuddy bridge 契约 | 平台层真实往返；WorkBuddy/DSH 宿主 `NOT RUN` |
| Agent 模型 | Ollama 服务可用，但无有效模型 | **BLOCKED**（M21） |
| 调度 | `runtime/scheduler.js` | **PASS**（M18 证据） |
| REA | W-01/W-02/W-04 真实；W-05 TShark 真实；W-03/W-06 BLOCKED | **PARTIAL** |
| 证据 | `execution-record.json` + 每工作流 result/report/evidence | **PASS** |

**为什么不用 mock 冒充 M24**：M18/M20 已经跑过 mock 全链路；M24 的任务是“真实模型”，
在模型不可用时继续跑 mock 只会重复已有证据，不能算 M24 通过。因此本轮明确标 `BLOCKED`，
不生成“真实多 Agent 成功”的假记录。

---

## 2. 可复用的真实证据

| 能力 | 证据 | 真实性 |
|---|---|---|
| 7 Agent hybrid 调度、7 个独立 session | `docs/checks/m18/execution-record.json` | 调度/文件/DB 真实；模型 mock |
| 3 job 时间重叠、冲突 BLOCKED、恢复 REQUEUE | 同上 | 真实 |
| REA + 多角色联合（W-01/W-02/W-04） | `docs/checks/m20/execution-record.json` | REA 真实；模型 mock |
| W-05 TShark 4.6.9 真实执行（4 包合成 pcap） | `docs/checks/m19/W-05/result.json` | 真实工具 |
| 平台四适配器替换性 | `mars/tests/arch/platform-adapters.test.js` | 真实 HTTP/文件/桥协议 |
| 平台 HTTP 往返 | 同上（真实 `http.Server`） | 真实 |

这些证据证明“编排与工具链”可用，但**不能**证明“真实模型多 Agent 协作”。

---

## 3. 验收表

| 编号 | 项目 | 结果 | 说明 |
|---|---|---|---|
| T24-01 | RDS 任务拆解 | **PARTIAL** | 计划由 JSON/调用方给出；无真实模型自主拆解 |
| T24-02 | 多个真实 Agent 参与 | **BLOCKED** | 无有效本地模型；无云端凭据 |
| T24-03 | Serial/Parallel/Hybrid | **PASS** | M18：3/3/7 job；并行 3 对时间重叠 |
| T24-04 | 至少一条真实 REA 工作流 | **PASS** | W-01/W-02/W-04/W-05 真实执行 |
| T24-05 | 上下文传递 | **PASS** | 每 job 独立 packet + 工作区；M20 SUMMARY 读写 |
| T24-06 | 证据链 | **PASS** | 哈希、工具版本、argv、限制、结果 |
| T24-07 | 独立审查 | **PARTIAL** | R4 是脚本化审查，不是独立模型/人审 |
| T24-08 | 成本记录 | **PARTIAL** | estimated 用量；无真实 provider 计费 |
| T24-09 | 故障处理 | **PASS（mock 模型）** | 超时/重试/锁/冲突/AGENT_LOST 测试；真实模型故障未验证 |
| T24-10 | 最终交付 | **PARTIAL** | 本里程碑只有报告 + `scenario.md` + 手工汇总的 `execution-record.json`（BLOCKED）；无脚本运行产物 |
| T24-11 | 工作区隔离/冲突 | **PARTIAL** | M18 真实执行，但模型 mock |
| T24-12 | 取消/恢复 | **PASS（mock 模型）** | 取消检查点、AGENT_LOST REQUEUE 测试 |
| T24-13 | 权限治理 | **PARTIAL** | 角色权限表存在；`policy.check` 未接入 Runtime |
| T24-14 | 平台→RDS 端到端 | **NOT RUN** | M22 平台层未接入调度器；DSH/WorkBuddy 宿主不可用 |

**M24 判定：`PARTIAL`。** 端到端平台链路 `NOT RUN`，机器可读记录见 `docs/checks/m24/execution-record.json`。编排/工具/证据是真实的；核心的“真实模型多 Agent”被 M21 阻断。

---

## 4. 解除条件

1. 网络恢复后完成 `ollama pull qwen2.5:3b`，并校验 blob SHA-256；
2. 或用户提供任一真实 Provider 凭据（OpenAI-compatible / Anthropic）；
3. 重跑 `tooling/m21-ollama-verify.cjs`，通过后再跑 M24 联合脚本；
4. 若接 DSH：提供 DSH 可执行文件/队列目录，替换 `platform-dsh` 的 `root` 即可，不需要改 RDS Core。
