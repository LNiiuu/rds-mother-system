# P2 遗留问题关闭/接受风险矩阵（P2–P6 WP-1 交付）

来源：`docs/phase2-review.md`（R4 第一轮）、`docs/phase2-review-round2.md`（R4 第二轮 + §8 定向复核）、`docs/phase2-g1-security-report.md`。
判定口径：已关闭 = 代码/文档修复且有测试或复跑证据；已接受 = 有明确理由、影响与后续动作；转入 Phase 2.1 = 不影响冻结但需后续处理。
Git/Git 状态：本轮未 commit/push；证据文件均在 `D:\M1\mars`。

## 1. 第一轮 5 个 medium（F-01…F-05）

| ID | 问题 | 处置 | 证据 | 状态 |
|---|---|---|---|---|
| F-01 | `mcp-stdio.js` 无 `--enable` gate，文档/G1 报告口径失实 | 文档改为“默认不注册 + 每实例 token/角色绑定”；`cli.js mcp --enable` 标注为旧离线网关 | `docs/mcp-access.md` §8；`src/mcp-stdio.js` 每进程绑定 `MARS_TOKEN_FILE`+`MARS_ROLE` | 已关闭 |
| F-02 | 服务端不校验 inputSchema（`memory_list {status:'bogus'}` 成功） | 新增 `validateToolArgs()`：未知字段/非法枚举/越界 → `INVALID_ARGUMENT`；先验参后判项目 | `src/mcp-stdio.js` `validateToolArgs`；`tests/phase2/mcp-stdio.test.js` | 已关闭 |
| F-03 | R2 可 propose L3（越权类型） | `store.propose` 按 routing 校验 `allowed_types`；越界 `ROLE_TYPE_DENIED`；routing 缺失 fail-closed | `src/store.js` `resolveRouting`；`tests/phase2/mcp-stdio.test.js` | 已关闭 |
| F-04 (P10) | `store.review` 无状态迁移校验 | TRANSITIONS 表：`proposed→approved\|rejected`、`approved→superseded\|deprecated`；同态 `STATE_UNCHANGED`（写 noop 审计）、非法 `INVALID_TRANSITION` | `src/store.js`；`tests/phase2/mcp-stdio.test.js` | 已关闭 |
| F-05 | G4 报告缺会话 ID、均值标签错误、cacheRead 区间错误 | 补 6 个 session_id、全量/剔除首次均值分列、cacheRead 15.3%–84.9% | `docs/phase2-g4-ab-report.md` | 已关闭 |

## 2. 第二轮 7 个 low（N-01…N-07）与 §8 新增 N-08/N-09

| ID | 问题 | 处置 | 状态 |
|---|---|---|---|
| N-01 | 边界拒绝不写审计 | `callTool` 的 `fail()` 写 `target='boundary'` 审计（未认证 principal 记 `unauthenticated`） | 已关闭 |
| N-02 | 成功调用双审计 | 成功路径只保留 store 审计；仅 stats 成功与执行错误补审计 | 已关闭 |
| N-03 | propose 类型门 opt-in（无 routing 跳过） | `resolveRouting()`：显式 routing 优先，否则加载配置文件，失败 `ROUTING_UNAVAILABLE`；seed 传 routing | 已关闭（代码）；文档已注明 |
| N-04 | G2 文档跨项目错误码写成 `AUTH_DENIED` | 改为 `PROJECT_DENIED` | 已关闭 |
| N-05 | G3 文档漂移（复编译用 R2、审计计数旧快照） | 标明“修复前快照/12:14 旧计数”，复编译改用 R3 | 已关闭 |
| N-06 | G1 §8 措辞与实际启用方式不一致 | 改为“默认不注册 + 每实例绑定” | 已关闭 |
| N-07 | propose schema 缺 `source_version` | schema required 增加 `source_version` | 已关闭 |
| N-08 | `memory_stats` 用 `store.list` 的 limit 200 少计 | 改为全量查询 + `store.canRead()` 过滤，返回 `scope:'visible_to_caller'` | 已关闭 |
| N-09 | G1 文档测试数 60/60 | 更新为当前 80/80（历史值保留于变更记录） | 已关闭 |

## 3. 接受项（不阻塞冻结）

| 项 | 说明 | 影响 | 后续 |
|---|---|---|---|
| `tools/list` 未认证 | MCP 协议规定 `tools/list` 先于认证；工具清单本身非敏感 | 低 | 已在 G1 报告 §7 记为接受风险 |
| 历史 2 条 L3 记忆由 R2 创建 | `mem_0db463660da4`、`mem_3bc9a242489d`（`created_by=mcp-R2`）为越权类型时期产物 | 数据语义已批准、内容可信；创建者标注失真 | `docs/plan/p2-legacy-annotations.md` 记录；未来 deprecated 后由 R1 重提 |
| 进程内限流与持久限流并存 | 持久 `rate_limits` 为权威；进程内 120 次/分钟为快速拒绝 | 双计数口径不同 | 已在 `docs/governance.md` 说明 |
| 无 token 自动轮换 | 仅支持 `--revoke` 与重签 | 低 | 运维按 `docs/mcp-access.md` §7 执行 |

## 4. 结论

- blocker/high：**0**（R4 两轮 + WP-1 复核均未发现 blocker/high 残留）。
- P2 遗留 medium：**5/5 关闭**；low：**9/9 关闭**（N-01…N-09）。
- 接受项 4 条均有理由、影响与后续动作，不阻塞冻结。
- 测试基线：`node --test` **80/80 PASS**（ledger 8 / mcp 6 / phase1 42 / phase2 6 / phase3 5 / phase4 7 / wp1 6）。
