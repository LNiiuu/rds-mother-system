# 变更归属与原有工作保护

> 目的：证明本轮提交没有混入、覆盖或丢失 M1 开工前就存在的工作。

---

## 1. 方法

1. 开工前记录 `git status --porcelain -uall` 到 `status-before.txt`（71 行）；
2. 全量备份工作区到 `D:\M1-backup-20261108-162614`（609 文件，含 `.git`）；
3. 逐文件比对三个阶段的内容：`HEAD` / 备份 / 当前工作区；
4. 提交完成后，再次生成 `status-after-commits.txt`，与 `status-before.txt` **逐字节比对**。

## 2. 结果

```
开工前 71 行 / 提交后 71 行
新增: 0 行
丢失: 0 行
同编码下完全一致: YES
```

**工作区的未提交状态在提交前后完全一致**，这是「原有工作未受影响」的最强证据。

---

## 3. 分类

| 类别 | 定义 | 数量 | 处理 |
|---|---|---|---|
| M1-NEW | 本轮 M1 新增文件 | 8 | 提交 `2af650f` |
| M1-MOD | 本轮 M1 修改的已跟踪文件 | 16 | 提交 `2af650f`（`tests/self/run.ps1` 只暂存本轮改动） |
| M2-NEW | 本轮 M2 新增文件 | 10 | 提交 `9712602` |
| M2-MOD | 本轮 M2 修改的已跟踪文件 | 11 | 提交 `9712602` |
| G1-FIX | 本轮对 G1 未跟踪文件做的路径修复 | 3 | **不提交**，以补丁归档到 `4d863dc` |
| G1-EXISTING / BASELINE | 开工前既有、本轮未触碰的未提交工作 | 67 | 原样保留在工作区 |

合计：提交 45 个文件（8+16+10+11），未提交 70 个未跟踪 + 1 个部分暂存。

---

## 4. 三个需要说明的边界情况

### 4.1 `tests/self/run.ps1`：同一文件里有两拨改动

- 开工前：工作区版本已含 G1 的「WF5 实现检查」代码块（` M`，未提交）；
- 本轮 M1：只改第 1 行参数默认值与体内归一化。

处理方式：提交 A 只把**本轮改动**放进索引（`HEAD` + 本轮两行，通过 `git update-index --cacheinfo` 精确写入），
工作区保留两拨改动。因此：

```bash
git show 2af650f:tests/self/run.ps1   # 不含 G1 代码块
git diff HEAD -- tests/self/run.ps1   # 只剩 G1 代码块
```

这也解释了为什么提交后 `git status` 仍显示 ` M tests/self/run.ps1`。

### 4.2 G1 三处路径修复：改了文件但不提交

`tests/git-review/run.ps1`、`tooling/git-review/review.ps1`、`tooling/git-review/lib/Git.ps1`
是**未跟踪**文件（属于开工前的 G1 工作）。本轮修了它们的默认路径来源。

不提交的理由：

- 这 3 个文件引用了同样未提交的 `tooling/git-review/lib/*.ps1` 等 17 个文件；
- 单独提交会把一套工作流切成碎片，违反「不得将无关的原有未提交变更混入本轮提交」。

归档方式：`docs/checks/productization/g1-path-resolution.patch` + `.md`（提交 `4d863dc`）。
补丁在「仅含 G1 原始文件」的临时仓库上 `git apply --check` 通过，应用结果与工作区一致。

### 4.3 无法安全拆分、保留为未提交

| 文件/目录 | 原因 |
|---|---|
| `docs/checks/git-review/**`（30 项） | G1 运行记录，与 G1 主体同批产生 |
| `docs/history/**`（14 项） | 作者整理的历史材料 |
| `docs/analysis/**`、`docs/runs/**`（5 项） | 分析与运行记录 |
| `core/policies/git-review.md`、`core/workflows/wf5-git-review.md`、`core/templates/git-*` 等（6 项） | G1 的策略与模板 |
| `tooling/agent-runtime/rds-render-role.ps1` | 未提交的角色渲染器（M4 范围） |

这些内容保持未跟踪状态，未被修改、未被删除、未被提交。

---

## 5. 提交内容清单

### `2af650f` feat(m1)

新增（8）：`LICENSE`、`package.json`、`bin/rds.mjs`、`bin/doctor.mjs`、`bin/validate.mjs`、
`docs/install.md`、`.gitattributes`、`tooling/toolchain.local.example.json`

修改（16）：`.gitignore`、`CHANGELOG.md`、`README.md`、`core/scripts/new-project.ps1`、
`core/templates/project.yaml`、`mars/scripts/mars-baseline.ps1`、`mars/scripts/mars-install.ps1`、
`mars/scripts/mars-mcp-disable.ps1`、`mars/scripts/mars-rollback.ps1`、`mars/scripts/phase4-usage.js`、
`mars/src/cli.js`、`mars/src/db.js`、`tests/self/run.ps1`（仅本轮部分）、
`tooling/backup.ps1`、`tooling/probe.ps1`、`tooling/sync.ps1`

### `4d863dc` chore(g1)

新增（2）：`docs/checks/productization/g1-path-resolution.patch`、`g1-path-resolution.md`

### `9712602` feat(m2)

新增（10）：`.github/workflows/ci.yml`、`docs/testing.md`、`mars/scripts/mars-rollback.js`、
`mars/tests/fixtures/ledger/make-session.js`、`mars/tests/external/dsh-real-session.external.js`、
`tooling/test-gate.mjs`、`tooling/test-gate-selfcheck.mjs`、`tooling/pack-check.mjs`、
`tooling/config-check.mjs`、`tooling/ci-smoke.sh`

修改（11）：`package.json`、`bin/rds.mjs`、`README.md`、`CHANGELOG.md`、`docs/install.md`、
`mars/scripts/mars-rollback.ps1`、`mars/tests/ledger/ledger.test.js`、
`mars/tests/phase1/ledger-reconcile.test.js`、`mars/tests/phase1/lifecycle.test.js`、
`mars/tests/phase1/rollback-offline.test.js`、`mars/tests/phase2/wp1.test.js`

---

## 6. 提交前检查（每次提交都执行）

| 检查 | 结果 |
|---|---|
| 暂存区文件清单核对 | 通过（21 / 2 / 24，与预期一致） |
| 敏感串扫描（40+ 位 hex、`DEV_TOKEN=`、私钥头） | 0 命中 |
| 凭据文件（`principals.json` / `*.db` / `*.token` / `toolchain.local.json`） | 0 命中 |
| BASELINE 目录（`git-review` / `history` / `analysis` / `runs` / `agent-runtime`） | 0 命中 |
| `git diff --check` | 无空白错误 |
