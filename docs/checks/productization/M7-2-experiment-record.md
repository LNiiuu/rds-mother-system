# M7-2 实验原始记录（A/B 两组）

**日期**：2026-11-12（+08:00）
**性质**：`EVIDENCE`。原始数据 + 合规检查。分析见 [M7-3-analysis.md](M7-3-analysis.md)。
**实验编号**：M7-EXP-1；方案见 [M7-1-protocol.md](M7-1-protocol.md)。

---

## 1. 预注册完整性

执行前后各校验一次，**四个文件哈希完全一致**，实验有效：

| 文件 | 预注册 = 执行后 |
|---|---|
| `spec/TASK.md` | `2c8e6236b15a1271d8223d82cc80c37833d3f02b4137b88f9e3957077cfb6579` ✓ |
| `spec/CR1.md` | `1a8bd168f9915ab3eb8eb8a63f85470bb2db808c35cde900ccacc620f354a9e2` ✓ |
| `spec/CR2.md` | `1906dc5b7f83659b3abce2f941423bbbdcaab9ff839a1035877c19b4a0874867` ✓ |
| `_acceptance/acceptance.test.js` | `ccf439c4385d083ed69a1e9c2f154fc1e864f8bee0bfe417cc81f338001e9387` ✓ |

> 协议正文写「18 个用例」，实际文件是 **19 个**（A1–A12 + C1–C7）。这是撰写时的计数笔误，
> 以文件与哈希为准；两组跑的是同一份 19 例，不影响公平性。

---

## 2. 场地与时间线

| 项 | A 组 | B 组 |
|---|---|---|
| 目录 | `D:\M7-lab\arm-a` | `D:\M7-lab\arm-b` |
| 起始 | 2026-11-12T12:14:27.646Z | 2026-11-12T12:24:02.391Z |
| 结束 | 2026-11-12T12:23:44.778Z | 2026-11-12T12:26:15.935Z |
| 墙钟 | **557 s（9m17s）** | **134 s（2m14s）** |
| 执行者 | 同一模型、同一会话、同一工具集 | 同左 |
| 变更下发 | v1 → CR1 → CR2 | v1 → CR1 → CR2 |

B 组另有一套隔离的 MARS 数据目录 `D:\M7-lab\mars-data`，未触碰 `D:\M1` 的数据库与身份文件。

---

## 3. A 组记录

### 3.1 过程

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | 读 `TASK.md` | 1 次读取 |
| 2 | 写 `package.json`、`bin/xsum.js`、`src/parse.js`、`src/aggregate.js`、`src/cli.js` | 5 个文件 |
| 3 | 写 `test/xsum.test.js`（4 例） | — |
| 4 | `npm test` | **4/4 通过**（一次通过，无返工） |
| 5 | 读 `CR1.md`，验证 `--group-by`，补 2 例测试 | 源码**无需修改**（v1 已按通用分组键实现） |
| 6 | `npm test` | **6/6 通过** |
| 7 | 读 `CR2.md`，验证基准汇率，补 2 例测试 | 源码**无需修改** |
| 8 | `npm test` | **8/8 通过** |
| 9 | 终检：`--dry-run` 不写文件、`--out` 幂等（`cmp` 逐字节一致）、CSV 末尾换行 | 全部符合 |

### 3.2 产出

| 文件 | 行数 |
|---|---|
| `bin/xsum.js` | 8 |
| `src/parse.js` | 128 |
| `src/aggregate.js` | 71 |
| `src/cli.js` | 231 |
| `test/xsum.test.js` | 41（8 例） |
| **合计** | **479 行 / 5 个文件** |

### 3.3 隐藏验收

```
# tests 19
# pass 19
# fail 0
```

原始输出：`D:\M7-lab\logs\arm-a-acceptance.txt`。

---

## 4. B 组记录

### 4.1 MARS 拓扑（全部为真实调用）

