# MARS Token 基线与改造后对比（Phase 1）

> 口径说明：本文件所有数字均为 **本地可复现的估算或实测字节**，不冒充 provider 账单。
> `tokens` 字段来自 MARS 内置估算器（CJK/1.6 + 其他/4，标 `[ESTIMATE]`）；角色包字节由文件系统实测。
> Phase 0 已确认：DSH 会话 `assistant/message.data.usage` 记录的是真实 usage（input/output/cacheRead），
> 可作为后续对账的权威来源；本文件不重复该结论，只做 MARS 前后对照。

## 1. 对照对象

- **前（before）**：`D:\Projects\xingrixiao\docs\runs\TEAMINIT-20261102-134517\prompt-R0..R7.md`
  —— 现役角色执行包，含完整角色卡（§1）+ 项目变量 + 任务卡，整包注入。
- **后（after）**：MARS `compileContext` 为同一任务生成的 packet —— 任务摘要 + 角色路由过滤后的
  记忆（facts/decisions/knowledge）+ 禁止事项 + 证据引用 + 预算/缺失标记；**不含完整角色卡**。
- 因此两者为“方向性对照”，非等价替换：角色卡仍由 RDS 渲染器注入；MARS 负责其中的项目记忆与上下文裁剪。

## 2. 测量条件

- 临时库（不落 `mars/var`），4 条已批准记忆：
  L2 事实（项目栈）、L3 决策（MARS 量化策略）、L4 知识（角色包渲染约定）、L3 决策（role 可见，仅 R3/R4）。
- 角色路由：`mars/config/role-routing.json`（R2/R5/R7 无 decisions；R0/R3/R4/R6 `evidence_direct=true`）。
- 任务：`T-MARS-BASE`（objective: 实现 MARS Phase 1 并完成验收；2 条 acceptance），budget=8000。
- 复现：见 §5。

## 3. 结果

| 角色 | 前：角色包字节 | 前：估算 tokens（字节/4，[ESTIMATE]） | 后：MARS packet tokens [ESTIMATE] | 后：sections | evidence_direct |
|---|---|---|---|---|---|
| R0 | 3,247 | 812 | 189 | task,facts,decisions,knowledge,prohibitions,evidence | 是 |
| R1 | 2,837 | 710 | 153 | task,facts,decisions,knowledge,prohibitions,evidence | 否 |
| R2 | 2,910 | 728 | 116 | task,facts,knowledge,prohibitions,evidence | 否 |
| R3 | 2,893 | 724 | 176 | task,facts,decisions,knowledge,prohibitions,evidence | 是 |
| R4 | 2,886 | 722 | 177 | task,facts,decisions,knowledge,prohibitions,evidence | 是 |
| R5 | 2,782 | 696 | 116 | task,facts,knowledge,prohibitions,evidence | 否 |
| R6 | 2,847 | 712 | 143 | task,facts,decisions,knowledge,prohibitions,evidence | 是 |
| R7 | 2,715 | 679 | 114 | task,facts,knowledge,prohibitions,evidence | 否 |

结论（[INFERENCE]，非账单结论）：

1. 同一任务下，按角色路由产出的 packet 在 114–189 tokens 区间，差异来自 allowed_types 与
   visibility 过滤，而非把全量记忆复制给每个角色——满足“不同角色获得不同上下文”的验收方向。
2. `evidence_direct` 只影响原文恢复权限（R0/R3/R4/R6），不把原始证据正文塞进 packet；
   packet 只引用 fragment/来源版本，原文按需恢复。
3. 与角色包不可直接相减：角色包含完整角色卡（约 7 KB 源文本），MARS packet 不含。
   MARS 的收益来自三处：按角色裁剪、按任务/预算裁剪、同一片段只注入一次（manifest 去重）。
4. 真实节省需在 Phase 1 之外用 provider usage 对照测量；本文件只提供可复现的估算基线。

## 4. 已知限制

- token 估算未校准到 provider tokenizer 口径，误差方向未知（Phase 0 已标注 k≈0.64–0.81）。
- 前侧“角色包字节/4”不是真实注入 token；仅用于量级对照。
- 记忆样例为 4 条；实际项目记忆增长后，packet 受 budget 与 protections 约束，需按真实数据复测。

## 5. 复现命令

```powershell
# 生成 4 条样例记忆并编译 8 个角色的 packet（临时库，不落 mars/var）
node $env:TEMP\mars-baseline-cmp.js
```

脚本位于 `%TEMP%\mars-baseline-cmp.js`（R0 测量用，非仓库内容；逻辑：临时 SQLite +
`store.propose/review` + `compileContext`，输出每角色 tokens/sections/evidence_direct）。

## 6. 变更记录

| 版本 | 日期 | 角色 | 变更 |
|---|---|---|---|
| v1.0 | 2026-11-04 | R0 | 建立 Phase 1 前后对照基线（估算，待 R4 复核） |
