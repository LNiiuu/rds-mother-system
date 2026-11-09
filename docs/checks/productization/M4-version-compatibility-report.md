# M4-B4 配置、版本与兼容性报告

**批次**：m4-b4
**基线**：`01f5e82`（m4-b3）
**结论**：版本体系有正式规则并落地（serverInfo 不再硬编码）；`engines.node` 按实际能力收紧到 22.15；配置解析的一致性有了机械守卫。

---

## 1. 配置：核查结论

M3 已把四份解析收敛到 `mars/src/paths.js:resolvePaths()`。本批只做"是否真的收敛了"的核查与守卫，不重写。

| 检查项 | 结论 | 证据 |
|---|---|---|
| 配置来源是否唯一 | 是。路径规则只有 `resolvePaths` 一处；路由内容由 `loadRoutingConfig` 在启动时校验一次 | `grep -rn "MARS_DB" mars/src/` 只剩 `paths.js` |
| 环境变量优先级 | 明确：`--db` > `MARS_DB` > `<root>/mars/var/mars.db`；根可用 `--root` / `RDS_HOME` | 测试断言三档 |
| CLI 参数是否覆盖配置 | 是（同上） | 测试断言 |
| doctor 与运行入口是否同一实现 | 是。doctor 现在 require `paths.js`，且**不得**自己读 `MARS_DB` | 静态守卫 |
| 配置错误是否指出具体字段 | 是。`ROUTING_UNAVAILABLE routing 配置缺少有效的 roles 对象` | M3 已有，本批回归 |
| 文档是否与代码一致 | 是（`docs/install.md` §9 配置表 + 本文） | — |

新增 `mars/tests/arch/config.test.js`（4 例）：三档优先级 / `RDS_HOME` 改根 + `--root` 优先 /
doctor 与运行时同源（并禁止 doctor 自己读 `MARS_DB`）/ 6 个域模块零 `process.env`。

---

## 2. 版本：从"三个数字"到一套规则

### 2.1 现状（修复前）

| 数字 | 位置 | 值 | 说明 |
|---|---|---|---|
| 产品版本 | `VERSION`、`package.json` | `0.1.0` | 一致 |
| MCP 服务版本 | `mcp-stdio.js:23` | **`0.2.0`** | 硬编码，与产品版本长期不一致，无任何说明 |
| 账本格式版本 | `ledger.schema.json:9` | `0.1.0` | **另一维度**，却与产品版本数字相同，容易误读 |
| 数据库结构版本 | `db/schema.js` | `4` | 第三维度 |

### 2.2 决策

采用"**一个产品版本 + 若干格式/结构版本**"：

1. `package.json.version` 是唯一真相源；`VERSION` 是镜像，doctor 校验一致；
2. `serverInfo.version` **报告产品版本**，通过新增的 `mars/src/version.js` 读取，不再硬编码；
3. `ledger.schema.json` 的 `version` 与 `SCHEMA_VERSION` 是独立维度，**不与产品版本对齐**。

**为什么不把产品版本升到 0.2.0 去迁就服务端常量**：那个 `0.2.0` 没有任何发布记录支撑
（CHANGELOG 里没有 0.2.0 条目），把它当基准等于让一个孤儿数字决定发布号。
**代价**：MCP 客户端若曾把 `0.2.0` 写进白名单会看到变化 —— 没有测试或文档依赖它，
仓库内 grep 零命中（`grep -rn "0\.2\.0" mars/` 仅剩历史文档）。

规则写入 `docs/versioning.md`，并附变更记录。

### 2.3 落地

| 文件 | 改动 |
|---|---|
| `mars/src/version.js` | 新增。从 `package.json` 读 `PRODUCT_VERSION`（用 require 而非 fs，不触发 L3-fs） |
| `mars/src/mcp-stdio.js` | `SERVER_VERSION = '0.2.0'` → `const { PRODUCT_VERSION: SERVER_VERSION } = require('./version')` |
| `docs/versioning.md` | 新增。三个命名空间、五条规则、Node 承诺、变更记录 |

