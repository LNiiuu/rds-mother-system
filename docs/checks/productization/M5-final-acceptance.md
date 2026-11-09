# M5 最终验收报告

**日期**：2026-11-09（+08:00）
**阶段**：M5 — Discoverability（可发现性与产品化收尾）
**起点**：`b89cbb2`（M4 封版点，与 `origin/main` 一致）
**终点**：`72b13d5`（B6 代码提交，CI run 42594239389 全绿）
**判定**：**COMPLETED**

---

## 1. 任务书的十项交付物

| # | 要求 | 交付物 | 状态 |
|---|---|---|---|
| 1 | M5 架构与信息架构报告 | [M5-information-architecture.md](M5-information-architecture.md) + [docs/PROJECT-MAP.md](../../PROJECT-MAP.md) | ✅ |
| 2 | M5 文档审计报告 | [M5-docs-audit.md](M5-docs-audit.md)（44 项发现） | ✅ |
| 3 | M5 安装与快速开始指南 | [docs/quickstart.md](../../quickstart.md) + [docs/install.md](../../install.md)（修订） | ✅ |
| 4 | M5 CLI 帮助覆盖报告 | [M5-cli-coverage.md](M5-cli-coverage.md)（1/19 → 22/22） | ✅ |
| 5 | M5 路径可移植性报告 | [M5-path-portability.md](M5-path-portability.md)（六方案评估） | ✅ |
| 6 | M5 维护者指南 | [docs/maintainer-guide.md](../../maintainer-guide.md)（10 节，72 个错误码） | ✅ |
| 7 | M5 干净克隆验证报告 | [M5-clean-clone.md](M5-clean-clone.md) | ✅ |
| 8 | M5 测试报告 | [M5-test-report.md](M5-test-report.md)（196 项） | ✅ |
| 9 | M5 CI 验证报告 | [M5-ci-validation-report.md](M5-ci-validation-report.md)（6/6 job） | ✅ |
| 10 | M5 最终验收报告 | 本文 | ✅ |

**10 / 10。** 另有 M4 封版记录 [M4-closure.md](M4-closure.md) 作为交接产出。

---

## 2. 七个批次

| 批次 | 内容 | 提交 | Tag | 验证 |
|---|---|---|---|---|
| B0 | 只读基线审计 | `9c0d1e3` | `m5-b0` | 44 项发现，每项带 file:line 与级别 |
| B1 | 文档信息架构 | `80a3732` `3db0363` | `m5-b1` | 相对链接 5 → 156 |
| B2 | 安装与快速开始 | `3021a25` | `m5-b2` | 用发行包实测 10 步，输出与文档一致 |
| B3 | CLI 帮助覆盖 | `d7396cf` | `m5-b3` | 22/22 命令，测试 173 → 185 |
| B4 | 路径与可移植性 | `05d87e2` | `m5-b4` | 测试 185 → 189，doctor 10 → 11 项 |
| B5 | 维护者体验 | `d630848` | `m5-b5` | testing.md 重写，maintainer-guide 435 行 |
| B6 | 最终验收 | `f9be0c8` `a2c2567` `72b13d5` | `m5-b6` | 196 项 + CI 6/6 |

每批都是「基于上一批真实、可运行、已验证的提交」。中间态没有出现「Tag 无法运行」的情况——B6 的干净克隆验证覆盖了全部七个 tag 指向的代码。

---

## 3. 完成的功能与文档

### 3.1 新增的文档

| 文件 | 行数 | 作用 |
|---|---|---|
| `docs/README.md` | 165 | 唯一文档入口：三条阅读路径、四类文档定义、状态图例、已知失效清单 |
| `docs/PROJECT-MAP.md` | 198 | RDS/MARS 关系、五层结构、L1–L7 分层规则、改动影响面、6 条红线 |
| `docs/quickstart.md` | 287 | 10 分钟最小闭环，每步带预期输出 |
| `docs/maintainer-guide.md` | 435 | 按症状查、72 个错误码、备份恢复、发布流程、回滚、什么时候停手 |
| `docs/checks/README.md` | 129 | 验收证据索引，按 8 个里程碑分组 |
| `docs/architecture/README.md` | 60 | 架构文档索引 + 基线的比较方式 |
| `mars/docs/README.md` | 73 | 40 份子系统文档分四类 |
| `docs/checks/productization/M5-*.md` | 8 份 | 本轮验收证据 |

### 3.2 代码改动

