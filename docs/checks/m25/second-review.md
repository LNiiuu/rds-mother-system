# M21–M25 第二轮独立复核报告

**复核人**：独立 Reviewer（第二轮，非开发方，不参与整改）
**复核时间**：2026-11-14（+08:00）
**仓库**：`D:/M1`，branch `main`
**Git 基线**：HEAD `3a8f15c`（`feat(m21-m23): 本地模型 Provider、通用平台适配层与 TShark 核验`），origin/main `ada7848`，**21 ahead / 0 behind**，0 merge commit，20 个 tag 未动
**性质**：只读代码与证据。未修改代码、配置、Git 索引；未暂存、未提交、未 push、未打 Tag。
**唯一写入物**：本文件。
**输入**：`docs/checks/m25/independent-review.md`（第一轮，571 行）、`docs/checks/m21-m25/baseline-audit.md`

**总裁定**：**不可发布（当前工作区状态）**。

较第一轮有实质进展：P0-2 已修正，M22 三条（无接线/权限/模拟标注）已如实标注，`T24-10` 已降级，M24 本里程碑记录已补。但：

1. **`npm test` 当前是红的**：`tests=318 pass=317 fail=1`，失败项为 `B6 docs-check：本仓库当前状态为通过`，与 `m23/final-acceptance.md:17` 的「全量 318/318」直接矛盾；
2. **M25 仍缺发布审计**：`docs/checks/final/pre-push-release-audit.md` 不存在，而 `docs/checks/README.md:192` 已把它登记为交付物——只要它不存在，`npm test` 就无法变绿；
3. **M21–M25 文档仍然零提交**，`git log origin/main..HEAD -- docs/checks/m2*` 为空。

也就是说：第一轮的 P0-1 **只完成了一半**（代码入库、文档与审计未入库），并且本轮整改**新引入**了一条发布门禁红灯。

---

## 1. 复核方法（实际执行的命令）

### 1.1 只读检查

```bash
git status --porcelain -uall | wc -l                  # 87 项（27 已跟踪修改 + 60 未跟踪）
git diff --cached --stat                              # 空（无偷跑暂存）
git log --oneline origin/main..HEAD                   # 21 条
git log --oneline origin/main..HEAD -- docs/checks/m21 docs/checks/m22 \
    docs/checks/m23 docs/checks/m24 docs/checks/m25 \
    docs/checks/final/pre-push-release-audit.md       # 空
git show --stat 3a8f15c                               # 16 文件，全部 mars/src|tests|tooling，无 docs
git tag | wc -l                                       # 20
git log --merges --oneline origin/main..HEAD | wc -l  # 0
```

### 1.2 门禁（实际运行）

```text
npm test          -> GATE FAIL  tests=318 pass=317 fail=1 skipped=0
                     not ok 97 - B6 docs-check：本仓库当前状态为通过
npm run layers    -> LAYERS PASS  problems=0 warnings=2
                     端口 8 / 域 40 / 组合根 120 行 / 上限 120
npm run docs:check-> DOCS FAIL  2 处不可达（1 个文件），扫描 252 个 Markdown
                     BROKEN docs/checks/README.md:191 -> m25/second-review.md
                     BROKEN docs/checks/README.md:192 -> final/pre-push-release-audit.md
```

（写作本文件后重跑，见 §5.1：第一条链接因本文件存在而消除，第二条仍在，`npm test` 仍 FAIL。）

### 1.3 逐条证据核对

```bash
python - <<'PY'   # 读 docs/checks/m19/W-01/result.json 的 files_scanned/dependencies/symbols
PY
# -> files_scanned=611, dependencies.nodes=160, dependencies.edges=406, symbols=100 项

node -e "…createDshPlatform + registry.requireCapability('dsh','tools')…"
# -> code=PLATFORM_UNSUPPORTED  msg=平台 dsh 不支持能力 tools

grep -c "^test(" mars/tests/arch/platform-adapters.test.js   # 10
grep -c "^test(" mars/tests/arch/provider-ollama.test.js     # 6
grep -rn "D:/tools\|D:\\tools" docs/                          # 见 §5.3
python - <<'PY'  # 按 D:/M1-migration/m12-protected-baseline.txt 逐条算 SHA-256 前 16 位 + 字节数
PY
# -> ok=50 bad=0 missing=0
grep -rEn "sk-[A-Za-z0-9]{20,}|ghp_…|AKIA…|BEGIN … PRIVATE KEY" <本轮新增文件>  # 0 命中
```

### 1.4 明确未做

