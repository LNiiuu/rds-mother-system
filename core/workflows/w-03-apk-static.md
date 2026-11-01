# W-03 APK 静态分析

- 目标：在不运行 APK 的前提下，产出包信息、组件、类/方法视图与签名声明。
- 输入：APK 路径 + SHA-256 + 来源/许可。
- 角色：R2 执行；R6 复核包名、类计数与签名声明。
- 工具：REA `inspect_android_package` → `search_android_classes` → `inspect_android_class` → `inspect_android_method` → `inspect_apk_signature`；资源可用 `decode_android_resources`。
- 步骤：
  1. 登记样本来源/许可/SHA-256。
  2. 读包信息（package、SDK、组件、类/资源计数）。
  3. 搜索类清单，挑 1 个关键类做方法级反编译。
  4. 读签名声明（v1/v2/v3），标注“不验证真实性”。
- 输出：`rea/evidence/EV-*-w03-*.md`，含包信息、类清单、方法摘要、签名表、局限。
- 失败分支：JADX provider missing→BLOCKED；解析超时→PARTIAL 并重试一次。
