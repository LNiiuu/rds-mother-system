# M6 macOS 兼容性验收报告

**日期**：2026-11-11（+08:00）
**阶段**：M6 — macOS 兼容性验证（M5 之后的独立阶段，不并入 M5 的验收范围）
**起点**：`2343e4d`（M5 封版点）
**判定**：**PASS — 有限范围内的通过**

> M6 与前序里程碑并列，不是 M5 的一部分。M5 的验收标准是「可发现性」，与操作系统覆盖面无关，
> 这一点在 [M5-closure.md](M5-closure.md) §4.2 已明确。macOS 此前一直是登记在案的已知限制，
> 本阶段把它从 E3（静态推断）升到 E1（实测）。

---

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| `node:sqlite` 的 **FTS5** 在 darwin-arm64 上 | **可用**（六条断言全过） |
| `zlib.zstd` | **可用**（doctor 的 `zlib:zstd` 项 ok） |
| 196 项 Required 测试 | **196 pass / 0 fail / 0 skip** |
| 发行包端到端（打包→安装→全链路） | **PASS** |
| 过程中发现的缺陷 | **1 个**：一条测试断言在 macOS 上过强（字面路径比较），已修 |
| 是否需要改产品代码 | **不需要**（只改了一处测试断言） |
| 最终提交的 CI（`b904842`） | **run 43051690255：completed / success，7 / 7 job success，1m06s** |

---

## 1. 环境

数据来自 FTS5 探针在 `macos-latest` 上的实际输出（GitHub annotation 原文）：

```
platform=darwin arch=arm64 node=v22.23.4 sqlite=3.53.4 runner_arch=ARM64 image=macos26 checks=6/6 PASS
```

| 项 | 值 | 来源 |
|---|---|---|
| runner | `macos-latest` → **`macos26`** | 探针输出的 `image=` |
| CPU 架构 | **arm64**（Apple Silicon） | `arch=arm64`、`RUNNER_ARCH=ARM64` |
| Node 精确版本 | **v22.23.4** | `node=` |
| 内置 SQLite | **3.53.4** | `process.versions.sqlite` |
| 平台标识 | `darwin` | `process.platform` |

GitHub 同时给出一条平台侧注解，可作旁证：

> Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.

这条不是我们写的，是 GitHub 自己的提示——它独立确认了 runner 是 **arm64**。

---

## 2. FTS5 前置探针

### 2.1 为什么单独做这一步

评估阶段（[M5-macos-assessment.md](M5-macos-assessment.md) §3 D1）把「darwin 构建的 `node:sqlite` 是否启用 FTS5」列为唯一高风险项，因为它**无法靠静态阅读确定**，而整个引擎的检索压在这一条上。

做法：先用一条最短路径验掉，验不过就不谈兼容性。

### 2.2 走的是哪条路径

不是自己 `require('node:sqlite')`，而是走**项目真实路径**：

```
mars/src/db.js 的 openDb()
  → initSchema()
  → CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, content, tokenize='unicode61')
```

理由：自己另写一份只能证明「Node 有 sqlite」，证明不了「RDS 能用」。

### 2.3 原始输出（六条断言）

| # | 断言 | macOS 结果 |
|---|---|---|
| 1 | `openDb` + `initSchema` 成功（schema_version=4） | ok |
| 2 | `memories_fts` 存在且 SQL 含 `USING fts5` | ok |
| 3 | 分词器为 `unicode61` | ok |
| 4 | 直接对 FTS5 表写入 + `MATCH` 查询命中 | ok |
| 5 | 中文内容可写入，且可被其中的中文词命中 | ok |
| 6 | `memories` + `memories_fts` 联表按 `status='approved'` 检索命中 | ok |

结论行：`FTS5 PROBE PASS`（`checks=6/6`，退出码 0）。

### 2.4 没有「跳过」出口

探针里任何一步失败即 `exit 1`，没有 try/catch 吞错、没有 skip、没有 LIKE 回退兜底。
这是刻意的：FTS5 不可用时「macOS 兼容」这个结论不成立，必须让 CI 变红。

---

## 3. 三项验收

