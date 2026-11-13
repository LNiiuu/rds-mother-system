# M21–M25 第一轮独立审核报告

**审核人**：独立 Reviewer（非开发方，不参与本轮实现）
**审核时间**：2026-11-14（+08:00）
**仓库**：`D:/M1`，branch `main`，HEAD `e76053e`，origin/main `ada7848`（ahead 20 / behind 0）
**审核性质**：只读。未修改代码、配置、Git 索引、未暂存、未提交、未 push、未打 Tag。
**唯一写入物**：本文件。

**总裁定**：**不可发布（当前 HEAD）** — 代码与 M21/M22/M23/M24 的自评基本诚实，但 **M25 本身未完成**（无二次复核、无针对当前 HEAD 的发布审计、M21–M25 零提交），且存在 **1 项证据与验收文档数字不一致的 P0**。详见 §7。

---

## 1. 审核范围与方法

### 1.1 实际阅读

| 类别 | 文件 |
|---|---|
| 需求锚点 | `docs/checks/m21-m25/baseline-audit.md`（全文 162 行） |
| M21 | `docs/checks/m21/final-acceptance.md`、`docs/checks/m21/execution-record.json`、`mars/src/adapters/provider-ollama.js`、`mars/src/ports/model-provider.js`、`mars/tests/arch/provider-ollama.test.js`、`tooling/m21-ollama-verify.cjs`（关键行） |
| M22 | `docs/checks/m22/architecture.md`、`mars/src/ports/platform-adapter.js`、`mars/src/platform-registry.js`、`mars/src/platform-client.js`、`mars/src/adapters/platform-{memory,http,dsh,workbuddy,factory}.js`、`mars/tests/arch/platform-adapters.test.js` |
| M23 | `docs/checks/m23/toolchain-audit.md`、`docs/checks/m23/final-acceptance.md`、`docs/checks/m19/{W-01,W-02,W-04,W-05}/result.json`、`docs/checks/m19/W-05/evidence.json`、`docs/checks/m19/final-acceptance.md`（diff）、`mars/src/adapters/rea/{w05-pcap.js,tool-registry.js}`（diff）、`/d/tools/jadx/jadx.zip`（完整性） |
| M24 | `docs/checks/m24/final-acceptance.md`、`docs/checks/m18/{final-acceptance.md,execution-record.json}`、`docs/checks/m20/execution-record.json` |
| 前序审计 | `docs/checks/final/pre-push-independent-audit.md`（全文 571 行）、`docs/checks/final/M18-M20-final-acceptance.md`（关键段） |

### 1.2 实际执行（只读命令）

```text
npm test            -> GATE PASS  tests=317 pass=317 fail=0 skipped=0
npm run layers      -> LAYERS PASS  problems=0 warnings=2（端口 8 / 域 40 / 组合根 120 行 / 上限 120）
node --test mars/tests/arch/rea.test.js          -> 14/14
node --test mars/tests/arch/rea-tools.test.js    -> 3/3
node --test mars/tests/arch/platform-adapters.test.js -> 10/10
node --test mars/tests/arch/provider-ollama.test.js   -> 5/5
node -e "…打印四适配器 describe().capabilities…"      -> 四者完全相同，9/9 全 true
```

环境侧核实（只读）：`/d/tools/wireshark/extract/Wireshark/tshark.exe` 存在（623,272 B）；`/d/tools/jre/jdk-21.0.13+9-jre` 存在；`/d/tools/jadx/jadx.zip` **33,206,272 B 且 `unzip -l` 报 "cannot find zipfile directory"**；`command -v tshark` 查无、`MARS_TSHARK_PATH` 未设置。

受保护工作：按 `D:/M1-migration/m12-protected-baseline.txt` 的 50 条（SHA-256 前 16 位 + 字节数）逐条复算 —— **ok=50 / bad=0 / missing=0**。

### 1.3 明确未做

- 未执行 `tshark`、`objdump`、`jadx`、`frida`；未重跑 REA 六套工作流（会写 `docs/checks/m19/**`，超出只读授权）。
- 未连 Ollama、未发任何模型请求、未使用任何凭据。
- 未做双进程锁 race 注入、未跑 CI、未在 Linux/macOS 验证。
- 上文 §1.2 的 `node -e` 只在内存里构造适配器对象，未落盘到仓库。

---

## 2. 事实快照（可与开发者自述对照）

