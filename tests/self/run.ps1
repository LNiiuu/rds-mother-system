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
# 历史记录目录：这些是已提交的验收/审查证据，必然提到当初的项目名。
# 改写它们等于篡改证据，因此单独计数、不参与门禁。
$historyPrefixes = @('mars/docs/','docs/checks/','docs/history/','docs/analysis/','docs/runs/','docs/acceptance/')
$all = Get-ChildItem -Recurse -File -LiteralPath $Root | Where-Object { $_.Extension -in @('.md','.yaml','.yml','.json','.ps1','') -and $_.FullName -notlike '*\tests\self\*' }
$hits = @()
$historyHits = @()
foreach ($f in $all) {
  $t = Get-Content -Raw -Encoding UTF8 -LiteralPath $f.FullName -ErrorAction SilentlyContinue
  if (-not $t) { continue }
  $rel = ($f.FullName.Substring($Root.TrimEnd('\','/').Length).TrimStart('\','/')) -replace '\\','/'
  $isHistory = $false
  foreach ($p in $historyPrefixes) { if ($rel.StartsWith($p)) { $isHistory = $true; break } }
  foreach ($w in $forbidden) {
    if ($t -match [regex]::Escape($w)) {
      if ($isHistory) { $historyHits += "$rel : $w" } else { $hits += "$($f.FullName):$w" }
    }
  }
}
Check 'no project-specific strings in active assets' ($hits.Count -eq 0) ($hits -join '; ')
if ($historyHits.Count -gt 0) {
  Write-Output ("[WARN] 历史记录含项目名 " + $historyHits.Count + " 处（M5 文档清理范围，不计入门禁）：" + (($historyHits | Select-Object -First 3) -join '; '))
}

$py = Join-Path $Root 'core/templates/project.yaml'
if (Test-Path -LiteralPath $py) {
  $t = Get-Content -Raw -Encoding UTF8 -LiteralPath $py
  Check 'project.yaml has stack' ($t -match 'stack:')
  Check 'project.yaml has schema' ($t -match 'schema: rds/project/v1')
}

# G1 Git 审查（WF5）实现检查
$g1Required = @(
  'core/policies/git-review.md',
  'core/workflows/wf5-git-review.md',
  'core/templates/git-authorization.json',
  'core/templates/git-review-report.md',
  'core/templates/git-review-report.schema.json',
  'tooling/git-review/README.md',
  'tooling/git-review/review.ps1',
  'tooling/git-review/lib/Git.ps1',
  'tooling/git-review/lib/Scope.ps1',
  'tooling/git-review/lib/Diff.ps1',
  'tooling/git-review/lib/Secret.ps1',
  'tooling/git-review/lib/Report.ps1',
  'tooling/git-review/rules/secret-rules.json',
  'tooling/git-review/rules/path-deny.json',
  'tooling/git-review/rules/allowlist.json',
  'tests/git-review/run.ps1',
  'tests/git-review/fixtures/README.md',
  'tests/git-review/fixtures/expected.json',
  'docs/checks/git-review/README.md'
)
foreach ($f in $g1Required) { Check "git-review file: $f" (Test-Path -LiteralPath (Join-Path $Root $f)) }

$expectedJson = Join-Path $Root 'tests/git-review/fixtures/expected.json'
if (Test-Path -LiteralPath $expectedJson) {
  try {
    $exp = Get-Content -Raw -Encoding UTF8 -LiteralPath $expectedJson | ConvertFrom-Json
    Check 'git-review fixtures F1-F6' (@($exp.fixtures).Count -eq 6) ('count=' + @($exp.fixtures).Count)
    $ids = (@($exp.fixtures | ForEach-Object { $_.id }) -join ',')
    Check 'git-review expected ids' ($ids -eq 'F1,F2,F3,F4,F5,F6') $ids
  }
  catch { Check 'git-review expected.json' $false $_.Exception.Message }
}

$schemaFile = Join-Path $Root 'core/templates/git-review-report.schema.json'
if (Test-Path -LiteralPath $schemaFile) {
  try {
    $sc = Get-Content -Raw -Encoding UTF8 -LiteralPath $schemaFile | ConvertFrom-Json
    Check 'git-review schema required fields' (@($sc.required).Count -ge 15) ('count=' + @($sc.required).Count)
  }
  catch { Check 'git-review schema json' $false $_.Exception.Message }
}

"----"
if ($fail -gt 0) { "RESULT: FAIL ($fail)"; exit 1 } else { "RESULT: PASS"; exit 0 }
