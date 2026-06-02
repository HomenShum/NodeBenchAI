# Self-Improvement Loop — Operating Manual

The agent brain for NodeBench's continuous improvement flywheel. Read this on every loop cycle
(manual or scheduled). The deterministic substrate is `scripts/improvement-loop/`; this rule is
how the agent drives it. Canonical design: `docs/architecture/SELF_IMPROVEMENT_LOOP.md`.

## When to activate
- A scheduled "improvement-loop" routine fires.
- User says "run the loop", "improve forever", "self-drive", "find opportunities".
- After any ScratchNode/NodeBench surface change, as a follow-up scan.

## The cycle (do all of it, then schedule the next)

### 1. OBSERVE + SCORE
```bash
node scripts/improvement-loop/run-cycle.mjs --effort-budget 3
```
This runs `scan.mjs`, writes `backlog.latest.json`, selects the top auto-safe opportunity, and
appends a cycle to `ledger.json`.

### 2. VALIDATE the candidate (mandatory — analyst_diagnostic)
**Never act on a scanner hit blindly.** Open the cited `file:line`, read the surrounding context,
and confirm it is a REAL opportunity, not a false positive. If it is a false positive:
- Do NOT ship a fix.
- Harden the detector in `scan.mjs` so it stops mis-flagging (the loop improving its own precision).
- Re-run the scan. Record the rejection honestly in the cycle note (HONEST_SCORES — no theater).

### 3. SAFETY gate (hard stop)
If the change would touch any of these, it is **human-gated** — queue it, do NOT auto-ship:
- The ScratchNode honesty contract: live send/render path, `seenIds`/`seenAnswerIds` dedup,
  no-mock-on-config-fail, no-local-row-on-send-fail (see `scratchnode-live-route-honesty.spec.ts`).
- Any data deletion, schema migration with existing data, auth, billing, or irreversible action.
- Anything you cannot verify locally before shipping.

### 4. IMPLEMENT
- Fresh branch off `origin/main` (`git checkout -b chore/loop-<slug> origin/main`). Use a Conventional-Commits type prefix (feat/fix/chore/docs) so the repo branch-name CI check passes — never `loop/...`.
- Smallest change that makes the failure mode impossible, not just hidden.
- Match surrounding code style. Reduced-motion guard on any new animation.

### 5. VERIFY (must be green — never ship red)
- `node -e` syntax check for inline-script files; `npx tsc --noEmit` for TS.
- Targeted tests + e2e: at minimum `home-v5-output-contract` + `scratchnode-live-route-honesty`
  for ScratchNode changes.
- UI changes: Playwright dogfood (desktop + mobile 375px), reduced-motion suppression, no overflow.
- If any check is red → revert, record `outcome:'reverted'` with the failure, do NOT ship.

### 6. SHIP (CI-gated — autonomy with a floor)
- Per-surface CHANGELOG lane entry (`CHANGELOG/pages/<surface>.md`).
- `gh pr create` → `gh pr merge <N> --auto --squash --delete-branch`. The required CI checks
  (Typecheck, Runtime smoke, Build) gate the deploy — autonomous, never unverified.
- After deploy: live-DOM verify (`scripts/verify-live.ts` or `curl <live-url> | grep <signal>`)
  before claiming "live". Record the live signal in the cycle.

### 7. RECORD + LOOP
- The cycle is in `ledger.json`. Update its `outcome` (shipped / reverted) and add the live signal.
- Schedule the next cycle (cron routine) or, if interactive, continue immediately.

## Kill criteria (stop / change strategy)
- 3 consecutive `clean_no_auto_opportunities` cycles → **expand**: add detectors to `scan.mjs`
  or add a surface to `SURFACES`. The substrate emits a `STRATEGY-SHIFT` signal automatically.
- Any verification failure → revert, record, never ship.
- Never inflate scores or invent opportunities to "have something to ship" (the worst anti-pattern).

## Anti-patterns
- Shipping a fix for a false-positive scanner hit (validate first).
- Auto-shipping a human-gated change.
- Claiming "live" on a green build (live-DOM verify first — `live_dom_verification.md`).
- Building a parallel loop instead of extending `scripts/improvement-loop/` + the existing dogfood/eval scripts.

## Related rules
- `flywheel_continuous` · `self_building_loop` · `eval_flywheel` · `analyst_diagnostic`
- `agentic_reliability` (HONEST_SCORES, BOUND) · `live_dom_verification` · `completion_traceability`
- `backend_contract_migration` (additive-vs-race-sensitive) · `scenario_testing`