| 项 | 实测值 | 与文档一致性 |
|---|---|---|
| 全量测试 | 317 / 317 PASS，skipped=0 | 与 `m23/final-acceptance.md:17`、`m21-m25/baseline-audit.md:133`（302→317 增量 +15）一致 |
| 新增测试 | provider-ollama 5 + platform-adapters 10 = 15 | 与 302→317 的增量吻合 |
| 分层检查 | problems=0，warnings=2（`cli.js`、`util.js`，均白名单永久允许） | 一致 |
| 组合根 | `wc -l` = 119；按分层脚本口径 = 120，正好卡上限 | `architecture` 声称"保持行数"成立，但见 P2-4 |
| Git | HEAD `e76053e`，20 ahead / 0 behind，0 merge commit，20 个 tag 均未动 | `baseline-audit.md:14-19` 写"20/0、无 merge"成立；但当时写"origin/main `ada7848`"，现在仍是 `ada7848` |
| 工作区 | 97 项 = 28 已跟踪修改 + 69 未跟踪 | `baseline-audit.md:16` 写"51 项"，那是开工前快照，非造假，但**报告未更新到交付时点** |
| 索引 | 空（`git diff --cached` 无输出） | 无偷跑提交 |
| 受保护 50 项 | 50/50 逐字节一致 | 一致 |
| M21–M25 入库 | **0 个提交**（`git log --all -- docs/checks/m21…` 为空） | **与 M25"GitHub 发布审计"要求冲突**，见 P0-1 |

---

## 3. 逐项结论

### 3.1 M21 本地模型接入 —— **判定：`PARTIAL`，自评属实**

**属实的部分**

1. `provider-ollama.js` 确实是真实协议实现，不是桩：`POST /api/chat`、`stream:false`、`tools[].function` 形状、`message.tool_calls` 解析、`prompt_eval_count`/`eval_count` → `usage_source='provider'`、`AbortController` 超时、错误码映射，均可在 `mars/src/adapters/provider-ollama.js:33-198` 逐行核对。
2. `npm test` 中 `provider-ollama.test.js` 5/5 通过，与 `final-acceptance.md:38` 一致。
3. `execution-record.json` **没有被美化**：`basic/structured/multi_turn/tool_calling/long_context/concurrent` 六项全为 `ok:false` + `PROVIDER_HTTP_404 model 'qwen2.5:3b' not found`，`health.models: []`，`model_present:false`，`verdict:"BLOCKED"`，`total_tokens:0`。**这是本轮最干净的一份证据**——失败被原样留存，没有把 404 / 乱码（`8888…`）当成输出。
4. 损坏模型被 `ollama rm` 删除并明确"不作为任何验证结果"（`final-acceptance.md:61`），符合"不得伪造"要求。

**必须指出的减分项**

- **5 个契约测试 100% 是 mock fetch**。`provider-ollama.test.js:9-24` 的 `fakeFetch` 替换了 `fetchImpl`，没有任何一条测试打真实 socket。真实网络交互只有两处，且都是负路径：`execution-record.json` 的 `failure_path`（11435 端口不可达）与 404。
  因此 `final-acceptance.md:87` 的「Provider 协议实现 PASS」实际含义是"代码形状经注入 fetch 自证"，不是"与 Ollama 真实协议对齐已证明"。文档在 §4 表里把它与"基础对话 BLOCKED"并列而没有降级说明，读者容易读成"协议已验证通过"。**建议改写为 `PASS（离线契约，真实协议未核验）`**（P1-5）。
- `final-acceptance.md:96`「超时/失败恢复 PASS（协议层）」标注了"协议层"，可以接受；但 `provider-ollama.js:155-158` 把 **`AbortError` 一律映射成 `PROVIDER_TIMEOUT`**，而 `cancel()`（`:200-208`）正是通过 `controller.abort()` 实现取消 —— 结果是**用户主动取消会被上报为超时**，错误语义错误（P2-1）。
- `getUsage()` 的 `calls` 字段硬编码为 `0`（`provider-ollama.js:213`），用量账本对调用次数永远失真（P2-1）。
- 下载损坏的结论（`5ee4f07c…` vs 实际 `f5960d1d…`）**只有叙述，没有原始日志**：`docs/checks/m21/` 下仅 2 个文件，没有 `ollama pull` 的输出、没有 `sha256sum` 回显。这是"结论可复核性"缺口（P1-5），不是造假证据。

**结论**：没有把"下载损坏/未推理"写成通过。M21 = PARTIAL 成立。

---

### 3.2 M22 平台适配层 —— **判定：`PARTIAL`，属"设计+库+测试"，不是"接入"**

