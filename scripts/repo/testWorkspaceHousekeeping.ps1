param(
  [string]$ProbeName = "housekeeping-self-test-safe-probe.txt",
  [string]$Out = ".tmp/workspace-housekeeping-self-test.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Normalize-RepoPath([string]$Path) {
  return ($Path -replace "\\", "/").TrimEnd("/")
}

function Invoke-JsonScript([string]$ScriptPath, [string[]]$Arguments = @()) {
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Script failed: $ScriptPath"
  }
  return ($output | Out-String).Trim()
}

function Read-JsonFile([string]$Path) {
  return Get-Content -Raw -LiteralPath (Join-Path $repoRoot $Path) | ConvertFrom-Json
}

function Add-Message([System.Collections.Generic.List[string]]$Messages, [string]$Message) {
  $Messages.Add($Message) | Out-Null
}

if ($ProbeName.Contains("/") -or $ProbeName.Contains("\") -or $ProbeName.StartsWith("workspace-housekeeping-")) {
  throw "ProbeName must be a simple disposable filename that does not look like a housekeeping report."
}

$historyScript = Join-Path $scriptRoot "mapReduceLocalHistory.ps1"
$housekeepingScript = Join-Path $scriptRoot "runWorkspaceHousekeeping.ps1"
$verifierScript = Join-Path $scriptRoot "verifyWorkspaceHousekeeping.ps1"

$probeRelative = Normalize-RepoPath ".tmp/$ProbeName"
$probeAbsolute = Join-Path $repoRoot $probeRelative
$tmpAbsolute = Join-Path $repoRoot ".tmp"

New-Item -ItemType Directory -Path $tmpAbsolute -Force | Out-Null
if (Test-Path -LiteralPath $probeAbsolute) {
  Remove-Item -LiteralPath $probeAbsolute -Force
}
Set-Content -LiteralPath $probeAbsolute -Encoding utf8 -Value "safe housekeeping self-test probe"

Invoke-JsonScript $historyScript | Out-Null
$mappedHistory = Read-JsonFile ".tmp/local-history-map-reduce.json"
$mappedSafeProbeEntries = @($mappedHistory.buckets.safe | Where-Object { (Normalize-RepoPath $_.path) -eq $probeRelative })

Invoke-JsonScript $housekeepingScript | Out-Null
$cleanupLoop = Read-JsonFile ".tmp/workspace-housekeeping-loop.json"
$removedSafe = @($cleanupLoop.actions.removedSafe | ForEach-Object { Normalize-RepoPath $_ })

$failures = [System.Collections.Generic.List[string]]::new()
if ($mappedSafeProbeEntries.Count -ne 1) {
  Add-Message $failures "probe was not mapped to exactly one safe entry"
}
if (Test-Path -LiteralPath $probeAbsolute) {
  Add-Message $failures "probe still exists after housekeeping"
}
if (-not [bool]$cleanupLoop.actions.safeCleanupApplied) {
  Add-Message $failures "housekeeping did not report safe cleanup"
}
if (-not $removedSafe.Contains($probeRelative)) {
  Add-Message $failures "removedSafe does not include the probe path"
}
if ([int]$cleanupLoop.finalHistory.safe.entries -ne 0) {
  Add-Message $failures "final safe entries should be zero after cleanup"
}
if ([bool]$cleanupLoop.actions.cleanWorktreePruneApplied -or [int]$cleanupLoop.actions.prunedWorktreeCount -ne 0) {
  Add-Message $failures "self-test must not prune clean worktrees"
}
if (-not [bool]$cleanupLoop.protectedPathsClean) {
  Add-Message $failures "protected paths must remain clean"
}

Invoke-JsonScript $verifierScript | Out-Null
$finalVerification = Read-JsonFile ".tmp/workspace-housekeeping-verification.json"
if (-not [bool]$finalVerification.passed) {
  Add-Message $failures "final verifier did not pass after self-test cleanup"
}
if ([int]$finalVerification.summary.finalSafe -ne 0) {
  Add-Message $failures "final verifier reports remaining safe entries"
}
if ([int]$finalVerification.summary.prunedWorktreeCount -ne 0) {
  Add-Message $failures "final verifier reports pruned worktrees"
}

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  passed = $failures.Count -eq 0
  failures = @($failures)
  probe = [pscustomobject]@{
    path = $probeRelative
    mappedSafeEntries = $mappedSafeProbeEntries.Count
    removed = -not (Test-Path -LiteralPath $probeAbsolute)
    removedSafeMatched = $removedSafe.Contains($probeRelative)
  }
  cleanup = [pscustomobject]@{
    safeCleanupApplied = $cleanupLoop.actions.safeCleanupApplied
    removedSafeCount = $cleanupLoop.actions.removedSafeCount
    prunedWorktreeCount = $cleanupLoop.actions.prunedWorktreeCount
    finalSafe = $cleanupLoop.finalHistory.safe.entries
    protectedPathsClean = $cleanupLoop.protectedPathsClean
  }
  finalVerification = [pscustomobject]@{
    passed = $finalVerification.passed
    operatorStatus = $finalVerification.operatorSummary.status
    finalSafe = $finalVerification.summary.finalSafe
    finalCaution = $finalVerification.summary.finalCaution
    removedSafeCount = $finalVerification.summary.removedSafeCount
    prunedWorktreeCount = $finalVerification.summary.prunedWorktreeCount
  }
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding utf8
$report | ConvertTo-Json -Depth 10

if ($failures.Count -gt 0) {
  throw "Workspace housekeeping self-test failed with $($failures.Count) failure(s)."
}
