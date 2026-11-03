param(
  [string]$Repo = 'D:\M1',
  [string]$Node = 'node',
  [switch]$CreateDevIdentity,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$mars = Join-Path $Repo 'mars'
if (-not (Test-Path $mars)) { throw "MARS 目录不存在: $mars" }
$cli = Join-Path $mars 'src\cli.js'
$dbDir = Join-Path $mars 'var'
if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Force -Path $dbDir | Out-Null }

Write-Output '== 1) 初始化数据库 =='
& $Node $cli init --db (Join-Path $dbDir 'mars.db')

$principals = Join-Path $mars 'config\principals.json'
if ($CreateDevIdentity) {
  if ((Test-Path $principals) -and -not $Force) {
    Write-Output '== 2) principals.json 已存在，跳过（-Force 可重建） =='
  } else {
    Write-Output '== 2) 生成开发身份（token 仅显示一次） =='
    & $Node $cli init-dev --out $principals --principal dev-r0 --projects 'xingrixiao,m1-dev' --roles 'R0,R4'
  }
} else {
  Write-Output '== 2) 未生成身份；如需 CLI 写入请加 -CreateDevIdentity =='
}

Write-Output '== 3) 自检（只读统计） =='
& $Node $cli stats --db (Join-Path $dbDir 'mars.db')
Write-Output '== 完成。MCP 未启用；不修改 DSH 配置；不联网。 =='