| 项 | 命令 | 结果 |
|---|---|---|
| 自检 | `node bin/rds.mjs doctor` | `status: ok`，11 项检查，`node:sqlite` 与 `zlib:zstd` 均 ok |
| Required 测试 | `npm test` | `GATE PASS tests=196 pass=196 fail=0 skipped=0` |
| 发行包端到端 | `bash tooling/ci-smoke.sh` | `PACK PASS` + `SMOKE PASS` |

三项在 macos job 内的耗时（run `43050909002`）：doctor **1 秒**、测试 **12 秒**、smoke **3 秒**。

---

## 4. 过程中发现并修复的问题

这是本阶段唯一一个「真问题」，也是它值得做的原因。

### 4.1 现象

`ffc9439` 的首次完整运行为 **6 success / 1 failure**：

| job | 结论 |
|---|---|
| 4 个 `required`（Ubuntu/Windows × 22/24） | success |
| `structure self-check` | success |
| `g1` | success |
| **`macos`** | **failure** |

失败点在 macos job 的第 7 步「Required 测试门禁」（11 秒）。而它前面的「环境信息」「FTS5 前置探针」「doctor」三步都是 success。

**这个组合本身就很有信息量**：FTS5 和 zstd 在 macOS 上没问题，问题在测试用例。

### 4.2 定位

job 日志需要认证才能下载，页面只显示 `exit code 1`。于是先做了一件事：把 `npm test` 的 TAP 摘要写进 `$GITHUB_STEP_SUMMARY`（提交 `6d4a7ec`）。

同时静态排查测试里的平台敏感点，找到一处高嫌疑：`mars/tests/ledger/path-portability.test.js` 的字面路径比较。

```js
assert.equal(j.path, path.join(dir, 'session.v4.jsonl.zstd'));
```

### 4.3 根因

macOS 上 `os.tmpdir()` 返回 `/var/folders/...`，而 `/var` 是 `/private/var` 的**符号链接**。

子进程启动时 `cwd` 被设置为 `dir`，但 `process.cwd()` 返回的是**内核给出的真实路径** `/private/var/...`。于是：

- CLI 用 `path.resolve('./session.v4.jsonl.zstd')` 得到 `/private/var/folders/.../session.v4.jsonl.zstd`
- 父进程用 `path.join(dir, ...)` 得到 `/var/folders/.../session.v4.jsonl.zstd`
- **字面不等，但指向同一个文件**

Windows 的 tmpdir 没有符号链接，Linux 的 `/tmp` 通常是实体目录，所以这个断言在两个平台上都恰好通过——它是**过强**，不是错。

### 4.4 修复

```js
assert.equal(
  fs.realpathSync(j.path),
  fs.realpathSync(path.join(dir, 'session.v4.jsonl.zstd')),
);
```

断言的本意是「相对输入指向同一个文件」，不是「字符串相同」。两边都取真实路径，任何平台上都更正确。

**只改了测试断言，没有改产品行为。** `ledger` 的 `path` 仍是绝对路径，语义不变（M5-B4 的 4 个契约用例仍在守这一点）。

### 4.5 验证

`818b93c` 的 run：**7 / 7 job 全绿**，macos job 27 秒完成。

---

## 5. 安装与手工替代路径

### 5.1 npm 安装

`ci-smoke.sh` 在 macOS 上走的路径与 Linux 同构：

```
npm install -g ./x.tgz --prefix <dir>
  → <dir>/lib/node_modules/rds-mother-system/bin/rds.mjs
```

脚本本来就是双候选（先 `lib/node_modules` 再 `node_modules`）加 `find` 兜底，macOS 命中第一个分支。**smoke 的 `PACK PASS` + `SMOKE PASS` 就是这条路径实测通过的证据。**

### 5.2 `.ps1` 的替代路径

产品内唯一随包分发的 `.ps1` 是 `core/scripts/new-project.ps1`（`core/` 整目录进包）。macOS 没有 PowerShell，替代方式是 `docs/install.md` §8 的手工路径：

