# MARS MCP disable script (Phase 2 / G1).
# Removes DSH MCP registry entries whose name starts with "mars-", after backing up registry.json.
# Dry-run by default; pass -Yes to write. Does not touch mars DB or source files.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Registry = (Join-Path $env:USERPROFILE '.dsh\skill-mcp-manager\registry.json'),
  [string]$BackupDir = 'D:\M1\mars\var\mcp',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Registry)) { Write-Error "registry not found: $Registry"; exit 2 }

$raw = Get-Content -LiteralPath $Registry -Raw -Encoding UTF8
$doc = $raw | ConvertFrom-Json
if (-not ($doc.PSObject.Properties.Name -contains 'entries')) { Write-Error 'registry has no entries array'; exit 2 }

$all = @($doc.entries)
$keep = @($all | Where-Object { -not ([string]$_.name).StartsWith('mars-') })
$removed = $all.Count - $keep.Count
Write-Output ("registry entries: {0}; mars entries: {1}; will remove: {2}" -f $all.Count, ($all.Count - $keep.Count), $removed)
if ($removed -eq 0) { Write-Output 'no mars-* entries; nothing to do'; exit 0 }

if (-not $Yes) {
  Write-Output 'WHATIF: no write. Re-run with -Yes (registry.json is backed up first).'
  Write-Output ('backup target: {0}\registry-backup-{1}.json' -f $BackupDir, (Get-Date -Format 'yyyyMMdd-HHmmss'))
  exit 0
}

if (-not $PSCmdlet.ShouldProcess($Registry, "remove $removed mars-* entries")) {
  Write-Output 'ABORTED (ShouldProcess returned false); registry unchanged.'
  exit 0
}

if (-not (Test-Path -LiteralPath $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupDir ("registry-backup-$stamp.json")
Copy-Item -LiteralPath $Registry -Destination $backup -Force
Write-Output "backup written: $backup"

$doc.entries = $keep
$json = $doc | ConvertTo-Json -Depth 12
Set-Content -LiteralPath $Registry -Value $json -Encoding UTF8
Write-Output "removed $removed mars-* entries from $Registry"
Write-Output 'NOTE: a running DSH session must reload/restart before the tool catalog refreshes.'
exit 0
