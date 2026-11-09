# M5-B3 CLI 帮助覆盖报告

**日期**：2026-11-09（+08:00）
**批次**：M5-B3
**起点**：`3021a25`（B2）
**性质**：补齐帮助、修掉一个 S1 数据丢失缺陷。**未新增公开命令、未改任何已有参数名与 JSON 输出。**

---

## 1. 修复前：19 个命令里只有 1 个能看帮助

B0 实测（逐个执行 `rds <cmd> --help`）：

| 命令 | 实际行为 | 后果 |
|---|---|---|
| `init` | **创建/打开数据库并输出 stats** | 想看说明，结果建了库 |
| `init-dev` | **生成身份并整个覆盖 `principals.json`** | 想看说明，结果删掉了已有的 5 个身份 |
| `put` `get` `list` `search` `review` `alias` `compile` `fragment` `stats` `audit` | `ERROR 认证失败：TOKEN_MISSING`，exit 3 | 把「请求帮助」诊断成「凭证问题」 |
| `project` `share` `orchestrate` | 同上 | 同上 |
| `mcp` | `ERROR MCP 网关默认禁用`，exit 5 | 同上 |
| `ledger` | 正确的用法说明 | ✅ |
| `help` | 顶层用法 | ✅ |

**覆盖率：1 / 19。** 更严重的是 `init-dev --help` 会丢数据。

### 1.1 为什么 `--help` 会触发副作用

调用链是 `bin/rds.mjs` → `mars/src/cli.js`。入口把除 `version`/`doctor`/`validate`/`test` 之外的命令原样转交，而 `cli.js` 只在 `ledger` 分支里检查了 `args.help`：

```js
if (cmd === 'ledger') {
  if (args.help) { /* 打印用法 */ return; }
  ...
}
if (cmd === 'init-dev') {
  const token = crypto.randomBytes(24).toString('hex');
  writeJsonAtomic(out, value);   // ← --help 也会走到这里
}
```

`--help` 被 `parseArgs` 解析成 `{help: true}`，但在没有分支消费它时，它就是一个被**静默忽略**的参数。忽略一个无害参数通常没事，忽略 `--help` 的代价是「用户想看的说明变成了实际动作」。

---

## 2. 修复方案

### 2.1 单一真相

新建 `mars/src/cli-help.js`（纯数据 + 渲染，零 `require`）：

- `USAGE` —— 顶层用法
- `TOPICS` —— 22 个命令的 `{usage, summary, args, subcommands, examples}`
- `render(cmd)` —— 渲染成对齐的文本
- `BUILTINS` —— 由 `bin/rds.mjs` 直接实现的 4 个命令名

`bin/rds.mjs` 与 `mars/src/cli.js` 都从这里取文本。此前两份已经分叉：`cli.js` 的简版漏了 `orchestrate`，`bin` 的完整版没有 `help` 命令说明。

### 2.2 帮助必须先于一切

`cli.js` 的 `run()` 现在第一件事就是判断帮助，**早于** `createRuntime()`（会 fail-fast 读契约）、早于 `loadAuth()`（会读身份文件）、早于任何业务分支：

```js
function run(args) {
  const cmd = args._[0];
  if (!cmd) { console.log(USAGE); return; }
  if (cmd === 'help') { ... }
  if (args.help) {
    const text = renderHelp(cmd);
    if (text) { console.log(text); return; }
    die('未知命令: ' + cmd + '（rds --help 查看命令）', 2);
  }
  const runtime = createRuntime({ argv: args });   // ← 从这里开始才碰文件和身份
  ...
}
```

`bin/rds.mjs` 同样对 4 个内建命令加了 `--help` 判断。此前 `rds version --help` 打印版本号、`rds doctor --help` 真的去跑体检。

### 2.3 `-h` 与 `--help` 等价

`parseArgs` 新增 `-h` → `{help: true}`。`--help` 是 `--` 前缀，`-h` 不是，此前会掉进位置参数 `args._`。

### 2.4 参数列按显示宽度对齐

第一版用 `String.padEnd`，中文参数（如 `--term <词>`）比 ASCII 参数在终端里宽一倍，导致说明列错位。改为按**终端显示宽度**计算（CJK 计 2 列）。

### 2.5 变更留痕而不是覆盖基线

