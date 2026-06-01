param(
  [switch]$DetailedCounts,
  [string]$Out = ".tmp/workspace-footprint.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path ".").Path

function New-Set([string[]]$Values) {
  $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($value in $Values) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [void]$set.Add(($value -replace "\\", "/"))
    }
  }
  Write-Output -NoEnumerate $set
}

$deleted = New-Set @(& git -c core.quotePath=false ls-files --deleted)
$trackedFiles = @(& git -c core.quotePath=false ls-files | Where-Object { -not $deleted.Contains(($_ -replace "\\", "/")) })

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repo = $repoRoot
  trackedFiles = $trackedFiles.Count
  detailedCounts = [bool]$DetailedCounts
}

if ($DetailedCounts) {
  $dirs = @(".git", "node_modules", ".worktrees", ".claude", ".overstory", ".serena", ".tmp", "public", "convex", "src", "scripts")
  $counts = [ordered]@{}
  foreach ($dir in $dirs) {
    if (Test-Path -LiteralPath $dir) {
      $counts[$dir] = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -File -ErrorAction SilentlyContinue).Count
    }
  }
  $report["directoryFileCounts"] = $counts
}

$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Path (Split-Path -Parent $outPath) -Force | Out-Null
[pscustomobject]$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outPath -Encoding utf8
[pscustomobject]$report | ConvertTo-Json -Depth 8
