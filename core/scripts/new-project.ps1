param(
  [Parameter(Mandatory=$true)][string]$Target,
  [string]$Stack = 'weapp',
  [string]$RdsRoot = 'D:\M1'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $RdsRoot)) { throw "RDS root not found: $RdsRoot" }
if (Test-Path -LiteralPath $Target) { throw "Target already exists: $Target" }
New-Item -ItemType Directory -Path $Target | Out-Null
$dirs = @('src','tests','docs','evidence','dist')
foreach ($d in $dirs) { New-Item -ItemType Directory -Path (Join-Path $Target $d) | Out-Null }
$stackFile = Join-Path $RdsRoot "stacks\$Stack\stack.yaml"
if (-not (Test-Path -LiteralPath $stackFile)) { throw "Unknown stack: $Stack" }
$tpl = Join-Path $RdsRoot 'core\templates\project.yaml'
$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $tpl
$cfg = $cfg.Replace('D:\Projects\sample', $Target).Replace('name: sample-project', ('name: ' + (Split-Path -Leaf $Target))).Replace('stack: weapp', ('stack: ' + $Stack))
[IO.File]::WriteAllText((Join-Path $Target 'project.yaml'), $cfg, (New-Object Text.UTF8Encoding($false)))
"created: $Target (stack=$Stack)"
