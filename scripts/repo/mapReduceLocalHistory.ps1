param(
  [switch]$ApplySafe,
  [switch]$ApplyCleanWorktrees,
  [string]$Out = ".tmp/local-history-map-reduce.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path
$repoRootFull = [System.IO.Path]::GetFullPath($repoRoot)

function Normalize-RepoPath([string]$Path) {
  return ($Path -replace "\\", "/").TrimEnd("/")
}

function Get-RepoRelativePath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full.Equals($repoRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return "."
  }
  if ($full.StartsWith($repoRootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    return Normalize-RepoPath $full.Substring($repoRootFull.Length + 1)
  }
  return $null
}

function Assert-InRepo([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($repoRootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside repo: $full"
  }
  return $full
}

function New-Entry([string]$Bucket, [string]$Path, [string]$Reason, [hashtable]$Extra = @{}) {
  $absolute = if ([System.IO.Path]::IsPathRooted($Path)) { [System.IO.Path]::GetFullPath($Path) } else { [System.IO.Path]::GetFullPath((Join-Path $repoRoot $Path)) }
  $entry = [ordered]@{
    bucket = $Bucket
    path = Normalize-RepoPath $Path
    absolutePath = $absolute
    reason = $Reason
  }
  foreach ($key in $Extra.Keys) {
    $entry[$key] = $Extra[$key]
  }
  return [pscustomobject]$entry
}

function Add-Entry($Buckets, $Entry) {
  $Buckets[$Entry.bucket].Add($Entry) | Out-Null
}

function Get-Worktrees {
  $items = @()
  $current = $null
  foreach ($line in & git worktree list --porcelain) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      if ($current) { $items += [pscustomobject]$current }
      $current = $null
      continue
    }
    if ($line.StartsWith("worktree ")) {
      if ($current) { $items += [pscustomobject]$current }
      $current = [ordered]@{ path = $line.Substring("worktree ".Length); locked = $false; branch = $null; head = $null }
      continue
    }
    if (-not $current) { continue }
    if ($line.StartsWith("branch ")) {
      $current.branch = $line.Substring("branch ".Length)
    } elseif ($line.StartsWith("HEAD ")) {
      $current.head = $line.Substring("HEAD ".Length)
    } elseif ($line.StartsWith("locked")) {
      $current.locked = $true
    }
  }
  if ($current) { $items += [pscustomobject]$current }
  return $items
}

function Invoke-GitQuiet([string[]]$Arguments) {
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& git @Arguments 2>$null)
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ output = $output; exitCode = $exitCode }
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }
}

