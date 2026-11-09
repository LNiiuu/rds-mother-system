# M5-B4 路径与可移植性报告

**日期**：2026-11-09（+08:00）
**批次**：M5-B4
**性质**：先评估、后动手。**未改变 `ledger.json` 的公开路径格式。**
**结论先行**：`ledger` 的绝对路径问题**不在本轮修改**，因为它属于「修改 JSON 输出格式」，按授权规则必须先给方案。本轮做的是：修掉真正属于缺陷的三处、把现状固化成测试契约、给出带兼容性分析的方案与推荐。

---

## 1. 调查：绝对路径从哪来

### 1.1 代码路径

```
cli.js:  const sessionFile = path.resolve(String(args.session));
              ↓
adapters/dsh-session-source.js:  parse({ bytes, ref: sessionFile })
              ↓
              session.path = refText
              ↓
ledger.js:  path: String(session.path || '')
              ↓
              JSON 的 sessions[].path 与 CSV 的 path 列
```

`path.resolve()` 是唯一的成因：它在入口处就把用户输入变成了绝对路径，之后的每一层只是原样传递。

### 1.2 实测：三种输入，一种输出

用同一个 fixture 会话文件，分别用绝对路径与相对路径调用：

| 输入 | 输出的 `path` |
|---|---|
| `--session C:/Users/…/session.v4.jsonl.zstd` | `C:\\Users\\…\\session.v4.jsonl.zstd` |
| `--session ./session.v4.jsonl.zstd`（cwd 在该目录） | `C:\\Users\\…\\session.v4.jsonl.zstd` |

**相对输入也被解析成绝对。** 所以「传相对路径就能得到相对输出」不成立。

### 1.3 契约现状

`mars/contracts/ledger.schema.json` 里：

```json
"path": { "type": "string" }
```

没有任何格式约束。也就是说：**改它的值不违反契约，但会违反消费者的预期**。

### 1.4 现有消费者

| 消费者 | 用法 | 是否依赖「绝对路径」 |
|---|---|---|
| `ledger.js` 的 `toCsv` | 直接写入 path 列 | 否 |
| 人工阅读 | 判断这条会话来自哪个文件 | 相对路径反而更易读 |
| 可能的脚本 | `fs.readFileSync(row.path)` | **是** |
| 行为基线 `cli-json-keys.json` | 只比键树，不比值 | 否 |

**关键判断**：没有任何**仓库内**的代码依赖 `path` 是绝对路径。风险在仓库外的使用者。

---

## 2. 问题定性

| 维度 | 现状 | 后果 |
|---|---|---|
| 可移植 | 产物含作者机器路径 | 提交到仓库或发给同事时暴露本地目录结构 |
| 跨平台 | Windows 反斜杠、POSIX 斜杠 | 同一份分析在不同平台的输出不可直接 diff |
| 可复现 | 同一会话在不同 cwd 下运行，`path` 不同 | 「同样输入、同样输出」不成立 |
| 可定位 | 绝对路径能直接打开 | 这一条是它存在的理由 |

四个维度里，前三个是缺陷，第四个是设计意图。**不能为了修前三个而废掉第四个。**

---

## 3. 方案评估

| 方案 | 做法 | 兼容性 | 可移植 | 可定位 | 改动面 |
|---|---|---|---|---|---|
| **A 保持现状** | 绝对路径 | 100% | ✗ | ✓ | 无 |
| **B 写用户原值** | 不 `resolve`，原样写入 | 形状不变，值变 | 部分（用户传绝对时仍绝对） | 依赖 cwd | 改 1 行 |
| **C 相对 cwd** | `path.relative(cwd, abs)` | 形状不变，值变 | ✓（同 cwd 内） | 依赖 cwd | 改 1 行 |
| **D 相对 + 绝对双字段** | 新增 `path_absolute` | **键树变** | ✓ | ✓ | 契约 + 基线 + 消费者 |
| **E 只写 basename** | `path.basename` | 形状不变，值变 | ✓ | ✗（重名即歧义） | 改 1 行 |
| **F 新增 `--path-style`** | 默认 `absolute`，可选 `relative` / `basename` | **默认 100% 不变** | 可选 | 可选 | 新增 1 个 flag |

