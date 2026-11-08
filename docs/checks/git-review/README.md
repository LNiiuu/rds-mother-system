# docs/checks/git-review

本目录保存 RDS Git 审查（WF5）的运行证据与回滚快照。

- `run-<时间戳>/`：每次审查的输出（`review-report.json`、`review-report.md`、`diff.patch`、`commands.log`）。
- `rollback/`：非破坏性回滚证据（实施前的文件副本与 SHA-256 清单），**不自动纳入提交**，仅作为本机回滚依据。

## 扫描范围与已知限制（G1）

1. **运行输出目录不参与扫描**：`docs/checks/git-review/run-*` 属于审查产物，后续审查会跳过它们，避免"审查报告审自己"的噪声。G2 若需要审查证据内容，应显式纳入并单独定规则。
2. **回滚快照不参与格式检查**：`docs/checks/git-review/rollback/*` 按原始字节保存（含原文件的 BOM/CRLF），因此只做秘密扫描，不做 BOM/CRLF/EOF 格式判定；否则会把它标记为"待修复的格式问题"，与其"保留原样"的目的冲突。
3. **G1 不做**：完整指纹绑定与独立复算、文档事实核对、历史完整性检查（amend/rebase/reset）、远端核验；这些属于 G2/G3。
4. **G1 结论**：PASS / PARTIAL / BLOCKED / FAIL 由发现聚合得出（FAIL > BLOCKED > PARTIAL > PASS），工具不得提升结论。

## 纪律

1. 运行证据只追加，不修改历史运行目录。
2. `rollback/` 中的副本是实施前原始内容，不得用其覆盖他人并行修改过的文件。
3. 审查报告中的结论不得由自动化工具提升；PARTIAL/BLOCKED/FAIL 必须保留。
4. 本目录不存放凭据、Token、私钥或真实样本。