| 项 | 值 |
|---|---|
| 数据库 | `D:\M7-lab\mars-data\mars.db` |
| 身份 | `b-r0`（R0 实施）、`b-r4`（R4 审批），双身份 |
| 项目 | `xsum`，policy `default` |
| 记忆 | **8 条**全部 approved（v1 六条 + CR1 一条 + CR2 一条） |
| 上下文包 | 3 份：`packet-v1.json` 10 105 B / `packet-cr1.json` 10 581 B / `packet-cr2.json` 11 101 B |
| 编排 | `plan` 1 次（class=implementation，agents=R2,R3）、`start` 1 次、`feedback` 1 次 |
| 审计动作总数 | **33**（`memory.propose` 8、`memory.review` 8、`context.compile` 3、`memory.list` 12、`project.register` 1、`orchestrator.plan` 1） |

### 4.2 过程

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | `init` / `init-dev`（R0）/ `project register` | 成功；R0 token 立即落盘 |
| 2 | `orchestrate plan` | `task_class=implementation`、`risk=low`、`agents=R2,R3` |
| 3 | 6 条决策 `put` + R4 `review` | 6/6 approved |
| 4 | **第一次审批脚本失败**：Node 读 `/d/M7-lab/...` 被解释为 `D:\d\...` | 6 条仍 proposed；**1 次返工** |
| 5 | 用 `process.env.MARS_PRINCIPALS + '.r4'` 重试 | 6/6 approved |
| 6 | `compile` v1（4000 预算） | `tokens=240/4000`，但文件 **10 KB**；`missing` 含 1 条 blocking |
| 7 | 读 `packet-v1.json` | 全文读取 |
| 8 | 读 `TASK.md` | **仍需读任务书**（包的 `sec_task` 只有「任务: XSUM-1」） |
| 9 | 写 `package.json`、`bin/xsum.js`、`src/pipeline.js`、`test/xsum.test.js` | 4 个文件 |
| 10 | `npm test`（脚本写成 `node --test test/`） | **失败**：Node 把目录当模块 → **1 次返工** |
| 11 | 改脚本为 `node --test` | **4/4 通过** |
| 12 | CR1：`put` + `review` + `compile`，读包内决策 | 源码无需修改；补 2 例 → **6/6** |
| 13 | CR2：`put` + `review` + `compile`，读包内决策 | 源码无需修改；补 2 例 → **8/8** |
| 14 | 终检：`--dry-run` 不写、`--out` 幂等 | 符合 |
| 15 | `orchestrate start` → `feedback(tokens=34507, quality=1, rework=1)` | run 状态 `completed`，预算 34 507/200 000 |

### 4.3 产出

| 文件 | 行数 |
|---|---|
| `bin/xsum.js` | 232 |
| `src/pipeline.js` | 181 |
| `test/xsum.test.js` | 35（8 例） |
| `package.json` | 9 |
| **合计** | **449 行 / 4 个文件** |

### 4.4 隐藏验收

```
# tests 19
# pass 19
# fail 0
```

原始输出：`D:\M7-lab\logs\arm-b-acceptance.txt`。

---

## 5. 原始指标

数据来源：会话记录按 marker 窗口聚合（`logs/analyze.js` → `logs/metrics.json`）。

| 指标 | A | B | 差（B−A） |
|---|---|---|---|
| 墙钟（s） | 557 | **134** | −423（−76%） |
| 模型调用次数 | 17 | 20 | +3 |
| prompt tokens | 3 617 741 | 5 450 557 | +1 832 816 |
| completion tokens | 14 220 | 12 452 | −1 768（−12.4%） |
| cached tokens | 3 357 696 | 5 437 312 | +2 079 616 |
| cache miss | 260 045 | 13 245 | −246 800 |
| 缓存命中率 | 92.8% | 99.8% | +7.0pp |
| **增量 prompt**（Σ 正增量） | **20 556** | **22 055** | **+1 499（+7.3%）** |
| **边际 token**（增量 prompt + completion） | **34 776** | **34 507** | **−269（−0.8%）** |
| 工具输出字节 | 14 267 | 31 164 | +16 897（+118%） |
| 读取文件次数 | 3 | 2 | −1 |
| 重复读取 | 0 | 0 | 0 |
| 重复读取率 | 0% | 0% | 0 |
| 非预期失败命令 | 0 | **2** | +2 |
| 返工次数 | 0 | **1** | +1 |
| 隐藏验收 | 19/19 | 19/19 | 0 |

### 5.1 为什么不能直接用 prompt tokens 比较

