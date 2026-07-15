#!/bin/bash
# Vercel "Ignored Build Step" — exits 0 to SKIP build, exits 1 to BUILD.
# Goal: cut Vercel deploy count from 200+/day to ~20/day by skipping
# commits that don't change anything Vercel actually serves.
#
# Belongs in vercel.json under "ignoreCommand". Vercel runs this in the
# build container with VERCEL_GIT_COMMIT_REF and similar env vars set.
#
# Triggered against EVERY commit Vercel considers building (preview + prod).

set -euo pipefail

# Always build production (main). Safety: never accidentally skip prod.
if [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  echo "Build: main branch (always deploy)"
  exit 1
fi

# Skip dependabot — already gated in vercel.json git.deploymentEnabled,
# but belt-and-suspenders in case a manual cherry-pick lands on a
# dependabot/* branch.
case "${VERCEL_GIT_COMMIT_REF:-}" in
  dependabot/*)
    echo "Skip: dependabot branch — preview disabled"
    exit 0
    ;;
esac

# For everything else, skip the build if the commit only touches
# paths that don't affect what Vercel serves.
#
# What Vercel serves:
#   /src, /convex, /packages, /apps, /public, /server, /shared, /api,
#   /scripts/vercel-build.sh, vercel.json, package.json, package-lock.json,
#   tsconfig*.json, vite.config.*, *.html
#
# What Vercel does NOT serve (safe to skip):
#   .claude/, .cursor/, .windsurf/, .augment/, .serena/, .overstory/,
#   .storybook/, .agents/, .agent-browser-profiles/, docs/, plans/,
#   distribution/, screenshots/, e2e-screenshots/, .tmp-*, tests/,
#   *.md (top-level except CHANGELOG.md), .github/ (workflows still run via Actions)
#
# Strategy: list "build-relevant" paths. If the cumulative diff since the
# branch's last successful deployment touches NONE of them, skip.

BUILD_RELEVANT=(
  "src" "convex" "packages" "apps" "public" "server" "shared" "api"
  "scripts/vercel-build.sh" "vercel.json"
  "package.json" "package-lock.json"
  "tsconfig.json" "tsconfig.node.json"
  "vite.config.ts" "vite.config.mjs"
  "index.html"
)

# VERCEL_GIT_PREVIOUS_SHA is the last successful deployment for this project
# and branch. Comparing only HEAD~1 is unsafe for multi-commit PRs: a docs- or
# workflow-only follow-up can otherwise cancel the exact-head preview even
# when an earlier, not-yet-deployed commit changed served code.
DIFF_BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$DIFF_BASE" ] || [[ "$DIFF_BASE" =~ ^0+$ ]]; then
  echo "Build: no previous successful branch deployment to compare"
  exit 1
fi

if ! git cat-file -e "${DIFF_BASE}^{commit}" 2>/dev/null; then
  echo "Build: previous deployment SHA is unavailable in the shallow clone"
  exit 1
fi

if ! CHANGED=$(git diff --name-only "$DIFF_BASE" HEAD); then
  echo "Build: unable to compute the cumulative deployment diff"
  exit 1
fi
if [ -z "$CHANGED" ]; then
  echo "Skip: no files changed (empty diff)"
  exit 0
fi

# Check if any changed file matches a build-relevant path.
for path in "${BUILD_RELEVANT[@]}"; do
  if echo "$CHANGED" | grep -qE "(^|/)${path}(/|$)"; then
    echo "Build: changed files touch ${path}"
    exit 1
  fi
done

echo "Skip: no build-relevant files changed"
echo "Changed files:"
echo "$CHANGED" | head -20
exit 0
