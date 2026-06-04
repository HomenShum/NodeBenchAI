param(
  [switch]$SkipRun,
  [string]$Report = ".tmp/workspace-housekeeping-loop.json",
  [string]$Out = ".tmp/workspace-housekeeping-verification.json",
  [int]$MaxSourceReportAgeSeconds = 600,
  [int]$MaxFutureReportSkewSeconds = 30
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-JsonFile([string]$Path) {
  return Get-Content -Raw -LiteralPath (Join-Path $repoRoot $Path) | ConvertFrom-Json
}

function Add-Message([System.Collections.Generic.List[string]]$Messages, [string]$Message) {
  $Messages.Add($Message) | Out-Null
}

function Normalize-FullPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $null
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function Test-ReportRepoMatch($ReportObject) {
  $reportRepo = Normalize-FullPath $ReportObject.repo
  return -not [string]::IsNullOrWhiteSpace($reportRepo) -and $reportRepo.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ReportAgeSeconds([string]$GeneratedAt, [datetime]$NowUtc) {
  if ([string]::IsNullOrWhiteSpace($GeneratedAt)) {
    return $null
  }

  try {
    $timestamp = [datetime]::Parse($GeneratedAt).ToUniversalTime()
    return [Math]::Round(($NowUtc - $timestamp).TotalSeconds, 3)
  } catch {
    return $null
  }
}

function Test-GitIgnored([string]$Path) {
  & git check-ignore -q -- $Path
  return $LASTEXITCODE -eq 0
}

function Invoke-StagedDiffCheck {
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& git diff --cached --check 2>&1)
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{
      passed = $exitCode -eq 0
      exitCode = $exitCode
      issues = @($output | ForEach-Object { $_.ToString() })
    }
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }
}

function Get-GitPathList([string[]]$Arguments) {
  $items = [System.Collections.Generic.List[string]]::new()
  @(& git @Arguments) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    $items.Add($_.ToString()) | Out-Null
  }
  return $items
}

function Test-HousekeepingPath([string]$Path) {
  $normalized = $Path -replace "\\", "/"
  return (
    $normalized -eq "docs/runbooks/WORKSPACE_HOUSEKEEPING.md" -or
    $normalized -eq "package.json" -or
    $normalized -like "scripts/repo/*"
  )
}

if (-not $SkipRun) {
  $housekeepingScript = Join-Path $scriptRoot "runWorkspaceHousekeeping.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $housekeepingScript | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Housekeeping run failed before verification."
  }
}

$loop = Read-JsonFile $Report
$history = Read-JsonFile ".tmp/local-history-map-reduce.json"
$augment = Read-JsonFile ".tmp/augment-upload-scope.json"
$footprint = Read-JsonFile ".tmp/workspace-footprint.json"
$augmentCandidateCountPassed = if ($null -ne $loop.augmentScope.candidateCountPassed) {
  [bool]$loop.augmentScope.candidateCountPassed
} else {
  ([int]$loop.augmentScope.candidateFiles -le [int]$loop.augmentScope.threshold)
}
$augmentCriticalIgnoreProbesPassed = if ($null -ne $loop.augmentScope.criticalIgnoreProbesPassed) {
  [bool]$loop.augmentScope.criticalIgnoreProbesPassed
} else {
  $true
}
$augmentCriticalIgnoreProbeFailures = if ($null -ne $loop.augmentScope.criticalIgnoreProbeFailures) {
  [int]$loop.augmentScope.criticalIgnoreProbeFailures
} else {
  0
}
$stagedDiffCheck = Invoke-StagedDiffCheck
$stagedPaths = Get-GitPathList @("diff", "--cached", "--name-only")
$unstagedPaths = Get-GitPathList @("diff", "--name-only")
$untrackedPaths = Get-GitPathList @("ls-files", "--others", "--exclude-standard")
$nonHousekeepingStagedPaths = @($stagedPaths | Where-Object { -not (Test-HousekeepingPath $_) })
$nonHousekeepingUnstagedPaths = @($unstagedPaths | Where-Object { -not (Test-HousekeepingPath $_) })
$nonHousekeepingUntrackedPaths = @($untrackedPaths | Where-Object { -not (Test-HousekeepingPath $_) })
$driftSummary = [pscustomobject]@{
  stagedCount = $stagedPaths.Count
  unstagedCount = $unstagedPaths.Count
  untrackedCount = $untrackedPaths.Count
  housekeepingOnly = (
    $nonHousekeepingStagedPaths.Count -eq 0 -and
    $nonHousekeepingUnstagedPaths.Count -eq 0 -and
    $nonHousekeepingUntrackedPaths.Count -eq 0
  )
  stagedPaths = @($stagedPaths)
  unstagedPaths = @($unstagedPaths)
  untrackedPaths = @($untrackedPaths)
  nonHousekeepingStagedPaths = @($nonHousekeepingStagedPaths)
  nonHousekeepingUnstagedPaths = @($nonHousekeepingUnstagedPaths)
  nonHousekeepingUntrackedPaths = @($nonHousekeepingUntrackedPaths)
}

