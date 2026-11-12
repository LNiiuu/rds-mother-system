# 需求变更 1（CR1）：支持按币种分组

客户希望在按分类看账之外，还能看「每个月各币种花了多少」（换算前的原币种口径不要求，仍按目标币种合计）。

## 新增

- `--group-by <category|currency>`，默认 `category`。
  - `category`：维持现有行为（`month` + `category`）。
  - `currency`：分组键改为 `month` + `currency`（原币种代码）；不再按 category 拆分。
  - 其他值 → 致命错误 `E_ARGS`。
- 使用 `--group-by currency` 时：
  - JSON 每行的键名是 `currency`（不是 `category`）：`{month, currency, total, count}`。
  - `--format csv` 的表头变为 `month,currency,total,count`。
- `--top N` 的语义不变：仍在每个月内按 `abs(total)` 取前 N，并列按分组键码点升序。
- 排序键不变：`month` 升序，再按分组键码点升序。

## 不变

金额仍以目标币种整数分输出；去重、过滤、错误码、退出码、幂等性要求全部不变。

## 必须补的测试

至少覆盖：同月多币种、`--group-by currency` 与 `--top` 组合、CSV 表头随分组键变化。
