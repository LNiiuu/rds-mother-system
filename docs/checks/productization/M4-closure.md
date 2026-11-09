# M4 最终封版记录

**核实日期**：2026-11-09（+08:00）
**核实方式**：只读。本轮不返工 M4、不重写历史提交、不改动已推送的 Tag。
**核实对象**：远程 `main` 的实际状态，而非上一轮报告中的预期值。

---

## 1. 七项核实逐条结果

| # | 核实项 | 历史报告预期 | 本次实测 | 判定 |
|---|---|---|---|---|
| 1 | HEAD 是否为 `b89cbb2` 或其后继 | `b89cbb2` | `b89cbb2b2d881b95111c0bd3f33869474e4a2fd9` | **一致** |
| 2 | 本地 `main` 与 `origin/main` | 一致 | `git rev-list --left-right --count origin/main...main` = `0	0`；`git rev-parse origin/main` = `b89cbb2b…` | **一致** |
| 3 | M4 的 7 个提交与 7 个 Tag | 7 + 7 | 7 个批次提交（各 1 个）+ 1 个回填提交 = 8 个提交；7 个 annotated Tag 均存在且各指向对应批次提交 | **一致（提交数需说明口径）** |
| 4 | Required 测试 | 173 PASS / 0 FAIL / 0 SKIP | `GATE PASS  tests=173 pass=173 fail=0 skipped=0` | **一致** |
| 5 | CI 真实通过 | 四组矩阵全绿 | `run 42583509413` @ `b89cbb2` → `conclusion=success`，6 个 check run 全部 `success` | **一致** |
| 6 | 工作区 51 项受保护工作 | 51 项完整 | `git status --porcelain -uall` = **51** 项，逐项 SHA-256 指纹已采集（见 §5） | **一致** |
| 7 | 暂存区为空 | 0 项 | `git diff --cached --name-only` = 0 行 | **一致** |

**补充实测**（本轮新增，用于封版证据）：

| 项 | 命令 | 结果 |
|---|---|---|
| 环境自检 | `node bin/rds.mjs doctor` | `status: ok (fail=0 warn=1 checks=10)`；warn 为 `paths:docs` 命中 11 个历史文档（M5 范围） |
| 配置校验 | `node tooling/config-check.mjs` | `CONFIG PASS  json=57 yaml=4` |
| 分层检查 | `node tooling/layering-check.mjs` | `LAYERS PASS  problems=0 warnings=2`（2 条永久边界声明） |
| 行为基线 | `node tooling/baseline-capture.mjs --check` | `BASELINE PASS  7 个面均与基线一致`；发行包 108 文件 / 基线 88；错误码 72 / 基线 70 |
| G1 六夹具 | `tests/git-review/run.ps1` | `RESULT: PASS`（F1 PASS、F2–F4 FAIL 为预期裁决、F5 BLOCKED、F6 PARTIAL） |
| 发行包端到端 | `bash tooling/ci-smoke.sh` | `PACK PASS`（108 文件 / 104500 B）+ `SMOKE PASS`（安装→doctor→init→写入→审批→检索→编译） |

---

## 2. 提交与 Tag 对照

M4 起点为 `9c5e4ab`（M3 终点 + CI 回填），区间 `9c5e4ab..b89cbb2` 共 8 个提交：

| 序号 | 提交 | 类型 | Tag |
|---|---|---|---|
| 1 | `4eeddf2` | `docs(m4-b0)` 维护性审计与基线 | `m4-b0` |
| 2 | `113f208` | `feat(m4-b1)` 让 ledger 契约有执行点并解除数据源锁定 | `m4-b1` |
| 3 | `0614385` | `fix(m4-b2)` 脚本治理 | `m4-b2` |
| 4 | `01f5e82` | `fix(m4-b3)` 数据库生命周期 | `m4-b3` |
| 5 | `9329b5e` | `feat(m4-b4)` 版本体系落地 + engines 收紧 | `m4-b4` |
| 6 | `ae1cb38` | `feat(m4-b5)` 可观测性 | `m4-b5` |
| 7 | `d7cba45` | `docs(m4-b6)` 文档同步、回滚演练与最终验收 | `m4-b6` |
| 8 | `b89cbb2` | `docs(m4)` 回填四组 CI 结果并转为 READY FOR COMMIT | 无（封版回填提交） |

**口径说明**：历史报告的「7 个提交」指 7 个批次提交；第 8 个 `b89cbb2` 是验收后回填 CI 结果的文档提交，不单独打 Tag。两者不矛盾，但必须写清，否则「7 个提交」与 `git rev-list --count` 的 8 会对不上。

Tag 类型均为 annotated（非轻量），`git cat-file -t` 返回 `tag`。

---

