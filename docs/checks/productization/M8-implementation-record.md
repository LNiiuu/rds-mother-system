# M8 实施记录

**日期**：2026-11-12（+08:00）
**范围**：M8-1 数据安全、M8-2 上下文包优化（M8-3/4/5 见另外三份文档）
**代码提交**：`c0fe381`（本地，未推送）
**性质**：`EVIDENCE` + 实施说明

---

## 0. 起点核实（M8-0）

| 项 | 实测 |
|---|---|
| HEAD | `a067320`（M7 文档封版提交） |
| 分支 | `main` |
| `origin/main` | `ada7848`，本地领先 **1** 个提交（M7 未推送，符合约定） |
| 暂存区 | 0 |
| 工作区未跟踪 | **49**（M7 封版时的受保护工作） |
| Tag | **20**，未改动 |
| 测试基线 | **196 / 196**，`fail=0 skip=0` |
| M1–M6 封版 | M5 = COMPLETED、M6 = COMPLETED，无变化 |
| MARS 真实能力 | 与 [M7-0-baseline.md](M7-0-baseline.md) §4 一致；本轮只使用已实测的能力 |

M7 的实验数据与结论**未改动**：`M7-*.md` 五个文件与 `docs/checks/m7/` 原样保留。

---

## 1. M8-1：身份数据安全

### 1.1 问题

`init-dev` 的旧实现无条件执行：

```js
const value = { version, principals: [ /* 只有新身份 */ ] };
writeJsonAtomic(out, value);
```

目标文件里原有的 principal 会被整份替换。M7-0 实测过一次：6 个身份变 1 个，全部旧 token 立即失效。
这不是「文档警告能解决」的问题——命令行没有任何拦截点。

### 1.2 覆盖路径排查

| 路径 | 旧行为 | 现状 |
|---|---|---|
| `rds init-dev`（文件已存在，有身份） | 整份覆盖 | **拒绝**（`IDENTITY_EXISTS`），文件不动 |
| `rds init-dev --out <其他文件>` | 同上 | 同上（规则只看目标文件） |
| `rds init-dev`（文件不存在） | 创建 | 创建（不变） |
| `rds init-dev`（文件存在但 `principals: []`） | 覆盖为空 | 允许（没有可丢的数据），保留其他顶层字段 |
| `rds init-dev`（文件不是合法 JSON / 不是 principals 文档） | 静默覆盖 | **拒绝**，只有 `--replace` 才重建 |
| 其他命令写 `principals.json` | 无 | 无（`put/review/compile` 只读） |

### 1.3 新规则

| 目标状态 | 默认 | `--add` | `--replace` |
|---|---|---|---|
| 不存在 | 创建 | 创建 | 创建 |
| `principals: []` | 创建（保留其他字段） | 追加 | 重建 |
| 已有 N>0 个身份 | **拒绝** | 追加（旧 token 保留） | 重建（旧 token 全部失效） |
| 非法/异格式文件 | **拒绝** | 拒绝 | 重建 |

补充约束：

- `--add` 时 `principal_id` 不得与已有条目重复，否则拒绝且不改文件。
- `principal_id` 只允许 `[A-Za-z0-9._-]`，防止把奇怪字符写进身份文件。
- 写入仍是 `writeJsonAtomic`（临时文件 + rename），不会出现半截文件。

### 1.4 代码改动

| 文件 | 改动 |
|---|---|
| `mars/src/cli.js` | `init-dev` 分支重写：先读目标文件并判定模式，再生成 token；拒绝时 `die(..., 1)` |
| `mars/src/cli-help.js` | `init-dev` 帮助：写清默认拒绝、`--add`、`--replace` |
| `mars/tests/arch/identity-initdev.test.js` | **新增 7 例**（见 §1.5） |

### 1.5 保护测试（7 例，全过）

| # | 断言 |
|---|---|
| 1 | 首次初始化成功，token 可用 |
| 2 | 重复初始化退出 1，**文件 SHA-256 不变**，旧 token 仍可 `list` |
| 3 | `--add` 后 2 个身份，两个 token 同时有效 |
| 4 | `--add` 重复 `principal_id` 被拒，文件不变 |
| 5 | `--replace` 后仅 1 个身份，旧 token 被拒（exit 3）、新 token 可用 |
| 6 | 坏文件默认拒绝且**文件 hash 不变**；`--replace` 才重建 |
| 7 | `principals: []` 允许直接初始化 |

