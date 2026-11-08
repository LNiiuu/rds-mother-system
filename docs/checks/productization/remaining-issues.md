# 遗留问题清单

> 范围：本轮（M1 + M2）结束后仍未解决的问题。
> 每条给出影响、严重程度、建议与「是否阻塞 M3」。

严重程度定义：**S1** 阻断使用 / **S2** 可用但结果不可信或不可移植 / **S3** 认知与维护成本。

---

## 1. CI 未真实运行

| 项 | 内容 |
|---|---|
| 现象 | `.github/workflows/ci.yml` 已写好，但本轮禁止 push，GitHub Actions 从未执行 |
| 影响 | 「双平台绿灯」目前只有 Windows 本地证据；Ubuntu 与 Node 24 未验证 |
| 严重程度 | **S2** |
| 建议 | 授权 push 后立即跑一次；把结果回填到 `ci-validation-report.md` |
| 阻塞 M3？ | **是（软性）**。M3 要做解耦重构，没有 CI 守门等于盲改。建议先跑通 CI 再进 M3 |

## 2. Ubuntu / macOS 未实机验证

| 项 | 内容 |
|---|---|
| 现象 | 本机 `wsl.exe` 被安全策略拦截；无 macOS 设备 |
| 影响 | 跨平台结论为 E3（静态推断 + 代码去耦），不是 E1 |
| 严重程度 | **S2** |
| 建议 | Linux 由 CI 覆盖；macOS 需要一台真机或 `macos-latest` runner |
| 阻塞 M3？ | 否。但 M3 会移动 `ledger` 与 MCP 注册表逻辑，跨平台差异越早暴露越好 |

## 3. `tests/self/run.ps1` 仍有 1 项 FAIL

| 项 | 内容 |
|---|---|
| 现象 | `no project-specific strings` 失败：20 文件 46 行含具体项目名 |
| 命中分布 | 全部在 `docs/analysis/`、`docs/history/`、`mars/docs/`；**活跃资产为 0** |
| 影响 | 结构自检长期红；CI 中设为 `continue-on-error` 并标注 known-red |
| 严重程度 | **S3** |
| 建议 | 清理文档（M5）。改写历史证据需要先确定「哪些是证据、哪些是草稿」 |
| 阻塞 M3？ | 否 |

## 4. `serverInfo.version` 与 `VERSION` 不一致

| 项 | 内容 |
|---|---|
| 现象 | `VERSION` = `package.json` = 0.1.0，MCP `serverInfo.version` = 0.2.0 |
| 影响 | 客户端看到两个版本号，排障时容易误判 |
| 严重程度 | **S3** |
| 建议 | 先确认 RDS 与 MARS 是否同一版本体系（任务书 §6.2 要求先定性），再决定统一还是分离 |
| 阻塞 M3？ | 否 |

## 5. G1 工作流仍未提交

| 项 | 内容 |
|---|---|
| 现象 | 70 个未跟踪文件（G1 的 20 个 + 历史材料 50 个），含 `guide` 与 `tooling` 实现 |
| 本轮处理 | 只修了其中 3 个文件的路径，并以补丁归档（`4d863dc`） |
| 影响 | 仓库工作区长期处于「半成品」状态；`git status` 无法归零 |
| 严重程度 | **S2** |
| 建议 | G1 作为一个独立提交整体入库（先跑 `tests/git-review/run.ps1` 复核）；历史材料按 M5 方案迁 `docs/history/` |
| 阻塞 M3？ | 否，但会让「工作区干净」基线不可用 |

## 6. 文档侧仍有 11 个文件含本机绝对路径

| 项 | 内容 |
|---|---|
| 位置 | `docs/checks/git-review/**`（G1 运行记录）与 `mars/docs/plan/candidate-manifest.json` |
| 本轮处理 | `doctor` 单列 `paths:docs` 为 warn，不影响退出码 |
| 严重程度 | **S3** |
| 建议 | 属证据类记录，改写等于篡改；M5 决定归档策略（移入 `docs/history/` 并排除出发行包） |
| 阻塞 M3？ | 否 |

## 7. 缺少 `rds principal` 命令

| 项 | 内容 |
|---|---|
| 现象 | 审批需要第二个身份，目前只能用 `node -e` 脚本追加（`docs/install.md` §7 有可复制片段） |
| 影响 | 首次体验有摩擦，且脚本容易写错 |
| 严重程度 | **S3** |
| 建议 | M5 增加 `rds principal add/revoke/list`，复用 `mars-issue-mcp-identity.js` 的哈希逻辑 |
| 阻塞 M3？ | 否 |

## 8. 运维脚本不随发行包分发

| 项 | 内容 |
|---|---|
| 现象 | `package.json.files` 只含 `mars/src`、`core`、`stacks`、`bin` 等；`mars/scripts/**`、`tooling/**` 未打包 |
| 影响 | 全局安装后没有 `mars-rollback`、`backup` 等运维入口；只能从源码仓库使用 |
| 严重程度 | **S3** |
| 建议 | M5 的生命周期命令（`rds uninstall` / `rds backup`）应直接进 `bin/`，而不是打包旧脚本 |
| 阻塞 M3？ | 否 |

## 9. Node 版本下界只做了声明，未做全区间实测

| 项 | 内容 |
|---|---|
| 现象 | `engines.node >= 22.5.0`；实测仅 22.22.2 |
| 风险 | 22.5–22.x 早期版本可能需要 `--experimental-sqlite`，`zstdCompressSync` 也可能不存在 |
| 现有防护 | `bin/rds.mjs` 版本门禁给出可读错误；`db.js` 的 sqlite 引入失败会提示；测试在能力缺失时 `assert.fail` 而非跳过 |
| 严重程度 | **S3** |
| 建议 | 若要收窄承诺，把 `engines` 提到实测下界并在文档写明；CI 矩阵已覆盖 22.x 与 24.x 的最新补丁版 |
| 阻塞 M3？ | 否 |

## 10. 版本号体系未定型

| 项 | 内容 |
|---|---|
| 现象 | 尚未确定 RDS（流程资产）与 MARS（引擎）是否共用版本号 |
| 影响 | 影响 M5 的发版与 CHANGELOG 结构 |
| 严重程度 | **S3** |
| 建议 | 在 M3 开始前定，避免解耦后出现第二套版本号再改一次 |
| 阻塞 M3？ | 否（但建议先定） |

---

## 汇总

| 等级 | 数量 | 条目 |
|---|---|---|
| S1 | 0 | — |
| S2 | 3 | #1 CI 未运行、#2 跨平台未实机、#5 G1 未提交 |
| S3 | 7 | #3 #4 #6 #7 #8 #9 #10 |

**进入 M3 前建议先做两件事**：跑通一次远程 CI；把 G1 整体入库或明确挂起。
