# M24 联合场景（未执行）

**状态**：`NOT RUN`（真实模型阻断）

预期链路：

1. 平台适配器接收 `task.submit`（HTTP/DSH/WorkBuddy bridge）；
2. `platform-client` 归一化事件；
3. 调度器创建 plan，R0/R1 分配 job；
4. R2 调 Development 工具，R6 调 REA 工具；
5. R3 验证、R4 审查、R0 汇总；
6. `task.result` 回传平台。

**实际阻断**：

- 平台层尚未接入调度器（M22 结论：库 + 契约测试）；
- 本地模型下载损坏（M21：无有效模型）；
- 因此第 1–6 步没有端到端执行，不生成“成功”记录。

**已有可复用片段**：M18 调度/隔离/冲突/恢复；M20 REA+多角色（mock 模型）；M23 W-05 TShark。
