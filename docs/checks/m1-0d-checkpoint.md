# M1-0 0D 检查点：回归、重复验证、证据抽查与回滚演练

- 时间：2026-11-01 21:41（+08:00）

## 1. 重复验证（首二次对照）

| 链路 | 首次 | 第二次 | 结论 |
|---|---|---|---|
| Ghidra 分析 | 198 函数 / 153 字符串 / 9 段（ev_03d7cecd） | 同值（ev_4732ebfc） | PASS，结果一致 |
| Frida 设备 | local / socket / barebone | 同值，cleanup_error=null | PASS |
| JADX 包信息 | ev_961eabd9 成功 | 两次 120 s 超时（-32001） | PARTIAL：重复调用超时 |
| JADX 恢复 | — | 重启后 ev_b4f111ce 成功（parent ev_d9212404） | PASS（恢复验证） |
| APK 签名 | ev_623e82f9 | 回滚后再次成功（命中缓存） | PASS |

## 2. 回滚演练（变更→验证→回滚→恢复）

| 项 | 变更 | 验证 | 回滚 | 结果 |
|---|---|---|---|---|
| Frida binding | 文件改名 | 设备仍可列出（进程已加载） | 改名恢复，哈希一致 | PASS（结论：binding 变更需重启 REA 生效） |
| APK 样本登记 | 文件改名 `.drill-bak` | `inspect_apk_signature` 报 ENOENT | 恢复后哈希一致、签名检查成功 | PASS |
| JADX env | 移除 `REA_JADX_MCP_JAR` + 重建进程 | android-provider `provider_missing`，进程 started_at 13:14:46Z | 恢复 env + 重建进程，包信息调用成功 | PASS |

## 3. 证据抽查（R6，≥3 条链）

1. Ghidra 入口链：ev_03d7cecd → ev_ffb39ea3 → ev_bfedff4d，函数地址与伪代码可复现。
2. APK 链：ev_961eabd9 → ev_d3df6777 → ev_332e8c33 → ev_d4ca2cbd，包/类/方法一致。
3. Frida 链：session f0e29afd → script cfc9ea93 → 消息 pid 10312，状态与消息匹配。
- 抽查结论：3/3 成立，无“仅自我声明”的通过项。

## 4. 最终配置状态

- REA 注册：tier on-demand，229 tools，env 含 `REA_JADX_MCP_JAR` 与 `REA_ADB_PATH`，WSLENV 同步。
- JADX JAR：`/home/LNiiuu/rea-tools/jadx-headless-mcp-0.7.1-all.jar`（SHA-256 `6e5eacf5…`）。
- Frida binding：`C:\Users\liuch\.dsh\frida_binding.node`（SHA-256 `5B2DB5AE…`）。
- 未改：DSH Profile、REA 版本、权限策略、PCAP 拦截策略、Git（无 commit）。

## 5. 遗留

- JADX 重复调用超时（120 s，客户端/服务端限制）未调参：按任务书不得擅自改 REA 参数之外的策略，记 PARTIAL。
- W-05 仍 BLOCKED（AUTH-04）。
