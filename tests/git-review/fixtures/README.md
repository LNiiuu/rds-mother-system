# tests/git-review/fixtures

本目录保存 G1 审查器的固定回归夹具说明。真实仓库在 `%TEMP%` 下动态创建，**不**把任何样本提交进母体系仓库。

| 夹具 | 场景 | 预期结论 | 预期规则 ID |
| --- | --- | --- | --- |
| F1 | 干净仓库，无任何变更 | PASS | 无 |
| F2 | 变更路径不在授权 allowedPaths 内 | FAIL | SCOPE-OUTSIDE |
| F3 | 删除文件但授权 deleteAllowed=false | FAIL | DELETE-UNAUTHORIZED |
| F4 | 文件含 GitHub 形态令牌 | FAIL | SECRET-TOKEN-GITHUB |
| F5 | 未跟踪二进制文件（含 NUL） | BLOCKED | BINARY-LARGE |
| F6 | 文本含 CRLF 与文件末尾空行 | PARTIAL | ENCODING-FORMAT |

约定：

- 每个夹具仓库都位于 `%TEMP%\rds-git-review-fixtures-<随机>\<夹具>`，与 `D:\M1` 完全隔离。
- 授权文件与输出目录放在夹具仓库之外，避免自身成为被审查变更。
- 期望值以 `expected.json` 为唯一机器可读来源；`tests/git-review/run.ps1` 逐项比对，任一不符即失败。
- 夹具只验证判定逻辑，不验证文档事实核对、历史完整性检查与远端操作（这些属于 G2/G3）。