- 未连接 Ollama、未发任何模型请求。
- 未执行 tshark / objdump / jadx / frida；未重跑 REA 六套工作流（会写 `docs/checks/m19/**`，超出只读授权）。
- 未在 `git stash`/临时 worktree 中验证「HEAD 本身是否 318/318」——那需要改写工作区或复制仓库。因此对 `m23:17` 的判定基于**交付时的工作区状态**（这正是要被发布的状态），而非 HEAD 单独状态，§3.1 已注明。

---

## 2. 第一轮 P0/P1 逐条整改状态

### 2.1 P0

| 编号 | 第一轮问题 | 本轮判定 | 证据 |
|---|---|---|---|
| **P0-1** | M25 未完成 + M21–M25 零提交 | **PARTIAL**（代码已入库；文档与发布审计未入库，M25 仍缺一项） | `3a8f15c` 含 16 个代码/测试/工具文件；`git log origin/main..HEAD -- docs/checks/m2*` 为空；`ls docs/checks/m25/` 仅 `independent-review.md`；`ls docs/checks/final/pre-push-release-audit.md` → No such file |
| **P0-2** | M23 验收数字 584/146/376 vs 证据 611/160/406 | **FIXED** | `m23/final-acceptance.md:9` 已改 `611 文件 / 160 节点 / 406 边 / 100 符号（M23 时点）`，与 `m19/W-01/result.json` 的 `files_scanned=611`、`nodes=160`、`edges=406`、`symbols=100` 完全一致；`final/M18-M20-final-acceptance.md:140` 保留 584 但显式标注「M19 时点；M23 复跑为 611/160/406」，符合第一轮给出的二选一改法 |

### 2.2 P1

| 编号 | 第一轮问题 | 本轮判定 | 证据 |
|---|---|---|---|
| **P1-1** | 四适配器能力 9/9 全 true，`requireCapability` 负路径无测试 | **FIXED** | `platform-dsh.js:41-44`：`sessions:false, lifecycle:false, tools:false`；`platform-workbuddy.js:71-74`：`lifecycle:false, tools:false`（二者与实现一致：DSH 无工具执行侧、WB 无 tool 通道）。`platform-adapters.test.js:138-142` 新增「DSH 声明 false → 拒绝」断言；实测抛 `PLATFORM_UNSUPPORTED`（非仅文案）。**残余小瑕疵**见 P2-4（测试只断言 message，未断言 `code`） |
| **P1-2** | 架构图暗示 runtime/scheduler 在用平台层 | **FIXED** | `architecture.md:13` 改为「platform-client / platform-registry（库；尚未接入 runtime/scheduler）」；`:142-143` 单列「本层尚未接入 … 端到端 `NOT RUN`」 |
| **P1-3** | 「权限」交付面缺失且未标注 | **FIXED** | `architecture.md:131` 原文：「**权限模型 NOT IMPLEMENTED**：没有 role/principal/租户/授权校验」 |
| **P1-4** | `T24-10 PASS` 无本里程碑证据；验收表缺行 | **FIXED（留质量瑕疵）** | `m24/final-acceptance.md:57` 已降为 `PARTIAL` 并说明只有报告 + `scenario.md` + `execution-record.json`；新增 `T24-11/T24-12/T24-13/T24-14` 四行（隔离/取消/权限/端到端），`T24-09` 也加了「（mock 模型）」限定。`docs/checks/m24/` 现有 3 个文件。**但**该 `execution-record.json` 是手写索引卡而非脚本产出，见 P1-3（新） |
| **P1-5** | M21 协议 PASS 建立在 mock fetch；无原始下载日志 | **PARTIAL** | ① 协议项已改为 `PASS（离线契约；真实协议未核验）`（`m21:88`）、契约测试 `PASS（离线）`（`:89`）——**已修**；② `docs/checks/m21/download-failure.log` 已存在，含 size/sha256 两对值——**已补**；③ 但该文件自称「逐字记录」，实际含无法逐字成立的行（`$ curl /api/chat model=…`、`# 网络旁证` 等编辑性文字），且 `m21:4` 仍写「5 个契约测试」（实测 6 个）——**未完全修**，见 P2-1/P2-2 |
| **P1-6** | 端到端从未执行且未单列 NOT RUN | **FIXED** | `m24/final-acceptance.md:61` 新增 `T24-14 平台→RDS 端到端 = NOT RUN`，理由「M22 平台层未接入调度器」；`m24/scenario.md` 明确「状态：NOT RUN」且列出 6 步均未执行 |
| **P1-7** | public 仓库含本机绝对路径 | **PARTIAL** | `m19/W-05/result.json:23,31` 与 `evidence.json` 已改 `<TOOL_HOME>/tshark.exe`；`baseline-audit.md:4` 已改 `<REPO>`。**但**：`docs/checks/m19/execution-record.json:122,478,486` 仍有 3 处 `D:/tools/wireshark/extract/...`（该文件本轮被重写，属已跟踪修改）；`docs/checks/m23/toolchain-audit.md:15,16` **新引入** 2 处 `D:\tools\jre\...`、`D:\tools\wireshark\...` |

