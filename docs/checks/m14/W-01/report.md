# W-01 代码库理解：D:\M1

扫描文件 **509** 个，合计 41493.6 KB。

## 语言分布（推断）

| 语言 | 文件数 | 字节 |
|---|---:|---:|
| Markdown | 207 | 1231242 |
| JavaScript | 132 | 833604 |
| JSON | 67 | 326401 |
| PowerShell | 18 | 85561 |
| YAML | 3 | 2251 |
| Shell | 1 | 4427 |

## 顶层目录

- `mars` — 219 个文件
- `docs` — 173 个文件
- `core` — 46 个文件
- `tooling` — 38 个文件
- `rea` — 17 个文件
- `(root)` — 7 个文件
- `tests` — 4 个文件
- `bin` — 3 个文件
- `stacks` — 2 个文件

## 工程清单

- `package.json`（npm） name=rds-mother-system scripts=doctor,config,layers,baseline,docs:check,test,test:raw,test:external,test:gate-selfcheck,smoke,verify,pack:check,demo:m9-m11,demo:m12

## 入口候选（推断）

- `bin:rds` — package.json bin
- `bin/rds.mjs` — cli entry

## 测试

测试文件 49 个；识别到的框架：node:test

## 最大的文件

- `docs/history/initial-deployment/source/continuation-session.jsonl` — 18564659 B
- `docs/history/initial-deployment/source/original-session.jsonl` — 18564571 B
- `mars/var/mars.db` — 589824 B
- `mars/var/backups/mars-2026-11-03T15-20-10-160Z.db` — 360448 B
- `docs/checks/git-review/run-20261101-225350/diff.patch` — 359291 B

## 推断与事实的边界

- languages 由扩展名映射得出，是推断，不是编译/解析结果
- entries 来自 manifest 字段与常见文件名约定，是候选而非确认
- tests.frameworks 来自测试文件内容的关键字匹配，可能漏判
