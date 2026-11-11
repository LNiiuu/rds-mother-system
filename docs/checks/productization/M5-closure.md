# M5 封版记录

**核实日期**：2026-11-11（+08:00）
**核实方式**：只读。本文档是本轮唯一新增的受版本管理文件（另一份是 macOS 只读评估报告）。
**核实对象**：`origin/main` 的实际状态，而非上一轮报告中的预期值。
**阶段**：M5 — Discoverability（可发现性与产品化收尾）

---

## 1. 五项核实

| # | 核实项 | 预期 | 实测 | 判定 |
|---|---|---|---|---|
| 1 | HEAD | `2343e4d` | `2343e4d9913bc513894fa4e296cad6210605a39d` | **一致** |
| 2 | 本地 `main` 与 `origin/main` | 一致 | 两者同为 `2343e4d…`；`rev-list --left-right --count` = `0	0` | **一致** |
| 3 | 暂存区为空 | 0 项 | `git diff --cached --name-only` = 0 行 | **一致** |
| 4 | 工作区未跟踪项 | 49 项 | `git status --porcelain -uall` = **49** 项 | **一致** |
| 5 | 49 项内容未变 | 指纹零漂移 | 逐项 SHA-256 前 16 位 + 字节数比对：**内容变化 0、新增 0**；「已入库 2」为 B6 有意提交的两个模板 | **一致** |

**补充**：`git tag -l 'm5-*'` = 7 个（`m5-b0`…`m5-b6`）；`b89cbb2..HEAD` 共 **15 个提交**。

### 1.1 关于「49」这个数字

M4 封版时是 51。M5-B6 把 `core/templates/role-packet.md` 与 `run-record.json` 纳入版本控制（它们此前未跟踪却随包分发，导致打包结果依赖工作区状态），因此降为 49。

本轮逐项比对确认：**除这 2 项外，其余 49 个文件的字节内容零变化**。这不是「数量对了就算过」，是「每一个文件都被核过」。

---

## 2. CI 最终证据

**run 43042736329 @ `2343e4d`：`status=completed`、`conclusion=success`、总时长 1 分 29 秒（14:52:43Z → 14:54:12Z）。**

| job | status | conclusion | started_at | completed_at | 耗时 |
|---|---|---|---|---|---|
| `structure self-check (windows-latest)` | completed | **success** | 14:52:57Z | 14:53:17Z | 20s |
| `required (ubuntu-latest / node 22.x)` | completed | **success** | 14:52:58Z | 14:53:16Z | 18s |
| `required (ubuntu-latest / node 24.x)` | completed | **success** | 14:52:58Z | 14:53:15Z | 17s |
| `required (windows-latest / node 22.x)` | completed | **success** | 14:52:59Z | 14:54:08Z | 1m09s |
| `required (windows-latest / node 24.x)` | completed | **success** | 14:52:58Z | 14:54:11Z | 1m13s |
| `g1 (windows-latest / powershell)` | completed | **success** | 14:52:58Z | 14:53:24Z | 26s |

**6 / 6 success。**

### 2.1 这份结论是怎么判定的

核实过程中先看到过一次**互相矛盾的信号**，记录下来，避免以后重复怀疑：

| 采样时刻 | 数据源 | 两个 Windows job 的状态 |
|---|---|---|
| 14:57:22Z（run 结束后 3 分钟） | `commits/{sha}/check-runs` | `in_progress`、`conclusion: null` |
| 同一时刻 | `actions/runs/{id}` | `completed` / `success` |
| 同一时刻 | `actions/runs/{id}/jobs` | `completed` / `success`，且有 `completed_at` |

结论：**`check-runs` 端点对 job 级状态的更新滞后于 `jobs` 端点**。判定 CI 是否通过，以 `actions/runs/{id}` 的 `conclusion` 加 `actions/runs/{id}/jobs` 的逐 job 记录为准。

**没有把以下任何一项当作 CI success**：

- `queued` 或 `in_progress` 状态
- run 的 `conclusion` 单独一项（必须配合 jobs 明细）
- 本地 `npm test` / `doctor` / `smoke` 的结果（那是另一类证据，见 §4）
- 之前提交的 run（例如 `72b13d5` 的 42594239389）——它证明的是那个提交，不是 `2343e4d`

### 2.2 「真跑过」的步骤级证据

以 `required (windows-latest / node 24.x)` 为例，14 个步骤全部 `conclusion=success`：

| 步骤 | 起止 | 耗时 |
|---|---|---|
| 环境信息 | 14:53:10Z → 14:53:11Z | 1s |
| 自检（doctor） | 14:53:11Z → 14:53:11Z | <1s |
| 配置校验（JSON 严格 / YAML lint） | 14:53:11Z → 14:53:12Z | 1s |
| 分层检查 | 14:53:12Z → 14:53:13Z | 1s |
| 文档一致性（相对链接可达） | 14:53:13Z → 14:53:14Z | 1s |
| **Required 测试门禁** | 14:53:14Z → 14:53:58Z | **44s** |
| 门禁反向验证（注入 fail / skip 必须变红） | 14:53:58Z → 14:53:59Z | 1s |
| **发行包端到端** | 14:53:59Z → 14:54:08Z | **9s** |

`g1` job 的 `G1 六个夹具` 步骤：14:53:04Z → 14:53:21Z，**17 秒**。夹具被跳过时会在 1 秒内结束。

---

## 3. 状态判定

```
M5 = COMPLETED
```

**判据**：任务书列的 10 项交付物全部交付（逐项对照见 [M5-final-acceptance.md](M5-final-acceptance.md) §1）；测试 196 项全过且在干净克隆里同样成立；CI 六 job 全绿；文档 181 个 Markdown / 199 个相对链接全可达；49 项受保护工作指纹零漂移。

