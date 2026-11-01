# AP-12 首次提交准备与内容审查记录

- 时间：2026-11-01 21:56（+08:00）
- 依据：任务书 v1.3.1 §7.2 A-07/A-08、§10.1 AP-12；用户本轮确认身份
- 身份（用户确认）：`user.name = LNiiuu`，`user.email = liuchuanyu07@outlook.com`
- 结论：**候选就绪，可提交审核；未执行 commit / push / 远程配置**

## 1. Git 开场快照

| 项 | 值 |
|---|---|
| Git 版本 | 2.56.0.windows.4 |
| 执行路径 | `D:\Tools\Git\bin\git.exe` |
| 仓库根 | `D:/M1` |
| 分支 | `main`（`symbolic-ref --short HEAD`）|
| HEAD | **unborn**（`rev-parse --verify HEAD` → fatal: Needed a single revision）|
| 暂存区 | 空（`ls-files --stage` 0 行；`diff --cached` 为空）|
| local 配置（开场） | 仅 `core.*` 默认项，无 user.* |
| global 配置（开场） | `C:\Users\liuch\.gitconfig` **不存在**（无全局身份）|
| remote | 无 |
| 工作区 | 88 文件 / 94,028 B，`status --porcelain` 10 条（顶层目录折叠）|
| 文件类型 | 88/88 为文本（无 NUL 字节，无二进制、无样本、无压缩包）|

## 2. 本地身份配置与核验

执行：

```
git -C D:\M1 config --local user.name  "LNiiuu"
git -C D:\M1 config --local user.email "liuchuanyu07@outlook.com"
```

核验：

- `config --show-origin --get user.name` → `file:.git/config  LNiiuu`
- `config --show-origin --get user.email` → `file:.git/config  liuchuanyu07@outlook.com`
- `config --local --list` 仅新增上述两项；global 文件仍不存在（未创建、未修改）
- 仓库外对照 `git -C C:\ config --get user.name` → 空（身份不外溢）

## 3. 审查方法

1. 全量清单：88 文件逐项登记大小与 SHA-256（见附录 A，摘要见 §4）。
2. 二进制判定：逐文件读取前 512 字节检测 NUL → 0 个二进制文件。
3. 内容扫描（全部 88 文件，非按文件名判断）：
   - 凭据类关键字（password/token/secret/key/credential/cookie/Authorization/Bearer/AKIA/ghp_/sk-/PRIVATE KEY/AppID/secret/openid/unionid）；
   - 个人/路径类（用户目录、`/home/`、工具绝对路径、邮箱、11 位手机号）；
   - 网络类（URL、IPv4、localhost）；
   - 临时/会话类（AppData、%TEMP%、session-*、dsh-*）；
   - 高熵串（≥40 位 base64 形态）；
   - 危险构造（Invoke-WebRequest/RestMethod/Expression、Start-Process、Remove-Item 递归、curl/wget/ssh/scp、force push、commit/reset）。
4. 可执行/配置文件全文人工复核：`tests/self/run.ps1`、`tooling/*.ps1`、`core/scripts/new-project.ps1`、`tooling/manifest/*.json`、`stacks/*/stack.yaml`、`docs/checks/*.md`、根 README/CHANGELOG/VERSION/.gitignore。
5. 编码与行尾：全部 UTF-8 可解析，无替换字符；无混合二进制。

## 4. 审查结果

### 4.1 未发现（0 项）

- 无密码、Token、API Key、私钥、Cookie、会话凭据；
- 无 `.env` / 证书 / 密钥文件；
- 无邮箱、手机号、IPv4、临时目录或会话 ID 泄漏；
- 无日志堆栈、构建产物、缓存、压缩包、APK/PCAP/二进制样本；
- 无 `Invoke-WebRequest` / `Start-Process` / 递归删除 / 远程写等危险构造（脚本仅本地文件操作 + 只读 git 调用）；
- 高熵串全部为 SHA-256 或 REA evidence_id（共 23 处，均为审计哈希）。

### 4.2 已知并接受的痕迹（记录，非阻断）

| 编号 | 痕迹 | 位置 | 判断 |
|---|---|---|---|
| R-01 | 自检脚本内置 4 个禁用串（含旧项目名与业务路径） | `tests/self/run.ps1:48` | 属隔离守卫；建议后续参数化（改由 project.yaml 或清单注入），不阻断 |
| R-02 | 机器路径与用户名（`D:\M1`、`C:\Users\liuch\.dsh`、`/home/<user>`） | 证据/清单/脚本 | 私有仓库内可接受；建议后续相对化 |
| R-03 | GitHub 私有仓库 URL 与账号名 | `docs/checks/GITHUB.md` | 私有仓库，非凭据；可接受 |
| R-04 | 安全策略规则名（pcap 拦截规则） | 证据/检查点 | 仅规则名，无参数/凭据；可接受 |
| R-05 | `.gitignore` 的 `samples/` 规则把 `rea/samples/` 整体忽略（含 `index.md`） | `.gitignore` | 已用 `git add -f -- rea/samples/index.md` 纳入；**建议后续加 `!rea/samples/index.md` 例外**，否则该文件改动将默认不被跟踪 |
| R-06 | 工作区 LF 文件出现 “LF will be replaced by CRLF” 警告 | `D:\Tools\git\etc\gitconfig` 的 `core.autocrlf=true`（系统级，非本仓库设置） | 提交内容不受影响（索引内仍为原字节）；换行策略统一留待后续决定 |
| R-07 | `git diff --cached --check` 报 61 处 “new blank line at EOF” | 61 个文件末尾多一个空行 | 仅空白风格提示，非错误；建议后续统一清理，不阻断首次提交 |