**小结**：7 条 P1 中 5 条 FIXED、2 条 PARTIAL；P0 为 1 FIXED、1 PARTIAL。整改主体是真实的，不是改文档措辞糊弄——能力矩阵、`requireCapability` 拒绝路径、`T24-10` 降级都能在代码/文件里验证到。

---

## 3. 新发现问题

### P0（不修不得发布）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P0-A（新）** | **交付状态下 `npm test` 红：318 中 1 失败**，而验收文档写「全量 318/318 PASS」。失败原因是 docs-check 校验出 `docs/checks/README.md` 指向两个**不存在**的文件——其中 `final/pre-push-release-audit.md` 是 M25 要求的发布审计，尚未做；`m25/second-review.md` 是本文件（复核前不存在，现已补）。**即使本文件落盘，第二条链接仍断，`npm test` 仍会 FAIL** | `npm test` → `GATE FAIL tests=318 pass=317 fail=1`；失败用例 `docs-check.test.js:119`，断言 `expected 0 actual 1`；`npm run docs:check` 输出两条 BROKEN；`m23/final-acceptance.md:17` 写 `全量 318/318`；`README.md:191-192` 两行带「（待生成）」 | ① 先做发布审计并落盘 `final/pre-push-release-audit.md`；② 在审计完成前，`README.md` 不应把待生成文档当交付物登记（或给 docs-check 加 pending 白名单——但那是给红灯开后门，不建议）；③ 修正 `m23:17` 为「318 用例，317 通过、1 失败（docs-check 待生成链接）」 |

这条是第一轮 P0-2 的同型复发：**一个可被单条命令推翻的「全绿」声明**。区别是这次连门禁输出都明确写着 FAIL，文档仍写 PASS。

### P1（发布前应修）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| **P1-A（新）** | **`docs/checks/m24/execution-record.json` 不是执行记录，是手写的声明卡**：`generated_at` 是整点 `2026-11-14T00:30:00+08:00`，无任何脚本引用它，字段是 `status/blocker/evidence_refs/notes`，没有一次任务、session、时间戳序列 | 全仓 `grep -rln "m24/execution-record" tooling mars` 为空；文件全文 740 B，`status:"BLOCKED"`、`platform_end_to_end:"NOT RUN"` | 要么由脚本生成（哪怕是「检测到 M21 阻断 → 写 BLOCKED」的 runner），要么在 `m24:57` 注明「本文件为复核时手工汇总的声明，非运行产物」。当前写法虽不撒谎，但满足不了第一轮「机器可读记录」的原意 |
| **P1-B（新）** | **`m21/download-failure.log` 的「逐字」声明不成立**：文件首行写「以下为当时终端输出/对象字段的逐字记录」，但包含 `$ curl /api/chat model=qwen2.5:3b`（非可执行命令）、`# 网络旁证`、「pulling … 20 KB/s」等编辑性/概括性文字，无法与真实终端回显一一对应 | `docs/checks/m21/download-failure.log:1-2, 26, 32, 38` | 把首行改为「事后整理的回显摘要（非逐字）」，或换成真实 capture（PowerShell transcript / tee 输出）。当前状态不算造假，但「逐字」是个体面的把柄 |

