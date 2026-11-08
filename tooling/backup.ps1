param(
  [string]$Root = '',
  [string]$OutDir = '',
  [string]$Tag = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..')).Path } }
if (-not (Test-Path -LiteralPath $Root)) { throw "root not found: $Root" }
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $Root) ((Split-Path -Leaf $Root) + '-backups') }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$ver = ''
$vf = Join-Path $Root 'VERSION'
if (Test-Path -LiteralPath $vf) { $ver = (Get-Content -Raw -LiteralPath $vf).Trim() }
$name = if ($Tag) { "rds-$stamp-$Tag.zip" } elseif ($ver) { "rds-$stamp-v$ver.zip" } else { "rds-$stamp.zip" }
$zip = Join-Path $OutDir $name
Compress-Archive -Path (Join-Path $Root '*') -DestinationPath $zip -CompressionLevel Optimal -Force
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash
$shaFile = "$zip.sha256"
"$hash  $name" | Set-Content -Encoding ASCII -LiteralPath $shaFile
[pscustomobject]@{ zip=$zip; sha256=$hash; bytes=(Get-Item -LiteralPath $zip).Length } | ConvertTo-Json | Write-Output

