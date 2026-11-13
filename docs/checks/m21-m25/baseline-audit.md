# M21–M25 基线审计

**日期**：2026-11-13（+08:00）
**仓库**：`<REPO>`（branch `main`）
**性质**：只读取证 + 环境盘点；本轮尚未修改代码。

---

## 1. Git 基线

| 项 | 值 |
|---|---|
| HEAD | `e76053e` |
| origin/main | `ada7848` |
| ahead / behind | **20 / 0**，无 merge |
| 工作区 | 开工时 51 项（50 受保护 + 1 上一轮审计）；交付提交前以 `git status` 为准 |
| 暂存区 | 空 |
| Tag | 20 个，均未指向本轮新提交 |
| 远程写入 | 未执行 |

**50 项受保护工作**：49 项未跟踪 + 1 项已跟踪格式化修改（`docs/checks/productization/M9-M11-final-acceptance.md`）。
逐字节核对 **50/50 一致**。本轮禁止 `git add -A`，禁止触碰这 50 项。

上一轮 M18–M20 最终报告：`docs/checks/final/M18-M20-final-acceptance.md`，判定 `PARTIAL`。

---

## 2. 运行环境

| 项 | 值 |
|---|---|
| OS | Windows 11 家庭版中文版，10.0.26200 |
| CPU | Intel Core i5-12500H，12 核 / 16 线程 |
| RAM | 15.8 GB（审计时空闲约 5.8 GB） |
| GPU | NVIDIA GeForce RTX 3050 Ti Laptop，显存约 **4 GB** |
| 磁盘 | C: 49.3 GB 可用；D: 56.2 GB 可用 |
| Node | v22.22.2 |
| Python | 3.13.12（`python`/`python3` 可用；`pip` 命令未注册） |
| Git | 可用（Git Bash） |

**结论**：可运行 3B 级 4-bit 本地模型；7B 会明显溢出 4 GB 显存，需要 CPU 卸载，速度不可接受。
推荐 `qwen2.5:3b`（工具调用支持较好，Q4 约 1.9 GB），备选 `llama3.2:3b`。

---

## 3. 平台接入能力

### 3.1 WorkBuddy

| 项 | 值 |
|---|---|
| 版本 | `37.10.3-43`（`C:\Program Files\WorkBuddy\version`） |
| 安装形态 | Electron 桌面应用，`resources/app.asar` |
| 外部 CLI | **无** `workbuddy` 命令 |
| 外部 HTTP API | 未发现可用的公开任务 API |
| 内置 SDK | `resources/wb-guest-sdk/wb.js`（`@genie/workbuddy-desktop-sdk`，webview guest 侧） |
| SDK 机制 | `window.__wbInvoke` + `wb:invoke:request` 通道 + 事件总线；仅限 WorkBuddy webview 内部 |
| 可外部验证的接口 | MCP stdio（`mars/src/mcp-stdio.js`），WorkBuddy 可作为 MCP 客户端接入 |

**判定**：WorkBuddy 的“平台适配”有两条路径——
1. **MCP 反向接入**：RDS 暴露 MCP server，WorkBuddy 调用，可真实跑通协议；
2. **Guest SDK 桥**：需要 WorkBuddy webview 宿主，当前 CLI 环境**无法真实执行**。

本轮实现 Adapter 契约与 MCP/桥接两种接法；真实 WorkBuddy 会话标记 `NOT RUN`，不伪造。

### 3.2 DSH

| 项 | 值 |
|---|---|
| `dsh` 命令 | **不存在** |
| 安装目录 | 未发现 |
| 现有代码 | `mars/src/adapters/dsh-session-source.js`，只解析 DSH **会话文件**，不是平台任务适配 |

**判定**：DSH 只能做接口设计 + 独立模拟契约测试，标 `MOCK` / `NOT RUN`。

### 3.3 其他平台

- 通用 HTTP：可用本地 `http` 服务做真实双向往返验证。
- MCP：可用本地 stdio 服务做真实 JSON-RPC 验证。

---

## 4. 模型与凭据

