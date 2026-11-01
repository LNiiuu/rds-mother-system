# RDS 母体系（Reusable Development System）

跨项目复用的研发母体系：新项目挂载本体系即可获得统一的角色、流程、任务协议、证据规范与工具链管理，无需每次重写提示词与流程。

- **版本**：见 `VERSION`（当前 0.1.0，M1-A 骨架）
- **范围**：只含通用资产（A 类）；不含任何具体项目的业务代码、数据与需求。
- **状态**：骨架可用；端到端验证进度见 `docs/acceptance/`。**未验证的能力不得宣称为已验证。**

## 三条底线

1. **不绑定项目**：本仓库内不得出现具体项目名、业务路径、业务数据。项目差异全部由 `project.yaml` 注入。
2. **不冒充权限隔离**：角色卡的只读/可写是提示词级约定；系统级边界只有 DSH 沙箱与审批。任何"已实现权限隔离"的表述都必须附系统级证据。
3. **不把安装当能力**：工具装好≠可用；provider available≠工作流通过；一次成功≠可复用。结论按 E1–E4 标注证据强度。

## 结构

| 目录 | 内容 |
|---|---|
| `core/policies` | 权限、任务管理、验收、MCP、下载、Git 远程、交接、冲突 |
| `core/protocols` | 任务卡、证据协议 |
| `core/roles` | 8 席角色卡（4 常设 + 4 轮换）与变量化模板 |
| `core/workflows` | WF1 需求交付、WF2 多方向研究、WF3 缺陷修复、WF4 方案评审 |
| `core/templates` | project.yaml、交接单、验收单、测试报告、缺陷单 |
| `core/bootstrap` | 新项目加载流程 |
| `core/scripts` | 初始化脚本 |
| `stacks/` | 技术栈适配（weapp、native-bin；后续扩展） |
| `tooling/` | 工具清单、探针、备份/恢复、同步守卫 |
| `rea/` | REA 能力基线与六套分析工作流（W-01…W-06） |
| `docs/` | 任务书、检查记录、验收证据 |
| `tests/self` | 母体系自检 |

## 快速开始

```powershell
# 1. 只读自检（结构、模板、禁用串、JSON 合法性）
powershell -NoProfile -ExecutionPolicy Bypass -File tests/self/run.ps1

# 2. 新项目初始化（在项目目录生成 project.yaml 与骨架，不碰母体系）
powershell -NoProfile -ExecutionPolicy Bypass -File core/scripts/new-project.ps1 -Target D:\Projects\<name> -Stack weapp

# 3. 加载到会话：把 project.yaml、core/roles/roster.md、core/workflows/README.md
#    与对应 stack.yaml 交给总控角色，按 WF 执行
```

## 版本与备份

- Git：本目录为独立仓库；远程为 GitHub Private（接入进度见 `docs/checks/GITHUB.md`）。
- ZIP：`tooling/backup.ps1` → `D:\M1-backups`（仓库外，带 SHA-256）；GitHub 不替代 ZIP。
- 变更：`CHANGELOG.md`；破坏性变更升次版本并写迁移说明。

