# M9-0 基线审计（只读）

**日期**：2026-11-12（+08:00）
**性质**：`EVIDENCE`。本文件记录 M9 开工前的真实状态；实现前未改动任何业务文件。
**开工点**：`ebcdaa3`（M8 文档封版）

---

## 1. Git 与工作区

| 项 | 开工时实测 |
|---|---|
| HEAD | `ebcdaa352c3e957fdb5ebb0e4722f7632da4ae71` |
| 分支 | `main` |
| `origin/main` | `ada78488513db88d3eefb5f89ffdc070c4454331` |
| 同步 | `0 3`（本地领先 3：M7、M8 代码、M8 文档；未推送） |
| 暂存区 | 0 |
| 工作区未跟踪 | **49**（原有受保护工作） |
| Tag | **20**，未改动 |
| 核实时刻 | 2026-11-12T13:05Z（21:05 +08） |

49 项受保护工作的指纹（SHA-256 前 16 位 + 字节数）在 M9 结束时逐项复核：
**0 变化 / 0 新增 / 2 已入库**（M5-B6 有意提交的两个模板）。

---

## 2. 现有测试与门禁

| 项 | 开工时 | M9–M11 完成后 |
|---|---|---|
| `npm test` | 210 / 210，fail=0 skip=0 | **228 / 228** |
| `npm run layers` | PASS（2 warning） | PASS（2 warning） |
| `npm run config` | PASS | PASS |
| `npm run docs:check` | PASS | PASS |
| `baseline-capture --check` | PASS | PASS（新文件已登记） |
| `rds doctor` | ok，11 项，1 warn（paths:docs） | ok，11 项，2 warn（paths:docs、paths:assets） |
| Node | v22.22.2 | 同 |
| 依赖 | 0 个第三方运行时依赖 | 同 |

> 在 Windows 工作区里 `paths:assets` 变成 warn，是因为 M9–M11 新增的活跃文档里
> 出现了一处本机绝对路径示例（`D:\M7-lab`）。这是文档卫生问题，不是功能缺陷；
> 已登记为已知告警，不在本轮修（避免为了消警告改写证据）。

---

## 3. 现有架构与可复用能力

```
bin/rds.mjs                 入口（version/doctor/validate/test 内建）
mars/src/cli.js             CLI 分发（22 个命令 → 28 个）
mars/src/composition.js     组合根：paths / assets / routing / identity / openDb / projectRoots
mars/src/compiler.js        上下文编译（sec_task / facts / decisions / prohibitions / evidence）
mars/src/budget.js          分节裁剪（保护 L0 类分节）
mars/src/manifest.js        片段、哈希、可恢复原文
mars/src/store.js           记忆写入与审批
mars/src/authz.js           角色、项目成员、类型可见性
mars/src/orchestrator.js    旧编排（关键词分类，M11 保留但不再依赖）
mars/src/adapters/*         5 个端口适配器 + M9 新增 fs-project-roots
```

可直接复用：SQLite + FTS5、记忆/审批、分节编译、预算裁剪、manifest 片段、审计表、
组合根依赖注入、分层检查、行为基线、打包与冒烟脚本。

---

## 4. 需要新增的能力（M9–M11）

| 能力 | 现状（开工时） | 需要做什么 |
|---|---|---|
| 多项目根目录 | 只有 `projects(project_id, display_name, owner, policy, created_at)` | 加 root_path/status/config/updated_at；realpath；软删除 |
| 上下文预算 | 只有 `--budget` 裁剪 | 模型窗口、预留、使用率、状态阈值 |
| 上下文监控 | 无 | `context_runs` 表 + 每次 compile 记录 |
| 自动压缩 | 无 | 去重/折叠/归档 + 原文恢复 + L0 保护 |
| 角色权限 | 代码只强制 R0/R4（记忆动作） | R0–R7 权限表 + 新命令校验 |
| 任务流转 | 只有 orchestrator_runs（计划/反馈） | 11 态任务机 + 事件表 |
| 调度 | 关键词分类，会把「实现并补测试」判成 verification | 拆分为实施 + 验证，显式覆盖 |
| 交接 | 无 | 交接包 + 最小上下文编译 |
| 成本账本 | 无（`feedback --tokens` 手填） | `costs` 表 + 估算/实际分离 |

---

## 5. 风险与兼容性

| 风险 | 处理 |
|---|---|
| Schema 变更破坏旧库 | 只加表、只加列；`migrate()` 幂等；SCHEMA_VERSION 4 → 5；旧行不改写 |
| 新命令改变 `--role` 语义 | `--role` 仍是「当前执行角色」；指派目标用 `--to-role` |
| `--root` 与项目根冲突 | 项目根改用 `--project-root`；`--root` 保持安装根语义 |
| 压缩丢信息 | L0 不改；无收益/L0 被改一律回退；原文 + SHA-256 可恢复 |
| 角色权限被误解为沙箱 | 文档与报告统一写「代码校验，不是进程隔离」 |
| 包体积/文件清单漂移 | 新文件登记进 `approved-additions.packFiles` |

---

## 6. 结论

基线干净：HEAD 明确、49 项受保护工作零漂移、20 Tag 未动、210 测试全绿。
具备在现有架构上增量实施 M9–M11 的条件；不需要重写，也不需要引入新依赖。
