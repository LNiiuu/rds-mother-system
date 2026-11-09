# 维护者指南

**性质**：`CURRENT`。给「接手这个仓库、要让它继续跑下去」的人看。
**读者假设**：你已经照 [quickstart.md](quickstart.md) 跑通过一次，知道 `put` / `review` / `search` / `compile` 是什么。

本文回答五件事：出错了怎么定位、数据怎么备份、新版本怎么发、测试与 CI 怎么跑、什么时候该停手。

---

## 1. 第一反应：三条命令

不要先读代码。按顺序跑：

```bash
rds doctor                 # 环境与安装完整性，11 项
rds doctor --json          # 同一份结果的机器可读版，便于贴进 issue
rds <出错的那条命令> --debug   # 出错时附上调用栈，而不是只有一行错误码
```

`rds doctor` 的退出码：有 `fail` 为 1，只有 `warn` 为 0。可以直接当门禁用。

**先分清是哪一类问题**：

| 现象 | 类别 | 看第几节 |
|---|---|---|
| `rds` 命令本身跑不起来 / 版本报错 | 环境 | §2.1 |
| 报 `ERROR <CODE> <说明>` | 运行期 | §3 错误码表 |
| 数据库相关（打不开、结构版本、损坏） | 数据 | §4 |
| 测试红了 | 质量 | §6 |
| 已发布的包有问题 | 发布 | §7 |

---

## 2. 按症状查

### 2.1 环境与安装

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERROR Node.js 版本过低：当前 vX，RDS 需要 >= 22.15.0` | Node 太旧 | 用 nvm / fnm 切到 >= 22.15。**不要**只升到 22.5：`rds ledger` 需要 22.15 才有的 `zlib.zstd` |
| `Cannot find module 'node:sqlite'` | 绕过 `rds` 直接跑 `mars/src/cli.js`，或在旧 Node 上跑 | 用 `rds <命令>`；或升级 Node |
| `rds: command not found` | 没全局安装，或 prefix 不在 PATH | `npm install -g .`；或直接用 `node bin/rds.mjs` |
| `EPERM` 安装失败 | 全局目录无写权限 | `npm i -g . --prefix <可写目录>` 或 `npm link` |
| `rds doctor` 报 `paths:assets fail` | 有活跃文档含本机绝对路径 | 按输出的 `file:line` 改掉。这一项是 `fail`，因为那些文档会进发行包或作为仓库门面 |
| `rds doctor` 报 `paths:docs warn` | 历史证据文档含作者机器路径 | **预期行为**，不用修。那些是带日期的记录，改写等于篡改 |
| `rds doctor` 报 `database fail` | 库损坏 / 结构版本更高 / 不是 SQLite | 见 §4.3 |

### 2.2 命令行为

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERROR 未知命令: xxx` | 拼写错误，或该命令未实现 | `rds --help` 看全部命令；未实现的命令见 [install.md](install.md) §11 |
| `rds <cmd> --help` 没有任何反应或报错 | 不该发生（M5-B3 起 22 个命令都有帮助） | 若复现，说明帮助分支被绕过：检查 `bin/rds.mjs` 的内建命令顺序 |
| `search` 返回 `[]`，但 `list` 能看到记录 | 记录还是 `proposed` | **设计行为**。用另一个身份 `review --decision approved` |
| `rds review` 报 `SELF_REVIEW_DENIED` | 写入者与审批者是同一 principal | 换身份，见 [install.md](install.md) §7 |
| `compile` 的 `tokens_estimated` 超过 `token_budget` | 受保护小节不裁剪 | 看 `budget.over_budget` 与 `budget.truncated`；调大 `--budget` 或减少证据引用 |
| Windows 控制台中文乱码 | 代码页 936 与 UTF-8 不一致 | `chcp 65001` |

### 2.3 配置

