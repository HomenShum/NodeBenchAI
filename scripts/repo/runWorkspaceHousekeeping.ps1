param(
  [switch]$ApplyCleanWorktrees,
  [string[]]$ProtectedPaths = @("public/proto/home-v5.html"),
  [string]$Out = ".tmp/workspace-housekeeping-loop.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

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

function Get-GitStatusLines {
  return @(& git status --short --branch --untracked-files=all)
}

function Test-GitDiffPath([string]$Path, [switch]$Cached) {
  $arguments = @("diff", "--name-only")
  if ($Cached) {
    $arguments += "--cached"
  }
  $arguments += "--"
  $arguments += $Path
  return @(& git @arguments).Count -gt 0
}

function Get-ProtectedPathReport([string[]]$Paths) {
  return @(
    foreach ($path in $Paths) {
      $unstagedDiff = Test-GitDiffPath $path
      $stagedDiff = Test-GitDiffPath $path -Cached
      [pscustomobject]@{
        path = $path
        exists = Test-Path -LiteralPath (Join-Path $repoRoot $path)
        unstagedDiff = $unstagedDiff
        stagedDiff = $stagedDiff
        clean = -not ($unstagedDiff -or $stagedDiff)
      }
    }
  )
}

$footprintScript = Join-Path $scriptRoot "auditWorkspaceFootprint.ps1"
$augmentScript = Join-Path $scriptRoot "checkAugmentUploadScope.ps1"
$historyScript = Join-Path $scriptRoot "mapReduceLocalHistory.ps1"

$statusBefore = Get-GitStatusLines
Invoke-JsonScript $footprintScript | Out-Null
Invoke-JsonScript $augmentScript | Out-Null
Invoke-JsonScript $historyScript | Out-Null

$initialHistory = Read-JsonFile ".tmp/local-history-map-reduce.json"
$safeBefore = [int]$initialHistory.summary.safe.entries
$removedSafe = @()
$prunedWorktrees = @()

if ($safeBefore -gt 0) {
  Invoke-JsonScript $historyScript @("-ApplySafe") | Out-Null
  $safeCleanupHistory = Read-JsonFile ".tmp/local-history-map-reduce.json"
  $removedSafe = @($safeCleanupHistory.actions.removedSafe)
}

if ($ApplyCleanWorktrees) {
  Invoke-JsonScript $historyScript @("-ApplyCleanWorktrees") | Out-Null
  $worktreeCleanupHistory = Read-JsonFile ".tmp/local-history-map-reduce.json"
  $prunedWorktrees = @($worktreeCleanupHistory.actions.prunedWorktrees)
}

Invoke-JsonScript $historyScript | Out-Null

$footprint = Read-JsonFile ".tmp/workspace-footprint.json"
$augment = Read-JsonFile ".tmp/augment-upload-scope.json"
$finalHistory = Read-JsonFile ".tmp/local-history-map-reduce.json"
$statusAfter = Get-GitStatusLines
$protectedPathReport = @(Get-ProtectedPathReport $ProtectedPaths)
$protectedPathsClean = -not (@($protectedPathReport | Where-Object { -not $_.clean }).Count -gt 0)

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  gitStatusBefore = $statusBefore
  gitStatusAfter = $statusAfter
  protectedPathsClean = $protectedPathsClean
  protectedPaths = $protectedPathReport
  footprint = [ordered]@{
    trackedFiles = $footprint.trackedFiles
    detailedCounts = $footprint.detailedCounts
  }
  augmentScope = [ordered]@{
    threshold = $augment.threshold
    passed = $augment.passed
    candidateCountPassed = $augment.candidateCountPassed
    candidateFiles = $augment.candidateFiles
    trackedFiles = $augment.trackedFiles
    trackedIncluded = $augment.trackedIncluded
    trackedExcludedByAugmentignore = $augment.trackedExcludedByAugmentignore
    untrackedIncluded = $augment.untrackedIncluded
    untrackedExcludedByAugmentignore = $augment.untrackedExcludedByAugmentignore
    criticalIgnoreProbesPassed = $augment.criticalIgnoreProbesPassed
    criticalIgnoreProbeFailures = $augment.criticalIgnoreProbeFailures
  }
  initialHistory = $initialHistory.summary
  finalHistory = $finalHistory.summary
  finalStats = $finalHistory.stats
  nestedSummary = $finalHistory.nestedSummary
  externalSummary = $finalHistory.externalSummary
  actions = [ordered]@{
    safeCleanupApplied = ($safeBefore -gt 0)
    removedSafeCount = $removedSafe.Count
    removedSafe = $removedSafe
    cleanWorktreePruneApplied = [bool]$ApplyCleanWorktrees
    prunedWorktreeCount = $prunedWorktrees.Count
    prunedWorktrees = $prunedWorktrees
  }
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
[pscustomobject]$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outPath -Encoding utf8
[pscustomobject]$report | ConvertTo-Json -Depth 10
