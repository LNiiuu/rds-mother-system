# RDS 安装与部署

> 本文是**唯一权威安装文档**。README 只给定位与最短路径；凡涉及"怎么装、装完怎么验"，以本文为准。
> 适用基线：`VERSION` 0.1.0 = `package.json` 0.1.0。文档若与代码冲突，以 `rds doctor` 与测试的实际输出为准。

---

## 1. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **>= 22.5.0** | 数据库层使用内置模块 `node:sqlite`，该模块自 22.5 起提供。22.22.x 与 24.x 已实测通过 |
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

典型输出（从发行包安装、未初始化数据时）：

```
RDS doctor  root=<安装目录>

  node         ok    v22.22.2（要求 >=22.5.0）
  node:sqlite  ok    模块可用，FTS5 虚拟表可用
  git          ok    git version 2.55.0.windows.3
  writable     ok    <安装目录>
  version      ok    0.1.0（VERSION 与 package.json 一致）
  paths:code   ok    已扫描 41 个代码/配置文件，无本机绝对路径
  paths:docs   ok    历史文档无本机绝对路径
  identity     info  未创建
  database     info  未初始化

status: ok  (fail=0 warn=0 checks=9)
```

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

这是**故意**的——写入与审批必须由不同主体完成。要体验完整流程，追加一个审批身份：

```bash
node -e "const fs=require('fs'),c=require('crypto');const p=process.env.MARS_PRINCIPALS;const cfg=JSON.parse(fs.readFileSync(p,'utf8'));const t=c.randomBytes(24).toString('hex');cfg.principals.push({token_sha256:c.createHash('sha256').update(t).digest('hex'),principal_id:'dev-r4',project_ids:['demo'],roles:['R4'],note:'local approver'});fs.writeFileSync(p,JSON.stringify(cfg,null,2));require('fs').writeFileSync(p+'.r4token',t);console.log('R4 token 已写入 '+p+'.r4token')"
```

```bash
rds review --token (cat $MARS_PRINCIPALS.r4token) \
  --project demo --memory <memory_id> --decision approved

rds search --project demo --query "sqlite"     # 现在能查到
```

> `--decision` 取**状态名**：`approved` / `rejected`。传动词 `approve` 会得到 `DECISION_INVALID`。
> 目前没有 `rds principal add` 子命令，所以上一步是一段脚本；一等公民命令属于后续版本（路线图 M5）。

---

## 8. 新项目接入

```powershell
# Windows（不传 -RdsRoot 时按脚本位置自动推导；也可用 $env:RDS_HOME 覆盖）
powershell -NoProfile -ExecutionPolicy Bypass -File .\core\scripts\new-project.ps1 `
  -Target D:\Projects\my-app -Stack weapp
```

脚本创建骨架、写入 `project.yaml`，并**自动调用 `rds validate` 校验**；不通过直接报错。

手工方式：复制 `core/templates/project.yaml` 到项目根，替换三个占位符 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>`，然后：

```bash
rds validate --file D:\Projects\my-app\project.yaml
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

数据不会被卸载：`D:\rds-data\`（或你 `MARS_DB` 指定的位置）需要手动删除。

> `rds upgrade` / `rds uninstall` 尚未实现（路线图 M5）。当前升级 = 覆盖安装 + 自行备份数据库。

备份（Windows 脚本，需 Git）：

```powershell
powershell -NoProfile -File .\tooling\backup.ps1 -Root <仓库根> -OutDir <备份目录>
```

---

## 11. 已知限制（诚实清单）

| 项 | 现状 | 影响 |
|---|---|---|
| 测试状态 | **88 项全通过，fail=0，skipped=0**：Windows + Node 22.22.2、Windows + Node 24.22.2 各实跑一遍，结果一致 | 测试已完全去环境化：不再依赖作者会话、DSH.exe 或本机路径 |
| Linux / Ubuntu | **未运行**。本机无 Linux 环境（WSL 被安全策略拦截），CI 也未执行（见下） | 跨平台结论仍为 E3：静态核查 0 处大小写不匹配、0 处反斜杠拼路径 |
| 测试门禁 | `npm test` 走 `tooling/test-gate.mjs`，要求 `tests>0 && fail=0 && skipped=0` | 缺 fixture 或静默 skip 会让门禁变红，而不是显示绿灯 |
| `tests/self/run.ps1` | 有 1 项 FAIL：历史文档含具体项目名 | 属文档清理（M5）；活跃资产已清零。CI 中设为非阻塞并标注 known-red |
| 版本号 | `VERSION` = `package.json` = 0.1.0，但 MCP `serverInfo.version` 为 0.2.0 | 属 M5；未在本轮强行统一，因为尚未确认两者是否同一版本体系 |
| macOS | 未实机验证 | 不作承诺 |
| `rds principal` | 无此子命令 | 审批身份需按 §7 的脚本追加 |
| 发布渠道 | 未发布到 npm | 用本地路径安装 |
| `rds test` | 发行包不含 `mars/tests/`，只在源码仓库可用；`--raw` 查看未加工输出 | 想跑测试请用源码树 |
| CI | **工作流已编写但从未执行**。GitHub Actions 需要 push，而本机出口策略禁止连接 `github.com:443`（`CONNECT tunnel failed, response 502`），推送被阻 | `ubuntu-latest` / Node 24 的远程结果均不存在；所有"CI 通过"的表述都不成立 |

---

## 12. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERROR Node.js 版本过低` | Node < 22.5 | 用 nvm/fnm 切到 >= 22.5 |
| `Cannot find module 'node:sqlite'` | 绕过 `rds` 直接跑 `node mars/src/cli.js`，或在旧 Node 上运行 | 用 `rds <命令>`；或升级 Node |
| `principals 文件不存在` | 未设 `MARS_PRINCIPALS`，又没传 `--principals` | 按 §5 设置，或每次传 `--principals` |
| `AUTH_DENIED` / `TOKEN_MISSING_OR_TOO_SHORT` | token 缺失/错误；该身份无权访问该项目 | 检查 `MARS_TOKEN`、`principals.json` 里的 `project_ids` 与 `roles` |
| `SELF_REVIEW_DENIED` | 写入者与审批者是同一身份 | 按 §7 增加第二个身份 |
| `DECISION_INVALID` | `--decision` 传了动词 | 用 `approved` / `rejected` |
| `Unknown stack` | `stack` 无对应 `stacks/<name>/stack.yaml` | `ls stacks/` 查看可用栈 |
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

`npm test` 的双平台绿灯是**质量门槛**，不是安装门槛。当前源码树为 88 项全通过（fail=0 / skipped=0），
门禁细节见 [docs/testing.md](testing.md)。
