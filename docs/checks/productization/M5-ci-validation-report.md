# M5 CI 验证报告

**日期**：2026-11-09（+08:00）
**批次**：M5-B6
**对象**：`72b13d5`（`origin/main`）
**结论**：六个 job 全部 `success`，run 状态 `completed`。

---

## 1. 运行信息

| 项 | 值 |
|---|---|
| Workflow | `CI`（`.github/workflows/ci.yml`） |
| Run ID | **42594239389** |
| Run number | 12 |
| 触发 | `push` 到 `main` |
| Commit | `72b13d528e55437226d111c32484778611bf6607` |
| Commit 标题 | `docs(m5-b6): 补 G1 与结构自检的本地运行前提（git 不在 PATH 时设 RDS_GIT）` |
| 开始时间 | 2026-11-09T09:32:39Z（17:32 +08） |
| **Status** | **Success** |
| **总时长** | **1 分 23 秒** |

链接：https://github.com/LNiiuu/rds-mother-system/actions/runs/42594239389

> **一次观测记录**：GitHub REST API 的 `runs/{id}` 在运行结束后约 20 分钟仍返回 `"status": "in_progress"`，而页面与 `check-runs` 都已显示全部成功。判断 CI 是否通过时，**以页面或 `check-runs` 为准**，不要只看 run 的 `status` 字段。这条写在这里，是为了让后来者遇到同样的不一致时不必重新怀疑一遍。

---

## 2. 六个 job

| job | conclusion |
|---|---|
| `required (ubuntu-latest / node 22.x)` | **success** |
| `required (ubuntu-latest / node 24.x)` | **success** |
| `required (windows-latest / node 22.x)` | **success** |
| `required (windows-latest / node 24.x)` | **success** |
| `structure self-check (windows-latest)` | **success** |
| `g1 (windows-latest / powershell)` | **success** |

**6 / 6 success。** 四个矩阵格覆盖 2 平台 × 2 Node 版本，另加结构自检与 G1。

---

## 3. 怎么确认「真的跑了」

仅仅看到 `conclusion=success` 不够——被条件跳过的 job 也会显示 success（M2.1 就踩过这个坑，当时 G1 用 `if:` 判断文件是否存在，文件没入库时打印 SKIP 并成功退出）。

本轮用四条互相独立的证据：

| # | 证据 | 值 |
|---|---|---|
| 1 | **步骤数** | 四个 `required` job 各有 **14 个步骤**（含新加的 `文档一致性`）。跳过会少步骤 |
| 2 | **总时长** | **1 分 23 秒**。整个 run 被跳过时会集中在数秒 |
| 3 | **G1 耗时** | `g1` job **31 秒**。历史上跳过时在 1 秒内结束；M4 实测真跑 27 秒，与本次同量级 |
| 4 | **结构自检耗时** | `structure self-check` **23 秒**（要读 300 多个文件），不是空跑 |
| 5 | **步骤全绿** | `g1` job 的 `G1 六个夹具` 步骤 `conclusion=success`，不是 `skipped` |

页面显示：`structure self-check 23s`、`g1 31s`、`Matrix: required 4 jobs completed`。

---

## 4. 本次 CI 相比 M4 的变化

`.github/workflows/ci.yml` 只加了一个步骤：

```yaml
      - name: 文档一致性（相对链接可达）
        shell: bash
        run: npm run docs:check
```

放在 `layers` 之后、`test` 之前。四个矩阵格都会跑。

为什么四个格都跑一个纯文档检查：它只要几百毫秒，而「只在某一格跑」需要加条件判断，会让 yml 更难读，也更容易在某次改动后悄悄失效。

### 4.1 这一步抓到了什么

写本报告期间，`npm run verify` 报：

```
DOCS FAIL  4 处不可达（2 个文件）
  docs/checks/productization/M5-clean-clone.md:123  ->  ../quickstart.md
  ...
```

原因是：报告放在 `docs/checks/productization/`，写链接时用了 `../quickstart.md`（只上一级到 `docs/checks/`），正确应为 `../../quickstart.md`。

**这是这个检查存在的最好理由**：185 行的新文档里，4 个路径错了，人工复核很容易漏。修完后 `DOCS PASS`。

---

## 5. 与历史 run 的对照

| 里程碑 | run | commit | job 数 | 结论 |
|---|---|---|---|---|
| M2.1 | 42479193137 | `afd423a` | 6（G1 跳过） | success，但 G1 未执行 |
| G1 入库 | — | `a41c650` | — | G1 开始真实执行 |
| M4 | 42583081805 | `d7cba45` | 6 | 全 success，G1 27s |
| M4 封版 | 42583509413 | `b89cbb2` | 6 | 全 success |
| **M5 代码** | **42594239389** | **`72b13d5`** | **6** | **全 success，1m23s** |
| M5 报告回填 | 42594824632 | `9b3c729` | 6 | 全 success，1m17s |
| M5 最终提交 | 42595065685 | `ef40243` | 6 | 全 success，1m21s |

M5 的 job 数与 M4 相同，新增的 `docs:check` 步骤并入四个 `required` 格，没有新增 job。

### 5.1 一次被取消的 run

`dcd48d9` 的 run 42595020611 显示 `cancelled`（26 秒）。原因不是失败：两次 push 相隔不到 1 分钟，`.github/workflows/ci.yml` 的

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

让后一次 push 终止了前一次。这是**预期行为**——同一分支只需要验证最新提交。它的内容已被 `ef40243` 的 run 完全覆盖。

---

## 6. 覆盖对照

| M5 改了什么 | CI 是否覆盖 |
|---|---|
| 新增 `mars/src/cli-help.js` 与 `cli.js` 的帮助分支 | ✅ `npm test`（12 个帮助用例） |
| `bin/rds.mjs` 的内建命令 `--help` | ✅ `npm test` |
| `bin/doctor.mjs` 新增 `paths:assets`、扩大 `paths:docs` | ✅ `npm run doctor`（4 个格） |
| `tooling/docs-check.mjs` | ✅ `npm run docs:check`（4 个格）+ 7 个测试用例 |
| `package.json` 的 `verify` 链 | ✅ 各步骤独立跑 |
| 两个模板入库 | ✅ `npm test` 的 baseline 相关用例 + `smoke` 的打包检查 |
| 文档改写（install / quickstart / testing / maintainer-guide / 四个索引） | ✅ `docs:check` |
| `tests/self/run.ps1` 的关键词表扩充 | ✅ `structure self-check` |
| `core/*.md` 的路径修复 | ✅ `paths:assets`（`fail` 级） |

---

## 7. 未覆盖的部分

| 项 | 现状 | 说明 |
|---|---|---|
| macOS | 矩阵未含 `macos-latest` | 无真机可对照；加进去只是「跑过」，不等于「支持」 |
| Node 22.15.0 精确边界 | 只测 22.x 最新补丁版 | `actions/setup-node` 的 `22.x` 解析到最新，不固定小版本 |
| 并发写 / 多语句事务 | 无压测 | 无需求 |
| 真实 DSH 联调 | External 测试，不进 CI | 需要真实会话文件 |

---

## 8. 一句话结论

六个 job、四条独立证据确认「真跑过、真通过」。M5 的全部改动——帮助系统、路径检查、文档检查、模板入库——都在 CI 覆盖范围内。
