# W-06 Frida 动态插桩

- 目标：对受控进程做运行时观察（加载脚本、回传消息），不接触真实业务数据。
- 输入：设备/本机、目标程序路径、JS 脚本。
- 角色：R2 执行；R6 复核会话状态与消息。
- 工具：REA `list_frida_devices` → `list_frida_processes` → `start_frida_session`（attach|spawn）→ `load_frida_script` → `resume_frida_session` → `frida_session_status` → `close_frida_session`。
- 步骤：
  1. 列设备与进程，确认目标。
  2. attach 失败（如 /proc/pid/mem 权限）则改 spawn 模式，用 program+argv。
  3. 加载脚本，`source_kind: inline` + `source`。
  4. resume 后读 status 与消息；结束必须 close。
- 输出：`rea/evidence/EV-*-w06-*.md`，含 session_id、pid、脚本 id、消息回传、evidence_id。
- 失败分支：bindings 缺失→BLOCKED；attach 权限拒绝→记约束并改 spawn；无真机不得宣称设备链路 PASS。
