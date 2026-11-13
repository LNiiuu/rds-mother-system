# M20 联合最终报告

**判定**：`PARTIAL`
**原因**：真实 REA W-01/W-02/W-04 与真实调度/文件/证据链跑通；Agent 模型为 mock，T20-02“多个真实 Agent”BLOCKED。

---

## 1. 联合结果

| 项 | 结果 |
|---|---|
| Plan | `plan18dc9c2820cb`，mode=hybrid，status=SUCCEEDED，merge=CLEAN |
| Jobs | design/research/security/report/review/final 全部 SUCCEEDED |
| 并发 | research/security 在 max_concurrency=2 内并发；report 依赖三者后执行 |
| 文件 | `JOINT-PLAN.md`、`JOINT-REPORT.md`、`evidence/SUMMARY.md` 均存在 |
| 用量 | 6 runs / 13 calls / input 1166 / output 56（全部 estimated） |
| REA | W-01 PARTIAL；W-02 PARTIAL；W-04 PARTIAL；W-03 BLOCKED（jadx） |

## 2. 证据链

- W-02/W-04 样本 SHA-256：`f51fab8041e5023d7290b540a2106f051ef0bd2bc3443c9daf318628b560fa29`；
- W-02：7 段、7 个导入 DLL、206 字符串、符号 0；
- W-04：12,795 指令、92 推断函数、277 直接边、23 间接调用点；
- W-03：7 个 ZIP 条目、2 dex、native 库、签名文件；缺 jadx，未反编译；
- W-01：测试仓库 2 个文件、2 个依赖节点、1 条边。

## 3. 事实 / 推断 / 未验证

**事实**：ZIP 条目、PE 段/导入/字符串、objdump 直接 call、文件写入、测试执行、调度时间。

**推断**：W-04 函数边界是启发式；字符串分类是正则；依赖图是静态 import/require。

**未验证**：运行时行为、恶意性、漏洞可利用性、真实模型决策质量、W-03 APK 行为。

## 4. 结论

联合链路能完成“REA 工具产出 → 证据摘要 → 多角色编排 → 报告 → 审查 → 汇总”的工程闭环；但真实模型协作、真实 Ghidra/JADX/TShark/Frida 分析未完成。不能写成“RDS + REA 全能力真实联合”。
