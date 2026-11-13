# Joint Evidence Summary

- W-01: PARTIAL; files=2; deps_nodes=2; deps_edges=1
- W-02: PARTIAL; sections=7; imports=7; strings=206; sample_sha256=f51fab8041e5023d7290b540a2106f051ef0bd2bc3443c9daf318628b560fa29
- W-04: PARTIAL; insn=12795; functions=92; direct_edges=277; indirect=23
- W-03: BLOCKED; blocked=TOOL_MISSING:jadx; zip_entries=7

## Facts
- W-02/W-04 的样本哈希相同，均为 where.exe 的 SHA-256。
- W-04 的函数边界是启发式推断，不是编译器符号；间接调用只计数不解析。
- W-03 缺 jadx/java，只有 ZIP 结构事实，未做反编译。

## Inferences
- 该二进制导入文件系统与进程 API；是否“命令拼接风险”需要结合调用方代码，不能仅凭导入表判定。

## Not verified
- 运行时行为、恶意性、真实漏洞可利用性。
