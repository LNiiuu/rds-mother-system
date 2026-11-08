# M1 / M2 最终验收报告

> 仓库：`D:\M1`（`LNiiuu/rds-mother-system`）
> 起始基线：`1f5516e5045f6c76007221e3c4741bb2634e88c7`（`main`）
> 开工前备份：`D:\M1-backup-20261108-162614`（609 文件，含 `.git`）
> 执行时间：2026-11-08 16:26 – 17:2x（+08:00）
> 本轮提交：`2af650f`（M1）→ `4d863dc`（G1 归档）→ `9712602`（M2）→ 本报告提交

---

## 0. 结论

**M1 完成，M2 完成。具备进入 M3 的条件，但有一项外部验证缺口必须先说明：CI 未在 GitHub 上真实运行过（本轮禁止 push），Ubuntu 与 macOS 均未实机执行。**

| 指标 | 结果 |
|---|---|
| Required 测试 | **88 tests / 88 pass / 0 fail / 0 skipped**（Windows，Node 22.22.2） |
| 门禁反向验证 | 4/4（全绿 0、失败 1、跳过 1、空集 1 全部符合预期） |
| 配置校验 | JSON 51 个全部解析通过，YAML 4 个 lint 通过 |
| 发行包 | 87 文件，内容断言通过，干净前缀安装后全链路通过 |
| 路径卫生 | 代码/配置侧本机绝对路径 **0** 命中（扫描 102 文件） |
| G1（WF5）测试 | 6 个夹具全 PASS（Windows PowerShell） |
| 原有工作保护 | 提交后工作区为 **71 行 status，与开工前逐字节一致（新增 0 / 丢失 0）** |
| CI | 工作流已就绪；**未远程执行**（未 push），故 Ubuntu 侧为 E3 |

---

## 1. M1 验收（可部署）

| # | 退出条件 | 判定 | 证据 |
|---|---|---|---|
| 1 | 干净环境可安装 | **PASS** | `npm pack` → 空前缀 `npm i -g` → 入口存在 |
| 2 | `doctor` 能正确诊断 | **PASS** | 源码树 `status: ok`；安装包 `fail=0 warn=0` |
| 3 | `init` 能初始化 | **PASS** | 输出含 stats，表与 FTS5 就绪 |
| 4 | 发行包含完整运行文件 | **PASS** | `pack-check` 必需 17 项齐全（含 `mars/contracts/*.json`） |
| 5 | 核心业务流程可完成 | **PASS** | 安装→doctor→init→写入→自审被拒→R4 审批→检索命中→编译 packet |
| 6 | 不依赖作者本机路径 | **PASS** | `doctor paths:code` 0 命中；`git` 走三段解析 |
| 7 | G1 修复不引入回归 | **PASS** | `tests/git-review/run.ps1` F1–F6 PASS |

M1 提交：`2af650f`，24 文件，+1118 / −58。

### M1 期间发现并修复的真问题（均不在原审计清单内）

| # | 问题 | 发现方式 | 处理 |
|---|---|---|---|
| 1 | 发行包漏 `mars/contracts/*.json` | tarball 安装后 `put` 报 ENOENT | `files` 增加 `mars/contracts/`；`pack-check` 固化为断言 |
| 2 | git 不在 PowerShell PATH | 换成 `Get-Command` 后 G1 测试变红 | 三段解析：`RDS_GIT` → `Get-Command` → `toolchain.local.json` |
| 3 | PS 5.1 参数默认值在调用方作用域求值 | `new-project.ps1` 走默认值即报错 | 参数默认空串 + 体内归一化（9 个脚本） |
| 4 | `-LiteralPath Join-Path $Repo 'x'` 缺括号 | G1 测试报「找不到位置形式参数」 | 先赋值 `$localCfg` 再传变量 |

---

## 2. M2 验收（可验证）

| # | 退出条件 | 判定 | 证据 |
|---|---|---|---|
| 1 | 两个 ledger 用例去环境化 | **PASS** | 改为 8 个 fixture 用例；真实会话核对移至 External |
| 2 | 必需 fixture 稳定 | **PASS** | `make-session.js` 生成确定性多帧 zstd，期望值独立计算 |
| 3 | 不允许静默 skip | **PASS** | `skipped=0`；门禁对 skip 直接判红；4 处历史 skip 全部改为 `assert.fail` |
| 4 | 门禁可信 | **PASS** | 自检 4/4；含「空集必须红」 |
| 5 | Windows / Ubuntu CI 可执行核心测试 | **PARTIAL** | 工作流已写；Windows 本地等价命令全通过；**Ubuntu 未实跑** |
| 6 | 文档与实现一致 | **PASS** | README / install / testing / CHANGELOG 同步 |

