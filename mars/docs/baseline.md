# MARS Phase 1 — 开工基线核验（R0）

采集时间：2026-11-03 19:0x（+08）。只读采集，未改动 M1 既有文件。

## 1. 仓库与 Git

| 项 | 值 |
|---|---|
| M1 路径 | `D:\M1` |
| 分支 | `main` |
| HEAD | `07f0a1e03cc9425c5ab4092f15e6778264b7b523` |
| `status --porcelain -uall` | **71 行 = 70 未跟踪 + 1 已跟踪修改（`M tests/self/run.ps1`，G1 遗留改动，非本任务产生）** |
| 状态指纹 SHA-256 | `8159A7AD39C06318D9964467D567903359248CF078A28C2FA30F84F111D6C5FA`（对 status 行以 `\n` 连接后计算） |
| 未跟踪清单快照 | `%TEMP%\mars-p1-baseline\m1-status-before.txt`（3,874 B） |
| M1 文件总量 | 170 文件 / 38,660,346 B |

结论：Phase 0 基线 `07f0a1e` 仍适用；71 条记录（70 未跟踪 + 1 修改）与 Phase 0 快照逐行一致。本任务只新增 `mars/` 下文件，不修改/删除既有 71 条。

## 2. 星日晓仓库（只读确认，不进入）

| 项 | 值 |
|---|---|
| 路径 | `D:\Projects\xingrixiao` |
| HEAD | `d168ef117d76d048e03413040358d7bc796b7463` |
| 工作区 | 干净（`status --porcelain -uall` = 0） |

本任务不读写该仓库；仅在此记录状态。

## 3. DSH 配置指纹（只读）

| 项 | 值 |
|---|---|
| `C:\Users\liuch\.dsh\profiles\web\cordis.patch.yml` | sha256 前 16 = `4F40B39FEE41A692`（与 Phase 0 T0 一致） |
| `C:\Users\liuch\.dsh\skill-mcp-manager\registry.json` | 403,427 B（与 Phase 0 一致） |

本任务不修改 Profile / MCP / REA / 权限 / 插件；MCP 接入保持未启用。

## 4. Phase 0 输入

- 报告：`%TEMP%\mars-phase0\R0-MARS-P0-REPORT.md`（v1.1）。
- 独立审查：`%TEMP%\mars-phase0\R4-review.md`（判定 R1 部分可信 / R2 部分可信 / R3 基本可信；必修 4 项已在 v1.1 采纳）。
- 本任务据此选定 P0 范围：记忆契约、去重与清单、Token 账本、检索、上下文编译、预算、MCP 只读网关、安全与测试。

## 5. 拟新增文件（实施前清单）

（详细清单与所有权见 `docs/interfaces.md` §5 与最终报告；本文件在实施完成后回填实测清单与 diff 摘要。）

## 6. 基线变更处理

若发现 HEAD/71 条清单/星日晓/DSH 指纹变化：先报告差异并暂停相关操作，不覆盖未知变更。当前核验未发现变化。