**属实的部分**

1. 端口是干净的 5 方法：`METHODS = ['describe','healthCheck','receive','send','cancel']`（`ports/platform-adapter.js:19`）；能力键 9 个、消息类型 10 个、错误码 7 个，与 `architecture.md:16` 的"5 方法、9 能力、10 消息类型、7 错误码"逐一对得上。端口零 require，符合 L1。
2. `platform-client.js` 里没有任何 `if (name === 'workbuddy')` 这类平台分支 —— 替换性设计是真的。
3. HTTP 适配器确实起真实 `http.Server` 走 `127.0.0.1` 往返（`platform-adapters.test.js:26-70,150-170`），不是 mock fetch；DSH 适配器确实做真实文件读写与游标续读（`:186-215`）；WorkBuddy 用 fake bridge 验通道契约并在代码注释里三次声明"不是 WorkBuddy 官方 API"（`platform-workbuddy.js:10-12`）。
4. `architecture.md:83-86` 自己写明"cursor 在内存、无跨平台持久化队列、无限流"，限制没有被藏。

**关键问题：能力声明退化为装饰**

我实测四个适配器的 `describe().capabilities`：

```text
memory   {"sessions":true,"lifecycle":true,"submit":true,"status":true,"cancel":true,"events":true,"contextHandoff":true,"tools":true,"reconnect":true}
http     同上
dsh      同上
workbuddy 同上
```

四处硬编码完全一致（`platform-memory.js:24-27`、`platform-http.js:69-72`、`platform-dsh.js:41-44`、`platform-workbuddy.js:71-74`）。后果：

- `requireCapability()`（`platform-registry.js:58-67`）在真实代码里 **永远不可能拒绝**，因为每个适配器都宣称全支持；
- 唯一被测试的拒绝路径是"未知能力键"（`platform-adapters.test.js:134`），**"声明为 false 时被拒"这条主干路径没有任何测试**；
- 更实质的：`workbuddy` 的通道只有 `rds.health / rds.task.poll / rds.task.send / rds.task.cancel`（`platform-workbuddy.js:16-21`），**没有 tool 通道**，却声明 `tools:true`；`dsh` 把 `tool.call` 原样写进 outbox 而没有任何执行侧，也声明 `tools:true`。

架构文档把"上层只能按能力分支，不能按平台名分支"当作设计目标（`architecture.md:44`），但当前实现里这条分支从未产生过分歧 —— 能力矩阵是一张全 true 的恒等表，无法证明任何差异化能力协商。**这是 M22 唯一实质性的设计落空**（P1-1）。

**其它缺口**

- **无生产接线**：`platform-client.js` / `platform-registry.js` 仅被 `mars/tests/arch/platform-adapters.test.js:13-14` 引用，`runtime/`、`scheduler/`、`cli` 均无引用（已 grep 全仓）。`architecture.md:12-14` 的依赖图把 `runtime / scheduler / platform-client` 并列为"RDS Core 依赖端口"，暗示编排层在用平台客户端 —— **与事实不符**，它是"可被接线的库 + 测试"（P1-2）。
- **"权限"未实现**：需求把"权限"列入 M22 交付面；`architecture.md:121-127` 的"安全与治理"只有"凭据来自选项/环境变量""send 只接受白名单消息类型"两条，**没有身份/role/租户/授权模型**，`describe()` 的"身份"也只是 `name/version/kind/transport`。文档没有把这个缺口标成 `NOT IMPLEMENTED`（P1-3）。
- 替换性表（`architecture.md:100-105`）四行都写 `succeeded`，但 DSH 行是**测试代码把 `send` monkey-patch 掉、自己往 inbox 写结果**（`platform-adapters.test.js:262-277`）—— 即"自己扮演 DSH 宿主"。表格没有标注这一点，比 `architecture.md:60` 的 PARTIAL 更乐观（P2-5）。

**结论**：**没有**把 WorkBuddy/DSH 的模拟说成真实接入（三处 NOT RUN 标注到位），但"IMPLEMENTED"一语偏强；准确说法是 `ADAPTER LAYER IMPLEMENTED / PLATFORM INTEGRATION NOT RUN`。平台逻辑没有泄漏进 Core（`npm run layers` problems=0，`composition.js:107-108` 只暴露 `platformCatalog/platformFor` 两个工厂入口）。

---

### 3.3 M23 REA 工具链 —— **判定：`PARTIAL`，无"objdump 冒充 Ghidra"类造假，但有数字不一致**

**属实的部分**