## 3. 状态判定

```
M4 = COMPLETED WITH WARNINGS
```

**判据**：M4 的 15 项验收全部 PASS（见 `M4-final-acceptance.md`），且本轮七项核实全部与历史报告一致；但存在 6 项已知限制，其中 2 项涉及「历史 Tag 单独检出不可运行」，1 项涉及「平台覆盖不完整」。这些限制不构成 M4 功能缺陷，但会误导后来者，因此不能标为 `COMPLETED` 而不加限定。

---

## 4. 保留的已知限制（不修复，如实记录）

| # | 限制 | 性质 | 为什么不修 |
|---|---|---|---|
| 1 | `m4-b4`、`m4-b5` 历史 Tag 在**单独检出**时仍存在测试失败；最终修复位于 B6 | 历史 Tag 不可独立运行 | 修复需重写已推送提交。重写历史会让所有下游克隆失配，代价远大于收益。B6 已修复，`main` 与后续 Tag 均正常 |
| 2 | macOS 尚未验证 | 平台覆盖 | 无真机；CI 矩阵未含 `macos-latest`。代码层无 Windows 专有依赖，但未实测即不承诺（E3） |
| 3 | 并发写、多语句事务尚未实测 | 测试覆盖 | 现有代码路径无显式多语句事务；并发写只验证了 `busy_timeout > 0`，未做压测。属 M5+ 范围 |
| 4 | Node 22.15 精确边界尚未实机验证 | 版本边界 | CI 跑 22.x / 24.x 的**最新补丁版**，未固定 22.15.0。`engines` 声明 22.15 是依据 zstd 回移植版本的文档事实，非本机实测 |
| 5 | `ledger.json` 中仍有本机绝对路径 | 可移植性 | 改变输出格式属公开行为变更，需单独评估与授权。M5-B4 先做分析与兼容性方案，不擅自改 |
| 6 | 历史文档整理留给 M5 | 范围划分 | M4 明确不改写带日期的证据记录。M5 的信息架构批次负责 |

### 关于限制 1 的准确表述

「Tag 单独检出不可运行」不等于「Tag 指向的代码从未通过测试」。准确说法是：

- `m4-b4` / `m4-b5` 检出后，`version.test.js` 依赖当时尚未跟踪的 `mars/config/principals.json`，在干净检出下失败；
- 该缺陷在 B6 被修复（测试自建临时身份），但修复提交位于 B6，B4/B5 的 Tag 仍指向修复前的树；
- 因此 **B4/B5 Tag 是「当时状态的真实快照」，不是「可独立运行的发布点」**。可独立运行的发布点是 `m4-b6` 与 `main`。

任何「所有历史 Tag 都必须能跑」的要求，本质上要求重写历史，本轮明确不做。

---

## 5. 工作区保护核对

- 数量：**51** 项（`git status --porcelain -uall`，含 16 个顶层条目展开后的全部文件）
- 指纹：逐项 `SHA-256 前 16 位 + 字节数 + 路径`，基线存于仓库外的 `D:\M1-migration\m5-protected-baseline.txt`
- 本轮唯一一次触碰：M5-B0 审计中执行 `rds init-dev --help` 时，该命令**忽略了 `--help` 并有副作用**，覆盖了未跟踪的 `mars/config/principals.json`；已从 `D:\M1-backup-20261108-162614` 完整恢复（6 个 principal 全部在位，见 M5 文档审计报告 D-01）
- 除该次恢复外，51 项内容未改动；暂存区保持为空

---

## 6. 与 M5 的交接边界

M4 关闭时明确交给 M5 的输入：

1. `doctor` 的 `paths:docs` warn（11 个历史文档含本机路径）——需给出归档策略，不是简单删除。
2. `ledger.json` 绝对路径——需先分析兼容性再决定是否改。
3. `mars/docs/` 的过期描述与历史项目名——只标注状态，不改写证据。
4. `render-role` 等未实现功能的表述——需统一口径，不允许空壳命令。
5. 发版结构（`CHANGELOG` 的 Unreleased 段落已积累 4 个里程碑）——需在 M5 收口。

M5 不得反过来修改 M4 的结论、报告与 Tag；如发现 M4 报告有事实错误，只能新增勘误，不能改写原文。

---

## 7. 复现命令

```bash
git log --oneline -8
git rev-list --left-right --count origin/main...main
git tag -l 'm4-*' --format='%(refname:short) %(objecttype) %(*objectname:short)'
node tooling/test-gate.mjs
node bin/rds.mjs doctor
node tooling/layering-check.mjs
node tooling/baseline-capture.mjs --check
bash tooling/ci-smoke.sh
git status --porcelain -uall | wc -l
git diff --cached --name-only | wc -l
```
