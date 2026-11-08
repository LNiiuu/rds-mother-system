param(
  [Parameter(Mandatory=$true)][string]$Target,
  [string]$Stack = 'weapp',
  [string]$RdsRoot = ''
)
$ErrorActionPreference = 'Stop'
if (-not $RdsRoot) { $RdsRoot = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
if (-not (Test-Path -LiteralPath $RdsRoot)) { throw "RDS root not found: $RdsRoot" }
if (Test-Path -LiteralPath $Target) { throw "Target already exists: $Target" }
New-Item -ItemType Directory -Path $Target | Out-Null
$dirs = @('src','tests','docs','evidence','dist')
foreach ($d in $dirs) { New-Item -ItemType Directory -Path (Join-Path $Target $d) | Out-Null }
$stackFile = Join-Path $RdsRoot "stacks\$Stack\stack.yaml"
if (-not (Test-Path -LiteralPath $stackFile)) { throw "Unknown stack: $Stack" }
$tpl = Join-Path $RdsRoot 'core\templates\project.yaml'
$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath $tpl
$cfg = $cfg.Replace('<PROJECT_NAME>', (Split-Path -Leaf $Target)).Replace('<PROJECT_ROOT>', $Target).Replace('<STACK>', $Stack)
[IO.File]::WriteAllText((Join-Path $Target 'project.yaml'), $cfg, (New-Object Text.UTF8Encoding($false)))

# 生成后立即校验：占位符未替换、stack 不存在、root 为空都在这里拦下
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  & $nodeCmd.Source (Join-Path $RdsRoot 'bin\validate.mjs') --file (Join-Path $Target 'project.yaml')
  if ($LASTEXITCODE -ne 0) { throw "project.yaml 校验未通过: $Target" }
} else {
  Write-Warning '未找到 node，已跳过 project.yaml 校验'
}
"created: $Target (stack=$Stack)"
