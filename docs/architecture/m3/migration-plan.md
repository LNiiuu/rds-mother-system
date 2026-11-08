# M3 分批迁移方案

**基线**：`51a562e`
**总原则**：每批都满足"对外零变化"；每批一个独立 commit + 一个 tag；任一批失败可单独 revert，不影响其他批。
**排序依据**：先建立"看得见"（B0），再动"最内层、最低风险"（B1），逐层向外推，把**唯一改契约**（B3）和**唯一写外部状态**（B4）放在中间偏后，把**面最大**（B5）放最后。

```
B0 观测与门禁 ──► B1 资产定位 ──► B2 配置与身份 ──► B3 数据源与契约 ──► B4 宿主注册表 ──► B5 结构切分
   （无行为变化）      （内层）         （对外语义可测）      （唯一改契约）        （唯一写外部）        （面最大）
```

---

## 批次总览

| 批 | 主题 | 解决 | 触及文件（估） | 契约变更 | 风险 | 可回滚性 |
|---|---|---|---|---|---|---|
| B0 | 基线冻结 + 错误模型 + 分层检查 | H-10、H-13 | 6 新增 / 4 修改 | 无 | 低 | 整批 revert |
| B1 | `AssetResolver` | H-01、H-13 | 3 改 + 2 新增 | 无 | 低 | 整批 revert |
| B2 | 组合根 + `IdentityProvider` | H-02、H-03 | 4 改 + 3 新增 | 无 | 中 | 整批 revert（有 1 项已文档化行为变化） |
| B3 | `SessionSource` + ledger 解耦 | H-05、H-06、H-07 | 5 改 + 3 新增 | **是**（放宽 2 处） | 中高 | 整批 revert + 契约回滚 |
| B4 | `HostRegistry` | H-04（S1） | 3 改 + 3 新增 | 无 | 中 | 整批 revert |
| B5 | `db.js` 拆分 + 脚本收口 | H-08、H-09、H-11 | 8 改 + 2 新增 | 无 | 中 | 整批 revert |

合计约 **29 个文件改动 + 15 个新增**。不重写任何业务逻辑，不迁移任何数据。

---

## B0 基线冻结与可观测性

**目的**：在动任何结构之前，先让"行为变了"这件事可被发现。

**做什么**

1. `mars/src/errors.js`：`AppError` + `PUBLIC_CODES` + `toPublicCode` + `isPublicCode`。
2. `mcp.js:27` 与 `mcp-stdio.js:320` 改用 `toPublicCode`，删除两处内联正则白名单。
   **这是唯一一处"立刻修掉已存在的不一致"**：旧网关从此不再把 6 个码退化成 `INTERNAL_ERROR`。
3. `tooling/layering-check.mjs`：静态扫描端口零 import、域无 `fs`/`env`/`adapters`、组合根行数、端口方法数。
   初次接入以 **warn 模式**运行（不参与退出码），B1 起转 fail。
4. `docs/architecture/m3/baseline/`：记录 7 项冻结面的当前值
   （`cli-help.txt`、`cli-json-keys.json`、`mcp-tools.json`、`error-codes.json`、`pack-files.txt`、`contracts-sha256.json`、`exit-codes.json`）。
5. `tooling/pack-check.mjs` 扩展：断言 `mars/contracts/` 与（B1 起的）`mars/src/ports/` 在包内。

**不做什么**：不改任何调用点的 `throw new Error(...)` 写法（迁移期前缀匹配已足够）；不改 SQL；不改 API。

**退出条件**：见 `acceptance-criteria.md` §B0。

**回滚**：`git revert <B0>`。错误码映射回到"两份白名单"，行为恢复为今天的样子（含退化）。

---

## B1 资产定位（`AssetResolver`）

**目的**：让"契约从哪来"变成一个可注入的问答，而不是 `require` 期的副作用。

**做什么**

