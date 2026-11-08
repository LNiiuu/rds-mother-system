# RDS Git 审查工具（G1 / L0）

只读审查工具：核对变更是否在授权范围内、是否包含秘密/二进制/删除、完整记录暂存区与工作区摘要，并按 `core/templates/git-review-report.schema.json` 输出 JSON 报告。

## 用法

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\M1\tooling\git-review\review.ps1 `
  -Mode status -Task "<任务ID>" -Auth "<机读授权 JSON 路径>" -Repo "D:\M1" [-Out "<输出目录>"]
```

- `-Mode status`：G1 只读检查，不修改工作区、index、Git 历史与远端。
- `-Task`：必须与授权文件的 `taskId` 一致。
- `-Auth`：机读授权文件（模板见 `core/templates/git-authorization.json`），等级必须是 `L0`。
- `-Out`：输出目录，缺省为 `docs/checks/git-review/run-<时间戳>`。
- 退出码：PASS=0，PARTIAL=1，BLOCKED=2，FAIL=3，运行错误=4。

## 输出

| 文件 | 说明 |
| --- | --- |
| `review-report.json` | 机器可读报告（含 findings/checks 摘要与 schemaVersion） |
| `review-report.md` | 人读报告 |
| `diff.patch` | 审查覆盖的完整 diff 文本（含未跟踪文件全文） |
| `commands.log` | 本次运行使用的只读命令与输入路径 |

## 限制（G1 边界）

- 仅记录 HEAD、分支、暂存区摘要与工作区摘要；完整指纹绑定与独立复算属于 G2。
- 不执行文档事实核对、历史完整性检查（amend/rebase/reset）与远端核验。
- 不修改、不暂存、不提交、不推送；任何只读被破坏（HEAD/index/staged diff 变化）都会判 FAIL。
- 秘密扫描命中只输出掩码，不回显原值。
- `docs/checks/git-review/run-*`（审查产物）不参与扫描，避免自我审查噪声；G2 若需审查证据内容应显式纳入。
- `docs/checks/git-review/rollback/*`（回滚快照）只做秘密扫描、不做格式判定，因为快照按原始字节保留（含 BOM/CRLF）。
- PowerShell 5.1 脚本按约定使用 UTF-8 BOM：`ENCODING-BOM-REQUIRED` 记为 `info`，不触发 PARTIAL；其他 BOM/CRLF/EOF 空行记 `ENCODING-FORMAT`（low），触发 PARTIAL。

## 读取报告

报告 JSON/Markdown/diff 均以 UTF-8（无 BOM）写出。Windows PowerShell 5.1 下请用
`[System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)` 或 `Get-Content -Raw -Encoding UTF8` 读取；
不要用 `Get-Content -Raw` 的默认编码后再 `ConvertFrom-Json`，否则中文会按 ANSI 解码导致解析失败。

## 规则维护

- `rules/secret-rules.json`：秘密与个人数据规则（正则或熵）。
- `rules/path-deny.json`：禁止入库的路径模式。
- `rules/allowlist.json`：按路径豁免或按命中内容 SHA-256 放行；新增条目必须写明原因。

## 测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\M1\tests\git-review\run.ps1
```

固定夹具 F1–F6 的期望值见 `tests/git-review/fixtures/expected.json`。
