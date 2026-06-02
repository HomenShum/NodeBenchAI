# Goal: Loop honesty — record liveSignal + stop pointing --push-convex at a phantom function

Two gaps in the self-improvement loop's own integrity: (1) cycle C002 records `outcome:'shipped'`
with no `liveSignal`, despite the manual requiring a live-DOM signal after `verify-live.ts`;
(2) `run-cycle.mjs:72` calls `convex run improvementLoop:recordCycle`, but that function only exists
in `convex-improvementLoop.ts.pending` (never deployed) → `--push-convex` degrades to a 404 path.

- **status:** proposed
- **surface:** nodebench (meta-loop / runtime)
- **severity:** P1 (HONEST_STATUS / live_dom_verification — the ledger must not claim "shipped" without proof)

## Scope
- **Allowed:** `scripts/improvement-loop/run-cycle.mjs` (capture `liveSignal`; require it before `outcome:'shipped'`; make `pushConvex` honest when the endpoint is absent); `scripts/improvement-loop/ledger.json` (add `liveSignal` field; backfill C001-C004 honestly — `null` where not actually verified, never fabricated); `convex/improvementLoop.ts` + `convex/schema.ts` **only if** graduating the `.pending` Convex table; `convex-improvementLoop.ts.pending`
- **Forbidden:** `public/proto/home-v5.html`; any ScratchNode honesty-contract test or live send/render path; any new surface
- **Core-loop flow:** the meta-loop that ships fixes TO the core loop — honest ledger + working observability keep it trustworthy
- **Invariant that must NOT break:** never claim `shipped` without a recorded `liveSignal` (or explicit honest `liveVerified:false` + reason); `pushConvex` must never fake success — if Convex absent, record `{ok:false, reason:'endpoint-not-deployed'}`; run-cycle.mjs stays observe/score/record only (never edits product code)

## Definition of done
- [ ] Cycle records carry `liveSignal`; `run-cycle.mjs` refuses (or warns + records `liveVerified:false`) on `outcome:'shipped'` without a live signal.
- [ ] C001-C004 backfilled honestly (null where no verification was actually run — no invented signals).
- [ ] Either `convex/improvementLoop.ts` + `improvementLoopCycles` table exist and `--push-convex` records a cycle (verifiable in Convex dashboard) **OR** `pushConvex` cleanly reports `endpoint-not-deployed` (no phantom call). NB: the original Convex graduation was deferred because `convex codegen` couldn't be validated locally (`@mistralai` dep error) — re-attempt in CI or keep the honest no-op.
- [ ] `node -e` syntax check passes; if Convex graduated, `npx convex codegen` clean.

## Constraints
- No new surface/route. HONEST_STATUS/HONEST_SCORES: no faked signals, no fabricated backfill.
- Do NOT add the redundant "SELECT never checks safety" control — that gate already exists (`run-cycle.mjs` filters `!o.queued`; `scan.mjs` sets `queued = safety==='human'`).
