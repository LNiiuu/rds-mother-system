# W-02 原生二进制静态逆向

## 适用 / 前置
- 授权样本；Ghidra provider available。

## 输入
- 二进制路径、样本哈希。

## 步骤
1. `open_binary` → 2. `list_procedures` → 3. 关键函数 `procedure_pseudo_code` → 4. `xrefs`/`get_call_graph`。

## 证据
- 函数清单、调用链、伪代码片段、evidence_id。

## 失败分支
- provider missing → 停，记 blocker；不得用反汇编器输出冒充 REA。

## 不适用 / 禁令
- 不执行样本；不绕过授权。

## 复跑
- 同一哈希复跑，函数数一致或差异有解释。

