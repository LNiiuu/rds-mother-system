# M7 实验原始证据包

本目录是 [M7-2 实验原始记录](../productization/M7-2-experiment-record.md) 的原始材料副本，
用于脱离作者机器也能复核结论。所有文件从 `D:\M7-lab` 复制而来，**内容未改动**。

## 目录

| 路径 | 内容 |
|---|---|
| `spec/TASK.md` | 任务书（预注册哈希 `2c8e6236…`） |
| `spec/CR1.md` | 需求变更 1（预注册哈希 `1a8bd168…`） |
| `spec/CR2.md` | 需求变更 2（预注册哈希 `1906dc5b…`） |
| `acceptance.test.js` | 隐藏验收测试，19 例（预注册哈希 `ccf439c4…`） |
| `oracle.js` | 独立算盘：按任务书规则算出期望值，用于核对验收常量 |
| `fixtures/` | 四个输入夹具（两份流水 + 两份汇率表） |
| `logs/markers.txt` | 两组 START/END 时间标记 |
| `logs/metrics.json` | 从会话记录聚合出的真实 token / 调用 / 读取数据 |
| `logs/arm-a-acceptance.txt` | A 组隐藏验收原始输出 |
| `logs/arm-b-acceptance.txt` | B 组隐藏验收原始输出 |

## 怎么复核

```bash
# 1. 验收测试的哈希必须与预注册一致
sha256sum acceptance.test.js spec/*.md
#    期望：ccf439c4… / 2c8e6236… / 1a8bd168… / 1906dc5b…

# 2. 用独立算盘核对验收常量
node oracle.js

# 3. 用同一份测试跑任一组（需要该组源码，见 M7-2 §8 的 D:\M7-lab 路径）
#    ARM_DIR=<arm 目录> node --test acceptance.test.js
```

## 注意

- 两组的**源码**在 `D:\M7-lab\arm-a`、`D:\M7-lab\arm-b`，未复制进仓库（共 900 多行，属实验产物而非产品代码）。
- `metrics.json` 里的 `prompt` 总量含会话历史，**不能**直接解释为单组成本；
  可比口径见 M7-3 §1.1（增量 prompt + completion）。
- 本目录是 `EVIDENCE`：只对 2026-11-12 那次实验有效，不改写。
