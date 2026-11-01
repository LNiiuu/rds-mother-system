# W-05 网络流量分析（PCAP）

- 目标：对本地抓包做字段级检查，回答协议、端点与会话问题。
- 输入：PCAP 路径 + SHA-256 + 来源/许可。
- 角色：R2 执行；R6 复核字段过滤命令。
- 工具：REA `inspect_pcap_client`（工具就绪）→ `inspect_pcap_capture` / `inspect_packet_capture`；本机 CLI 为 tshark/capinfos 4.2.2。
- 步骤：
  1. `inspect_pcap_client` 确认 tshark/capinfos 版本与哈希。
  2. 打开抓包，先取摘要（包数/时长/协议分布）。
  3. 按字段过滤抽取目标会话。
  4. 记录 evidence_id 与抓包身份哈希。
- 失败分支（本机实测）：主机安全策略对 `.pcap` 路径直接拒绝（`secret.ext.pcap`）。禁止改名/换扩展名/压缩绕过；记 BLOCKED，等待受控路径或策略审批（AUTH-04）。正常分支与失败分支都必须留证据。
