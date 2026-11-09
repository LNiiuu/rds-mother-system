# RDS 安装与部署

> 本文是**唯一权威安装文档**。README 只给定位与最短路径；凡涉及"怎么装、装完怎么验"，以本文为准。
> 适用基线：`VERSION` 0.1.0 = `package.json` 0.1.0。文档若与代码冲突，以 `rds doctor` 与测试的实际输出为准。
>
> **发行包只带本文与 `README.md`**。本文中指向 `docs/testing.md`、`docs/versioning.md`、`docs/checks/` 的链接在发行包内不可点——它们在源码仓库里。只想快速跑通的人看 `docs/quickstart.md`（同样在仓库内）。

---

## 1. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **>= 22.15.0** | `node:sqlite` 自 22.5 起提供；`zlib` 的 zstd（`rds ledger` 解析会话必需）到 22.15 才进 v22 分支。22.22.x 与 24.x 已实测通过 |
| npm | 随 Node 附带 | 只用于安装本包；运行时不依赖任何第三方库 |
| Git | 可选 | 仅 `tooling/sync.ps1`、`tooling/backup.ps1` 等运维脚本需要；MARS 本体不需要 |
| PowerShell | 仅 Windows 需要 5.1+ | 只用于 `.ps1` 脚本；`rds` 命令本身在两个平台等价 |
| 网络 | **不需要** | 安装后完全离线可用；本包不调用任何 AI API |

macOS **未实机验证**（E3）：代码层面无 Windows 专有依赖（仅 4 处 `powershell.exe` 出现在测试与脚本中），但未在真机跑过，故不作承诺。

---

## 2. 获取代码

```bash
git clone https://github.com/LNiiuu/rds-mother-system.git
cd rds-mother-system
```

没有 git 时，下载 ZIP 解压到任意目录即可。

---

## 3. 安装

### 3.1 全局安装（推荐）

```bash
npm install -g .
rds --version      # 应输出 0.1.0
```

### 3.2 免安装试用

```bash
node bin/rds.mjs --version
node bin/rds.mjs doctor
```

### 3.3 开发者链接安装

```bash
npm link
rds doctor
```

> **已知限制**：本包尚未发布到 npm registry，`npm i -g rds-mother-system` 会失败，请用本地路径安装。

---

## 4. 安装后自检

```bash
rds doctor
```

典型输出（从发行包安装、未初始化数据时，实测 2026-11-09 / Windows / Node 22.22.2）：

```
RDS doctor  root=<安装目录>

  node          ok    v22.22.2（要求 >=22.15.0；22.5 起有 node:sqlite，22.15 起才有 zlib zstd）
  node:sqlite   ok    模块可用，FTS5 虚拟表可用
  zlib:zstd     ok    zstdCompressSync / zstdDecompressSync 可用（rds ledger 依赖）
  git           ok    git version 2.55.0.windows.3
  writable      ok    <安装目录>
  version       ok    0.1.0（VERSION 与 package.json 一致）
  paths:code    ok    已扫描 63 个代码/配置文件，无本机绝对路径
  paths:docs    ok    历史文档无本机绝对路径
  paths:assets  ok    已扫描 44 个活跃文档，无本机绝对路径
  identity      info  未创建（rds init-dev 生成；不要把生成的 token 写入版本库）
  database      info  未初始化：<安装目录>/mars/var/mars.db（rds init 创建）

status: ok  (fail=0 warn=0 checks=11)
```

- 共 **11** 项检查。三个计数随安装形态与版本变化，只作对照，不是契约：
  `paths:code` 发行包约 **63**、源码树约 **140**（含测试与工具脚本）；
  `paths:assets` 发行包约 **44**（进包的 `core/**/*.md` 与正式文档）。
- 三个 `paths:*` 的区别：
  - `paths:code` —— 代码与配置，必须为 0，否则 `fail`
  - `paths:assets` —— **会进发行包或作为仓库门面**的文档（`README.md`、`CHANGELOG.md`、`core/**/*.md`、正式文档），必须为 0，否则 `fail`
  - `paths:docs` —— **历史证据**（`docs/checks/`、`docs/history/`、`mars/docs/`），源码树里会有几十个命中并给出 `warn`。这是预期：那些是带日期的记录，改写等于篡改证据