### 3.1 逐条否决理由

**B（写原值）**：看起来最省事，但引入「输出依赖 cwd 且不做规范化」。用户传 `../x/./y.jsonl` 就得到 `../x/./y.jsonl`——既不可移植也不可解析。**比现状更差**。

**C（相对 cwd）**：解决了可移植，但把 cwd 变成隐式输入。同一份 ledger 在两台机器上用不同 cwd 跑，`path` 不同，仍然不可复现。且 `../..` 这类路径对读者没有信息量。

**D（双字段）**：信息最全，但**改变 JSON 键树**——`cli-json-keys.json` 基线会红，所有按 `additionalProperties: false` 校验的消费者会拒绝。收益（多一个字段）与代价（一次破坏性变更）不匹配。

**E（basename）**：`session.v4.jsonl.zstd` 这种文件名在 DSH 会话目录里大量重名（同名不同目录），basename 无法唯一定位。**丢掉了 `path` 存在的理由**。

**F（新增 flag）**：唯一能同时满足「默认不变」与「需要时可移植」的方案。代价是新增一个公开参数。

### 3.2 兼容性分析（针对 F）

| 项 | 影响 |
|---|---|
| 旧 `ledger.json` 文件 | 不受影响。schema 里 `path` 仍是 `string`，没有任何格式约束 |
| 旧消费者 | 不受影响。默认 `--path-style absolute` 与现状逐字节一致 |
| 行为基线 | `cli-json-keys.json` 只比键树，不比值 → 不漂移；`cli-help.txt` 会变（新增 flag）→ 需登记 |
| 契约 | 不改。若要加约束（如 `path_style` 字段），才需要升 `ledger.schema.json` 的 version |
| 已有记录 | 不涉及任何数据迁移。ledger.json 是产物，不是数据库 |

**结论：F 是低风险加法，但它仍然「修改公开 CLI 参数」——按本轮授权规则必须先暂停。**

---

## 4. 本轮实际做了什么

### 4.1 修掉三处真正属于缺陷的路径问题

| 编号 | 位置 | 问题 | 处理 |
|---|---|---|---|
| C-02 | `core/bootstrap/bootstrap.md:5` | 「母体系目录可读（默认 `D:\M1`）」——`core/` 整目录随包分发 | 改为「实际路径由安装形态决定：`rds doctor` 会打印 `root`，也可用 `RDS_HOME` 指定」 |
| C-03 | `core/policies/download.md:4` | 「默认 `D:\Downloads\rds`」——同上 | 改为「`~/rds-downloads`（Windows 用 `%USERPROFILE%\rds-downloads`）」 |
| C-08 | `README.md`、`docs/install.md`（3 处） | 示例用 `D:\Projects\my-app`，暗示作者机器上的目录习惯 | 改为 `./my-app` |
| C-09 | `docs/testing.md:92`、`CHANGELOG.md`（2 处） | 复述作者机器路径 | 改为「作者机器上的仓库绝对路径」 |

### 4.2 修掉 doctor 的两个扫描盲区

这是本轮最有价值的改动：**「路径卫生」此前有两个大洞**。

| 盲区 | 原因 | 后果 |
|---|---|---|
| `core/**/*.md` 完全不检查 | `CODE_EXT` 只含 js/json/yaml/ps1/sh，不含 `.md` | C-02、C-03 就是这样漏了两轮里程碑 |
| `docs/**/*.md` 也完全不检查 | `paths:docs` 调用的 `walk()` 用的是同一套 `CODE_EXT` | 「文档路径卫生」实际只检查了 docs 下的 json 与脚本，从没检查过 md |

修复：

1. 新增 `walkMarkdown()`，`paths:docs` 改为 `walk() + walkMarkdown()`。扫描面从 11 个文件扩大到 **75 个**。
2. 新增第 11 项检查 `paths:assets`：扫「会进发行包或作为仓库门面」的文档（`README.md`、`CHANGELOG.md`、`core/**/*.md`、6 份正式文档），**级别 `fail`**（不是 warn）。

为什么分两级：

- `paths:assets` —— 用户会直接读到的当前文档，含机器路径即缺陷 → `fail`
- `paths:docs` —— 带日期的历史证据，含机器路径是「真实记录」，改写等于篡改 → `warn`

