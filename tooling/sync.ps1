param(
  [string]$Repo = 'D:\M1',
  [string]$Remote = 'origin',
  [string]$Branch = 'main',
  [switch]$Approve,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$git = 'D:\Tools\Git\bin\git.exe'
if ($Force) { throw 'force push is forbidden by policy' }
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { throw "not a git repo: $Repo" }
$status = & $git -C $Repo status --porcelain
if ($status) { throw "working tree not clean: $($status.Count) entries" }
$cur = (& $git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
if ($cur -ne $Branch) { throw "branch mismatch: $cur != $Branch" }
$deny = @('*.apk','*.pcap','*.pcapng','*.exe','*.dll','*.so','*.bin','.env','*token*','*.key','*.pem')
$tracked = & $git -C $Repo ls-files
$bad = foreach ($f in $tracked) { foreach ($d in $deny) { if ($f -like $d) { $f } } }
if ($bad) { throw "sensitive/sample files tracked: $($bad -join ', ')" }
$url = (& $git -C $Repo remote get-url $Remote).Trim()
if (-not $url) { throw "remote not configured: $Remote" }
if (-not $Approve) {
  "GUARD PASS (dry-run): branch=$cur remote=$url files=$($tracked.Count)"
  "-- approve with -Approve to push after AP-15 --"
  exit 0
}
& $git -C $Repo push --dry-run $Remote $Branch
if ($LASTEXITCODE -ne 0) { throw 'dry-run failed' }
& $git -C $Repo push $Remote $Branch
if ($LASTEXITCODE -ne 0) { throw 'push failed' }
$local = (& $git -C $Repo rev-parse HEAD).Trim()
$remoteSha = (& $git -C $Repo ls-remote $Remote "refs/heads/$Branch").Split()[0]
"local=$local remote=$remoteSha"

