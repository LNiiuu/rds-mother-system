# W-02 原生二进制静态分析

样本：`C:\WINDOWS\System32\where.exe`

- 大小：65536 B
- SHA-256：`f51fab8041e5023d7290b540a2106f051ef0bd2bc3443c9daf318628b560fa29`
- 格式：pei-x86-64 / i386:x86-64
- 入口：0x0000000140001300

## 段

| 段 | 大小 | VMA |
|---|---:|---|
| .text | 30080 | 0x140001000 |
| fothk | 4096 | 0x140009000 |
| .rdata | 6764 | 0x14000a000 |
| .data | 2112 | 0x14000c000 |
| .pdata | 1068 | 0x14000d000 |
| .rsrc | 2064 | 0x14000e000 |
| .reloc | 136 | 0x14000f000 |

## 导入库

- **msvcrt.dll** — 33 个符号
- **KERNEL32.dll** — 57 个符号
- **ntdll.dll** — 2 个符号
- **USER32.dll** — 2 个符号
- **WS2_32.dll** — 1 个符号
- **SHLWAPI.dll** — 1 个符号
- **VERSION.dll** — 3 个符号

## 符号

总数 0（列出前 0 条）

## 字符串

共 206 条；分类：plain=199, module=7

- `[module]` msvcrt.dll
- `[module]` KERNEL32.dll
- `[module]` ntdll.dll
- `[module]` USER32.dll
- `[module]` WS2_32.dll
- `[module]` SHLWAPI.dll
- `[module]` VERSION.dll

## 能力边界

**已做**：文件格式与架构、段表、导入表（DLL + 符号）、符号表、字符串提取与分类、入口地址

**未做**：反编译伪代码（需 Ghidra/IDA，本环境无）、类型恢复、完整 xref 图、动态行为

原因：本环境无 Ghidra 且 WSL 被安全策略封禁；binutils 只能给出结构与符号级事实