- 有 `fail` 时退出码为 `1`，可直接用于 CI 门禁；只有 `warn` 时退出码为 `0`。
- `rds doctor --json` 输出机器可读结果。
- `identity` 一项只报告文件**是否存在**，从不读取内容。

---

## 5. 设置数据位置（一次即可）

把数据放在你的工作目录，而不是包目录：

```powershell
# Windows PowerShell
$env:MARS_DB         = "D:\rds-data\mars.db"
$env:MARS_PRINCIPALS = "D:\rds-data\principals.json"
```

```bash
# Linux / macOS
export MARS_DB="$HOME/rds-data/mars.db"
export MARS_PRINCIPALS="$HOME/rds-data/principals.json"
```

CLI 按 **命令行参数 > 环境变量 > 仓库内默认值** 的顺序解析，三个变量分别对应 `--db`、`--principals`、`--routing`。不想用环境变量时，每条命令都显式传参即可，效果相同。

> 全局安装时若不设 `MARS_DB`，数据库会落到包目录内的 `mars/var/`——能用，但升级时容易被覆盖。

---

## 6. 初始化数据库与身份

```bash
rds init
```

输出包含数据库路径与统计信息（表、FTS5 索引、schema 版本）。

```bash
rds init-dev --principal dev-r0 --projects demo --roles R0,R4
```

输出：

```
已创建 <MARS_PRINCIPALS 指向的文件>
DEV_TOKEN=<48 位十六进制>
提示：token 仅在本机命令中使用，不写入仓库；如泄漏删除该文件并重建。
```

**立即复制 token**，然后：

```powershell
$env:MARS_TOKEN = "<DEV_TOKEN>"      # Windows
```
```bash
export MARS_TOKEN="<DEV_TOKEN>"      # Linux / macOS
```

也可以每次用 `--token <DEV_TOKEN>` 传入。两种方式等价；环境变量不会出现在进程参数里，更安全一些。

> `principals.json` 里只有 token 的 SHA-256，没有明文。仍请确认它不在版本库里。

---

## 7. 跑通最小闭环

```bash
# 1) 写入一条 proposed 记忆（proposed 不会进入正式上下文）
rds put --project demo --type L3 \
  --content "示例决策：本项目使用 Node 22 的内置 sqlite" \
  --source "docs/decision.md" --version v1

# 2) 查看待审队列（含 memory_id）
rds list --project demo --status proposed

# 3) 检索（只返回 approved；刚写入的查不到，这是设计行为）
rds search --project demo --query "sqlite"

# 4) 编译上下文包（受 budget 约束，产物含 manifest 与哈希）
rds compile --project demo --task T-001 --role R0 --budget 4000 --out ./packet.json
```

### 审批（可选，需要第二个身份）

同一身份写入后自行审批会被拒绝：

```
ERROR SELF_REVIEW_DENIED
```

这是**故意**的——写入与审批必须由不同主体完成。

**为什么需要手工加身份**：`rds init-dev` 每次都会**整个覆盖** `principals.json`，它没有「追加一个身份」的选项；`rds principal add` 尚未实现（见 §11）。所以第二个身份要手工追加。

**第一步：追加一个 R4 审批身份，并把新 token 存到单独文件**

Linux / macOS：

```bash
node -e '
const fs = require("fs"), c = require("crypto");
const p = process.env.MARS_PRINCIPALS;
const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
const t = c.randomBytes(24).toString("hex");
cfg.principals.push({
  token_sha256: c.createHash("sha256").update(t).digest("hex"),
  principal_id: "dev-r4",
  project_ids: ["demo"],
  roles: ["R4"],
  note: "local approver"
});
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
fs.writeFileSync(p + ".r4token", t);
console.log("R4 token 已写入 " + p + ".r4token");
'
```

