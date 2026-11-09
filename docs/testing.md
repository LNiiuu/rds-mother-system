# 测试体系与门禁

> 适用版本：0.1.0（M5 收尾）。当前 Required 测试 **189 项**，`fail=0`，`skipped=0`。
> 本文说明测试怎么分类、怎么运行、门禁判据是什么，以及为什么不接受 `skip`。

---

## 1. 三类测试

| 类别 | 定义 | 是否进 CI 门禁 | 当前位置 |
|---|---|---|---|
| **Required** | 不依赖真实用户数据、不依赖开发者本机状态；任何失败都必须让门禁变红 | 是：Windows + Ubuntu × Node 22/24 四组已在 CI 实测通过 | `mars/tests/**/*.test.js` |
| **Integration** | 验证多个模块之间的真实交互（CLI 子进程、SQLite 文件、MCP 握手），但仍用临时目录与合成数据 | 是（包含在 Required 通配里，但需自建隔离环境） | 同上（如 `phase1/mcp-server.test.js`、`ledger/path-portability.test.js`） |
| **External** | 依赖本机外部环境：真实 DSH 会话、真实客户端、真实设备 | **否** | `mars/tests/external/*.external.js` |

External 测试的文件名刻意**不以 `.test.js` 结尾**，因此不会被 Required 通配匹配。这不是偷懒，而是为了让"哪些断言依赖外部环境"变成可枚举的事实。

### 1.1 按目录看

| 目录 | 覆盖什么 |
|---|---|
| `arch/` | 架构约束：契约一致性、脚本可解析、配置一致性、数据库生命周期、故障诊断、身份、宿主注册表、CLI 帮助、版本 |
| `ledger/` | 会话解析、对账、CSV 导出、路径语义 |
| `mcp/` | 协议握手、错误码映射、工具面 |
| `phase1/`–`phase4/` | 各阶段的功能与回归（存储、检索、编译、回滚、共享、编排） |
| `fixtures/` | 合成样本生成器（不复制真实数据） |
| `helpers.js` | 共享的临时目录与断言工具 |

---

## 2. 常用命令

```bash
npm test                     # Required 门禁（tests>0 且 fail=0 且 skipped=0）
npm run verify               # doctor + 配置校验 + 分层检查 + 门禁（四件事）
npm run layers               # 分层与循环依赖
npm run baseline             # 7 个对外面的行为基线
npm run config               # JSON 严格解析 + YAML 结构性 lint
npm run test:raw             # 直接看 node --test 原始输出
npm run test:gate-selfcheck  # 门禁自身的反向验证（注入 fail / skip / 空集）
npm run test:external        # External 测试（需要 RDS_IT_DSH_SESSION）
npm run smoke                # 发行包端到端：打包→检查→安装→doctor→写入→审批→检索→编译
npm run pack:check           # 只看 npm pack 会打哪些文件
```

`rds test` 等价于门禁；`rds test --raw` 等价于 `test:raw`。

External 测试的启用方式：

```bash
RDS_IT_DSH_SESSION="<session.v4.jsonl.zstd 路径>" npm run test:external
# 可选：同时给出期望总量，启用对账断言
RDS_IT_DSH_EXPECTED_TOTAL=12345 RDS_IT_DSH_SESSION=... npm run test:external
```

未设置环境变量时，External 文件会**失败并说明如何启用**，避免"0 个用例也算绿"。

---

## 3. 门禁判据

`tooling/test-gate.mjs` 只认四个计数：

```
tests > 0  &&  fail === 0  &&  skipped === 0  &&  pass + fail + skipped + todo + cancelled === tests
```

为什么不用 `node --test` 的退出码就够了：

| 场景 | `node --test` 退出码 | 门禁 |
|---|---|---|
| 缺 fixture，用例 `t.skip()` | **0** | 红（skipped>0） |
| 一个用例都没匹配到 | **0** | 红（tests=0） |
| 子进程失败被吞掉 | 可能为 0 | 由断言强度决定，门禁至少保证计数自洽 |
| 正常失败 | 1 | 红 |

第三种情况门禁管不了，只能靠断言本身。前两种是真实发生过的坑：M0 审计时在干净机器上 4 个 `skip` + `fail 0`，看上去是全绿。

### 3.1 反向验证

`npm run test:gate-selfcheck` 会在临时目录造四组最小用例集，分别断言门禁的退出码：

| 场景 | 期望 |
|---|---|
| 全部通过 | exit 0 |
| 一个失败 | exit 1 |
| 一个跳过 | exit 1 |
| 没有用例 | exit 1 |

如果门禁被改成"永远返回 0"，这条检查会立刻变红。

### 3.2 测试数只许升不许降

M3 定的下限是 88，当前 189。新增功能必须带测试；不允许为了"让门禁变绿"删测试或加 `skip`。

---

## 4. Fixture 约定

- 合成样本生成器：`mars/tests/fixtures/ledger/make-session.js`
  - 构造多帧 zstd 会话；数值固定（input=2000 / output=500 / cacheRead=2500 / cacheWrite=0 / total=5000）；
  - 期望统计由 `expectedTotals()` 独立计算，不复用 `src/ledger.js` 的累加逻辑；
  - 不读取、不复制任何真实会话内容。
- 所有临时数据写入 `fs.mkdtempSync(os.tmpdir(), ...)`，用例结束即删。
- 需要外部能力的用例（zstd 压缩、目录符号链接）**不允许 skip**：能力缺失即失败，并给出 `FIXTURE_UNAVAILABLE` / `SECURITY_TEST_UNAVAILABLE` 前缀的原因。
- 不依赖未跟踪文件。曾被回滚演练抓到过一次：`version.test.js` 依赖工作区的 `mars/config/principals.json`，干净检出即失败（M4-B6 修复为测试内自建临时身份）。