`docs/architecture/m3/baseline/cli-help.txt` 是严格相等比较。此前唯一「通过」的办法是重新采集基线，等于把一次对外可见变更静默抹掉。

`tooling/baseline-capture.mjs` 新增 `approved-additions.helpText` 登记位，与 `contractChanges` 同一套模式：

```json
"helpText": {
  "sha256": "18b699cf…",
  "batch": "m5-b3",
  "reason": "补齐 orchestrate 与 project/share 子命令说明、新增 help 命令与 -h 别名…"
}
```

基线文件保留 M3 时点的原文；变更记录在登记表。`--check` 时输出 `cli-help.txt 已按登记变更（batch=m5-b3）`，不是静默通过。

新增源文件 `mars/src/cli-help.js` 同时登记进 `packFiles`（包内文件数 108 → 109）。

---

## 3. 修复后：22 / 22

| 命令 | exit | 输出字节 | 首行 |
|---|---|---|---|
| `version` | 0 | 333 | `用法: rds version` |
| `doctor` | 0 | 470 | `用法: rds doctor [--json]` |
| `validate` | 0 | 547 | `用法: rds validate [--file <project.yaml>]` |
| `test` | 0 | 447 | `用法: rds test [--raw]` |
| `init` | 0 | 462 | `用法: rds init [--db <path>]` |
| `init-dev` | 0 | 702 | `用法: rds init-dev [--principal <id>] …` |
| `put` | 0 | 977 | `用法: rds put --project <id> --type <L1\|L2\|L3\|L4> …` |
| `get` | 0 | 499 | `用法: rds get --project <id> --memory <memory_id>` |
| `list` | 0 | 603 | `用法: rds list --project <id> [--status <s>] …` |
| `search` | 0 | 714 | `用法: rds search --project <id> --query <文本> …` |
| `review` | 0 | 704 | `用法: rds review --project <id> --memory <id> …` |
| `alias` | 0 | 545 | `用法: rds alias --project <id> --term <词> …` |
| `compile` | 0 | 882 | `用法: rds compile --project <id> --task <id\|文件> …` |
| `fragment` | 0 | 470 | `用法: rds fragment --project <id> --fragment <id>` |
| `stats` | 0 | 405 | `用法: rds stats --project <id>` |
| `audit` | 0 | 406 | `用法: rds audit [--limit <n>]` |
| `ledger` | 0 | 780 | `用法: rds ledger --session <文件> …` |
| `mcp` | 0 | 438 | `用法: rds mcp --enable` |
| `project` | 0 | 603 | `用法: rds project <register\|list> [选项]` |
| `share` | 0 | 949 | `用法: rds share <create\|approve\|revoke\|list> [选项]` |
| `orchestrate` | 0 | 1286 | `用法: rds orchestrate <plan\|start\|approve\|feedback\|status\|suggest> [选项]` |
| `help` | 0 | 394 | `用法: rds help [命令]` |

每个命令的帮助包含：用法行、一句话说明、子命令（若有）、选项表（必填项标注）、公共选项、示例。

### 3.1 副作用验证

用隔离的 `MARS_DB` / `MARS_PRINCIPALS` 指向空目录，执行 4 个敏感命令的 `--help`：

| 命令 | 执行前目录 | 执行后目录 | 退出码 |
|---|---|---|---|
| `rds init --help` | 空 | **空** | 0 |
| `rds init-dev --help` | 空 | **空** | 0 |
| `rds put --help` | 空 | **空** | 0 |
| `rds mcp --help` | 空 | **空** | 0 |

另测：已有 `principals.json`（含一个 `keep-me` 身份）时执行 `rds init-dev --help`，文件**逐字节不变**。

---

## 4. 未实现功能的处理

任务书要求「不允许用空壳命令伪装功能已经实现；过时功能应明确标记、删除或记录为未来计划」。

核查结论：`KNOWN_COMMANDS` 中的 18 个命令**全部有真实实现分支**，不存在只打印 TODO 的空壳。

文档中引用但未实现的命令，本轮只做**口径统一**，不新增命令：

