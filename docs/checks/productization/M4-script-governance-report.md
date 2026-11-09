# M4-B2 脚本治理报告

**批次**：m4-b2
**基线**：`113f208`（m4-b1）
**结论**：活跃脚本语法损坏数为 0；身份签发脚本的"静默抹掉身份"风险已关闭；新增解析守卫防回归。

---

## 1. 全仓脚本语法体检

```bash
$ for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f" || echo FAIL $f; done
（基线：1 个 FAIL —— mars/scripts/seed-phase2.js）
（本批结束后：0 个 FAIL）
```

`mars/scripts/` 15 个文件里，只有 `seed-phase2.js` 是坏的；其余 14 个在基线上就是好的。
`.ps1` 17 个由 Windows CI 的 `structure self-check` 覆盖（PowerShell 解析器），不在本批改动范围。

---

## 2. `seed-phase2.js`：删除

### 核查结果

| 核查项 | 结论 |
|---|---|
| 是否被正式流程调用 | **否**。`package.json` scripts、CI、测试、其他脚本均无引用 |
| 是否有替代 | **是**。职责是"往默认库灌 7 条 Phase-2 演示记忆（按内容哈希幂等）"，用 `rds init-dev` → `rds put` → `rds review` 即可复现，且不绑定历史项目名 `rds-m1` |
| 文档是否依赖 | **否**。`docs/install.md`、`docs/testing.md` 都不提它；仅 `mars/docs/*` 的历史审查记录提及（带日期的证据，属 M5 边界） |
| 是否有可验证的预期行为 | **否**。文件无法解析，无法运行，因此没有任何行为可断言 |
| 真实职责是否可从现行代码确认 | **是**。从可读的头部注释与调用点可确认：`openDb(var/mars.db)` + `store.propose(...)` + 审批，按 `content` 哈希幂等 |

### 删除理由

1. 语法损坏不可逆（含 `?` 替换字符），任何"编码回滚"都是伪造；
2. 无调用方、无文档依赖、职责可替代；
3. 它**直写默认库** `mars/var/mars.db`，误跑会污染开发库；
4. 保留一个"看着能用、实际跑不起来"的脚本，比没有更糟。

### 保留的痕迹

- `CHANGELOG.md` 记录删除与替代路径（B6 统一写）；
- 历史文档不改写：`mars/docs/plan/candidate-manifest.json:452` 仍列着该路径，那是当时的计划清单，不是当前指令。

---

## 3. `mars-issue-mcp-identity.js`：三处加固

这个脚本负责签发 MCP 身份（写 `principals.json` + token 文件），是仓库里少数**会覆盖凭据文件**的脚本。
基线版本有三个真实缺陷：

| 缺陷 | 触发 | 后果 | 修法 |
|---|---|---|---|
| **解析失败即重置** `try{read}catch{ data = {principals: []} }` | `principals.json` 损坏/半写入 | 随后整文件写回 → **所有已签发身份被静默抹掉**（token 哈希不可恢复） | 文件存在但读不出 → 明确失败并拒绝覆盖；缺文件才新建 |
| 未知 flag 静默接受 | `--rol R0`（手误） | 生成 `mcp-undefined` 身份并写进 principals | 白名单校验，未知 flag 报错 exit 2 |
| 角色不校验 | `--role R9` | 写入一个 `role-routing.json` 里不存在的角色，直到运行时才炸 | 角色取自 `role-routing.json`，未知角色拒绝 |

### 实测证据

```
$ node mars/scripts/mars-issue-mcp-identity.js --rol R0 ...
ERROR unknown flag: --rol
usage: node mars-issue-mcp-identity.js --role <R0..R7> ...
exit=2

$ ... --role R9 ...
ERROR 未知角色 R9（已知: R0/R1/R2/R3/R4/R5/R6/R7）
exit=2

$ printf '{"principals": [ broken' > bad.json
$ ... --role R1 --principals bad.json ...
ERROR principals 文件无法解析，拒绝覆盖：...\bad.json（Unexpected token 'b' ...）
提示：先修复或移走该文件；本脚本不会在解析失败时重建身份表。
exit=2
文件未被改动: YES   （前后 sha256 相同）
```

顺带补了 `--help`（此前 `--help` 会被当成未知参数静默忽略）。

**行为保持**：`--revoke` 路径未改语义，`wp1.test.js` 的撤销用例仍通过。

---

## 4. 新增守卫：`mars/tests/arch/scripts.test.js`（8 例）

| 类别 | 用例 |
|---|---|
| 扫描有效性 | 扫到的脚本数 ≥ 15，且三个目录都有命中（防止目录改名后静默扫空） |
| 语法 | 所有 `.js` 用 `vm.Script` 解析（不执行，无副作用）；所有 `.mjs` 用 `node --check` |
| 回归守卫 | `mars/scripts/seed-phase2.js` 不存在；目录里不得再出现同名文件 |
| 行为 | 身份脚本：未知 flag → exit 2 且不落盘；未知角色 → exit 2；principals 损坏 → exit 2 且**字节不变**；`--help` → exit 0 |

### 负向验证（证明守卫真的会红）

```
$ printf 'const x = ;\n' > mars/scripts/_probe_broken.js
$ node --test mars/tests/arch/scripts.test.js
  mars/scripts/_probe_broken.js: Unexpected token ';'
# pass 3
# fail 1
（删除探针后恢复 4/4 → 8/8）
```

---

## 5. 其余脚本：检查了什么、没改什么

| 脚本 | 检查项 | 结论 |
|---|---|---|
| `mars-rollback.js` | 参数解析 / 未知参数 / `--help` / 退出码 | 已合规（未知参数抛错、有 help、返回码分层），**未改** |
| `mars-mcp-disable.js` | 同上 + 写入保护 | 已合规（备份 → 校验 → 原子写 → 回读，默认 dry-run），**未改** |
| `mars-db-backup.js` | 默认路径 / 缺失处理 / 退出码 | 缺文件 exit 2、`integrity_check` 非 ok exit 1，**未改** |
| `phase2-g1-verify.js` / `phase3-sharing-smoke.js` / `phase4-build.js` / `phase4-score.js` / `phase4-usage.js` / `wp5-stress.js` | 语法 / 硬编码宿主 | 均为一次性流程脚本，语法正常；`phase2-g1-verify` 用默认库但只在本地手工跑，**未改**（属 S4） |
| `*.ps1`（17 个） | 参数默认值 / 路径解析 / BOM | M1-M3 已逐次加固；本批未改 |

**没有做的事**：没有为了"统一风格"重写这 14 个正常脚本，也没有给一次性开发脚本补测试（S4，收益低于成本）。

---

## 6. 验收对照（任务书 §6.6）

| 要求 | 结果 |
|---|---|
| 活跃脚本均能通过语法检查 | 是。`git ls-files '*.js' '*.mjs'` 全量 `node --check`：**0 失败**（基线 1） |
| 关键脚本有独立测试 | 是。身份签发脚本 4 例（参数 / 角色 / 数据安全 / help）；另有 4 例解析守卫 |
| 参数错误有明确错误提示 | 是。`unknown flag: --rol` + usage；`未知角色 R9（已知: R0/…/R7）` |
| 重复执行不会造成意外副作用 | 是（既有行为）。身份脚本按 `mcp-<role>` 轮换；`mars-mcp-disable` 默认 dry-run |
| 发行包中的脚本行为与文档一致 | 不适用：`mars/scripts/**` **不在发行包内**（`package.json.files` 未包含），仅源码仓库可用 |
