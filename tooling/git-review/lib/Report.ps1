# Report.ps1 - 报告对象、JSON Schema 校验与 Markdown 生成（PowerShell 5.1）
Set-StrictMode -Version 2.0

function Read-RdsJsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not [System.IO.File]::Exists($Path)) { return $null }
    $raw = [System.IO.File]::ReadAllText($Path)
    return ($raw | ConvertFrom-Json)
}

function Write-RdsJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Object
    )
    $json = (ConvertTo-Json -InputObject $Object -Depth 12).Replace("`r`n", "`n")
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + "`n", $utf8)
}

function Get-RdsPropertyValue {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function Get-RdsSchemaErrors {
    param(
        $Value,
        $Schema,
        [string]$Path
    )
    $errors = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Schema) { return , $errors.ToArray() }

    $constValue = Get-RdsPropertyValue -Object $Schema -Name 'const'
    if ($null -ne $constValue) {
        if ([string]$Value -ne [string]$constValue) {
            $errors.Add(($Path + ': const 期望 ' + [string]$constValue))
        }
    }
    $enumValues = Get-RdsPropertyValue -Object $Schema -Name 'enum'
    if ($null -ne $enumValues) {
        $matched = $false
        foreach ($e in @($enumValues)) { if ([string]$Value -eq [string]$e) { $matched = $true; break } }
        if (-not $matched) { $errors.Add($Path + ': 值不在枚举内') }
    }

    $type = [string](Get-RdsPropertyValue -Object $Schema -Name 'type')
    switch ($type) {
        'object' {
            if (-not ($Value -is [pscustomobject])) {
                $errors.Add($Path + ': 期望 object')
                break
            }
            $required = Get-RdsPropertyValue -Object $Schema -Name 'required'
            foreach ($name in @($required)) {
                if ($null -eq $name) { continue }
                if ($null -eq $Value.PSObject.Properties[[string]$name]) {
                    $errors.Add($Path + ': 缺少必填字段 ' + [string]$name)
                }
            }
            $props = Get-RdsPropertyValue -Object $Schema -Name 'properties'
            $additional = Get-RdsPropertyValue -Object $Schema -Name 'additionalProperties'
            foreach ($p in $Value.PSObject.Properties) {
                $sub = $null
                if ($null -ne $props) { $sub = Get-RdsPropertyValue -Object $props -Name $p.Name }
                if ($null -eq $sub) {
                    if ($additional -eq $false) { $errors.Add($Path + ': 不允许字段 ' + $p.Name) }
                    continue
                }
                $childErrors = Get-RdsSchemaErrors -Value $p.Value -Schema $sub -Path ($Path + '.' + $p.Name)
                foreach ($ce in $childErrors) { $errors.Add($ce) }
            }
            break
        }
        'array' {
            if (-not ($Value -is [System.Array])) {
                $errors.Add($Path + ': 期望 array')
                break
            }
            $items = Get-RdsPropertyValue -Object $Schema -Name 'items'
            if ($null -ne $items) {
                for ($i = 0; $i -lt $Value.Count; $i++) {
                    $childErrors = Get-RdsSchemaErrors -Value $Value[$i] -Schema $items -Path ($Path + '[' + $i + ']')
                    foreach ($ce in $childErrors) { $errors.Add($ce) }
                }
            }
            break
        }
        'string' {
            if (-not ($Value -is [string])) {
                $errors.Add($Path + ': 期望 string')
                break
            }
            $minLength = Get-RdsPropertyValue -Object $Schema -Name 'minLength'
            if ($null -ne $minLength -and $Value.Length -lt [int]$minLength) {
                $errors.Add($Path + ': 长度小于 minLength')
            }
            $pattern = Get-RdsPropertyValue -Object $Schema -Name 'pattern'
            if ($null -ne $pattern -and -not [regex]::IsMatch($Value, [string]$pattern)) {
                $errors.Add($Path + ': 不匹配 pattern')
            }
            break
        }
        'integer' {
            if (-not ($Value -is [int]) -and -not ($Value -is [long])) {
                $errors.Add($Path + ': 期望 integer')
                break
            }
            $minimum = Get-RdsPropertyValue -Object $Schema -Name 'minimum'
            if ($null -ne $minimum -and [double]$Value -lt [double]$minimum) {
                $errors.Add($Path + ': 小于 minimum')
            }
            break
        }
        'boolean' {
            if (-not ($Value -is [bool])) { $errors.Add($Path + ': 期望 boolean') }
            break
        }
        default { break }
    }
    return , $errors.ToArray()
}

