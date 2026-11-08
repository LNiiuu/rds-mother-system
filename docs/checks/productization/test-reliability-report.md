# 测试可靠性报告（M2）

> 目标：把「在本机能过」变成「在干净环境、两个平台、同一份代码上都能过」，并且让失败无法被掩盖。

---

## 1. 原始问题

| 文件 | 问题 | 后果 |
|---|---|---|
| `mars/tests/phase1/ledger-reconcile.test.js` | 硬编码 `C:\Users\liuch\.dsh\sessions\...` 两个会话路径 | 干净机器上 4 个用例全部 skip → `fail 0` 假绿灯 |
| 同上 | 硬编码 `PHASE0 = { R7: 41597577 }` | 会话随使用增长（实测已到 42,572,235），2 个用例恒红 |
| `mars/tests/phase2/wp1.test.js:19` | 用 `DSH.exe`（Electron 内置 Node）当运行时 | 无 DSH 的机器上 spawn 失败；Linux 必红 |
| `mars/tests/phase1/rollback-offline.test.js` | 硬编码 `C:\Windows\...\powershell.exe` 与 `D:\M1` | 非 Windows 无法运行，且依赖作者机器目录 |
| `mars/tests/ledger/ledger.test.js:43`、`phase1/lifecycle.test.js:68` | 能力缺失时 `t.skip` | 跳过的断言等于没有断言 |

实测对比（M1 前）：

| 平台 | 结果 |
|---|---|
| Windows（作者机） | 80 tests / 78 pass / **2 fail** / 0 skip |
| Linux | 80 tests / 73 pass / **3 fail** / **4 skip** |

同一份代码，三个平台三种结果——这就是「不可重复」。

---

## 2. 改造方案

### 2.1 合成 fixture 取代真实会话

`mars/tests/fixtures/ledger/make-session.js`

- 用固定模板构造 DSH v4 事件（`session` / `request/header` / `assistant/message` / `tool/result`）；
- 把事件切成 N 帧，每帧独立 zstd 压缩后拼接——复现 DSH「一次追加一帧」的真实形态；
- 数值固定：`input=2000 / output=500 / cacheRead=2500 / cacheWrite=0 / total=5000`；
- `expectedTotals()` **独立实现**累加，不复用 `src/ledger.js`，避免「用实现验证实现」；
- 支持注入坏行、空会话、纯 JSONL 等变体。

### 2.2 真实会话的核对保留为 External

`mars/tests/external/dsh-real-session.external.js`

- 文件名不以 `.test.js` 结尾 → 不在 Required 通配内；
- 需要 `RDS_IT_DSH_SESSION`；未设置时**失败并提示如何启用**，而不是静默 0 用例；
- 可选 `RDS_IT_DSH_EXPECTED_TOTAL` 启用对账断言。

### 2.3 运行时与平台去耦

| 原依赖 | 现在 |
|---|---|
| `DSH.exe` 当 Node | `process.execPath`，可 `RDS_NODE_BIN` 覆盖 |
| `powershell.exe` 跑回滚 | 回滚逻辑下沉到 `mars/scripts/mars-rollback.js`；PS 脚本改为转调 |
| `D:\M1` 作为测试仓库 | `fs.mkdtempSync` 临时仓库 |

### 2.4 消灭静默跳过

| 位置 | 原来 | 现在 |
|---|---|---|
| `ledger.test.js` 多帧用例 | `test.skip('zstdCompressSync unavailable')` | `assert.equal(typeof ..., 'function', 'FIXTURE_UNAVAILABLE: ...')` |
| `lifecycle.test.js` 符号链接用例 | `t.skip('junction unavailable')` | 平台分支（win32 用 junction / POSIX 用 dir）+ `assert.fail('SECURITY_TEST_UNAVAILABLE: ...')` |
| `ledger-reconcile.test.js` ×4 | `t.skip('session missing')` | 文件不存在即 `assert.throws(/ENOENT/)`；正常路径用 fixture |

---

## 3. 覆盖范围

`mars/tests/phase1/ledger-reconcile.test.js`（8 个用例）：

| 用例 | 覆盖点 |
|---|---|
| 多帧 zstd 解析与独立解码一致 | 正常数据读取、多帧边界、字段提取（model/provider） |
| 对账通过 / 偏差 25% 必须拒绝 | 总量统计、1% 阈值正反例 |
| 空会话不产出虚假用量 | 空数据 |
| 坏行跳过但保留合法行 | 数据格式错误、必需字段缺失 |
| 文件不存在抛错 | 文件缺失 |
| 多次解析结果稳定 | 可重复性 |
| 重复 session_id 记警告不合并 | 数据重复 |
| CLI 导出 json + csv | 集成：子进程、文件落盘、CSV 表头与 TOTAL 行 |

`rollback-offline.test.js`（8 个用例）：dry-run 不删除、`--yes` 只删运行时产物、
principals / token 需显式开关、仓库缺失报错、命名规则、离线姿态、README 边界。

所有用例都在 `mkdtempSync` 临时目录内完成，结束时删除；不触碰生产库与真实 `principals.json`。

---

## 4. 防假绿机制

### 4.1 门禁判据

`tooling/test-gate.mjs`：

```
tests > 0
fail === 0
skipped === 0
pass + fail + skipped + todo + cancelled === tests
```

不满足任一条即退出码 1，并打印原始 TAP 末 80 行。

### 4.2 为什么不能只看退出码

| 场景 | `node --test` 退出码 | 门禁 |
|---|---|---|
| 缺 fixture 走 `t.skip` | 0 | 红 |
| 一个用例都没匹配到 | 0 | 红 |
| 正常失败 | 1 | 红 |

前两种在本项目的 M0 审计中真实发生过。

### 4.3 门禁自检（反向验证）

`tooling/test-gate-selfcheck.mjs` 在临时目录造四组用例集：

```
PASS  all-pass     期望 exit=0 实际 exit=0
PASS  has-failure  期望 exit=1 实际 exit=1
PASS  has-skip     期望 exit=1 实际 exit=1
PASS  no-tests     期望 exit=1 实际 exit=1
门禁自检: PASS（4/4）
```

这条检查本身进了 CI（`npm run test:gate-selfcheck`）。如果门禁被改成恒返回 0，它会立刻变红。

---

## 5. 结果

```
GATE PASS  tests=88 pass=88 fail=0 skipped=0
```

| 指标 | 值 |
|---|---|
| Required pass | 88 |
| Required fail | 0 |
| Required skipped | 0 |
| Required not run | 0 |
| External | 未执行（需真实会话，按设计不进 CI） |

---

## 6. 残留风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 合成 fixture 弱化了真实数据形态 | 真实 DSH 会话可能有本 fixture 未覆盖的字段或帧结构 | 保留 External 测试；作者可在本地用真实会话核对 |
| `assert.fail` 替代 skip 后，低版本 Node 会红 | 例如没有 `zstdCompressSync` 的 Node | 这是**有意为之**：能力缺失应当可见。`engines` 已要求 >=22.5，文档注明实测版本 |
| cli-smoke 在 CI 依赖 `tar` | Windows runner 自带 bsdtar | 若某镜像缺失，`pack-check` 会报错而非静默跳过 |
