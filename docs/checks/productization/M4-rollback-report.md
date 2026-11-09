# M4 回滚演练报告

**方法**：`git clone --shared` 到临时目录 → `git checkout <tag>` → `git revert <tag>` →
跑门禁 → `git revert HEAD`（撤销回滚）→ 再跑门禁。
演练全程在克隆里，**不触碰** `D:\M1` 工作区与 `mars/var` 下的真实数据。

---

## 1. 逐批结果

| Tag | 批次状态 | revert 后 | 撤销 revert 后 | 判定 |
|---|---|---|---|---|
| `m4-b0` | `128/128/0/0` | `128/128/0/0` | `128/128/0/0` | PASS |
| `m4-b1` | `136/136/0/0` | `128/128/0/0` | `136/136/0/0` | PASS |
| `m4-b2` | `144/144/0/0` | `136/136/0/0` | `144/144/0/0` | PASS |
| `m4-b3` | `153/153/0/0` | `144/144/0/0` | `153/153/0/0` | PASS |
| `m4-b4` | `161/160/1` ❌ | `153/153/0/0` | `161/160/1` ❌ | **CONDITIONAL** |
| `m4-b5` | `171/170/1` ❌ | `161/160/1` ❌ | `171/170/1` ❌ | **CONDITIONAL** |

所有 revert / revert-revert 都是 **clean revert**（无冲突）—— 说明各批次改动边界清晰。
问题出在"批次自身在干净克隆里跑不绿"。

---

## 2. m4-b4 / m4-b5 失败的原因（这才是演练的价值）

```
not ok 77 - B4 MCP initialize 的 serverInfo.version 等于产品版本（端到端握手）
  error: [mars] ENOENT: no such file or directory,
         open '<clone>\mars\config\principals.json'
```

两个真实缺陷，都被"本机文件存在"遮住了：

**① 测试依赖仓库内未跟踪文件。**
`version.test.js` 直接 spawn MCP，而 MCP 需要 `mars/config/principals.json`。
该文件是本机运行产物（被 gitignore），在 `D:\M1` 里存在，在干净克隆里不存在
→ 本机绿、克隆红。这是 M2 之后又一次"测试依赖作者环境"，只是换了形态。

**② MCP 缺身份时直接退出，与文档承诺不一致。**
`docs/install.md` §9 写的是"token 缺失不阻止启动，每次调用返回 AUTH_DENIED"，
但缺 `principals.json` 时进程会以 `[mars] ENOENT …` 退出 —— 客户端只看到进程消失，
没有任何可行动信息。**新装机器上先启 MCP、后跑 `init-dev` 就会踩到。**

修复落在 B6（两处）：

| 修复 | 文件 |
|---|---|
| 测试自建临时 `principals.json` / `MARS_DB`，不再依赖仓库内产物 | `mars/tests/arch/version.test.js` |
| MCP 缺身份时降级启动：空身份表 + stderr 两条 WARN + 每次调用 `AUTH_DENIED` | `mars/src/mcp-stdio.js` + 2 例回归测试 |

---

## 3. 为什么没有回改 m4-b4 / m4-b5

历史 tag 指向的是**当时**的提交。把 B6 的修复塞回 B4 需要重写历史，
既违反本轮"不改写既有提交"的约束，也会让"每批验证过什么"的记录失真。
因此保留这两个 tag 的已知失败状态，并在本文件里写清原因与修复位置。

**实际影响**：`m4-b5` 之后的所有提交（含 B6 与最终 HEAD）都是绿的；
受影响区间只有"单独检出 m4-b4 / m4-b5 且在无 principals.json 的机器上跑测试"这一种用法。

---

## 4. B6 演练（提交后补记）

B6 提交后在同样方式下演练：`revert B6` → 确认回到 `m4-b5` 的 `171/170/1`（即 B6 修复前的已知状态），
`revert-revert` → 回到 `173/173/0/0`。结果见 §5。

---

## 5. 数据安全

| 检查 | 结论 |
|---|---|
| 演练是否触碰 `mars/var/mars.db` | 否。克隆内没有 `mars/var`；测试全部用 `:memory:` 或临时目录 |
| 演练是否触碰真实 DSH 注册表 | 否。注册表测试只写临时目录 |
| 是否删除过真实文件 | **有一次，已恢复**：核查备份脚本时误删 `mars/var/backups` 下 4 个历史文件，已从 `M1-backup-20261108-162614` 逐文件 `cp -a` 恢复并逐个 `integrity_check`（详见 `M4-database-maintenance-report.md` §4） |
| 演练目录清理 | 每次演练后 `rm -rf %TEMP%\m4-rb` |

---

## 6. 结论

- 六个批次的改动都是**可干净 revert** 的（无冲突），批次边界成立；
- 四个批次（B0–B3）在干净克隆里 revert 前后均全绿；
- 两个批次（B4/B5）暴露"测试依赖本机产物 + MCP 缺身份即退出"，已在 B6 修复并加回归测试；
- 演练方法本身有效 —— 这两个缺陷在 `D:\M1` 里跑了七轮门禁都没暴露。
