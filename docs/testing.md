# 测试体系与门禁

> 适用版本：0.1.0（M2）。本文说明测试怎么分类、怎么运行、门禁判据是什么，以及为什么不接受 `skip`。

---

## 1. 三类测试

| 类别 | 定义 | 是否进 CI 门禁 | 当前位置 |
|---|---|---|---|
| **Required** | 不依赖真实用户数据、不依赖开发者本机状态；任何失败都必须让门禁变红 | 设计上覆盖 Windows + Ubuntu；**当前仅 Windows 实跑**（CI 未执行） | `mars/tests/**/*.test.js` |
| **Integration** | 验证多个模块之间的真实交互（CLI 子进程、SQLite 文件、MCP 握手），但仍用临时目录与合成数据 | 是（包含在 Required 通配里，但需自建隔离环境） | 同上（如 `phase1/mcp-server.test.js`、`phase1/ledger-reconcile.test.js` 的 CLI 用例） |
| **External** | 依赖本机外部环境：真实 DSH 会话、真实客户端、真实设备 | **否** | `mars/tests/external/*.external.js` |

External 测试的文件名刻意**不以 `.test.js` 结尾**，因此不会被 Required 通配匹配。这不是偷懒，而是为了让"哪些断言依赖外部环境"变成可枚举的事实。

---

## 2. 常用命令

```bash
npm test                    # Required 门禁（tests>0 且 fail=0 且 skipped=0）
npm run test:raw            # 直接看 node --test 原始输出
npm run test:gate-selfcheck # 门禁自身的反向验证（注入 fail / skip / 空集）
npm run test:external       # External 测试（需要 RDS_IT_DSH_SESSION）
npm run verify              # doctor + 配置校验 + 门禁
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

### 反向验证

`npm run test:gate-selfcheck` 会在临时目录造四组最小用例集，分别断言门禁的退出码：

| 场景 | 期望 |
|---|---|
| 全部通过 | exit 0 |
| 一个失败 | exit 1 |
| 一个跳过 | exit 1 |
| 没有用例 | exit 1 |

如果门禁被改成"永远返回 0"，这条检查会立刻变红。

---

## 4. Fixture 约定

- 合成样本生成器：`mars/tests/fixtures/ledger/make-session.js`
  - 构造多帧 zstd 会话；数值固定（input=2000 / output=500 / cacheRead=2500 / cacheWrite=0 / total=5000）；
  - 期望统计由 `expectedTotals()` 独立计算，不复用 `src/ledger.js` 的累加逻辑；
  - 不读取、不复制任何真实会话内容。
- 所有临时数据写入 `fs.mkdtempSync(os.tmpdir(), ...)`，用例结束即删。
- 需要外部能力的用例（zstd 压缩、目录符号链接）**不允许 skip**：能力缺失即失败，并给出 `FIXTURE_UNAVAILABLE` / `SECURITY_TEST_UNAVAILABLE` 前缀的原因。

### 历史依赖是怎么去掉的

| 原问题 | 位置（修复前） | 处理 |
|---|---|---|
| 硬编码作者会话路径与固定总量 41,597,577 | `phase1/ledger-reconcile.test.js` | 改为合成 fixture；真实会话核对移到 External |
| 用 `DSH.exe` 当 Node 运行时 | `phase2/wp1.test.js:19` | 改为 `process.execPath`，可用 `RDS_NODE_BIN` 覆盖 |
| 硬编码 `powershell.exe` 与 `D:\M1` | `phase1/rollback-offline.test.js` | 回滚逻辑下沉到 `mars/scripts/mars-rollback.js`，PS 脚本改为转调 |
| 缺能力就 `t.skip` | `ledger/ledger.test.js`、`phase1/lifecycle.test.js` | 改为 `assert.fail` 并写明原因 |

---

## 5. 覆盖范围声明

Required 测试验证的是**引擎行为**：存储与治理、鉴权与越界、检索、上下文编译、账本解析与导出、MCP 协议、回滚安全、离线姿态。

**不覆盖**：真实 DSH 客户端联调、真实设备上的 Frida/pcap、macOS 实机、性能与压力。这些要么属于 External，要么是路线图 M3/M5 的范围。