1. `mars/src/ports/asset-resolver.js`：端口契约（JSDoc 类型 + 错误码常量，零 import）。
2. `mars/src/adapters/fs-asset-resolver.js`：`FsAssetResolver({root})`，`contract(name)` / `config(name)`，返回 `{value, source, hash}`，`value` 冻结。
3. `mars/src/adapters/memory-asset-resolver.js`：测试替身（放 `mars/tests/helpers/`，不进发行包）。
4. 改 `store.js:9-11`、`compiler.js:13-14`、`manifest.js:8-10`：删除模块级 `ROOT` 与 `JSON.parse(fs.readFileSync(...))`，
   改为 `propose(db, principal, input, {assets, ...})` 等函数从 options 拿 schema。
5. 组合根雏形 `mars/src/composition.js`（此批只负责"建 assets"）：创建时**立即解析全部 5 个契约**，缺一个即抛 `ASSET_MISSING`。
6. `package.json` 的 `files` 增加 `mars/src/ports/`、`mars/src/adapters/`。
7. `tooling/layering-check.mjs` 转 fail 模式。

**关键约束**

- **schema 内容一字不改**，只改"谁读、何时读"。
- 报错时间语义必须与今天相同：今天 `require('./store')` 就抛 ENOENT，改后组合根创建时抛 `ASSET_MISSING`。
  两者都发生在"任何业务动作之前"，因此调用方观察到的时机一致。
- `guardSourceRef` 的 `fs.realpathSync` 保留（安全函数，明确豁免）。

**为什么先做这个**：它是唯一"改了也没有任何对外可见差异"的内层改动，用来验证分层检查与 golden 快照是否真的能发现偏差。
如果这一批的 golden 出现 diff，说明检查工具有问题，此时回滚成本最低。

**退出条件**：`acceptance-criteria.md` §B1。

---

## B2 组合根与身份（`IdentityProvider`）

**目的**：把"从哪拿配置/身份"从四处收敛到一处。

**做什么**

1. `mars/src/ports/identity-provider.js`：端口契约。
2. `mars/src/adapters/cli-identity.js`：`--token` > `MARS_TOKEN`，`--role` > 首个角色。
3. `mars/src/adapters/token-file-identity.js`：`MARS_TOKEN_FILE` + `MARS_ROLE`（今天 `mcp-stdio.js:32-43,216-226` 的逻辑搬入）。
4. `mars/src/adapters/static-identity.js`：测试替身。
5. `composition.js` 扩展为完整快照：`{root, db, principals, routing, allowedRoots, identity, hostRegistry}`；
   内部**单一** `resolvePaths({argv, env})` 实现优先级，供 CLI / MCP / doctor 共用。
6. `cli.js:36-50`、`mcp-stdio.js:416-421`、`bin/doctor.mjs:192` 改为调组合根，删除各自的路径拼装。
7. `store.js:16-23` `resolveRouting` 删除环境变量读取，routing 必须由调用方传入（组合根已保证非空）。
8. CHANGELOG 记录第 1 项已文档化的行为变化：**配置在进程启动时快照**（见 `host-adapter-design.md` P1 说明）。

**对外行为差异（唯一一处，必须写进 CHANGELOG）**

| 项 | 之前 | 之后 |
|---|---|---|
| 长驻 MCP 进程修改 `role-routing.json` | 下一次调用可能生效（未文档化、无测试覆盖） | 需重启进程 |

其余全部不变：`--db`/`MARS_DB`、`--principals`/`MARS_PRINCIPALS`、`--routing`/`MARS_ROUTING`、`--token`/`MARS_TOKEN`/`MARS_TOKEN_FILE`、`MARS_ROLE`、`MARS_ALLOWED_ROOTS` 的语义与优先级逐字保持。

**为什么这一批风险是"中"**：它同时触到 CLI 与 MCP 两条入口。缓解手段是 B0 的 golden 快照 + 现有 88 例 + `ci-smoke.sh` 端到端。

**退出条件**：`acceptance-criteria.md` §B2。

---

## B3 数据源与契约（`SessionSource`）