---

## 3. Node 版本承诺

| 能力 | 最低版本 | 依据 |
|---|---|---|
| `node:sqlite` / `DatabaseSync` | 22.5.0 | 既有 |
| `zlib.zstdDecompressSync` / `zstdCompressSync` | **22.15.0** | Node 文档：Zstd 系列 `Added in: v23.8.0, v22.15.0`（v22 分支回移植） |

`engines.node`：`>=22.5.0` → **`>=22.15.0`**。

**理由**：`rds ledger` 是文档化功能，22.5–22.14 上会以 `ZSTD_UNSUPPORTED` 失败。
声明 22.5 等于承诺一个跑不全功能的区间。**没有为了通过 CI 降低要求** —— CI 矩阵本来就是 22.x/24.x
的最新补丁版，改动不影响 CI，只影响对用户的承诺。

配套：doctor 的 Node 门槛同步到 22.15，并新增 `zlib:zstd` 探测项（第 10 项检查），
让"装得上但 ledger 用不了"这种情况在 `rds doctor` 就暴露，而不是等用户跑命令。

---

## 4. 验证

```
$ node bin/rds.mjs doctor
  node         ok    v22.22.2（要求 >=22.15.0；22.5 起有 node:sqlite，22.15 起才有 zlib zstd）
  node:sqlite  ok    模块可用，FTS5 虚拟表可用
  zlib:zstd    ok    zstdCompressSync / zstdDecompressSync 可用（rds ledger 依赖）
  version      ok    0.1.0（VERSION 与 package.json 一致）
  database     ok    …（589824 B，schema 4）
status: ok  (fail=0 warn=1 checks=10)
```

MCP 端到端握手（真实 spawn + initialize）：

```
serverInfo = { name: 'mars', version: '0.1.0' }   ← 与产品版本一致
protocolVersion = '2024-11-05'                    ← 未变
```

新增测试：
- `mars/tests/arch/version.test.js`（4 例）：VERSION≡package.json；`version.js` 唯一来源且禁止硬编码；
  **真实握手**断言 serverInfo.version；engines ≥22.15 且 doctor 口径同步
- `mars/tests/arch/config.test.js`（4 例）：见 §1

---

## 5. 兼容性影响

| 面 | 变化 | 风险 |
|---|---|---|
| MCP `serverInfo.version` | `0.2.0` → `0.1.0` | 低。仓库内无任何代码/测试/文档依赖 0.2.0；对外形状未变（仍是字符串） |
| `engines.node` | `>=22.5.0` → `>=22.15.0` | 中。22.5–22.14 的用户会收到 npm 的 engines 警告；但那些版本本来跑不了 `rds ledger` |
| CLI 参数 / JSON 形状 / 退出码 | 未变 | — |
| 配置优先级 | 未变（M3 已定） | — |
| 数据库 | 未变 | — |

---

## 6. 验收对照（任务书 §8.4）

| 要求 | 结果 |
|---|---|
| 配置来源唯一且优先级明确 | 是（测试 + 静态守卫） |
| 版本策略形成正式文档 | 是。`docs/versioning.md` |
| 所有版本展示来源一致或有明确区分 | 是。serverInfo 派生自产品版本；格式/结构版本明确标注为独立维度 |
| Node 版本承诺与实际能力相符 | 是。22.15 由 zstd 决定，doctor 分别探测 sqlite 与 zstd |

---

## 7. 遗留

| 项 | 说明 |
|---|---|
| 产品版本仍为 `0.1.0`（未发布） | 发布时机与版本号是产品决策，本轮只建立规则，不擅自升号 |
| `docs/install.md` 里"0.2.0 属 M5"的表述 | B6 统一改写 |
| CI 未跑 22.15 这个精确边界 | CI 跑 22.x 最新补丁；22.15 的边界靠文档依据 + doctor 运行时探测，属静态/运行期证据，非实机矩阵 |
