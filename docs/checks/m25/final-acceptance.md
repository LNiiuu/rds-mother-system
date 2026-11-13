# M25 最终验收（测试、审核、复核、发布审计）

**判定**：**`PASS`（审核流程完成） / `CONDITIONAL GO`（发布）**
**说明**：M25 验收的是“审核闭环是否真的执行”，不是“产品能力全部完成”。

---

## 1. 四层闭环

| 层 | 要求 | 结果 | 证据 |
|---|---|---|---|
| 1 自动测试 | 单元/集成/架构/契约/Provider/REA/多 Agent/安全/回归 | **PASS** | `npm test` 318/318；layers/docs/config/baseline/pack 全 PASS |
| 2 独立审核 | 独立 Reviewer 重读需求、代码、Diff、测试、日志 | **PASS** | `docs/checks/m25/independent-review.md`（571 行） |
| 3 二次复核 | 另一 Reviewer 检查遗漏、PASS 证据、PARTIAL/BLOCKED 是否隐藏 | **PASS** | `docs/checks/m25/second-review.md`（234 行） |
| 4 发布审计 | 分支/HEAD/远端/工作区/Diff/敏感信息/范围/文档/依赖/测试/风险 | **PASS** | `docs/checks/final/pre-push-release-audit.md` |

---

## 2. 两轮审核的结论变化

### 第一轮（independent-review）

- 总裁定：**不可发布**。
- P0-1：M25 未完成、M21–M25 零提交。
- P0-2：M23 W-01 数字 584/146/376 与证据 611/160/406 不一致。
- P1：能力矩阵全 true、平台层无生产接线、权限未标注、T24-10 无证据、M21 协议 PASS 建立在 fake fetch、端到端未单列、本机路径。

### 第二轮（second-review）

- P0-1 变为 **PARTIAL**：代码已提交（`3a8f15c`），文档/审计仍未提交；本轮已补齐。
- P0-2 **FIXED**。
- 7 条 P1：5 条 FIXED、2 条 PARTIAL（M21 日志措辞、本机路径）。
- 新发现 P0-A：`npm test` 317/318，README 指向未生成的发布审计；本轮已生成审计并转绿。
- 新发现 P1-A/P1-B：M24 记录是手写声明卡、M21 日志“逐字”措辞不成立；已标注/修正。
- 第二轮结论仍为“不可发布（当时状态）”。

### 整改后

- `npm test` **318/318 PASS**；
- `docs:check` 扫描 254 个 Markdown，全部链接可达；
- W-01 数字统一为 611/160/406（M23 时点）；
- 能力矩阵出现 `false`，负路径测试断言 `PLATFORM_UNSUPPORTED`；
- 平台层“未接 scheduler / 权限未实现 / DSH/WorkBuddy 为模拟”已明写；
- M24 T24-10 降为 PARTIAL，新增 `scenario.md`、`execution-record.json`（标注手工汇总）、`T24-14 NOT RUN`；
- M21 协议项改为“离线契约；真实协议未核验”，补 `download-failure.log`（标注非逐字）；
- W-05 证据与本机路径已脱敏。

---

## 3. 未因审核而改变的事实

- M21 真实推理仍 **BLOCKED**；
- M23 W-03/W-06 仍 **BLOCKED**；
- M24 真实模型多 Agent 仍 **BLOCKED**、平台→RDS 端到端 **NOT RUN**；
- M22 平台层仍是“库 + 契约测试”，不是生产接入；
- 没有为了“全绿”补 mock 或改写结论。

---

## 4. 发布建议

**技术条件**：fast-forward 成立（0 behind、无 merge、无 Tag 移动）。
**内容条件**：`CONDITIONAL GO`——可以 Push，但必须在说明中保留 `PARTIAL/BLOCKED`，不得宣称“全部完成”。
**P0**：无。
**P1**：真实模型、平台端到端、W-03/W-06 为能力缺口，不是发布阻断。

**用户授权是唯一剩余关口。**
