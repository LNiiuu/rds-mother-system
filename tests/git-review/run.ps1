# run.ps1 - G1 Git 审查固定夹具 F1-F6（隔离临时仓库，离线）
[CmdletBinding()]
param(
    [string]$Repo = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = if ($env:RDS_HOME) { $env:RDS_HOME } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } }
$git = $env:RDS_GIT
if (-not $git) { $c = Get-Command git -ErrorAction SilentlyContinue; if ($c) { $git = $c.Source } }
$localCfg = Join-Path $Repo 'tooling\toolchain.local.json'
if (-not $git -and (Test-Path -LiteralPath $localCfg)) { $git = (Get-Content -Raw -Encoding UTF8 -LiteralPath $localCfg | ConvertFrom-Json).git }
if (-not $git -or -not (Test-Path -LiteralPath $git)) {
  throw "git 未找到：设置 RDS_GIT 环境变量，或在 tooling\toolchain.local.json 中配置 { `"git`": `"<git 路径>`" }"
}
$review = Join-Path $Repo 'tooling\git-review\review.ps1'
$expectedPath = Join-Path $PSScriptRoot 'fixtures\expected.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = Join-Path $env:TEMP ('rds-git-review-fixtures-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
[void][System.IO.Directory]::CreateDirectory($root)

if (-not [System.IO.File]::Exists($review)) { Write-Output ('MISSING review.ps1: ' + $review); exit 1 }
if (-not [System.IO.File]::Exists($expectedPath)) { Write-Output ('MISSING expected.json: ' + $expectedPath); exit 1 }

$expected = ([System.IO.File]::ReadAllText($expectedPath) | ConvertFrom-Json)

function New-FixtureRepo {
    param([string]$Name)
    $dir = Join-Path $root $Name
    [void][System.IO.Directory]::CreateDirectory($dir)
    & $git -C $dir init -q | Out-Null
    & $git -C $dir config user.name 'RDS-Test' | Out-Null
    & $git -C $dir config user.email 'rds-test' | Out-Null
    & $git -C $dir config core.autocrlf false | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $dir 'README.md'), "# fixture`n", $utf8)
    & $git -C $dir add -A | Out-Null
    & $git -C $dir commit -q -m 'baseline' | Out-Null
    return $dir
}

function Write-FixtureAuth {
    param([string]$Path, [string]$TaskId, [string[]]$AllowedPaths, [bool]$DeleteAllowed = $false)
    $obj = [ordered]@{
        schemaVersion = '1.0.0'
        taskId        = $TaskId
        level         = 'L0'
        approvalId    = 'AP-FIXTURE'
        issuedBy      = 'R0'
        issuedAt      = (Get-Date -Format 's')
        allowedPaths  = @($AllowedPaths)
        deleteAllowed = $DeleteAllowed
        notes         = 'fixture'
    }
    $json = ConvertTo-Json -InputObject $obj -Depth 6
    [System.IO.File]::WriteAllText($Path, $json + "`n", $utf8)
}

function Write-FixtureText {
    param([string]$Dir, [string]$Rel, [string]$Text)
    [System.IO.File]::WriteAllText((Join-Path $Dir $Rel), $Text, $utf8)
}

function Invoke-FixtureReview {
    param([string]$RepoDir, [string]$TaskId, [string]$AuthPath, [string]$OutDir)
    $cliArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $review, '-Mode', 'status', '-Task', $TaskId, '-Auth', $AuthPath, '-Repo', $RepoDir, '-Out', $OutDir)
    $null = & powershell @cliArgs 2>&1
    $code = $LASTEXITCODE
    $reportPath = Join-Path $OutDir 'review-report.json'
    $report = $null
    if ([System.IO.File]::Exists($reportPath)) {
        $report = ([System.IO.File]::ReadAllText($reportPath) | ConvertFrom-Json)
    }
    return [pscustomobject]@{ ExitCode = $code; Report = $report }
}

$failures = New-Object System.Collections.Generic.List[string]
$rows = New-Object System.Collections.Generic.List[object]