Windows PowerShell（等价，避免引号转义问题）：

```powershell
node -e "const fs=require('fs'),c=require('crypto');const p=process.env.MARS_PRINCIPALS;const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const t=c.randomBytes(24).toString('hex');cfg.principals.push({token_sha256:c.createHash('sha256').update(t).digest('hex'),principal_id:'dev-r4',project_ids:['demo'],roles:['R4'],note:'local approver'});fs.writeFileSync(p,JSON.stringify(cfg,null,2));fs.writeFileSync(p+'.r4token',t);console.log('R4 token 已写入 '+p+'.r4token')"
```

> 脚本只追加一条记录，不会清空已有身份。但请先备份 `principals.json`——它不可从 token 反推重建。

**第二步：用 R4 身份审批，再用 R0 身份检索**

```bash
# 先拿到 memory_id（proposed 状态的那条）
rds list --project demo --status proposed

# 把 token 读进变量再传参。不要写成 --token (cat ...)：括号是子 shell，不会作为参数值
R4_TOKEN=$(cat "$MARS_PRINCIPALS.r4token")
rds review --token "$R4_TOKEN" --project demo --memory <上一步看到的 memory_id> --decision approved

# 换回 R0 身份检索，现在能查到
rds search --project demo --query "sqlite"
```

PowerShell：

```powershell
$r4 = Get-Content "$env:MARS_PRINCIPALS.r4token" -Raw
rds review --token $r4.Trim() --project demo --memory <memory_id> --decision approved
```

> `--decision` 取**状态名**：`approved` / `rejected` / `deprecated` / `superseded`。传动词 `approve` 会得到 `DECISION_INVALID`。
> 审批成功后，`proposed` 那条记录的 `status` 变为 `approved`，才会出现在 `rds search` 与 `rds compile` 的结果里。

---

## 8. 新项目接入

```powershell
# Windows（不传 -RdsRoot 时按脚本位置自动推导；也可用 $env:RDS_HOME 覆盖）
powershell -NoProfile -ExecutionPolicy Bypass -File .\core\scripts\new-project.ps1 `
  -Target ./my-app -Stack weapp
```

脚本创建骨架、写入 `project.yaml`，并**自动调用 `rds validate` 校验**；不通过直接报错。

手工方式：复制 `core/templates/project.yaml` 到项目根，替换三个占位符 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>`，然后：

```bash
rds validate --file ./my-app/project.yaml
```

校验范围（明确边界）：只校验**顶层契约**——必填项（`schema`/`name`/`root`/`stack`）、`schema` 必须为 `rds/project/v1`、`stack` 必须有对应 `stacks/<stack>/stack.yaml`、未知顶层键报错、`root` 不允许残留占位符。**不做**嵌套结构的语义校验（本包零第三方依赖，不引入 YAML 解析器）。

---

## 9. MCP 接入（可选）

MARS 提供 stdio MCP 服务，身份由**进程环境**绑定，调用方无法在工具参数里指定身份：

```json
{
  "mcpServers": {
    "mars": {
      "command": "node",
      "args": ["<安装目录>/mars/src/mcp-stdio.js"],
      "env": {
        "MARS_TOKEN_FILE": "D:/rds-data/token.txt",
        "MARS_ROLE": "R0",
        "MARS_DB": "D:/rds-data/mars.db",
        "MARS_PRINCIPALS": "D:/rds-data/principals.json"
      }
    }
  }
}
```

- `token.txt` 内容即 §6 的 `DEV_TOKEN`（单行，无前缀）。
- token 缺失或不可读时不会静默降级，而是让**每次工具调用**返回 `AUTH_DENIED`。
- 已实现 MCP 方法：`initialize`、`tools/list`、`tools/call`。
- 旧网关 `rds mcp --enable` 是另一套 JSON-RPC 实现（默认禁用）；新接入请用上面的 stdio 服务。

> 不同客户端的配置文件位置不同，本仓库不修改任何客户端的全局配置。

---

