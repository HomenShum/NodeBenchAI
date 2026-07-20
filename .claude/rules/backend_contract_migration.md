---
paths:
  - "backend/convex/**/*.ts"
  - "workers/node/**/*.ts"
  - "public/proto/*.html"
  - "apps/web/src/**/*.{ts,tsx}"
related_: [live_dom_verification, agentic_reliability, owner_mode_end_to_end, completion_traceability]
---

# Backend Contract Migration (Expand-Contract Deploy)

**Never rename, remove, or change the signature of a deployed backend
endpoint in a single PR that also flips the frontend caller.** They deploy
on different pipelines (Vercel for the static frontend, GitHub Actions →
`npx convex deploy` for Convex functions) and the gap between them is
1–3 minutes — long enough to break every caller in that window.

## Why this rule exists

On 2026-05-26 PR #382 renamed `events:askAgent → events:composeAnswer` in
backend and frontend in the same commit. After merge:

| Time | Vercel (frontend) | Convex (backend) |
|---|---|---|
| 17:14:14Z | merged, old bundle still cached | merged, deploy started |
| 17:14:30Z | new bundle building | mid-deploy |
| 17:17:19Z | new bundle live: calls `composeAnswer` | redeployed: exports `composeAnswer` |

We got lucky — the deploys raced close enough that the worst-case window
(new frontend hits old backend, or vice versa) collapsed to under a
minute and our low-traffic `/ask` route saw zero affected users that we
know of. The next contract change might not be so lucky.

## The expand-contract pattern (canonical)

For any **rename**, **signature change**, or **removal** of a backend
contract, ship in **three PRs**, not one:

### Step 1 — Expand
- Add the new name / new signature **alongside the old one**.
- Old callers keep working; new callers can opt in.
- For a rename: export both names, both pointing at the same handler.
  ```ts
  // backend/convex/events.ts
  const composeAnswerHandler = mutation({ /* ... */ });
  export const composeAnswer = composeAnswerHandler;
  export const askAgent = composeAnswerHandler;  // legacy alias
  ```
- Deploy. Verify both names work in production via the live-DOM protocol.

### Step 2 — Migrate
- Switch every frontend caller to the new name.
- Deploy. Verify the live frontend exclusively uses the new name.

### Step 3 — Contract
- Remove the old name from backend exports.
- Deploy. Verify nothing breaks (the migration step proved nothing else
  was calling the old name).

**Minimum gap between steps: one full deploy cycle (≈3 min) plus one
verification round.** Don't squash these into one merge train.

## Two-step variant (acceptable when traffic is near-zero)

For early-stage features with single-digit users:

- **Step A** — expand backend: add new name as alias, keep old.
- **Step B** — flip frontend AND remove old backend name, in the same PR.

The race window still exists, but it's much narrower than a naive
single-PR rename because the old name is still valid on backend right up
until the frontend bundle propagates.

Use this only when you can absorb sub-minute outage of the renamed
endpoint. For anything with sustained traffic, do the full three-step.

## What counts as a "contract change"

| Change | Race-sensitive? | Pattern |
|---|---|---|
| Rename export | yes | expand-contract |
| Remove export | yes | expand-contract (drop the new-name step) |
| Add new export | no | ship in one PR |
| Add required arg to handler | yes | expand-contract (accept both shapes during migration) |
| Add optional arg | no | ship in one PR |
| Remove arg from handler | yes | expand-contract |
| Change return shape | yes | expand-contract (return both shapes, frontend reads either) |
| Add field to return | no | ship in one PR |

## Verification floor (per step)

After each deploy step:

1. `npx convex codegen && npx tsc --noEmit` — local consistency
2. `gh run watch <convex-deploy-run-id>` — wait for Convex deploy success
3. `curl -sSL <live-url> | grep <expected-symbol>` — verify frontend matches
4. Hit the actual endpoint and confirm it responds (`npm run live-smoke`
   when applicable)

If verification fails at any step, do not proceed to the next step.

## Contract path discipline (added 2026-05-27)

**Every Convex contract MUST specify the deployed path as `<filename>:<exportName>`, not just the export name.** Convex resolves paths by filename — putting `requestSignInLink` in `backend/convex/users.ts` deploys it at `users:requestSignInLink`, not `events:requestSignInLink`, regardless of what the contract doc says.

