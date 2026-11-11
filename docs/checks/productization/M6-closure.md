# M6 阶段收尾记录

**日期**：2026-11-12（+08:00）
**阶段**：M6 — macOS 兼容性验证
**起点**：`2343e4d`（M5 封版点）
**终点**：`b904842`（macOS 验收报告与文档同步）
**判定**：**`COMPLETED`**

> 判定口径由本轮验收要求给定，三档：
> `COMPLETED` = 最终提交 CI 全部通过；`COMPLETED WITH WARNINGS` = CI 因平台原因无法完成，
> 但修复批次的独立验证证据完整；`BLOCKED` = 存在尚未解决的真实失败。
> 本次落在第一档，依据见 §3。

---

## 1. 最终 CI 证据

### 1.1 run 级

| 项 | 值 |
|---|---|
| run ID | **43051690255** |
| run number | 24 |
| workflow | `CI`（`.github/workflows/ci.yml`） |
| commit | `b904842779f56c5640e043debb6cb300e17ddb5c` |
| 提交标题 | `docs(m6): macOS 验收报告 + 三处文档同步（从「未验证」改为「CI 实测通过」）` |
| 触发 | `push` 到 `main` |
| `status` | **`completed`** |
| `conclusion` | **`success`** |
| 起止（UTC） | 2026-11-11T15:46:26Z → 15:47:32Z |
| 起止（+08） | 2026-11-11 23:46:26 → 23:47:32 |
| 总时长 | **1 分 06 秒** |

链接：https://github.com/LNiiuu/rds-mother-system/actions/runs/43051690255

### 1.2 job 级（全部 7 个）

数据来源：`actions/runs/43051690255/jobs`。**7 / 7 全部 `status=completed`、`conclusion=success`**，无 skipped、无 neutral、无 cancelled。

| # | job | `status` | `conclusion` | 起止（UTC） | 耗时 |
|---|---|---|---|---|---|
| 1 | `required (ubuntu-latest / node 24.x)` | completed | success | 15:46:28 → 15:46:40 | 12s |
| 2 | `required (ubuntu-latest / node 22.x)` | completed | success | 15:46:29 → 15:46:41 | 12s |
| 3 | `macos (macos-latest / node 22.x)` | completed | success | 15:46:29 → 15:46:43 | **14s** |
| 4 | `g1 (windows-latest / powershell)` | completed | success | 15:46:29 → 15:46:52 | 23s |
| 5 | `required (windows-latest / node 22.x)` | completed | success | 15:46:29 → 15:47:31 | 62s |
| 6 | `required (windows-latest / node 24.x)` | completed | success | 15:46:29 → 15:47:32 | 63s |
| 7 | `structure self-check (windows-latest)` | completed | success | 15:46:30 → 15:47:10 | 40s |

### 1.3 步骤级（macos job）

十二个步骤全部 `success`。关键六步：

| 步骤 | 起止（UTC） | 耗时 | 说明 |
|---|---|---|---|
| 环境信息 | 15:46:32 → 15:46:32 | <1s | node / npm / `uname -m` / `sw_vers` |
| **FTS5 前置探针** | 15:46:32 → 15:46:32 | <1s | 六条断言，无跳过出口 |
| 自检（doctor） | 15:46:32 → 15:46:32 | <1s | 11 项检查 |
| **Required 测试门禁** | 15:46:32 → 15:46:38 | **6s** | 196 项 |
| **发行包端到端** | 15:46:38 → 15:46:40 | **2s** | 打包→检查→安装→全链路 |
| 证据汇总（annotation） | 15:46:40 → 15:46:40 | <1s | 写 notice |

### 1.4 两条 annotation 原文

公开可读，不需要下载 job 日志：

```
FTS5 probe     : platform=darwin arch=arm64 node=v22.23.4 sqlite=3.53.4 runner_arch=ARM64 image=macos26 checks=6/6 PASS
macos evidence : status: ok | GATE PASS tests=196 pass=196 fail=0 skipped=0 | SMOKE PASS
```

这两条是 [M6-macos-acceptance.md](M6-macos-acceptance.md) §1 与 §3 的**同一份证据**：
报告里的架构、Node 版本、SQLite 版本、测试数量，都可以在这两行里逐字对上。

### 1.5 为什么不用 `check-runs` 端点判定

`commits/{sha}/check-runs` 对 job 级状态的更新**滞后**于 `actions/runs/{id}/jobs`。
M5 封版时遇到过「run 已 success，check-runs 仍显示 in_progress」；M6 探针阶段遇到过相反方向的不一致。
因此判定只用 `runs.conclusion` + `jobs` 明细，不采信 `check-runs` 的中间态。

---

## 2. 阶段交付物

| 类型 | 文件 | 性质 |
|---|---|---|
| 工具 | `tooling/fts5-probe.mjs` | 新，**不进发行包**（已核对 `npm pack` 文件清单） |
| CI | `.github/workflows/ci.yml` | 新增 `macos` job（Node 22.x），Windows/Ubuntu matrix 未改 |
| 测试 | `mars/tests/ledger/path-portability.test.js` | 一条断言改比 `realpath`，断言强度不降 |
| 报告 | `docs/checks/productization/M6-macos-acceptance.md` | macOS 验收报告 |
| 收尾 | `docs/checks/productization/M6-closure.md` | 本文件 |
| 文档 | `README.md`、`docs/install.md`、`docs/testing.md`、`docs/checks/README.md` | macOS 表述从「未验证 E3」改为「CI 实测（arm64 / Node 22）E1」 |

**没有新增第三方依赖，没有改数据库 Schema，没有改公开 CLI 参数或 JSON 输出形状，没有改产品功能。**