$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$nowUtc = (Get-Date).ToUniversalTime()

$sourceReports = [ordered]@{
  loop = [pscustomobject]@{
    path = $Report
    repo = $loop.repo
    generatedAt = $loop.generatedAt
    repoMatches = Test-ReportRepoMatch $loop
    ageSeconds = Get-ReportAgeSeconds $loop.generatedAt $nowUtc
    fresh = $false
  }
  history = [pscustomobject]@{
    path = ".tmp/local-history-map-reduce.json"
    repo = $history.repo
    generatedAt = $history.generatedAt
    repoMatches = Test-ReportRepoMatch $history
    ageSeconds = Get-ReportAgeSeconds $history.generatedAt $nowUtc
    fresh = $false
  }
  augment = [pscustomobject]@{
    path = ".tmp/augment-upload-scope.json"
    repo = $augment.repo
    generatedAt = $augment.generatedAt
    repoMatches = Test-ReportRepoMatch $augment
    ageSeconds = Get-ReportAgeSeconds $augment.generatedAt $nowUtc
    fresh = $false
  }
  footprint = [pscustomobject]@{
    path = ".tmp/workspace-footprint.json"
    repo = $footprint.repo
    generatedAt = $footprint.generatedAt
    repoMatches = Test-ReportRepoMatch $footprint
    ageSeconds = Get-ReportAgeSeconds $footprint.generatedAt $nowUtc
    fresh = $false
  }
}

foreach ($property in $sourceReports.GetEnumerator()) {
  if (-not [bool]$property.Value.repoMatches) {
    Add-Message $failures "source report repo mismatch: $($property.Key)"
  }
  if ([string]::IsNullOrWhiteSpace($property.Value.generatedAt)) {
    Add-Message $failures "source report missing generatedAt: $($property.Key)"
  }
  if ($null -eq $property.Value.ageSeconds) {
    Add-Message $failures "source report generatedAt is not parseable: $($property.Key)"
  } elseif ([double]$property.Value.ageSeconds -lt (-1 * $MaxFutureReportSkewSeconds)) {
    Add-Message $failures "source report timestamp is too far in the future: $($property.Key) ageSeconds=$($property.Value.ageSeconds)"
  } elseif ([double]$property.Value.ageSeconds -gt $MaxSourceReportAgeSeconds) {
    Add-Message $failures "source report is stale: $($property.Key) ageSeconds=$($property.Value.ageSeconds)"
  } else {
    $property.Value.fresh = $true
  }
}

if (-not [bool]$stagedDiffCheck.passed) {
  Add-Message $failures "git diff --cached --check must pass"
}
if (-not [bool]$loop.augmentScope.passed) {
  Add-Message $failures "augmentScope.passed must be true"
}
if (-not $augmentCandidateCountPassed) {
  Add-Message $failures "augmentScope.candidateCountPassed must be true"
}
if (-not $augmentCriticalIgnoreProbesPassed) {
  Add-Message $failures "augmentScope.criticalIgnoreProbesPassed must be true"
}
if ($augmentCriticalIgnoreProbeFailures -ne 0) {
  Add-Message $failures "augmentScope.criticalIgnoreProbeFailures must be 0"
}
if ([int]$loop.augmentScope.untrackedIncluded -ne 0) {
  Add-Message $failures "augmentScope.untrackedIncluded must be 0"
}
if ([int]$loop.augmentScope.candidateFiles -gt [int]$loop.augmentScope.threshold) {
  Add-Message $failures "candidate files exceed Augment threshold"
}
if (-not [bool]$loop.protectedPathsClean) {
  Add-Message $failures "protectedPathsClean must be true"
}
foreach ($pathReport in @($loop.protectedPaths)) {
  if (-not [bool]$pathReport.exists) {
    Add-Message $failures "protected path missing: $($pathReport.path)"
  }
  if (-not [bool]$pathReport.clean) {
    Add-Message $failures "protected path has staged or unstaged drift: $($pathReport.path)"
  }
}
if ([int]$loop.finalHistory.safe.entries -ne 0) {
  Add-Message $failures "finalHistory.safe.entries must be 0"
}
if ([bool]$loop.actions.cleanWorktreePruneApplied) {
  Add-Message $failures "normal verification must not prune clean worktrees"
}
if ([int]$loop.actions.prunedWorktreeCount -ne 0) {
  Add-Message $failures "prunedWorktreeCount must be 0 in normal verification"
}

