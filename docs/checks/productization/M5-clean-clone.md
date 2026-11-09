# M5 干净克隆验证报告

**日期**：2026-11-09（+08:00）
**批次**：M5-B6
**验证对象**：`72b13d5`（`origin/main`）
**方法**：`git clone` 到独立目录，只保留 git 跟踪的文件，然后**完全不依赖原工作区**跑完整链路。

---

## 1. 为什么要单独做这个验证

工作区里有 49 项未跟踪材料（历史证据、运行记录、本地实现）。它们在某些情况下会**掩盖缺陷**：

- 测试可能读到未跟踪的 fixture
- `npm pack` 打的是磁盘文件而不是 git 跟踪的文件
- 配置检查会扫到未跟踪的 JSON

M4 的回滚演练已经抓到过一次：`version.test.js` 依赖未跟踪的 `mars/config/principals.json`，干净检出即失败。

所以「本地全绿」不等于「可交付」。本报告只认干净克隆的结果。

---

## 2. 克隆结果

```bash
git clone <repo> /tmp/clean-m5c && cd /tmp/clean-m5c
```

| 项 | 值 |
|---|---|
| HEAD | `72b13d5` |
| 跟踪文件数 | **342** |
| 工作区状态 | `git status --porcelain` → **0 项** |
| 未跟踪材料是否带入 | **否**。`docs/history/`、`docs/analysis/`、`docs/runs/`、`tooling/agent-runtime/` 均不存在 |

这四项确认了「干净」二字：没有本地残留，没有脏状态。

---

## 3. 门禁

```bash
npm run verify     # doctor → config → layers → docs:check → test
```

| 检查 | 结果 |
|---|---|
| `doctor` | `status: ok (fail=0 warn=1 checks=11)`。warn 为 `paths:docs`（历史证据含机器路径，预期行为） |
| `config` | `CONFIG PASS  json=41 yaml=4`（工作区为 57，差额来自未跟踪的 JSON） |
| `layers` | `LAYERS PASS  problems=0 warnings=2`（2 条永久边界声明） |
| `docs:check` | `DOCS PASS  相对链接全部可达` |
| `test` | `GATE PASS  tests=196 pass=196 fail=0 skipped=0` |

**196 项在无 `principals.json`、无历史材料的目录里全过**——测试已完全去环境化。

---

## 4. 行为基线（本次发现并修复了一个真实缺陷）

第一次干净克隆跑基线时**失败**：

```
BASELINE FAIL  drift=2
  - pack-files: 基线有、现在缺失 -> core/templates/role-packet.md
  - pack-files: 基线有、现在缺失 -> core/templates/run-record.json
```

### 4.1 根因

`package.json.files` 含 `"core/"`，`npm pack` 打的是**磁盘上的文件**，不是 git 跟踪的文件。

这两个模板在工作区存在（所以工作区打出的包是 109 文件、与基线一致），但从未入库（干净克隆只有 107 文件）。于是**同一份提交，在两种工作区里打出的包不同，基线结论也不同**。

这不是「基线太严」，是「打包结果依赖工作区状态」——一个真实的交付缺陷。

### 4.2 处理

把两个模板入库（提交 `a2c2567`），理由：

1. 两者都是纯格式定义：全文 `{{占位符}}`，无项目名、无机器路径、无凭据
2. 它们定义「角色执行包长什么样」，属于 `core/templates` 的职责
3. 从包里排除会让基线持续报「基线有、现在缺失」，而 `diffSets` 只允许新增、不允许删除——除非重采基线，那等于把一次对外变更静默抹掉

未入库的部分保持不变：生成它们的 `rds-render-role.ps1` 仍在本地工作区，不随仓库与包分发。`README.md` 的能力表已按此改写。

### 4.3 修复后

| 项 | 工作区 | 干净克隆 |
|---|---|---|
| 包内文件数 | 109 | **109** ✅ |
| `BASELINE PASS` | 是 | **是** |
| 包内含 `role-packet.md` / `run-record.json` | 是 | **是** |

---

## 5. 发行包

```bash
npm pack --silent
node tooling/pack-check.mjs rds-mother-system-0.1.0.tgz
```

```
tarball: rds-mother-system-0.1.0.tgz  文件 109 个  115085 B
PACK PASS  必需文件齐全，禁止项 0 命中
```

包内 `core/templates/` 的 10 个文件全部在内，含两个新入库的模板。

端到端：

```
SMOKE PASS  安装 → doctor → init → 写入 → 审批 → 检索 → 编译 全部通过
```

`ci-smoke.sh` 做的事：打包 → 内容检查 → 干净前缀安装 → 版本与 doctor → `init` → `put` → `review` → `search` → `compile`。它不写用户全局环境。

---

## 6. 按文档首次运行（逐条对照）