| 现象 | 原因 | 处理 |
|---|---|---|
| `ROUTING_UNAVAILABLE` | `role-routing.json` 缺失、非法，或 `roles` 为空 | 对照 `mars/config/role-routing.json` 修；**改完要重启 MCP** |
| `ASSET_MISSING` | 发行包缺 `mars/contracts/*.json` | 重装；或检查 `RDS_HOME` 指向的根是否完整 |
| `ASSET_HASH_MISMATCH` | 契约文件被改过 | 契约是随包分发的不可变资产。改了就要同步 `approved-additions.contractChanges` |
| `PRINCIPALS_MISSING` | 身份文件不存在 | `rds init-dev` 生成，或按 [install.md](install.md) §7 手工追加 |
| 改了 `role-routing.json` 但没生效 | 配置是**启动快照** | 重启进程。M3 起刻意如此：运行期不再重读配置，避免半途换规则 |

---

## 3. 错误码表

**72 个对外码**，唯一真相是 `mars/src/errors.js` 的 `PUBLIC_CODES`。新增错误码必须同时加测试，并登记到 `approved-additions.errorCodes`。

输出格式固定为一行：`ERROR <CODE> <说明>`。`<说明>` 里不会出现栈、SQL、文件路径或内部 detail——要看栈加 `--debug`。

### 3.1 资产与配置

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `ASSET_MISSING` | 契约或配置文件不存在 | 重装，或修 `RDS_HOME` |
| `ASSET_INVALID` | 契约文件存在但不是合法 JSON / 缺必需结构 | 重装；不要手改契约 |
| `ASSET_HASH_MISMATCH` | 契约内容与登记的哈希不一致 | 确认是否有人改了契约；改了就登记变更 |
| `ROUTING_UNAVAILABLE` | 路由配置不可读或缺 `roles` | 修 `role-routing.json`，重启 |
| `PRINCIPALS_MISSING` | 身份文件不存在 | `rds init-dev` |

### 3.2 身份与授权

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `TOKEN_MISSING` | 没提供凭证 | 设 `MARS_TOKEN` 或传 `--token` |
| `AUTH_DENIED` | token 无效 / 已吊销 | 检查 `principals.json` 里的 `token_sha256` |
| `AUTHZ_DENIED` | 通过认证但无权执行该动作 | 看该 principal 的 `roles` 与 `project_ids` |
| `ROLE_REQUIRED` | 该动作需要显式角色 | 传 `--role` |
| `ROLE_DENIED` | 该角色被禁止 | 换角色 |
| `ROLE_TYPE_DENIED` | 角色类型不允许该动作（如 R2 不能审批） | 用 R0/R4 |
| `ROLE_SCOPE_REQUIRED` | 记忆的 `role_scope` 限制了可见角色 | 换匹配的角色 |
| `ROLE_NOT_CONFIGURED` | 该角色不在 `role-routing.json` | 补配置，重启 |
| `PROJECT_REQUIRED` / `PROJECT_ID_REQUIRED` | 缺 `--project` | 补参数 |
| `PROJECT_DENIED` | 该 principal 无权访问该项目 | 检查 `project_ids` |
| `PROJECT_UNKNOWN` | 项目未注册 | `rds project register` |
| `PROJECT_OWNER_DENIED` | 只有项目 owner 能做该动作 | 换 owner 身份 |
| `REVIEW_DENIED` | 该身份不能审批 | 用 R0/R4 |
| `SELF_REVIEW_DENIED` | 自审 | 换身份 |
| `APPROVER_REQUIRED` | 缺少审批者信息 | 传 `--role` 或 `--by` |
| `EVIDENCE_DENIED` | 证据引用不在允许根内 | 检查 `MARS_ALLOWED_ROOTS` |
| `SOURCE_REF_DENIED` | `--source` 指向不允许的路径 | 同上 |

### 3.3 记忆与审批

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `MEMORY_NOT_FOUND` | memory_id 不存在 | 用 `rds list` 拿正确 ID |
| `MEMORY_DENIED` | 无权读该条 | 检查项目与角色 |
| `MEMORY_SCHEMA_INVALID` | 写入内容不符合 `memory.schema.json` | 看 `--debug` 的字段路径 |
| `MEMORY_TYPE_INVALID` | `--type` 不是 L1–L4 | 用 `L1` / `L2` / `L3` / `L4` |
| `CONTENT_REQUIRED` | 缺 `--content` | 补参数 |
| `SOURCE_VERSION_REQUIRED` | 缺 `--version` | 补参数 |
| `DECISION_INVALID` | `--decision` 传了动词 | 用 `approved`，不是 `approve` |
| `INVALID_TRANSITION` | 状态机不允许该跳转（如 approved → proposed） | 看 [mars/docs/governance.md](../mars/docs/governance.md) 的状态图 |
| `STATE_UNCHANGED` | 目标状态与当前相同 | 无需操作 |
| `NOT_APPROVED` | 该操作要求 approved | 先审批 |
| `EXPIRES_AT_INVALID` | `--expires` 不是合法时间 | 用 ISO 8601 |

