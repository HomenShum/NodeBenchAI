param(
  [int]$Threshold = 250000,
  [string]$Out = ".tmp/augment-upload-scope.json",
  [int]$SampleLimit = 50
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path
$augmentIgnorePath = Join-Path $repoRoot ".augmentignore"

function Normalize-RepoPath([string]$Path) {
  $normalized = $Path -replace "\\", "/"
  while ($normalized.StartsWith("./")) {
    $normalized = $normalized.Substring(2)
  }
  return $normalized
}

function New-HashSet([string[]]$Values) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [void]$set.Add((Normalize-RepoPath $value))
    }
  }
  Write-Output -NoEnumerate $set
}

function ConvertTo-WildcardRegex([string]$Pattern) {
  $normalized = Normalize-RepoPath $Pattern
  $escaped = [regex]::Escape($normalized)
  $escaped = $escaped -replace "\\\*\\\*", ".*"
  $escaped = $escaped -replace "\\\*", "[^/]*"
  return "^$escaped$"
}

function Test-DirectoryPatternMatch([string]$Path, [string]$Pattern) {
  $p = Normalize-RepoPath $Path
  $patternValue = (Normalize-RepoPath $Pattern).TrimEnd("/")

  if ($patternValue.StartsWith("**/")) {
    $needle = $patternValue.Substring(3)
    return $p -eq $needle -or $p.StartsWith("$needle/") -or $p.Contains("/$needle/")
  }

  if ($patternValue.Contains("*")) {
    $regex = ConvertTo-WildcardRegex "$patternValue/**"
    return [regex]::IsMatch($p, $regex, "IgnoreCase")
  }

  return $p -eq $patternValue -or $p.StartsWith("$patternValue/")
}

function Test-FilePatternMatch([string]$Path, [string]$Pattern) {
  $p = Normalize-RepoPath $Path
  $patternValue = Normalize-RepoPath $Pattern

  if ($patternValue.StartsWith("**/")) {
    $suffix = $patternValue.Substring(3)
    return $p -eq $suffix -or $p.EndsWith("/$suffix") -or ([System.Management.Automation.WildcardPattern]::new($suffix, "IgnoreCase")).IsMatch((Split-Path -Leaf $p))
  }

  if ($patternValue.Contains("*")) {
    $regex = ConvertTo-WildcardRegex $patternValue
    if ([regex]::IsMatch($p, $regex, "IgnoreCase")) {
      return $true
    }

    if (-not $patternValue.Contains("/")) {
      return ([System.Management.Automation.WildcardPattern]::new($patternValue, "IgnoreCase")).IsMatch((Split-Path -Leaf $p))
    }
  }

  return $p -eq $patternValue
}

function Test-AugmentIgnored([string]$Path, [string[]]$Patterns) {
  $p = Normalize-RepoPath $Path
  if (Test-DirectoryPatternMatch $p ".git/") {
    return $true
  }

  foreach ($rawPattern in $Patterns) {
    $pattern = $rawPattern.Trim()
    if ([string]::IsNullOrWhiteSpace($pattern) -or $pattern.StartsWith("#") -or $pattern.StartsWith("!")) {
      continue
    }

    if ($pattern.EndsWith("/")) {
      if (Test-DirectoryPatternMatch $p $pattern) {
        return $true
      }
      continue
    }

    if (Test-FilePatternMatch $p $pattern) {
      return $true
    }
  }

  return $false
}

$deleted = New-HashSet @(& git -c core.quotePath=false ls-files --deleted)
$trackedFiles = @(& git -c core.quotePath=false ls-files | ForEach-Object { Normalize-RepoPath $_ } | Where-Object { -not $deleted.Contains($_) })
$untrackedFiles = @(& git -c core.quotePath=false ls-files --others --exclude-standard | ForEach-Object { Normalize-RepoPath $_ })

$patterns = @()
if (Test-Path -LiteralPath $augmentIgnorePath) {
  $patterns = @(Get-Content -LiteralPath $augmentIgnorePath)
}

