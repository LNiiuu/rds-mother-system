param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$Target
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Zip)) { throw "zip not found: $Zip" }
$shaFile = "$Zip.sha256"
if (Test-Path -LiteralPath $shaFile) {
  $expected = (Get-Content -Raw -LiteralPath $shaFile).Split(' ')[0].Trim()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Zip).Hash
  if ($expected -ne $actual) { throw "sha256 mismatch: expected $expected actual $actual" }
  "sha256 ok: $actual"
} else { "warning: no .sha256 file; hash = $((Get-FileHash -Algorithm SHA256 -LiteralPath $Zip).Hash)" }
if (Test-Path -LiteralPath $Target) { throw "target exists: $Target" }
Expand-Archive -LiteralPath $Zip -DestinationPath $Target -Force
$files = Get-ChildItem -Recurse -File -LiteralPath $Target
[pscustomobject]@{ target=$Target; files=$files.Count; bytes=($files | Measure-Object -Sum Length).Sum } | ConvertTo-Json | Write-Output