### 3.4 上下文包与会话账本

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `PACKET_SCHEMA_INVALID` | 编译产物不符合 `context-packet.schema.json` | 属 bug，报 issue |
| `MANIFEST_SCHEMA_INVALID` | 同上，manifest 部分 | 同上 |
| `FRAGMENT_NOT_FOUND` | 片段 ID 不存在 | 用 manifest 里的 ID |
| `SESSION_CORRUPT` | 会话文件损坏 | 检查文件完整性；确认是完整的 `.jsonl` / `.zstd` |
| `SESSION_INVALID_AT_<n>` | 第 n 行不合法 | 打开会话文件看该行 |
| `SESSIONS_REQUIRED` | 缺 `--session` | 补参数 |
| `LEDGER_REQUIRED` | 缺账本输入 | 同上 |
| `SOURCE_UNSUPPORTED` | `--source` 写错，或该来源未注册 | 省略 `--source` 让程序嗅探；报错里会列已注册来源 |
| `SOURCE_AMBIGUOUS` | 内容能被多个来源解析 | 显式传 `--source` |
| `ZSTD_UNSUPPORTED` | 当前 Node 缺 `zlib.zstd` | 升到 Node >= 22.15 |
| `DSH_SESSION_CORRUPT` | DSH v4 会话结构不符 | 确认是 v4 格式；不要手工拼接 |

### 3.5 数据库

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `DB_OPEN_FAILED` | 文件不是 SQLite / 损坏 / 目录不可写 | `rds doctor` 确认；从备份恢复（§4.3） |
| `DB_SCHEMA_NEWER` | 库被更新版本的 rds 写过 | **升级 rds**。不要用旧版本打开：它不会改库，但也不理解它 |
| `DB_AND_PRINCIPALS_REQUIRED` | 某个嵌入场景要求同时给出库与身份 | 补 `--db` 与 `--principals` |

### 3.6 宿主注册表

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `HOST_REGISTRY_NOT_FOUND` | 注册表文件不存在 | 确认宿主是否已初始化 |
| `HOST_REGISTRY_INVALID` | 不是合法 JSON | 先备份，再修格式 |
| `HOST_REGISTRY_READONLY` | 无写权限 | 换可写位置（`--registry`） |
| `HOST_WRITE_REFUSED` | 写入被策略拒绝 | 看具体原因；宿主的未知顶层字段会被保留，不会拒绝 |

### 3.7 共享与编排

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `SHARE_NOT_FOUND` | 共享单不存在 | 用 `rds share list` 查 |
| `SHARE_CREATE_DENIED` / `SHARE_APPROVE_DENIED` / `SHARE_REVOKE_DENIED` | 权限不足 | 创建需源项目权限，审批需目标项目权限 |
| `SHARE_TYPE_INVALID` | `--types` 里有非法类型 | 用 L1–L4 |
| `SHARE_ROLES_REQUIRED` | 缺 `--roles` | 补参数 |
| `SHARE_MEMORY_REQUIRED` / `SHARE_MEMORY_NOT_FOUND` | 缺 memory_id / ID 不存在 | 补参数 / 换 ID |
| `SHARE_MEMORY_NOT_APPROVED` | 只能共享 approved | 先审批 |
| `SHARE_MEMORY_LIMIT` | 单次共享条数超限 | 分批 |
| `SELF_SHARE_DENIED` | 不能共享给自己的项目 | 换目标项目 |
| `TARGET_PROJECT_UNKNOWN` | 目标项目未注册 | `rds project register` |
| `RUN_NOT_FOUND` | 编排运行 ID 不存在 | 用 `orchestrate plan/start` 的输出 |
| `INVALID_RUN_STATE` | 运行状态不允许该动作 | 看 `orchestrate status` |
| `AGENT_UNAVAILABLE` | 需要的 Agent 不可用 | 看 `plan` 输出里的最小 Agent 集 |
| `AGENT_RISK_MISMATCH` | 风险等级与 Agent 能力不匹配 | 高风险任务必须人工 `approve` |