**目的**：让账本能接第二种来源，且不再依赖数据库。

**做什么**

1. `mars/src/ports/session-source.js`：`kind/sniff/parse` 三方法 + `SessionUsage` 类型 + 错误码。
2. `mars/src/adapters/dsh-session-source.js`：把 `ledger.js:19-147` 的 zstd 多帧解析与事件累加**原样搬入**，改为纯函数（收 `bytes`，不读文件）。
3. `mars/src/adapters/synthetic-session-source.js`：测试用，包 `mars/tests/fixtures/ledger/make-session.js`。
4. `mars/src/session-registry.js`：`register/resolve/list`。组合根只注册 `dsh-v4`。
5. `ledger.js` 瘦身为**纯汇总**：`buildLedger` / `reconcile` / `toCsv` 保留原样；
   `parseSession(file)` 保留为兼容外壳，内部改为"读文件 → 选源 → `parse`"。
6. `cli.js:111-126` 的 `ledger` 分支：
   - 删除 `openDb(p.db)`；
   - 改为经 `AuditSink` 记审计（无 DB 时用 `NullAuditSink`）；
   - 会话文件存在性检查**先于**任何副作用；
   - 处理 H-07：要么经 `IdentityProvider` 真正授权 `ledger.read`，要么从 `ACTIONS` 移除并在文档标注。
     **设计选择**：移除该动作 + 文档标注。理由：ledger 是纯本地只读能力，强制身份会让"只想核算一下 token"变成必须先 init-dev，与该命令的用途冲突；
     同时把审计行的 `principal_id` 从字面量 `'cli'` 改为 `'local'` 并在目标字段写明文件 basename，使审计记录不再伪装成已认证主体。
7. `mars/contracts/ledger.schema.json:11,22`：`const` → `pattern`（详见 `host-adapter-design.md` §4.2）。
8. 新增测试：`source_kind` 必须在注册表 `list()` 内（兜住 `pattern` 放宽后的拼写风险）。

**为什么契约变更是安全的**

- 只放宽、不收紧：所有历史账本（`source: "dsh-session"`）仍通过校验；
- 不删字段、不改字段语义 → **不需要数据迁移**；
- 有测试兜住"拼错 kind"这一放宽带来的唯一风险。

**为什么放在 B4 之前**：B4 要写外部产品状态，回滚成本高。
在它之前先把"数据进来"这条链跑顺，B4 出问题时可停在 B3 的稳定点。

**退出条件**：`acceptance-criteria.md` §B3。

---

## B4 宿主注册表（`HostRegistry`，S1）

**目的**：把"改写别人产品的配置文件"变成一个有契约、有备份、有原子写、会拒绝未知格式的能力。

**做什么**

1. `mars/src/ports/host-registry.js`：`detect/list/backup/removeByPrefix` 四方法。
2. `mars/src/adapters/dsh-registry.js`：读写 `registry.json`；写入前记录原文件 hash；用 `tmp + rename` 原子替换；
   顶层出现未知键时 `HOST_WRITE_REFUSED`（不静默丢弃）。
3. `mars/src/adapters/null-host-registry.js`：无宿主时全部返回 `HOST_REGISTRY_NOT_FOUND`。
4. `mars/scripts/mars-mcp-disable.js`（新）：Node 实现，参数 `--registry/--backup-dir/--yes`，默认 dry-run。
5. `mars/scripts/mars-mcp-disable.ps1` 改为**转调** Node（与 M2 的 `mars-rollback.ps1` 同一模式，避免两份实现分叉）。
6. 测试：临时目录 JSON 夹具，覆盖"无宿主 / 格式非法 / 含未知键 / 正常移除 / dry-run 不写"五种情形。

**关键约束**

- 默认 dry-run 语义必须保持（`-Yes` 才写）；
- 备份位置默认值保持 `mars/var/mcp`；
- **不碰**任何客户端 `mcp.json`（`docs/install.md` §9 的边界不变）。

