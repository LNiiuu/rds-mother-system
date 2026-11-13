# W-05 PCAP 流量分析

样本：`<TEMP>\synthetic.pcap`（kind=synthetic）

- SHA-256：`088411ea1d320d9b9e8783658e5d95c86f58a2d345e708719678c94861b2b1c8`
- 链路类型：Ethernet（1）
- 包数：4，字节：428

## 协议分布

- UDP: 2
- TCP: 2

## 主要会话

| 流 | 包数 |
|---|---:|
| `10.0.0.5:51515 -> 10.0.0.1:53/UDP` | 1 |
| `10.0.0.1:53 -> 10.0.0.5:51515/UDP` | 1 |
| `10.0.0.5:52000 -> 93.184.216.34:443/TCP` | 1 |
| `10.0.0.5:52001 -> 10.0.0.9:8080/TCP` | 1 |

## DNS

- aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example.com (A, query)
- aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example.com (A, response)

## HTTP

- GET api.internal.test/api/v1/items

## TLS

ClientHello 0 个；只识别握手类型；未解析 SNI，也未解密任何内容

## 启发式

- **dns-long-label**（medium，2 条）：DNS 标签 > 40 字符或全名 > 50 字符，是 DNS 隧道/数据外带的常见特征（也可能只是 CDN 或反病毒域名）
  例：aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example.com / aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example.com

## 能力边界

- **format**：libpcap only（pcapng 报 UNSUPPORTED_FORMAT）
- **reassembly**：未做 TCP 流重组，HTTP 只取单包首行
- **tls**：不解密、不解析 SNI
- **verdict**：heuristics 是启发式，不是恶意判定