### 3.8 基础设施

| 码 | 含义 | 你怎么修 |
|---|---|---|
| `RATE_LIMITED` | 触发限流 | 等窗口过去；限流按进程 + 持久窗口 |
| `BAD_REQUEST` | 请求形状不合法 | 看 `--debug` |
| `METHOD_NOT_FOUND` | MCP 方法不存在 | 用 `initialize` / `tools/list` / `tools/call` |
| `INTERNAL_ERROR` | 未分类异常 | 加 `--debug` 拿栈，报 issue |

---

## 4. 数据：备份与恢复

MARS 的数据只有两类：**SQLite 库**与**身份文件**。两者性质不同。

| 数据 | 位置（默认） | 能否重建 | 备份策略 |
|---|---|---|---|
| 数据库 | `<安装根>/mars/var/mars.db`（+ `-wal` / `-shm`） | **不能**。approve 过的记忆、审计记录都在里面 | 必须备份 |
| 身份文件 | `<安装根>/mars/config/principals.json` | **不能**。只存 token 哈希，明文 token 丢了就没了 | 必须备份 |
| 配置 | `mars/config/role-routing.json` | 能（在版本库里） | Git 即可 |
| 产物 | `ledger.json` / `packet.json` | 能（重跑命令） | 不必 |

### 4.1 数据库快照（推荐）

```bash
node mars/scripts/mars-db-backup.js
# → mars/var/backups/mars-<时间戳>.db
```

它用 `VACUUM INTO`，所以**在 WAL 模式下也是一致快照**——直接 `cp` 一个正在写的库可能拿到半个事务。

指定路径与校验：

```bash
node mars/scripts/mars-db-backup.js --db ./mars-data/mars.db --out-dir ./backups
node mars/scripts/mars-db-backup.js --verify ./backups/mars-20261109-1200.db
```

`--verify` 做两件事：`PRAGMA integrity_check` 与各表行数。

> 该脚本**拒绝未知参数**（M4-B2 修复）。此前 `--out X` 会被静默忽略并写进默认目录，调用方以为备份到了 X。

### 4.2 整个仓库打包（含身份与配置）

```powershell
powershell -NoProfile -File ./tooling/backup.ps1 -OutDir ./backups
# → ./backups/rds-<时间戳>-v<版本>.zip + .sha256
```

默认输出到仓库的**兄弟目录** `<仓库名>-backups`。脚本会打印 zip 路径、SHA-256 与字节数。

恢复（**目标目录必须不存在**）：

```powershell
powershell -NoProfile -File ./tooling/restore.ps1 -Zip ./backups/rds-xxx.zip -Target ./restored
```

它会先校验 `.sha256`，再解压，然后报告文件数与总字节数。

### 4.3 库损坏了怎么办

```bash
rds doctor                      # 会报 DB_OPEN_FAILED 或 integrity 未通过
node mars/scripts/mars-db-backup.js --verify <最近的备份>
# 校验通过后：
cp <最近的备份> <MARS_DB 指向的路径>
rm -f <MARS_DB>-wal <MARS_DB>-shm   # 旧的 WAL 必须一起删，否则会和新库不匹配
rds doctor
```

**不要做的事**：

- 不要用旧版本 `rds` 打开 `DB_SCHEMA_NEWER` 的库。它不会写坏，但会把结构读错。
- 不要在库损坏时继续 `put`。审计写入失败会报错，但已写入的记忆可能不完整。
- 不要只备份 `.db` 而漏掉 `-wal`。要么用 `mars-db-backup.js`（自动处理），要么把三个文件一起拷。

### 4.4 身份文件

`principals.json` 里只有 `sha256(token)`。**明文 token 只在你创建时显示一次**，之后无法从文件反推。

所以：

1. 生成后立刻把 token 存进密码管理器。
2. `principals.json` 本身要备份（它决定了「谁是谁」）。
3. 不要把 `principals.json` 提交到版本库——`.gitignore` 已经排除 `mars/config/principals.json`。

