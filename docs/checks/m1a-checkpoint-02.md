# M1-A 检查点 02：0A 基线完成、0B 阻塞项

- 时间：2026-11-01 20:2x（+08:00）
- 依据：m00378 连续执行授权。

## 已完成
1. M1 骨架 66 文件、自检 PASS、git init（分支 main，无 commit）、ZIP 备份（42,939 B，SHA-256 BAF48014…）。
2. 0A REA 基线审计：见 `D:/M1/rea/baseline/audit-20261101.md`。
3. 0B 缺口定位：JADX jar 缺失、Frida 绑定缺失且无 root、PCAP 被 cc-safety-net 拦截。

## 阻塞与审批请求
| 编号 | 事项 | 需要 |
|---|---|---|
| B-01 | PCAP agent 侧拦截（rule secret.ext.pcap） | AUTH-04 策略审批或受控路径 |
| B-02 | JADX jar 来源（第三方 jadx-headless-mcp 0.7.1） | 批准来源/下载；随后 mcp 注册+重启 |
| B-03 | Frida 绑定安装（rea-agents 归 root，sudo 无密码） | 用户密码执行，或批准写 ~/.dsh/frida_binding.node 后重启 REA |
| B-04 | 真实 APK/PCAP 样本 | 批准下载公开样本或提供本地样本 |
| B-05 | Git 身份（AP-12） | 用户确认 name/email |
| B-06 | GitHub 凭据/AUTH-07/AP-15 | 用户本机配置 + 单独批准首次 push |

## 未变基线
- Git：无 commit；`status --porcelain` 仍为未跟踪骨架。
- 未改 Profile/MCP/REA/权限策略；未访问 旧项目（名称不入库）；未触碰业务代码。
