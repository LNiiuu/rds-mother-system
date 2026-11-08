# Secret.ps1 - 秘密/凭据扫描（路径豁免、正则、熵、掩码）（PowerShell 5.1）
Set-StrictMode -Version 2.0

function Get-RdsSecretRules {
    param([Parameter(Mandatory = $true)][string]$RulesPath)
    if (-not [System.IO.File]::Exists($RulesPath)) { return @() }
    $raw = [System.IO.File]::ReadAllText($RulesPath)
    $obj = $raw | ConvertFrom-Json
    return , @($obj.rules)
}

function Get-RdsAllowlist {
    param([Parameter(Mandatory = $true)][string]$AllowlistPath)
    if (-not [System.IO.File]::Exists($AllowlistPath)) {
        return [pscustomobject]@{ exemptPaths = @(); hashAllowlist = @() }
    }
    $raw = [System.IO.File]::ReadAllText($AllowlistPath)
    return ($raw | ConvertFrom-Json)
}

function Get-RdsMaskedSnippet {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value.Length -le 8) { return ('*** (len=' + $Value.Length + ')') }
    return ($Value.Substring(0, 4) + '****' + $Value.Substring($Value.Length - 4) + ' (len=' + $Value.Length + ')')
}

function Get-RdsShannonEntropy {
    param([Parameter(Mandatory = $true)][string]$Text)
    if ($Text.Length -eq 0) { return 0.0 }
    $counts = @{}
    foreach ($ch in $Text.ToCharArray()) {
        $key = [string]$ch
        if ($counts.ContainsKey($key)) { $counts[$key] = $counts[$key] + 1 } else { $counts[$key] = 1 }
    }
    $entropy = 0.0
    $len = [double]$Text.Length
    foreach ($value in $counts.Values) {
        $p = ([double]$value) / $len
        $entropy -= $p * [Math]::Log($p, 2.0)
    }
    return $entropy
}

function Test-RdsHighEntropyToken {
    param(
        [Parameter(Mandatory = $true)][string]$Token,
        [double]$Threshold = 4.5,
        [int]$MinLength = 24
    )
    if ($Token.Length -lt $MinLength) { return $false }
    if ($Token -notmatch '^[A-Za-z0-9+/=_\-.]+$') { return $false }
    if ($Token -match '^[0-9a-fA-F]+$') { return $false }
    return ((Get-RdsShannonEntropy -Text $Token) -ge $Threshold)
}

function Get-RdsSecretFindings {
    param(
        [System.Collections.Generic.List[object]]$Findings,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text,
        [object[]]$Rules = @(),
        [object]$Allowlist = $null
    )
    $exempt = $false
    if ($null -ne $Allowlist) {
        foreach ($entry in @($Allowlist.exemptPaths)) {
            if ($null -eq $entry) { continue }
            if (Test-RdsPathMatch -Path $Path -Glob ([string]$entry.glob)) { $exempt = $true; break }
        }
    }
    if ($exempt) { return }
    $hashAllow = @()
    if ($null -ne $Allowlist) { $hashAllow = @($Allowlist.hashAllowlist) }

    $lines = $Text -split "`n"
    foreach ($rule in $Rules) {
        if ($null -eq $rule) { continue }
        $ruleId = [string]$rule.id
        $severity = [string]$rule.severity
        $reason = [string]$rule.reason
        $entropy = $false
        $entropyProp = $rule.PSObject.Properties['entropy']
        if ($null -ne $entropyProp -and $entropyProp.Value -eq $true) { $entropy = $true }
        if ($entropy) {
            $minLength = 24
            $minProp = $rule.PSObject.Properties['minLength']
            if ($null -ne $minProp) { $minLength = [int]$minProp.Value }
            $threshold = 4.5
            $thresholdProp = $rule.PSObject.Properties['threshold']
            if ($null -ne $thresholdProp) { $threshold = [double]$thresholdProp.Value }
            $tokenRegex = [regex]('[A-Za-z0-9+/=_\-.]{' + $minLength + ',}')
            for ($ln = 0; $ln -lt $lines.Count; $ln++) {
                foreach ($m in $tokenRegex.Matches($lines[$ln])) {
                    $token = $m.Value
                    if (-not (Test-RdsHighEntropyToken -Token $token -Threshold $threshold -MinLength $minLength)) { continue }
                    $hash = Get-RdsSha256Text -Text $token
                    $allowed = $false
                    foreach ($a in $hashAllow) { if ($null -ne $a -and [string]$a.sha256 -eq $hash) { $allowed = $true; break } }
                    if ($allowed) { continue }
                    Add-RdsFinding -Findings $Findings -RuleId $ruleId -Severity $severity -Category 'secret' -Reason $reason -File $Path -Line ($ln + 1) -MaskedSnippet (Get-RdsMaskedSnippet -Value $token) | Out-Null
                }
            }
            continue
        }
        $regex = [regex]$rule.regex
        for ($ln = 0; $ln -lt $lines.Count; $ln++) {
            foreach ($m in $regex.Matches($lines[$ln])) {
                $value = $m.Value
                if ($ruleId -eq 'PERSONAL-EMAIL' -and $value -match '(?i)@(example\.(com|net|org)|[A-Za-z0-9.-]+\.(invalid|test|localhost))$') { continue }
                $hash = Get-RdsSha256Text -Text $value
                $allowed = $false
                foreach ($a in $hashAllow) { if ($null -ne $a -and [string]$a.sha256 -eq $hash) { $allowed = $true; break } }
                if ($allowed) { continue }
                Add-RdsFinding -Findings $Findings -RuleId $ruleId -Severity $severity -Category 'secret' -Reason $reason -File $Path -Line ($ln + 1) -MaskedSnippet (Get-RdsMaskedSnippet -Value $value) | Out-Null
            }
        }
    }
}