$criticalIgnoreProbePaths = @(
  ".git/config",
  "node_modules/example.js",
  ".tmp/workspace-housekeeping-loop.json",
  ".tmp/local-history-map-reduce.json",
  ".tmp/augment-upload-scope.json",
  ".tmp/workspace-footprint.json",
  ".tmp/workspace-housekeeping-verification.json",
  ".tmp/workspace-housekeeping-self-test.json",
  ".worktrees/example/file.txt",
  ".claude/worktrees/example/file.txt",
  ".claude/projects/example.json",
  ".overstory/example.json",
  ".serena/example.json",
  "test-results/example.json",
  "playwright-report/index.html",
  "scripts/eval-harness/results/example.json"
)

$criticalIgnoreProbes = @(
  $criticalIgnoreProbePaths | ForEach-Object {
    [pscustomobject]@{
      path = $_
      augmentIgnored = Test-AugmentIgnored $_ $patterns
    }
  }
)
$criticalIgnoreProbeFailures = @($criticalIgnoreProbes | Where-Object { -not $_.augmentIgnored })
$criticalIgnoreProbesPassed = $criticalIgnoreProbeFailures.Count -eq 0

$includedTracked = New-Object System.Collections.Generic.List[string]
$excludedTracked = New-Object System.Collections.Generic.List[string]
foreach ($file in $trackedFiles) {
  if (Test-AugmentIgnored $file $patterns) {
    $excludedTracked.Add($file)
  } else {
    $includedTracked.Add($file)
  }
}

$includedUntracked = New-Object System.Collections.Generic.List[string]
$excludedUntracked = New-Object System.Collections.Generic.List[string]
foreach ($file in $untrackedFiles) {
  if (Test-AugmentIgnored $file $patterns) {
    $excludedUntracked.Add($file)
  } else {
    $includedUntracked.Add($file)
  }
}

$candidateFiles = $includedTracked.Count + $includedUntracked.Count
$candidateCountPassed = $candidateFiles -le $Threshold
$passed = $candidateCountPassed -and $criticalIgnoreProbesPassed

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  threshold = $Threshold
  passed = $passed
  candidateCountPassed = $candidateCountPassed
  candidateFiles = $candidateFiles
  trackedFiles = $trackedFiles.Count
  trackedIncluded = $includedTracked.Count
  trackedExcludedByAugmentignore = $excludedTracked.Count
  untrackedFiles = $untrackedFiles.Count
  untrackedIncluded = $includedUntracked.Count
  untrackedExcludedByAugmentignore = $excludedUntracked.Count
  criticalIgnoreProbesPassed = $criticalIgnoreProbesPassed
  criticalIgnoreProbeFailures = $criticalIgnoreProbeFailures.Count
  augmentIgnorePath = if (Test-Path -LiteralPath $augmentIgnorePath) { $augmentIgnorePath } else { $null }
  samples = [pscustomobject]@{
    trackedExcludedByAugmentignore = @($excludedTracked | Select-Object -First $SampleLimit)
    untrackedIncluded = @($includedUntracked | Select-Object -First $SampleLimit)
    untrackedExcludedByAugmentignore = @($excludedUntracked | Select-Object -First $SampleLimit)
  }
  criticalIgnoreProbes = $criticalIgnoreProbes
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outPath -Encoding utf8
$report | Select-Object generatedAt, repo, threshold, passed, candidateCountPassed, candidateFiles, trackedFiles, trackedIncluded, trackedExcludedByAugmentignore, untrackedFiles, untrackedIncluded, untrackedExcludedByAugmentignore, criticalIgnoreProbesPassed, criticalIgnoreProbeFailures, augmentIgnorePath | ConvertTo-Json -Depth 4

if (-not $candidateCountPassed) {
  throw "Augment upload candidate count $candidateFiles exceeds threshold $Threshold. Review .augmentignore and local history before opening this workspace in Augment."
}

if (-not $criticalIgnoreProbesPassed) {
  throw "Critical Augment ignore probes failed. Review .augmentignore coverage for generated reports, local history, and worktrees."
}
