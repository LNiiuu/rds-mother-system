# M23 REA 工具链审计与真实执行

**日期**：2026-11-13
**状态**：**`PARTIAL`**
**真实新增**：TShark 4.6.9 安装并真实执行 W-05；Java 21（Temurin JRE）可用。
**仍阻断**：Ghidra 未安装；JADX 下载不完整；无授权 APK 样本；无 Frida 设备。

---

## 1. 工具矩阵

| 工具 | 安装方式 | 版本 | 路径/来源 | 真实执行 | 状态 |
|---|---|---|---|---|---|
| objdump | 既有 MinGW | GNU Binutils 2.39 | PATH | 是（W-02/W-04） | **PASS** |
| Java | Temurin JRE zip（清华镜像） | 21.0.13+9 LTS | `D:\tools\jre\jdk-21.0.13+9-jre` | 版本验证 | **PASS** |
| TShark | Wireshark 4.6.9 MSI 管理解压（清华镜像） | 4.6.9 | `D:\tools\wireshark\extract\Wireshark\tshark.exe` | 是（W-05 交叉核验） | **PASS** |
| JADX | gh-proxy 下载 zip | — | 下载 31 MB 后停滞，zip 不完整 | 否 | **BLOCKED** |
| Ghidra | GitHub 543 MB zip | — | 下载被 `schannel` 中断，无可用镜像 | 否 | **BLOCKED** |
| Frida / adb | 未安装 | — | 无授权设备 | 否 | **BLOCKED** |
| apktool | 未安装 | — | JADX 可覆盖，非必需 | 否 | **N/A** |

**安装失败原因**（不是代码问题）：

1. `winget` 安装 JDK/Wireshark 需要 UAC 管理员确认；当前非交互会话无法完成，进程挂起后终止。
2. 改用免安装方案：JRE zip + Wireshark MSI `msiexec /a` 管理解压，均成功。
3. GitHub 大文件下载多次 `schannel: server closed abruptly`；Ghidra 无国内镜像可达。
4. JADX 经 `gh-proxy.com` 下载到 31 MB 后停滞，zip 中央目录缺失，不能解压。

---

## 2. W-05：TShark 真实执行

样本：`tooling/make-pcap-fixture.cjs` 生成的合成 pcap（4 包：UDP 2 / TCP 2 / DNS 2 / HTTP 1）。

命令（由 `w05-pcap.js` 通过 `execFile` 执行，argv 不经 shell）：

```text
tshark -r <TEMP>/synthetic.pcap -q -z io,phs
```

真实输出：

```text
frame  frames:4 bytes:428
  eth  frames:4
    ip frames:4
      udp frames:2
        dns frames:2
      tcp frames:2
        http frames:1
```

- 退出码 0；`frame_count=4`，与内置解析 `packets=4` **一致**；
- `MARS_TSHARK_PATH` 显式指定工具路径，避免依赖 PATH；
- 结果写入 `docs/checks/m19/W-05/result.json` 的 `result.tshark.run`；
- 证据命令写入 `docs/checks/m19/W-05/evidence.json` 的 `commands`。

**W-05 仍为 `PARTIAL`**：没有 TCP 重组、TLS 解密、真实流量；TShark 只做协议层级/包数交叉核验。

---

## 3. W-02：Ghidra 仍阻断

- objdump 结构/导入/字符串/反汇编是真实的（W-02/W-04）；
- Ghidra Headless 未安装，无法做反编译、类型恢复、xref 全图；
- `tool-registry` 已支持 `GHIDRA_HOME` 与 `MARS_GHIDRA_PATH`，工具一旦可用即可执行；
- **W-02 维持 `PARTIAL`**，不能把 objdump 写成 Ghidra。

---

## 4. W-03：JADX 与样本双重阻断

- JADX 未安装完成（下载不完整）；
- 即使安装，本机只有用户下载的第三方 APK，**没有授权样本**；合成 ZIP 不是可反编译 APK；
- 因此本轮不执行任何第三方 APK 分析，**W-03 维持 `BLOCKED`**；
- 需要用户提供：JADX 可用安装 + 明确授权的测试 APK（自建或书面授权）。

---

## 5. W-06：Frida 仍阻断

- 未安装 frida/adb；无授权测试设备；
- 不执行任何动态插桩；**W-06 维持 `BLOCKED`**。

---

## 6. 安全边界

- 样本只读、SHA-256、临时目录；
- TShark 只读 pcap，不抓 live interface；
- 不执行样本；不分析未授权第三方 APK；
- 工具输出/命令写入证据时脱敏本机临时路径。

---

## 7. 结论

| 工作流 | 状态 | 真实依据 |
|---|---|---|
| W-01 | **PARTIAL** | 真实仓库扫描、静态依赖图/符号 |
| W-02 | **PARTIAL** | objdump 真实；Ghidra 缺失 |
| W-03 | **BLOCKED** | JADX 不完整 + 无授权 APK |
| W-04 | **PARTIAL** | objdump 真实；间接调用未解析 |
| W-05 | **PARTIAL** | 内置解析 + TShark 4.6.9 真实交叉核验 |
| W-06 | **BLOCKED** | 无 Frida/adb/设备 |

**M23 判定：`PARTIAL`。** 新增的真实能力是 W-05 的 TShark 执行；其余阻断均给出可操作的解除条件。