| 项 | 状态 |
|---|---|
| `MARS_LLM_*` / `MARS_ANTHROPIC_*` / `OPENAI_API_KEY` | **全部未设置** |
| 云端调用 | 未授权、未发生 |
| Ollama | 本轮安装 `0.40.16`，服务已在 `127.0.0.1:11434` |
| 本地模型 | `qwen2.5:3b` 下载中（后台） |

**原则**：本地模型不可用时明确失败，不自动切云端；任何云端调用必须显式配置。

---

## 5. REA 工具链

| 工具 | 审计时状态 | 本轮处置 |
|---|---|---|
| objdump | 已有（GNU Binutils 2.39） | 复用 |
| Java / javac | 缺失 | winget 安装 OpenJDK 21 |
| jadx | 缺失 | winget 安装 `Skylot.jadx 1.5.6` |
| tshark | 缺失 | winget 安装 Wireshark 4.6.9 |
| Ghidra | 缺失 | winget 无包；评估官方 zip + JDK，若下载可行则装 |
| frida / adb | 缺失 | 无授权设备，保持 `BLOCKED` |
| apktool | 缺失 | 非必需；JADX 覆盖反编译 |

**判定**：W-02（Ghidra）、W-03（JADX）、W-05（TShark）本轮有真实执行可能；
W-06 仍 `BLOCKED`（无设备/未授权），不安装、不执行。

---

## 6. 现有架构与复用点

| 层 | 现有实现 | 本轮动作 |
|---|---|---|
| Provider 端口 | `ports/model-provider.js`，5 方法 + 8 能力键 | **复用**，新增 Ollama 适配器 |
| Provider 适配 | mock / openai-compat / anthropic | 新增 `provider-ollama.js` |
| 平台端口 | **不存在**（只有 session-source / host-registry） | 新增 `ports/platform-adapter.js`，5 方法 |
| 平台注册 | 无 | 新增 `platform-registry.js` |
| 调度 | `runtime/scheduler.js`（DAG/并发/隔离/重试/恢复） | 复用，M24 用它跑真实模型 |
| REA | `adapters/rea/*` + `tool-registry.js` | 复用，补真实工具执行/解析 |
| MCP | `mcp-stdio.js` | 复用/验证，作为 WorkBuddy 接入面之一 |
| 组合根 | `composition.js`，120 行硬上限 | 只加必要工厂，保持行数 |

**架构约束**：平台适配器不得进入 RDS Core；域层只认 `ports/platform-adapter.js`；
WorkBuddy/DSH 的协议细节只能出现在 `adapters/platform-*.js`。

---

## 7. 测试基线

- 全量 **302/302 PASS**（`npm test`）。
- `layers` / `docs:check` / `config` / `baseline` / `pack:check` 全 PASS。
- 上一轮新增：调度 6、锁续期 1、Provider 多轮 2、工具适配 3。

---

## 8. 风险与阻塞

| 风险 | 影响 | 处置 |
|---|---|---|
| WorkBuddy 无外部任务 API | 无法从 CLI 发起真实 WorkBuddy 会话 | 用 guest bridge 契约 + MCP 协议验证；真实宿主 `NOT RUN` |
| DSH 未安装 | 第二平台无法真实执行 | 契约 + 模拟，标 `MOCK` |
| 4 GB 显存 | 大模型/长上下文会 CPU 卸载 | 选 3B Q4；长上下文单独测并记录耗时 |
| winget 安装需管理员/交互 | JDK/JADX/Wireshark 可能失败 | 失败即 `BLOCKED`，不伪造 |
| Ghidra 体积大 | 下载/解压耗时 | 先装 JDK；Ghidra 可行则装，否则 `BLOCKED` |
| 50 项受保护工作 | 误提交会破坏用户工作 | 每批提交前后逐字节核对，禁止 `add -A` |

---

## 9. 实施顺序（统一任务图）

1. M21：Ollama Provider + 真实模型验证（下载完成后）。
2. M22：平台端口/注册表/三适配器/契约测试（可与模型下载并行）。
3. M23：工具安装完成后跑 W-02/W-03/W-05；W-06 保持 `BLOCKED`。
4. M24：真实模型 + 调度器 + REA 联合场景。
5. M25：独立 Reviewer → 二次复核 → 发布审计 → 最终报告。

无依赖任务并行；有依赖任务按上表顺序。所有证据落 `docs/checks/m21..m25/`。
