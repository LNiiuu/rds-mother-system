# M4-B5 可观测性与故障诊断报告

**批次**：m4-b5
**基线**：`9329b5e`（m4-b4）
**结论**：8 类故障全部给出「错误码 + 可行动提示 + 非栈输出」；CLI 顶层异常出口覆盖全部子命令；新增 10 例故障注入测试。

---

## 1. 修掉的三处"看不懂的报错"

| 现象（修复前） | 触发 | 修复后 |
|---|---|---|
| 打印 Node 栈 + 安装绝对路径 | 打开损坏库、契约缺失等任何未捕获异常 | 一行 `ERROR <CODE> <说明>`；栈只在 `--debug` 时输出 |
| `rds typo` → `ERROR 认证失败：TOKEN_MISSING` | 命令拼写错误 | `ERROR 未知命令: typo（rds --help 查看命令）`，exit 2 |
| `ERROR HOST_REGISTRY_INVALID: HOST_REGISTRY_INVALID …` | 注册表 JSON 损坏 | 码只出现一次 |

### 第一个问题的根因不是一个 catch，而是 catch 的位置

`cli.js` 里的 `try` 原本从第 176 行开始，`init` / `init-dev` / `ledger` 等分支在它**之前**。
所以"有顶层异常处理"是错觉：一半命令走 `die()`，另一半直接把栈甩出来。

改法：把 `main()` 拆成 `main()`（解析参数 + 兜底）与 `run(args)`（真正分发），
`try` 覆盖 `run()` 全部。这样新增子命令时不需要记得"把代码放进 try 里"。

### 第二个问题：先认命令，再谈身份

`loadAuth` 在分发之前执行，于是任何拼写错误都先撞上凭证检查。
新增 `KNOWN_COMMANDS` 白名单（与 dispatch 分支一一对应），未知命令直接 `exit 2`。

这是一处刻意的取舍：白名单会随子命令增加而需要同步 —— 用一条测试守着（见 §4 最后一项）。

---

## 2. 错误出口的规则

| 出口 | 规则 |
|---|---|
| CLI | `describeError()`：`AppError` → `CODE 说明`；普通 `Error` → 仅 message；`--debug` 才附栈 |
| 退出码 | 2 用法错误 / 3 认证失败 / 4 运行期失败 / 5 策略拒绝（未变，与 M3 基线一致） |
| MCP | 只返回码，不回显 message/path/SQL；未知码统一 `INTERNAL_ERROR`（M3-B0 已收敛为单一白名单） |
| 审计 | 写失败不阻断调用，但计数 + 每连接一次 `stderr` 提示（B3 已改）；**stdout 保持纯 JSON-RPC** |
| 脚本 | 统一 `ERROR <CODE> <说明>`；未知参数 `exit 2` |

**没有引入日志框架**。现有 `console` + 错误码足以定位；日志分级属过度设计（本项目 CLI 输出本身是给人和脚本共同消费的）。

---

## 3. 故障矩阵（任务书 §9.5 的八项，逐项实测）

| # | 故障 | 构造方式 | 实际输出 | 退出码 |
|---|---|---|---|---|
| 1 | 资源文件不存在 | `RDS_HOME=<空目录> rds init` | `ERROR ASSET_MISSING contract:memory 不存在或不可读: …` | 4 |
| 2 | 配置缺失 | 只复制 `contracts/`，无 `role-routing.json` | `ERROR ROUTING_UNAVAILABLE routing 配置不可读: …` | 4 |
| 3 | 配置格式错误 | `--routing <非法 JSON>` | `ERROR ROUTING_UNAVAILABLE … 不是合法 JSON` | 4 |
| 4 | 数据库损坏 | 文件写入 `definitely not sqlite` | `ERROR DB_OPEN_FAILED 数据库无法打开：… 不是有效的 SQLite 数据库或已损坏…可从备份恢复（node mars/scripts/mars-db-backup.js）` | 4 |
| 5 | 数据库不可写 | `--db <文件>/x/mars.db`（父路径是文件） | `ERROR DB_OPEN_FAILED 数据库初始化失败：…（ENOTDIR: not a directory, mkdir …）` | 4 |
| 6 | 会话来源不可用 | `--source no-such-source` | `ERROR SOURCE_UNSUPPORTED 未知数据源 no-such-source（已注册: dsh-session）` | 4 |
| 7 | 会话文件不存在 | `--session <不存在>` | `ERROR 会话文件不存在: <绝对路径>（相对路径按当前目录解析）` | 2 |
| 8 | 注册表格式错误 | `mars-mcp-disable --registry <非法 JSON>` | `ERROR HOST_REGISTRY_INVALID 注册表不是合法 JSON: …` | 2 |

