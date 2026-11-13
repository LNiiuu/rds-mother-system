# M19 证据模型

**判定**：`IMPLEMENTED`。每次分析有 `result.json`、`report.md`、`evidence.json`、`execution.log`。

---

## 1. 文件

| 文件 | 内容 |
|---|---|
| `result.json` | 状态、preflight、结构化结果（工具事实 + 推断） |
| `report.md` | 人读报告 |
| `evidence.json` | 样本、SHA-256、工具版本/路径、argv 命令、复核三步、限制 |
| `execution.log` | workflow_id、status、rea_run_id、evidence_dir、sample、tool_versions、limitations、run_at |

## 2. 事实/推断/假设分层

W-02：

- 事实：PE 格式、段表、导入 DLL、符号数、字符串字节；
- 推断：字符串分类（url/path/module/...）是正则推断；
- 未验证：反编译伪代码、类型恢复、动态行为。

W-04：

- 事实：objdump 反汇编中的直接 `call` 地址、指令数；
- 推断：函数边界 = 入口 + 调用目标 + 符号；不是编译器符号；
- 未验证：间接调用目标、运行时行为。

W-05：

- 事实：pcap 字节、包数、协议计数、DNS/HTTP 单包字段；
- 推断：`dns-long-label` 等启发式；
- 未验证：TCP 重组、TLS 解密/SNI、恶意判定。

W-03：

- 事实：ZIP 中央目录条目、DEX 数量、native 库、签名文件；
- 未做：Manifest 解码、DEX 反编译、resources 解析（缺 jadx/java）。

## 3. 复核

`evidence.json` 的 `reproduce` 三步：重算哈希 → 按 argv 重跑 → 对比字段。
- W-02/W-04 的 `where.exe` 可复算；
- W-05 合成 pcap 可由 `tooling/make-pcap-fixture.cjs` 复算；
- W-01 的 611 文件（M23 时点；随工作区文件变化的大盘扫描）包含未跟踪/被忽略文件，不是干净克隆；
- W-03 的合成 APK 由 `tooling/make-apk-fixture.cjs` 生成，样本本身不入库（`.apk` 被 gitignore）。

## 4. 限制

- 证据目录中的样本路径已脱敏为 `<TEMP>`/`<REPO>`；原始样本不提交。
- W-01 的结果随工作区文件变化，不是固定快照。
- W-03/W-06 没有真实工具输出，只有 BLOCKED 记录。
