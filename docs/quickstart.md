# 快速开始（10 分钟）

**目标**：从零到「一条记忆被批准为事实，并被编译进上下文包」。

跑完你会得到一条完整链路：

```
写入 → proposed → 换身份审批 → approved → 检索得到 → 编译成上下文包
```

每一节都给出**预期输出**。如果你的输出不一样，先看 [§9 卡住了](#9-卡住了)，不要跳步。

---

## 0. 检查前提

```bash
node -v
```

必须是 **v22.15.0 或更高**。低于此版本 `rds ledger` 不可用（缺 `zlib.zstd`）。

不确定能不能用？装完跑 `rds doctor`，它会逐项告诉你。

---

## 1. 安装

```bash
git clone https://github.com/LNiiuu/rds-mother-system.git
cd rds-mother-system
npm install -g .
```

预期：

```bash
rds --version
# 0.1.0
```

> 不想全局安装：把下面的 `rds` 全部换成 `node bin/rds.mjs`，效果相同。
> 本包尚未发布到 npm registry，`npm i -g rds-mother-system` 会失败。

---

## 2. 把数据放到仓库外

默认数据库在包目录内的 `mars/var/`，升级时容易被覆盖。指定到自己的工作目录：

```bash
# Linux / macOS
mkdir -p ~/rds-data
export MARS_DB="$HOME/rds-data/mars.db"
export MARS_PRINCIPALS="$HOME/rds-data/principals.json"
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$HOME\rds-data" | Out-Null
$env:MARS_DB         = "$HOME\rds-data\mars.db"
$env:MARS_PRINCIPALS = "$HOME\rds-data\principals.json"
```

> 不设也可以，只是数据会落在包目录里。三个变量的优先级见 [install.md](install.md) §5。

---

## 3. 建库

```bash
rds init
```

预期（数字全为 0）：

```json
{
  "db": "/home/you/rds-data/mars.db",
  "stats": {
    "memories": 0, "approved": 0, "proposed": 0, "rejected": 0,
    "deprecated": 0, "superseded": 0, "expired": 0,
    "fragments": 0, "manifests": 0, "aliases": 0, "audit": 0
  }
}
```

---

## 4. 建一个开发身份

```bash
rds init-dev --principal dev-r0 --projects demo --roles R0
```

预期：

```
已创建 /home/you/rds-data/principals.json
DEV_TOKEN=8f3c...（48 位十六进制）
提示：token 仅在本机命令中使用，不写入仓库；如泄漏删除该文件并重建。
```

**把 `DEV_TOKEN=` 后面那一串复制下来**，设进环境变量：

```bash
export MARS_TOKEN="粘贴刚才那串"
```

```powershell
$env:MARS_TOKEN = "粘贴刚才那串"
```

> `principals.json` 里只存 token 的 SHA-256，不存明文。丢了只能重建。
> 重复执行 `rds init-dev` 会被拒绝（`IDENTITY_EXISTS`）；要加身份用 `--add`，要重建用 `--replace`。

---

## 5. 写入第一条记忆

```bash
rds put --project demo --type L3 \
  --content "本项目使用 Node 22 的内置 sqlite，不引入第三方数据库驱动" \
  --source "docs/decision.md" --version v1
```

预期：

```json
{"memory_id":"mem_0a49a3ab62d8","status":"proposed","duplicate":false}
```

记下这个 `memory_id`，后面要用。

`--type` 的含义：`L1` 事实 / `L2` 约定 / `L3` 决策 / `L4` 经验。选哪个不影响流程，只影响检索时的分类过滤。

---

## 6. 它现在查不到 —— 这是设计

```bash
rds search --project demo --query "sqlite"
```

预期：

```json
[]
```

**不是 bug**。`put` 写入的是 `proposed`（提议），只有 `approved` 才会进入正式上下文。这条规则是整个系统的核心：**写入不等于事实**。

想确认它确实写进去了：

```bash
rds list --project demo --status proposed
```

预期：一个 JSON 数组，里面有你刚写的那条，`"status": "proposed"`。

---

## 7. 换一个身份审批

自己批自己会被拒绝（`SELF_REVIEW_DENIED`）。所以需要一个**不同的身份**。

`rds init-dev --add` 可以追加一个身份，同时保留已有身份与 token：

```bash
rds init-dev --principal dev-r4 --projects demo --roles R4 --add | tee /tmp/r4.out
R4_TOKEN=$(grep '^DEV_TOKEN=' /tmp/r4.out | cut -d= -f2)
printf '%s' "$R4_TOKEN" > "$MARS_PRINCIPALS.r4token"
```

> 不加 `--add` 时，如果文件里已有身份，命令会直接拒绝（`IDENTITY_EXISTS`），不会改动文件。
> 只有 `--replace` 才会重建并让旧 token 失效。

预期：`$MARS_PRINCIPALS.r4token` 里是 48 位十六进制 token；原 R0 token 仍然有效。

然后审批：

```bash
R4_TOKEN=$(cat "$MARS_PRINCIPALS.r4token")
rds review --token "$R4_TOKEN" --project demo \
  --memory mem_0a49a3ab62d8 --decision approved
```

```powershell
# Windows
$r4 = (Get-Content "$env:MARS_PRINCIPALS.r4token" -Raw).Trim()
rds review --token $r4 --project demo --memory mem_0a49a3ab62d8 --decision approved
```

预期：一条 JSON，其中 `"status": "approved"`，且 `provenance.approved_by` 为 `"dev-r4"`。

> `--decision` 要传**状态名**：`approved` / `rejected` / `deprecated` / `superseded`。传 `approve` 会得到 `DECISION_INVALID`。

---

## 8. 现在能查到了

```bash
rds search --project demo --query "sqlite"
```

预期：数组里出现你那条记忆，`"status": "approved"`。

这就是「什么被批准为事实」的完整闭环。

### 再往前一步：编译上下文包

```bash
rds compile --project demo --task T-001 --role R0 --budget 4000 --out ./packet.json
```

预期：

```
已写出 /home/you/packet.json tokens=66/4000
```

打开 `packet.json`，结构是：

```
{ packet, manifest, budget }
```

- `packet.sections[]` —— 按角色路由组织的四个小节：任务要求、已批准决策、禁止事项、证据引用
- `packet.tokens_estimated` / `token_budget` —— 估算用量与上限
- `manifest.entries[]` —— 每个片段的来源与哈希，用于复现与去重
- `budget.protected_kept[]` —— 预算不足时哪些小节受保护不会被裁

可以看到「已批准决策」小节里就是你刚才那条记忆。

---

## 9. 卡住了

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERROR Node.js 版本过低` | Node < 22.15 | 用 nvm / fnm 切到 >= 22.15 |
| `principals 文件不存在` | 没设 `MARS_PRINCIPALS`，或 `rds init-dev` 没跑 | 回到 §2、§4 |
| `ERROR 认证失败：TOKEN_MISSING` | `MARS_TOKEN` 没设或没 export | 重开终端后要重新 export |
| `ERROR 认证失败：AUTH_DENIED` | token 对，但该身份的 `project_ids` 不含 `demo` | 看 `principals.json` 里的 `project_ids` |
| `ERROR SELF_REVIEW_DENIED` | 用写入的身份去审批 | 按 §7 换 R4 身份 |
| `ERROR DECISION_INVALID` | `--decision` 传了动词 | 传 `approved`，不是 `approve` |
| `search` 返回 `[]` | 记忆还是 `proposed` | 按 §7 审批，这是设计行为 |
| Windows 中文乱码 | 控制台代码页 936 | `chcp 65001` |

完整错误码表见 [install.md](install.md) §12。

---

## 10. 你刚才做了什么

| 步骤 | 命令 | 产生/改变了什么 |
|---|---|---|
| 建库 | `rds init` | `mars.db`，11 张表 + FTS5 索引 |
| 建身份 | `rds init-dev` | `principals.json`（只含 token 哈希） |
| 写入 | `rds put` | 一条 `status=proposed` 的记忆 + 一条 audit |
| 审批 | `rds review` | `status → approved`，记录 `approved_by` |
| 检索 | `rds search` | 只返回 `approved` |
| 编译 | `rds compile` | packet + manifest + budget，带哈希 |

**没有发生的事**：没有联网、没有调用任何 AI API、没有写任何第三方依赖。

---

## 11. 下一步

| 想做什么 | 去哪 |
|---|---|
| 完整安装选项、MCP 接入、升级卸载 | [install.md](install.md) |
| 理解为什么这样分层、改哪里会坏什么 | [PROJECT-MAP.md](PROJECT-MAP.md) |
| 跑测试、看门禁判据 | [testing.md](testing.md) |
| 把 `core/` 里的角色与流程用到自己的项目 | [install.md](install.md) §8 + [../core/README.md](../core/README.md) |
| 全部文档索引 | [README.md](README.md) |
