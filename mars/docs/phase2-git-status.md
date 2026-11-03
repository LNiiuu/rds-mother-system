# Phase 2 · Git 状态与变更清单（MARS 接入后）

> 记录时间：2026-11-03 20:5x（Phase 2 收尾）
> 范围：`D:\M1`（唯一改动仓库）；`D:\Projects\xingrixiao` 与旧项目均未改动。
> 重要：本轮**未 commit、未 push**，MARS 相关文件全部为未跟踪状态，等待用户检查后另行授权。

## 1. 仓库基线

| 项 | 值 |
|---|---|
| 仓库 | `D:\M1` |
| 分支 | `main` |
| HEAD | `07f0a1e03cc9425c5ab4092f15e6778264b7b523`（`docs: 补全 M1-0 首次提交审查与执行记录`） |
| upstream | `origin/main`（本地与远端同点，无 ahead/behind） |
| mars 已跟踪文件 | **0**（`git ls-files mars` 为空） |
| mars 相关提交 | **0**（`git log --all -- mars` 为空） |

## 2. 工作区状态

`git status --porcelain -uall` 共 **138 行**：

- `?? mars/...`：**67 个** Phase 1/2 新增文件（全部未跟踪，未暂存）。
- 非 mars：**71 行** = 70 个 Phase 0 既有未跟踪文件 + 1 个已跟踪修改 `tests/self/run.ps1`（G1 遗留，非本任务产生，本轮未触碰）。
- 暂存区：**0**；未执行 `git add`。

## 3. 变更清单（按模块）

| 目录 | 内容 |
|---|---|
| `mars/src/` | `mcp-stdio.js`（Phase 2 新增 MCP stdio 网关）、`store.js`/`retrieval.js`/`compiler.js`/`cli.js`/`validate.js`/`ledger.js`/`mcp.js` 等 |
| `mars/contracts/` | 5 个 JSON Schema（memory/manifest/context-packet/role-routing/ledger） |
| `mars/config/` | `role-routing.json`、`principals.example.json`（不含真实 token） |
| `mars/scripts/` | `mars-issue-mcp-identity.js`、`seed-phase2.js`、`phase2-g1-verify.js`、`mars-mcp-disable.ps1`、`mars-baseline.ps1`、`mars-rollback.ps1`、`mars-install.ps1` |
| `mars/tests/` | ledger/mcp/phase1/phase2 共 12 个测试文件，61 用例 |
| `mars/docs/` | Phase 1 验收/审查/测试报告/token 基线 + Phase 2 接入说明、G1 安全报告、G2/G3/G4 记录、两轮 R4 审查 |
| `mars/` 根 | `README.md`、`.gitignore` |

## 4. 运行时产物（不进入版本管理）

- `mars/var/`（`mars.db`、`mcp/tokens/*.token`、`ab-*.txt`、`baseline-now.json`）→ 被 `mars/.gitignore:2:var/` 忽略。
- `mars/config/principals.json`（只存 `token_sha256`）→ 被 `mars/.gitignore:5:config/principals.json` 忽略。
- 已知遗留：`mars/var/mcp/tokens/UNKNOWN.token`（37 B，harness 负例探测产物，位于被忽略目录内，**未删除**，仅记录）。

## 5. 敏感信息核对

- 仓库内无 token 明文、无 `.env`、无私钥；token 文件与 principals.json 均被忽略。
- 报告与文档只出现 token 文件路径、角色名、`token_sha256` 机制说明；未出现 token 值。
- `D:\Projects\xingrixiao`：本机 Windows Git 判定为 clean（0 行）；R4 用 WSL git 观察到 17 个既存 CRLF 差异文件（`docs/design/*`、`docs/dev/a1/*`），两者差异来自 autocrlf 口径，**均无 MARS 内容**（`git diff | grep -i mars` 为 0）。

## 6. 回滚方式（不涉及 Git 历史）

1. 关闭 MCP：`scripts/mars-mcp-disable.ps1 -Yes`（先备份 registry.json）。
2. 删除 MARS 运行时：`scripts/mars-rollback.ps1 -Repo D:\M1 -Yes`（仅 `mars/var/` 与可选 principals）。
3. 删除 MARS 代码/文档：MARS 全部为未跟踪文件，经用户确认后可直接移除 `mars/` 目录（本轮不执行）。
4. 不触碰 70 个 Phase 0 未跟踪文件与 `tests/self/run.ps1` 的既有修改。
