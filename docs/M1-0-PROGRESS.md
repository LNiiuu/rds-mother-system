# M1-0 进度账（T-M1-0）

- 任务：REA 核心能力建设、安装接入、实际运行与验收（单任务制 D-11）
- 依据：`M1-RDS母体系实施总任务书-v1.3.1.md` + m00567 / m00800 执行授权
- 开始：2026-11-01 20:37（+08:00）；最近更新：2026-11-01 22:00（本轮 AP-12 后续记录修正完成时间）
- 状态：**0A/0B/0C/0D 全部执行完毕**（PCAP 项按规则记 BLOCKED）；**首次本地 Git commit 已完成**（`fd48dd0`，90 文件，无 push）；等待用户审核

## 1. 子阶段状态

| 子阶段 | 状态 | 检查点 | 说明 |
|---|---|---|---|
| 0A 只读基线 | ✅ 完成 | CP-0A | `rea/baseline/audit-20261101.md`；`docs/checks/m1a-checkpoint-01.md`、`m1a-checkpoint-02.md` |
| 0B 缺口补齐 | ✅ 完成（PCAP BLOCKED） | CP-0B | JADX L3、Frida L2、Ghidra L3；PCAP 工具就绪但路径被策略拒绝 |
| 0C 六套工作流 | ✅ 完成（W-05 BLOCKED） | CP-0C | 六套工作流已建立；W-01/02/03/04/06 实际运行，W-05 失败分支留证 |
| 0D 回归验收 | ✅ 完成（JADX 重复验证 PARTIAL） | CP-0D | 重复验证、证据抽查 3 链、回滚演练 3 项；JADX 重复调用两次均超时（120 s），重复稳定性记 **PARTIAL**；移除/恢复 `REA_JADX_MCP_JAR` 后 provider_missing → available 证据保留；首次 JADX 能力验证 **L3 PASS 不变** |

## 2. 能力矩阵（实测）

| 能力域 | 工具/provider | 等级 | 状态 | 证据 |
|---|---|---|---|---|
| APK 静态分析 | JADX 0.7.1（REA android-provider） | **L3** | PASS | EV-20261101-001；ev_961eabd9 / ev_d3df6777 / ev_332e8c33 / ev_d4ca2cbd |
| 运行时插桩 | Frida 17.23.2 binding（REA） | **L2** | PASS（无真机） | EV-20261101-002；session f0e29afd |
| 原生逆向 | Ghidra 12.1.4（REA） | **L3** | PASS | EV-20261101-006；ev_03d7cecd / ev_ffb39ea3 / ev_bfedff4d |
| 代码理解/依赖 | 源码只读分析 | — | PASS（W-01） | EV-20261101-004 |
| 调用链/根因 | REA procedure_callees | — | PASS（W-04） | ev_cffc77ad / ev_ceaf269d |
| 流量分析 | TShark 4.2.2（WSL） | — | **BLOCKED** | EV-20261101-005；ev_6cd029af |
| Android 设备 | adb 37.0.1 | L1/L2 | provider available；无真机未验证 | 0A 审计 |

## 3. 六套工作流状态

| 工作流 | 状态 | 证据 |
|---|---|---|
| W-01 代码理解/依赖 | PASS（E1） | EV-20261101-004 |
| W-02 原生静态 | PASS（E1） | EV-20261101-006 |
| W-03 APK 静态 | PASS（E1） | EV-20261101-001 + ev_623e82f9 |
| W-04 调用链 | PASS（E1） | ev_cffc77ad / ev_ceaf269d |
| W-05 流量 | BLOCKED | EV-20261101-005 |
| W-06 动态插桩 | PASS（L2） | EV-20261101-002 + ev_6c332868 / ev_f3d78be7 |

## 4. 变更清单（本轮累计）

1. REA 注册条目 env 增加 `REA_JADX_MCP_JAR`，`WSLENV` 追加对应项；进程重建（`started_at 2026-11-01T12:52:11.166Z`；回滚演练期间曾重建一次，`13:14:46Z`）。
2. WSL 部署 JADX JAR：`/home/LNiiuu/rea-tools/jadx-headless-mcp-0.7.1-all.jar`（SHA-256 `6e5eacf5…`）。
3. 部署 Frida binding：`C:\Users\liuch\.dsh\frida_binding.node`（112,775,824 B，SHA-256 `5B2DB5AE…`）。
4. 公开 APK 样本：`/home/LNiiuu/rea-samples/UnCrackable-Level1.apk`（SHA-256 `1da8bf57…`）。
5. 新增六套工作流与证据文件（见交付清单）。
6. 未改：DSH Profile、REA 版本、权限策略、PCAP 拦截策略。
7. Git：已完成首次本地 commit（`fd48dd0`，90 文件，2,414 insertions；无 push、无 origin）；证据见 `docs/checks/AP-12-first-commit-executed.md`。

## 5. 阻塞 / 待审批

| 编号 | 事项 | 状态 | 说明 |
|---|---|---|---|
| B-01 | PCAP 被 `secret.ext.pcap` 拦截 | 待批 | AUTH-04 受控路径或策略审批；影响 W-05、PCAP 样本 |
| B-05 | Git 身份（AP-12） | ✅ 已解除 | 用户确认身份；首次本地 commit 已执行 `fd48dd0` |
| B-06 | GitHub 认证 / AUTH-07 / AP-15 | 待批 | 用户本机配置 + 首次 push 单独审批；远程备份 |

## 6. 下一步

1. 等待用户审核 0B/0C/0D 分类报告与首次提交记录。
2. 进入 M1-A 收尾：A-07 远程接入准备（只读核验 + 受控本地配置，不含 push），B-05 已解除、B-06（GitHub 认证 / AUTH-07 / AP-15）仍需单独审批。
3. W-05 在 AUTH-04 获批后补跑正常分支。

## 7. 首次本地提交

| 项 | 值 |
|---|---|
| commit | `fd48dd05ace498f47b987bc8b4f630551a573235`（short `fd48dd0`） |
| tree | `d22fd289871b024415b3655f5a23451626f16122` |
| parents | 无（root commit） |
| message | `chore: 初始化 RDS 母体系 M1 基线（M1-0 完成）` |
| author | `LNiiuu <liuchuanyu07@outlook.com>` |
| 时间 | 2026-11-01 21:45:11 +0800 |
| 统计 | 90 files changed, 2,414 insertions(+) |
| 提交后状态 | 工作区干净；HEAD 指向该 commit；remote 为空 |
| 证据 | `docs/checks/AP-12-first-commit-executed.md` |
