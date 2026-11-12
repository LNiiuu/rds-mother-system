# M8-3 / M8-5 端到端验证记录

**日期**：2026-11-12（+08:00）
**性质**：`EVIDENCE`
**原始日志**：`docs/checks/m8/e2e-flow.txt`、`docs/checks/m8/install-flow.txt`、`docs/checks/m8/recovery.txt`

---

## 1. M8-3：核心流程的九个环节

逐环节标注「代码强制」还是「Markdown / 提示词约定」。
**只有标「强制」的环节，才能说系统具备该能力。**

| # | 环节 | 代码强制？ | 证据 / 实际情况 |
|---|---|---|---|
| 1 | 任务输入 | **部分强制** | `--task-file` 不存在时 exit 2；文件格式只做存在性检查，不解析语义 |
| 2 | 任务识别与规划 | **否（可选）** | `orchestrate plan` 可运行，但没有任何命令要求先 plan；分类是关键词规则（见 §1.1） |
| 3 | 关键决策写入 | **强制** | `put` 需要 token / project 成员 / 角色 / source / version；写入状态固定为 `proposed` |
| 4 | 审批 | **强制** | 同身份审批被拒（`SELF_REVIEW_DENIED`）；需要 R0/R4 角色；状态机限制转移 |
| 5 | 上下文包编译 | **强制** | authz + 预算裁剪 + `context-packet` schema 校验；失败即报错，不产出半成品 |
| 6 | 上下文包读取 | **否** | 包只是一个文件。读不读、读多少，靠执行者自觉 |
| 7 | Agent 执行 | **否** | R0–R7 角色卡是 Markdown；代码只强制 R0/R4 两种权限 |
| 8 | 结果验证 | **否（MARS 不验）** | 验证靠项目自己的 `npm test`；MARS 没有「验收测试」这一层 |
| 9 | 审计与追溯 | **写侧强制，读侧手动** | `put/review/compile/register/list` 会自动写 audit；`orchestrate feedback` 要人手填 |

### 1.1 规划环节的实测缺陷

同一个任务，换措辞会得到不同分类：

| objective | 分类 | 派发角色 |
|---|---|---|
| 「实现交易流水聚合 CLI 并补测试」 | **`verification`** | R3 |
| 「实现交易流水聚合 CLI xsum，含 CSV/JSONL 解析、去重、汇率换算与聚合输出」 | `implementation` | R2, R3 |

「并补测试」这几个字把任务拉进了「验证」类。关键词规则是可解释的，但**不稳定**。
M8 没有改它（超出本阶段范围），只把事实记下来。

### 1.2 必须由人完成的步骤

| 步骤 | 人工要求 |
|---|---|
| 写任务正文 | 准备 md/txt，用 `--task-file` 传入 |
| 决定是否规划 | `orchestrate plan` 不是强制门；高风险任务是否 `approve` 也靠人判断 |
| 读包并执行 | 没有任何机制能强制 Agent 只按包内容行事 |
| 验收 | 自己准备测试并运行；MARS 不判断任务是否完成 |
| 回填运行结果 | `orchestrate feedback --tokens --quality --rework` 需要手工填 |
| 身份治理 | `principal add/revoke/list` 未实现；撤销身份要手工改文件 |

---

## 2. 端到端实测（源码树的独立数据目录）

一次连续执行，全部退出码 0（除故意验证的失败）：

| 步 | 命令 | 结果 |
|---|---|---|
| 1 | `rds init` | exit 0 |
| 2 | `rds init-dev --principal e2e-r0 --roles R0` | exit 0，token 48 位 |
| 3 | `rds project register --project demo` | exit 0 |
| 4 | `rds put --type L3 ...` | `mem_8d57ef3dfb36`，proposed |
| 5 | `rds init-dev --principal e2e-r4 --roles R4 --add` | exit 0，**旧 token 未失效** |
| 6 | `rds review --token <R4> ... --decision approved` | exit 0，status=approved |
| 7 | `rds compile --task-file TASK.md --format md` | exit 0，5 228 B |
| 8 | `rds audit --project demo` | **7 条**：compile 1、list 3、review 1、propose 1、register 1 |
| 9 | `rds orchestrate plan` | exit 0，但分类为 `verification`（见 §1.1） |

