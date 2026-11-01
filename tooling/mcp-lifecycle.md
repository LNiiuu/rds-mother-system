# MCP 生命周期

## 现状

- `rea` 为 on-demand；profile 中的条目可能是影子配置，运行期以 registry 为准。
- 改 env / 注册信息后，旧进程不会自动读取。

## 安全变更流程

1. 记录基线：serverName、version、tools_sha256、进程启动时间、relevant env。
2. 备份 registry.json（不改内容则不必）。
3. 通过受支持入口修改（`mcp_register`）。
4. **重建进程**：结束旧进程 → 重新加载 → 确认启动时间晚于变更时间。
5. 验证环境注入：调用一个读取环境变量的工具（如 `inspect_adb_client` 的 path_source）。
6. 记录证据（E1）与回滚方式。

## 禁止

- 手改配置文件后宣称已生效；
- 未验证进程重建就继续分析；
- 在未授权情况下升级 REA 或依赖。