### P2（记录在案）

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | `m21/final-acceptance.md:4` 仍写「5 个契约测试」，实测 6 个（`:38`、`:89` 写 6/6），文件内自相矛盾 | `grep -c "^test(" provider-ollama.test.js` = 6 |
| P2-2 | `m23/final-acceptance.md:13` 的 W-05 仍写「TShark 4.6.9 真实执行」，缺「4 包合成 pcap」限定（第一轮 P2-6 只在 `m24:36` 修了） | `m23:13` vs `m23/toolchain-audit.md:33` |
| P2-3 | 负路径测试只断言 `/不支持能力 tools/` 文案，未断言 `e.code === 'PLATFORM_UNSUPPORTED'`；`platform-adapters.test.js` 全文无一处对 `PLATFORM_UNSUPPORTED` 的 code 断言 | `platform-adapters.test.js:141` |
| P2-4 | `memory` / `http` 仍 9/9 全 true，且 `http` 的 `sessions/lifecycle/tools` 没有任何用例触碰（只测了 submit/status/cancel/health/receive）；能力矩阵虽已有差异，但 http 那一行仍是「假设」而非「验证」 | `platform-http.js:69-72`；`platform-adapters.test.js` 无对应断言 |
| P2-5 | 组合根仍在 120 行上限：为容纳 ollama + platform 两个入口，把原有 6 行头注释压到 3 行、并删掉 2 处行内注释（第一轮 P2-4 未改，反而更紧） | `git diff e76053e..3a8f15c -- mars/src/composition.js`；`wc -l` = 119 / 脚本口径 120 |
| P2-6 | `createPlatform` 对未知平台名仍抛无 `code` 的普通 Error（`PLATFORM_UNKNOWN` 只写在 message 里）；`PLATFORM_OPTION_REQUIRED` 已修好 | `platform-factory.js:49` |

**已确认修好的旧 P2**：`waitForResult` 现在严格要求 `ev.task_id === taskId`（`platform-client.js:84`，旧 P2-2 修好）；`createDshPlatform` 先校验 `root` 再 `path.resolve`（旧 P2-3 一半修好）；M19 历史验收改写补了「M23 复核」变更说明（`m19/final-acceptance.md:3-5`，旧 P2-8 修好）。

---

## 4. 第一轮「三类高风险」复查

| 问题 | 结论 |
|---|---|
| PASS 无证据 | **仍有 1 处**：`m23:17`「全量 318/318」在交付状态下不成立（实测 317/318）。`T24-10` 已修好，不计。 |
| BLOCKED 被隐藏 | **未发现**。M21 六项、M23 W-03/W-06、M24 T24-02 全部如实 BLOCKED，并在 M24 新增了 `T24-14 NOT RUN`。 |
| PARTIAL 被写成完成 | **未发现**。四个里程碑自评均为 PARTIAL；M25 仍然没有自评文档（只有第一轮与本轮两份外部报告）。 |

---

## 5. 测试 / Git / 受保护 / 敏感信息

### 5.1 测试与门禁

| 命令 | 结果 |
|---|---|
| `npm test` | **FAIL** — `tests=318 pass=317 fail=1 skipped=0`，`not ok 97 - B6 docs-check：本仓库当前状态为通过` |
| `npm run test:raw` | exit=1，317 个 `ok`，1 个 `not ok`（同上） |
| `npm run layers` | **PASS** — `problems=0 warnings=2`（`cli.js`、`util.js` 白名单），端口 8 / 域 40 / 组合根 120/120 |
| `npm run docs:check` | **FAIL** — 2 处不可达（`m25/second-review.md`、`final/pre-push-release-audit.md`）。写入本文件后复跑为 1 处（`final/pre-push-release-audit.md`） |

单元层面是好的：`platform-adapters` 10/10、`provider-ollama` 6/6（含新增的 cancel→`PROVIDER_CANCELLED` + `getUsage().calls===1` 用例，`provider-ollama.test.js:126-142`），代码修复真实且有用例兜底。**问题不在单测，在于「文档登记先于文档存在」把整条门禁拖红。**

> 需要说清楚：本文件的写入会使 broken 从 2 条降到 1 条，但**不会**让 `npm test` 变绿——只要 `final/pre-push-release-audit.md` 没做出来，`npm test` 就是红的。这不是复核方可以代劳的部分。

### 5.2 Git

| 检查 | 结果 |
|---|---|
| HEAD / origin | `3a8f15c` / `ada7848`，21 ahead / 0 behind，线性，0 merge |
| 索引 | 空（`git diff --cached` 无输出） |
| 工作区 | 87 项 = 27 已跟踪修改 + 60 未跟踪（第一轮为 97 项） |
| Tag | 20 个，未见指向新提交 |
| **M21–M25 代码** | **已提交**：`3a8f15c` 含 5 个 platform adapter、`provider-ollama`、2 个端口、2 个测试、`m21-ollama-verify.cjs`、组合根接线，共 16 文件 / +1678 |
| **M21–M25 文档** | **0 提交**：`docs/checks/m21|m22|m23|m24|m25` 全部仍为 `??` |
| 越权修改 | 27 个已跟踪修改全部落在 `docs/checks/**` 与 `docs/checks/productization/M9-M11-final-acceptance.md`，无代码/配置外溢 |

结论：代码入库这一步做了，而且是用明确路径提交（16 个文件，未带 `docs/history/*.jsonl`）；**文档与审计仍未入库**，第一轮 P0-1 只完成一半。