foreach ($reportPath in @(
  ".tmp/workspace-housekeeping-loop.json",
  ".tmp/local-history-map-reduce.json",
  ".tmp/augment-upload-scope.json",
  ".tmp/workspace-footprint.json",
  ".tmp/workspace-housekeeping-verification.json",
  ".tmp/workspace-housekeeping-self-test.json"
)) {
  if (-not (Test-GitIgnored $reportPath)) {
    Add-Message $failures "report path is not ignored by Git: $reportPath"
  }
}

if ([int]$loop.finalHistory.caution.entries -gt 0) {
  Add-Message $warnings "caution worktrees present: $($loop.finalHistory.caution.entries)"
}
if ([int]$loop.finalStats.invalidRegistered -gt 0) {
  Add-Message $warnings "invalid registered worktrees present: $($loop.finalStats.invalidRegistered)"
}
if ([int]$loop.nestedSummary.missing -gt 0) {
  Add-Message $warnings "missing nested registered worktrees present: $($loop.nestedSummary.missing)"
}
if ([int]$loop.externalSummary.missing -gt 0) {
  Add-Message $warnings "missing external registered worktrees present: $($loop.externalSummary.missing)"
}
if (-not [bool]$driftSummary.housekeepingOnly) {
  Add-Message $warnings "non-housekeeping drift is present"
}

$cautionEntries = @($history.buckets.caution | Select-Object path, reason, branch, dirty, locked, exists, gitUsable)
$operatorStatus = if ($failures.Count -gt 0) { "FAIL" } elseif ($warnings.Count -gt 0) { "WARN" } else { "PASS" }
$operatorMessage = if ($operatorStatus -eq "FAIL") {
  "Housekeeping verification failed: $($failures.Count) failure(s), $($warnings.Count) warning(s)."
} elseif ($operatorStatus -eq "WARN") {
  "Housekeeping verified with attention items: $($warnings.Count) warning(s)."
} else {
  "Housekeeping verified: Augment $($loop.augmentScope.candidateFiles)/$($loop.augmentScope.threshold), safe=$($loop.finalHistory.safe.entries), caution=$($loop.finalHistory.caution.entries), protected paths clean, drift housekeeping-only."
}
$verification = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  passed = $failures.Count -eq 0
  operatorSummary = [pscustomobject]@{
    status = $operatorStatus
    notifyRecommended = $operatorStatus -ne "PASS"
    message = $operatorMessage
    launchRelevantBlockers = @($failures)
    attentionItems = @($warnings)
  }
  failures = @($failures)
  warnings = @($warnings)
  summary = [pscustomobject]@{
    candidateFiles = $loop.augmentScope.candidateFiles
    threshold = $loop.augmentScope.threshold
    criticalIgnoreProbesPassed = $augmentCriticalIgnoreProbesPassed
    untrackedIncluded = $loop.augmentScope.untrackedIncluded
    finalSafe = $loop.finalHistory.safe.entries
    finalCaution = $loop.finalHistory.caution.entries
    finalKeep = $loop.finalHistory.keep.entries
    protectedPathsClean = $loop.protectedPathsClean
    protectedPathCount = @($loop.protectedPaths).Count
    dirtyProtectedPathCount = @($loop.protectedPaths | Where-Object { -not [bool]$_.clean }).Count
    removedSafeCount = $loop.actions.removedSafeCount
    prunedWorktreeCount = $loop.actions.prunedWorktreeCount
    invalidRegistered = $loop.finalStats.invalidRegistered
    stagedDiffCheckPassed = $stagedDiffCheck.passed
    housekeepingOnlyDrift = $driftSummary.housekeepingOnly
    sourceReportsMatch = -not @($sourceReports.GetEnumerator() | Where-Object { -not [bool]$_.Value.repoMatches }).Count
    sourceReportsFresh = -not @($sourceReports.GetEnumerator() | Where-Object { -not [bool]$_.Value.fresh }).Count
    maxSourceReportAgeSeconds = $MaxSourceReportAgeSeconds
    maxFutureReportSkewSeconds = $MaxFutureReportSkewSeconds
  }
  cautionEntries = $cautionEntries
  stagedDiffCheck = $stagedDiffCheck
  drift = $driftSummary
  sourceReports = [pscustomobject]$sourceReports
  augmentReportPassed = $augment.passed
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
$verification | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding utf8
$verification | ConvertTo-Json -Depth 10

if ($failures.Count -gt 0) {
  throw "Workspace housekeeping verification failed with $($failures.Count) failure(s)."
}