严格按 [docs/quickstart.md](../../quickstart.md) 的顺序，在**发行包安装形态**下执行。
环境：Windows / Node v22.22.2 / 临时前缀 `/tmp/pfx3` / 工作目录 `/tmp/qs5`。

| 步骤 | 命令 | 文档预期 | 实际 | 判定 |
|---|---|---|---|---|
| 0 | `node -v` | >= 22.15 | `v22.22.2` | ✅ |
| 1 | `rds --version` | `0.1.0` | `0.1.0` | ✅ |
| 3 | `rds init` | JSON，各计数为 0 | `{"db": "...", "stats": {"memories": 0, ...}}` | ✅ |
| 4 | `rds init-dev --principal dev-r0 --projects demo --roles R0` | 打印 `DEV_TOKEN=` 48 位 | 长度 **48** | ✅ |
| 5 | `rds put --type L3 ...` | `{"memory_id":"mem_...","status":"proposed","duplicate":false}` | `mem_0a49a3ab62d8` / `proposed` / `false` | ✅ |
| 6 | `rds search --query sqlite` | `[]` | `[]` | ✅ |
| 7 | `rds list --status proposed` | 1 条，`status: proposed` | 1 条，`proposed` | ✅ |
| 8a | 追加 R4 身份的脚本 | `R4 token 已写入 .../principals.json.r4token` | 一致 | ✅ |
| 8b | `rds review --decision approved` | `"status": "approved"` | `approved`，`approved_by: dev-r4` | ✅ |
| 9 | `rds search --query sqlite` | 能查到，`approved` | 查到，`approved` | ✅ |
| 10 | `rds compile --task T-001 --role R0 --budget 4000 --out ./packet.json` | `已写出 ... tokens=66/4000` | `tokens=66/4000`，`sections: 4` | ✅ |

**10 步全部与文档一致**，包括 `tokens=66/4000` 这个具体数字和 4 个 section。

### 6.1 一个容易误判的点

`search` 在审批前返回 `[]` 是**设计行为**，不是失败。文档在 §6 用整节解释了这一点，并在 §9「卡住了」里重复了一遍。验证时按文档预期判为 ✅。

---

## 7. Windows 脚本

| 脚本 | 结果 | 前提 |
|---|---|---|
| `tests/git-review/run.ps1`（G1 六夹具） | `RESULT: PASS`（F1 PASS、F2–F4 FAIL、F5 BLOCKED、F6 PARTIAL，均为预期裁决） | 需 `git` 在 PATH，或设 `RDS_GIT` |
| `tests/self/run.ps1`（结构自检） | `RESULT: PASS` | 无额外前提 |

### 7.1 首次运行失败，原因是环境不是代码

第一次跑 G1 报：

```
git 未找到：设置 RDS_GIT 环境变量，或在 tooling\toolchain.local.json 中配置 { "git": "<git 路径>" }
```

排查：PowerShell 的 PATH 里没有 `git`（本机只在 Git Bash 的 PATH 里有）。设置后即通过：

```powershell
$env:RDS_GIT = "C:\Program Files\WorkBuddy\resources\vendor\PortableGit\mingw64\bin\git.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File tests/git-review/run.ps1
```

CI 的 `windows-latest` 自带 git，不受影响。这个前提已补进 [maintainer-guide.md](../../maintainer-guide.md) §6.4 与 [testing.md](../../testing.md) §6.3。

**这类问题的价值**：文档写了「怎么跑测试」，但没写「git 找不到时怎么办」。干净克隆验证把它暴露了出来。

---

## 8. CLI 帮助覆盖（在发行包形态下）

对 22 个命令逐个执行 `--help`：

| 项 | 结果 |
|---|---|
| 退出码 | 全部 0 |
| 输出首行 | 全部以 `用法: rds` 开头 |
| 副作用 | `init --help` / `init-dev --help` 前后目录均为空；已有身份文件逐字节不变 |
| `rds help <cmd>` 与 `rds <cmd> --help` | 逐字节相同 |
| 未知命令的 `--help` | `未知命令: xxx`，exit 2（不是认证失败） |

由 `mars/tests/arch/cli-help.test.js` 的 12 个用例守着，`npm test` 每次都会跑。

---

## 9. 结论

| 问题 | 答案 |
|---|---|
| 干净克隆能否直接跑通测试 | **能**。196 项，0 fail，0 skip |
| 干净克隆能否跑通基线 | **能**（修复模板入库后） |
| 干净克隆打出的包与工作区一致吗 | **一致**。都是 109 文件 |
| 只装包、不 clone 仓库能否用 | **能**。`init → put → review → search → compile` 全通 |
| 照文档能否独立完成首次运行 | **能**。10 步逐步对照，含具体数字 |
| 有没有依赖工作区的隐藏假设 | 本轮修掉 1 个（打包内容）；**已知还剩 0 个** |

**唯一需要读者自己补的信息**：G1 与结构自检需要 `git` 在 PATH（或设 `RDS_GIT`）。已写入两份文档。