---

## 3. 状态判定

| 判定档 | 条件 | 本次是否满足 |
|---|---|---|
| `COMPLETED` | 最终提交 CI 全部通过 | **是**：7/7 job `completed` + `success` |
| `COMPLETED WITH WARNINGS` | CI 因平台原因无法完成，但修复批次独立证据完整 | 不适用（CI 已完成） |
| `BLOCKED` | 存在尚未解决的真实失败 | 否（唯一失败已定位并修复） |

### 3.1 唯一一次失败及其闭环

| 时点 | 提交 | 结果 |
|---|---|---|
| 首次完整运行 | `ffc9439` | macos **failure**（测试门禁 11s），其余 6 job success |
| 定位与修复 | `6d4a7ec` / `818b93c` | 根因是 `path-portability` 的字面路径断言；改为两边取 `fs.realpathSync` |
| 修复验证 | `818b93c` | **7/7 全绿**（run 43050909002） |
| 收尾验证 | `b904842` | **7/7 全绿**（run 43051690255） |

失败**没有被绕过**：没有 skip、没有弱化断言、没有改验收标准。改的是断言表达方式（比较真实路径而非字符串），断言语义不变且更正确。

---

## 4. 六项复核

复核时间：2026-11-12 00:00 (+08)。

| # | 项 | 实测 | 结论 |
|---|---|---|---|
| 1 | `HEAD` | `b904842779f56c5640e043debb6cb300e17ddb5c` | — |
| 1 | `origin/main` | `b904842779f56c5640e043debb6cb300e17ddb5c` | **一致**，`rev-list --left-right --count` = `0 0` |
| 2 | 暂存区 | `git diff --cached --name-only` = **0** | 空 |
| 2 | 工作区 | `status --porcelain -uall` = **49** | 全部为原有受保护工作 |
| 3 | 49 项指纹 | 基线 51 项：**内容变化 0 / 新增 0 / 不在工作区 2** | **零漂移**（2 项是 B6 有意入库的模板） |
| 4 | 历史 Tag | **20 个**，全部 annotated，全部指向 `2343e4d` 之前的提交 | **未改动**（无一个指向 M6 区间） |
| 5 | 报告数字 | 架构 arm64 / Node v22.23.4 / SQLite 3.53.4 / 196 项 / 7 job | 与 annotation 及 jobs 端点**逐项一致** |
| 6 | 文档链接 | `npm run docs:check` → `DOCS PASS` | 全部可达 |

### 4.1 关于「49」与「51」

- **51** 是 M5 开始时的工作区未跟踪项总数（基线文件 `m5-protected-baseline.txt` 在仓库外）。
- **49** 是当前值：M5-B6 把 `core/templates/role-packet.md` 与 `core/templates/run-record.json` 有意入库，
  51 − 2 = 49。
- 判定方法不是「数字相等」，而是**逐项比对 SHA-256 前 16 位 + 字节数**。

### 4.2 20 个 Tag 的分布

| 里程碑 | Tag | 数量 |
|---|---|---|
| M3 | `m3-b0` … `m3-b5` | 6 |
| M4 | `m4-b0` … `m4-b6` | 7 |
| M5 | `m5-b0` … `m5-b6` | 7 |
| **合计** | | **20** |

M6 **没有打 Tag**：这一阶段的目标是「补一个平台的验证」，不是发布一个能力版本；Tag 留给有独立验收标准的里程碑。

---

## 5. 支持边界

完整清单见 [M6-macos-acceptance.md](M6-macos-acceptance.md) §6。一句话版本：

**已验证**：GitHub `macos26` runner / arm64 / Node v22.23.4 / SQLite 3.53.4 上，FTS5 可用、zstd 可用、
doctor 11 项全 ok、196 项测试全过、发行包打包安装与全链路通过。

**未验证**：Intel Mac（x64）、Node 24 on macOS、其他 macOS 版本、`new-project.ps1` 在 macOS 实机运行、
大小写敏感文件系统、权限受限场景、真实 DSH 客户端联调。

**不扩大解释**：单一 runner 的通过不等于「所有 macOS 都支持」。这条边界写在报告里，也写在
`docs/install.md` 的平台支持小节里。

---

## 6. 本阶段没有做的事

- 未改 `ledger` 的路径格式（`--path-style` 仍待授权，方案在 [M5-path-portability.md](M5-path-portability.md) §5.3）
- 未实现 `rds principal add` / `rds upgrade` / `rds uninstall`
- 未改数据库 Schema、未改公开 CLI 参数与 JSON 输出形状
- 未引入第三方依赖
- 未修改 M5 及更早的提交、Tag 与验收结论
- 未把 `macos` job 提升为阻塞合并（它当前不参与 `required` 的聚合判定）

---

## 7. 复现命令

```bash
# 1. 六项复核
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count origin/main...main
git diff --cached --name-only | wc -l
git -c core.quotepath=false status --porcelain=v1 -uall | wc -l
git tag -l | wc -l

# 2. 49 项指纹（基线在仓库外，需自行保存）
#    逐项比对 SHA-256 前 16 位 + 字节数
#    期望：内容变化 0 / 新增 0 / 不在工作区 2

# 3. 门禁
npm run verify

# 4. 探针（本地任意平台）
node tooling/fts5-probe.mjs

# 5. CI（以 job 级为准，不看 check-runs 中间态）
#    https://api.github.com/repos/LNiiuu/rds-mother-system/actions/runs/43051690255
#    https://api.github.com/repos/LNiiuu/rds-mother-system/actions/runs/43051690255/jobs
```
