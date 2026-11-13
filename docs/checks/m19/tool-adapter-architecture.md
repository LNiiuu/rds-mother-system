# M19 统一工具适配层

**状态**：`IMPLEMENTED`；真实工具执行受本机安装限制。
**代码**：`mars/src/adapters/rea/tool-registry.js`

---

## 1. 接口

每个适配器有：

| 字段/方法 | 含义 |
|---|---|
| `name` / `label` | 工具标识与显示名 |
| `bins` / `versionArgs` | 可执行文件与版本参数 |
| `capabilities` | 能力清单（header/sections/imports/...） |
| `safety` | 安全边界（只读样本、授权设备、临时目录） |
| `detect()` | 存在性、路径、版本、能力 |
| `execute(args, opts)` | 统一执行：execFile、timeout、maxBuffer、exit/stdout/stderr |
| `preflight(name)` | 就绪检查与可操作安装提示 |
| `build*Args()` | argv 级命令构造，不经 shell |

## 2. 已登记工具

| 工具 | 能力 | 本机 |
|---|---|---|
| `objdump` | PE/ELF header、sections、imports、symbols、disassembly | present（2.39） |
| `ghidra` | import、auto-analysis、functions、xrefs、decompile | **missing** |
| `jadx` | APK manifest、dex decompile、resources | **missing** |
| `java` | jadx 运行时 | **missing** |
| `apktool` | APK decode、manifest、resources | **missing** |
| `tshark` | pcap read、protocol hierarchy、conversations | **missing** |
| `frida` | attach、script load、runtime hooks | **missing** |
| `adb` | device list、forward | **missing** |

`rds rea tools` 输出同一份状态。

## 3. 真实执行与阻塞

- `execute()` 工具缺失返回 `{ok:false,error_code:'TOOL_MISSING',install:...}`，不抛、不伪造 stdout。
- 命令全部是 argv 数组，`execFile` 不经 shell。
- 超时默认 120s，输出上限 24MB。
- Ghidra/JADX/TShark/Frida 的命令构造器已实现，但本机无工具，未执行；不把“能构造命令”写成“分析完成”。

## 4. 安全边界

- 样本只读；工具输出写临时目录。
- 不默认对不可信样本执行动态分析；Frida 需要 `own-device|lab|written-consent`。
- 没有容器/VM 隔离；不能声称“恶意样本安全沙箱”。

## 5. 限制

- Ghidra postScript 的结果解析尚未实现；当前只有 Headless 调用骨架与命令构造。
- JADX/TShark 的完整结果解析尚未接入 W-03/W-05；当前 W-03 只做 ZIP 事实层，W-05 用内置 libpcap 解析。
- Frida 只有 preflight 与拒绝桩，没有 hook 脚本管理。
