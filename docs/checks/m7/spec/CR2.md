# 需求变更 2（CR2）：汇率文件支持基准币种与交叉汇率

财务给的汇率表换了格式，且要求能直接换算到非 CNY 的目标币种。

## 新增格式

汇率文件可以是两种形态之一：

1. **扁平格式（v1，保留）**：`{"USD": 7.0, "EUR": 8.0}` —— 隐含 `base = CNY`，`--target` 只能是 `CNY`。
2. **带基准格式（新）**：

```json
{"base": "USD", "rates": {"USD": 1, "CNY": 7.0, "EUR": 0.875}}
```

语义：`rates[CUR]` = 1 单位 `base` 等于多少 `CUR`。

## 换算规则

设源币种 `S`、目标币种 `T`：

```
先换回 base：amount_base = amount / rates[S]
再换到目标：amount_T    = amount_base × rates[T]
合并：       amount_T    = amount × rates[T] / rates[S]
```

- `S == T` 时结果不变（仍要走一遍整数舍入，确保稳定）。
- `S` 或 `T` 不在 `rates` 中 → 该行 `E_RATE`。
- 舍入规则不变：四舍五入，负数远离零（`-0.5` → `-1`）。
- `--target` 可以是 `rates` 中任意币种。
- 带基准格式但 `base` 缺失、`rates` 不是对象、`rates[base]` 不等于 1（允许浮点误差 1e-9）
  → 致命错误 `E_RATES`。

## 兼容性

- 扁平格式下 `--target` 非 CNY 仍是 `E_RATES_BASE`（不因 CR2 放宽）。
- 其余行为（去重、分组、排序、`--top`、输出、退出码、幂等）全部不变。

## 必须补的测试

至少覆盖：跨币种换算（含 CNY→EUR 这类非 base 目标）、`S == T`、缺少 `rates[base]` 的致命错误、
扁平格式下非 CNY 目标仍被拒。