### 1.6 兼容性影响（重要）

**破坏性行为变更**：以前「重复执行 `init-dev` 就是重置身份」的脚本，现在会失败。
迁移方式：把这类调用改成 `--replace`（明确表示要丢弃旧 token），或改成 `--add`（保留旧身份）。

首次安装、空身份文件、`--out` 指向新路径的行为**完全不变**。

---

## 2. M8-2：上下文包

### 2.1 三个问题与对应修法

| M7 发现 | 修法 | 验证 |
|---|---|---|
| `sec_task` 只有「任务: XSUM-1」 | 新增 `--task-file <md|txt>`，正文原样写入 `sec_task`；`--task <json>` 也接受 `text` / `body` / `content` 字段 | 正文逐字包含（`true`）；7 例测试 |
| `packet` 与 `budget` 重复内容 | `--out` 的 `budget` 只留 `tokens / truncated / protected_kept / over_budget`，不再复制 `sections` | 重复字节占比 22.7% → **0** |
| `manifest` 冗余 | 新增 `--no-manifest`；Markdown 格式完全不输出 manifest（`manifest_id` 仍在 packet，DB 可追溯） | JSON 8,074 B；MD 6,589 B |

### 2.2 新增能力

| 用法 | 说明 |
|---|---|
| `rds compile --task-file ./TASK.md` | 任务正文进包，`missing` 不再提示 `task_text` |
| `rds compile --format md` | 输出易读 Markdown：元信息表 + 分节正文 + 缺失项 |
| `rds compile --no-manifest` | JSON 写出时省略 manifest |
| `rds compile --format json`（默认） | 与旧版一致：stdout 仍是 packet 本体 |

### 2.3 不改写、不截断

- `render-md.js` 只做排版：`section.content` 原样输出，不做摘要、不做裁剪。
- 预算裁剪仍由 `budget.js` 负责（受保护分节不裁），Markdown 只渲染裁剪后的结果。
- 任务正文如果超预算，会按原有规则被截断并标记 `truncated`——这一点没有为「体积指标」做特殊处理。

### 2.4 代码改动

| 文件 | 改动 |
|---|---|
| `mars/src/compiler.js` | `sec_task` 接受任务正文；缺正文时加非阻塞 `task_text` 缺失项 |
| `mars/src/render-md.js` | **新增**：packet → Markdown |
| `mars/src/cli.js` | `compile` 分支：`--task-file` / `--format` / `--no-manifest`；`budget` 摘要化 |
| `mars/src/cli-help.js` | `compile` 帮助更新 |
| `mars/tests/arch/packet-format.test.js` | **新增 7 例** |
| `docs/architecture/m3/baseline/approved-additions.json` | 登记 `mars/src/render-md.js` 进发行包 |

### 2.5 格式测试（7 例，全过）

| # | 断言 |
|---|---|
| 1 | 任务正文进入 `sec_task`，正文里的规则不丢，且不再报 `task_text` 缺失 |
| 2 | 不传正文时给出**非阻塞**提示 |
| 3 | Markdown 可读、含正文、比同包 JSON 小、无 JSON 字段名 |
| 4 | `budget` 只剩 4 个键，无 `sections`，`tokens` 与 packet 一致 |
| 5 | `--no-manifest` 只留 `{packet, budget}`，`manifest_id` 仍在 |
| 6 | 默认 stdout 仍是 packet 本体（兼容） |
| 7 | 未知 `--format` 退出 2，不产出半成品 |

---

## 3. 变更文件清单（`c0fe381`）

```
CHANGELOG.md
docs/architecture/m3/baseline/approved-additions.json
mars/src/cli-help.js
mars/src/cli.js
mars/src/compiler.js
mars/src/render-md.js                 新增
mars/tests/arch/identity-initdev.test.js  新增
mars/tests/arch/packet-format.test.js     新增
```

8 个文件，+462 / −27 行。

## 4. 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm test` | **GATE PASS tests=210 pass=210 fail=0 skipped=0** |
| `npm run config` | CONFIG PASS（json=60 / yaml=4） |
| `npm run layers` | LAYERS PASS（problems=0，warnings=2） |
| `npm run docs:check` | DOCS PASS |
| `node tooling/baseline-capture.mjs --check` | BASELINE PASS（含 `render-md.js` 登记） |
| `rds doctor` | `status: ok (fail=0 warn=1 checks=11)`；warn 为源码树 `paths:docs`，预期 |