## 10. 升级与卸载

```bash
# 升级（本地包）
git pull && npm install -g .

# 卸载
npm uninstall -g rds-mother-system
```

数据不会被卸载：`$MARS_DB` 指向的库文件（默认 `<安装目录>/mars/var/mars.db`）需要手动删除。

> `rds upgrade` / `rds uninstall` **尚未实现**，本轮也不计划实现。当前升级 = 覆盖安装 + 自行备份数据库。不提供空壳命令：`rds upgrade` 会明确报「未知命令」。

备份（Windows 脚本，需 Git）：

```powershell
powershell -NoProfile -File .\tooling\backup.ps1 -Root <仓库根> -OutDir <备份目录>
```

---

## 11. 已知限制（诚实清单）

| 项 | 现状 | 影响 |
|---|---|---|
| 测试状态 | **173 项全通过，fail=0，skipped=0**（2026-11-09，Windows × Node 22.22.2，`b89cbb2`）。M3 起含分层检查与行为基线；M4 起含契约、脚本、数据库、版本、配置、诊断六类测试 | 测试已完全去环境化：不依赖作者会话、本机 DSH 或绝对路径 |
| Linux / Ubuntu | **由 CI 实测通过**（Node 22 / 24 各一格），最近一次 `run 42583509413` @ `b89cbb2` | 跨平台结论有 E1 证据，不再是静态推断 |
| macOS | **未实机验证** | 代码层无 Windows 专有依赖（`powershell.exe` 只出现在测试与脚本中），但未跑过即不承诺 |
| M3 适配层 | 5 个端口 + 8 个适配器 + 组合根已落地；`npm run layers` 可复现分层检查 | 配置是**启动快照**：改 `role-routing.json` 后需重启 MCP 才生效 |
| `rds ledger` | 只读动作：**不会创建数据库**；库已存在时才写审计 | 审计主体记为哨兵 `'local'`，不是已认证 principal |
| `ledger.json` 的 `sessions[].path` | 一律是**绝对路径**，用途是能直接打开原文件 | 产物不适合提交到版本库或直接分享。需要可移植输出时，`rds ledger --path-style` 尚未实现（方案见 `docs/checks/productization/M5-path-portability.md`） |
| 测试门禁 | `npm test` 走 `tooling/test-gate.mjs`，要求 `tests>0 && fail=0 && skipped=0` | 缺 fixture 或静默 skip 会让门禁变红，而不是显示绿灯 |
| `tests/self/run.ps1` | 通过。项目名检查已拆分：活跃资产 0 命中；历史记录多处仅告警 | 历史记录（`mars/docs`、`docs/checks`、`docs/history`）属证据，不改写 |
| `doctor` 的 `paths:docs` | 源码树触发 `warn`（数十个历史证据文件含作者机器路径）；发行包为 `ok` | 预期行为，不是安装缺陷。历史证据只归档标注，不替换正文 |
| 版本号 | `VERSION` = `package.json` = `serverInfo.version` = 0.1.0 | 规则见 [docs/versioning.md](versioning.md)；`SCHEMA_VERSION` 与账本格式版本是独立维度 |
| `rds principal add/revoke/list` | **未实现** | 第二个身份需按 §7 的脚本追加；这是有意不做空壳命令 |
| `rds upgrade` / `rds uninstall` / `rds backup` | **未实现** | 升级 = `git pull && npm install -g .`；备份用 `tooling/backup.ps1`（源码树）或手工拷库 |
| `render-role` 角色包渲染 | **未纳入仓库与发行包**。工作区存在未入库的 PowerShell 实现 | 干净克隆与发行包中都不存在，不要按文档去找 |
| 发布渠道 | 未发布到 npm registry | 用本地路径安装（§3） |
| `rds test` | 发行包不含 `mars/tests/`，只在源码仓库可用；`--raw` 查看未加工输出 | 想跑测试请用源码树 |
| CI | **全部绿**：Windows/Ubuntu × Node 22/24 四组 + structure self-check + g1，共 6 个 job。G1 六个夹具真实执行（耗时 27s，非跳过） | 详见 [docs/checks/productization/M4-ci-validation-report.md](checks/productization/M4-ci-validation-report.md) |
| Node 22.15 精确边界 | `engines` 声明 `>=22.15.0`；CI 跑 22.x / 24.x 的**最新补丁版**，未固定 22.15.0 实测 | 22.15 的依据是 zstd 回移植的文档事实 |