`prompt_tokens` 是**每次调用携带的完整上下文**。B 组在 A 之后执行，窗口内已包含 A 的全部记录，
所以 B 的 prompt 总量必然更大（5.45M vs 3.62M）。这个数字**不能**解释为「B 更贵」。

可比的量是：
- **增量 prompt**（每次调用新增的上下文）：A 20 556 / B 22 055；
- **completion**（模型实际产出）：A 14 220 / B 12 452；
- 两者之和（边际 token）：A 34 776 / B 34 507，**几乎相等**。

---

## 6. 有效性检查（V1–V5）

| # | 检查 | 结果 |
|---|---|---|
| V1 | A 组未使用 MARS | 窗口内 `Bash` 6 次，含 `rds` 的命令 **0** 次；无 `MARS_` 变量 ✓ |
| V2 | B 组确实用了 MARS | `memory.propose` 8 / `memory.review` 8 / `context.compile` 3 / `orchestrate plan` 1 / `start` 1 / `feedback` 1 ✓ |
| V3 | 同题同尺 | 四个预注册哈希执行前后一致；两组同一份 19 例 ✓ |
| V4 | 未改产品 | `D:\M1` HEAD 仍为 `ada7848`，暂存区 0；工作区 51 = 原有 49 + 本次新增 2 份 M7 文档；`mars/src` 无改动 ✓ |
| V5 | 验收可跑 | 两组都用 `ARM_DIR=<dir> node --test acceptance.test.js`，同一 Node 22.22.2 ✓ |

---

## 7. 异常与偏差（全部如实记录）

| # | 事件 | 组 | 影响 |
|---|---|---|---|
| 1 | 审批脚本用 `/d/...` 路径，Node 解析为 `D:\d\...`，首次审批全失败 | B | 计入返工 1 次；额外 6 次无效 review 调用 |
| 2 | `node --test test/` 被 Node 22 当成模块路径 | B | 计入返工 1 次 |
| 3 | 上下文包 10 KB 只承载 240 tokens 内容；`sec_task` 不含任务正文 | B | B 仍必须读 `TASK.md`；包的价值被结构开销抵消 |
| 4 | `orchestrate plan` 对同一任务换措辞会给出不同分类（M7-0 探针为 `verification`，B 运行时为 `implementation`） | B | 说明分类是关键词规则，稳定性有限 |
| 5 | B 组墙钟显著更短 | B | **不能归因于 MARS**：B 是第二次执行同一任务，存在明显学习效应 |
| 6 | 两组重复读取均为 0 | 双方 | 单会话 + 强记忆使「重复读取」指标退化，无法区分工具价值 |

### 7.1 最重要的偏差：执行者已知全部需求

任务书、CR1、CR2 都由实验者（也是执行者）撰写，因此**两组在写 v1 时就已知道未来变更**，
A 组的实现天然预留了 `--group-by` 与 `base/rates` 分支，导致两个 CR 阶段都**不需要改源码**。

- 方向：这对「记忆/上下文工具」是**不利**的——预知替代了记忆。
- 后果：本实验**不能**检验「需求演化时的上下文保持能力」。
- 结论：本实验测到的是**流程与协调成本**，不是记忆收益。

---

## 8. 原始文件位置

本机工作路径（不进仓库）：

| 内容 | 路径 |
|---|---|
| 时间标记 | `D:\M7-lab\logs\markers.txt` |
| 指标 JSON | `D:\M7-lab\logs\metrics.json` |
| A 验收输出 | `D:\M7-lab\logs\arm-a-acceptance.txt` |
| B 验收输出 | `D:\M7-lab\logs\arm-b-acceptance.txt` |
| 独立算盘 | `D:\M7-lab\_acceptance\oracle.js` |
| 两组源码 | `D:\M7-lab\arm-a`、`D:\M7-lab\arm-b` |
| MARS 数据 | `D:\M7-lab\mars-data`（含 3 份 packet、memory-ids.json） |

### 8.1 仓库内副本（可脱离本机复核）

`docs/checks/m7/` 保存了**全部可复核材料**：任务书、两份 CR、隐藏验收测试、独立算盘、
四个夹具、时间标记、指标 JSON、两份验收输出。复制后哈希与预注册值逐项一致（见该目录 README）。
两组源码未入库（属实验产物，非产品代码），路径见上表。
