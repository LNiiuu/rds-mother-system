# M4 CI 实证报告

**状态**：**PASS**（四组矩阵 + structure self-check + g1 共 6 个 job 全 success）

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

Run：[42583081805](https://github.com/LNiiuu/rds-mother-system/actions/runs/42583081805) @ commit `d7cba45`
结论：**6/6 job success，首轮即全绿，未出现需要修复的失败。**

| Job | 结论 | 耗时 |
|---|---|---|
| required (windows-latest / node 22.x) | **success** | 89s |
| required (windows-latest / node 24.x) | **success** | 57s |
| required (ubuntu-latest / node 22.x) | **success** | 14s |
| required (ubuntu-latest / node 24.x) | **success** | 10s |
| structure self-check (windows-latest) | **success** | 18s |
| g1 (windows-latest) | **success** | 27s |

required job 的 7 个步骤在两平台全部 success（环境信息 → doctor → 配置校验 → 分层检查 →
Required 门禁 → 门禁反向验证 → 发行包端到端）。M4 新增的 45 例测试已包含在门禁内。

`g1` 的「G1 六个夹具」步骤 success，耗时 27s —— 跳过会在 1s 内结束，因此是真实执行。

**与上一次（M3）对比**：Windows required 从 48s/53s 增至 89s/57s，增量来自新增的
子进程测试（CLI 故障矩阵 12 例、身份脚本 4 例、备份脚本 2 例、MCP 握手 2 例）。
Ubuntu 仍为 10–14s。

### 证据强度的边界（同 M3 口径）

`/actions/jobs/{id}/logs` 需 admin 权限，匿名访问 403，因此**未逐行读取日志**。
判据为：job/step 结论 success + 步骤无 `if` 跳过 + 门禁强制 `tests>0 && fail=0 && skipped=0`
+ smoke 脚本 `set -euo pipefail` 且无早退分支。