1. **没有偷换工具**：`toolchain-audit.md:62-67` 明确"objdump ≠ Ghidra"；W-02 `result.json` 的 `capability.not_done` 列了"反编译伪代码（需 Ghidra/IDA，本环境无）"；W-03 维持 `BLOCKED` 且理由双重（JADX zip 不完整 + 无授权 APK）；W-06 维持 `BLOCKED`（无 frida/adb/设备）。六套状态 PASS 数为 0，符合"缺工具就 BLOCKED"。
2. **JADX BLOCKED 是真的**：我实测 `/d/tools/jadx/jadx.zip` 33 MB、`unzip -l` 直接报"cannot find zipfile directory"。不是"能装但懒得装"。
3. **TShark 执行不是伪造**：`docs/checks/m19/W-05/result.json:147-181` 记录了 `argv`、`exit_code:0`、`frame_count:4`、完整 protocol hierarchy 文本（含各层字节数 428/240/188/134），且 `frame=4` 与内置解析 `packets=4` 一致；`tshark.exe` 文件确实存在。`evidence.json.commands` 也有 argv 记录。
4. 代码改动是收敛的：`w05-pcap.js` 交叉核验失败只记录、不否定内置解析（`w05-pcap.js:299-321`），并按 `frame_count !== analysis.packets` 主动写 `frame_count_mismatch` —— 这是"可被证伪"的设计，值得肯定。执行仍走 `execFile` 不经 shell（`tool-registry.js:5`、`tools.js` 的 `run`），无命令注入面。

**问题**

- **验收文档引用的 W-01 数字与它指向的证据不一致**：`m23/final-acceptance.md:9` 写"584 文件 / 146 节点 / 376 边"，但 `docs/checks/m19/W-01/result.json:28,186,187` 现在是 **611 文件 / 160 节点 / 406 边**。同一批数字也被 `docs/checks/final/M18-M20-final-acceptance.md:140` 沿用。可解释为"W-01 在 00:16:49 被重跑，文档写于 00:27 之前"（文件 mtime 支持这个时序），**但交付物本身就是"数字要对得上"，这一条是 P0-2**。文档自己在 `M18-M20-final-acceptance.md:349` 已承认"复跑数随工作区变化"，却没有在引用处加时点标注。
- **交叉核验样本是自造 4 包合成 pcap**（`toolchain-audit.md:33`）。"TShark 真实执行"成立，"真实流量分析"不成立；文档 §2 末尾也承认"没有 TCP 重组、TLS 解密、真实流量"。可接受，但 M24 引用时表述为"W-05 TShark 4.6.9 真实执行"（`m24/final-acceptance.md:36`）略去了"4 包合成"这一定语（P2-6）。
- **不可复现性**：`tshark` 不在 PATH、`MARS_TSHARK_PATH` 当前未设置；`evidence.json.reproduce` 第 2 步只说"按 commands 里的 argv 重新执行"，没有写"先 export MARS_TSHARK_PATH"。今天照做会得到 `TOOL_MISSING`（P2-7）。
- **改动历史证据**：`docs/checks/m19/` 下 23 个已跟踪文件被重写（W-01/W-02/W-04/W-05 的 result/evidence/execution.log，以及 `m19/final-acceptance.md` 的 T19-05 从 `BLOCKED` 改为 `PARTIAL`）。状态变化本身合理（工具装上了、真跑了），但**没有任何"本文件于 M23 复核后修订"的变更说明**，历史里程碑的验收结论被静默改写（P2-8）。
- `m23/final-acceptance.md:17` "REA 14/14" 的口径只是 `rea.test.js`；工具层另有 `rea-tools.test.js` 3 例（实测 14 + 3 = 17）（P2-9）。

**结论**：没有把 objdump/内置解析/交叉核验夸大成 Ghidra/JADX/Frida。**"W-05 PARTIAL" 的定性正确**。

---

### 3.4 M24 真实多 Agent 联合 —— **判定：`PARTIAL`，无"无模型伪造 PASS"，但有 1 处 PASS 缺证据**

**属实的部分**

1. **核心项如实 BLOCKED**：`m24/final-acceptance.md:49` `T24-02 多个真实 Agent 参与 = BLOCKED`，并在 `:23-25` 明确写"不用 mock 冒充 M24"、"M18/M20 已跑过 mock 全链路，再跑一遍只是重复证据"。这是本轮**最值得肯定的一处自我约束**。
2. 引用的三条外部证据我都核对过内容：`m18/execution-record.json` 首字段即 `"simulated_models": true`，`m20/execution-record.json` 同样 `"simulated_models": true` 且 `note` 写明"Agent 模型为 mock"。文档在 `:33-35` 的"真实性"列也逐条标注"模型 mock"。**没有把 mock 写成真实模型协作。**
3. 未新增伪造的 `m24/execution-record.json` —— 宁缺勿造，符合要求。

