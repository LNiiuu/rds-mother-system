# M20 最终验收

**判定**：`PARTIAL`
**核心限制**：Agent 模型为 mock；T20-02 不能判 PASS。真实 REA W-01/W-02/W-04 与真实调度/证据链已跑通。

---

## 1. 验收表

| 编号 | 项目 | 结果 | 说明 |
|---|---|---|---|
| T20-01 | RDS 任务拆解 | **PARTIAL** | 计划由 runner/计划 JSON 定义；R0 只做汇总，不是真实模型拆解 |
| T20-02 | 多个真实 Agent 参与 | **BLOCKED** | 全部 mock；无模型凭据 |
| T20-03 | 混合调度 | **PASS** | R1 串行 → R5/R6 并发 → R2 报告 → R4 审查 → R0 汇总 |
| T20-04 | 至少一条真实 REA 工作流 | **PASS** | W-01/W-02/W-04 真实执行 |
| T20-05 | 上下文传递 | **PASS** | SUMMARY 写入 base；R5/R6/R4 读取；每 job 独立 packet_id |
| T20-06 | 证据链 | **PASS** | 样本哈希、工具版本、限制、证据路径、报告 |
| T20-07 | 审查机制 | **PARTIAL** | R4 读报告+SUMMARY，但 R4 是 mock，不是独立模型/人审 |
| T20-08 | 成本记录 | **PARTIAL** | 6 runs/13 calls/estimated；无真实 provider 费用 |
| T20-09 | 失败处理 | **PASS** | W-03 BLOCKED 被记录；M18 冲突/恢复测试通过 |
| T20-10 | 最终交付 | **PASS** | execution-record.json + evidence/ + final-report.md |

## 2. 交付物

- `scenario.md`
- `execution-record.json`
- `evidence/SUMMARY.md`
- `evidence/JOINT-PLAN.md`
- `evidence/JOINT-REPORT.md`
- `final-report.md`
- `final-acceptance.md`

## 3. 不能声称的事

- 不能声称“多个真实 Agent 完成了联合任务”。
- 不能声称“W-03 APK 已反编译”或“W-06 已动态分析”。
- 不能声称“R4 的审查是独立模型审查”；它是脚本化审查。
- 不能把 W-04 的启发式函数边界写成编译器符号。