### 4.3 把 ledger 的 path 语义固定成测试

新增 `mars/tests/ledger/path-portability.test.js`，4 个用例：

| 用例 | 断言 |
|---|---|
| `path` 是绝对路径且指向真实文件 | `path.isAbsolute(path) === true`、`fs.existsSync(path) === true` |
| 传相对路径时 `path` 仍是绝对 | 同上 |
| `--out` 写出的 JSON 与 CSV 用同一个 path | CSV 的 path 列包含 JSON 的 `path` 值 |
| ledger 是只读动作 | 不创建数据库 |

**这组用例的作用不是「证明现状最好」**，而是让任何「顺手把 path 改成相对」的改动立刻变红，强制走授权流程。

---

## 5. 结论

### 5.1 本轮不改 ledger 的路径格式

理由三条：

1. **它改的是公开 JSON 输出**。任务书把「修改公开 CLI 参数或 JSON 输出格式」列为必须暂停的事项。
2. **没有安全的「顺手改」**。方案 B/C/E 都是「形状不变、值变」——看起来兼容，实际会让依赖绝对路径的脚本静默失效。
3. **收益与代价不匹配**。真正的痛点不是「ledger 里有绝对路径」，而是「有人会把 ledger.json 提交到仓库」。后者用文档说明就能缓解。

### 5.2 缓解措施（已落地）

`docs/install.md` §11 新增一条：

> `ledger.json` 的 `sessions[].path` 是**绝对路径**（用途是能直接打开原文件）。产物不适合提交到版本库或直接分享；需要可移植输出时，等 `--path-style` 落地（见 §6）。

### 5.3 建议方案（待授权）

**新增 `rds ledger --path-style <absolute|relative|basename>`，默认 `absolute`。**

| 参数 | 输出 | 适用 |
|---|---|---|
| `absolute`（默认） | 现状，绝对路径 | 本机分析、需要回读原文件 |
| `relative` | 相对当前工作目录，用 `/` 分隔（跨平台一致） | 提交到仓库、团队共享 |
| `basename` | 仅文件名 | 只要个标签、不在意唯一定位 |

实施步骤（若获授权）：

1. `cli-help.js` 的 `ledger` 条目加 `--path-style` 说明
2. `dsh-session-source.parse()` 接收 `pathStyle`，在写入 `session.path` 前转换
3. 新增 3 个测试（三种取值各一）
4. `approved-additions.helpText` 重新登记
5. `docs/install.md` §11 把「不适合提交」改为「用 `--path-style relative`」
6. CHANGELOG 记一条「对外可见：新增可选 flag，默认行为不变」

**不做的事**：不加 `path_absolute` 字段（改键树）、不改 `path` 的默认语义（破坏消费者）、不引入 URI（`file://` 仍是绝对路径，只是换个写法）。

---

## 6. 遗留与后续

| 项 | 状态 | 说明 |
|---|---|---|
| `ledger --path-style` | **未实现，待授权** | 方案已就绪（§5.3） |
| `docs/` 下 75 个历史文件含机器路径 | **保留** | 带日期的证据，改写等于篡改。`paths:docs` 只 warn |
| `mars/docs/` 的历史路径 | **保留** | 同上 |
| macOS 下的路径行为 | 未验证 | 代码用 `path` 模块，理论一致；未实机 |

---

## 7. 验证

| 检查 | 结果 |
|---|---|
| Required 测试 | `GATE PASS tests=189 pass=189 fail=0 skipped=0`（185 → 189） |
| `rds doctor` | `status: ok (fail=0 warn=1 checks=11)`；`paths:assets ok（49 个活跃文档）`、`paths:docs warn（75 个）` |
| 发行包 `rds doctor` | `status: ok (fail=0 warn=0 checks=11)`；`paths:assets ok（44 个）` |
| 行为基线 | `BASELINE PASS`；`cli-help.txt` 按登记变更（batch `m5-b3+m5-b4`） |
| 分层检查 | `LAYERS PASS problems=0 warnings=2` |
| 结构自检 | `RESULT: PASS`（活跃资产项目名 0 命中） |