**问题**

- **`T24-10 最终交付 = PASS` 缺证据**（`m24/final-acceptance.md:57`）：该行写"报告 + 机器可读记录 + 证据目录"，但 `docs/checks/m24/` **只有 `final-acceptance.md` 一个文件**（实测 `ls`），没有本里程碑的机器可读记录，也没有 `evidence/` 目录。这是全篇唯一一处"PASS 无本里程碑证据"（P1-4）。
- **验收表覆盖不全**：M24 需求列明"隔离、冲突、重试、恢复、取消、权限、预算"，验收表只有 `T24-08 成本 PARTIAL` 与 `T24-09 故障处理 PASS` 两行兜底；**"权限"没有任何一行**，M18 的验收表（`m18/final-acceptance.md:9-20`）同样没有权限行，"隔离/取消"只在 T18-03/T18-08 里被顺带提及。`T24-09 PASS` 是把"超时/重试/锁/冲突/AGENT_LOST 测试"打包成一个 PASS，掩盖了 4~5 项未逐项验证（P1-4）。
- **"平台 → RDS → 多 Agent"端到端从未发生**：`m24/final-acceptance.md:12-13` 用"目标：平台提交 → RDS 接收 → …"描述场景，但 RDS 侧没有任何代码把 `platform-client` 接到调度器（见 §3.2 的 grep 结论），所以这条链路既没有跑过、也不可能跑。文档没有把"端到端联合场景 = NOT RUN"写成独立一行，读者可能把 §2 的证据表当成"链路的证据"（P1-6）。
- `T24-04 至少一条真实 REA 工作流 = PASS` 成立，但四条里有三条（W-01/W-02/W-04）都是对 `C:\WINDOWS\System32\where.exe` 做静态分析；"真实"指的是工具真实，不是业务对象有意义。不算造假，属于价值有限（P2-10）。

**结论**：**没有**在无真实模型时伪造多 Agent PASS。M24 = PARTIAL 成立，但 `T24-10` 这一行必须改。

---

### 3.5 M25 发布审计 —— **判定：`NOT RUN`（本节是本轮最严重的缺口）**

M25 要求四件事：自动测试 / 独立审核 / 二次复核 / GitHub 发布审计。

| 子项 | 状态 | 依据 |
|---|---|---|
| 自动测试 | **DONE** | `npm test` 317/317、`npm run layers` PASS（本审核复跑确认） |
| 独立审核（第一轮） | **DONE** | 本文件 |
| 二次复核 | **NOT RUN** | `docs/checks/m25/` 在本次审核前是**空目录**（`ls -la` 仅 `.` 与 `..`），仓库内无任何二次复核产物 |
| GitHub 发布审计 | **NOT RUN（且缺口比表面更大）** | ① 唯一的发布审计是 `docs/checks/final/pre-push-independent-audit.md`，其审计对象是 **HEAD `06b2a29`、领先 14**，而当前 HEAD 是 `e76053e`、领先 **20**，中间 6 个提交未审计；② 更关键：**M21–M25 的全部产物（文档 + 5 个新 adapter + 2 个新测试 + tooling 脚本 + 组合根改动）零提交**，`git log --all -- docs/checks/m21 …` 为空。即"发布"这件事根本还没发生，谈不上"发布审计通过" |

M25 还要求"不得把 BLOCKED/NOT RUN 计入 PASS"。这一点在 M21–M24 内被遵守（见 §5），但 **M25 自身没有任何验收文档**，因此不存在"自评是否诚实"的对象 —— 交付面为 0，这本身就是 P0-1。

---

## 4. 问题清单

### P0（不修不得发布）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0-1** | **M25 未完成且 M21–M25 零提交**：无二次复核、无针对当前 HEAD 的发布审计、"GitHub 发布审计"三字无对应产物 | `docs/checks/m25/` 为空目录；`git log --all --oneline -- docs/checks/m21 docs/checks/m22 docs/checks/m23 docs/checks/m24 mars/src/ports/platform-adapter.js` 输出为空；`git status` 中 M21–M25 全部为 `??` | 补齐二次复核 + 按 `e76053e` 重做发布审计；只 `git add` 明确路径（禁 `-A`，工作区含两个 18.5 MB 会话转录） |
| **P0-2** | **M23 验收数字与它引用的证据不一致**：文档 584/146/376，证据 611/160/406 | `docs/checks/m23/final-acceptance.md:9` vs `docs/checks/m19/W-01/result.json:28,186,187`；同错亦见 `docs/checks/final/M18-M20-final-acceptance.md:140` | 两处改为 611/160/406 并注明"工作区时点"，或在引用处显式标注"AUDIT-TIME 584" |

