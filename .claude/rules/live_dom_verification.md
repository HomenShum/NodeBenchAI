# Live-DOM Verification

**Never claim "deployed", "live", "shipped", or "the site now shows X" on the
basis of local build success, `git push` output, CLI exit codes, CI-green, or
`npx convex codegen` clean alone.** Before saying any of those words, fetch
the live production URL and grep the response for a concrete content signal.

## Why this rule exists

Three silent failure modes make "green build = live" a false promise:

1. **Silently-disconnected deploy webhooks** — the CI log says "deployed" but
   the production CDN never received the new build.
   **STATUS (2026-04-27):** mitigated. Integration was re-wired
   (`vercel git disconnect && vercel git connect` cleared a stale
   `sourceless: true` flag). Belt-and-suspenders backup workflow
   `.github/workflows/vercel-deploy-hook-backup.yml` curls a Deploy Hook
   URL on every push to main; Vercel dedupes by SHA. If this drift
   recurs, run `gh secret list` and check the workflow's last run.
2. **Suspense / client-only regressions** — Next.js / Vite + React 18 SSR can
   render only a fallback skeleton; the real component is a client-only
   import that the raw HTML never contains.
3. **CDN-cached stale HTML** — the deploy succeeded but edge caches still
   serve yesterday's bytes to most users.

All three pass `tsc`, pass tests, pass `npm run build`, pass CI, and fail
in production. Even with #1 mitigated, ship-claim verification still
requires fetching the live URL — #2 and #3 are not mitigated by
infrastructure changes.

## The protocol (apply to every ship claim)

```
1. git push
2. Confirm the deploy platform registered the push:
     Vercel:   vercel ls                      → new deployment, age < 1min
     Convex:   npx convex deploy              → "Deployment updated" + URL
3. Wait for Ready / Live status AND confirm a new bundle hash —
   a successful `git push` is NOT a successful deploy. Verify by
   comparing prod's /assets/index-<hash>.js fingerprint before vs
   after. If the hash hasn't changed within 5 min, the deploy
   webhook failed silently — check the deploy dashboard.
4. Run BOTH verification tiers:
     # Tier A — raw-HTML (proves server serves the right bundle)
     npx tsx scripts/verify-live.ts           → must print "LIVE OK"
     # Tier B — hydrated DOM (proves React renders after hydration)
     npm run live-smoke                       → all tests pass
     Override URL for preview deploys:
     BASE_URL=https://preview-xyz.vercel.app npm run live-smoke
5. ONLY THEN use the words "deployed", "live", or "ships X to users".
```

## Two-tier verification — why both are required

On a pure Vite SPA (no SSR) every route serves the same `<div id="root">`
shell in raw HTML. Route-specific content appears only after React
hydrates + Convex queries resolve. That means:

- **Tier A (scripts/verify-live.ts)** — raw-HTML fetch + grep.
  Proves: deploy webhook fired, CDN serves the right bundle, routes
  return 200 not 404. Catches landmines (a) and (c).
  Does NOT prove: routes actually render the right component.

- **Tier B (evals/e2e/live-smoke.spec.ts via `npm run live-smoke`)** —
  Playwright loads each URL in a real browser, waits for hydration,
  asserts DOM nodes exist (e.g. "Link not found" on `/share/dummy`,
  `<h1>` on landing, recovery CTAs visible).
  Proves: users actually see the right page. Catches landmine (b)
  (Suspense / client-only regressions).

Running ONLY Tier A and saying "live" is a landmine-B blind spot.
Running ONLY Tier B is acceptable but slower than Tier A for CI
loops. Run both, in that order.

If any step fails, report the EXACT failure — not a polished summary of what
you hoped happened.

## Vocabulary discipline

| State | Allowed language |
|---|---|
| Committed to local branch | "committed", "pushed to branch" |
| Tests + tsc green | "regression green", "tsc clean" |
| Convex codegen clean | "codegen clean" |
| `npm run build` clean | "build clean" |
| `vercel ls` shows Ready | "deployed to Vercel" (not "live" yet) |
| `verify-live.ts` passes | "live", "users see X", "shipped" |

Never use a higher-tier word when a lower-tier word is accurate.

## The mechanical verifier

`scripts/verify-live.ts` — the rule as runnable code. Fetches the live
production URL and asserts concrete content signals in the raw HTML.

Current signals (extend when new promises ship):
- Landing page 200
- Entity-page route loads
- `/share/{dummy}` returns a 200 page (verifies route exists, renders
  `not_found` StatusCard in raw HTML, not a white screen)
- Agent panel CTA visible in raw HTML
- 304-tool MCP count literal present (catches stale docs)

Run: `npx tsx scripts/verify-live.ts`
Prod URL defaults to `https://www.nodebenchai.com`.

## Anti-patterns

- "Deployed" on the basis of `git push` exit code 0
- "Live" on the basis of `npx convex deploy` success
- "Shipped" on the basis of CI green
- "Users can see X" without fetching the URL and grepping the HTML
- Skipping the verifier because "the diff is tiny"
- Silently ignoring a verifier failure ("it must be a cache issue")

## Related

- `.claude/rules/agentic_reliability.md` — HONEST_STATUS applies to OUR
  claims about the system, not just the system's claims about itself
- `.claude/rules/pre_release_review.md` — layer 8 (Live Browser Verify) is
  this rule in checklist form
- `.claude/rules/completion_traceability.md` — "here's what was done"
  must be honest about what actually shipped vs what was just committed
