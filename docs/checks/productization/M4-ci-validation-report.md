# M4 CI 实证报告

**状态**：**NOT RUN**（写本文时 M4 尚未提交推送；写完后再推送触发，结果回填于文末 §5）

---

## 1. 工作流

`.github/workflows/ci.yml`，`push` 到 `main` 触发（Tag 推送不触发：`on.push.branches` 限定）。

| Job | 内容 |
|---|---|
| `required (windows-latest / node 22.x)` | 环境信息 → doctor → 配置校验 → **分层检查** → **Required 门禁** → 门禁反向验证 → 发行包端到端 |
| `required (windows-latest / node 24.x)` | 同上 |
| `required (ubuntu-latest / node 22.x)` | 同上 |
| `required (ubuntu-latest / node 24.x)` | 同上 |
| `structure self-check (windows-latest)` | `tests/self/run.ps1`（PowerShell 结构自检） |
| `g1 (windows-latest / powershell)` | G1 六夹具（真实执行） |

M4 未改 workflow 文件；新增的六类测试自动被 `mars/tests/**/*.test.js` 的 glob 覆盖。

---

## 2. 本地等价验证（作为 CI 的前置证据）

| 步骤 | 本地结果 |
|---|---|
| `node bin/rds.mjs doctor` | `status: ok（fail=0 warn=1 checks=10）` |
| `npm run config` | `CONFIG PASS` |
| `npm run layers` | `LAYERS PASS problems=0 warnings=2` |
| `npm test` | `GATE PASS tests=173 pass=173 fail=0 skipped=0` |
| `npm run test:gate-selfcheck` | 4/4（注入 fail / skip / 空集都必须变红） |
| `bash tooling/ci-smoke.sh` | `PACK PASS` + `SMOKE PASS` |
| `npm run baseline -- --check` | `BASELINE PASS` |

**本地等价 ≠ CI**：本地只验证了 Windows × Node 22.22.2。Ubuntu 与 Node 24 的行为差异
（进程启动开销、`npm` 全局目录布局、行尾、路径分隔符）只有真跑才知道。

---

## 3. 已知的 CI 相关风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| Node 24 上新增测试的行为 | 所有新测试只用 `node:test` / `node:sqlite` / `node:zlib`，无版本特定 API | 本地 Node 24 未跑 M4 新增用例（仅 M2.1 时跑过全量） |
| Ubuntu 上 `vm.Script` 解析 `.js` | 纯语法解析，与平台无关 | — |
| Ubuntu 上 spawn 子进程路径 | 测试全部用 `path.join(__dirname, …)`，无手写分隔符 | 静态检查：`doctor` 的 `paths:code` 已扫描 135 个文件无本机绝对路径 |
| `chcp`/编码 | PowerShell 步骤正文为纯 ASCII（M2.1 教训） | 未改 workflow |

---

## 4. 不能做的事

`GET /repos/{owner}/{repo}/actions/jobs/{id}/logs` 需要仓库 admin 权限，匿名访问返回 **403**。
因此本报告只能给出**结论级**证据（job/step 的 `conclusion`、耗时、注解数），
不给出逐行日志。凡涉及"某一行输出是什么"的判断，都在本地复现过。

---

## 5. 真实运行结果

**待回填**：M4 推送后由 run 结果填入（含 run 链接、commit SHA、六个 job 的结论与耗时）。

| Job | 结论 | 耗时 |
|---|---|---|
| required (windows / node 22) | 待填 | — |
| required (windows / node 24) | 待填 | — |
| required (ubuntu / node 22) | 待填 | — |
| required (ubuntu / node 24) | 待填 | — |
| structure self-check | 待填 | — |
| g1 | 待填 | — |

> 在回填之前，**本文件不构成"CI 通过"的证据**。