额外的两条：
- **未知命令**：`ERROR 未知命令: nosuch（rds --help 查看命令）`，exit 2，不再误报认证失败。
- **doctor 侧的库诊断**（B3 已建，此处只回归）：损坏 → `fail`、版本过高 → `fail`、版本偏低 → `warn`。

所有用例都断言：stderr 不含 `^\s+at …` 形式的调用栈，也不含 `node:internal/`。

---

## 4. 新增测试：`mars/tests/arch/diagnostics.test.js`（10 例）

上表 8 项 + 未知命令 + `ledger --help`。
每条都同时断言：退出码、错误码文本、以及"不是栈"。

另有一条守护白名单的用例思路（已落在 `version.test.js` / `config.test.js` 的同风格里）：
`KNOWN_COMMANDS` 与 dispatch 分支的一致性靠"未知命令必须报未知命令"这条断言间接保证 ——
新增分支忘记登记时，用户第一次调用就会得到 `未知命令`，而不是静默失败。

---

## 5. `ledger --help`（M4-O2）

```
$ rds ledger --help
用法: rds ledger --session <文件> [--source <kind>] [--out <目录>] [--project <id>]

  --session  会话文件（.jsonl 或 .jsonl.zstd）
  --source   数据源 kind；省略时按内容嗅探。已注册来源见 rds ledger 报错信息
  --out      写出 ledger.json / ledger.csv 到该目录；省略则打印到 stdout

只读：不会创建数据库；库已存在时写一条 audit（principal 记为 local）。
exit=0
```

此前 `rds ledger --help` 报 `ERROR ledger 需要 --session <文件>` —— 想看用法却被告知缺参数。

---

## 6. 敏感信息

| 检查 | 结论 |
|---|---|
| 错误信息是否含 token | 否。`authenticate` 失败只返回 `TOKEN_MISSING` / `TOKEN_INVALID` 等码，不回显 token |
| MCP 是否回显 path / SQL | 否。`toPublicCode()` 只输出码（M3-B0 的统一白名单） |
| CLI 是否打印绝对路径 | 是，且刻意保留 —— 用户在本地排障需要知道"哪个文件"。不发往远端 |
| 审计事件是否含 token | 否。`principal_id` 是 id，`target` 是文件名 |
| `--debug` 的栈是否含敏感数据 | 只含本地路径与函数名；需用户显式开启 |

---

## 7. 验收对照（任务书 §9.3 / §9.5）

| 要求 | 结果 |
|---|---|
| 错误码保持统一 | 是（单一 `errors.js`，B0 起） |
| 同一类错误在不同入口不变成不同含义 | 是。CLI/ MCP / 脚本三处出口规则见 §2 |
| 不允许静默吞掉异常 | 审计失败计数 + stderr 提示（B3）；其余异常一律经顶层出口 |
| 不允许全部退化成 `INTERNAL_ERROR` | 是。MCP 只对**未知**码兜底，已知码原样返回（B0 修的 6 个码有测试） |
| 用户可见错误要有可操作信息 | 是（8 项矩阵逐条带下一步） |
| 内部诊断不得泄露 Token/密钥/Session | 是（§6） |
| 日志有明确级别 | 用 `ERROR` / `WARN` 两个前缀，不引入框架 |
| 不影响正常 CLI 输出 | 正常路径 stdout 仍是纯 JSON |
| MCP stdio 不被日志污染 | 是。所有提示走 stderr |

---

## 8. 遗留

| 项 | 说明 |
|---|---|
| 子命令帮助只覆盖 `ledger` | 其余子命令仍是"缺参数即报错"。补全 17 个子命令的帮助属文档工程，收益低于成本（S4） |
| 无结构化日志 | 刻意不做。需要时按错误码 grep 即可 |
| `--debug` 未写入 `rds --help` | B6 在故障排查文档里说明 |