丢了 token 但文件还在：手工追加一个新 principal（[install.md](install.md) §7 的脚本），旧的留着不影响。
丢了文件：所有 token 失效，需要重新生成并分发。

---

## 5. 版本与兼容

三个版本号是独立维度，详见 [versioning.md](versioning.md)。维护者要记住的只有：

| 版本 | 改它意味着 | 谁能改 |
|---|---|---|
| 产品版本（`package.json` + `VERSION`） | 一次发布 | 发布时同时改两个文件，`rds doctor` 会校验一致 |
| `SCHEMA_VERSION`（`mars/src/db/schema.js`） | 表结构变了，旧库要迁移 | 只升不降；迁移必须增量且幂等 |
| 账本格式版本（`ledger.schema.json` 的 `version`） | 输出形状不兼容变化 | 只在破坏兼容时升 |

**兼容性承诺**：0.x 期间可能破坏兼容；1.0 才承诺 SemVer。
**Node 承诺**：`>=22.15.0`。CI 跑 22.x / 24.x 的最新补丁版，没有固定 22.15.0 实测。

---

## 6. 测试与 CI

### 6.1 五个门禁

```bash
npm test                  # Required 测试门禁：tests>0 && fail=0 && skipped=0
npm run layers            # 分层：端口零依赖 / 域不碰宿主 / 无循环依赖
npm run baseline          # 7 个对外面的行为基线
npm run config            # JSON 严格解析 + YAML lint
npm run test:gate-selfcheck  # 门禁自身的反向验证（注入 fail/skip/空集必须变红）
```

一次跑完：

```bash
npm run verify            # doctor && config && layers && test
```

外加：

```bash
npm run test:raw          # 看 node --test 原始输出
npm run test:external     # External 测试（需要 RDS_IT_DSH_SESSION）
npm run smoke             # 发行包端到端：打包→检查→安装→doctor→写入→审批→检索→编译
```

### 6.2 门禁为什么这么严

`npm test` 不看 `node --test` 的退出码，只看四个计数：

```
tests > 0 && fail === 0 && skipped === 0 && pass+fail+skipped+todo+cancelled === tests
```

原因：`node --test` 在「全部 skip」和「一个用例都没匹配到」时都返回 0。M0 审计时在干净机器上出现过 4 个 skip + fail 0，看上去全绿。

细节与 fixture 约定见 [testing.md](testing.md)。

### 6.3 CI 六个 job

`.github/workflows/ci.yml`：

| job | 平台 | 内容 |
|---|---|---|
| `required` × 4 | Windows / Ubuntu × Node 22 / 24 | doctor → config → layers → test → gate-selfcheck → smoke |
| `structure-selfcheck` | Windows | `tests/self/run.ps1`（母体系结构自检） |
| `g1` | Windows | G1 六个夹具真实执行（`tests/git-review/run.ps1`） |

**判断 CI 是否真跑过**：看 `g1` job 的耗时。跳过会在 1 秒内结束；真跑约 27 秒。

### 6.4 本地跑 G1 与结构自检

