# macOS 兼容性只读评估

**日期**：2026-11-11（+08:00）
**性质**：**只读评估**。未修改任何 workflow、未改代码、未提交、未打 Tag。
**对象**：`2343e4d`（`origin/main`）
**目的**：判断「把 `macos-latest` 加进 CI」这件事值不值得做、怎么做最小、怎么算通过。

---

## 0. 结论摘要

**建议做，但要先过一个前置验证，且只做最小方案。**

| 项 | 判断 |
|---|---|
| 值不值得 | **值得**。这是唯一一个「代码已声称跨平台、但从未跑过」的声称点 |
| 最大风险 | `node:sqlite` 的 **FTS5** 在 macOS 官方 Node 构建中是否启用。整个引擎压在这一条上 |
| 成本 | 金钱 ≈ 0（public repo 免费额度）；时间 +1 个 job；维护 +1 类失败面 |
| 最小方案 | **单个 `macos-latest` job、只跑 Node 22.x**，走 `doctor` + `npm test` + `ci-smoke.sh` 三步 |
| 预期收益 | 把 `install.md` §11 的「macOS 未验证」改成「CI 实测通过」——从 E3（静态推断）升到 E1（实测） |
| 不做什么 | 不在 macOS 跑 PowerShell 脚本、不为迁就 macOS 改源码、不承诺 `new-project.ps1` |

