# M1-0B 检查点：JADX / Frida / 样本

- 时间：2026-11-01 21:10（+08:00）
- 任务：T-M1-0 / 0B（B-02 + B-03 + B-04 合并执行，m00567 授权）
- 依据：`M1-RDS母体系实施总任务书-v1.3.1.md`

## 1. 结论表

| 编号 | 事项 | 结论 | 等级 | 证据 |
|---|---|---|---|---|
| B-02 | JADX 接入 + 真实 APK 分析 | **PASS** | L3 | EV-20261101-001 |
| B-03 | Frida bindings + REA 实调 | **PASS** | L2（无真机注入） | EV-20261101-002 |
| B-04 | APK 样本登记 | **PASS** | — | EV-20261101-003 |
| B-04 | PCAP 样本 | **BLOCKED** | — | EV-20261101-003（`secret.ext.pcap`，未绕过） |

判定说明：
- JADX：REA 实际返回包信息、类清单、类结构与 `verify` 方法 Java 源码，非仅“provider available”。
- Frida：REA 实际加载 binding 并枚举出 local/socket/barebone 设备，`cleanup_error=null`；未连接真机，故不称 L3。
- PCAP：策略拦截属安全边界，未改名/换路径/压缩/改策略；等待 AUTH-04。

## 2. 配置与回滚

| 变更 | 位置 | 回滚 |
|---|---|---|
| `REA_JADX_MCP_JAR` env + WSLENV 项 | `~/.dsh/skill-mcp-manager/registry.json`（经 mcp_register） | 移除后重建进程 |
| JADX JAR | `/home/LNiiuu/rea-tools/jadx-headless-mcp-0.7.1-all.jar` | 删除文件 |
| Frida binding | `C:\Users\liuch\.dsh\frida_binding.node` | 删除文件 |
| APK 样本 | `/home/LNiiuu/rea-samples/UnCrackable-Level1.apk` | 删除文件 |

## 3. 未变项

- DSH Profile、REA 版本（6.8.0）、权限策略、PCAP 策略：均未修改。
- Git：无 commit、无 push；`D:\M1` 仅新增文档与清单。
- 未访问旧项目，未触碰业务代码/数据。

## 4. 下一步

1. Ghidra 真实二进制分析复验（0B 剩余）。
2. 0C：W-01…W-06 建立并运行（PCAP 记 blocked）。
3. 0D：回归、重复执行、证据复核、回滚演练。