### 4.1 历史依赖是怎么去掉的

| 原问题 | 位置（修复前） | 处理 |
|---|---|---|
| 硬编码作者会话路径与固定总量 41,597,577 | `phase1/ledger-reconcile.test.js` | 改为合成 fixture；真实会话核对移到 External |
| 用 `DSH.exe` 当 Node 运行时 | `phase2/wp1.test.js:19` | 改为 `process.execPath`，可用 `RDS_NODE_BIN` 覆盖 |
| 硬编码 `powershell.exe` 与作者机器上的仓库绝对路径 | `phase1/rollback-offline.test.js` | 回滚逻辑下沉到 `mars/scripts/mars-rollback.js`，PS 脚本改为转调 |
| 缺能力就 `t.skip` | `ledger/ledger.test.js`、`phase1/lifecycle.test.js` | 改为 `assert.fail` 并写明原因 |

---

## 5. 覆盖范围声明

Required 测试验证的是**引擎行为**：存储与治理、鉴权与越界、检索、上下文编译、账本解析与导出、MCP 协议、回滚安全、离线姿态、分层约束、行为基线。

**不覆盖**：

| 项 | 现状 | 归属 |
|---|---|---|
| 真实 DSH 客户端联调 | 只有 External 测试 + 历史记录 | 需真机 |
| 真实设备上的 Frida / pcap | M1-0 阶段记录为 BLOCKED | 需真机 |
| macOS | 未实机验证 | 无设备；CI 矩阵未含 `macos-latest` |
| Node 22.15.0 精确边界 | 只测 22.x / 24.x 最新补丁版 | 需固定版本 runner |
| 并发写与多语句事务 | 只验证 `busy_timeout > 0` | 需压测设计 |
| 性能与压力 | 无基准 | 无需求提出 |

---

## 6. CI

### 6.1 六个 job

`.github/workflows/ci.yml`：

| job | 平台 | 内容 |
|---|---|---|
| `required (ubuntu-latest / node 22)` | Ubuntu | 环境信息 → doctor → config → layers → test → gate-selfcheck → smoke |
| `required (ubuntu-latest / node 24)` | Ubuntu | 同上 |
| `required (windows-latest / node 22)` | Windows | 同上 |
| `required (windows-latest / node 24)` | Windows | 同上 |
| `structure-selfcheck` | Windows | `tests/self/run.ps1`：必需文件、8 张角色卡、6 套 REA 工作流、8 份 manifest、项目名检查 |
| `g1-powershell` | Windows | `tests/git-review/run.ps1`：六个夹具真实执行 |

### 6.2 怎么判断 CI 真跑过

不要只看 `conclusion=success`。有两条硬证据：

1. **`g1` job 的耗时**。夹具被跳过时会在 1 秒内结束；真跑约 **27 秒**（六个夹具，其中 F5 是 BLOCKED、F6 是 PARTIAL，都是预期裁决）。
2. **`required` job 的日志里有 `GATE PASS tests=N`**，且 N 与本机一致。

### 6.3 已知的 CI 陷阱

| 陷阱 | 现象 | 规避 |
|---|---|---|
| `run:` 块里写中文 | Windows 上语法错误：GitHub 把 `run` 块写成 UTF-8 无 BOM，Windows 的旧 shell 按 ANSI 解析，中文会吃掉引号 | 步骤正文只用 ASCII |
| npm 全局目录布局不同 | Linux 是 `<prefix>/lib/node_modules`，Windows 是 `<prefix>/node_modules` | `ci-smoke.sh` 用双候选 + `find` 兜底 |
| 本地绿、CI 红 | 平台差异 | 本地绿不算数；以 CI 为准 |
| G1 在本地跑不起来 | 报「git 未找到」——`git` 不在 PATH | 设 `RDS_GIT` 指向 `git.exe`，或写进 `tooling/toolchain.local.json`。CI 的 windows-latest 自带 git，不受影响 |

### 6.4 本地跑两个 Windows 脚本

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/git-review/run.ps1   # G1 六夹具
powershell -NoProfile -ExecutionPolicy Bypass -File tests/self/run.ps1         # 母体系结构自检
```

G1 的 F2–F4 预期裁决是 `FAIL`、F5 是 `BLOCKED`、F6 是 `PARTIAL`：夹具 PASS 指「工具给出了预期裁决」，不是「一切正常」。整行 `RESULT: PASS` 才是通过。

---

## 7. 新增测试的要求

1. **必须能在干净克隆里跑**：不读工作区里未跟踪的文件，不依赖作者机器路径或会话。
2. **必须有断言**：`assert.ok(true)` 不算测试。
3. **不许 `skip`**：能力缺失就 `assert.fail` 并写明原因。
4. **隔离**：临时目录 + 合成数据；结束后清理。
5. **命名**：`mars/tests/<域>/<主题>.test.js`，`test('B<批次> <主题>：<断言>' ...)`。
6. **改对外行为时，同时改基线**：见 [maintainer-guide.md](maintainer-guide.md) §7.2。

---

## 8. 相关文档

- 维护者指南（备份、发布、回滚）：[maintainer-guide.md](maintainer-guide.md)
- 分层规则与改动影响面：[PROJECT-MAP.md](PROJECT-MAP.md)
- 门禁的历史与取舍：[checks/productization/test-reliability-report.md](checks/productization/test-reliability-report.md)
