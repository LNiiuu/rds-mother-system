# REA 逆向分析使用说明（M14–M15）

> 适用版本：Schema v7 / `rds` 0.1.0
> 六套工作流的当前状态在本机实测，BLOCKED 项写明真实原因。

---

## 1. 六套工作流与真实状态

| ID | 名称 | 引擎 | 本机状态 | 原因 |
|---|---|---|---|---|
| W-01 | 代码库理解与依赖梳理 | 本地文件系统 | **PARTIAL** | 依赖图来自 import/require 正则，符号为静态提取；无 AST/类型解析 |
| W-02 | 原生二进制静态分析 | binutils | **PARTIAL** | 无 Ghidra，反编译/类型恢复/xref 全图未做 |
| W-03 | Android APK 静态分析 | 需 jadx | **BLOCKED** | 无 jadx / java / apktool |
| W-04 | 调用链分析（静态） | binutils | **PARTIAL** | 只解析直接 call；间接调用只计数 |
| W-05 | PCAP 流量分析 | 纯 JS 解析 | **PARTIAL** | 未做 TCP 重组、不解密 TLS、不解析 SNI |
| W-06 | Frida 运行时分析 | 需 frida | **BLOCKED** | 无 frida / adb，无授权目标 |

**PARTIAL 不等于 PASS。** 每套的 `result` 里都有 `not_done` / `capability.not_done` / `limits`，明确列出没做什么。

---

## 2. 先看环境就绪

```bash
rds rea status
```

输出每套工作流的 `tools_ready` 与逐个工具的 `present / path / version`。**不要跳过这一步**——它决定你能得到 PASS 还是 BLOCKED。

---

## 3. 常用命令

```bash
# 代码库结构（任何环境都能跑）
rds rea run --workflow W-01 --path ./

# 二进制结构 + 字符串
rds rea run --workflow W-02 --sample /bin/ls

# 调用图（--depth 默认 3）
rds rea run --workflow W-04 --sample /bin/ls --depth 4

# 流量（pcap 必须是 libpcap；pcapng 会明确报 UNSUPPORTED_FORMAT）
rds rea run --workflow W-05 --sample ./cap.pcap --sample-kind capture

# 只看前置条件，不执行
rds rea preflight --workflow W-03 --sample ./app.apk

# 回看
rds rea runs
rds rea inspect --run <rea_run_id>
```

---

## 4. 证据在哪

每次分析落一个目录（默认与数据库同级 `rea/<workflow>/<run_id>/`）：

```
result.json     完整结构化结果
report.md       人读报告
evidence.json   样本哈希、工具版本与路径、argv 级命令、复核三步、限制
```

`evidence.json` 里的 `reproduce` 是复核入口：重算哈希 → 按 argv 重跑 → 比对字段。

样本 SHA-256 同时写进 `rea_runs.sample_sha256`，可用 `rds rea inspect` 反查。

---

## 5. 输出怎么读

### W-02 的 `capability`

```json
{
  "done": ["文件格式与架构", "段表", "导入表", "符号表", "字符串提取与分类", "入口地址"],
  "not_done": ["反编译伪代码（需 Ghidra/IDA，本环境无）", "类型恢复", "完整 xref 图", "动态行为"],
  "why_partial": "本环境无 Ghidra 且 WSL 被安全策略封禁；binutils 只能给出结构与符号级事实"
}
```

### W-04 的 `inference`

```json
{
  "kind": "static-disassembly",
  "what_this_is": "从 objdump -d 的直接 call 指令读出的调用关系；函数边界按「调用目标 + 入口」推断",
  "what_this_is_not": "不是运行时实测；间接调用只计数不解析；剥离二进制的函数边界是启发式"
}
```

剥离二进制（系统程序基本都是）没有函数符号，所以「函数」是**推断出来的边界**，不是编译器产出的符号。这一点在每个报告里都写。

### W-05 的 `heuristics`

`dns-long-label` / `http-nonstandard-port` 是**启发式**，带阈值与理由，不是恶意判定。

---

## 6. 任务类型与联合流程（M15）

八种任务类型固定了「用哪些工作流、谁负责、要什么证据」：

```bash
rds task types
rds task plan --project demo --type binary_analysis --objective "分析样本的导入与调用链"
rds rea run --workflow W-02 --sample ./x.exe --task-type binary_analysis   # 类型不匹配会直接报错
```

类型与工作流不匹配时是**抛错**，不是警告：

```
ERROR WORKFLOW_NOT_IN_TASK_TYPE binary_analysis 只允许 W-02,W-04，收到 W-05
```

联合流程（逆向 → 审核 → 研发）见 `tooling/m15-joint-demo.cjs`：

```bash
npm run demo:m15     # 需要 objdump（binutils）
```

它做的事：W-02 + W-04 分析真实样本 → R4 审核证据 → 把**已审核的结论**作为上下文交给 R1→R2→R3→R4 完成重构 → 真实跑测试。

---

## 7. 安全与合规边界

1. **只分析你有权分析的样本。** 工具读取即视为授权声明。
2. **原始样本只读**：所有工作流只读样本，不修改、不移动。
3. **W-06 必须显式授权**：`--authorization own-device|lab|written-consent`，缺了直接 `AUTHORIZATION_REQUIRED`。
4. **不解密 TLS**：W-05 只识别握手类型，不解析内容、不解析 SNI。
5. **不做隐蔽监控**：W-06 的用途限定为自有/授权应用与测试环境。
6. **结论分层**：`result` 里明确区分工具直接观察、启发式推断、未验证假设。研发 Agent 只能使用**经 R4 审核**的结论。

---

## 8. 想补齐 BLOCKED 项需要什么

| 工作流 | 需要 | 补上之后本工作流的代码是否够用 |
|---|---|---|
| W-03 | `jadx` + JDK（放进 PATH） | 不够：`execute` 目前只解析 ZIP 结构，还需要接入 jadx 调用与结果解析 |
| W-06 | `frida` + `adb` + 授权设备 | 不够：本工作流刻意没有 `execute`，需要新增 hook 脚本管理与结果解析 |

也就是说：**装工具不等于能力就绪**，这两套还需要实现代码。这一点写在这里，避免"装了 jadx 就以为 W-03 能跑"。