| 文件 | 改动 | 性质 |
|---|---|---|
| `mars/src/cli-help.js` | 新增 440 行：22 个命令的帮助文本单一真相 | 新增 |
| `mars/src/cli.js` | 帮助分支前置到所有副作用之前；`-h` 支持；导出 `KNOWN_COMMANDS` | 修复 S1 |
| `bin/rds.mjs` | 复用 `cli-help` 的 USAGE；内建命令认 `--help` | 修复 |
| `bin/doctor.mjs` | 新增 `paths:assets`（fail 级）；`paths:docs` 扩到覆盖 `.md`；活跃文档改目录扫描 | 修复盲区 |
| `tooling/docs-check.mjs` | 新增 161 行：Markdown 相对链接检查 | 新增 |
| `tooling/baseline-capture.mjs` | 新增 `helpText` 登记位 | 新增机制 |
| `tests/self/run.ps1` | 关键词表补拼音形式；排除运行时目录与本地身份文件 | 修复漏检 |
| `package.json` | `docs:check` 脚本；`verify` 加一步 | 新增 |
| `.github/workflows/ci.yml` | required 四格各加「文档一致性」步骤 | 新增 |
| `core/templates/role-packet.md`、`run-record.json` | 入库（此前未跟踪但随包分发） | 修复 |

### 3.3 修掉的缺陷

| 编号 | 缺陷 | 级别 | 证据 |
|---|---|---|---|
| D-01 | `rds init-dev --help` 生成身份并**整个覆盖** `principals.json` | **S1** | 实测把 6 个 principal 覆盖成 1 个；已从备份恢复 |
| D-02 | `rds init --help` 创建数据库 | S2 | 前后目录对比 |
| D-03 | 12 个命令 `--help` 报 `TOKEN_MISSING` | S2 | 覆盖矩阵 |
| D-04 | `rds mcp --help` 返回「网关默认禁用」 | S3 | 同上 |
| D-05–D-07 | 只有 `ledger` 有子命令帮助；顶层帮助漏 `orchestrate`；两份用法文本已分叉 | S3 | 实测 |
| C-01 | `principals.example.json` 带具体项目 ID 且随包分发 | S2 | 包内容检查 |
| C-02/C-03 | `core/**/*.md` 含 `D:\M1` 与 `D:\Downloads\rds`，且随包分发 | S2 | `paths:assets` 现在会 fail |
| C-05 | 结构自检的关键词表漏了拼音形式 | S3 | 补后仍 PASS，说明之前漏检 |
| C-06 | 「路径卫生」从不检查 `.md` | S2 | `CODE_EXT` 不含 `.md` |
| F-01 | 打包结果依赖工作区（两个模板未跟踪但被打进包） | **S2** | 干净克隆基线 FAIL |
| B-01…B-15 | 15 处文档与代码不一致 | S2–S4 | 逐条修，见 [M5-docs-audit.md](M5-docs-audit.md) |

---

## 4. 未完成事项

| 项 | 原因 | 下一步 |
|---|---|---|
| `ledger --path-style` | 属于「修改公开 CLI 参数」，按授权规则必须暂停 | 方案已就绪（[M5-path-portability.md](M5-path-portability.md) §5.3），待授权 |
| `rds principal add/revoke/list` | 新增公开命令，需先定「追加 vs 覆盖」「token 轮换」「并发写身份文件」三个语义 | 未排期 |
| `rds upgrade` / `rds uninstall` / `rds backup` | 同上 | 未排期；文档已明确「未实现」 |
| `render-role` 渲染器 | 工作区有未入库实现，依赖 DSH，无法在 CI 验证 | 模板已入库，渲染器保持本地 |
| macOS 验证 | 无真机；CI 矩阵未含 | 未排期 |
| 并发写 / 多语句事务 | 无压测设计 | 未排期 |
| Node 22.15.0 精确边界 | 需固定版本 runner | 未排期 |

**没有一项是「假装完成」**。每一项都在文档里明确写成「未实现」或「未验证」，且不提供空壳命令。

---

## 5. 技术债

