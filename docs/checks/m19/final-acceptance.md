# M19 最终验收

**判定**：`PARTIAL`
**原因**：统一工具适配层已建立，W-01/W-02/W-04 有真实工具输出；W-02 Ghidra、W-03 JADX、W-05 TShark、W-06 Frida 因工具缺失 **BLOCKED**。不能因为框架统一就把六套全标 PASS。

---

## 1. 验收表

| 编号 | 工作流 | 结果 | 说明 |
|---|---|---|---|
| T19-01 | W-01 真实代码仓库 | **PASS** | 584 文件、146 节点/376 边依赖图、100 符号；真实仓库 |
| T19-02 | W-02 真实 Ghidra | **BLOCKED** | Ghidra/analyzeHeadless 缺失；objdump 结构级 PARTIAL 仍真实 |
| T19-03 | W-03 真实 JADX | **BLOCKED** | jadx/java/apktool 缺失；ZIP 事实层 7 条目/2 dex |
| T19-04 | W-04 真实调用链 | **PARTIAL** | 12,795 指令/92 边界/277 直接边/23 间接点；间接未解析 |
| T19-05 | W-05 真实 TShark | **BLOCKED** | tshark 缺失；内置纯 JS 解析 synthetic 4 包 PARTIAL |
| T19-06 | W-06 真实 Frida | **BLOCKED** | frida/adb/设备缺失；无 execute 实现 |
| T19-07 | 安全隔离 | **PARTIAL** | 只读/哈希/临时目录/超时/输出上限；无容器/OS 隔离 |
| T19-08 | 证据可追溯 | **PASS** | 每套 result/report/evidence/execution.log；哈希+工具版本+argv |
| T19-09 | 回归 | **PASS** | 全量测试 302/302（见最终报告） |

## 2. 六套结果

```text
W-01 PARTIAL  584 files / 146 deps nodes / 376 edges / 100 symbols
W-02 PARTIAL  7 sections / 7 DLL / 206 strings / 0 symbols / Ghidra missing
W-03 BLOCKED  jadx missing; 7 ZIP entries / 2 dex / native lib / signature
W-04 PARTIAL  12,795 insn / 92 inferred functions / 277 direct edges / 23 indirect
W-05 PARTIAL  synthetic 4 packets (UDP 2 / TCP 2 / DNS 2 / HTTP 1); tshark missing
W-06 BLOCKED  frida/adb missing; no execute
```

## 3. 交付物

- `tool-adapter-architecture.md`
- `W-01/` … `W-06/`（各含 result.json、report.md、evidence.json、execution.log）
- `security-verification.md`
- `evidence-model.md`
- `execution-record.json`

## 4. 不能声称的事

- 不能声称“W-02 已完成 Ghidra 分析”；只做了 objdump 结构/符号级。
- 不能声称“W-03 已完成 APK 反编译”；只做了 ZIP 事实层。
- 不能声称“W-05 已用 TShark 分析”；只用了内置解析器。
- 不能声称“W-06 已动态插桩”；没有工具、没有执行。
- 不能声称“样本已隔离”；没有容器/OS 沙箱。
