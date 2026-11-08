param(
  [string]$Repo = '',
  [string]$Git  = '',
  [int]$ExpectUntracked = 70,
  [int]$ExpectModified = 1,
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
if (-not $Git) { $Git = $env:RDS_GIT }
if (-not $Git) { $c = Get-Command git -ErrorAction SilentlyContinue; if ($c) { $Git = $c.Source } }
if (-not $Git) { $localCfg = Join-Path $Repo 'tooling\toolchain.local.json'; if (Test-Path -LiteralPath $localCfg) { $Git = (Get-Content -Raw -Encoding UTF8 -LiteralPath $localCfg | ConvertFrom-Json).git } }
if (-not $Git -or -not (Test-Path $Git)) { throw "git 未找到：设置 RDS_GIT 环境变量，或在 tooling\toolchain.local.json 中配置 { `"git`": `"<git 路径>`" }" }
$statusLines = & $Git -C $Repo status --porcelain -uall
$text = ($statusLines | ForEach-Object { $_ }) -join "`n"
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join ''
$head = (& $Git -C $Repo rev-parse HEAD).Trim()
$branch = (& $Git -C $Repo rev-parse --abbrev-ref HEAD).Trim()

# 只统计「非 MARS」路径，用于核对 Phase 0 基线（MARS 新增文件不计入）
$pre = $statusLines | Where-Object { $_ -notmatch '^..\s"?mars/' }
$preUntracked = ($pre | Where-Object { $_ -match '^\?\?' }).Count
$preModified = ($pre | Where-Object { $_ -match '^ M|^M ' }).Count
$preStaged = ($pre | Where-Object { $_ -match '^[AMD]' }).Count
$preText = ($pre | ForEach-Object { $_ }) -join "`n"
$preHash = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($preText)) | ForEach-Object { $_.ToString('x2') }) -join ''

$result = [ordered]@{
  capturedAt       = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  repo             = $Repo
  branch           = $branch
  head             = $head
  statusLines      = @($statusLines).Count
  untrackedCount   = @($statusLines | Where-Object { $_ -match '^\?\?' }).Count
  modifiedCount    = @($statusLines | Where-Object { $_ -match '^ M|^M ' }).Count
  stagedCount      = @($statusLines | Where-Object { $_ -match '^[AMD]' }).Count
  statusSha256     = $hash
  marsPaths        = @($statusLines | Where-Object { $_ -match '^..\s"?mars/' }).Count
  preMarsUntracked = $preUntracked
  preMarsModified  = $preModified
  preMarsStaged    = $preStaged
  preMarsSha256    = $preHash
  expectedUntracked = $ExpectUntracked
  expectedModified  = $ExpectModified
  matchesPhase0    = ($preUntracked -eq $ExpectUntracked -and $preModified -eq $ExpectModified -and $preStaged -eq 0)
}
$json = $result | ConvertTo-Json -Depth 4
if ($Out) {
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($Out, $json + "`n", (New-Object Text.UTF8Encoding($false)))
}
$json
if (-not $result.matchesPhase0) { exit 1 }