function Get-RdsVerdict {
    param([object[]]$Findings)
    $failIds = @('SCOPE-OUTSIDE', 'DELETE-UNAUTHORIZED', 'SECRET-TOKEN-GITHUB', 'SECRET-TOKEN-OPENAI',
        'SECRET-AWS-AKID', 'SECRET-PRIVATE-KEY', 'SECRET-PASSWORD-ASSIGN', 'SECRET-APIKEY-ASSIGN',
        'INDEX-CHANGED', 'HEAD-CHANGED', 'STAGED-CHANGED', 'AUTH-MISSING', 'AUTH-INVALID', 'SCHEMA-INVALID')
    $fail = $false
    $blocked = $false
    $partial = $false
    foreach ($f in $Findings) {
        if ($null -eq $f) { continue }
        $ruleId = [string]$f.ruleId
        $category = [string]$f.category
        if ($failIds -contains $ruleId) { $fail = $true; continue }
        if ($ruleId -like 'DENY-*') { $fail = $true; continue }
        if ($category -eq 'secret') { $fail = $true; continue }
        if ($ruleId -eq 'BINARY-LARGE' -or $ruleId -eq 'UNREADABLE') { $blocked = $true; continue }
        if ($ruleId -eq 'ENCODING-FORMAT') { $partial = $true; continue }
        if ([string]$f.severity -eq 'blocker') { $blocked = $true }
    }
    if ($fail) { return 'FAIL' }
    if ($blocked) { return 'BLOCKED' }
    if ($partial) { return 'PARTIAL' }
    return 'PASS'
}

function New-RdsCheckResult {
    param([string]$Id, [string]$Name, [string]$Status, [string]$Command = '', [int]$ExitCode = 0, [string]$Note = '')
    return [pscustomobject]@{
        id       = $Id
        name     = $Name
        status   = $Status
        command  = $Command
        exitCode = $ExitCode
        note     = $Note
    }
}

function New-RdsReportMarkdown {
    param([Parameter(Mandatory = $true)]$Report, [string]$DiffPath = '')
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('# RDS Git 审查报告（G1 / L0）')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('| 项目 | 值 |')
    [void]$sb.AppendLine('| --- | --- |')
    [void]$sb.AppendLine('| reviewId | ' + $Report.reviewId + ' |')
    [void]$sb.AppendLine('| taskId | ' + $Report.taskId + ' |')
    [void]$sb.AppendLine('| 时间 | ' + $Report.timestamp + ' |')
    [void]$sb.AppendLine('| 仓库 | ' + $Report.repository.root + ' |')
    [void]$sb.AppendLine('| 分支 | ' + $Report.branch + ' |')
    [void]$sb.AppendLine('| HEAD | ' + $Report.head + ' |')
    [void]$sb.AppendLine('| 授权等级 | ' + $Report.authorizationLevel + ' |')
    [void]$sb.AppendLine('| 结论 | **' + $Report.verdict + '** |')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## 检查表')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('| 检查 | 状态 | 说明 |')
    [void]$sb.AppendLine('| --- | --- | --- |')
    foreach ($c in $Report.checks) {
        [void]$sb.AppendLine('| ' + $c.id + ' ' + $c.name + ' | ' + $c.status + ' | ' + $c.note + ' |')
    }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## 发现')
    [void]$sb.AppendLine('')
    if ($Report.findings.Count -eq 0) {
        [void]$sb.AppendLine('无。')
    }
    else {
        [void]$sb.AppendLine('| ID | 规则 | 严重度 | 目录 | 文件 | 行 | 说明 |')
        [void]$sb.AppendLine('| --- | --- | --- | --- | --- | --- | --- |')
        foreach ($f in $Report.findings) {
            [void]$sb.AppendLine('| ' + $f.id + ' | ' + $f.ruleId + ' | ' + $f.severity + ' | ' + $f.category + ' | ' + $f.file + ' | ' + $f.line + ' | ' + $f.reason + ' |')
        }
    }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## 基线对比')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('| 项 | 审查前 | 审查后 |')
    [void]$sb.AppendLine('| --- | --- | --- |')
    [void]$sb.AppendLine('| HEAD | ' + $Report.repository.headBefore + ' | ' + $Report.repository.headAfter + ' |')
    [void]$sb.AppendLine('| index 摘要 | ' + $Report.indexBefore.indexDigest + ' | ' + $Report.indexAfter.indexDigest + ' |')
    [void]$sb.AppendLine('| staged diff 摘要 | ' + $Report.indexBefore.diffCachedDigest + ' | ' + $Report.indexAfter.diffCachedDigest + ' |')
    [void]$sb.AppendLine('| 暂存条目 | ' + $Report.indexBefore.stagedCount + ' | ' + $Report.indexAfter.stagedCount + ' |')
    [void]$sb.AppendLine('| 工作区摘要 | ' + $Report.worktreeBefore.worktreeDigest + ' | ' + $Report.worktreeAfter.worktreeDigest + ' |')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## 证据')
    [void]$sb.AppendLine('')
    foreach ($e in $Report.evidence) {
        [void]$sb.AppendLine('- ' + $e.id + ': ' + $e.path + ' (sha256 ' + $e.sha256 + ')')
    }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## 限制与声明')
    [void]$sb.AppendLine('')
    foreach ($l in $Report.limitations) { [void]$sb.AppendLine('- ' + $l) }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('结论不得提升：PARTIAL/BLOCKED/FAIL 不得由审查工具自动改写为 PASS。')
    return $sb.ToString()
}
