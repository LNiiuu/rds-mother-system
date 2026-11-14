# M21–M25 发布前审计（GitHub Push 前）

**日期**：2026-11-14（+08:00）
**仓库**：`D:/M1`，branch `main`
**审计对象**：代码基线 `04fb86b` + 本文件所在的文档提交
**origin/main**：`ada7848`
**远程写入**：**未执行**。无 Push / PR / Merge / Release / Tag 推送。
**远程只读查询**：上次成功（2026-11-14 定稿）为 `ada7848`；本轮若失败则标 `BLOCKED`，以最终报告为准。

> 本文件与 M21–M25 文档在同一提交中落盘；提交后 HEAD 会变化，最终值以
> `git rev-parse HEAD` / `git rev-list --count origin/main..HEAD` 为准。
> 审计的是内容与范围，不是某个固定哈希。

---

## 1. Git 状态

| 项 | 值 |
|---|---|
| 代码 HEAD（审计时） | `04fb86b` |
| 本轮新增提交 | `3a8f15c`（M21–M23 代码）、`04fb86b`（M22 复核修复）、`8ea84c2`（M21–M25 文档+两轮审核）、`9330878`（总体验收/发布审计）、本次 docs-only 提交（README/PROJECT-MAP/历史路径） |
| 相对 origin/main | **25 ahead / 0 behind**（含本次 docs-only 提交） |
| merge commit | 0（线性） |
| Tag | 20 个，均未指向本轮提交 |
| 暂存区 | 提交时仅包含明确路径 |
| 未提交 | 50 项受保护工作（49 未跟踪 + 1 格式修改）；不含任何 M21–M25 产物 |

**本轮代码提交范围**（`3a8f15c` + `04fb86b`，共 17 文件）：

- 平台端口/注册表/客户端：`mars/src/ports/platform-adapter.js`、`platform-registry.js`、`platform-client.js`
- 四个适配器 + 工厂：`platform-memory/http/dsh/workbuddy/factory.js`
- 本地模型 Provider：`provider-ollama.js`
- 组合根：`composition.js`（120 行上限内）
- REA：`tool-registry.js`（`MARS_*_PATH`）、`w05-pcap.js`（TShark 交叉核验）
- 测试：`platform-adapters.test.js`、`provider-ollama.test.js`
- 工具：`tooling/m21-ollama-verify.cjs`、`tooling/m19-rea-evidence.cjs`

累计 25 个提交（`origin/main..HEAD`）共 207 文件、+31,401/−118；审计基线 `9330878` 为 24 提交 / 207 文件 / +31,376/−114。其中大部分是 M7–M20 的历史成果，
不是本轮新增。发布审批应把它当作**整个 M7–M25 的首次推送**，而不是只审 M21–M25。

---

## 2. 测试与门禁（提交前实测）

| 命令 | 结果 |
|---|---|
| `npm test` | **318 / 318 PASS**（本文件落盘后复跑） |
| `npm run layers` | PASS，problems=0，warnings=2（`cli.js`、`util.js` 永久白名单） |
| `npm run docs:check` | PASS（本文件落盘后） |
| `npm run config` | PASS（json=94 / yaml=4） |
| `npm run baseline` | PASS（7 个面一致，含登记增项） |
| `npm run pack:check` | PASS（153 文件 / 234.9 kB packed / 719.2 kB unpacked） |
| `git diff --check` | 本轮文件无新增空白错误；受保护 M9–M11 工作区版本有既存行尾空格（未动） |

测试增量：302 → 318（+16）= 平台 10 + Ollama 6。

---

## 3. 变更范围与架构

### 3.1 分层

- 平台端口零 require、5 方法，`layers` 通过；
- 域层不 require `adapters/platform-*`；
- 组合根只暴露 `platformCatalog` / `platformFor`，仍为 120 行（脚本口径）；
- WorkBuddy/DSH 协议细节只在 `adapters/platform-*.js`。

### 3.2 本轮新增能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 平台适配端口/注册表 | **IMPLEMENTED** | 5 方法、9 能力、10 消息类型、7 错误码 |
| HTTP/内存/DSH/WorkBuddy 适配器 | **IMPLEMENTED（合成/契约）** | HTTP/文件队列真实；WorkBuddy/DSH 宿主 NOT RUN |
| Ollama Provider | **IMPLEMENTED** | 真实协议代码；真实推理 BLOCKED |
| TShark W-05 | **REAL（合成样本）** | 4.6.9，frame=4 与内置解析一致 |
| 平台→RDS 端到端 | **NOT RUN** | 未接入 scheduler |
| 真实模型多 Agent | **BLOCKED** | 无有效模型 |

