# W-03 Android APK 静态分析

## 适用 / 前置
- 授权 APK；JADX 接入（M1-0B 补齐）。

## 输入
- APK 路径、哈希。

## 步骤
1. `decode_android_resources` → 2. JADX 类清单/关键类反编译 → 3. `inspect_apk_signature` → 4. `project_android_application_graph`。

## 证据
- manifest/组件/签名/类清单 + 样本哈希 + evidence_id。

## 失败分支
- JADX 缺失 → 记 L1/blocked，不得写 L3。

## 不适用 / 禁令
- 不安装到真实设备；不上传 APK。

## 复跑
- 同哈希复跑，类数/签名一致。