**不给 `WITH WARNINGS` 的理由**：M4 之所以加限定，是因为存在「历史 Tag 单独检出不可运行」这类会影响使用者判断的问题。M5 没有同类问题——留下的都是**明确声明的不承诺项**（见 §5），不是缺陷。

---

## 4. M5 的验收范围

### 4.1 在范围内（已全部完成）

| # | 交付物 | 状态 |
|---|---|---|
| 1 | 架构与信息架构 | `docs/README.md` + `docs/PROJECT-MAP.md` |
| 2 | 文档审计 | `M5-docs-audit.md`（44 项发现） |
| 3 | 安装与快速开始 | `docs/quickstart.md` + `docs/install.md` |
| 4 | CLI 帮助覆盖 | `M5-cli-coverage.md`（1/19 → 22/22） |
| 5 | 路径可移植性 | `M5-path-portability.md`（评估，不改格式） |
| 6 | 维护者指南 | `docs/maintainer-guide.md` |
| 7 | 干净克隆验证 | `M5-clean-clone.md` |
| 8 | 测试报告 | `M5-test-report.md`（196 项） |
| 9 | CI 验证 | `M5-ci-validation-report.md` |
| 10 | 最终验收 | `M5-final-acceptance.md` |

### 4.2 明确**不在** M5 范围内

写这一节是为了防止后续把「没做」误读成「没做完」。

| 项 | 为什么不在范围内 |
|---|---|
| **macOS 兼容性验证** | M5 的任务书没有这一项。M5 的验收标准是「可发现性」——让新人能读懂、装上、用起来、修得了，与操作系统覆盖面无关。macOS 一直是 M4 起就登记的**已知限制**（`docs/install.md` §11），本轮不改变它的状态 |
| `ledger --path-style` | 属于「修改公开 CLI 参数」，按授权规则必须先给方案再等授权。本轮只做评估 |
| `rds principal add` / `upgrade` / `uninstall` | 新增公开命令，需先定语义。文档已明确标注「未实现」，不提供空壳 |
| 并发写压测、多语句事务 | 无需求、无压测设计 |
| Node 22.15.0 精确边界 | 需要固定版本 runner |

---

## 5. 保留的已知限制

| # | 限制 | 性质 | 为什么不修 |
|---|---|---|---|
| 1 | macOS 未实机验证 | 平台覆盖 | 无设备；CI 矩阵未含 `macos-latest`。代码层无 Windows 专有依赖，但未跑过即不承诺（E3）。**独立评估见 `M5-macos-assessment.md`** |
| 2 | Node 22.15.0 未精确验证 | 版本边界 | CI 跑 22.x / 24.x 的最新补丁版；22.15 的依据是 zstd 回移植的文档事实 |
| 3 | `ledger.json` 的 `path` 为绝对路径 | 可移植性 | 改它等于改 JSON 输出格式，需授权。已用 4 个测试固定现状 |
| 4 | `rds principal` / `upgrade` / `uninstall` 未实现 | 功能缺口 | 已如实标注，不提供空壳命令 |
| 5 | 49 项本地材料未入库 | 仓库完整性 | 含项目名与作者机器路径，不适合入库；正式文档不依赖它们 |
| 6 | `docs/` 与 `mars/docs/` 下 75 个历史文件含机器路径 | 洁净度 | 带日期的证据，改写等于篡改。`doctor` 的 `paths:docs` 只告警 |
| 7 | 并发写未压测 | 测试覆盖 | 只验证 `busy_timeout > 0` |

---

## 6. 工作区保护核对

| 时点 | 未跟踪项 | 说明 |
|---|---|---|
| M4 封版 | 51 | 指纹存于仓库外 `D:\M1-migration\m5-protected-baseline.txt` |
| M5 起点核对 | 51 | 与基线完全一致 |
| M5 终点核对（本轮） | **49** | 2 项入库；其余 49 项字节内容零变化 |

**本轮写作后的状态**：本文档与 `M5-macos-assessment.md` 是本轮新增文件，尚未提交。因此核对时的 49 项指**原有受保护工作**，不含本轮两份新文档。

若后续提交这两份文档，未跟踪项会回到 49（它们变成已跟踪，不再计入），受保护工作的指纹仍为零漂移。

---

## 7. 与后续阶段的边界

M5 关闭时明确交给后续的输入：

1. **macOS 是否纳入 CI** —— 评估报告已给出成本、收益与最小方案，等确认后实施。
2. **`ledger --path-style`** —— 方案就绪，等授权。
3. **`rds principal add`** —— 需先定「追加 vs 覆盖」「token 轮换」「并发写身份文件」三个语义。
4. **49 项本地材料的归档决定** —— 要么脱敏入库，要么明确「永久本地」。目前处于中间态。

后续阶段不得改写 M1–M5 的结论、报告与 Tag；发现事实错误时新增勘误，不改原文。

---

## 8. 复现命令

```bash
# 1. 五项核实
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count origin/main...main
git diff --cached --name-only | wc -l
git status --porcelain -uall | wc -l

# 2. 49 项指纹（基线在仓库外）
#    逐项比对 SHA-256 前 16 位 + 字节数，期望：内容变化 0 / 新增 0 / 已入库 2

# 3. 门禁
npm run verify
npm run baseline
bash tooling/ci-smoke.sh

# 4. CI（以 job 级为准）
#    https://api.github.com/repos/LNiiuu/rds-mother-system/actions/runs/43042736329
#    https://api.github.com/repos/LNiiuu/rds-mother-system/actions/runs/43042736329/jobs
```