| 债 | 规模 | 影响 | 是否可接受 |
|---|---|---|---|
| `docs/` 与 `mars/docs/` 下 **75 个历史文件**含作者机器路径 | 75 文件 | `doctor` 报 `paths:docs warn` | 接受：带日期的证据，改写等于篡改 |
| `docs/architecture/m3/baseline/cli-help.txt` 仍是 M3 时点原文 | 1 文件 | 每次基线检查走「按登记变更」分支 | 接受：变更记录在 `approved-additions.helpText` |
| 49 项未跟踪的本地材料（历史证据、运行记录、未入库渲染器） | 49 | 干净克隆看不到；不在包内 | 接受：含项目名与机器路径，不适合入库 |
| `mars/docs/architecture.md` 的模块清单过期（缺 M3 新增文件） | 1 文件 | 读者可能误判结构 | 已在 `docs/README.md` §4 登记 |
| `render-role` 模板在包内、渲染器不在 | — | 读者会问「谁生成它」 | 已如实说明 |
| 中文检索依赖 FTS5 + LIKE 回退 | — | 分词效果不如专用分词器 | 无需求提出 |
| Token 按字符估算 | — | 与实际 tokenizer 有偏差 | 已在文档标注 `[ESTIMATE]` |

---

## 6. 测试与 CI 证据

### 6.1 测试

| 项 | 值 |
|---|---|
| Required | **196 pass / 0 fail / 0 skip** |
| 相对 M4 | 173 → 196（+23） |
| 新增文件 | `arch/cli-help.test.js`（12）、`ledger/path-portability.test.js`（4）、`arch/docs-check.test.js`（7） |
| 干净克隆 | 同样 **196/196** |
| 门禁反向验证 | 注入 fail / skip / 空集，四种场景退出码全部符合预期 |
| 分层检查 | `problems=0 warnings=2`（2 条永久边界声明） |
| 行为基线 | `BASELINE PASS`，7 个面一致（`cli-help.txt` 按登记变更、`pack-files` 新增 1 个已登记文件） |
| 配置校验 | `CONFIG PASS  json=57 yaml=4` |
| 文档检查 | `DOCS PASS`，180 个 Markdown，199 个相对链接 |
| 结构自检 | `RESULT: PASS`，活跃资产项目名 0 命中 |
| 发行包 | `PACK PASS`（109 文件 / 115085 B）+ `SMOKE PASS` |
| G1 六夹具 | `RESULT: PASS`（F1 PASS、F2–F4 FAIL、F5 BLOCKED、F6 PARTIAL，均为预期裁决） |

### 6.2 CI

| 项 | 值 |
|---|---|
| Run | **42594239389** @ `72b13d5` |
| Status | **Success**，总时长 **1 分 23 秒** |
| Job | 6 / 6 success |
| 覆盖 | Windows + Ubuntu × Node 22/24、结构自检、G1 |

### 6.3 「真跑过」的四条证据

1. 四个 `required` job 各有 14 个步骤（含新加的文档一致性）
2. 总时长 1m23s，不是秒级空跑
3. `g1` 31 秒（历史上跳过时 < 1 秒）
4. `structure self-check` 23 秒（要读 300 多个文件）

---

## 7. Git

### 7.1 提交

`b89cbb2..72b13d5` 共 **10 个提交**：

```
72b13d5 docs(m5-b6): 补 G1 与结构自检的本地运行前提（git 不在 PATH 时设 RDS_GIT）
a2c2567 fix(m5-b6): 入库两个角色包模板，消除「打包结果依赖工作区」
f9be0c8 feat(m5-b6): 文档一致性检查入 CI
d630848 docs(m5-b5): 维护者指南；testing.md 按当前实现重写
05d87e2 fix(m5-b4): doctor 补两个路径扫描盲区；ledger 绝对路径只评估不改格式
d7396cf feat(m5-b3): CLI 帮助覆盖 1/19 → 22/22，修掉 init-dev --help 覆盖身份文件
3021a25 docs(m5-b2): 快速开始与安装文档修订
3db0363 docs(m5-b1): 信息架构报告与证据索引回填
80a3732 docs(m5-b1): 文档信息架构——四类分离与统一入口
9c0d1e3 docs(m5-b0): 只读基线审计与 M4 封版记录
```

### 7.2 Tag

| Tag | 提交 |
|---|---|
| `m5-b0` | `9c0d1e3` |
| `m5-b1` | `3db0363` |
| `m5-b2` | `3021a25` |
| `m5-b3` | `d7396cf` |
| `m5-b4` | `05d87e2` |
| `m5-b5` | `d630848` |
| `m5-b6` | `72b13d5` |

全部为 annotated tag，消息写清该批做了什么与验证结论。

### 7.3 没有做的事

