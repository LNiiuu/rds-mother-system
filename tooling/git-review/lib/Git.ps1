# Git.ps1 - RDS Git 只读封装与摘要计算（PowerShell 5.1）
Set-StrictMode -Version 2.0

$script:RdsGitExe = $env:RDS_GIT

function Get-RdsGitExe {
    if ($script:RdsGitExe) { return $script:RdsGitExe }
    $candidate = $env:RDS_GIT
    if (-not $candidate) {
        $cmd = Get-Command git -ErrorAction SilentlyContinue
        if ($cmd) { $candidate = $cmd.Source }
    }
    if (-not $candidate) {
        $localCfg = Join-Path $PSScriptRoot '..\..\..\tooling\toolchain.local.json'
        if (Test-Path -LiteralPath $localCfg) { $candidate = (Get-Content -Raw -Encoding UTF8 -LiteralPath $localCfg | ConvertFrom-Json).git }
    }
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) {
        throw "git 未找到：设置 RDS_GIT 环境变量，或在 tooling\toolchain.local.json 中配置 git 路径"
    }
    $script:RdsGitExe = $candidate
    return $script:RdsGitExe
}

function Invoke-RdsGit {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previousLocks = $env:GIT_OPTIONAL_LOCKS
    $previousEap = $ErrorActionPreference
    $env:GIT_OPTIONAL_LOCKS = '0'
    $ErrorActionPreference = 'Continue'
    $code = 1
    $raw = @()
    try {
        $raw = & (Get-RdsGitExe) -C $Repo @Arguments 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousEap
        if ($null -eq $previousLocks) {
            Remove-Item Env:GIT_OPTIONAL_LOCKS -ErrorAction SilentlyContinue
        }
        else {
            $env:GIT_OPTIONAL_LOCKS = $previousLocks
        }
    }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($raw)) {
        if ($null -eq $item) { continue }
        $lines.Add([string]$item)
    }
    if ($lines.Count -eq 1 -and $lines[0] -eq '') { $lines.Clear() }
    return [pscustomobject]@{
        Text     = ($lines -join "`n")
        Lines    = $lines.ToArray()
        ExitCode = $code
    }
}

function Get-RdsRepoRoot {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('rev-parse', '--show-toplevel')
    if ($r.ExitCode -ne 0) { return $null }
    return ($r.Text.Trim() -replace '\\', '/')
}

function Get-RdsHead {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('rev-parse', 'HEAD')
    if ($r.ExitCode -ne 0) { return $null }
    return $r.Text.Trim()
}

function Get-RdsBranch {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('symbolic-ref', '--short', 'HEAD')
    if ($r.ExitCode -eq 0 -and $r.Text.Trim().Length -gt 0) { return $r.Text.Trim() }
    $r2 = Invoke-RdsGit -Repo $Repo -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($r2.ExitCode -eq 0) { return $r2.Text.Trim() }
    return ''
}

function Get-RdsRemoteUrl {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('config', '--get', 'remote.origin.url')
    if ($r.ExitCode -ne 0) { return '' }
    return $r.Text.Trim()
}

function Get-RdsSha256Text {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($b in $hash) { $parts.Add($b.ToString('x2')) }
        return ($parts -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Get-RdsIndexLines {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('ls-files', '-s')
    if ($r.ExitCode -ne 0) { return $null }
    $lines = @($r.Lines | Where-Object { $_ -ne '' } | Sort-Object -CaseSensitive)
    return , $lines
}

function Get-RdsIndexDigest {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $lines = Get-RdsIndexLines -Repo $Repo
    if ($null -eq $lines) { return '' }
    return (Get-RdsSha256Text -Text (($lines -join "`n")))
}

function Get-RdsStagedDiffText {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('diff', '--cached', '--no-color')
    if ($r.ExitCode -ne 0) { return '' }
    return ($r.Text -replace "`r", '')
}

function Get-RdsStagedDigest {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $text = (Get-RdsStagedDiffText -Repo $Repo).TrimEnd("`n")
    return (Get-RdsSha256Text -Text $text)
}

function Get-RdsStagedCount {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('diff', '--cached', '--name-only')
    if ($r.ExitCode -ne 0) { return 0 }
    return @($r.Lines | Where-Object { $_ -ne '' }).Count
}

function Get-RdsStatusEntries {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('status', '--porcelain=v1', '-uall')
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($line in $r.Lines) {
        if ($null -eq $line -or $line.Length -lt 3) { continue }
        $x = $line.Substring(0, 1)
        $y = $line.Substring(1, 1)
        $path = $line.Substring(3)
        if ($path -like '* -> *') {
            $parts = $path -split ' -> '
            $path = $parts[$parts.Count - 1]
        }
        $path = $path.Trim('"')
        $status = 'M'
        if ($x -eq '?' -or $y -eq '?') { $status = 'U' }
        elseif ($x -eq 'D' -or $y -eq 'D') { $status = 'D' }
        elseif ($x -eq 'A' -or $y -eq 'A') { $status = 'A' }
        elseif ($x -eq 'R') { $status = 'R' }
        $list.Add([pscustomobject]@{
            Path           = $path
            IndexStatus    = $x
            WorktreeStatus = $y
            Status         = $status
        })
    }
    return , $list.ToArray()
}

function Get-RdsWorktreeDigest {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $r = Invoke-RdsGit -Repo $Repo -Arguments @('status', '--porcelain=v1', '-uall')
    $lines = @($r.Lines | Where-Object { $_ -ne '' } | Sort-Object -CaseSensitive)
    return (Get-RdsSha256Text -Text (($lines -join "`n")))
}

function Get-RdsSha256File {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not [System.IO.File]::Exists($Path)) { return '' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try { $hash = $sha.ComputeHash($stream) } finally { $stream.Dispose() }
        $parts = New-Object System.Collections.Generic.List[string]
        foreach ($b in $hash) { $parts.Add($b.ToString('x2')) }
        return ($parts -join '')
    }
    finally {
        $sha.Dispose()
    }
}
