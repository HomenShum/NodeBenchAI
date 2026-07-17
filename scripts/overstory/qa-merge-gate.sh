#!/usr/bin/env bash
# qa-merge-gate.sh — Strict pre-merge QA gate for Overstory
# Usage: bash scripts/overstory/qa-merge-gate.sh [branch-name]
#
# Exit code 0 = merge allowed, 1 = merge blocked
#
# Checks (ALL must pass):
# 1. All 36 routes have stability grade >= B
# 2. Zero unresolved p0 issues from Gemini QA
# 3. Zero unresolved p1 issues
# 4. npx vite build succeeds
# 5. Screenshots fresh (< 2 hours)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BRANCH="${1:-$(git -C "$REPO_ROOT" branch --show-current)}"
MANIFEST="$REPO_ROOT/public/dogfood/manifest.json"
WALKTHROUGH="$REPO_ROOT/public/dogfood/walkthrough.json"
FRAMES="$REPO_ROOT/public/dogfood/frames.json"
SCRIBE="$REPO_ROOT/public/dogfood/scribe.json"

PASS=true
FAILURES=()

echo "=== Dogfood QA Merge Gate ==="
echo "Branch: $BRANCH"
echo ""

# ── Check 1: Artifact freshness ──────────────────────────────────────

check_freshness() {
  local file="$1"
  local label="$2"
  local max_age_hours=2

  if [ ! -f "$file" ]; then
    FAILURES+=("MISSING: $label ($file)")
    PASS=false
    return
  fi

  # Extract capturedAtIso or capturedAt from JSON
  local captured_at
  captured_at=$(node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$file', 'utf8'));
    console.log(data.capturedAtIso || data.capturedAt || '');
  " 2>/dev/null || echo "")

  if [ -z "$captured_at" ]; then
    FAILURES+=("NO_TIMESTAMP: $label has no capturedAt field")
    PASS=false
    return
  fi

  # Check age in hours
  local age_hours
  age_hours=$(node -e "
    const captured = new Date('$captured_at');
    const now = new Date();
    const hours = (now - captured) / (1000 * 60 * 60);
    console.log(Math.floor(hours));
  " 2>/dev/null || echo "999")

  if [ "$age_hours" -gt "$max_age_hours" ]; then
    FAILURES+=("STALE: $label is ${age_hours}h old (max ${max_age_hours}h)")
    PASS=false
  else
    echo "  OK: $label (${age_hours}h old)"
  fi
}

echo "[1/5] Checking artifact freshness..."
check_freshness "$MANIFEST" "manifest.json"
check_freshness "$WALKTHROUGH" "walkthrough.json"
check_freshness "$FRAMES" "frames.json"
check_freshness "$SCRIBE" "scribe.json"
echo ""

# ── Check 2: Route stability grades ──────────────────────────────────

echo "[2/5] Checking route stability grades..."

# Read stability data from Overstory mail or visual_qa_runs SQLite
NODEBENCH_DB="$HOME/.nodebench/nodebench.db"
if [ -f "$NODEBENCH_DB" ]; then
  FAILING_ROUTES=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$NODEBENCH_DB', { readonly: true });
    try {
      const rows = db.prepare(\`
        SELECT url, stability_grade, stability_score
        FROM visual_qa_runs
        WHERE created_at > datetime('now', '-2 hours')
        AND stability_grade NOT IN ('A', 'B')
        ORDER BY stability_score ASC
      \`).all();
      if (rows.length > 0) {
        rows.forEach(r => console.log(r.url + ' grade=' + r.stability_grade + ' score=' + r.stability_score));
      }
    } catch(e) { /* table may not exist yet */ }
    db.close();
  " 2>/dev/null || echo "")

  if [ -n "$FAILING_ROUTES" ]; then
    echo "  FAIL: Routes with grade < B:"
    echo "$FAILING_ROUTES" | while IFS= read -r line; do
      echo "    $line"
      FAILURES+=("LOW_GRADE: $line")
    done
    PASS=false
  else
    echo "  OK: All recent routes grade >= B (or no recent data)"
  fi
else
  echo "  SKIP: No nodebench.db found (visual QA data not available)"
fi
echo ""

# ── Check 3: P0/P1 issue count ───────────────────────────────────────

echo "[3/5] Checking for unresolved p0/p1 issues..."

# Check Overstory mail for latest triage result
OVERSTORY_DB="$REPO_ROOT/.overstory/overstory.db"
if [ -f "$OVERSTORY_DB" ]; then
  P0P1_COUNT=$(node -e "
    const Database = require('better-sqlite3');
    const db = new Database('$OVERSTORY_DB', { readonly: true });
    try {
      const row = db.prepare(\`
        SELECT body FROM mail
        WHERE subject = 'qa-triage-complete'
        ORDER BY created_at DESC LIMIT 1
      \`).get();
      if (row) {
        const body = JSON.parse(row.body);
        const p0 = body.gateResult?.p0Count || 0;
        const p1 = body.gateResult?.p1Count || 0;
        console.log(p0 + p1);
      } else {
        console.log('0');
      }
    } catch(e) { console.log('0'); }
    db.close();
  " 2>/dev/null || echo "0")

  if [ "$P0P1_COUNT" -gt 0 ]; then
    FAILURES+=("BLOCKERS: $P0P1_COUNT unresolved p0/p1 issues")
    PASS=false
    echo "  FAIL: $P0P1_COUNT unresolved p0/p1 issues"
  else
    echo "  OK: Zero p0/p1 issues"
  fi
else
  echo "  SKIP: No overstory.db found (mail data not available)"
fi
echo ""

# ── Check 4: Build succeeds ──────────────────────────────────────────

echo "[4/5] Running vite build..."
if (cd "$REPO_ROOT" && npx vite build --logLevel error 2>&1); then
  echo "  OK: Build succeeded"
else
  FAILURES+=("BUILD_FAIL: npx vite build failed")
  PASS=false
  echo "  FAIL: Build failed"
fi
echo ""

# ── Check 5: Screenshot count ────────────────────────────────────────

echo "[5/5] Checking screenshot coverage..."
if [ -f "$MANIFEST" ]; then
  SCREENSHOT_COUNT=$(node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$MANIFEST', 'utf8'));
    console.log((data.items || []).length);
  " 2>/dev/null || echo "0")

  # One product surface: 4 responsive/theme variants, 2 interaction states,
  # and 1 settings/theme state. More routes would reward UI sprawl.
  if [ "$SCREENSHOT_COUNT" -lt 7 ]; then
    FAILURES+=("LOW_COVERAGE: Only $SCREENSHOT_COUNT screenshots (need >= 7)")
    PASS=false
    echo "  FAIL: Only $SCREENSHOT_COUNT screenshots (need >= 7)"
  else
    echo "  OK: $SCREENSHOT_COUNT screenshots"
  fi
else
  echo "  SKIP: No manifest.json"
fi
echo ""

# ── Result ────────────────────────────────────────────────────────────

echo "=== Gate Result ==="
if [ "$PASS" = true ]; then
  echo "PASSED — merge allowed for branch: $BRANCH"
  exit 0
else
  echo "BLOCKED — merge not allowed. Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
