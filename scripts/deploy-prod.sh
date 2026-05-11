#!/usr/bin/env bash
# deploy-prod.sh — canonical Vercel CLI deploy wrapper for nodebenchai.com
#
# Why this exists:
#   `vercel build --prod` is build-time-inlined for Vite — it embeds
#   `import.meta.env.VITE_*` literally into the bundle.  If the env
#   isn't pulled BEFORE the build, the deployed bundle ships with
#   `VITE_CONVEX_URL === undefined` and renders "Convex backend not
#   configured" in production.
#
#   This wrapper makes the env-pull step impossible to skip.
#
# Order matters:
#   1. `vercel env pull` — writes .env.production.local from Vercel.
#   2. `vercel build --prod` — Vite reads .env.production.local and
#      inlines VITE_* values into the bundle.
#   3. `vercel deploy --prebuilt --prod` — ships the prebuilt artifact
#      without re-running build (and without dragging the Windows
#      package-lock that breaks `sharp` linux-x64).
#
# Forensic note: this caused a P0 regression on 2026-05-11 — see
# CLAUDE.md "Vite env vars are build-time-inlined".  See
# `.claude/rules/live_dom_verification.md` — `git push` exit code 0 is
# NOT a successful deploy; verify with `scripts/verify-live.ts` after.

set -euo pipefail

echo "==> Pulling Vercel prod env into .env.production.local"
vercel env pull .env.production.local --environment=production

echo "==> Building with prod env (Vite inlines VITE_*)"
vercel build --prod

echo "==> Deploying prebuilt artifact to production"
vercel deploy --prebuilt --prod

echo "==> Done.  Run scripts/verify-live.ts to confirm the live HTML."