**前置验证（必须先做）**：在 macOS 上跑一条命令确认 FTS5 可用。

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('create virtual table t using fts5(x)');console.log('FTS5 ok')"
```

这一条不通，后面的评估全部作废。它恰好也是 `rds doctor` 的第 2 项检查，所以「加 job 跑 doctor」本身就是验证。

---

## 1. 现状：平台覆盖

`.github/workflows/ci.yml` 共 6 个 job：

| job | runs-on | 数量 |
|---|---|---|
| `required` | `ubuntu-latest` / `windows-latest` × Node `22.x` / `24.x` | 4 |
| `structure self-check` | `windows-latest`（PowerShell） | 1 |
| `g1` | `windows-latest`（PowerShell） | 1 |

**Linux 与 Windows 各 2 格，macOS 0 格。**

`docs/install.md` §11 当前的表述：

> **macOS**：未实机验证。代码层无 Windows 专有依赖（`powershell.exe` 只出现在测试与脚本中），但未跑过即不承诺。

这是一个诚实的 E3 结论。评估的目标是判断能否把它变成 E1。

---

## 2. 静态评估：八个维度

### 2.1 Node 版本与依赖

| 项 | 现状 | macOS 影响 |
|---|---|---|
| `engines.node` | `>=22.15.0` | Node 官方提供 `darwin-x64` 与 `darwin-arm64` 构建，22/24 都有 |
| `dependencies` | `{}` | 无第三方包，无安装期差异 |
| `devDependencies` | `{}` | 同上 |
| 原生模块 | 无 | 不需要编译工具链（node-gyp / Xcode CLT 都不需要） |
| `node:sqlite` | 内置模块 | 见 §2.5 |

**零依赖是这里最大的优势**：macOS 上最容易出问题的是原生模块编译，而本项目根本没有。

### 2.2 脚本形态

| 类型 | 数量 | 是否进发行包 | macOS 可运行 |
|---|---|---|---|
| `.mjs`（Node 入口与工具） | 入口 3 + 工具 6 | `bin/` 3 个进包 | ✅ |
| `.sh` | 1（`tooling/ci-smoke.sh`） | 否 | ✅（需验证 BSD 工具，见 §3.2） |
| `.ps1` | 18 | **1 个**（`core/scripts/new-project.ps1`） | ❌ 无 PowerShell |
| `.cmd` / `.bat` | 0 | — | — |

**唯一的平台缺口**：`core/scripts/new-project.ps1` 随包分发，但 macOS 用户跑不了。

`docs/install.md` §8 已经给了替代路径：

> 手工方式：复制 `core/templates/project.yaml` 到项目根，替换三个占位符 `<PROJECT_NAME>` / `<PROJECT_ROOT>` / `<STACK>`，然后 `rds validate`

所以这是「体验降级」而非「功能缺失」。评估建议：不改脚本、不引入 pwsh 依赖，只在文档里把「macOS 用手工方式」写清楚。

### 2.3 路径处理

全仓 `process.platform` 只出现 **1 处**：

```js
// tooling/baseline-capture.mjs:35
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
```

反斜杠的出现分三类，都不是硬编码路径：

| 用法 | 例 | 判定 |
|---|---|---|
| 规范化 | `path.relative(ROOT, f).replace(/\\/g, '/')` | ✅ 跨平台正确 |
| 检测绝对路径 | `/^([A-Za-z]:[\\/]|\\\\|\/)/`（`bin/validate.mjs:78`） | ✅ 同时识别盘符、UNC、POSIX |
| SQL 转义 | `LIKE ? ESCAPE '\\'`（`mars/src/retrieval.js`） | ✅ 与平台无关 |

`path.sep` 的使用也正确（`util.js:70,76` 的根目录包含判断、`dsh-session-source.js:149` 的目录名比较）。

**判定：路径层面低风险。** 没有 `D:\`、`C:\Users` 之类硬编码残留（`rds doctor` 的 `paths:code` 每次都在守这一条）。

### 2.4 文件权限与可执行位

**发现一个问题**：

```
$ git ls-files -s bin/ tooling/ci-smoke.sh | head
100644  bin/rds.mjs          ← 无 +x
100644  tooling/ci-smoke.sh  ← 无 +x
```

全仓 **0 个 `100755`**，但 `bin/rds.mjs` 与 `tooling/*.mjs`、`ci-smoke.sh` 都写了 shebang。

| 调用方式 | macOS 结果 |
|---|---|
| `npm install -g .` | ✅ npm 按 `bin` 字段生成 shim 并 chmod |
| `npm link` | ✅ 同上 |
| `node bin/rds.mjs` | ✅ 显式解释器 |
| `./bin/rds.mjs` | ❌ `Permission denied` |
| `bash tooling/ci-smoke.sh` | ✅ 显式解释器 |

**影响范围**：只影响「照着 shebang 直接执行」这一种用法。CI 与文档都没这么用（`ci-smoke.sh` 内部用 `node "$RDS_BIN"` 调用）。

**建议**：本轮不改文件模式（改可执行位会产生跨平台 diff 噪音，且 Windows 上无意义）。若将来要改，用 `git update-index --chmod=+x bin/rds.mjs`，只对 1–2 个真入口文件做。

**行尾**：`.gitattributes` 统一 `eol=lf`，`bin/rds.mjs` 实测 CR 计数为 **0**，shebang 在 macOS 上可正常解析。

### 2.5 SQLite

`node:sqlite` 出现在 5 个文件（`db.js`、`bin/doctor.mjs`、`bin/rds.mjs` 的提示文案、`cli-help.js`、`mars/scripts/mars-db-backup.js`）。

- Node 自 22.5 起提供 `node:sqlite`，捆绑 SQLite
- FTS5 是编译期选项。Node 官方构建**通常**启用，但这是「通常」，不是本项目验证过的事实
- macOS 的 runner 是 **arm64**（`macos-latest` 现已指向 Apple Silicon），构建产物与 x64 不同

**这是整个评估里唯一的高风险项**，也是唯一无法靠静态阅读消除的。验证方式只有一条命令（见 §0）。

**兜底**：`bin/doctor.mjs` 的第 2 项就是「`node:sqlite` 模块可用，FTS5 虚拟表可用」。如果 FTS5 缺失，doctor 会 `fail`、退出码 1、job 直接红——不会静默降级。所以「加 job」本身就是一次可靠的验证。

### 2.6 打包

| 环节 | 实现 | macOS 风险 |
|---|---|---|
| `npm pack` | npm 内置 | 无 |
| 包内容检查 | `execFileSync('tar', ['-tzf', tgz])` | macOS 自带 bsdtar，支持 `-t -z -f`；输出形如 `package/xxx`，与 GNU tar 一致 |
| 干净前缀安装 | `npm install -g ./x.tgz --prefix <dir>` | macOS 全局布局是 `<prefix>/lib/node_modules`，`ci-smoke.sh` 已双候选 + `find` 兜底 |
| 入口定位 | 先试 `lib/node_modules`，再试 `node_modules`，最后 `find` | ✅ 已考虑 |

**判定：低风险。** 这条路径在 Linux 上跑的就是 `lib/node_modules` 分支，与 macOS 同构。

### 2.7 测试

30 个测试文件 / 196 项。与平台相关的只有一处：

```js
// mars/tests/phase1/lifecycle.test.js:67
fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
```

Windows 用 `junction`，其他用 `'dir'`。**macOS 走 `'dir'` 分支，普通用户可创建符号链接**，不需要 sudo。

其余测试：

- 不依赖任何 `.ps1`（`rollback-offline.test.js` 只测 `mars-rollback.js`，注释里点名了「PowerShell 入口只是转调」）
- 临时目录统一用 `fs.mkdtempSync(os.tmpdir(), ...)`
- 无 `skip`，能力缺失即 `assert.fail`

**判定：低风险。** 若 macOS 上符号链接被策略禁用（少见），测试会**红**而不是跳过——这正是期望行为。

### 2.8 外部命令依赖

`ci-smoke.sh` 用到的 POSIX 工具，逐个核对 BSD 版本：

| 命令 | 用法 | BSD/macOS 支持 |
|---|---|---|
| `mktemp -d` | 建临时目录 | ✅ |
| `sed -n 's/^DEV_TOKEN=//p'` | 提取 token | ✅ |
| `grep -o 'mem_[0-9a-f]*'` | 提取 memory_id | ✅ |
| `tr -d '\r'` | 去 CR | ✅ |
| `find ... -print -quit` | 兜底定位入口 | ✅（BSD find 支持 `-quit`） |
| `ls -t` | 取最新 tarball | ✅ |
| `bash` 版本 | `set -euo pipefail`、`trap EXIT`、`${VAR:-0}` | ✅ bash 3.2 均支持（未用数组、`local -n`、`[[ ]]` 等 4+ 特性） |

`shell: bash` 在 macOS runner 上解析为 `/bin/bash`（3.2）。脚本没有用到 3.2 之外的语法。

---

## 3. 平台差异清单

按「会不会让 job 变红」排序。

| # | 差异点 | 影响 | 验证方式 | 风险 |
|---|---|---|---|---|
| **D1** | `node:sqlite` 的 FTS5 在 darwin-arm64 构建中是否启用 | 整个引擎不可用 | `rds doctor` 第 2 项 | **高** |
| **D2** | `zlib.zstd` 在 macOS Node 22.15+ 是否可用 | `rds ledger` 不可用 | `rds doctor` 第 3 项 | 中 |
| **D3** | bsdtar 的 `-tzf` 输出格式 | 包内容检查误报 | `npm run smoke` 的 PACK 步骤 | 中 |
| **D4** | `find -quit` / `mktemp -d` 的 BSD 行为 | smoke 脚本中断 | `npm run smoke` | 低 |
| **D5** | `./bin/rds.mjs` 无 +x | 直接执行失败 | 不进入 CI（用 `node` 调用） | 低 |
| **D6** | `core/scripts/new-project.ps1` 不可运行 | 新项目接入体验降级 | 文档覆盖，非 CI 项 | 低 |
| **D7** | 符号链接创建 | 1 个测试可能失败 | `npm test` 的 `lifecycle.test.js` | 低 |
| **D8** | 路径大小写敏感性 | macOS 默认**不敏感**（APFS 默认 case-insensitive） | 静态检查未发现依赖大小写的路径 | 低 |

D8 值得单独说：macOS 的 APFS 默认大小写不敏感，而 Linux 敏感。如果测试里出现「同一文件用不同大小写引用」的假设，Linux 会红、macOS 不会。当前代码里没有这类引用（`docs-check` 与 `layering-check` 都用 `path.relative` 的精确结果），所以只是登记，不构成风险。

---

## 4. 成本与收益

### 4.1 成本

| 维度 | 评估 |
|---|---|
| **金钱** | 仓库是 **public**（`visibility: public`），GitHub Actions 对 public repo 的标准 runner **不计分钟额度**。macOS 的 10× 倍率只在 private repo 下才扣额度 |
| **时间（wall clock）** | 当前一次 run 约 1m29s（6 job 并行）。加 1 个 macOS job 后，受 public repo 默认并发限制（5 个并行 job），6→7 个 job 会有一轮排队，预计总时长 **1m30s → 3–4 分钟** |
| **时间（macOS 单 job）** | macOS runner 冷启动比 Linux 慢，预计单 job **1.5–3 分钟**（Node 安装 + 196 项测试 + smoke） |
| **维护** | 多一个平台的失败面。runner image 每年升级（`macos-13` → `macos-14` → `macos-15` → arm64 迁移），可能需要跟进。**这是长期成本的主要部分** |
| **代码改动** | `ci.yml` 加 1 个 job（约 20 行）。**零源码改动**（除非验证发现真实缺陷） |

### 4.2 收益

| 收益 | 说明 |
|---|---|
| **把 E3 变 E1** | `install.md` §11 可以从「未实机验证」改为「CI 实测通过（Node 22.x）」，并附 run 链接 |
| **覆盖 macOS 特有路径** | FTS5 的 darwin-arm64 构建、符号链接、APFS 大小写、BSD 工具链——这些在 Linux/Windows 上永远不会暴露 |
| **对使用者的承诺** | 现在说「代码层无 Windows 专有依赖」是推断；跑过之后是事实 |
| **早期发现平台回归** | 后续任何改动若破坏 macOS，会在 PR 阶段发现，而不是等用户报 |

### 4.3 结论

**收益（把一个未验证的声称变成实测）大于成本（一个 job + 每年跟进一次 runner image）。**

但要注意：**「CI 跑通」不等于「macOS 完全支持」**。它能证明的是「在 GitHub 的 macOS runner 上、用 Node 22.x、196 项测试与全链路通过」。不能证明的：Intel Mac（runner 是 arm64）、其他 macOS 版本、pwsh 相关脚本。这些要在文档里写清楚，不能一句「CI 通过」糊过去。

---

## 5. 最小实施方案

### 5.1 方案 A（推荐）：独立 job，只跑 Node 22.x

在 `.github/workflows/ci.yml` 的 `required` job 之后插入：

```yaml
  # macOS 实机验证（M6）：只跑一个 Node 版本。
  # 目的不是覆盖版本矩阵，而是证明「darwin 上的 node:sqlite+FTS5、zstd、
  # 符号链接、BSD 工具链」可用。版本矩阵已有 Linux/Windows 覆盖。
  macos:
    name: macos (${{ matrix.os }} / node 22.x)
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '22.x'

      - name: 环境信息
        shell: bash
        run: |
          node --version
          npm --version
          uname -a
          sw_vers || true

      - name: 自检（doctor：node:sqlite+FTS5 / zlib zstd / 路径卫生）
        shell: bash
        run: node bin/rds.mjs doctor

      - name: Required 测试门禁
        shell: bash
        run: npm test

      - name: 发行包端到端
        shell: bash
        run: bash tooling/ci-smoke.sh
```

**为什么只这三步**：`doctor` 覆盖 D1/D2，`npm test` 覆盖 D7 与全部逻辑，`smoke` 覆盖 D3/D4 与打包安装链路。`config` / `layers` / `docs:check` 与平台无关，重复跑只是浪费机时。

**为什么不跑 `structure-selfcheck` 与 `g1`**：它们是 PowerShell，macOS 上没有。

### 5.2 方案 B：并入 matrix

```yaml
        os: [ubuntu-latest, windows-latest, macos-latest]
```

4 → 6 个 `required` job。多一倍 macOS 机时，换来「Node 24 在 macOS 也可用」的确认。

**建议先 A**。理由：macOS 上的主要风险来自 SQLite 构建，与 Node 22/24 的区别小于构建目标（darwin vs linux）的区别。等 A 稳定几个月、确认无 flaky，再考虑扩到 24。

### 5.3 实施顺序

1. 先在本地/临时分支验证 FTS5 那条命令（若手头有 Mac）
2. 加 job，推一次，观察首个 run
3. 若红：先判断是「平台差异」还是「真实缺陷」。**不为迁就 macOS 改源码**
4. 绿了之后，改文档三处：`install.md` §11、`README.md` 状态表、`testing.md` §6.1 的 job 表
5. 回填 run id 到 `docs/checks/productization/`

---

## 6. 验收标准

**硬性（全部满足才算通过）**：

| # | 判据 | 期望 |
|---|---|---|
| 1 | macOS job 的 `conclusion` | `success` |
| 2 | `doctor` 输出 | `status: ok`，且 `node:sqlite` 与 `zlib:zstd` 两项均为 `ok`（不是 `warn`） |
| 3 | `npm test` 输出 | `GATE PASS tests=196 pass=196 fail=0 skipped=0` |
| 4 | `ci-smoke.sh` 输出 | `PACK PASS` + `SMOKE PASS` |
| 5 | 步骤状态 | 三个步骤都是 `success`，**不能有 `skipped`** |
| 6 | 证据 | 记录 run id、commit SHA、每个 step 的起止时间 |

**软性**：

| # | 判据 |
|---|---|
| 7 | 连续 3 次 run 都不 flaky（macOS runner 偶有网络与磁盘波动） |
| 8 | 失败时的错误信息足以定位，不需要下载完整日志 |

**明确不算通过的情形**：

- job 被 `if:` 跳过但 run 显示 success
- 只跑了 `doctor`，没跑 `npm test`
- 本地 Mac 手动跑通（那是另一类证据，不能替代 CI）
- job 处于 `queued` / `in_progress` 时提前记为通过

---

## 7. 不做什么

| 不做 | 理由 |
|---|---|
| 在 macOS 跑 `structure-selfcheck` / `g1` | PowerShell 实现，macOS 无 |
| 为 macOS 引入 pwsh | 新增运行时依赖，与「零第三方依赖」冲突 |
| 为 macOS 改源码 | 若失败，先定性；平台差异不应靠改业务代码消除 |
| 改文件可执行位 | 会产生跨平台 diff 噪音；`npm install` 已覆盖真实使用路径 |
| 承诺 Intel Mac | `macos-latest` 是 arm64；要覆盖 x64 需 `macos-13`，那是另一个 job |
| 承诺「CI 通过 = 完全支持 macOS」 | 只能证明 runner 上的那一组条件 |

---

## 8. 待确认

1. **是否采用方案 A**（1 个 job，Node 22.x）？
2. **macOS job 失败时是否阻塞**？建议阻塞（与 `required` 同级），否则它会变成「看着绿其实没人管」。
3. **是否接受「不承诺 Intel Mac」**？
4. 若采用，文档里 `install.md` §11 的表述要改成什么粒度？建议：

   > **macOS**：CI 实测通过（`macos-latest` / arm64 / Node 22.x，run `<id>`）。未覆盖 Intel Mac 与其他 macOS 版本；`core/scripts/new-project.ps1` 需要 pwsh，macOS 请用手工方式（§8）。

---

## 9. 本轮没有做的事

- 未修改 `.github/workflows/ci.yml`
- 未改任何源码、脚本、package.json
- 未提交、未打 Tag
- 未在真实 Mac 上执行任何命令（无设备）

所有结论都标注了「静态评估」或「需实测」。**D1 与 D2 是静态阅读无法消除的，必须靠一次真实运行。**
