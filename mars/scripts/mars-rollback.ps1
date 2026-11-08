param(
  [string]$Repo = '',
  [switch]$RemovePrincipals,
  [switch]$RemoveTokens,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
$mars = Join-Path $Repo 'mars'
if (-not (Test-Path $mars)) { throw "MARS 目录不存在: $mars" }
$resolved = (Resolve-Path $mars).Path
if ($resolved -ne (Join-Path (Resolve-Path $Repo).Path 'mars')) { throw "拒绝操作：目标不在 $Repo\mars 内" }

$targets = @()
$varDir = Join-Path $mars 'var'
if (Test-Path $varDir) {
  # 运行时数据库（含 wal/shm）、JSON/CSV；var/backups 下的 mars-<stamp>.db 不受影响
  $targets += Get-ChildItem $varDir -File | Where-Object { $_.Name -match '^mars\.db([-.]|$)|\.json$|\.csv$' }
  if ($RemoveTokens) {
    $tokenDir = Join-Path $varDir 'mcp\tokens'
    if (Test-Path $tokenDir) {
      $targets += Get-ChildItem $tokenDir -File -Filter '*.token' -ErrorAction SilentlyContinue
    }
  }
}
if ($RemovePrincipals) {
  $p = Join-Path $mars 'config\principals.json'
  if (Test-Path $p) { $targets += Get-Item $p }
}

if (-not $targets) { Write-Output '无运行时产物需要删除。'; exit 0 }
Write-Output '将删除以下 MARS 运行时产物（仅限 mars\var 与可选 principals/token）：'
$targets | ForEach-Object { Write-Output ('  - ' + $_.FullName) }
if (-not $Yes) { Write-Output '未加 -Yes，未执行删除。'; exit 2 }
foreach ($t in $targets) {
  if (-not $t.FullName.StartsWith($resolved, [StringComparison]::OrdinalIgnoreCase)) { throw "越界路径: $($t.FullName)" }
  Remove-Item -LiteralPath $t.FullName -Force
}
Write-Output ('已删除 ' + $targets.Count + ' 个文件；源码与文档未改动。')