---

## 3. M8-5：干净克隆验证

```
git clone /d/M1 → /tmp/clean-m8
HEAD = c0fe381   dirty = 0   跟踪文件 = 373
```

| 门禁 | 结果 |
|---|---|
| `npm run verify` | doctor `status: ok (fail=0 warn=1 checks=11)`；CONFIG PASS（json=44 / yaml=4）；LAYERS PASS（problems=0）；DOCS PASS；**GATE PASS 210/210** |
| `baseline-capture --check` | **BASELINE PASS**（7 个面一致，含新文件登记） |
| `npm pack` + `pack-check` | **110 个文件 / 120 426 B**；PACK PASS |
| `ci-smoke.sh` | **SMOKE PASS**：安装 → doctor → init → 写入 → 审批 → 检索 → 编译 |

**不是只在开发者工作区验证**：以上全部在干净克隆里完成，克隆的 `dirty=0`。

---

## 4. 安装后的用户流程（发行包）

```
npm install -g ./rds-mother-system-0.1.0.tgz --prefix <临时目录>
```

| 步 | 结果 |
|---|---|
| `rds --version` | `0.1.0` |
| `rds doctor` | `status: ok (fail=0 warn=0 checks=11)` |
| `rds init` | exit 0 |
| `rds init-dev --principal u-r0` | exit 0，token 48 位 |
| **重复** `rds init-dev` | **exit 1**，`IDENTITY_EXISTS`，文件未改 |
| `rds init-dev --principal u-r4 --add` | exit 0 |
| 旧 R0 token 继续用 | `rds list` exit 0 |
| `project register` / `put` / `review` | 全部 exit 0，`status=approved` |
| `rds compile --task-file ./TASK.md --format md` | exit 0，**1 067 B**，`tokens=74/4000` |
| 包内任务正文 | `只读本地` 命中 1 次 |
| `rds audit` | **8 条**，覆盖 5 类动作 |

完整日志：`docs/checks/m8/install-flow.txt`。

---

## 5. 数据恢复与安全边界

用仓库自带脚本做一次「备份 → 校验 → 恢复到新路径」：

| 步 | 结果 |
|---|---|
| `mars-db-backup.js --db <e2e 库>` | 155 648 B，`integrity: ok`，counts：memories 1 / fragments 4 / manifests 1 / audit 7 |
| `--verify <快照>` | 同一哈希 `42b0a754…`，integrity ok |
| 复制快照到新目录，用 `rds list` 查询 | **1 条 approved**，内容完整 |

结论：**库可以备份、校验、恢复**；恢复后的库能正常读写。
日志：`docs/checks/m8/recovery.txt`。

安全边界（已测试）：

| 场景 | 行为 |
|---|---|
| 重复 `init-dev` | 拒绝，文件 hash 不变，旧 token 可用 |
| 坏 principals 文件 | 拒绝覆盖，文件 hash 不变 |
| `--replace` | 显式重建，旧 token 失效（有测试守着） |
| `--add` 重复 principal_id | 拒绝，文件不变 |

---

## 6. CI 状态（必须如实说明）

**M8 没有 CI 结果。** 原因：CI 由 `push` 触发，而本阶段明确不授权 push、merge、release。

| 项 | 状态 |
|---|---|
| 最后一次 CI | run 43051690255 @ `b904842`，7/7 success，1m06s（M6 收尾） |
| M8 代码 | `c0fe381`，只在本地与干净克隆验证 |
| 本地等价门禁 | 全绿：210 测试、CONFIG、LAYERS、DOCS、BASELINE、PACK、SMOKE |

不能说「CI 通过」。要拿到 CI 结论，需要一次 push 授权。

---

## 7. 本环节发现的问题（未修）

| # | 问题 | 影响 |
|---|---|---|
| 1 | `orchestrate plan` 把「实现…并补测试」分类为 `verification` | 派错角色；本轮未改 |
| 2 | 包内 `missing` 仍含 blocking evidence（R0 配置） | 说明角色配置要求证据引用；会让包看起来「不完整」，但它是提示而非阻断 |
| 3 | 分节内容没有做跨记忆去重 | 重复记忆会在包里出现两次 |
| 4 | Markdown 不含 manifest | 程序化追溯要用 JSON |
