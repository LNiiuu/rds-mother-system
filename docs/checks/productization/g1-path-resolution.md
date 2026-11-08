# G1 / WF5 路径解析修复（归档说明）

> 对应补丁：`g1-path-resolution.patch`
> 关联：M1-4「路径参数化」、`doctor` 的 `paths:code` 门禁

## 为什么单独归档而不是直接提交文件

`tests/git-review/**`、`tooling/git-review/**`、`core/policies/git-review.md` 等 20 个文件
是 M1 开工前就存在的**未跟踪工作**（WF5 Git 审查工作流），不属于本轮 M1/M2 的范围。

如果为了修 3 行路径而提交这 3 个文件：

- 会把一套 20 文件的工作流切成碎片（被提交的 3 个文件引用了未提交的 `lib/Diff.ps1` 等）；
- 违反「不得将无关的原有未提交变更混入本轮提交」。

所以选择：**文件保留在工作区（修复已生效），修复内容以补丁归档**。
等 G1 整体提交时，这份补丁可用于复核修复是否一致。

## 修了什么

| 文件 | 原值 | 现值 |
|---|---|---|
| `tests/git-review/run.ps1` | `$Repo = 'D:\M1'`；`$git = 'D:\Tools\Git\bin\git.exe'` | 脚本位置推导 + `RDS_HOME` 覆盖；git 走三段解析 |
| `tooling/git-review/review.ps1` | `$Repo = 'D:\M1'` | 同上（仅 Repo） |
| `tooling/git-review/lib/Git.ps1` | `$script:RdsGitExe = 'D:\Tools\Git\bin\git.exe'` | `RDS_GIT` → `Get-Command git` → `tooling/toolchain.local.json` |

## git 解析链（三处共用）

```
1. $env:RDS_GIT
2. Get-Command git          # 正常安装、PATH 可见
3. tooling/toolchain.local.json   # 本机配置，已被 .gitignore 排除
4. 抛错并给出可执行指引
```

第 3 段是必需的：本机上 git 只存在于 `D:\Tools\Git\bin\git.exe`，**不在 PATH**，
只用 `Get-Command` 会让 G1 测试与 `tooling/sync.ps1` 直接失效（已实测）。

## 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/git-review/run.ps1
# F1..F6 全 PASS，RESULT: PASS
```

补丁本身的可应用性也验证过：在「仅含 G1 原始文件」的临时仓库上
`git apply --check` 通过，应用后 `RDS_GIT` 出现在预期位置。
