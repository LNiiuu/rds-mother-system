# M19 安全与隔离验证

**判定**：`PARTIAL`。样本只读、哈希、临时目录、超时、输出上限已实现；**没有容器/OS 级隔离**，不能声称恶意样本沙箱。

---

## 1. 已实现

| 控制 | 实现 | 证据 |
|---|---|---|
| 样本来源/哈希 | 每次 `sha256File`；写入 evidence/result | `W-02/evidence.json` 等 |
| 文件类型检查 | W-03 ZIP magic、W-05 libpcap magic、W-02 objdump 解析 | preflight checks |
| 原始样本保护 | 只读打开；不修改/移动 | `fs.readFileSync` / objdump 只读 |
| 临时目录 | 证据与输出在 `<TEMP>`；不写样本目录 | `execution.log` |
| 超时 | `execFile` timeout；W-05 纯 JS 有边界 | `tools.js` / `tool-registry.js` |
| 输出上限 | 24 MB buffer | `tool-registry.execute` |
| 网络 | 本轮未发起网络请求；W-05 不连 live interface | execution-record |
| 动态分析授权 | W-06 `own-device|lab|written-consent`，缺则拒绝 | `w06-frida.js` |
| 不执行样本 | W-02/W-03/W-05 只解析字节；不运行样本 | 代码路径 |
| 证据完整性 | SHA-256 + tool_versions + commands + limitations | evidence.json |

## 2. 未实现/不能声称

- 没有容器、VM、Windows Sandbox 或独立 OS 用户；若样本本身有解析器漏洞，进程仍受影响。
- 没有网络命名空间/防火墙；工具若主动联网，当前不能在内核层阻断。
- 没有资源配额（CPU/内存/磁盘）除 timeout/buffer 外。
- 没有恶意样本行为判定；W-05 的 heuristics 只是阈值启发式。
- Frida 动态分析未执行；无授权设备。

## 3. 结论

可安全处理“本地可信/合成样本的静态解析”；**不可**把本环境当作不可信恶意样本的隔离沙箱。若要做高风险动态分析，必须在容器/专用 VM/授权设备中进行，并单独审批。
