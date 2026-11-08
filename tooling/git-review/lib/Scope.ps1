# Scope.ps1 - 路径范围、glob 匹配与路径黑名单（PowerShell 5.1）
Set-StrictMode -Version 2.0

function Convert-RdsGlobToRegex {
    param([Parameter(Mandatory = $true)][string]$Glob)
    $g = $Glob -replace '\\', '/'
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('^')
    $i = 0
    while ($i -lt $g.Length) {
        $c = $g[$i]
        if ($c -eq '*') {
            if (($i + 1) -lt $g.Length -and $g[$i + 1] -eq '*') {
                if (($i + 2) -lt $g.Length -and $g[$i + 2] -eq '/') {
                    [void]$sb.Append('(?:.*/)?')
                    $i += 3
                    continue
                }
                [void]$sb.Append('.*')
                $i += 2
                continue
            }
            [void]$sb.Append('[^/]*')
            $i += 1
            continue
        }
        if ($c -eq '?') {
            [void]$sb.Append('[^/]')
            $i += 1
            continue
        }
        [void]$sb.Append([regex]::Escape([string]$c))
        $i += 1
    }
    [void]$sb.Append('$')
    return $sb.ToString()
}

function Test-RdsPathMatch {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Glob
    )
    $normalized = $Path -replace '\\', '/'
    if ($normalized.StartsWith('./')) { $normalized = $normalized.Substring(2) }
    $regex = Convert-RdsGlobToRegex -Glob $Glob
    return [regex]::IsMatch($normalized, $regex, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
}

function Test-RdsPathInScope {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [object[]]$AllowedPaths = @()
    )
    if ($null -eq $AllowedPaths -or $AllowedPaths.Count -eq 0) { return $false }
    foreach ($pattern in $AllowedPaths) {
        if ($null -eq $pattern) { continue }
        $text = [string]$pattern
        if ($text.Length -eq 0) { continue }
        if (Test-RdsPathMatch -Path $Path -Glob $text) { return $true }
    }
    return $false
}

function Get-RdsPathDenyMatch {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [object[]]$Patterns = @()
    )
    $matches = New-Object System.Collections.Generic.List[object]
    foreach ($p in $Patterns) {
        if ($null -eq $p) { continue }
        if (Test-RdsPathMatch -Path $Path -Glob ([string]$p.glob)) {
            $matches.Add($p)
        }
    }
    return , $matches.ToArray()
}
