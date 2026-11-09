# M4 最终验收

**日期**：2026-11-09
**起点**：`9c5e4ab`（M3 终点 + CI 回填）
**终点**：见 `git log`（B0–B6 七个提交）
**判定**：**READY FOR COMMIT**（15 项验收全部 PASS；CI 四组矩阵真实通过）

---

## 1. 十五项验收逐条对照

| 编号 | 验收项 | 结果 | 证据 |
|---|---|---|---|
| M4-01 | 维护性审计有完整问题清单 | **PASS** | `M4-maintainability-audit.md`：无 S1；6 项 S2、7 项 S3、3 项 S4，每项带 file:line 与复现命令 |
| M4-02 | Schema / 代码 / 文档一致 | **PASS** | 契约有执行点（CLI 校验）+ 8 例契约测试 + 包内契约哈希与源码一致 |
| M4-03 | 不存在未处理的活跃损坏脚本 | **PASS** | 全仓 `git ls-files '*.js' '*.mjs'` 逐个 `node --check`：0 失败（基线 1，已删除 `seed-phase2.js`）；新增解析守卫 8 例 |
| M4-04 | 数据库生命周期与错误处理清晰 | **PASS** | `DB_OPEN_FAILED` / `DB_SCHEMA_NEWER` / `busy_timeout` / 审计计数；9 例测试；备份→恢复闭环验证 |
| M4-05 | 配置解析、校验、优先级统一 | **PASS** | `resolvePaths` 单一实现；doctor 与运行时同源；4 例测试 + 静态守卫（域模块零 `process.env`） |
| M4-06 | 版本体系有明确规则 | **PASS** | `docs/versioning.md`（三个命名空间 + 五条规则）；`serverInfo.version` 派生自产品版本并被真实握手测试钉住 |
| M4-07 | 关键故障可定位 | **PASS** | 故障矩阵 8 项 + 2 项，每项都有错误码、可行动提示、非栈输出（12 例测试） |
| M4-08 | Required 全绿 | **PASS** | `GATE PASS tests=173 pass=173 fail=0 skipped=0` |
| M4-09 | G1 真实执行并通过 | **PASS** | 本地六夹具 PASS；CI 的 g1 job success，耗时 27s（跳过会在 1s 内结束） |
| M4-10 | 分层 0 违规 | **PASS** | `LAYERS PASS problems=0 warnings=2`（2 条为永久边界声明） |
| M4-11 | 四组 CI 真实通过 | **PASS** | run [42583081805](https://github.com/LNiiuu/rds-mother-system/actions/runs/42583081805) @ `d7cba45`：Win/Ubuntu × Node 22/24 四组 + structure self-check + g1 共 6 job 全 success |
| M4-12 | 每批有真实回滚演练 | **PASS（含 1 项条件）** | `M4-rollback-report.md`：B0–B3 clean revert 前后全绿；B4/B5 暴露"测试依赖本机产物"，已在 B6 修复 |
| M4-13 | 发行包安装与 smoke 全通过 | **PASS** | `PACK PASS`（108 文件，禁止项 0 命中）+ `SMOKE PASS`（安装→doctor→init→写入→审批→检索→编译） |
| M4-14 | 文档与实际实现一致 | **PASS** | README / install / testing / versioning / CHANGELOG 全部同步；本次修的失真项见 §3 |
| M4-15 | 原有工作完整保护 | **PASS** | 开工前后 `git status` 均为 51 项；77→0 项未受影响（见 §4） |

**15 PASS + 0 NOT RUN。**

---

## 2. 四组 CI（已补齐）

`M4-11` 已从 **NOT RUN** 转为 **PASS**。

Run：[42583081805](https://github.com/LNiiuu/rds-mother-system/actions/runs/42583081805) @ `d7cba45`

| Job | 结论 | 耗时 |
|---|---|---|
| required (windows / node 22) | success | 89s |
| required (windows / node 24) | success | 57s |
| required (ubuntu / node 22) | success | 14s |
| required (ubuntu / node 24) | success | 10s |
| structure self-check | success | 18s |
| g1 | success | 27s |

首轮即全绿，无失败需修。逐行日志因 403 不可读，判据与 M3 相同（见 `M4-ci-validation-report.md` §5）。

---

## 3. 本轮修掉的"文档说假话"

| 位置 | 原文 | 实际 | 处理 |
|---|---|---|---|
| `docs/install.md:309` | "当前源码树为 88 项全通过" | 128（M3 后）→ 173（M4 后） | 改为 173 |
| `README.md` 能力表 | CI 链接指向 M2.1 的 run `42479193137` @ `afd423a` | 最新验证是 M3 的 `42575344428` @ `9a6b4a8` | 更新链接；M4 的 run 待回填 |
| `docs/install.md:273` | "serverInfo 0.2.0 属 M5" | M4 已定版本策略并统一 | 改为派生关系 + 指向 `docs/versioning.md` |
| `README` / `install` 的 Node 要求 | `>=22.5` | zstd 需要 22.15 | 全部改为 22.15 并说明原因 |

**未改**：`mars/docs/*` 与 `docs/history|analysis` 里的历史记录（带日期的证据，属 M5 边界）。

---

## 4. 原有 51 项工作

| 检查 | 结果 |
|---|---|
| 开工前 `git status --porcelain -uall` | 51 项 |
| 结束时 | 51 项 |
| 是否有原有文件被提交 | 无（逐个提交核对过 `git diff --cached --name-only`） |
| 是否有原有文件被修改 | 无（B3 期间误删 `mars/var/backups` 下 4 个文件，非 51 项成员，已恢复并校验） |
| 暂存区 | 空 |

---

## 5. 变更规模

| 项 | 数值 |
|---|---|
| 提交数 | 7（B0–B6） |
| 相对 M3 终点改动的已跟踪文件 | 28 个（+2121 / −129） |
| 新增文档 | 8 份 `M4-*.md` + `docs/versioning.md` |
| 新增测试 | 45 例（128 → 173） |
| 第三方依赖 | 0（未变） |
| 数据库 Schema / SQL | 未变（`SCHEMA_VERSION=4`，DDL 逐字节一致） |

---

## 6. 兼容性影响（对外可见）

| 面 | 变化 | 风险 |
|---|---|---|
| `rds ledger` 输出 | 形状不变，但增加了契约校验（不合规时 `LEDGER_CONTRACT_INVALID` + exit 4） | 低：现有输出本身合规 |
| `ledger.schema.json` | `source`/`source_kind` 由 `const` 放宽为 `pattern`；新增顶层 `description` | 无：只放宽不收紧 |
| MCP `serverInfo.version` | `0.2.0` → `0.1.0` | 低：仓库内零依赖 |
| `engines.node` | `>=22.5.0` → `>=22.15.0` | 中：22.5–22.14 会收到 npm 警告，但那些版本本来跑不了 ledger |
| MCP 缺 principals 时 | 由"退出"改为"降级启动 + 每次调用 AUTH_DENIED" | 低：更可用，且告警明确 |
| 未知命令 | 报"未知命令"（exit 2）而不是"认证失败"（exit 3） | 低：更准确 |
| CLI 参数 / JSON 形状 / MCP 工具面 / 数据库 | 未变 | — |

---

## 7. 剩余风险与技术债

| 项 | 等级 | 说明 | 归属 |
|---|---|---|---|
| `m4-b4` / `m4-b5` 在干净克隆里各有 1 例失败 | S3 | 测试依赖本机 `principals.json`；已在 B6 修，历史 tag 不改写 | 已记录，不改历史 |
| 多语句事务未覆盖 | S3 | 现有代码无显式事务 | M5+ |
| 并发写未实测 | S3 | 只验证 `busy_timeout>0` | M5+ |
| `docs/analysis` `docs/history` `mars/docs` 历史材料 | S3 | 本机路径、历史项目名 | **M5** |
| `ledger.json` 里 `path` 是本机绝对路径 | S3 | 改输出会变更公开形状 | 待授权 |
| 只有 `ledger` 有子命令帮助 | S4 | 其余 16 个子命令"缺参数即报错" | S4 |
| `render-role` 等投递命令未实现 | S4 | 路线图后置 | 后续 |
| macOS 未验证 | S4 | 无设备 | — |

---

## 8. 判定

**READY FOR COMMIT**

- 15 项验收全部 PASS（含四组 CI 真实通过）；
- 门禁：`GATE PASS 173/173/0/0`；分层 `problems=0 warnings=2`（2 条为永久边界声明）；
  7 面行为基线零漂移；发行包 `PACK PASS + SMOKE PASS`；
- 回滚：B0–B3 clean revert 前后全绿；B4/B5 暴露的"测试依赖本机产物 + MCP 缺身份即退出"
  已在 B6 修复并加回归测试（B6 演练：173 → 171/170/1 → 173）；
- 警告项集中在"未验证"而非"已知坏"：macOS、并发写、多语句事务、精确 22.15 边界。