两者都是 Windows 脚本，且都需要 `git` 在 PATH 里：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/git-review/run.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/self/run.ps1
```

**`git` 不在 PATH 时**（常见于只在 Git Bash 里装过 git 的机器）会报「git 未找到」。两种解法：

```powershell
$env:RDS_GIT = "C:\Program Files\Git\cmd\git.exe"    # 只对当前会话生效
```

或在 `tooling/toolchain.local.json` 里写 `{ "git": "<git 路径>" }`。后者是本地文件，已被 `.gitignore` 排除，不会进仓库。

G1 的六个夹具里，F2–F4 的预期裁决就是 `FAIL`、F5 是 `BLOCKED`、F6 是 `PARTIAL`——**夹具 PASS 的意思是「工具给出了预期裁决」，不是「一切正常」**。

### 6.4 本地复现 CI

```bash
npm run verify && bash tooling/ci-smoke.sh
```

`ci-smoke.sh` 在临时前缀里装包，不污染你的全局环境。

### 6.5 测试数只许升不许降

`docs/architecture/m3/acceptance-criteria.md` 里定的下限是 88；当前 189。新增功能必须带测试，不允许为了「让门禁变绿」删测试。

---

## 7. 发布流程

按顺序做，每步都要过。

1. **改版本**：同时改 `package.json.version` 与 `VERSION`，两者必须一致（`rds doctor` 会校验）。
2. **写 CHANGELOG**：在 `Unreleased` 段落里分「新增 / 变更（对外可见）/ 删除 / 不变 / 测试」。对外可见的每一条都要说清影响。
3. **过门禁**：`npm run verify`。
4. **过基线**：`npm run baseline`。任何漂移都要么改回去，要么在 `approved-additions.json` 里登记批次与理由。
5. **过发行包**：`bash tooling/ci-smoke.sh`。
6. **跑结构自检**（Windows）：`powershell -NoProfile -File tests/self/run.ps1`。
7. **推 CI**：等六个 job 全绿。不要用「本地过了」代替。
8. **打 tag**：`git tag -a mX-bY -m "..."`，tag 消息写清这一批做了什么。
9. **回填证据**：把 CI run id 与结论写进 `docs/checks/productization/`。

### 7.1 什么算「对外可见」

改了这些就必须在 CHANGELOG 的「变更（对外可见）」里写，并且过基线：

- CLI 子命令、参数名、参数语义
- JSON 输出的键名与嵌套形状
- 退出码语义（2 用法 / 3 认证 / 4 运行期 / 5 策略拒绝）
- 错误码拼写
- MCP 工具名与必填字段
- 发行包内容（新增/删除文件）
- 数据契约

### 7.2 基线的正确用法

`docs/architecture/m3/baseline/` 下有 7 个快照。**不要靠重新采集基线来「通过」检查**——那等于把一次对外变更静默抹掉。

正确做法：

| 变的是什么 | 登记到 `approved-additions.json` 的哪个字段 |
|---|---|
| 新增错误码 | `errorCodes` |
| 新增包内文件 | `packFiles` + `reasons` |
| 契约内容变更 | `contractChanges`（写变更**后**的 sha256） |
| 顶层帮助文本变更 | `helpText`（写变更**后**的 sha256 + batch + reason） |

---

## 8. 回滚

### 8.1 代码回滚

每一批都是独立提交 + 独立 tag，可以单独 revert：

```bash
git revert --no-commit <commit>
npm run verify
git commit -m "revert: <原因>"
```

M4 做过完整演练：B0–B3 逐批 revert 前后全绿；B4/B5 revert 时暴露两个真缺陷（测试依赖未跟踪的 `principals.json`、MCP 缺身份时直接退出），已在 B6 修复。报告见 [docs/checks/productization/M4-rollback-report.md](checks/productization/M4-rollback-report.md)。

### 8.2 数据回滚

数据库只能从备份恢复（§4.3）。**没有**「撤销上一次 put」的命令——这是设计：记忆的每一次状态变化都写审计，历史不可改写。

### 8.3 什么时候不要回滚

- 已经有下游在用新输出格式
- 回滚会丢掉已批准的记忆（数据层不随代码回滚）
- 问题只在一个平台（先定位，别整批退）

---

## 9. 什么时候该停手

以下情况先停下，把现象与已做的操作写清楚，再决定：

| 情况 | 为什么 |
|---|---|
| `DB_SCHEMA_NEWER` | 用旧代码继续操作会让结构读错。唯一正解是升级 rds |
| 库完整性检查失败 | 继续写会扩大损坏范围 |
| `ASSET_HASH_MISMATCH` | 契约被改过。不确认来源就重装，可能掩盖一次误改 |
| 基线漂移但你没打算改 | 说明有人在别处改了对外行为 |
| CI 红了但本地绿 | 平台差异。本地绿不算数 |
| 需要改契约 / Schema / MCP 工具面 | 这是破坏性变更，要走评审 |

---

## 10. 相关文档

- 安装与最小闭环：[install.md](install.md)、[quickstart.md](quickstart.md)
- 改代码前看分层与影响面：[PROJECT-MAP.md](PROJECT-MAP.md)
- 测试分类与门禁判据：[testing.md](testing.md)
- 三个版本号：[versioning.md](versioning.md)
- 全部验收证据：[checks/README.md](checks/README.md)
- 文档总入口：[README.md](README.md)
