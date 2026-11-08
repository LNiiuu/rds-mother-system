# review.ps1 - RDS Git 变更审查（G1 / L0，只读）
[CmdletBinding()]
param(
    [ValidateSet('status')][string]$Mode = 'status',
    [string]$Task = 'UNKNOWN',
    [string]$Auth = '',
    [string]$Repo = '',
    [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'lib\Git.ps1')
. (Join-Path $scriptDir 'lib\Scope.ps1')
. (Join-Path $scriptDir 'lib\Diff.ps1')
. (Join-Path $scriptDir 'lib\Secret.ps1')
. (Join-Path $scriptDir 'lib\Report.ps1')

$rulesRoot = Join-Path $scriptDir 'rules'
$schemaPath = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\core\templates\git-review-report.schema.json'))

function New-OutDirectory {
    param([string]$RepoRoot, [string]$OutValue)
    if ($OutValue.Length -gt 0) {
        if (-not [System.IO.Directory]::Exists($OutValue)) { [void][System.IO.Directory]::CreateDirectory($OutValue) }
        return $OutValue
    }
    $base = Join-Path $RepoRoot 'docs\checks\git-review'
    if (-not [System.IO.Directory]::Exists($base)) { [void][System.IO.Directory]::CreateDirectory($base) }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dir = Join-Path $base ('run-' + $stamp)
    [void][System.IO.Directory]::CreateDirectory($dir)
    return $dir
}

function Get-NextReviewId {
    param([string]$RepoRoot)
    $base = Join-Path $RepoRoot 'docs\checks\git-review'
    $count = 0
    if ([System.IO.Directory]::Exists($base)) {
        $count = @([System.IO.Directory]::GetDirectories($base, 'run-*')).Count
    }
    $seq = ($count + 1).ToString('000')
    return ('RV-' + (Get-Date -Format 'yyyyMMdd') + '-' + $seq)
}

function Add-Finding {
    param(
        [System.Collections.Generic.List[object]]$Findings,
        [string]$RuleId,
        [string]$Severity,
        [string]$Category,
        [string]$Reason,
        [string]$File = '',
        [int]$Line = 0,
        [string]$Masked = ''
    )
    $id = 'F-' + ($Findings.Count + 1).ToString('000')
    $Findings.Add([pscustomobject]@{
        id            = $id
        ruleId        = $RuleId
        severity      = $Severity
        category      = $Category
        reason        = $Reason
        file          = $File
        line          = $Line
        maskedSnippet = $Masked
    }) | Out-Null
}

function Get-CheckStatus {
    param([object[]]$Findings, [string[]]$RulePrefixes)
    foreach ($f in $Findings) {
        if ($null -eq $f) { continue }
        $ruleId = [string]$f.ruleId
        foreach ($p in $RulePrefixes) {
            if ($ruleId -like $p) { return 'failed' }
        }
    }
    return 'passed'
}

$repoRoot = Get-RdsRepoRoot -Repo $Repo
if ($null -eq $repoRoot) {
    Write-Output '{"verdict":"FAIL","error":"仓库根目录无法解析"}'
    exit 4
}
$headBefore = Get-RdsHead -Repo $Repo
$branch = Get-RdsBranch -Repo $Repo
$remoteUrl = Get-RdsRemoteUrl -Repo $Repo
$indexBefore = [pscustomobject]@{
    stagedCount      = [int](Get-RdsStagedCount -Repo $Repo)
    indexDigest      = [string](Get-RdsIndexDigest -Repo $Repo)
    diffCachedDigest = [string](Get-RdsStagedDigest -Repo $Repo)
}
$statusBefore = Get-RdsStatusEntries -Repo $Repo
$worktreeBefore = [pscustomobject]@{
    changedCount   = [int]$statusBefore.Count
    untrackedCount = [int]@($statusBefore | Where-Object { $_.Status -eq 'U' }).Count
    worktreeDigest = [string](Get-RdsWorktreeDigest -Repo $Repo)
}
if ($null -eq $headBefore) {
    Write-Output '{"verdict":"BLOCKED","error":"HEAD 不可解析（unborn），G1 不审查无提交仓库"}'
    exit 2
}

$outDir = New-OutDirectory -RepoRoot $repoRoot -OutValue $Out
$reviewId = Get-NextReviewId -RepoRoot $repoRoot

$findings = New-Object System.Collections.Generic.List[object]
$checks = New-Object System.Collections.Generic.List[object]
$limitations = New-Object System.Collections.Generic.List[string]
[void]$limitations.Add('G1 仅记录 HEAD、分支、暂存区摘要与工作区摘要；完整指纹绑定与独立复算属于 G2。')
[void]$limitations.Add('G1 不执行文档事实核对、历史完整性检查（amend/rebase/reset）与远端核验。')
[void]$limitations.Add('本审查不回显任何秘密原值，仅输出掩码。')

$authOk = $false
$authorization = $null
$authSha = ''
if ($Auth.Length -eq 0 -or -not [System.IO.File]::Exists($Auth)) {
    Add-Finding -Findings $findings -RuleId 'AUTH-MISSING' -Severity 'blocker' -Category 'other' -Reason '未提供机读授权文件'
}
else {
    try {
        $authorization = Read-RdsJsonFile -Path $Auth
        $authSha = Get-RdsSha256File -Path $Auth
        if ($null -eq $authorization -or [string]$authorization.level -ne 'L0') {
            Add-Finding -Findings $findings -RuleId 'AUTH-INVALID' -Severity 'blocker' -Category 'other' -Reason '授权文件无效或等级不是 L0'
        }
        else {
            $authOk = $true
        }
    }
    catch {
        Add-Finding -Findings $findings -RuleId 'AUTH-INVALID' -Severity 'blocker' -Category 'other' -Reason ('授权文件解析失败: ' + $_.Exception.Message)
    }
}

$allowedPaths = @()
if ($authOk) {
    if ($null -ne $authorization.taskId -and [string]$authorization.taskId -ne $Task) {
        Add-Finding -Findings $findings -RuleId 'AUTH-INVALID' -Severity 'blocker' -Category 'other' -Reason ('授权 taskId 与运行 taskId 不一致: ' + [string]$authorization.taskId)
    }
    $allowedPaths = @($authorization.allowedPaths | ForEach-Object { [string]$_ })
    if ($allowedPaths.Count -eq 0) {
        Add-Finding -Findings $findings -RuleId 'AUTH-INVALID' -Severity 'blocker' -Category 'other' -Reason '授权文件未声明 allowedPaths'
    }
}

$pathDenyRules = @()
$denyPath = Join-Path $rulesRoot 'path-deny.json'
if ([System.IO.File]::Exists($denyPath)) {
    $denyObj = Read-RdsJsonFile -Path $denyPath
    $pathDenyRules = @($denyObj.patterns)
}
$secretRules = Get-RdsSecretRules -RulesPath (Join-Path $rulesRoot 'secret-rules.json')
$allowlist = Get-RdsAllowlist -AllowlistPath (Join-Path $rulesRoot 'allowlist.json')

$records = Get-RdsChangeRecords -Repo $Repo
$records = @($records | Where-Object {
        $full = [System.IO.Path]::Combine($repoRoot, ($_.Path -replace '/', '\'))
        (-not $full.StartsWith($outDir, [System.StringComparison]::OrdinalIgnoreCase)) -and (-not ($_.Path -like "docs/checks/git-review/run-*"))
    })
$deleteAllowed = $false
if ($null -ne $authorization) { $deleteAllowed = [bool]$authorization.deleteAllowed }
$diffParts = New-Object System.Collections.Generic.List[string]
[void]$diffParts.Add('# RDS Git Review Diff (G1)')
[void]$diffParts.Add('')
[void]$diffParts.Add('## git diff (worktree + staged)')
[void]$diffParts.Add('')
$headDiff = Invoke-RdsGit -Repo $Repo -Arguments @('diff', 'HEAD', '--no-color')
[void]$diffParts.Add($headDiff.Text)

foreach ($rec in $records) {
    $path = [string]$rec.Path
    if (-not (Test-RdsPathInScope -Path $path -AllowedPaths $allowedPaths)) {
        Add-Finding -Findings $findings -RuleId 'SCOPE-OUTSIDE' -Severity 'blocker' -Category 'scope' -Reason '变更路径不在授权范围 allowedPaths 内' -File $path
    }
    if ($rec.Status -eq 'D' -and -not $deleteAllowed) {
        Add-Finding -Findings $findings -RuleId 'DELETE-UNAUTHORIZED' -Severity 'blocker' -Category 'scope' -Reason '存在删除操作，但授权未允许 deleteAllowed' -File $path
    }
    $denyMatches = Get-RdsPathDenyMatch -Path $path -Patterns $pathDenyRules
    foreach ($dm in $denyMatches) {
        Add-Finding -Findings $findings -RuleId ([string]$dm.id) -Severity 'blocker' -Category 'diff' -Reason ([string]$dm.reason) -File $path
    }

    if ($rec.Status -eq 'U') {
        [void]$diffParts.Add('')
        [void]$diffParts.Add('## untracked: ' + $path)
    }
    $bytes = Read-RdsChangeBytes -Repo $Repo -Path $path
    if ($null -eq $bytes) {
        Add-Finding -Findings $findings -RuleId 'UNREADABLE' -Severity 'blocker' -Category 'other' -Reason '文件不可读取，无法安全审查' -File $path
        continue
    }
    $binary = Test-RdsBinaryBytes -Bytes $bytes
    $tooLarge = ($bytes.Length -gt 2097152)
    if ($binary -or $tooLarge) {
        Add-Finding -Findings $findings -RuleId 'BINARY-LARGE' -Severity 'high' -Category 'binary' -Reason ('二进制或超过 2MB（size=' + $bytes.Length + '）') -File $path
        continue
    }
    $decoded = ConvertFrom-RdsUtf8Bytes -Bytes $bytes
    if (-not $decoded.Ok) {
        Add-Finding -Findings $findings -RuleId 'UNREADABLE' -Severity 'blocker' -Category 'other' -Reason '不是合法 UTF-8 文本，无法安全扫描' -File $path
        continue
    }
    $text = $decoded.Text
    if ($path -like 'docs/checks/git-review/rollback/*') {
        Get-RdsSecretFindings -Findings $findings -Path $path -Text $text -Rules $secretRules -Allowlist $allowlist
        if ($rec.Status -eq 'U') { [void]$diffParts.Add('## untracked: ' + $path); [void]$diffParts.Add($text) }
        continue
    }
    $encoding = Get-RdsEncodingInfo -Bytes $bytes -Text $text
    $ps1BomOnly = ($encoding.Bom -and -not $encoding.Crlf -and -not $encoding.EofBlank -and $path.ToLowerInvariant().EndsWith('.ps1'))
    if ($ps1BomOnly) {
        Add-Finding -Findings $findings -RuleId 'ENCODING-BOM-REQUIRED' -Severity 'info' -Category 'encoding' -Reason 'PowerShell 5.1 脚本按约定使用 UTF-8 BOM（非格式缺陷）' -File $path
    }
    elseif ($encoding.Bom -or $encoding.Crlf -or $encoding.EofBlank) {
        $bits = New-Object System.Collections.Generic.List[string]
        if ($encoding.Bom) { [void]$bits.Add('BOM') }
        if ($encoding.Crlf) { [void]$bits.Add('CRLF') }
        if ($encoding.EofBlank) { [void]$bits.Add('EOF 空行') }
        Add-Finding -Findings $findings -RuleId 'ENCODING-FORMAT' -Severity 'low' -Category 'encoding' -Reason ('编码/换行格式差异: ' + ($bits -join ', ')) -File $path
    }
    Get-RdsSecretFindings -Findings $findings -Path $path -Text $text -Rules $secretRules -Allowlist $allowlist
    $addText = $false
    if ($rec.Status -eq 'U') { $addText = $true }
    if ($addText) { [void]$diffParts.Add($text) }
}

$headAfter = Get-RdsHead -Repo $Repo
$indexAfter = [pscustomobject]@{
    stagedCount      = [int](Get-RdsStagedCount -Repo $Repo)
    indexDigest      = [string](Get-RdsIndexDigest -Repo $Repo)
    diffCachedDigest = [string](Get-RdsStagedDigest -Repo $Repo)
}
$statusAfter = Get-RdsStatusEntries -Repo $Repo
$worktreeAfter = [pscustomobject]@{
    changedCount   = [int]$statusAfter.Count
    untrackedCount = [int]@($statusAfter | Where-Object { $_.Status -eq 'U' }).Count
    worktreeDigest = [string](Get-RdsWorktreeDigest -Repo $Repo)
}

if ($headBefore -ne $headAfter) {
    Add-Finding -Findings $findings -RuleId 'HEAD-CHANGED' -Severity 'blocker' -Category 'other' -Reason '审查期间 HEAD 发生变化（只读被破坏）'
}
if ($indexBefore.indexDigest -ne $indexAfter.indexDigest) {
    Add-Finding -Findings $findings -RuleId 'INDEX-CHANGED' -Severity 'blocker' -Category 'other' -Reason '审查期间 index 逻辑摘要发生变化（只读被破坏）'
}
if ($indexBefore.diffCachedDigest -ne $indexAfter.diffCachedDigest) {
    Add-Finding -Findings $findings -RuleId 'STAGED-CHANGED' -Severity 'blocker' -Category 'other' -Reason '审查期间暂存区内容发生变化（只读被破坏）'
}

$verdict = Get-RdsVerdict -Findings $findings.ToArray()

$diffPath = Join-Path $outDir 'diff.patch'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($diffPath, ($diffParts -join "`n") + "`n", $utf8)

$commands = @(
    ('git -C ' + $Repo + ' rev-parse --show-toplevel'),
    ('git -C ' + $Repo + ' rev-parse HEAD'),
    ('git -C ' + $Repo + ' symbolic-ref --short HEAD'),
    ('git -C ' + $Repo + ' status --porcelain=v1 -uall'),
    ('git -C ' + $Repo + ' ls-files -s'),
    ('git -C ' + $Repo + ' diff --cached --no-color'),
    ('git -C ' + $Repo + ' diff HEAD --no-color'),
    ('schema: ' + $schemaPath),
    ('out: ' + $outDir)
)
$commandsPath = Join-Path $outDir 'commands.log'
[System.IO.File]::WriteAllText($commandsPath, ($commands -join "`n") + "`n", $utf8)

$checkAuthStatus = 'failed'
if ($authOk) { $checkAuthStatus = 'passed' }
$checkScopeStatus = Get-CheckStatus -Findings $findings.ToArray() -RulePrefixes @('SCOPE-OUTSIDE', 'DELETE-*', 'DENY-*')
$checkContentStatus = Get-CheckStatus -Findings $findings.ToArray() -RulePrefixes @('BINARY-*', 'UNREADABLE')
$checkSecretStatus = Get-CheckStatus -Findings $findings.ToArray() -RulePrefixes @('SECRET-*', 'PERSONAL-*')
$checkEncodingStatus = Get-CheckStatus -Findings $findings.ToArray() -RulePrefixes @('ENCODING-FORMAT')
$checkIndexStatus = 'failed'
if ($indexBefore.indexDigest -eq $indexAfter.indexDigest -and $indexBefore.diffCachedDigest -eq $indexAfter.diffCachedDigest) { $checkIndexStatus = 'passed' }
$checkWorktreeStatus = 'failed'
if ($headBefore -eq $headAfter) { $checkWorktreeStatus = 'passed' }

$checkAuth = New-RdsCheckResult -Id 'C-AUTH' -Name '授权文件' -Status $checkAuthStatus -Note 'L0 / allowedPaths 校验'
$checkScope = New-RdsCheckResult -Id 'C-SCOPE' -Name '路径范围' -Status $checkScopeStatus -Note ('检查 ' + $records.Count + ' 个变更路径')
$checkContent = New-RdsCheckResult -Id 'C-CONTENT' -Name '完整内容' -Status $checkContentStatus -Note '含已暂存/未暂存/未跟踪，未跟踪单独读取全文'
$checkSecret = New-RdsCheckResult -Id 'C-SECRET' -Name '秘密扫描' -Status $checkSecretStatus -Note '路径豁免 + 正则 + 熵，命中只输出掩码'
$checkEncoding = New-RdsCheckResult -Id 'C-ENCODING' -Name '编码/换行' -Status $checkEncodingStatus -Note 'F6 格式差异默认 PARTIAL'
$checkIndex = New-RdsCheckResult -Id 'C-INDEX' -Name 'index 不变' -Status $checkIndexStatus -Note '逻辑 index 与 staged diff 摘要'
$checkWorktree = New-RdsCheckResult -Id 'C-WORKTREE' -Name '工作区状态' -Status $checkWorktreeStatus -Note ('变更 ' + $worktreeBefore.changedCount + ' -> ' + $worktreeAfter.changedCount)

[void]$checks.Add($checkAuth)
[void]$checks.Add($checkScope)
[void]$checks.Add($checkContent)
[void]$checks.Add($checkSecret)
[void]$checks.Add($checkEncoding)
[void]$checks.Add($checkIndex)
[void]$checks.Add($checkWorktree)

$evidence = @(
    [pscustomobject]@{ id = 'EV-G1-AUTH'; path = $Auth; sha256 = $authSha },
    [pscustomobject]@{ id = 'EV-G1-DIFF'; path = $diffPath; sha256 = (Get-RdsSha256File -Path $diffPath) },
    [pscustomobject]@{ id = 'EV-G1-COMMANDS'; path = $commandsPath; sha256 = (Get-RdsSha256File -Path $commandsPath) }
)

$report = [pscustomobject]@{
    schemaVersion      = '1.0.0'
    taskId             = $Task
    reviewId           = $reviewId
    timestamp          = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    repository         = [pscustomobject]@{
        root       = $repoRoot
        remoteUrl  = $remoteUrl
        headBefore = $headBefore
        headAfter  = $headAfter
    }
    branch             = $branch
    head               = $headAfter
    authorizationLevel = 'L0'
    verdict            = $verdict
    findings           = $findings.ToArray()
    checks             = $checks.ToArray()
    indexBefore        = $indexBefore
    indexAfter         = $indexAfter
    worktreeBefore     = $worktreeBefore
    worktreeAfter      = $worktreeAfter
    evidence           = $evidence
    limitations        = $limitations.ToArray()
}

$schema = Read-RdsJsonFile -Path $schemaPath
if ($null -ne $schema) {
    $schemaErrors = Get-RdsSchemaErrors -Value $report -Schema $schema -Path '$'
    if ($schemaErrors.Count -gt 0) {
        Add-Finding -Findings $findings -RuleId 'SCHEMA-INVALID' -Severity 'blocker' -Category 'other' -Reason ('报告 Schema 校验失败: ' + ($schemaErrors -join '; '))
        $report.findings = $findings.ToArray()
        $report.verdict = 'FAIL'
        [void]$limitations.Add('Schema 校验失败：' + ($schemaErrors -join '; '))
        $report.limitations = $limitations.ToArray()
    }
}
else {
    Add-Finding -Findings $findings -RuleId 'SCHEMA-INVALID' -Severity 'blocker' -Category 'other' -Reason '报告 Schema 文件缺失'
    $report.findings = $findings.ToArray()
    $report.verdict = 'FAIL'
}

$reportJsonPath = Join-Path $outDir 'review-report.json'
Write-RdsJsonFile -Path $reportJsonPath -Object $report
$reportMdPath = Join-Path $outDir 'review-report.md'
[System.IO.File]::WriteAllText($reportMdPath, ((New-RdsReportMarkdown -Report $report -DiffPath $diffPath).Replace("`r`n", "`n")), $utf8)

$summary = [pscustomobject]@{
    verdict   = $report.verdict
    reviewId  = $report.reviewId
    findings  = @($report.findings).Count
    report    = $reportJsonPath
    markdown  = $reportMdPath
    indexSame = ($indexBefore.indexDigest -eq $indexAfter.indexDigest)
}
Write-Output (ConvertTo-Json -InputObject $summary -Depth 6)
switch ($report.verdict) {
    'PASS' { exit 0 }
    'PARTIAL' { exit 1 }
    'BLOCKED' { exit 2 }
    'FAIL' { exit 3 }
    default { exit 4 }
}