| 命令 | 文档引用 | 处理 |
|---|---|---|
| `rds principal add/revoke/list` | 5 处 | 文档改为「未实现」；`install.md` §7 给出可复制的追加身份脚本 |
| `rds upgrade` / `rds uninstall` | 5 处 | 文档改为「未实现，本轮也不计划实现」；升级 = 覆盖安装 |
| `rds backup` / `rds restore` | 3 处 | 明确它们是 `tooling/*.ps1` 脚本，不是 `rds` 子命令 |
| `render-role` | 6 处 | 改为「未纳入仓库与发行包」；工作区存在未入库的 PowerShell 实现，不随包分发 |

**为什么不实现 `rds principal add`**：它会改变公开 CLI 面（新增命令），按本轮授权规则必须先暂停并给方案。且它需要处理「追加 vs 覆盖」「token 轮换」「并发写身份文件」三个语义问题，不适合在收尾阶段顺手做。

---

## 5. 顺带修掉的污染

| 项 | 修复前 | 修复后 |
|---|---|---|
| `mars/config/principals.example.json` | `project_ids: ["xingrixiao","m1-dev"]`（**随发行包分发**） | `["demo","example"]`、`["demo"]` |
| `mars/README.md` | 示例命令用 `--project xingrixiao`、`node D:\M1\…`、测试数写「80 用例」、`Node.js v24` | 重写为参数化示例、相对路径、173 用例、指向 `docs/` |
| `CHANGELOG.md:143` | 复述了两个具体项目 ID | 改为「两个具体项目 ID」，不复述 |
| `tests/self/run.ps1` 的关键词表 | 只查中文名与旧代号，**漏了拼音形式** | 补 `xingrixiao`、`m1-dev`；同时排除 `.git`/`node_modules`/`var` 与本地身份文件，避免把运行配置当活跃资产 |

修复后结构自检：**活跃资产 0 命中**，历史记录 35 处仅告警（`RESULT: PASS`）。

---

## 6. 测试

新增 `mars/tests/arch/cli-help.test.js`，12 个用例，分三组：

| 组 | 用例 | 守什么 |
|---|---|---|
| 覆盖 | 每个已知命令都有帮助条目 | 新增子命令时不许漏 |
| 覆盖 | 每个帮助条目都对应已知命令 | 删除命令后不许留死条目 |
| 覆盖 | 22 个命令 `--help` 退出码 0 且以「用法: rds」开头 | 不许再出现认证失败 / 网关禁用 |
| 覆盖 | `-h` 与 `--help` 输出一致 | 别名不分叉 |
| 无副作用 | `init --help` 不创建数据库 | 回归 D-02 |
| 无副作用 | `init-dev --help` 不改写已有身份文件 | 回归 D-01（S1） |
| 无副作用 | 身份文件缺失时 10 个命令 `--help` 不报认证错误 | 回归 D-03 |
| 无副作用 | `mcp --help` 不返回「网关默认禁用」 | 回归 D-04 |
| 一致性 | `rds help <cmd>` 与 `rds <cmd> --help` 逐字节相同 | 两个入口不分叉 |
| 一致性 | 顶层帮助列出全部命令与 6 个公共选项 | 防止新命令不出现在总览 |
| 一致性 | 未知命令的 `--help` 报未知命令而非认证失败 | 错误诊断正确 |
| 一致性 | 帮助文本不含本机绝对路径 | 可移植 |

---

## 7. 验证结果

| 检查 | 结果 |
|---|---|
| Required 测试 | `GATE PASS tests=185 pass=185 fail=0 skipped=0`（173 → 185） |
| 分层检查 | `LAYERS PASS problems=0 warnings=2` |
| 行为基线 | `BASELINE PASS`；`cli-help.txt` 按登记变更；`pack-files` 新增 `cli-help.js` 已登记 |
| 配置校验 | `CONFIG PASS json=57 yaml=4` |
| 结构自检 | `RESULT: PASS`（活跃资产项目名 0 命中） |
| 发行包 | `PACK PASS` + `SMOKE PASS`；包内 109 文件（+1） |
| 副作用 | 4 个敏感命令 `--help` 前后目录均为空 |

---

## 8. 遗留

| 项 | 说明 |
|---|---|
| `rds principal add` 等生命周期命令 | 未实现，已在文档明确标注 |
| `docs/architecture/m3/baseline/cli-help.txt` 仍是 M3 时点原文 | 设计如此：变更记录在 `approved-additions.helpText`，不靠覆盖基线抹掉痕迹 |
| `-v` / `--version` 未进帮助表 | 它们是 `version` 的别名，已在 `version` 条目里说明 |