- 没有 `force push`
- 没有改写 M1–M4 的历史提交与 Tag
- 没有用 `git add -A`
- 没有为了「Tag 能跑」而重写历史

---

## 8. 工作区保护核对

| 时点 | 未跟踪项 | 说明 |
|---|---|---|
| M4 封版 | **51** | 逐项 SHA-256 指纹存于 `D:\M1-migration\m5-protected-baseline.txt` |
| M5 终点 | **49** | 两个模板入库（`a2c2567`），其余 49 项指纹未变 |

**51 → 49 的说明**：`core/templates/role-packet.md` 与 `run-record.json` 从「未跟踪」变为「已跟踪」。这不是「覆盖原有工作」，是「把一直随包分发却没有入库的两个文件纳入版本控制」。

其余 49 项（历史证据、运行记录、未入库渲染器）**逐字节未动**。每个批次提交前都核对了这个数字；没有任何一次 `git add` 触及它们。

核对命令：

```bash
git status --porcelain -uall | wc -l            # 49
git diff --cached --name-only | wc -l           # 0（提交后）
```

---

## 9. 是否达到目标

任务书的目标是：

> 让一个没有参与过 M1—M4 开发的人，仅凭仓库中的正式文档，就能理解、安装、启动、使用、排查和维护 RDS / MARS。

逐项对照：

| 能力 | 证据 | 判定 |
|---|---|---|
| **理解** | `docs/README.md` 三条阅读路径 + `PROJECT-MAP.md` 五层结构 + 四类文档分类。180 个 md、199 个相对链接全可达 | ✅ |
| **安装** | `docs/install.md`（11 项 doctor、三种安装方式、MCP 接入、升级卸载）+ `quickstart.md` 10 步 | ✅ |
| **启动** | 干净克隆 + 发行包安装，两条路径都实测跑通 | ✅ |
| **使用** | 22 个命令全部有 `--help`，参数、必填项、示例齐全 | ✅ |
| **排查** | `maintainer-guide.md` §2 按症状查 + §3 72 个错误码全表（每条给「含义 + 你怎么修」） | ✅ |
| **维护** | 备份恢复、发布九步、基线登记规则、回滚、什么时候该停手 | ✅ |

### 9.1 但要说清边界

「达到」不等于「无懈可击」。以下六条是明确的不承诺：

1. **macOS 未验证**。代码层无 Windows 专有依赖，但没跑过就是没跑过。
2. **Node 22.15.0 未精确验证**。CI 跑的是 22.x 最新补丁版。
3. **并发写未压测**。只验证了 `busy_timeout > 0`。
4. **`ledger.json` 仍含绝对路径**。方案就绪但需授权。
5. **`rds principal` / `upgrade` / `uninstall` 未实现**。文档明确写了「未实现」，不提供空壳。
6. **本地 49 项材料不在仓库里**。干净克隆看不到它们，正式文档也不依赖它们。

### 9.2 最有力的三条证据

不是文档写得多，而是这三件事：

1. **一个 S1 缺陷被修掉**：`rds init-dev --help` 曾会覆盖身份文件。现在有 12 个测试守着，任何回退都会红。
2. **干净克隆与工作区行为一致**：196 项测试、基线、打包结果全部相同。修掉了一个「打包依赖工作区」的隐藏假设。
3. **文档里的命令逐条实测**：quickstart 10 步的每一步输出（含 `tokens=66/4000` 这个具体数字）都与文档一致。

---

## 10. 下一阶段建议

按优先级：

1. **授权 `ledger --path-style`**：方案已就绪，是唯一一个「评估完了但没做」的改动。
2. **补 macOS 到 CI 矩阵**：只需在 `matrix.os` 加一行，能把这个「未验证」变成「跑过」。
3. **`rds principal add`**：首次体验的最大摩擦点（现在要跑一段 node 脚本）。需要先定语义。
4. **并发写压测**：目前完全空白。
5. **把 49 项本地材料做一次归档决定**：要么脱敏入库，要么明确「永久本地」。现在处于中间态。

---

## 11. 一句话结论

M5 把「仓库能跑」变成了「仓库能被别人接手」。核心不是加了多少文档，而是三件事：**入口有了**（`docs/README.md` + 三条路径）、**命令能问**（22 个 `--help`，且不产生副作用）、**出错能查**（72 个错误码逐个给处置办法）。这三件事都由可执行的检查守着——测试、基线、文档链接、CI 矩阵。
