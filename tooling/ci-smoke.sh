#!/usr/bin/env bash
# 发行包端到端 smoke：打包 → 内容检查 → 干净前缀安装 → doctor → 全链路。
# 跨平台：Linux 与 Windows（Git Bash）均可运行；不依赖 PowerShell。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

WORK=$(mktemp -d)
TGZ=""
cleanup() {
  [ -n "$TGZ" ] && [ -f "$TGZ" ] && rm -f "$TGZ"
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== 1) 打包 =="
npm pack --silent >/dev/null
TGZ=$(ls -t rds-mother-system-*.tgz 2>/dev/null | head -1)
[ -n "$TGZ" ] || { echo "FAIL 未生成 tarball"; exit 1; }

echo "== 2) 包内容检查 =="
node tooling/pack-check.mjs "$TGZ"

echo "== 3) 干净前缀安装 =="
PFX="$WORK/prefix"
npm install -g "./$TGZ" --prefix "$PFX" --no-audit --no-fund >/dev/null
RDS_BIN="$PFX/node_modules/rds-mother-system/bin/rds.mjs"
[ -f "$RDS_BIN" ] || { echo "FAIL 安装后找不到入口: $RDS_BIN"; exit 1; }
rds() { node "$RDS_BIN" "$@"; }

echo "== 4) 版本与 doctor =="
rds --version
rds doctor

echo "== 5) 端到端闭环 =="
export MARS_DB="$WORK/data/mars.db"
export MARS_PRINCIPALS="$WORK/data/principals.json"
mkdir -p "$WORK/data"

rds init >/dev/null
OUT=$(rds init-dev --principal dev-r0 --projects demo --roles R0,R4)
MARS_TOKEN=$(printf '%s\n' "$OUT" | sed -n 's/^DEV_TOKEN=//p' | tr -d '\r' | head -1)
export MARS_TOKEN
[ "${#MARS_TOKEN}" -eq 48 ] || { echo "FAIL token 长度异常: ${#MARS_TOKEN}"; exit 1; }

rds put --project demo --type L3 --content "ci smoke: install path works" --source docs/ci.md --version v1 >/dev/null
MID=$(rds list --project demo --status proposed | tr -d '\r' | grep -o 'mem_[0-9a-f]*' | head -1)
[ -n "$MID" ] || { echo "FAIL 未写入记忆"; exit 1; }
echo "memory_id: $MID"

# 追加 R4 审批身份（自审会被拒绝，这是设计行为）
node -e '
const fs = require("node:fs"), crypto = require("node:crypto");
const p = process.env.MARS_PRINCIPALS;
const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
const t = crypto.randomBytes(24).toString("hex");
cfg.principals.push({
  token_sha256: crypto.createHash("sha256").update(t).digest("hex"),
  principal_id: "ci-r4",
  project_ids: ["demo"],
  roles: ["R4"],
  note: "ci approver"
});
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
fs.writeFileSync(p + ".r4token", t);
'
R4=$(tr -d '\r' < "$MARS_PRINCIPALS.r4token")

rds review --token "$R4" --project demo --memory "$MID" --decision approved >/dev/null
FOUND=$(rds search --project demo --query "install" | tr -d '\r' | grep -c "$MID" || true)
[ "$FOUND" -ge 1 ] || { echo "FAIL 审批后检索不到 $MID"; exit 1; }
echo "search: 命中 $MID"

rds compile --token "$R4" --project demo --task T-CI-001 --role R4 --budget 4000 --out "$WORK/data/packet.json" >/dev/null
node -e '
const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
for (const k of ["packet", "manifest", "budget"]) {
  if (!(k in p)) { console.error("FAIL context packet 缺少字段: " + k); process.exit(1); }
}
' "$WORK/data/packet.json"
echo "compile: packet 结构完整"

echo ""
echo "SMOKE PASS  安装 → doctor → init → 写入 → 审批 → 检索 → 编译 全部通过"
