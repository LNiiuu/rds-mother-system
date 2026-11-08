param([string]$Root = '')
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
$fail = 0
function Check($name, $ok, $detail = '') {
  if ($ok) { "[PASS] $name $detail" } else { $script:fail++; "[FAIL] $name $detail" }
}
if (-not (Test-Path -LiteralPath $Root)) { "FAIL: root not found $Root"; exit 1 }

$required = @(
  'README.md','VERSION','CHANGELOG.md','.gitignore',
  'core/policies/permissions.md','core/policies/task-management.md','core/policies/acceptance.md',
  'core/policies/mcp-usage.md','core/policies/download.md','core/policies/git-remote.md',
  'core/policies/handoff.md','core/policies/conflicts.md',
  'core/protocols/task-card.md','core/protocols/evidence.md',
  'core/roles/roster.md','core/roles/role-card.template.md',
  'core/workflows/README.md','core/workflows/wf1-feature.md','core/workflows/wf2-research.md',
  'core/workflows/wf3-defect.md','core/workflows/wf4-review.md',
  'core/templates/project.yaml','core/templates/handoff.md','core/templates/acceptance.md',
  'core/bootstrap/bootstrap.md','core/scripts/new-project.ps1',
  'tooling/probe.ps1','tooling/backup.ps1','tooling/restore.ps1','tooling/sync.ps1',
  'tooling/mcp-lifecycle.md','stacks/weapp/stack.yaml','stacks/native-bin/stack.yaml',
  'rea/baseline/README.md','rea/evidence/README.md','rea/samples/index.md',
  'docs/checks/GITHUB.md','docs/checks/sync-log.md','docs/acceptance/README.md'
)
foreach ($f in $required) { Check "required: $f" (Test-Path -LiteralPath (Join-Path $Root $f)) }

$roles = @('r0-orchestrator','r1-architect','r2-implementer','r3-verifier','r4-reviewer','r5-researcher','r6-reverse','r7-release')
foreach ($r in $roles) {
  $p = Join-Path $Root "core/roles/$r.md"
  Check "role: $r" (Test-Path -LiteralPath $p)
  if (Test-Path -LiteralPath $p) {
    $t = Get-Content -Raw -Encoding UTF8 -LiteralPath $p
    Check "role has system prompt: $r" ($t -match '## 系统提示词')
    Check "role has permission section: $r" ($t -match '## 权限')
  }
}

$wf = @('w-01-code-understanding','w-02-native-static','w-03-apk-static','w-04-bug-callchain','w-05-pcap','w-06-frida')
foreach ($w in $wf) { Check "rea workflow: $w" (Test-Path -LiteralPath (Join-Path $Root "rea/workflows/$w.md")) }

$json = Get-ChildItem -Path (Join-Path $Root 'tooling/manifest') -Filter *.json -File
foreach ($j in $json) {
  try { Get-Content -Raw -Encoding UTF8 -LiteralPath $j.FullName | ConvertFrom-Json | Out-Null; Check "json: $($j.Name)" $true }
  catch { Check "json: $($j.Name)" $false $_.Exception.Message }
}
Check 'manifest count >= 8' ($json.Count -ge 8) "count=$($json.Count)"

$forbidden = @('rwgl','星日晓','miniprogram/pages','计划qpp')
$all = Get-ChildItem -Recurse -File -LiteralPath $Root | Where-Object { $_.Extension -in @('.md','.yaml','.yml','.json','.ps1','') -and $_.FullName -notlike '*\tests\self\*' }
$hits = @()
foreach ($f in $all) {
  $t = Get-Content -Raw -Encoding UTF8 -LiteralPath $f.FullName -ErrorAction SilentlyContinue
  if (-not $t) { continue }
  foreach ($w in $forbidden) { if ($t -match [regex]::Escape($w)) { $hits += "$($f.FullName):$w" } }
}
Check 'no project-specific strings' ($hits.Count -eq 0) ($hits -join '; ')

$py = Join-Path $Root 'core/templates/project.yaml'
if (Test-Path -LiteralPath $py) {
  $t = Get-Content -Raw -Encoding UTF8 -LiteralPath $py
  Check 'project.yaml has stack' ($t -match 'stack:')
  Check 'project.yaml has schema' ($t -match 'schema: rds/project/v1')
}

"----"
if ($fail -gt 0) { "RESULT: FAIL ($fail)"; exit 1 } else { "RESULT: PASS"; exit 0 }
