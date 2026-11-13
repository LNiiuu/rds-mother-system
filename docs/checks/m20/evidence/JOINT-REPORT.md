# Joint Analysis Report

## Scope
分析测试代码库与 where.exe 的结构/调用图，输出证据边界。

## Evidence
- W-01 PARTIAL: 2 files, 2 dep nodes, 1 edges.
- W-02 PARTIAL: 7 sections, 7 DLL, 206 strings.
- W-04 PARTIAL: 12795 insn, 92 inferred functions, 277 direct edges, 23 indirect sites.
- W-03 BLOCKED: TOOL_MISSING:jadx; ZIP entries 7.

## Review
- 结论只使用工具直接事实与明确标注的推断。
- 未验证运行时行为、恶意性、漏洞可利用性。
- W-03 未反编译，不能把 ZIP 结构写成 APK 行为结论。
