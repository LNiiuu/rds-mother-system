# M23 最终验收

**判定**：**`PARTIAL`**
**真实新增**：TShark 4.6.9 真实执行 W-05；Java 21 可用。
**阻断**：Ghidra 未安装、JADX 下载不完整、无授权 APK、无 Frida 设备。

| 编号 | 工作流 | 状态 | 依据 |
|---|---|---|---|
| T23-01 | W-01 代码理解 | **PARTIAL** | 真实仓库 611 文件 / 160 节点 / 406 边 / 100 符号（M23 时点）；无 AST |
| T23-02 | W-02 Ghidra | **PARTIAL** | objdump 真实；Ghidra Headless 缺失 |
| T23-03 | W-03 JADX | **BLOCKED** | JADX zip 不完整 + 无授权 APK |
| T23-04 | W-04 调用链 | **PARTIAL** | 12,795 指令 / 92 函数 / 277 直接边 / 23 间接点 |
| T23-05 | W-05 TShark | **PARTIAL** | TShark 4.6.9 真实执行（4 包合成 pcap），frame=4 与内置解析一致；无 TCP 重组/TLS |
| T23-06 | W-06 Frida | **BLOCKED** | 无 frida/adb/授权设备 |
| T23-07 | 安全隔离 | **PARTIAL** | 只读/哈希/临时目录/超时；无容器隔离 |
| T23-08 | 证据 | **PASS** | result/report/evidence/commands + 工具版本 |
| T23-09 | 回归 | **PASS** | 全量 318/318；REA 17/17（rea 14 + rea-tools 3） |

**不能声称**：W-02 已用 Ghidra、W-03 已反编译 APK、W-06 已动态插桩、W-05 已完成流量重建。
