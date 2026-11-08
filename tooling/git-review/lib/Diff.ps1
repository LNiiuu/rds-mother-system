# Diff.ps1 - 变更内容读取、二进制/大文件/编码检测（PowerShell 5.1）
Set-StrictMode -Version 2.0

function Get-RdsChangeRecords {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $entries = Get-RdsStatusEntries -Repo $Repo
    $records = New-Object System.Collections.Generic.List[object]
    foreach ($e in $entries) {
        $records.Add([pscustomobject]@{
            Path           = $e.Path
            Status         = $e.Status
            IndexStatus    = $e.IndexStatus
            WorktreeStatus = $e.WorktreeStatus
        })
    }
    return , $records.ToArray()
}

function Read-RdsChangeBytes {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $full = [System.IO.Path]::Combine($Repo, ($Path -replace '/', '\'))
    if ([System.IO.File]::Exists($full)) {
        try { return , [System.IO.File]::ReadAllBytes($full) } catch { return $null }
    }
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('show', (':' + $Path))
    if ($r.ExitCode -eq 0) {
        return , [System.Text.Encoding]::UTF8.GetBytes($r.Text)
    }
    return $null
}

function Test-RdsBinaryBytes {
    param([byte[]]$Bytes)
    if ($null -eq $Bytes -or $Bytes.Length -eq 0) { return $false }
    $limit = [Math]::Min($Bytes.Length, 8192)
    for ($i = 0; $i -lt $limit; $i++) {
        if ($Bytes[$i] -eq 0) { return $true }
    }
    return $false
}

function ConvertFrom-RdsUtf8Bytes {
    param([byte[]]$Bytes)
    $strict = New-Object System.Text.UTF8Encoding($false, $true)
    try {
        $text = $strict.GetString($Bytes)
        return [pscustomobject]@{ Ok = $true; Text = $text }
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Text = '' }
    }
}

function Get-RdsEncodingInfo {
    param(
        [byte[]]$Bytes,
        [string]$Text
    )
    $bom = $false
    if ($null -ne $Bytes -and $Bytes.Length -ge 3) {
        if ($Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) { $bom = $true }
    }
    $crlf = $Text.Contains("`r`n")
    $eofBlank = $false
    if ($Text.EndsWith("`n`n") -or $Text.EndsWith("`r`n`r`n")) { $eofBlank = $true }
    return [pscustomobject]@{
        Bom      = $bom
        Crlf     = $crlf
        EofBlank = $eofBlank
        Bytes    = if ($null -eq $Bytes) { 0 } else { $Bytes.Length }
        Lines    = if ($Text.Length -eq 0) { 0 } else { ($Text -split "`n").Count }
    }
}

function Add-RdsFinding {
    param(
        [System.Collections.Generic.List[object]]$Findings,
        [string]$RuleId,
        [string]$Severity,
        [string]$Category,
        [string]$Reason,
        [string]$File = '',
        [int]$Line = 0,
        [string]$MaskedSnippet = ''
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
        maskedSnippet = $MaskedSnippet
    })
    return $Findings
}
