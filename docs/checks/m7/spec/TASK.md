# 任务书：xsum —— 交易流水聚合 CLI

## 背景

你拿到一批导出格式不统一的交易流水（CSV 与 JSONL 混用），需要一个小工具把它们汇总成
「按月 × 分类」的账目，供财务核对。工具要能在半年的数据上重复运行且结果一致。

## 交付物

在项目根目录下实现一个可执行入口 `bin/xsum.js`，用 Node.js（>= 22）实现，**不得引入任何第三方运行时依赖**。
同时提供 `npm test`（`node --test`）与你自己的测试。

调用方式：

```
node bin/xsum.js [选项] <文件...>
```

## 输入

- `.csv`：必须有表头；列名为 `id,date,amount,currency,category,merchant`（顺序可变，多余列忽略）。
- `.jsonl`：每行一个 JSON 对象，字段同上。
- 其他扩展名 → 致命错误 `E_FORMAT`。
- 文件不存在 → 致命错误 `E_FILE`。

## 字段规则

| 字段 | 规则 | 违反时 |
|---|---|---|
| `date` | 严格 `YYYY-MM-DD`，且必须是真实存在的日期 | 行错误 `E_DATE` |
| `amount` | 十进制字符串，可带前导 `-`，整数部分至少 1 位，小数最多 2 位；**必须按字符串解析为整数分，禁止浮点累加** | 行错误 `E_AMOUNT` |
| `currency` | 恰好 3 个大写字母 | 行错误 `E_CURRENCY` |
| `category` | 非空；首尾空白要去掉 | 行错误 `E_CATEGORY` |
| `id` | 可选；空或缺失表示不参与去重 | — |
| `merchant` | 可选，不参与输出 | — |

`amount` 解析示例：`"100.00"` → `10000`；`"-20"` → `-2000`；`" 8.00 "` → `800`（先 trim）；
`"1.2.3"`、`"1e3"`、`""`、`"1.234"` 都是 `E_AMOUNT`。

## 去重

同一个 `id` 在所有输入文件中出现多次时，**保留按输入顺序第一次出现的那条**，其余计入 `duplicates`。
没有 `id` 的行不参与去重。

## 币种换算

- `--target <CUR>`：目标币种，默认 `CNY`。
- `--rates <path>`：汇率文件，v1 只支持扁平格式，表示「1 单位该币种 = 多少 CNY」：

```json
{"USD": 7.0, "EUR": 8.0}
```

- 扁平格式隐含 `base = CNY`；此时 `--target` 只能是 `CNY`，否则致命错误 `E_RATES_BASE`。
- 换算：`目标分 = round(原分 × 汇率)`，**四舍五入、负数远离零**（`-0.5` → `-1`）。
- 某行币种在汇率表中缺失 → 行错误 `E_RATE`，该行不计入合计。
- 汇率文件缺失或 JSON 非法 → 致命错误 `E_RATES`。

## 聚合

- 默认分组键：`month`（`YYYY-MM`）+ `category`。
- 排序：`month` 升序，再按分组键的码点升序。
- 每行输出 `{month, <分组键>, total, count}`，`total` 是**目标币种的整数分**。
- `--top <N>`：每个月只保留 `abs(total)` 最大的 N 个分组；并列时按分组键码点升序取前者。
  `N` 必须是正整数，否则 `E_ARGS`。输出仍按上面的排序。

## 过滤

`--since <YYYY-MM-DD>`、`--until <YYYY-MM-DD>`，按 `date` 闭区间过滤。格式非法 → `E_ARGS`。
过滤只影响 `rows`；`stats` 与 `errors` 始终按全部输入统计。

## 输出

默认向 stdout 输出 JSON：

```json
{"target":"CNY","rows":[{"month":"2026-01","category":"books","total":24000,"count":1}],
 "errors":[{"file":"x.csv","line":3,"code":"E_DATE","message":"..."}],
 "stats":{"files":2,"records":11,"duplicates":1,"invalid":3,"skipped_rate":1}}
```

- `errors` 按 `file` 升序、`line` 升序。
- `stats.records` = 读取到的数据行总数（含重复、含非法）。
- `stats.invalid` = 所有行级错误数；`stats.skipped_rate` = 其中 `E_RATE` 的数量。
- `--out <path>`：写到文件，stdout 不输出内容。
- `--format csv`：输出 CSV，表头固定 `month,category,total,count`，`\n` 换行，末行有换行符。
- `--dry-run`：只输出 `{"records":N,"duplicates":N,"invalid":N,"would_write":<bool>}`，不写文件。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 无行级错误 |
| 2 | 有行级错误（但仍产出结果） |
| 1 | 致命错误（参数、文件、汇率、格式） |

致命错误在 stderr 输出一行：`ERROR <CODE> <message>`。

## 一致性与可重复

- 相同输入重复运行，输出必须**逐字节一致**。
- 不依赖当前工作目录之外的任何状态；不写缓存。
