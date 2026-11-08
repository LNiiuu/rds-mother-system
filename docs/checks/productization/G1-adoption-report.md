# G1 整体入库验收报告

> 目标：把 WF5 Git 审查（G1）从"工作区未跟踪状态"变成"干净检出可独立运行、CI 真实执行"。
> 结论：**完成。** 六个夹具在干净检出与 GitHub Actions 中均真实执行并通过。

- 入库提交：**`a41c650`**（20 文件，+1811）
- CI 改造提交：**`376756f`**
- CI 运行：**run [42483559119](https://github.com/LNiiuu/rds-mother-system/actions/runs/42483559119)** @ `376756f` —— 6 个 job 全 success，其中 g1 步骤耗时 12 秒、注解数 0（即非跳过）

---

## 1. 入库文件清单（20）

### 1.1 策略与流程（2）

| 文件 | 作用 |
|---|---|
| `core/policies/git-review.md` | G1 的权限与操作边界 |
| `core/workflows/wf5-git-review.md` | WF5 工作流定义 |

### 1.2 模板与契约（3）

| 文件 | 作用 |
|---|---|
| `core/templates/git-authorization.json` | 审查授权文件格式（allowedPaths / deleteAllowed） |
| `core/templates/git-review-report.md` | 审查报告模板 |
| `core/templates/git-review-report.schema.json` | 报告 schema |

### 1.3 工具实现（10）

| 文件 | 作用 |
|---|---|
| `tooling/git-review/review.ps1` | 审查入口（status 模式，只读） |
| `tooling/git-review/lib/Git.ps1` | git 只读封装与摘要 |
| `tooling/git-review/lib/Scope.ps1` | 变更路径与授权范围比对 |
| `tooling/git-review/lib/Diff.ps1` | diff 解析 |
| `tooling/git-review/lib/Secret.ps1` | 秘密扫描 |
| `tooling/git-review/lib/Report.ps1` | 报告生成与结论聚合 |
| `tooling/git-review/rules/secret-rules.json` | 秘密规则 |
| `tooling/git-review/rules/path-deny.json` | 路径拒绝规则 |
| `tooling/git-review/rules/allowlist.json` | 白名单 |
| `tooling/git-review/README.md` | 使用说明 |

### 1.4 夹具与入口（3）

| 文件 | 作用 |
|---|---|
| `tests/git-review/run.ps1` | 六个夹具的运行入口 |
| `tests/git-review/fixtures/expected.json` | 期望值的唯一机器可读来源 |
| `tests/git-review/fixtures/README.md` | 夹具说明 |

### 1.5 证据说明与自检（2）

| 文件 | 作用 |
|---|---|
| `docs/checks/git-review/README.md` | 运行证据目录的约定（含"rollback 不纳入提交"） |
| `tests/self/run.ps1` | 补上此前未提交的 G1 实现检查块（19 文件清单 + 夹具数量/ID 断言） |

---

## 2. 明确排除的文件（附理由）

| 排除项 | 数量 | 理由 |
|---|---|---|
| `docs/checks/git-review/run-*/` | 36 | 审查运行产物；该目录 README 自述"运行输出不参与扫描"，且 9 个产物含本机绝对路径，入库会污染路径卫生基线 |
| `docs/checks/git-review/rollback/` | 2 | 回滚快照；目录 README 明确写"**不自动纳入提交**，仅作为本机回滚依据" |
| `core/templates/role-packet.md`、`core/templates/run-record.json` | 2 | 属 M4（render-role）模板，由 `tooling/agent-runtime/rds-render-role.ps1` 消费，与 G1 无关 |
| `docs/history/`、`docs/analysis/`、`docs/runs/`、`tooling/agent-runtime/` | 20 | 开工前既有材料，与本轮无关 |

> 这四类仍留在工作区，未提交、未删除、未修改。

---

## 3. 路径解析（三段链）

G1 的工具链原本硬编码 `D:\Tools\Git\bin\git.exe`（不在 PATH）与 `D:\M1`。入库前已修复：

```
1. RDS_GIT 环境变量
2. Get-Command git                    # CI / 常规安装
3. tooling/toolchain.local.json       # 本机配置，gitignored
4. 抛错并给出可执行指引
```

`tests/git-review/run.ps1` 与 `tooling/git-review/review.ps1` 的 `$Repo` 默认值改为脚本位置推导，`RDS_HOME` 可覆盖。

修复本身另有补丁存档：`docs/checks/productization/g1-path-resolution.patch`（提交 `4d863dc`）。

---

## 4. 三档验证结果（严格区分）

### 4.1 本地开发工作区

```
tests/git-review/run.ps1 -> F1..F6 全 PASS，RESULT: PASS
```

### 4.2 干净检出（`git archive a41c650`，259 文件，与开发目录完全隔离）

| 检查 | 结果 |
|---|---|
| 19 个必需文件齐全 | **19/19** |
| 夹具清单（expected.json） | F1,F2,F3,F4,F5,F6 |
| 不设 `RDS_GIT` 时 | **exit 1**，报 `git 未找到：设置 RDS_GIT 环境变量，或在 tooling\toolchain.local.json 中配置…`（明确失败，非静默跳过） |
| 设 `RDS_GIT` 后 | **exit 0**，六夹具全 PASS |

逐项结果：

| 夹具 | 场景 | 期望 | 实跑 |
|---|---|---|---|
| F1 | 干净仓库无变更 | PASS / exit 0 | PASS |
| F2 | 变更路径超出 allowedPaths | FAIL / exit 3 / SCOPE-OUTSIDE | PASS |
| F3 | 未授权删除 | FAIL / exit 3 / DELETE-UNAUTHORIZED | PASS |
| F4 | 含 GitHub 形态令牌 | FAIL / exit 3 / SECRET-TOKEN-GITHUB | PASS |
| F5 | 未跟踪二进制（含 NUL） | BLOCKED / exit 2 / BINARY-LARGE | PASS |
| F6 | CRLF + 末尾空行 | PARTIAL / exit 1 / ENCODING-FORMAT | PASS |

同一干净检出中 `tests/self/run.ps1`：**103 项 PASS、0 FAIL、1 WARN**（历史记录含项目名），RESULT: PASS。

### 4.3 GitHub Actions（真实执行）

run 42483559119 @ `376756f`：

| Job | 结果 | 耗时 |
|---|---|---|
| required (windows / node 22) | success | 43s |
| required (windows / node 24) | success | 41s |
| required (ubuntu / node 22) | success | 11s |
| required (ubuntu / node 24) | success | 11s |
| structure self-check (windows) | success | 22s |
| **g1 (windows / powershell)** | **success** | **21s（其中"G1 六个夹具"步骤 12s）** |

判定「不是跳过」的依据：

1. workflow 里的 `Test-Path` + `SKIP` 分支已删除（提交 `376756f`）；
2. 该步骤耗时 12 秒——跳过只会在 1 秒内完成；
3. 该 check-run 的 **annotations 数量为 0**，此前的 `G1 SKIPPED` 警告不再出现。

---

## 5. 尚未验证

| 项 | 状态 | 说明 |
|---|---|---|
| CI 上的逐夹具明细文本 | **不可读** | 无 admin 权限，`/actions/jobs/{id}/logs` 返回 403。只能确认步骤成功 + 无注解。夹具失败会以非零退出让 job 变红，因此"绿"等价于"六项都通过" |
| macOS | NOT RUN | 无设备；G1 是 Windows PowerShell 实现，本就不在 macOS 矩阵内 |
| G2 / G3 能力 | 未实现 | 指纹绑定、文档事实核对、历史完整性检查属后续阶段 |

---

## 6. 对「假绿」的防护

G1 的 job 没有 `continue-on-error`；`tests/git-review/run.ps1` 任一夹具不符即以非零退出。
本次改造把此前的"显式跳过也算绿"彻底移除——现在 g1 绿 = 夹具真的比对过。
