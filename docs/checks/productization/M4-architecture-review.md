# M4 架构复核

**范围**：M4 是否破坏了 M3 定下的边界；没有新增抽象的理由是否成立。
**结论**：边界未动，端口未增，依赖方向未变，无循环依赖。

---

## 1. 五个端口：状态未变

| 端口 | 方法 | M4 是否改动 | 生产实现 | 测试替身 |
|---|---|---|---|---|
| `AssetResolver` | `contract` / `config` / `rootPath` | 否 | `fs-asset-resolver` | `memoryAssets`（测试内） |
| `IdentityProvider` | `resolve` / `describe` | 否 | `cli-identity`、`token-file-identity` | 直接构造凭证对象 |
| `SessionSource` | `kind` / `sniff` / `parse` | 否 | `dsh-session-source` | 测试内联假源 |
| `AuditSink` | `record` | 否（B3 只加计数，在 `db.js` 侧） | `db-audit-sink`、`null-audit-sink` | 注入抛错 sink |
| `HostRegistry` | `detect` / `list` / `remove` / `verify` | 否 | `dsh-registry`、`null-host-registry` | 临时目录合成注册表 |

M4 **没有新增端口**。唯一新增的源码文件 `mars/src/version.js` 不是端口，是一个 8 行的常量读取点：
它的存在理由是"不允许第二个硬编码版本常量"，不是抽象。

---

## 2. 依赖方向

`tooling/layering-check.mjs` 每次 `npm test` 前都会跑（CI 亦然）：

```
$ npm run layers
LAYERS PASS  problems=0 warnings=2
```

两条 warning 是**刻意声明的边界代码**（不是待还债务）：

| 文件 | 规则 | 理由 |
|---|---|---|
| `mars/src/util.js` | 可用 `node:fs` | `guardSourceRef` 的 realpath 逃逸检测、`writeJsonAtomic` 的原子写，是最底层安全/持久化原语 |
| `mars/src/cli.js` | 可用 `node:fs` | 入口负责把 `--out` 产物写到用户指定目录 |

M4 期间这条检查**真的拦下过一次违规**：B5 的 `describeError` 最初读 `process.env.RDS_DEBUG`，
触发 `L4-env`（域/入口不得读环境变量），改为 `--debug` 参数后归零。
这个过程保留在提交历史里，说明门禁不是摆设。

---

## 3. 无循环依赖

`mars/src` 的 23 个域文件 + 5 个端口 + 8 个适配器，依赖图无环（分层检查每次验证）。
M4 新增的 `version.js` 只被 `mcp-stdio.js` 引用，不参与域依赖。

---

## 4. 组合根大小

`mars/src/composition.js` 83 行（上限 120）。M4 未向其中添加逻辑 ——
B4 的版本读取放在独立文件，B5 的错误格式化放在 `cli.js`，都刻意没有塞进组合根。

---

## 5. M4 对架构的实质影响

三处行为变化，都是"让边界更可信"，不是"让结构更花哨"：

1. **契约有了执行点**（B1）：`ledger.schema.json` 此前在 `mars/src` 零引用，
   现在 CLI 出口按它校验。这是"边界"第一次真正生效。
2. **数据库拒绝降级**（B3）：`openDb` 在打开前检查 `schema_version`，
   高于代码支持版本即拒绝。这条规则保护的是**数据**，不是结构。
3. **MCP 降级启动**（B6）：缺 `principals.json` 不再让进程消失，改为空身份表 + 每次调用
   `AUTH_DENIED`。这让"服务在跑但没权限"与"服务没起来"这两种故障第一次可区分。

---

## 6. 没有做的事（刻意的）

| 没做 | 理由 |
|---|---|
| 新增端口 / 插件机制 | 只有一个真实宿主；多一层动态机制只带来打包与信任问题 |
| 日志框架 | 现有 `ERROR`/`WARN` 前缀 + 错误码足够；框架会把 CLI 输出变成需要配置的东西 |
| Repository 层 | 域函数已直接吃连接句柄；加一层只是把 SQL 挪个位置 |
| Schema 变更 / 数据迁移 | 本轮明确禁止，且 B1 的契约放宽已经解决了实际问题 |
| 把 `ledger` 聚合输出接到 CLI | 会改变公开 JSON 形状，需单独授权 |

---

## 7. 结论

M4 的架构改动集中在"边界可信度"，不在"结构美观度"。五个端口、依赖方向、无环、组合根规模
全部与 M3 一致；新增的唯一文件是版本常量读取点，且已被测试钉住"不许再有第二份硬编码版本"。
