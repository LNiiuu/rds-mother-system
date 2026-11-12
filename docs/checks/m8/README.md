# M8 原始证据包

本目录是 [M8 端到端验证记录](../productization/M8-e2e-verification.md) 与
[上下文包对比](../productization/M8-packet-comparison.md) 的原始材料。
文件由实测产生，未修改。

## 目录

| 文件 | 内容 |
|---|---|
| `packet-old.json` | M7 代码（`git archive ada7848`）编译的包，11 101 B |
| `packet-new.json` | M8 编译的同内容包，8 074 B |
| `packet-new.md` | M8 的 Markdown 包，6 589 B（含任务正文） |
| `comparison.json` | 字节、重复率、读取成本、真实 prompt token、编译耗时 |
| `e2e-flow.txt` | 源码树里的完整流程（init → … → audit → orchestrate plan） |
| `install-flow.txt` | 发行包临时前缀安装后的用户流程 |
| `recovery.txt` | 数据库备份 → 校验 → 恢复到新路径 |

## 怎么复核

```bash
# 1. 同内容对比：新 JSON 应比旧 JSON 小，且 budget 无 sections
node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync('packet-old.json'));
const n=JSON.parse(fs.readFileSync('packet-new.json'));
console.log(fs.statSync('packet-old.json').size, fs.statSync('packet-new.json').size);
console.log('old budget.sections', !!o.budget.sections, '| new', !!(n.budget||{}).sections);"

# 2. Markdown 是否逐字包含任务正文
#    任务书在 docs/checks/m7/spec/TASK.md
node -e "const fs=require('fs');const md=fs.readFileSync('packet-new.md','utf8');
const t=fs.readFileSync('../m7/spec/TASK.md','utf8').trim();console.log(md.includes(t));"

# 3. 编译耗时（需要一份可用的 MARS 库）
#    rds compile --project <id> --task <id> --role R0 --budget 4000 --format md --out /tmp/p.md
```

## 注意

- `comparison.json` 里的 `content_tokens` 是编译器自报的 `[ESTIMATE]`；
  `measured_provider_tokens` 才是运行时 `prompt_tokens` 的差值（单样本）。
- 旧包是**用 M7 代码在隔离副本上重新编译**得到的，不是 M7 那次的 10 105 B/240 tokens 文件。
  原因：本轮 DB 有 8 条记忆（344 tokens），必须让两边同内容才可比。
- 本目录是 `EVIDENCE`：只对 2026-11-12 的这次测量有效。