### 5.3 受保护工作

按 `D:/M1-migration/m12-protected-baseline.txt` 的 50 条逐条复算 SHA-256 前 16 位 + 字节数：

```text
ok=50  bad=0  missing=0
```

**50/50 零漂移**，本轮新增的 M21–M25 文件均不在基线内，未发生未授权修改。

### 5.4 敏感信息

- 凭据特征扫描（`sk-…` / `ghp_` / `github_pat_` / `AKIA…` / `xox*-` / `BEGIN … PRIVATE KEY`）覆盖 M21–M25 文档、5 个新 adapter、`provider-ollama.js`、两个测试、`tooling/m21-ollama-verify.cjs`：**0 命中**（唯一匹配是本报告引用该规则自身，属误报）。
- 新增的 `execution-record.json` / `result.json` 只含 `127.0.0.1:11434`、`<TEMP>`、`<TOOL_HOME>` 与脱敏哈希。
- **本机路径脱敏只做了一半**：W-05 与 baseline-audit 已改好，但 `m19/execution-record.json` 残留 3 处 `D:/tools/...`，`m23/toolchain-audit.md` 新写 2 处 `D:\tools\...`。仓库是 public，仍属该修的债（P1-7 PARTIAL）。
- 两个约 18.5 MB 的会话转录 `docs/history/initial-deployment/source/*.jsonl` 仍在工作区且未跟踪——**提交时禁止 `git add -A`** 这条边界依然有效。

---

## 6. 最终建议

### 判定：**不可发布**

按权重排序的理由：

1. **发布门禁是红的。** `npm test` = 317/318，失败项是 docs-check；同时 `m23/final-acceptance.md:17` 声称 318/318。这是第一轮 P0-2 的同型问题：验收文档与可执行事实不一致，且这次一条命令即可证伪。
2. **M25 仍缺「GitHub 发布审计」。** `final/pre-push-release-audit.md` 不存在，而 README 已把它登记为交付物；这既是 M25 的交付缺口，也是上一条红灯的直接原因。
3. **文档零提交。** 代码已进 `3a8f15c`，但 M21–M25 的验收/证据/报告全部未入库。发布的对象是提交，不是工作区。

### 转为「有条件发布」的最小条件（缺一不可）

- [ ] 生成 `docs/checks/final/pre-push-release-audit.md`，审计对象明确写 `3a8f15c` 之后的交付 HEAD（含文档提交后的新 HEAD）；
- [ ] 把 `m23/final-acceptance.md:17` 的 `318/318` 改成与真实门禁一致的数字，并在发布审计里贴 `npm test` 原文；
- [ ] 用**明确路径**提交 M21–M25 文档（禁止 `-A`；两个 18.5 MB jsonl 不得入库），提交前后各复算一次受保护 50 项；
- [ ] 修完上述后重跑 `npm test` / `npm run layers` / `npm run docs:check`，三条全绿才能推。

### 建议同批修（不影响定性，但都是「一条 grep 就能抓到」的把柄）

- [ ] `m19/execution-record.json` 的 3 处 `D:/tools/...`、`m23/toolchain-audit.md` 的 2 处 `D:\tools\...` 改 `<TOOL_HOME>`（P1-7 收尾）；
- [ ] `m21:4` 的「5 个契约测试」改 6（P2-1）；
- [ ] `download-failure.log` 首行去掉「逐字」（P1-B）；
- [ ] `m24/execution-record.json` 标注「手工汇总」，或补生成脚本（P1-A）；
- [ ] 负路径测试补 `e.code === 'PLATFORM_UNSUPPORTED'`（P2-3）。

### 不必阻塞发布的（应保留为已知限制，不要为了全绿去补 mock）

- M21 真实推理 `BLOCKED`、M23 W-03/W-06 `BLOCKED`、M24 `T24-02 BLOCKED`、`T24-14 NOT RUN`——**这些是正确结论**。
- 平台层无持久化队列、无流式、无跨进程锁 race 测试；权限模型 `NOT IMPLEMENTED`（已如实标注）。

---

## 7. 一句话结论

**这一轮整改是动真格的——能力矩阵真的出现了 `false`，`requireCapability` 真的会拒绝，`T24-10` 真的降级了，W-01 数字真的对上了；但开发方一边补证据，一边把两个还不存在的文档写进了 README，于是 `npm test` 从「绿」变成了「317/318 红」，而验收文档还在说 318/318。**

---

*本文件为本轮唯一新增物，未进入 Git 索引。复核过程未修改任何代码、配置或既有文档。*