$cases = @(
    @{ Id = 'F1'; Allowed = @('**'); Delete = $false; Setup = { param($d) } },
    @{ Id = 'F2'; Allowed = @('allowed/**'); Delete = $false; Setup = { param($d) Write-FixtureText -Dir $d -Rel 'outside.txt' -Text "hello`n" } },
    @{ Id = 'F3'; Allowed = @('**'); Delete = $false; Setup = {
            param($d)
            Write-FixtureText -Dir $d -Rel 'keep.txt' -Text "keep`n"
            & $git -C $d add -A | Out-Null
            & $git -C $d commit -q -m 'add keep' | Out-Null
            Remove-Item -LiteralPath (Join-Path $d 'keep.txt') -Force
        }
    },
    @{ Id = 'F4'; Allowed = @('**'); Delete = $false; Setup = { param($d) Write-FixtureText -Dir $d -Rel 'secret.txt' -Text ("const token = 'ghp_" + ('A' * 36) + "';`n") } },
    @{ Id = 'F5'; Allowed = @('**'); Delete = $false; Setup = { param($d)
            $bytes = New-Object byte[] 64
            for ($i = 0; $i -lt 64; $i++) { $bytes[$i] = 0 }
            $bytes[1] = 0x4D; $bytes[2] = 0x5A
            [System.IO.File]::WriteAllBytes((Join-Path $d 'binary.dat'), $bytes)
        }
    },
    @{ Id = 'F6'; Allowed = @('**'); Delete = $false; Setup = { param($d)
            $text = "line1`r`nline2`r`n`r`n"
            [System.IO.File]::WriteAllText((Join-Path $d 'note.txt'), $text, $utf8)
        }
    }
)

foreach ($case in $cases) {
    $id = [string]$case.Id
    $expectedCase = $null
    foreach ($e in @($expected.fixtures)) { if ([string]$e.id -eq $id) { $expectedCase = $e } }
    if ($null -eq $expectedCase) { $failures.Add($id + ': expected.json 缺少条目'); continue }

    $repoDir = New-FixtureRepo -Name $id
    & $case.Setup $repoDir
    $authPath = Join-Path $root ($id + '-auth.json')
    $fixtureTask = 'FIX-' + $id
    Write-FixtureAuth -Path $authPath -TaskId $fixtureTask -AllowedPaths @($case.Allowed) -DeleteAllowed ([bool]$case.Delete)
    $outDir = Join-Path $root ($id + '-out')
    [void][System.IO.Directory]::CreateDirectory($outDir)
    $actual = Invoke-FixtureReview -RepoDir $repoDir -TaskId $fixtureTask -AuthPath $authPath -OutDir $outDir

    $ok = $true
    $notes = New-Object System.Collections.Generic.List[string]
    if ($null -eq $actual.Report) {
        $ok = $false
        [void]$notes.Add('未生成报告')
    }
    else {
        if ([string]$actual.Report.verdict -ne [string]$expectedCase.verdict) {
            $ok = $false
            [void]$notes.Add('verdict=' + [string]$actual.Report.verdict + ' 期望 ' + [string]$expectedCase.verdict)
        }
        if ([int]$actual.ExitCode -ne [int]$expectedCase.exitCode) {
            $ok = $false
            [void]$notes.Add('exitCode=' + [string]$actual.ExitCode + ' 期望 ' + [string]$expectedCase.exitCode)
        }
        $actualRules = @($actual.Report.findings | ForEach-Object { [string]$_.ruleId } | Sort-Object -Unique)
        $expectedRules = @($expectedCase.ruleIds | ForEach-Object { [string]$_ } | Sort-Object -Unique)
        if (($actualRules -join '|') -ne ($expectedRules -join '|')) {
            $ok = $false
            [void]$notes.Add('rules=[' + ($actualRules -join ',') + '] 期望 [' + ($expectedRules -join ',') + ']')
        }
        if ([bool]$expectedCase.indexUnchanged) {
            if ([string]$actual.Report.indexBefore.indexDigest -ne [string]$actual.Report.indexAfter.indexDigest) {
                $ok = $false
                [void]$notes.Add('index 摘要发生变化')
            }
        }
    }
    if (-not $ok) { $failures.Add($id + ': ' + ($notes -join '; ')) }
    $rows.Add([pscustomobject]@{
        Id      = $id
        Ok      = $ok
        Verdict = $(if ($null -ne $actual.Report) { [string]$actual.Report.verdict } else { '-' })
        Exit    = $actual.ExitCode
        Notes   = ($notes -join '; ')
    })
}

foreach ($row in $rows) {
    $flag = 'FAIL'
    if ($row.Ok) { $flag = 'PASS' }
    Write-Output ('{0}  {1}  verdict={2} exit={3} {4}' -f $row.Id, $flag, $row.Verdict, $row.Exit, $row.Notes)
}

if ($failures.Count -gt 0) {
    Write-Output ('RESULT: FAIL (' + $failures.Count + ' 项)')
    exit 1
}
Write-Output 'RESULT: PASS'
exit 0