### 4.3 分类统计

| 分类 | 数量 | 说明 |
|---|---|---|
| APPROVE | 89 | 88 个系统文件 + 本审查记录（其中 `rea/samples/index.md` 因 R-05 需 `-f` 纳入）|
| EXCLUDE | 0 | — |
| REVIEW_REQUIRED | 0 | — |

## 5. 暂存清单

暂存方式：逐文件显式 `git add -- <path>`，**未使用 `git add -A`**。清单见 §7 实测输出（按目录汇总）：

- 根：`.gitignore`、`README.md`、`CHANGELOG.md`、`VERSION`
- `core/`：policies 8、protocols 2、roles 10（8 卡 + 模板 + roster）、workflows 10（WF1–4 + W-01–06 两份视图）、templates 6、bootstrap 1、scripts 1、README 1
- `stacks/`：2（weapp、native-bin）
- `tooling/`：脚本 4、manifest 8、`mcp-lifecycle.md`
- `rea/`：baseline 2、evidence 8（EV-001…006 + index + README）、workflows 6、samples 1
- `tests/`：`self/run.ps1`
- `docs/`：`M1-0-PROGRESS/DELIVERABLES/ACCEPTANCE`、`acceptance/README`、checks 7（含本记录）

## 6. 提交前检查命令（本轮实际执行）

```
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git status --porcelain
```

（输出见 §7；`--check` 无空白错误时输出为空。）

## 7. 实测（暂存后）

- 暂存文件数：**89**（88 个系统文件 + 本审查记录；`rea/samples/index.md` 经 `-f` 纳入，见 R-05）
- 暂存总字节：**102,299 B**（对索引内 89 个 blob 用 `git cat-file --batch-check` 逐项求和；开场工作区 88 文件 94,028 B 未含本记录）
- 暂存统计：`89 files changed, 2,267 insertions(+)`（本记录最后一次修订会使自身字节数微增，属自指测量差）
- `diff --cached --name-status`：89 行，**全部为 `A`**
- `status --porcelain --untracked-files=all`：89 行，全部 `A `；**无未暂存、无未跟踪**
- `diff --cached --check`：61 行，全部为 “new blank line at EOF”（R-07），无其它空白错误
- 换行：受系统 `core.autocrlf=true` 影响出现 LF→CRLF 警告（R-06），索引内字节未变
- 敏感扫描（对最终暂存内容）：0 命中真实凭据（仅哈希值、规则名、机器路径）
- 母体系自检：`powershell -NoProfile -ExecutionPolicy Bypass -File D:\M1\tests\self\run.ps1` → **RESULT: PASS**（required 39 项、8 角色卡、6 套 REA 工作流、8 份 manifest、禁用串、project.yaml 全通过）
- Git 收尾状态：HEAD 仍 **unborn**、branch `main`、remote 为空、**未执行 commit / push / 设 origin**

## 8. 风险与未解决项

1. `tests/self/run.ps1` 的禁用串含旧项目名（R-01）：建议第二批改为参数化；不阻断。
2. GitHub 链路仍不可达（`SEC_E_NO_CREDENTIALS`），首次 push 前需实测修复（H4）。
3. `.gitignore` 的 `samples/` 规则与“仅提交样本索引”的设计冲突（R-05）：本次以 `-f` 纳入，后续应在 `.gitignore` 增加 `!rea/samples/index.md`，否则该索引的更新不会被普通 `git add` 捕获。
4. 本记录本身描述审查过程，不含任何凭据。

## 9. 回滚暂存的方法

- 单文件撤出：`git rm --cached -- <path>`（仅移出索引，保留工作区文件）
- 全部撤出：`git restore --staged .`（等价 `git reset` 的非破坏形式；不会丢文件）
- 注意：以上均为本地索引操作；未执行，留待需要时使用。

## 10. 结论

- 首次提交候选已形成；内容审查完成；无已知敏感信息；未执行 commit/push。
- 建议：用户审核本记录与 §7 清单后，再批准 AP-12 首次 commit。

## 11. 最终复核补记（R-05 修正后，2026-11-01 22:30）

- 用户复核意见：同意修正 R-05；R-06（系统 `core.autocrlf`）暂不处理；R-07 暂不批量修改，仅调查并给出建议；不得 commit/push/设 origin。
- `.gitignore` 第 38–42 行新增（未删除、未扩大）：
  `!rea/samples/` → `rea/samples/*` → `!rea/samples/index.md`。
- 验证：`git check-ignore -q rea/samples/index.md` → 退出码 **1（未被忽略）**；`rea/samples/*.apk`、`rea/samples/other.txt`、`rea/samples/sub/x.txt` → 退出码 0（仍忽略）；`git ls-files --others --exclude-standard` 为空。
- 暂存区：现为 **90 文件**（新增 `AP-12-final-review.md`），全部 `A`；`.gitignore` 已重新暂存；无未暂存/未跟踪。
- 本记录 §7 的字节/插入数为 **R-05 修正前**的初稿实测值；修正后的最终统计见 `docs/checks/AP-12-final-review.md` §5。
- R-07：61 个文件（Markdown 46、JSON 6、PowerShell 4、YAML 3、`.gitignore` 1、`VERSION` 1），均为末尾多一空行，无功能影响；建议单列后续“EOF 规范化”任务处理。
- Git 状态：`main` / HEAD unborn / remote 空 / 身份仅 local；未执行 commit、push、origin。