---

## 12. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERROR Node.js 版本过低` | Node < 22.15 | 用 nvm/fnm 切到 >= 22.15（低于此版本 `rds ledger` 不可用） |
| `Cannot find module 'node:sqlite'` | 绕过 `rds` 直接跑 `node mars/src/cli.js`，或在旧 Node 上运行 | 用 `rds <命令>`；或升级 Node |
| `principals 文件不存在` | 未设 `MARS_PRINCIPALS`，又没传 `--principals` | 按 §5 设置，或每次传 `--principals` |
| `AUTH_DENIED` / `TOKEN_MISSING_OR_TOO_SHORT` | token 缺失/错误；该身份无权访问该项目 | 检查 `MARS_TOKEN`、`principals.json` 里的 `project_ids` 与 `roles` |
| `SELF_REVIEW_DENIED` | 写入者与审批者是同一身份 | 按 §7 增加第二个身份 |
| `DECISION_INVALID` | `--decision` 传了动词 | 用 `approved` / `rejected` |
| `Unknown stack` | `stack` 无对应 `stacks/<name>/stack.yaml` | `ls stacks/` 查看可用栈 |
| `DB_OPEN_FAILED` | 库文件不是 SQLite、已损坏，或目录不可写 | `rds doctor` 确认；从备份恢复（`node mars/scripts/mars-db-backup.js --verify <file>`） |
| `DB_SCHEMA_NEWER` | 这个库被更新版本的 rds 写过（`schema_version` 高于当前代码） | 升级 rds；**不要**用旧版本打开 —— 旧代码不会改它，但也不会正确理解它 |
| `LEDGER_CONTRACT_INVALID` | `rds ledger` 输出不符合契约 | 说明解析器与契约不一致，属 bug；用 `--debug` 拿栈并报告 |
| `SOURCE_UNSUPPORTED` / `未知数据源` | `--source` 写错，或该来源未注册 | 省略 `--source` 让程序嗅探；报错信息里会列出已注册来源 |
| `HOST_REGISTRY_INVALID` / `HOST_REGISTRY_READONLY` | 目标注册表不是合法 JSON / 无写权限 | 先备份；修正格式或换可写位置（`--registry`） |
| `ASSET_MISSING` | 发行包缺少 `mars/contracts/*.json` 或 `role-routing.json` | 重装；或确认 `RDS_HOME` 指向的根目录完整 |
| `ROUTING_UNAVAILABLE` | routing 配置缺失、非法或 `roles` 为空 | 对照 `mars/config/role-routing.json` 修复；改完需重启 MCP |
| 想看栈 | 默认只输出一行 `ERROR <CODE> <说明>` | 加 `--debug`：`rds put ... --debug` |
| Windows 控制台中文乱码（管道场景） | 控制台代码页 936 与 UTF-8 输出不一致 | `chcp 65001`，或 `[Console]::OutputEncoding=[Text.Encoding]::UTF8` |
| `EPERM` 安装失败 | 全局目录权限 | 用 `npm i -g . --prefix <可写目录>` 或 `npm link` |

---

## 13. 安装完成判据

以下四条全部成立，才算"装好了"：

```bash
rds --version                              # 输出与 VERSION 文件一致
rds doctor                                 # status: ok（或仅 warn）
rds init                                   # 输出包含 stats，无异常
rds put ... && rds list --status proposed   # 能写、能查
```

`npm test` 的双平台绿灯是**质量门槛**，不是安装门槛。当前源码树为 173 项全通过（fail=0 / skipped=0），
门禁细节见 [docs/testing.md](testing.md)。