M2 提交：`9712602`，21 文件，+1268 / −142。

---

## 3. 测试结果明细

```
GATE PASS  tests=88 pass=88 fail=0 skipped=0
```

| 类别 | 数量 | 说明 |
|---|---|---|
| Required | 88 用例 | 全部在临时目录 + 合成数据上运行，不读真实会话、不依赖 DSH |
| Integration（含在 Required 内） | 若干 | CLI 子进程、SQLite 文件、MCP 握手、回滚脚本 |
| External | 1 文件 / 2 用例 | `mars/tests/external/*.external.js`，需 `RDS_IT_DSH_SESSION`，**不进 CI** |

与 M1 前的对比：

| 时点 | Windows | Linux |
|---|---|---|
| M1 前 | 80 tests / 78 pass / **2 fail** / 0 skip | 73 / 80、**3 fail**、**4 skip** |
| 现在 | 88 / 88 / 0 / 0 | 未实跑（CI 覆盖，需 push） |

> 变化原因：2 个 fail 来自硬编码 `41597577`；Linux 额外 1 fail 来自 `powershell.exe` 硬编码，4 skip 来自真实会话缺失。三类根因均已消除。

---

## 4. 发行包结果

| 项 | 值 |
|---|---|
| tarball | `rds-mother-system-0.1.0.tgz`，87 文件，约 76 KB |
| 必需文件 | 17 项断言齐全（含 5 个 contracts、3 个 bin、install 文档） |
| 禁止项 | 10 类规则 0 命中（tests / history / checks / experiments / var / principals / toolchain.local / db / zstd / jsonl） |
| 安装后 doctor | `status: ok (fail=0 warn=0)` |
| 端到端 | 7 步全通过 |

---

## 5. 本地提交

| 提交 | 内容 | 文件数 |
|---|---|---|
| `2af650f` | feat(m1) 可部署化 | 24 |
| `4d863dc` | chore(g1) 路径修复补丁归档 | 2 |
| `9712602` | feat(m2) 测试可靠性 + CI | 21 |
| 本报告 | docs 验收材料 | 5 |

**未执行**：push、merge、release、npm 发布。

---

## 6. 逐条回答任务书 §11.2 的十个问题

1. **M1 是否真正完成？** 是。7 条退出条件全 PASS，且在**发行包**（非源码树）上验证。
2. **G1 三处修复是否保留且可独立追溯？** 保留在工作区（已生效），追溯方式为 `docs/checks/productization/g1-path-resolution.patch` + `.md`（提交 `4d863dc`）。文件本身未提交，原因见 `change-attribution.md`。
3. **原有 71 项工作是否完整保留？** 是。提交后 `git status --porcelain -uall` 为 71 行，与开工前逐字节一致（新增 0 / 丢失 0）。
4. **两个 ledger 测试是否 fixture 化？** 是。真实会话路径、固定日期、固定字节数全部移除。
5. **Required 是否零失败零跳过？** 是。88/88/0/0，且门禁自检证明它会对 fail 与 skip 变红。
6. **Windows 和 Ubuntu CI 是否真实执行？** **否。** 工作流已写好，本地等价命令在 Windows 全通过；Ubuntu 与远程执行均未发生（禁止 push）。
7. **发行包能否在干净环境安装并完成核心流程？** 能。见 §4。
8. **本地提交是否清晰？** 是。三次提交，边界按阶段划分，未混入 BASELINE。
9. **是否存在未提交或无法拆分的工作？** 有：70 个未跟踪文件（G1 工作流 + 历史材料）+ 1 个部分暂存文件（`tests/self/run.ps1` 的 G1 改动块）。均为开工前既有内容，按规则不提交。
10. **是否具备进入 M3 的条件？** 基本具备。前置建议：先在 GitHub 上跑通一次 CI（需 push），再开始 M3 的解耦重构。
