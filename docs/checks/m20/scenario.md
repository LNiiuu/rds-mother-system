# M20 联合场景设计

**场景**：对一个测试代码仓库 + 一个本机系统二进制 + 一个合成 APK 做证据化分析，产出带“事实/推断/未验证”边界的联合报告。

## 1. 输入

| 输入 | 来源 | 合法性 |
|---|---|---|
| 测试代码仓库 | 本轮生成的临时仓库（`src/command.js`、`test/command.test.js`） | 自建，可复现 |
| `where.exe` | `%SystemRoot%\System32\where.exe` | 本机系统程序，只读；SHA-256 与历史证据一致 |
| 合成 APK | `tooling/make-apk-fixture.cjs` 生成的 ZIP 容器 | 自建，非可安装应用；只做 ZIP 事实层 |
| 合成 PCAP（可选） | `tooling/make-pcap-fixture.cjs` | 自建；本轮 M20 不依赖 |

## 2. 流程

1. R0 视角定义任务：代码结构 + 二进制结构/调用图 + APK 事实层，输出证据边界。
2. REA 执行（runner 调用，不是模型调用）：
   - W-01 代码库：结构、入口、依赖图、符号；
   - W-02 `where.exe`：PE 段/导入/字符串；
   - W-04 `where.exe`：直接调用图、间接调用点计数；
   - W-03 合成 APK：缺 jadx → BLOCKED，仅 ZIP 事实。
3. 把 REA 结果写入 `evidence/SUMMARY.md`（含哈希、工具版本、限制）。
4. Agent 编排（M18 scheduler，hybrid）：
   - R1 设计（shared）写 `JOINT-PLAN.md`；
   - R5 研究、R6 安全（copy，并发）读 SUMMARY；
   - R2 报告（copy）写 `JOINT-REPORT.md`；
   - R4 审查（shared）读报告 + SUMMARY；
   - R0 汇总（shared）读报告。
5. 受控合并：R2 报告合并回 base；无冲突。
6. 输出 `execution-record.json`、`evidence/`、`final-report.md`。

## 3. 角色边界

- R1 只写计划文件；R2 只写报告文件；R4/R0 只读。
- `writable_paths` 在 scheduler job 上强制；越界 `TOOL_PATH_DENIED`。
- R4 的审查是代码/证据链检查，不是模型独立判断；本轮 R4 是 mock。

## 4. 明确不做

- 不使用未授权第三方样本。
- 不执行 `where.exe`，不做动态行为分析。
- 不把 W-03 的 ZIP 结构写成 APK 行为结论。
- 不把 mock Agent 写成真实模型协作。
