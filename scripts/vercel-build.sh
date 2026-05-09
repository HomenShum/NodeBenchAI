#!/usr/bin/env bash
# Vercel build entry — invoked from vercel.json `buildCommand`.
#
# Why this script exists:
#   The previous inline `buildCommand` in vercel.json grew past Vercel's
#   256-char API limit, which made every deploy fail at config validation
#   (no build logs produced — Vercel rejects the config before invoking
#   any build steps).  Extracting to a script keeps `vercel.json` short
#   and makes the build logic editable + reviewable.
#
# Behavior (RECOUPLED — Convex deploy now runs HERE, before vite build):
#   Forensic root cause (2026-05-09): the previous DECOUPLED design
#   relied on .github/workflows/convex-deploy.yml firing on push to
#   main with paths "convex/**". From 2026-05-04 onwards GitHub
#   Actions stopped firing entirely on this repo (account-blocked
#   for billing). PRs #283-#286 (P0 sprint touching convex/domains/
#   research/editionQueries.ts) merged to main but the convex deploy
#   workflow never ran — so getDailyEdition / getWeeklyDigest /
#   getMonthlyRetrospective shipped to the frontend bundle but were
#   missing from convex prod. Every temporal URL crashed to the
#   error boundary with "[CONVEX Q(...)] Server Error" until a manual
#   `npx convex deploy` was run.
#
#   The lesson: Vercel's webhook is more reliable than GHA workflows.
#   We MUST run convex deploy in the Vercel build pipeline so that
#   backend + frontend ship atomically, regardless of GHA state.
#
#   Why convex deploy MUST run BEFORE vite build:
#     Frontend code calls Convex queries by name. If the frontend
#     ships first and the queries don't exist yet on the backend,
#     users see Server Error. By running convex deploy first:
#       1. New queries are live on Convex prod.
#       2. THEN the frontend bundle that calls them ships.
#       3. Atomic enough — Vercel CDN serves the new bundle within
#          seconds of build completion, by which time Convex has
#          had its full deploy duration.
#
#   Convex deploy failure mode:
#     If `npx convex deploy` fails (missing dep, schema validation,
#     etc.), the script EXITS NON-ZERO. Vercel deploy aborts. No
#     stale frontend ships. This is correct — we'd rather block the
#     deploy than ship a broken frontend. The previous "fail open"
#     design (let Convex errors silently skip the deploy) was the
#     ROOT CAUSE of the temporal-URL outage.
#
#   The .github/workflows/convex-deploy.yml is kept as a secondary
#   belt-and-suspenders safety net: if Vercel-side deploy somehow
#   misses a path (e.g. preview deploy doesn't deploy convex), the
#   GHA still runs convex deploy on push-to-main when Actions is
#   functioning. Convex deploy is idempotent so running both is safe.

set -euo pipefail

if [ -z "${VITE_CONVEX_URL:-}" ]; then
  echo "::warning::VITE_CONVEX_URL not set — frontend will use baked-in default."
fi

# Step 1: deploy Convex backend so new queries/mutations are live BEFORE the
# frontend that calls them ships. Only on production deploys; previews skip.
# Vercel sets VERCEL_ENV=production for prod, =preview for preview branches.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
    echo "::error::CONVEX_DEPLOY_KEY not set on Vercel env. Add it in Vercel project settings -> Environment Variables. Without this, frontend bundles ship before backend queries exist on Convex prod, causing Server Error on every page load."
    exit 1
  fi
  echo "Convex deploy (production) starting..."
  npx convex deploy --yes --typecheck=enable
  echo "Convex deploy complete."
else
  echo "Skipping convex deploy on preview env (VERCEL_ENV=${VERCEL_ENV:-unknown})"
fi

# Step 2: build the frontend bundle now that backend is live.
exec npm run build
