#!/usr/bin/env bash
# 发行包端到端 smoke：打包 → 内容检查 → 干净前缀安装 → doctor → 全链路。
# 跨平台：Linux 与 Windows（Git Bash）均可运行；不依赖 PowerShell。
#
# 失败时输出 GitHub Actions 注解（::error::），便于在无法下载日志时定位。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

WORK=$(mktemp -d)
TGZ=""
PFX=""

# 清理不能影响退出码：某些环境（沙箱 / 只读挂载）下 rm 会失败，
# 但脚本的成败只应由测试断言决定。
cleanup() {
  rm -f "$TGZ" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "::error title=PACKAGE SMOKE FAILED::$*"
  echo "FAIL $*"
  echo "--- 诊断 ---"
  echo "pwd=$(pwd)"
  echo "node=$(node -v 2>&1) npm=$(npm -v 2>&1)"
  echo "bash=$BASH_VERSION uname=$(uname -a 2>/dev/null || echo n/a)"
  if [ -n "$PFX" ] && [ -d "$PFX" ]; then
    echo "--- prefix 目录结构 ---"
    find "$PFX" -maxdepth 4 -type d 2>/dev/null | head -20 || true
  fi
  exit 1
}

echo "== 1) 打包 =="
npm pack --silent >/dev/null
TGZ=$(ls -t rds-mother-system-*.tgz 2>/dev/null | head -1 || true)
[ -n "$TGZ" ] || fail "未生成 tarball"

echo "== 2) 包内容检查 =="
node tooling/pack-check.mjs "$TGZ" || fail "发行包内容检查未通过"

echo "== 3) 干净前缀安装 =="
PFX="$WORK/prefix"
npm install -g "./$TGZ" --prefix "$PFX" --no-audit --no-fund >/dev/null

# npm 全局目录布局随平台不同：
#   Linux / macOS : $PFX/lib/node_modules/<pkg>
#   Windows       : $PFX/node_modules/<pkg>
RDS_BIN=""
for cand in \
  "$PFX/lib/node_modules/rds-mother-system/bin/rds.mjs" \
  "$PFX/node_modules/rds-mother-system/bin/rds.mjs"; do
  if [ -f "$cand" ]; then RDS_BIN="$cand"; break; fi
done
if [ -z "$RDS_BIN" ]; then
  RDS_BIN=$(find "$PFX" -name rds.mjs -path '*rds-mother-system*' -print -quit 2>/dev/null || true)
fi
[ -n "$RDS_BIN" ] && [ -f "$RDS_BIN" ] || fail "安装后找不到入口 rds.mjs（prefix=$PFX）"

rds() { node "$RDS_BIN" "$@"; }

echo "== 4) 版本与 doctor =="
rds --version || fail "rds --version 失败"
rds doctor || fail "rds doctor 未通过"

echo "== 5) 端到端闭环 =="
export MARS_DB="$WORK/data/mars.db"
export MARS_PRINCIPALS="$WORK/data/principals.json"
mkdir -p "$WORK/data"

rds init >/dev/null || fail "rds init 失败"

OUT=$(rds init-dev --principal dev-r0 --projects demo --roles R0,R4) || fail "rds init-dev 失败"
MARS_TOKEN=$(printf '%s\n' "$OUT" | sed -n 's/^DEV_TOKEN=//p' | tr -d '\r')
export MARS_TOKEN
[ "${#MARS_TOKEN}" -eq 48 ] || fail "token 长度异常: ${#MARS_TOKEN}"

rds put --project demo --type L3 --content "ci smoke: install path works" --source docs/ci.md --version v1 >/dev/null \
  || fail "rds put 失败"

MID=$(rds list --project demo --status proposed | tr -d '\r' | grep -o 'mem_[0-9a-f]*' | sed -n '1p')
[ -n "$MID" ] || fail "rds list 未返回 memory_id"
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
' || fail "追加审批身份失败"
R4=$(tr -d '\r' < "$MARS_PRINCIPALS.r4token")

rds review --token "$R4" --project demo --memory "$MID" --decision approved >/dev/null \
  || fail "rds review 失败"

FOUND=$(rds search --project demo --query "install" | tr -d '\r' | grep -c "$MID" || true)
[ "${FOUND:-0}" -ge 1 ] || fail "审批后检索不到 $MID"

rds compile --token "$R4" --project demo --task T-CI-001 --role R4 --budget 4000 --out "$WORK/data/packet.json" >/dev/null \
  || fail "rds compile 失败"

node -e '
const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
for (const k of ["packet", "manifest", "budget"]) {
  if (!(k in p)) { console.error("缺少字段: " + k); process.exit(1); }
}
' "$WORK/data/packet.json" || fail "context packet 结构不完整"

echo ""
echo "SMOKE PASS  安装 → doctor → init → 写入 → 审批 → 检索 → 编译 全部通过"