**为什么最后才动外部状态**：这是唯一"失败会损坏别的产品"的批次。放在 B0–B3 之后，
此时 golden 快照、分层检查、测试门禁都已稳定，出问题能立刻定位是"本批引入"而不是"历史遗留"。

**退出条件**：`acceptance-criteria.md` §B4。

---

## B5 结构切分与脚本收口

**目的**：拆掉 `db.js` 的六合一，并把最后一处"用外部产品当运行时"的脚本改掉。

**做什么**

1. `db.js`（218 行）按职责切成四个文件，**SQL 一字不改**：
   - `db/schema.js`：DDL + `SCHEMA_VERSION` + `migrate`（`:14,25-163`）
   - `db/index.js`：`openDb`（`:16-23`），re-export 其余
   - `db/audit.js`：`audit`（`:190-196`）+ `DbAuditSink` 适配器
   - `db/ratelimit.js`：`consumeRateLimit`（`:167-188`）
   - `db/stats.js`：`dbStats`（`:198-216`）
   **保留 `mars/src/db.js` 作为转发壳**，使 9 个依赖方的 `require('./db')` 一行都不用改。
2. `phase2-g1-verify.js:12`：`DSH.exe` → `process.execPath`（与 `wp1.test.js` 对齐），删除 `ELECTRON_RUN_AS_NODE`。
3. `phase4-usage.js:8`：默认值改为必填参数或 `RDS_SESSIONS_ROOT`，无值时给出明确错误而非猜 `~/.dsh`。
4. `tooling/pack-check.mjs` 断言 `mars/src/db/` 在包内。

**为什么"保留转发壳"而不是全量改 require**：9 个模块的 import 改动是纯噪音，且会让 B5 的 diff 覆盖 9 个文件。
转发壳让 B5 的语义变更面收敛到 1 个文件。

**退出条件**：`acceptance-criteria.md` §B5。

---

## 批次之间的依赖与并行度

```
B0 ─┬─► B1 ──► B2 ──► B3 ──► B4
    └───────────────────────► B5   （B5 只依赖 B0 的 golden 与 B1 的目录约定，可与 B3/B4 并行）
```

- B1 必须先于 B2：组合根在 B1 建立，B2 只是扩展它。
- B3 必须先于 B4：B3 引入 `AuditSink`，B4 的适配器测试要用它记录拒绝事件（可选）。
- B5 可与 B3/B4 并行，但**不建议**：同时开两条改动线会让 golden diff 难以归因。

---

## 每批的统一作业顺序

1. 开批前：`git status` 快照（确认 51 项原有工作未动）+ 记录 tag 起点。
2. 写代码（只动本批声明的文件；越界即停）。
3. 本地跑：`npm run verify`（doctor + config + 门禁）→ `bash tooling/ci-smoke.sh` → `node tooling/layering-check.mjs`。
4. 采 golden：与 `baseline/` diff，逐条解释差异（无差异则写明"无"）。
5. 单独 commit（一个批一个 commit，message 写清"对外行为变化：无 / 有（列明）"）。
6. 打 tag：`m3-b0` … `m3-b5`。
7. **不 push**（M3-1 明确禁止；后续批次是否推送由用户按批授权）。

---

## 与既有路线图的衔接

M0 审计定下的 M3 是"目录重组"，本方案**把它缩小为"边界收口"**，理由：

| 原设想 | 本方案 | 原因 |
|---|---|---|
| 把 `mars/src/*.js` 重排为 `domain/ adapters/ ports/` | 只新增 `ports/`、`adapters/`、`composition.js`，域文件留在原地 | 物理搬迁会改 6 处 `__dirname`、影响 15 个测试的 require 路径，收益只是"看起来整齐" |
| 拆 `db.js` 并改 9 处 require | 拆文件 + 保留转发壳 | 同上，减少噪音 diff |
| 顺便清理 `mars/docs` 过期内容 | 不做 | M5 范围 |

这样 M3 的 diff 保持在约 44 个文件，且每一处都能对应到 `coupling-map.md` 的一个 ID。
