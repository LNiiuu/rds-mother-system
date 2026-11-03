# MARS WP-5 定向复核报告（Round 2）

- 角色：R4-审查（只读定向复核）
- 复核对象：R0 对 WP-5 首轮终审 6 项 must-fix（`docs/plan/wp5-review.md` 的 F-01…F-06）的修复
- 仓库 / MARS 根：`D:\M1` / `D:\M1\mars`；HEAD `07f0a1e03cc9425c5ab4092f15e6778264b7b523`（main），暂存 0
- 关键快照：2026-11-03T21:42:41+08:00（文件稳定观察至 21:45:43）
- 约束：只读；仅新增本文件；未联网；未读取 `config/principals.json`、`var/mcp/tokens/*` 明文；未执行 git 写操作
- 命令环境：PATH `node` = `C:\Users\liuch\AppData\Local\Programs\DSH\resources\core\node\node.cmd`（设置 `ELECTRON_RUN_AS_NODE=1` 后调用捆绑运行时）；测试均以 `node ...` 形式执行，未直接调用 `DSH.exe --test`

## §0 结论：不具备冻结条件（NO）

F-01、F-04、F-05、F-06 达标；**F-02、F-03 仍为 PARTIAL**；另有 2 项文档一致性/流程问题（M-3、M-4）。冻结条件 = 6 项 must-fix 全部 PASS 且冻结快照不再变动，两条均未满足。

当前不是“修复未做”，而是“修复后仍有 2 个可直接改好的文档缺陷 + 快照尚未定稿”。预计完成 M-1…M-4（4 处文档编辑 + 一次清单重生成）后可再次请求冻结复核。