### P1（发布前应修，或必须在文档中降级）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| P1-1 | **平台能力矩阵退化为 9/9 全 true**，`requireCapability` 负路径无测试，"按能力分支"的设计目标未获证明；`workbuddy` 无 tool 通道却声明 `tools:true` | `platform-memory.js:24-27`、`platform-http.js:69-72`、`platform-dsh.js:41-44`、`platform-workbuddy.js:71-74`（实测四者输出完全相同）；`platform-registry.js:58-67`；测试只覆盖未知键 `platform-adapters.test.js:134` | 让至少一个适配器如实声明 `tools:false / lifecycle:false`，并补"声明 false → PLATFORM_UNSUPPORTED"的测试 |
| P1-2 | **M22 层无生产接线，但架构图暗示 runtime/scheduler 在用** | `platform-client.js`、`platform-registry.js` 仅被测试引用（全仓 grep）；`architecture.md:12-14` | 在图旁加"本层尚未接入编排；当前为库 + 契约测试"，或补一条真实接线路径 |
| P1-3 | **M22"权限"交付面缺失**，文档未标缺口 | `architecture.md:121-127`（只有凭据来源 + 消息类型白名单）；`describe()` 无 authorization/role 模型 | 明确写 `权限模型 NOT IMPLEMENTED`，或补 role/principal 校验 |
| P1-4 | **M24 `T24-10 = PASS` 无本里程碑证据；验收表缺 权限/隔离/取消/预算 独立行** | `m24/final-acceptance.md:57`；`ls docs/checks/m24/` 只有 `final-acceptance.md` | 降级为 `PARTIAL` 并补 m24 自己的机器可读记录；补齐缺失验收行 |
| P1-5 | **M21 真实推理结论无原始日志；"Provider 协议实现 PASS"建立在纯 mock fetch 上** | `provider-ollama.test.js:9-24`（fakeFetch）；`docs/checks/m21/` 仅 2 个文件 | 补 `ollama pull` / `sha256sum` 原始终端日志；把协议项改为 `PASS（离线契约）` |
| P1-6 | **"平台提交 → RDS 编排 → 多 Agent"端到端从未执行，文档未单列 NOT RUN** | `m24/final-acceptance.md:12-13` 场景描述 vs §3.2 的无接线事实 | 增加一行 `端到端平台联合场景 = NOT RUN` |
| P1-7 | **public 仓库新增本机绝对路径**（本轮的 W-05 证据） | `docs/checks/m19/W-05/result.json:23,31`（`D:/tools/wireshark/extract/...`）；`docs/checks/m21-m25/baseline-audit.md:4`（`D:/M1`） | 同前序审计建议：改为 `<TOOL_HOME>/tshark.exe`；已有 `<TEMP>` 脱敏机制可复用 |

