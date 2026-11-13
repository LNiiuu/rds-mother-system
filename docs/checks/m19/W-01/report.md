# W-01 代码库理解：<REPO>

扫描文件 **584** 个，合计 41988.5 KB。

## 语言分布（推断）

| 语言 | 文件数 | 字节 |
|---|---:|---:|
| Markdown | 233 | 1361287 |
| JavaScript | 146 | 992383 |
| JSON | 95 | 540958 |
| PowerShell | 18 | 85561 |
| YAML | 3 | 2251 |
| Shell | 1 | 4427 |

## 顶层目录

- `docs` — 233 个文件
- `mars` — 229 个文件
- `core` — 46 个文件
- `tooling` — 42 个文件
- `rea` — 17 个文件
- `(root)` — 8 个文件
- `tests` — 4 个文件
- `bin` — 3 个文件
- `stacks` — 2 个文件

## 工程清单

- `package.json`（npm） name=rds-mother-system scripts=doctor,config,layers,baseline,docs:check,test,test:raw,test:external,test:gate-selfcheck,smoke,verify,pack:check,demo:m9-m11,demo:m12,demo:m15

## 入口候选（推断）

- `bin:rds` — package.json bin
- `bin/rds.mjs` — cli entry

## 测试

测试文件 54 个；识别到的框架：node:test

## 静态依赖图（推断）

节点 146 个，边 376 条；方法：static import/require regex; no AST, no dynamic import, no type resolution

- 关键模块 `mars/src/util.js` — 入度 28
- 关键模块 `mars/src/db.js` — 入度 26
- 关键模块 `mars/src/store.js` — 入度 19
- 关键模块 `mars/src/authz.js` — 入度 18
- 关键模块 `mars/tests/phase1/helpers.js` — 入度 16

## 符号（前 20）

- `add` — bin/doctor.mjs
- `machinePatterns` — bin/doctor.mjs
- `readJson` — bin/doctor.mjs
- `render` — bin/doctor.mjs
- `scanPaths` — bin/doctor.mjs
- `walk` — bin/doctor.mjs
- `walkMarkdown` — bin/doctor.mjs
- `cmpVersion` — bin/rds.mjs
- `fail` — bin/rds.mjs
- `readVersion` — bin/rds.mjs
- `add` — bin/validate.mjs
- `isAbsolute` — bin/validate.mjs
- `parseTopLevel` — bin/validate.mjs
- `render` — bin/validate.mjs
- `stripComment` — bin/validate.mjs
- `unquote` — bin/validate.mjs
- `json` — docs/checks/m7/acceptance.test.js
- `run` — docs/checks/m7/acceptance.test.js
- `tmpdir` — docs/checks/m7/acceptance.test.js
- `convert` — docs/checks/m7/oracle.js

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