| 编号 | 对应 | 问题 |
|---|---|---|
| M-1 | F-03 | `docs/plan/wp5-integration.md:49` 的会话路径丢失全部 `\`，无法按写出的路径复现（`test-report.md:58` 的路径正确） |
| M-2 | F-02 | `docs/p2-p6-acceptance.md:75` 指向 `docs/plan/wp5-review.md` 的“附录”，该文件没有附录（止于 §5）；且“F-01…F-06 已全部修复”写于本轮复核之前，本轮仍有两项 PARTIAL |
| M-3 | F-01/F-02 | `docs/plan/wp5-integration.md:15` 的 768,059 B 已落后于当前清单 768,113 B；且本报告落盘后清单必须重生成（119→120 文件）才能作为冻结指纹 |
| M-4 | 文档 | `docs/plan/test-report.md:56-57` 的压力延迟/令牌区间是旧版脚本（未复制 `-wal`/`-shm`）的结果，与当前脚本实测不一致 |

## §1 逐项结果

| 项 | 结论 | 命令与关键输出 |
|---|---|---|
| F-01 清单 | **PASS** | 快照 21:42:41：`file_count` **119**、`files` 数组 119、`total_bytes` **768,113**、声明 size 求和 **768,113**（差 0）；逐文件重算 `mismatched=0`、`missing=0`；清单 29,738 B，外部 SHA-256 `4eb5adc1171ce7c77471af8ea1270e6841e93b9e16462ba55e2267b0743d2e1a`；`Test-Path 'D:\M1\mars\c.name).join('` 与 `'D:\M1\mars\x.name)'` 均为 False；全量枚举（排除 `var/**`、`experiments/p4/var/**`、`config/principals.json`、清单自身）恰为 119 个文件、0 字节文件 0 个；`excluded` 记录 `var/**`、`experiments/p4/var/**`、`config/principals.json`、清单自身、0 字节文件，且无被排除路径出现在 `files` |
| F-02 验收 | **PARTIAL** | `docs/p2-p6-acceptance.md` 7,435 B，`{{`/`}}` 命中 **0**；§5 已改为引用清单：文件数“以清单 `file_count` 为准（冻结时约 120，含两份 R4 审查报告）”、总字节“约 768 KB”、manifest SHA “以最终冻结交付消息为准”；但 §6（第 75 行）称“复核定论见交付消息与 `docs/plan/wp5-review.md` 附录”，该文件 24,063 B、标题仅 §0–§5（`§5 证据边界` 收尾），**不存在附录**；§6 的“F-01…F-06 已全部修复”早于本轮结论 |
| F-03 长会话 | **PARTIAL** | 会话文件 6,467,396 B、mtime `2026-11-03 19:25:00`、SHA-256 `f2d4c809a8d620fc151631e11381394276a9e30643267da2c3df4fa74c6aee17`（稳定）；`ledger.parseSession` → session `ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef`、`usage_events=682`、usage total **114,188,173**（input 2,195,837 / output 790,288 / cacheRead 111,202,048 / cacheWrite 0）。`test-report.md:58-59` 路径完整、SHA/事件数/总量全部一致；`wp5-integration.md:49` 写出的路径为 `C:Usersliuch.dshsessions--C-Users-liuch-Desktop-~8BA1~5212qpp--ab2cb09e-e6c3-45e0-839e-ecfa1e6697efsession.v4.jsonl.zstd`（`contains-backslash=False`），**不可复现**，但同处的 SHA/大小/事件数/总量正确 |
| F-04 压力 | **PASS** | `scripts/wp5-stress.js` 3,655 B：L18-21 复制 `db` + `-wal` + `-shm` 到临时目录；L28-38 泄漏判据为通用断言 `status !== 'approved' || (visibility === 'role' && !scope.includes(role))`，用 `JSON.stringify(packet.sections).includes(id)` 检查；实跑 `node scripts/wp5-stress.js` EXIT=0、4,980 ms：`ok:true`、`iterations:240`、`leaks:0`、`leak_samples:[]`、`forbidden_checked {R0:2,R1:2,R2:2,R3:1,R4:2}`、p50 **19.21 ms** / p95 **22.62 ms** / max **27.32 ms**；临时目录已清理，生产库未被写 |
| F-05 回滚 | **PASS** | `rollback-drill.md` 3,200 B：v4 + 备份 `mars-2026-11-03T13-20-52-532Z.db`；备份实测 245,760 B、SHA-256 `4ee89fd25b4c5c9d22735fc62fab78d911240682971688f96786498c3b8d114d`，只读查询 `schema_version=2`、`integrity=ok`、行数 memories 9 / fragments 20 / manifests 22 / audit 196 / rate_limits 0，与 drill 一致；`mars-rollback.ps1` 1,629 B：L17 删除范围正则、L18-23 `-RemoveTokens` → `var/mcp/tokens/*.token`、L25-28 `-RemovePrincipals` → `config/principals.json`、L33 `-Yes` 闸门；干跑（未加 `-Yes`）EXIT **2**，列出 `mars.db` / `mars.db-shm` / `mars.db-wal`、`R0…R4.token`、`UNKNOWN.token`、`principals.json`，末行“未加 -Yes，未执行删除。”；`README.md:61`、`docs/mcp-access.md` §5 删除范围与脚本一致（一处措辞见 §2） |
| F-06 文档数字 | **PASS** | 当前口径统一为 `ledger 8 / mcp 6 / phase1 42 / phase2 6 / phase3 5 / phase4 7 / wp1 6`：`README.md:54` 已写 80 用例，`architecture.md:666`、`p2-legacy-matrix.md:45` 于 21:42:24 改为 8/6；`61 用例`、`未实现调用频率` 已无当前口径命中；`6,382,820` 仅 `wp5-integration.md:52` 明确标注“历史值…已废弃”；`9 / fragments 20` 仅见 v2 备份基线（`rollback-drill.md:9`）与历史审查。实测 `node --test`（15 个文件）：`# tests 80 / # pass 80 / # fail 0`，`duration_ms 2038.4894`，EXIT=0 |
| 交叉项 | **PASS** | HEAD 未变 `07f0a1e03cc9425c5ab4092f15e6778264b7b523`；暂存 0；`status --porcelain -uall` 191 行 = 120 mars 未跟踪 + 71 非 mars（本文件落盘后为 192）；非 var 文本文件 token 形态扫描 0 命中（未读取凭据文件） |

## §2 残留问题

### must-fix（阻塞冻结）

1. **M-1（F-03，中）会话路径不可复现。**
   - 位置：`docs/plan/wp5-integration.md:49`。
   - 实测：该行反斜杠全部丢失，PowerShell 检查 `-match '\\'` 为 False。
   - 正确值：`C:\Users\liuch\.dsh\sessions\--C-Users-liuch-Desktop-~8BA1~5212qpp--\ab2cb09e-e6c3-45e0-839e-ecfa1e6697ef\session.v4.jsonl.zstd`。
   - 修复：改成反斜杠路径（或正斜杠/代码块），与 `docs/plan/test-report.md:58` 一致即可。数值本身无需改。

2. **M-2（F-02，中）验收报告引用不存在的附录。**
   - `docs/p2-p6-acceptance.md:75`：“复核定论见交付消息与 `docs/plan/wp5-review.md` 附录”。
   - 实测 `docs/plan/wp5-review.md`（24,063 B，mtime 21:35:31）最后一个标题是 `## §5 证据边界`，无附录。
   - 同时“F-01…F-06 已全部修复”应改为“按 Round-2 复核结果更新”（本轮 F-02/F-03 为 PARTIAL）。
   - 修复：删除“附录”引用，或实际补附录；二选一，不能保留悬空引用。

3. **M-3（清单/文档一致性，中）总字节与冻结指纹需重算。**
   - `docs/plan/wp5-integration.md:15`：`119 文件 / 768,059 B`；当前清单为 `119 / 768,113 B`（21:42:41）。差异 54 B 来自清单生成后 `acceptance +20 B` 与 `wp5-integration +34 B`。
   - 冻结流程：本报告落盘 → 重生成清单（应为 **120 文件**，含 `wp5-review.md` + `wp5-review-round2.md`）→ 计算并发布最终 manifest SHA-256 → 回填 `p2-p6-acceptance.md` §5 和 `wp5-integration.md` §1 中仍写精确值的位置。
   - 注意：清单不得把自身哈希写入自身；当前 `excluded` 已正确排除自身与 0 字节文件，重生成时必须保持。

4. **M-4（F-04 文档，低）test-report 压力数字是旧脚本口径。**
   - `docs/plan/test-report.md:56-57`：p50 20.76 / p95 25.83 / max 49.4 ms；tokens R0 305–306、R1 297–298、R2 189–190、R3 345–346、R4 293–294。
   - 本轮实测：p50 19.21 / p95 22.62 / max 27.32 ms；tokens R0 353–354、R1 345–346、R2 189–190、R3 393–394、R4 341–342（与 `wp5-integration.md:45-46` 一致）。
   - 旧值与当前脚本（复制 wal/shm 后）不是同一口径；建议重跑后同步，或明确标注“旧版脚本、历史值”。

### acceptable（记录，不阻塞）

1. `docs/mcp-access.md:81` 写“`-RemoveTokens` 删除 token 目录”，脚本实际删除 `var/mcp/tokens/*.token` 文件（目录保留）。影响小，建议改为“删除 token 文件”。
2. 历史文档保留旧值且未逐条标注：`docs/phase2-acceptance.md`、`docs/phase2-g1-security-report.md`、`docs/phase2-git-status.md`、`docs/phase2-review-round2.md`、`docs/plan/p2-p6-execution-plan.md`、`docs/plan/wp1-review.md`、`docs/plan/wp5-review.md`、`docs/architecture.md:595`（v1.3 修订行）。这些是带日期/轮次的阶段产物，按历史记录理解；若冻结要求逐条标注，可另行处理。
3. 压力延迟 max 波动大（本轮 27.32、文档 61.52、首轮 66.46、test-report 49.4），属运行噪声；p50/p95 稳定（约 19.2 / 22.6 ms），不影响泄漏判据。
4. 清单生成器未入库（`src/`、`scripts/` 中无 `candidate-manifest` 引用）：清单可独立校验，但重生成过程不可从仓库直接复现。建议补一个只读生成器（非冻结阻塞）。
5. `p2-p6-acceptance.md` §5 “含两份 R4 审查报告”在本报告落盘前不成立（当前清单只含 `wp5-review.md`）；按 M-3 重生成后自然成立。

## §3 证据边界

- **快照与漂移**：复核期间冻结文档仍在修改——清单 21:38:27 为 767,976 B → 21:39:10 为 768,059 B → 21:42:41 为 **768,113 B**（29,738 B，SHA `4eb5adc1…2e1a`）；`p2-p6-acceptance.md` 21:39:04（7,415 B）→ 21:42:41（7,435 B，SHA `3c5605a5…347f`）；`wp5-integration.md` 4,614 → 4,648 B（21:42:24，SHA `822ad91d…23ff`）；`architecture.md:666`、`p2-legacy-matrix.md:45` 于 21:42:24 修正 7/7。21:42:41 后至 21:45:43 无变化。本报告所有数值以该快照为准；本文件落盘（+1 文件）会使清单再次过期，必须按 M-3 重生成。
- **只读性**：未执行 git 写操作；HEAD、暂存、porcelain 仅只读检查；未联网；未读取 `config/principals.json` 与 `var/mcp/tokens/*` 明文（仅核对文件名/删除范围与 manifest 排除项）；生产库本轮未打开，`mars.db` / `-shm` / `-wal` 的 mtime 保持 `20:12:15` / `20:12:16` / `21:22:06`；备份库以 `{ readOnly: true }` 打开。
- **测试命令**：`node --test --test-reporter=tap <15 个 tests/**/*.test.js>`。直接 `node --test tests` 在当前运行时被当作模块路径（`Cannot find module 'D:\M1\mars\tests'`），故用 `Get-ChildItem -Recurse -Filter *.test.js` 展开；两次运行均 80/80。
- **未复核/未覆盖**：未重跑“复制备份→openDb 迁移到 v4”演练本身（仅只读查询备份，drill 记录为 21:37 前完成）；未复核真实 MCP 调用（首轮已做）；未对全部非 var 文件做语义审查，仅做数值/哈希/敏感形态扫描。
- **判定口径**：PARTIAL 指该项要求未全部满足，且缺陷可在不改变代码/数据的前提下用文档编辑修复。
