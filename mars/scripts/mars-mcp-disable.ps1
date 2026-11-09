# MARS MCP disable script (Phase 2 / G1).
# M3 / B4: this script now only delegates. The logic lives in mars/scripts/mars-mcp-disable.js.
# The old version rewrote the host registry with ConvertFrom-Json / ConvertTo-Json
# (no structure check, no atomic write). The new one backs up first, validates the
# entries array, preserves unknown top-level fields, writes tmp+rename, reads back.
#
# Dry-run by default; pass -Yes to write. Does not touch the mars database or sources.
param(
  [string]$Registry = (Join-Path $env:USERPROFILE '.dsh\skill-mcp-manager\registry.json'),
  [string]$BackupDir = '',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'

$node = $env:RDS_NODE_BIN
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node) { Write-Error 'node not found: add Node 22.5+ to PATH or set RDS_NODE_BIN'; exit 2 }

$impl = Join-Path $PSScriptRoot 'mars-mcp-disable.js'
if (-not (Test-Path -LiteralPath $impl)) { Write-Error ('missing implementation: ' + $impl); exit 2 }

$cliArgs = @($impl, '--registry', $Registry)
if ($BackupDir) { $cliArgs += @('--backup-dir', $BackupDir) }
if ($Yes) { $cliArgs += '--yes' }

& $node @cliArgs
exit $LASTEXITCODE