1. 复制 `core/templates/project.yaml` 到项目根
2. 替换三个占位符 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>`
3. `rds validate --file <项目根>/project.yaml`

**已实测**（在本机用 POSIX 风格路径验证，机制与平台无关）：

```
project.yaml  .../my-app/project.yaml
  unknown  ok    无未知顶层键
  schema   ok    rds/project/v1
  name     ok    my-app
  root     ok    /tmp/np-manual/my-app
  stack    ok    native-bin（stacks/native-bin/stack.yaml）
status: ok
```

替代路径是「纯文本替换 + `rds validate`」，不含任何平台相关操作，因此结论可迁移。**但未在 macOS 实机逐字复跑**——这一点如实标注。

### 5.3 可执行位（只记录，未修）

`git ls-files -s` 显示全仓 **0 个 `100755`**，而 `bin/rds.mjs`、`tooling/*.mjs`、`tooling/ci-smoke.sh` 都写了 shebang。

| 调用方式 | macOS 结果 |
|---|---|
| `npm install -g .` / `npm link` | 可用（npm 按 `bin` 字段生成 shim 并 chmod） |
| `node bin/rds.mjs` | 可用 |
| `bash tooling/ci-smoke.sh` | 可用 |
| `./bin/rds.mjs` | **Permission denied** |

**本轮不改**：改文件模式会产生跨平台 diff 噪音，且真实使用路径（npm 安装、`node` 调用）都不受影响。CI 里用 `node "$RDS_BIN"` 调用，不依赖可执行位。

---

## 6. 支持边界

### 6.1 已验证

| 项 | 证据 |
|---|---|
| macOS `macos26` runner / arm64 | 探针输出的 `image=`、`arch=`、`runner_arch=` |
| Node v22.23.4 on darwin-arm64 | 同上 |
| `node:sqlite` 内置 SQLite 3.53.4 + FTS5 + unicode61 | 六条断言 |
| `zlib.zstd` | doctor 的 `zlib:zstd` ok |
| 196 项 Required 测试 | `GATE PASS 196/196` |
| 发行包打包、安装、全链路 | `PACK PASS` + `SMOKE PASS` |
| 手工替代 `new-project.ps1` | 本机 POSIX 路径实测 |

### 6.2 未验证（明确不承诺）

| 项 | 原因 |
|---|---|
| **Intel Mac（x64）** | `macos-latest` 是 arm64；要覆盖需另加 `macos-13` job |
| 其他 macOS 版本 | runner image 会随 GitHub 升级（现在是 `macos26`），未固定 |
| Node 24 on macOS | 只跑了 22.x |
| 真实 DSH 客户端联调 | 需真机与真实会话 |
| `core/scripts/new-project.ps1` 在 macOS | 需要 pwsh，未纳入 |
| 文件系统大小写敏感场景 | APFS 默认不敏感，未构造专门用例 |
| 权限受限场景（只读目录、非属主文件） | 未在 macOS 上构造 |

**一句话**：这份报告证明的是「在 GitHub 的 macOS 26 arm64 runner 上、用 Node 22.23.4，RDS 能装、能跑、196 项测试与全链路通过」。它不能证明「所有 macOS 都支持」。

---

## 7. CI 证据

### 7.1 最终 run（收尾判定依据）

| 项 | 值 |
|---|---|
| run | **43051690255**（run number 24） |
| commit | `b904842779f56c5640e043debb6cb300e17ddb5c` |
| 触发 | `push` 到 `main`，`.github/workflows/ci.yml` |
| 起止 | 2026-11-11T15:46:26Z → 15:47:32Z |
| `status` / `conclusion` | **`completed` / `success`** |
| 总时长 | **1 分 06 秒** |
| job | **7 / 7 success** |

七个 job 的逐项记录（来源：`actions/runs/43051690255/jobs`）：

| job | `status` | `conclusion` | 起止（UTC） | 耗时 |
|---|---|---|---|---|
| `required (ubuntu-latest / node 24.x)` | completed | success | 15:46:28 → 15:46:40 | 12s |
| `required (ubuntu-latest / node 22.x)` | completed | success | 15:46:29 → 15:46:41 | 12s |
| `macos (macos-latest / node 22.x)` | completed | success | 15:46:29 → 15:46:43 | **14s** |
| `g1 (windows-latest / powershell)` | completed | success | 15:46:29 → 15:46:52 | 23s |
| `required (windows-latest / node 22.x)` | completed | success | 15:46:29 → 15:47:31 | 62s |
| `required (windows-latest / node 24.x)` | completed | success | 15:46:29 → 15:47:32 | 63s |
| `structure self-check (windows-latest)` | completed | success | 15:46:30 → 15:47:10 | 40s |

macos job 的十二个步骤全部 `success`，其中关键四步：

| 步骤 | 起止（UTC） | 耗时 |
|---|---|---|
| 环境信息 | 15:46:32 → 15:46:32 | <1s |
| **FTS5 前置探针** | 15:46:32 → 15:46:32 | <1s |
| 自检（doctor） | 15:46:32 → 15:46:32 | <1s |
| **Required 测试门禁** | 15:46:32 → 15:46:38 | **6s** |
| **发行包端到端** | 15:46:38 → 15:46:40 | **2s** |
| 证据汇总（annotation） | 15:46:40 → 15:46:40 | <1s |

这个 run 的两条 annotation 原文（公开可读，无需下载日志）：

```
FTS5 probe     : platform=darwin arch=arm64 node=v22.23.4 sqlite=3.53.4 runner_arch=ARM64 image=macos26 checks=6/6 PASS
macos evidence : status: ok | GATE PASS tests=196 pass=196 fail=0 skipped=0 | SMOKE PASS
```

两条都与 [§1](#1-环境)、[§3](#3-三项验收) 的数字一致：**同一份证据，不是另一次运行的结论**。

> 判定口径：只用 `actions/runs/{id}` 的 `conclusion` 加 `actions/runs/{id}/jobs` 的逐 job 记录。
> `commits/{sha}/check-runs` 对 job 级状态的更新会滞后（M5 封版时已记录过反例）。

### 7.2 首个全绿 run（失败到通过的转折点）

| 项 | 值 |
|---|---|
| 首个全绿 run | **43050909002** @ `818b93c1c40e9066460832c3cd98a4da9d2ea0ab` |
| 判定 | **7 / 7 job success** |
| 起止 | 2026-11-11T15:41:43Z → 15:43:07Z，总时长 **1 分 24 秒** |
| 转折 | `ffc9439`（macos 红）→ 修复 → `818b93c`（全绿） |

### 7.3 macos job 的步骤与耗时（run 43050909002）

| # | 步骤 | 起止（UTC） | 耗时 |
|---|---|---|---|
| 1 | Set up job | 15:41:49 → 15:41:51 | 2s |
| 2 | checkout | 15:41:51 → 15:41:53 | 2s |
| 3 | setup-node | 15:41:53 → 15:41:55 | 2s |
| 4 | 环境信息 | 15:41:55 → 15:41:55 | <1s |
| 5 | **FTS5 前置探针** | 15:41:55 → 15:41:55 | **<1s** |
| 6 | 自检（doctor） | 15:41:55 → 15:41:56 | 1s |
| 7 | **Required 测试门禁** | 15:41:56 → 15:42:08 | **12s** |
| 8 | **发行包端到端** | 15:42:08 → 15:42:11 | **3s** |
| — | 整个 job | 15:41:48 → 15:42:15 | **27s** |

### 7.4 七个 job 的耗时对照（run 43050909002）

| job | 耗时 |
|---|---|
| `required (ubuntu-latest / node 22.x)` | 17s |
| `required (ubuntu-latest / node 24.x)` | 18s |
| `structure self-check (windows-latest)` | 19s |
| `g1 (windows-latest / powershell)` | 23s |
| **`macos (macos-latest / node 22.x)`** | **27s** |
| `required (windows-latest / node 24.x)` | 62s |
| `required (windows-latest / node 22.x)` | 79s |

macOS job 比 Windows 的 `required` 更快，主要因为它只跑三步（探针 + doctor + 测试 + smoke），没有 config/layers/docs:check 的重复。

> 两次 run 的 macos 耗时不同（27s vs 14s），差异来自 runner 冷热与 checkout 速度，
> 不是验证内容变化：两次的步骤集合与断言完全相同，`818b93c` 之后只改了输出方式（annotation）与文档。
> 引用耗时时应带 run id，不要当成固定值。

---

## 8. Git 与保护工作核对

### 8.1 M6 的提交

| 提交 | 内容 | 验证 |
|---|---|---|
| `48a3415` | 新增 `tooling/fts5-probe.mjs` + 临时 `macos-probe` job | 探针 job succeeded / 9s，六条断言全过 |
| `ffc9439` | 探针通过，改为完整 `macos` job（doctor + test + smoke） | **7 job 中 macos 红**（测试门禁 11s） |
| `6d4a7ec` | 测试门禁失败时把 TAP 摘要写入 step summary | 诊断用（被下一次 push 取消） |
| `818b93c` | 修 `path-portability` 的字面路径断言（改比 realpath） | **7/7 全绿** |
| `df03d7c` | 把 doctor/test/smoke 的结论固化成 annotation | run 43051314697 全绿；annotation 生效 |
| `b904842` | 本报告与三处文档同步（纯文档） | **run 43051690255：7/7 全绿，1m06s**，见 §7.1 |

### 8.2 保护工作

| 时点 | 未跟踪项 |
|---|---|
| M5 封版 | 49 |
| M6 起点 | 49 |
| M6 各批次提交后 | **49**（每次提交后核对，未触及任何受保护文件） |

M6 的代码改动只有 3 个文件：`tooling/fts5-probe.mjs`（新）、`.github/workflows/ci.yml`、`mars/tests/ledger/path-portability.test.js`；另有 5 个文档文件在 `b904842` 中同步。**没有动任何受保护的 49 项。**

### 8.3 没有做的事

- 没有 `git add -A`
- 没有 `force push`
- 没有修改 M5 及更早的提交与 Tag
- 没有为了让 CI 变绿而跳过或弱化任何断言

---

## 9. 证据固化机制

`df03d7c` 给 macos job 加了一个「证据汇总（annotation）」步骤：把 `status: ok`、`GATE PASS tests=…`、`SMOKE PASS` 合成一条 annotation 与一段 summary。

为什么需要：job 日志要认证才能下载，而验收报告要引用「doctor 什么状态、测试多少项通过、smoke 是否通过」。annotation 是公开可读的。

怎么用：打开任一 macos job 的页面，在 **Annotations** 区域能看到两条：

| 标题 | 最终 run（`43051690255` @ `b904842`）的原文 |
|---|---|
| `FTS5 probe` | `platform=darwin arch=arm64 node=v22.23.4 sqlite=3.53.4 runner_arch=ARM64 image=macos26 checks=6/6 PASS` |
| `macos evidence` | `status: ok \| GATE PASS tests=196 pass=196 fail=0 skipped=0 \| SMOKE PASS` |

这条机制从 `df03d7c` 起生效。**它不改变任何验证内容**，只是让结果可核对。

> 每次 macos run 都会产生这两条 annotation，内容随实际结果变化。
> 判定仍以 `actions/runs/{id}` 的 `conclusion` 加 `actions/runs/{id}/jobs` 的逐 job 记录为准——
> `check-runs` 端点对 job 级状态的更新会滞后（M5 封版时已记录过这一点）。

---

## 10. 待确认

1. 是否把 `macos` job 提升为**阻塞合并**（与 `required` 同级）？当前它只是"跑"，红了不影响其他 job 的结论。
2. 是否需要覆盖 **Intel Mac**（另加 `macos-13`）？成本是多一个 job。
3. 是否需要 **Node 24 on macOS**（并入 matrix）？当前只跑 22.x。
4. 可执行位要不要修（`git update-index --chmod=+x bin/rds.mjs`）？当前判断是不值得。

---

## 11. 本轮没有做的事

- 未改 `ledger` 的路径格式（`--path-style` 仍待授权）
- 未实现 `rds principal add` 等命令
- 未改任何数据库 Schema、公开 CLI 参数、JSON 输出形状
- 未引入任何第三方依赖
- 未修改 M5 及更早的验收结论