Case study — PR #407/#409 hotfix (2026-05-27): the Step 8 contract specified mutations as `events:requestSignInLink` / `events:verifySignInToken` / `events:listMyEvents` to match the existing scratchnode namespace. The implementing agent put them in `backend/convex/users.ts` (sensible — `events.ts` was overloaded). Deployed paths became `users:*`. Frontend and dogfood script kept calling `events:*` — silent function-not-found at runtime. Convex's HTTP API masks this as a generic "Server Error" message, hiding the mismatch from CI.

### Required contract format

```ts
// ❌ BAD — ambiguous, doesn't capture deployed path
events:requestSignInLink({ email }) → { ok }

// ✅ GOOD — deployed path is explicit
users:requestSignInLink({ email }) → { ok }
// implemented in backend/convex/users.ts as `export const requestSignInLink = mutation({...})`
```

If the contract author wants the path to be `events:*` despite the implementation living in another file, the implementing PR must add an explicit re-export:

```ts
// backend/convex/events.ts
export { requestSignInLink, verifySignInToken, listMyEvents } from "./users";
```

This is one valid mitigation (preserves contract path stability), but it should be a deliberate choice documented in the PR description, not an accident.

## Happy-path-success verification (added 2026-05-27)

**Dogfood scenarios that only test sad-path validation can pass coincidentally even when the deployed path is wrong** — because validation throws *before* dispatching to the mistargeted function. The PR #407 case study: scenarios 23/24/25 (sad paths — bogus token, malformed email, nonexistent userId) all passed live; only scenario 22 (the happy path that ACTUALLY dispatched) failed.

Required pattern: for every new mutation/query, the dogfood suite MUST include at least ONE scenario that exercises the **happy-path-success branch** (returns ok=true with expected payload shape), not just rejection scenarios.

### Verification floor extension

After the existing `tsc / convex tsc / vitest / build / dogfood` gates, add:

5. **Happy-path probe via `npx convex run`** for any new mutation. Example:
   ```bash
   npx convex run --prod <fullPath>:<funcName> '{...validArgs}'
   # Must return success (not throw, not Server Error)
   ```
   This bypasses the HTTP API's "Server Error" masking — `npx convex run` surfaces the typed ConvexError code, making path mismatches immediately diagnosable.

6. **Inventory check**: `npx convex run` with a deliberately-wrong path lists ALL deployed function names. Use this to confirm `<file>:<export>` matches what you expect after every schema/function-add PR.

## Anti-patterns

- Renaming + frontend flip + old-name removal in one PR
- Treating "tsc green" or "tests pass" as proof the deploy race is safe
- Skipping the expand step because "the deploys usually align fast enough"
- Removing the legacy alias before confirming zero callers remain
- Manually triggering Convex deploy before Vercel finishes — flips
  the race direction but doesn't close the window
- **Specifying contract paths by export name only** (e.g. `requestSignInLink`)
  without the deployed `<file>:<export>` form
- **Shipping a feature with only sad-path scenarios** — happy-path-success
  must be exercised at least once to catch path mismatches that throw post-validation

## Detection

The deploy race is invisible in CI. Detect post-hoc by:

- Watching the GitHub Actions `convex-deploy.yml` workflow on main
  (started timestamp)
- Watching Vercel's production deployment status for the same SHA
- Polling the live URL for the symbol change

When both layers agree on the new symbol, the migration step is safe.

## Related rules

- [live_dom_verification.md](live_dom_verification.md) — "deployed ≠ live"
  is the same class of mistake at a different layer
- [agentic_reliability.md](agentic_reliability.md) — HONEST_STATUS forbids
  saying "shipped" when there's a known mid-deploy mismatch window
- [owner_mode_end_to_end.md](owner_mode_end_to_end.md) — the rename was
  treated as one-layer work when it's really a cross-layer contract change
- [completion_traceability.md](completion_traceability.md) — when reporting
  a rename complete, cite which expand-contract step shipped, not just
  "the PR merged"

## Canonical reference

This rule. PR #382 (`refactor(scratchnode): rename askAgent ->
composeAnswer`) is the case study. Commit `635d74bf` for the merge,
17:14:14Z merge timestamp, 17:17:19Z alignment timestamp.
