# CI 验证报告（M2）

> 结论先说：**工作流已就绪，本地等价命令全部通过；但 GitHub Actions 从未真实运行过（本轮禁止 push），Ubuntu 与 macOS 均为未实机验证。**

---

## 1. 工作流结构

文件：`.github/workflows/ci.yml`

| Job | Runner | 触发条件 | 阻塞行为 |
|---|---|---|---|
| `required` | `ubuntu-latest` / `windows-latest` × Node `22.x` / `24.x`（4 个组合） | push / PR / 手动 | 失败即红 |
| `g1-powershell` | `windows-latest` | 同上 | 失败即红 |
| `legacy-selfcheck` | `windows-latest` | 同上 | `continue-on-error: true`（known-red） |

### `required` 的步骤

1. `actions/checkout@v4` + `actions/setup-node@v4`（版本由 `engines` 决定，不降级）
2. 打印 `node / npm / git` 版本
3. `node bin/rds.mjs doctor`
4. `npm run config`（JSON 严格 / YAML lint）
5. `npm test`（Required 门禁）
6. `npm run test:gate-selfcheck`（门禁反向验证）
7. `bash tooling/ci-smoke.sh`（打包 → 内容断言 → 干净前缀安装 → doctor → 写入 → 审批 → 检索 → 编译）

### 为什么 G1 只在 Windows

`tests/git-review/run.ps1` 与 `tooling/git-review/**` 基于 Windows PowerShell 5.1 实现。
Ubuntu runner 只有 `pwsh`，没有 `powershell`。把它放到 Ubuntu 上要么改成跨平台实现（属 M3 范围），
要么伪装成通过——后者不做。所以在 CI 里明确标注为 Windows 能力。

---

## 2. 本地验证（Windows，Node 22.22.2）

逐条执行 CI 中的等价命令：

| CI 步骤 | 本地命令 | 结果 |
|---|---|---|
| doctor | `node bin/rds.mjs doctor` | `status: ok`（fail=0，warn=1：文档侧历史路径） |
| 配置校验 | `npm run config` | `json=51 yaml=4` → CONFIG PASS |
| Required 门禁 | `npm test` | `GATE PASS tests=88 pass=88 fail=0 skipped=0` |
| 门禁反向验证 | `npm run test:gate-selfcheck` | 4/4 PASS |
| 发行包端到端 | `bash tooling/ci-smoke.sh` | `SMOKE PASS`，7 步全通 |
| G1 | `powershell -File tests/git-review/run.ps1` | F1–F6 全 PASS |
| 历史自检 | `powershell -File tests/self/run.ps1` | 1 项 FAIL（历史文档项目名，known-red） |

### 发行包端到端实跑记录

```
tarball: rds-mother-system-0.1.0.tgz  文件 87 个  76184 B
PACK PASS  必需文件齐全，禁止项 0 命中
RDS doctor  status: ok  (fail=0 warn=0 checks=9)
memory_id: mem_xxxxxxxxxxxx
search: 命中 mem_xxxxxxxxxxxx
compile: packet 结构完整
SMOKE PASS  安装 → doctor → init → 写入 → 审批 → 检索 → 编译 全部通过
```

---

## 3. 未完成的验证（如实记录）

| 项 | 状态 | 原因 | 影响 |
|---|---|---|---|
| GitHub Actions 真实运行 | **NOT RUN** | 本轮禁止 push | 无法给出任何 CI 通过结论 |
| Ubuntu runner | **NOT RUN** | 本机 `wsl.exe` 被安全策略拦截，拿不到 Linux 环境 | 跨平台结论仍为 E3 |
| macOS | **NOT RUN** | 无设备 | 维持 E3，不作承诺 |
| Node 24.x | **NOT RUN** | 本机仅 22.22.2 | 由 CI 矩阵覆盖，首次运行才能确认 |
| 工作流 YAML 语义 | **未解析校验** | 仓库零依赖，不引 YAML 解析器 | 只做了结构性 lint；语义由 GitHub 在首次运行时校验 |

> 这四项不能写成 PASS。CI 报告的诚实结论是「配置完成，执行未发生」。

---

## 4. 首次 push 后的观察清单

1. `required` 四个组合是否都绿——重点看 `ubuntu-latest` + Node 22.x。
2. Ubuntu 上 `tooling/ci-smoke.sh` 的 `mktemp` / `npm install --prefix` 是否正常。
3. `legacy-selfcheck` 是否如预期「成功但带警告」（`continue-on-error`）。
4. 若 Ubuntu 出现失败，最可能的位置是：
   - 依赖区分大小写的路径（本仓库目前无）；
   - `tests/self/run.ps1` 被误加进 required（目前没有）；
   - `tar` 行为差异（`pack-check` 使用 `tar -tzf`，两个平台都自带）。

---

## 5. 复现方式

本地跑与 CI 完全相同的门禁：

```bash
npm run verify                 # doctor + config + gate
npm run test:gate-selfcheck    # 门禁自检
bash tooling/ci-smoke.sh       # 发行包端到端
```

远程验证（需授权 push）：

```bash
git push origin main
# 或手动触发：Actions -> CI -> Run workflow
```