### P2（记录在案，可延后）

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | Ollama `getUsage().calls` 恒为 0；`cancel()` 经 abort 后错误码被映射成 `PROVIDER_TIMEOUT`（用户取消≠超时）；`normalizeToolCalls` 的 `call_id` 依赖 `Date.now()`，非确定性 | `provider-ollama.js:213`、`:200-208` 与 `:155-158`、`:26` |
| P2-2 | `waitForResult` 对**没有 `task_id` 的事件**一律接受（`if (ev.task_id && ev.task_id !== taskId) continue`），任意任务的 `task.result` 都可能结束当前等待 | `platform-client.js:84` |
| P2-3 | 错误码契约不统一：`createPlatform` 缺参抛**无 `code` 的普通 Error**（消息里塞 `PLATFORM_OPTION_REQUIRED`）；`createDshPlatform` 先 `path.resolve('')` 再校验 `root` | `platform-factory.js:49-52`、`platform-dsh.js:29-30` |
| P2-4 | 组合根正好卡 120 行上限，为此**删掉了原有头注释**（`git diff composition.js` 可见），属于"用删文档换预算" | `composition.js`（119 行 / 脚本口径 120）、`git diff mars/src/composition.js:3-6` |
| P2-5 | 替换性表四行皆 `succeeded`，未标注 DSH 行是测试自扮宿主、WorkBuddy 行是 fake bridge | `architecture.md:100-105` vs `platform-adapters.test.js:262-277,278` |
| P2-6 | M24 引用 W-05 时省略"4 包合成 pcap"这一限定 | `m24/final-acceptance.md:36` vs `m23/toolchain-audit.md:33` |
| P2-7 | tshark 不在 PATH、`MARS_TSHARK_PATH` 未导出；`reproduce` 未写该前置条件，照做会得到 `TOOL_MISSING` | 实测 `command -v tshark` 无；`docs/checks/m19/W-05/evidence.json` 的 `reproduce[1]` |
| P2-8 | M19 历史验收被静默改写（T19-05 `BLOCKED → PARTIAL`、23 个证据文件重写），无"复核后修订"说明 | `git diff docs/checks/m19/final-acceptance.md:17`、`git diff --stat`（23 个 m19 文件） |
| P2-9 | "REA 14/14" 口径为 `rea.test.js`；工具层另有 3 例（实测 14+3=17） | `m23/final-acceptance.md:17`；`node --test rea-tools.test.js` → 3/3 |
| P2-10 | `T24-04` 的"真实 REA"里 3/4 是对 `where.exe` 的静态分析，业务价值有限 | `m19/W-02/result.json` 的 `sample`、`m19/W-04/result.json` 的 `sample` |

---

## 5. 三类高风险的专项回答

### 5.1 是否存在"PASS 无证据"？

**发现 1 处，属本里程碑证据缺失：**

- `docs/checks/m24/final-acceptance.md:57` `T24-10 最终交付 = PASS`，声称有"报告 + 机器可读记录 + 证据目录"，而 `docs/checks/m24/` 实测只有 `final-acceptance.md` 一个文件。这是唯一一处"PASS 但没有本里程碑对应产物"。

**未发现**其它"PASS 无证据"：M21 的 PASS 项均有 `npm test` 可复跑；M23 的 `T23-08/T23-09 PASS` 分别对应四件套证据与 317/317 实测；M24 的 `T24-03/04/05/06/09` 均指向可读的 `m18/m19/m20` 记录（模型 mock 已在引用处标注）。`M21 final-acceptance.md:96` 的"PASS（协议层）"是有意限定，不算违规。

### 5.2 是否存在"BLOCKED 被隐藏"？

**未发现隐藏。** 相反，本轮在"不隐藏"上做得比前几轮好：

- M21 六项推理全 `BLOCKED`，且 `execution-record.json` 保留 404 原文与 `total_tokens:0`；
- M23 `W-03/W-06` 双 `BLOCKED`，并给出可操作解除条件（授权 APK、DSH 队列目录、frida 设备）；JADX 的 33 MB 坏 zip 我实测确认存在，`BLOCKED` 理由成立；
- M24 `T24-02` 直接 `BLOCKED` 并拒绝用 mock 补位。

唯一的"边界情况"是 M21 把"Provider 协议实现"与"基础对话 BLOCKED"并列在同一张 PASS/BLOCKED 表里，容易让读者高估协议已验证程度（已列 P1-5）。

### 5.3 是否存在"PARTIAL 被写成完成"？

**里程碑级别：没有。** M21/M22/M23/M24 的自评分别是 `PARTIAL / IMPLEMENTED-PARTIAL / PARTIAL / PARTIAL`，未出现 `COMPLETED`。M25 则是 **`NOT RUN` 被隐含为"进行中"**（目录存在、无内容）——这是另一种形态的"未完成被当完成"，已列 P0-1。

**行级别有 3 处偏乐观**：`T24-10 PASS`（P1-4）、`T24-09 PASS`（打包 4~5 项，P1-4）、`architecture.md` 的"IMPLEMENTED"（P1-2）。均不构成造假，但会误导快速浏览者。

---

## 6. Git / 受保护工作 / 敏感信息

### 6.1 Git

| 检查 | 结果 |
|---|---|
| HEAD / origin | `e76053e` / `ada7848`，**20 ahead / 0 behind**，线性，`git log --merges` = 0 |
| Tag | 20 个，`git tag --contains origin/main` 空，无 Tag 指向新提交 |
| 索引 | 空，无暂存（无偷跑） |
| 工作区 | 97 项 = 28 已跟踪修改 + 69 未跟踪 |
| **M21–M25 入库** | **0 提交**（全部 `??`） |
| 越权修改 | 已跟踪的 28 个修改中，无一个属于受保护 50 项；`composition.js`、`tool-registry.js`、`w05-pcap.js` 属本轮正常改动 |

