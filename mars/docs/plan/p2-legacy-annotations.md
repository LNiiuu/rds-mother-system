# P2 历史遗留记录标注（只读核实，不删除、不改语义）

日期：2026-11-03
范围：`D:\M1\mars\var\mars.db` 中 P2 阶段产生的两条 L3 记录。
处置原则（任务书）：只读核实、来源标注、处置建议；未经明确迁移批准，不得删除、覆盖或改变语义。

## 1. 事实

| 字段 | `mem_0db463660da4` | `mem_3bc9a242489d` |
|---|---|---|
| project_id | rds-m1 | rds-m1 |
| memory_type | L3 | L3 |
| status | approved | approved |
| created_by | mcp-R2 | mcp-R2 |
| visibility | project | project |
| source_ref | `mars/docs/mcp-access.md` | `mars/src/mcp-stdio.js` |
| source_version | v0.1 | 0.2.0 |
| content_hash | `9a285d9e…21bf` | `07de554a…6416` |
| 创建时点规则 | P2 修复前，`store.propose` 未强制 `allowed_types` | 同左 |

- R2 的 `allowed_types` 为 `['L1','L2','L4']`，L3 不在其授权类型内；因此按 P3 治理规则，这两条属于**历史越权类型**。
- 二者均被 P2 的 G3 工作流用作“提议 → 审批 → 复编译”的证据，`provenance.approved_by=mcp-R0`（`mem_0db463660da4`）。

## 2. 影响评估

- 数据完整性：记录本身内容真实、来源可定位、审批链可追溯；不影响当前隔离（检索仍按类型/可见性过滤）。
- 规则一致性：若不做标注，后续审计会认为 R2 有权写 L3；因此需要显式标注为历史例外。
- 不可逆风险：删除会破坏 G3 证据链与审计连续性；改写类型会改变语义。两者均不建议。

## 3. 处置建议（本轮不执行）

1. 保留两条记录与审计，状态维持 `approved`（作为历史证据）。
2. 在 `docs/phase2-g3-workflow.md` 与本文档标注“历史例外：创建于类型门修复前”。
3. 若未来需要合规收敛：经用户批准后，将它们 `deprecated`（而非删除），并在新版本中重提议、由具备 L3 权限的角色（R0/R1/R3/R4）审批。
4. 新增回归：`store.propose` 在无 routing 时也必须拒绝越权类型（已由 `tests/phase2/wp1.test.js` 覆盖）。

## 4. 证据命令

```powershell
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('D:/M1/mars/var/mars.db',{readOnly:true});console.log(db.prepare(\"SELECT memory_id,memory_type,status,created_by,source_ref FROM memories WHERE memory_id IN ('mem_0db463660da4','mem_3bc9a242489d')\").all())"
```
