# W-02 原生二进制静态分析

- 目标：对本地 PE/ELF/Mach-O 做静态分析，产出段布局、函数清单与关键函数语义。
- 输入：二进制路径 + SHA-256。
- 角色：R2 执行；R6 复核哈希与函数计数。
- 工具：REA `open_binary` → `binary_overview` → `list_procedures` → `procedure_pseudo_code` / `procedure_callees`。
- 步骤：
  1. 计算 SHA-256，`open_binary` 打开并核对 format/arch。
  2. `binary_overview` 记录 image_base、段数、函数/字符串计数。
  3. `list_procedures` 抽样入口与 thunk；`procedure_pseudo_code` 读入口语义。
  4. 记录 evidence_id 与局限（不执行、不打补丁）。
- 输出：`rea/evidence/EV-*-w02-*.md`，含哈希、布局表、函数计数、入口伪代码摘要、evidence_id 清单。
- 失败分支：provider unavailable→BLOCKED；分析超时→PARTIAL 并记录超时参数。