**结论**：Git 状态干净可快进，但**本轮交付物完全未入库**。"GitHub 发布审计"无从谈起（P0-1）。

### 6.2 受保护工作

按 `m12-protected-baseline.txt` 50 条逐字节复算（SHA-256 前 16 位 + 字节数）：

```text
ok=50  bad=0  missing=0
```

含 49 个未跟踪文件与 1 个已跟踪格式化修改（`docs/checks/productization/M9-M11-final-acceptance.md`）。**零漂移**，未发现未授权修改。

需要注意的**非受保护但相关**事实：`docs/history/initial-deployment/source/*.jsonl` 两个约 18.5 MB 的会话转录仍在工作区（未跟踪、`.gitignore` 不覆盖 `*.jsonl`）。`git add -A` 会把它们带进公开仓库——这是发布环节必须守住的边界。

### 6.3 敏感信息

- 凭据特征扫描（`sk-…` 长串、`ghp_`、`github_pat_`、`AKIA…`、`xox*-`、`BEGIN … PRIVATE KEY`）覆盖 M21–M25 全部新增文档、5 个新 adapter、`provider-ollama.js`、`platform-*.js`、两个新测试、`m21-ollama-verify.cjs`：**0 命中**。
- 新增的 `execution-record.json` / `result.json` 中只出现 `127.0.0.1:11434`、`<TEMP>`、脱敏哈希，无真实凭据。
- **新增了 2 处本机绝对路径**（`D:/tools/wireshark/...`、`D:/M1`）——不是密钥级问题，但仓库是 **public**（前序审计已核实 `private:false`），属持续性的隐私/整洁性债（P1-7）。
- 未发现把用户身份、邮箱、Cookie 写入本轮新增文件。

---

## 7. 最终建议

### 判定：**不可发布（当前 HEAD `e76053e`）**

理由按权重排序：

1. **M25 交付面为 0**。任务书要求"自动测试 + 独立审核 + 二次复核 + GitHub 发布审计"，目前只有前两项。`docs/checks/m25/` 空目录 + M21–M25 零提交 = 发布这件事尚未发生，"发布审计"自然不成立。
2. **1 项 P0 证据不一致**（W-01 584 vs 611）。在一份以"证据可核对"为卖点的交付里，验收文档与证据文件对不上，是可直接被外部复现的硬伤。
3. **M22 的核心设计目标"按能力分支"未被证明**（P1-1）。这不会让代码崩，但会让 M22 的架构主张变成一张全 true 的恒等表。

### 转为"有条件发布"的最低门槛

必须（缺一不可）：

- [ ] 修正 `m23/final-acceptance.md:9` 与 `M18-M20-final-acceptance.md:140` 的 W-01 数字（P0-2）；
- [ ] 补 `docs/checks/m25/` 的二次复核记录与针对 `e76053e` 的发布审计（P0-1）；
- [ ] 只 `git add` 明确路径提交 M21–M25（`composition.js`、5 个 adapter、2 个测试、tooling、docs），**禁止 `-A`**，提交前后各复算一次 50 项受保护哈希；
- [ ] 把 `T24-10` 降级并说明（P1-4）。

建议（可与发布同批）：

- [ ] 让能力矩阵至少出现一个 `false` 并补负路径测试（P1-1）；
- [ ] `architecture.md` 标注"平台层尚未接入编排"（P1-2）与"权限模型未实现"（P1-3）；
- [ ] W-05 证据里的 `D:/tools/...` 改为 `<TOOL_HOME>`（P1-7）；
- [ ] 把 M21 的 `ollama pull` / `sha256sum` 原始日志落盘（P1-5）。

### 不必阻塞发布的（可保留为已知限制）

- M21 真实推理 `BLOCKED`、M23 `W-03/W-06 BLOCKED`、M24 `T24-02 BLOCKED` —— **这三项本身就是正确结论**，不应为了"全绿"去补 mock。
- 平台层无持久化队列、无流式、无会话恢复、无跨进程锁 race 测试。

---

## 8. 一句话结论

**代码是真的、失败是真的、限制也是真的；但"M25 已完成"这件事是假的 —— 它不是被伪造成 PASS，而是根本没做，却被当作"本轮最后一步"交付。**

---

*本文件为本轮唯一新增物，未进入 Git 索引。审核过程未修改任何代码、配置或既有文档。*
