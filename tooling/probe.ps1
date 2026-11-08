param(
  [string]$Out = ''
)
$ErrorActionPreference = 'Continue'
$rows = @()
function Add-Row($id, $cmd, $ok, $detail) {
  $script:rows += [pscustomobject]@{ id=$id; ok=$ok; detail=$detail }
}
$git = $env:RDS_GIT
if (-not $git) { $c = Get-Command git -ErrorAction SilentlyContinue; if ($c) { $git = $c.Source } }
if (-not $git) { $localCfg = Join-Path $PSScriptRoot 'toolchain.local.json'; if (Test-Path -LiteralPath $localCfg) { $git = (Get-Content -Raw -Encoding UTF8 -LiteralPath $localCfg | ConvertFrom-Json).git } }
$git = if ($git) { $git } else { '' }
if ($git -and (Test-Path -LiteralPath $git)) {
  $v = & $git --version 2>&1
  Add-Row 'git' $git $true ($v -join ' ')
} else { Add-Row 'git' 'git' $false 'not found in PATH' }
foreach ($c in @('node','npm')) {
  $p = Get-Command $c -ErrorAction SilentlyContinue
  if ($p) { Add-Row $c $p.Source $true (& $c --version 2>&1) } else { Add-Row $c '' $false 'not found' }
}
foreach ($c in @('java','javac','adb','tshark','frida','dotnet')) {
  $p = Get-Command $c -ErrorAction SilentlyContinue
  if ($p) { Add-Row $c $p.Source $true 'found' } else { Add-Row $c '' $false 'not found' }
}
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
if ($Out) { $rows | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $Out; "written: $Out" }
exit 0