function Test-WorktreeUsable([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $probe = Invoke-GitQuiet @("-C", $Path, "rev-parse", "--is-inside-work-tree")
  return $probe.exitCode -eq 0 -and (($probe.output | Select-Object -First 1) -eq "true")
}

function Test-WorktreeDirty([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $statusResult = Invoke-GitQuiet @("-C", $Path, "status", "--porcelain")
  if ($statusResult.exitCode -ne 0) { return $false }
  $status = @($statusResult.output)
  return $status.Count -gt 0
}

function Test-CleanupLocked([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $true }

  $files = if ($item.PSIsContainer) {
    @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue)
  } else {
    @($item)
  }

  foreach ($file in $files) {
    $stream = $null
    try {
      $stream = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    } catch {
      return $true
    } finally {
      if ($stream) { $stream.Close() }
    }
  }

  return $false
}

$buckets = [ordered]@{
  safe = [System.Collections.Generic.List[object]]::new()
  caution = [System.Collections.Generic.List[object]]::new()
  keep = [System.Collections.Generic.List[object]]::new()
  external_report_only = [System.Collections.Generic.List[object]]::new()
  nested_report_only = [System.Collections.Generic.List[object]]::new()
}

$tmpKeep = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
@(
  "augment-upload-scope.json",
  "workspace-footprint.json",
  "local-history-map-reduce.json",
  "workspace-housekeeping-loop.json",
  "workspace-housekeeping-verification.json",
  "workspace-housekeeping-self-test.json"
  "scratchnode-launch-goal-loop.json",
  "scratchnode-launch-scan.json"
) | ForEach-Object { $tmpKeep.Add($_) | Out-Null }

$tmpPath = Join-Path $repoRoot ".tmp"
if (Test-Path -LiteralPath $tmpPath) {
  foreach ($child in Get-ChildItem -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue) {
    if (-not $tmpKeep.Contains($child.Name)) {
      $relativeChild = Join-Path ".tmp" $child.Name
      if (Test-CleanupLocked $child.FullName) {
        Add-Entry $buckets (New-Entry "keep" $relativeChild "locked generated .tmp child" @{ locked = $true })
      } else {
        Add-Entry $buckets (New-Entry "safe" $relativeChild "generated .tmp child")
      }
    }
  }
}

foreach ($safeRoot in @("test-results", "playwright-report", "scripts/eval-harness/results")) {
  $path = Join-Path $repoRoot $safeRoot
  if (Test-Path -LiteralPath $path) {
    foreach ($child in Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue) {
      if ($child.Name -ne ".gitignore") {
        Add-Entry $buckets (New-Entry "safe" (Join-Path $safeRoot $child.Name) "generated test/eval output")
      }
    }
  }
}

$stats = [ordered]@{ locked = 0; lockedAlive = 0; lockedStale = 0; dirty = 0; cleanLocked = 0; invalidRegistered = 0 }
$nested = [ordered]@{ registered = 0; existing = 0; missing = 0; invalid = 0; dirty = 0; locked = 0; lockedAlive = 0; lockedStale = 0 }
$external = [ordered]@{ registered = 0; existing = 0; missing = 0; invalid = 0; dirty = 0; locked = 0 }

foreach ($wt in Get-Worktrees) {
  $absolute = [System.IO.Path]::GetFullPath($wt.path)
  $relative = Get-RepoRelativePath $absolute
  $exists = Test-Path -LiteralPath $absolute
  $isExternal = $null -eq $relative
  $isNested = -not $isExternal -and ($relative -like ".worktrees/*" -or $relative -like ".claude/worktrees/*")
  $isRequired = -not $isExternal -and $relative -eq ".worktrees/prod-parity-runtime"
  $isUsable = Test-WorktreeUsable $absolute
  $isDirty = if ($isUsable) { Test-WorktreeDirty $absolute } else { $false }
  $isLocked = [bool]$wt.locked

  if ($exists -and -not $isUsable) { $stats.invalidRegistered += 1 }
  if ($isDirty) { $stats.dirty += 1 }
  if ($isLocked) {
    $stats.locked += 1
    $stats.lockedStale += 1
    if (-not $isDirty) { $stats.cleanLocked += 1 }
  }

  $entryPath = if ($relative) { $relative } else { $absolute }
  $extra = @{ dirty = $isDirty; locked = $isLocked; lockAlive = $null; branch = $wt.branch; exists = $exists; gitUsable = $isUsable }

  if ($isExternal) {
    $external.registered += 1
    if ($exists) { $external.existing += 1 } else { $external.missing += 1 }
    if ($exists -and -not $isUsable) { $external.invalid += 1 }
    if ($isDirty) { $external.dirty += 1 }
    if ($isLocked) { $external.locked += 1 }
    Add-Entry $buckets (New-Entry "external_report_only" $entryPath "external registered worktree; report only" $extra)
    continue
  }

  if ($isNested) {
    $nested.registered += 1
    if ($exists) { $nested.existing += 1 } else { $nested.missing += 1 }
    if ($exists -and -not $isUsable) { $nested.invalid += 1 }
    if ($isDirty) { $nested.dirty += 1 }
    if ($isLocked) { $nested.locked += 1; $nested.lockedStale += 1 }
  }

  if ($relative -eq ".") {
    Add-Entry $buckets (New-Entry "keep" $entryPath "primary worktree" $extra)
  } elseif ($isRequired) {
    Add-Entry $buckets (New-Entry "keep" $entryPath "required prod-parity worktree" $extra)
  } elseif (-not $exists) {
    Add-Entry $buckets (New-Entry "keep" $entryPath "missing registered worktree; inspect git metadata first" $extra)
  } elseif (-not $isUsable) {
    Add-Entry $buckets (New-Entry "keep" $entryPath "invalid registered worktree; inspect git metadata first" $extra)
  } elseif ($isDirty) {
    Add-Entry $buckets (New-Entry "keep" $entryPath "dirty registered worktree" $extra)
  } elseif ($isLocked) {
    Add-Entry $buckets (New-Entry "keep" $entryPath "locked registered worktree" $extra)
  } elseif ($isNested) {
    Add-Entry $buckets (New-Entry "caution" $entryPath "clean registered worktree; explicit prune only" $extra)
  } else {
    Add-Entry $buckets (New-Entry "keep" $entryPath "registered worktree outside cleanup roots" $extra)
  }
}

$actions = [ordered]@{ safeCleanupApplied = [bool]$ApplySafe; cleanWorktreePruneApplied = [bool]$ApplyCleanWorktrees; removedSafe = @(); skippedSafe = @(); prunedWorktrees = @() }

if ($ApplySafe) {
  foreach ($entry in @($buckets.safe)) {
    $target = Assert-InRepo $entry.absolutePath
    if (Test-Path -LiteralPath $target) {
      try {
        Remove-Item -LiteralPath $target -Recurse -Force
        $actions.removedSafe += $entry.path
      } catch {
        $actions.skippedSafe += [pscustomobject]@{
          path = $entry.path
          reason = "cleanup failed; preserving generated path"
          error = $_.Exception.Message
        }
      }
    }
  }
}

if ($ApplyCleanWorktrees) {
  foreach ($entry in @($buckets.caution)) {
    $target = Assert-InRepo $entry.absolutePath
    if (Test-Path -LiteralPath $target) {
      & git worktree remove --force $target | Out-Null
      $actions.prunedWorktrees += $entry.path
    }
  }
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  summary = [ordered]@{
    safe = [ordered]@{ entries = $buckets.safe.Count }
    caution = [ordered]@{ entries = $buckets.caution.Count }
    keep = [ordered]@{ entries = $buckets.keep.Count }
  }
  stats = $stats
  nestedSummary = $nested
  externalSummary = $external
  buckets = $buckets
  actions = $actions
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
[pscustomobject]$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outPath -Encoding utf8
[pscustomobject]$report | Select-Object generatedAt, repo, summary, stats, nestedSummary, externalSummary, actions | ConvertTo-Json -Depth 8
