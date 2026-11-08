param(
  [string]$Repo = '',
  [switch]$RemovePrincipals,
  [switch]$RemoveTokens,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }

# 实现已迁移到 mars-rollback.js（跨平台、可被同一套测试覆盖）。
# 本文件保留为兼容入口：转发参数并透传退出码（0=已删除 / 2=dry-run / 1=错误）。
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw '需要 Node.js >= 22.5：rollback 的实现位于 mars-rollback.js' }

$forward = @('--repo', $Repo)
if ($RemovePrincipals) { $forward += '--remove-principals' }
if ($RemoveTokens) { $forward += '--remove-tokens' }
if ($Yes) { $forward += '--yes' }

& $nodeCmd.Source (Join-Path $PSScriptRoot 'mars-rollback.js') @forward
exit $LASTEXITCODE
