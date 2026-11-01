# W-06 Frida 运行时分析

## 适用 / 前置
- 授权进程/样本；REA frida bindings 接入（M1-0B）。

## 输入
- 目标进程、脚本目的、安全边界。

## 步骤
1. 列出设备/进程 → 2. `start_frida_session` → 3. `load_frida_script` → 4. 观测 → 5. `close_frida_session`。

## 证据
- 脚本、观测记录、会话状态、安全边界说明、evidence_id。

## 失败分支
- bindings 缺失 → 记 blocker；不得改用 CLI 冒充 REA。

## 不适用 / 禁令
- 不注入未授权进程；不读取真实用户数据。

## 复跑
- 同一进程复跑，观测结构一致。

