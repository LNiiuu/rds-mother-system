# M1-0 交付清单（T-M1-0）

- 依据：任务书 v1.3.1 + m00567 / m00800；单任务制，阶段交付统一登记在本文件。
- 最近更新：2026-11-01 21:47

## 1. 已交付

| # | 交付物 | 路径 | 状态 | 证据 |
|---|---|---|---|---|
| 1 | 母体系骨架 | `D:\M1\` | ✅ 完成 | 自检 PASS（`tests/self/run.ps1`） |
| 2 | Git 空仓库（main，无 commit） | `D:\M1\.git` | ✅ 完成（AP-12 待身份） | `symbolic-ref --short HEAD`=main |
| 3 | ZIP 离线备份 | `D:\M1-backups\rds-20261101-2011-v0.1.0.zip` | ✅ 完成 | 42,939 B，SHA-256 `BAF48014…` |
| 4 | 0A REA 基线审计 | `rea/baseline/audit-20261101.md` | ✅ 完成 | 0A 证据 |
| 5 | JADX 接入与真实 APK 分析 | `rea/evidence/EV-20261101-001-b02-jadx.md` | ✅ PASS（L3） | 4 条 REA evidence_id |
| 6 | Frida bindings 接入与实调 | `rea/evidence/EV-20261101-002-b03-frida.md` | ✅ PASS（L2） | `list_frida_devices` local/socket/barebone + 注入回传 |
| 7 | 测试样本登记 | `rea/evidence/EV-20261101-003-b04-samples.md` + `samples/index.md` | ✅ APK 完成；PCAP BLOCKED | 样本哈希 |
| 8 | 工具清单更新 | `tooling/manifest/jadx.json`、`frida.json` | ✅ 完成 | L3 / L2 |
| 9 | Ghidra 真实分析（W-02） | `rea/evidence/EV-20261101-006-w02-ghidra.md` | ✅ PASS（L3） | 198 函数/153 字符串；5 条 evidence_id |
| 10 | 六套 REA 工作流 | `core/workflows/w-01…w-06.md` | ✅ 建立 | 0C 检查点 |
| 11 | W-01 运行记录 | `rea/evidence/EV-20261101-004-w01-code-understanding.md` | ✅ PASS | 业务小程序只读依赖分析 |
| 12 | W-05 阻塞记录 | `rea/evidence/EV-20261101-005-w05-pcap.md` | ✅ BLOCKED 留证 | tshark/capinfos 4.2.2 就绪 |
| 13 | 0C/0D 检查点 | `docs/checks/m1-0c-checkpoint.md`、`m1-0d-checkpoint.md` | ✅ 完成 | 六工作流状态、重复验证、回滚演练 |
| 14 | 验收报告 | `docs/M1-0-ACCEPTANCE.md` | ✅ 完成 | 本文件 |
| 15 | 进度账 | `docs/M1-0-PROGRESS.md` | ✅ 更新 | — |

## 2. 未完成 / 阻塞

| # | 项 | 状态 | 原因 | 下一步 |
|---|---|---|---|---|
| 1 | PCAP 样本与 W-05 | BLOCKED | `secret.ext.pcap` 策略拦截，未绕过 | 等 AUTH-04 |
| 2 | adb 真机链路 | 未验证 | 无真机，不得宣称通过 | 有设备后补 |
| 3 | Git 首次 commit | 待批 | AP-12 身份未确认 | 等用户 |
| 4 | GitHub 远程 | 待批 | AUTH-07 / AP-15 | 等用户 |

## 3. 回滚索引

| 变更 | 回滚方式 |
|---|---|
| JADX env | 移除 `REA_JADX_MCP_JAR`（及 WSLENV 项）→ 重建 REA 进程 |
| Frida binding | 删除 `C:\Users\liuch\.dsh\frida_binding.node` → 重启 REA |
| JAR 文件 | 删除 `/home/LNiiuu/rea-tools/jadx-headless-mcp-0.7.1-all.jar` |
| 样本 | 删除 `/home/LNiiuu/rea-samples/UnCrackable-Level1.apk` |
| 六套工作流 | 删除 `core/workflows/w-0*.md`（不影响其他流程） |
