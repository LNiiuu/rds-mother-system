# M1-0 验收报告（T-M1-0）

- 时间：2026-11-01 21:47（+08:00）
- 依据：`M1-RDS母体系实施总任务书-v1.3.1.md` §13 + m00800
- 结论：**有条件通过**（PCAP 项 BLOCKED，其余 PASS/PARTIAL 已如实记录）

## 1. 验收项对照

| # | 验收项 | 标准 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | JADX 接入 | REA 实调 + 真实 APK 分析（L3） | ✅ PASS | EV-20261101-001；ev_961eabd9 / ev_d3df6777 / ev_332e8c33 / ev_d4ca2cbd |
| 2 | Frida 接入 | bindings 加载 + REA 实调（L2） | ✅ PASS | EV-20261101-002；ev_6c332868 / ev_f3d78be7 / ev_819119d2 |
| 3 | Ghidra 复验 | 真实二进制导入/分析/结果读取（L3） | ✅ PASS | EV-20261101-006；ev_03d7cecd / ev_ffb39ea3 / ev_bfedff4d |
| 4 | APK 样本 | 来源/许可/SHA-256/分析记录 | ✅ PASS | EV-20261101-003；SHA-256 `1da8bf57…`（OWASP MASTG 教学 crackme） |
| 5 | PCAP 样本 | 来源/许可/SHA-256/CLI 记录；REA 阻塞如实记录 | ⛔ BLOCKED | EV-20261101-005；`secret.ext.pcap` 拒绝，未绕过 |
| 6 | 六套工作流 | 建立并实际运行，失败分支留证 | ✅ PASS（W-05 BLOCKED） | 0C 检查点；W-01/02/03/04/06 运行记录 |
| 7 | 重复验证 | 至少复跑一次并对照 | ⚠️ PARTIAL | Ghidra/Frida 一致；JADX 重复调用 120 s 超时 |
| 8 | 证据抽查 | 独立角色抽查 ≥3 条链 | ✅ PASS | 0D 检查点：Ghidra/APK/Frida 三链 |
| 9 | 回滚演练 | 变更→验证→回滚→恢复 | ✅ PASS 3/3 | 0D 检查点：binding / 样本 / JADX env |
| 10 | 配置一致性 | 最终配置可解释、可回滚 | ✅ PASS | PROGRESS §4；未改 Profile/REA 版本/策略 |
| 11 | 母体系自检 | `tests/self/run.ps1` RESULT: PASS | ✅ PASS | 本轮收尾执行 |
| 12 | Git 纪律 | 无 commit、无 push；开场/收尾一致 | ✅ PASS | 开场/收尾 `status --porcelain` 10 行、HEAD unborn |

## 2. 判定说明

- JADX 重复验证 PARTIAL：同一会话内第二次全量解析超时（-32001，120 s），恢复重建后首次调用成功；属客户端/服务端时限，未擅自调参。不据此降低 L3（首次与恢复后均取得完整结构结果）。
- PCAP 为任务书唯一允许的 blocked 项：工具层 PASS、策略层 BLOCKED，未改名/换路径/压缩绕过。
- 真机、真实流量、GitHub 远程均未验证，不写入通过项。

## 3. 与任务书偏差

| 项 | 偏差 | 处理 |
|---|---|---|
| JADX 重复调用 | 超时 | 记录 PARTIAL，待后续评估时限参数（需授权） |
| Frida attach | `/proc/<pid>/mem` 权限拒绝 | 改 spawn 模式完成 L2；attach 约束如实记录 |
| PCAP | 策略拒绝 | BLOCKED，等 AUTH-04 |
