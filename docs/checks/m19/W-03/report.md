# W-03 Android APK 静态分析（BLOCKED）

样本：`<TEMP>\synthetic.apk`

- SHA-256：`7178079ae6f8b225c3747347a0dc81dc8ab1ebee956eed45690835002a5132b3`
- 大小：836 B

## 阻塞原因

缺工具：jadx, java

本机无 jadx / java / apktool；WSL 被安全策略封禁，无法借用另一环境的工具链

**未做**：AndroidManifest 解码（权限/组件/API level）、DEX 反编译（Java/Kotlin 源码）、resources.arsc 解析、网络相关代码定位、可疑调用链

## 仍能确定的事实（ZIP 结构）

- 条目数：7
- DEX：classes.dex(8 B), classes2.dex(8 B)
- 二进制 Manifest：存在（未解码）
- resources.arsc：存在
- native 库：lib/arm64-v8a/libnative.so
- 签名文件：META-INF/CERT.RSA

> 包内有哪些文件、DEX 数量与大小、是否有 native 库与签名文件——这是事实层，不是分析结论
