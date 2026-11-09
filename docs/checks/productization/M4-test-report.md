# M4 测试报告

**口径**：本文只写实际跑过的结果。PASS / FAIL / WARN / SKIP / NOT RUN 严格区分。

---

## 1. 总量

| 项 | M4 开工 | M4 结束 |
|---|---|---|
| Required 测试 | 128 | **173** |
| fail | 0 | **0** |
| skipped | 0 | **0** |
| 测试文件 | 25 | 31 |

```
$ npm test
GATE PASS  tests=173 pass=173 fail=0 skipped=0
```

门禁判据（`tooling/test-gate.mjs`）：`tests > 0 && fail === 0 && skipped === 0`，
且计数自洽（`pass+fail+skipped+todo+cancelled === tests`）。
"零用例"与"全 skip"都会让它变红 —— 这两种假绿在本项目真实发生过。

---

## 2. 逐批增量

| 批次 | 新增用例 | 覆盖 |
|---|---|---|
| B0 | 0（+169 行审计文档） | — |
| B1 | +8 | 契约一致性：五契约可取出 / 聚合输出合规 / 单条会话合规 / 非法 source_kind 被拒 / 缺必需字段被拒 / 注册表与契约对齐 / H-05 回归守卫 / 真实 zstd 端到端 |
| B2 | +8 | 脚本解析守卫（`.js` 用 `vm.Script`、`.mjs` 用 `node --check`）/ 扫描有效性 / seed 不得复现 / 身份脚本 4 例（未知 flag、未知角色、损坏 principals 不改写、`--help`） |
| B3 | +9 | 损坏库错误码 / 更新库被拒且字节不变 / 旧库迁移补列 / 重复打开幂等 / `busy_timeout>0` / 审计失败计数 / 无失败计数为 0 / 备份快照可回读 / 备份脚本拒未知参数 |
| B4 | +8 | 版本：VERSION≡package.json / `version.js` 唯一来源 / **真实 MCP 握手** serverInfo / engines≥22.15；配置：三档优先级 / RDS_HOME / doctor 同源 / 6 个域模块零 `process.env` |
| B5 | +10 | 故障矩阵八项 + 未知命令 + `ledger --help`；每条断言退出码、错误码文本、"不是栈" |
| B6 | +2 | MCP 缺 principals 时降级启动 + 每次调用 AUTH_DENIED |

合计 +45（128 → 173）。

---

## 3. 测试分类（沿用 M2 的三分法）

| 类别 | 数量 | CI 是否执行 | 说明 |
|---|---|---|---|
| **Required** | 173 | 是 | `mars/tests/**/*.test.js`，不依赖真实用户数据/本机状态 |
| **External** | 1 | **否** | `mars/tests/external/dsh-real-session.external.js`，需显式 `RDS_IT_DSH_SESSION` |
| Integration | 0（独立分类） | — | 跨模块交互已并入 Required（MCP 握手、CLI 子进程、备份脚本都是真进程） |

External 测试不混入 Required：`npm run test:external` 单独跑，缺环境时明确报错而不是 skip。

---

## 4. 静态检查（每次门禁都跑）

| 检查 | 命令 | 结果 |
|---|---|---|
| 分层与循环依赖 | `npm run layers` | `problems=0 warnings=2`（2 条为永久边界声明） |
| 配置/JSON/YAML | `npm run config` | `CONFIG PASS` |
| 对外行为基线（7 面） | `npm run baseline` | `BASELINE PASS`（仅登记过的增项） |
| 环境自检 | `rds doctor` | `status: ok（fail=0 warn=1）`，warn 为历史文档本机路径（M5） |
| 发行包内容 | `pack-check`（随 smoke） | `PACK PASS`，禁止项 0 命中 |
| 发行包端到端 | `bash tooling/ci-smoke.sh` | `SMOKE PASS`（打包→检查→安装→doctor→init→写入→审批→检索→编译） |

---

## 5. 契约测试的"确实会触发"证据

契约测试容易写成"永远通过"（校验函数没被调用也看不出来）。为此做了两次反向验证：

1. 把 `sessions.items.required` 临时塞入不存在的字段 →
   `ERROR LEDGER_CONTRACT_INVALID $: missing required property "nonexistent_field"`（随后还原，哈希回到 `4088f715…`）
2. 塞一个语法损坏的脚本 `const x = ;` 到 `mars/scripts/` →
   `mars/scripts/_probe_broken.js: Unexpected token ';'`，该用例红；删除后恢复 8/8

---

## 6. 没有覆盖的地方（如实列出）

| 项 | 状态 | 原因 |
|---|---|---|
| 多语句事务回滚 | **NOT TESTED** | 现有代码没有显式 `BEGIN/COMMIT`；如将来引入需补测试 |
| 并发写同一库（真实竞争） | **NOT TESTED** | 只验证了 `busy_timeout>0`，没有构造两进程同时写 |
| 精确 Node 22.15 边界 | **NOT RUN** | CI 跑 22.x 最新补丁；22.15 的依据是 Node 文档 + 运行时探测（doctor 的 `zlib:zstd`） |
| macOS | **NOT RUN** | 无设备，CI 矩阵未含 |
| 真实 DSH 注册表写入 | **NOT RUN** | 只允许隔离目录；真实写入会改外部产品状态 |
| 一次性开发脚本（`phase4-*` 等） | **NOT TESTED** | 流程产物，非产品能力（S4） |
