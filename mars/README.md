# MARS — Memory & Retrieval Subsystem

MARS 是 RDS 的**本地记忆与上下文引擎**：记忆存储、检索、上下文编译、清单去重、预算、Token 账本与 MCP 网关。

**主文档不在这个目录。** 从 [docs/README.md](../docs/README.md) 开始；本文只说明 `mars/` 这一层的结构。

---

## 先读哪份

| 你想做什么 | 读哪份 |
|---|---|
| 把它跑起来 | [docs/quickstart.md](../docs/quickstart.md) —— 10 分钟最小闭环 |
| 装到干净机器 | [docs/install.md](../docs/install.md) |
| 改代码前搞清分层 | [docs/PROJECT-MAP.md](../docs/PROJECT-MAP.md) |
| 查 MARS 的历史设计 | [mars/docs/README.md](docs/README.md) |

---

## 目录

| 路径 | 内容 | 进发行包 |
|---|---|---|
| `src/` | 引擎实现：5 个端口、8 个适配器、组合根、22 个域文件 | 是 |
| `contracts/` | 4 份 JSON Schema（memory / context-packet / manifest / ledger）+ role-routing | 是 |
| `config/` | `role-routing.json`（角色路由）、`principals.example.json`（身份示例） | 仅这两个 |
| `tests/` | 173 项 Required 测试 + External 测试 | 否 |
| `scripts/` | 运维脚本：备份、回滚、MCP 注册表操作、开发期压测 | 否 |
| `docs/` | 历史设计与评审记录（40 份，索引见 `docs/README.md`） | 否 |
| `experiments/` | P4 成本/质量对照实验数据 | 否 |
| `var/` | 运行时数据库与产物（`.gitignore` 排除） | 否 |

---

## 运行形态

- 单进程 Node.js ≥ 22.15，零第三方依赖（只用 `node:*` 内置模块）
- 存储：`node:sqlite` + FTS5 + JSON 文件
- 身份：调用方携带 opaque token；服务端只存 `sha256(token)`，映射到 `{principal_id, project_ids[], roles[]}`；未知 token 一律拒绝
- MCP：`src/mcp-stdio.js` 是 stdio 服务（5 个工具），身份由**进程环境**绑定，调用方无法在工具参数里指定 principal
- 配置是**启动快照**：改 `config/role-routing.json` 后需重启 MCP 才生效

---

## 命令

全部命令由 `rds` 入口提供，不在本目录单独调用。查看用法：

```bash
rds --help
rds help put
rds help share
```

开发期直接跑脚本时（仅源码仓库）：

```bash
node mars/scripts/mars-db-backup.js --verify mars/var/mars.db
node tooling/test-gate.mjs
```

---

## 已知限制

| 项 | 现状 |
|---|---|
| Token 轮换 | 重签 token 文件并重建服务；没有分布式配额 |
| 检索 | 无向量检索；中文在 FTS5 分词不足时回退到分段 LIKE |
| Token 估算 | 按字符启发式估算，不是模型 tokenizer 的精确值 |
| 上下文包 | 不含完整角色卡；角色卡由 RDS 侧渲染注入 |
| 编排器 | 规则引擎 `rule/1.0.0`，离线、可解释，`suggest` 只给建议不自动应用；高风险任务必须人工审批 |
| 并发写 | 只验证了 `busy_timeout > 0`，未做压测 |
| macOS | 未实机验证 |

完整清单见 [docs/install.md](../docs/install.md) §11。

---

## 边界

仅本地离线运行；不访问网络；不读取 `.env` 或凭据文件；不修改宿主的全局配置；不部署公网。