---

## 4. 敏感信息与隐私

- 密钥特征扫描（`sk-`/`ghp_`/`github_pat_`/`AKIA`/`xox*`/私钥头）：本轮提交 **0 命中**；
- 本轮提交无 `liuch`、`C:\Users\...`、`D:/tools/...`；
- W-05 证据已用 `<TOOL_HOME>` / `<TEMP>` 脱敏；
- **历史路径已清理**：M12–M15 的 9 个证据文件中的 `C://Users//...//Temp` 与 `D:/M1-migration` 已替换为
  `<TEMP>` / `<LOCAL_EVIDENCE>`，JSON 仍可解析；旧提交中的 blob 仍在未推送历史里，但 HEAD 不再包含这些路径；
- 仍存在的 `D:/M1-migration` 字样仅用于说明基线/备份路径（M7 基线、发布审计/总体验收自引用、两轮审核引用），不含凭据；
- 工作区两个约 18.5 MB 的 `docs/history/.../*.jsonl` 仍未跟踪，**禁止 `git add -A`**。

---

## 5. 受保护工作

按 `D:/M1-migration/m12-protected-baseline.txt` 逐字节复核：

```text
protected 50  ok 50  changed 0  missing 0
```

本轮提交未触碰 50 项中的任何一项；唯一路径相交的 M9–M11 报告仍是“提交 7,869 B 版本、工作区 11,308 B 受保护版本未提交”。

---

## 6. 发布检查清单

### 必须（已满足）

- [x] 代码与文档用明确路径提交，未使用 `git add -A`
- [x] 受保护 50 项 50/50 零漂移
- [x] 无密钥/私钥/真实令牌
- [x] 全量测试 318/318、layers/docs/config/baseline/pack 全绿
- [x] 无 merge、无 Tag 移动、线性历史
- [x] 远程未写入，Fast-forward 条件成立（0 behind）

### 必须（发布者确认）

- [ ] 用户明确批准 Push（本文件不构成授权）
- [ ] Push 前再次 `git ls-remote origin refs/heads/main` 确认仍为 `ada7848`
      （审计期间两次远程只读查询曾因 `schannel` 失败）
- [ ] Push 命令使用普通 fast-forward：`git push origin main`，不加 `--force`

### 已知限制（不阻塞 Push，但必须随报告公开）

- [ ] M21 真实模型推理 `BLOCKED`（模型下载哈希不符/中断，原始回显见 `m21/download-failure.log`）
- [ ] M23 W-03 JADX `BLOCKED`（zip 不完整 + 无授权 APK）、W-06 Frida `BLOCKED`（无设备）
- [ ] M24 真实模型多 Agent `BLOCKED`、平台→RDS 端到端 `NOT RUN`
- [ ] 平台层权限模型 `NOT IMPLEMENTED`，未接入 scheduler
- [ ] 无容器隔离、无跨进程调度租约、无真实 CI/Linux/macOS 验证

---

## 7. 风险判定

| 风险 | 等级 | 说明 |
|---|---|---|
| 把 PARTIAL 读成“全部完成” | **高** | 报告已逐项标注；Push 说明必须保留 `PARTIAL/BLOCKED` 字样 |
| 公开仓库的历史临时路径 | 低 | HEAD 已清理 9 个 M12–M15 证据文件；旧 blob 在未推送历史中；无密钥 |
| 模型下载损坏被误用 | 低 | 损坏模型已删除；Provider 对 404/超时/取消有错误码 |
| 平台层被误认为已接入生产 | 中 | 文档已标“库 + 契约测试，未接 scheduler” |
| 依赖/安装变化 | 低 | 未新增 npm 依赖；工具为本地可选，未写入 package.json |

**P0**：无（无泄密、无受保护工作破坏、无门禁红灯）。
**P1**：真实模型、平台端到端、W-03/W-06 为产品能力缺口，不是发布阻断；必须以 `BLOCKED` 公开。

---

## 8. 结论

**代码与文档具备 fast-forward Push 条件；产品能力不具备“完成”声明条件。**

建议：

1. 用户审阅本报告、`docs/checks/m25/independent-review.md`、`second-review.md` 与 M21–M24 验收；
2. 明确批准后执行 `git push origin main`（fast-forward）；
3. Push 后用同一份报告作为 Release/说明底稿，保留 `PARTIAL` 与 `BLOCKED`；
4. 网络/凭据/工具恢复后，按 `M21 → M24 → M23` 顺序补真实模型、端到端与 W-03/W-06，不要改写已推送历史。

**判定：`CONDITIONAL GO`（技术可推，能力未完成，需用户授权）。**
