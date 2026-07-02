# Proof-looping failure signals & the guaranteed gate

> Why this exists: the whole point of proof-looping is "no `done` without proof." But the *agent
> running* proof-looping makes a predictable class of mistakes — it calls something done from a
> **proxy signal** instead of **ground truth**. These are real, observed failures. This doc names them
> and defines the gate that catches them, so the guarantee is structural, not a promise.

## The failure signal (one root cause, many faces)

**A conclusion was stated from a proxy that *resembled* proof but wasn't.** Observed instances:

| # | Claim made | Proxy that fooled it | Ground truth it should have checked |
|---|---|---|---|
| 1 | interactive task "responded / passed" (twice) | a completion affordance + keyword match — but they belonged to the page's **seeded demo conversation**, not the answer | the output must **content-match the actual task** (mention the query subject) **and** an independent judge must agree |
| 2 | "authenticated" | the composer was **visible** | a real session token exists, or the gated action actually succeeds |
| 3 | "20/20 pass" (headline) | a single run before the false-pass was caught | the honest aggregate **after** the independent check; re-run for flakiness |
| 4 | "that file/feature probably doesn't exist" | skepticism / a third party's claim | `grep`/read the real repo before asserting absence |
| 5 | "the benchmark ran" | an **ad-hoc query** treated as the test | a benchmark was actually **picked** to match the deliverable shape, with per-task acceptance criteria |
| 6 | "you have to do it / it's gated" | gave up at the first wall | the autonomous path (real browser, local env, anonymous/password, reading config) was **tried first** |
| 7 | "root cause is the missing secret" | a hypothesis from priors | the **actual error/log line** was read before proposing a fix (the real cause was a `SITE_URL` mismatch) |

The unifying tell: **the proxy feels like proof.** A green heuristic, a rendered composer, a plausible hypothesis, "looks done." In an agent loop a false PASS becomes a false belief downstream — the most expensive bug class.

## The guaranteed gate — PROVE-BEFORE-CLAIM

Before emitting any of these words — **done · passed · works · fixed · shipped · blocked · gated · "doesn't exist" · "can't" · "root cause is"** — the gate runs:

1. **Name the artifact that proves it, and check THAT, not a proxy.**
   - `pass` → the output **content-matches the specific goal** (not an affordance, keyword, or template echo).
   - `authed`/`works` → the real token/state exists, or the gated action **actually completes**.
   - `absent`/`can't` → you `grep`/read/**tried** the real thing first.
   - `root cause` → you read the **actual error/log line**; the fix maps to that line.
   - `done`/`shipped` → a **live** signal (rendered DOM / real output), not build-green or exit-0; re-run for flakiness.
2. **Independent confirmation for anything that "looks done."** A deterministic check that *can* match template/demo content is insufficient on its own — pair it with an independent judge (visual / fresh-context) **or** a content-match to the specific goal. They must agree.
3. **A gate is not real until the autonomous path is exhausted.** Try the real route before declaring a human gate. Only a genuine credential, an irreversible/outward action, or genuinely-ambiguous direction is a true stop.

## How proof-looping enforces it programmatically (not just a checklist)

- **Content-match, not affordance.** The interactive task scorer requires the response to mention the query subject; an affordance/keyword alone cannot pass (`surface-bench.mjs`, the `responded` rule).
- **Independent judge can veto.** The visual judge's "blocked / auth-required" verdict overrides a deterministic PASS (this is what caught failure #1 twice).
- **Honest status + live-DOM.** A server-gated/failed step is a FAIL with its reason; "shipped" requires a rendered-DOM signal.
- **CI is the backstop.** The gate runs in CI/branch-protection so a forgotten check still fails the merge — the guarantee does not depend on the agent remembering.

See [`.claude/skills/proof-looping/SKILL.md`](../.claude/skills/proof-looping/SKILL.md) (non-negotiables) and [`PROOFLOOPING.md`](PROOFLOOPING.md).
