# Oracle Loop

Canonical source: `docs/architecture/oracle/LOOP.md`

This root copy exists so Oracle prompt packs and repo-level checks can resolve the shared operating loop from the workspace root.

## Operating Rule

There is no one-shot delivery mode for Oracle work. In other words: no one-shot. The agent must work in small, observable loops that can be verified against the original implementation idea.

## Required Loop

1. Read `ORACLE_VISION.md`, `ORACLE_STATE.md`, and the existing task/session context.
2. Restate the smallest viable slice before changing code.
3. Implement only that slice.
4. Run verification before expanding scope.
5. Run a reality check before claiming success.
6. Dogfood the changed surface.
7. Compare the result to the original vision and record drift in plain English.
8. Update `ORACLE_STATE.md` with completed work, remaining issues, and the next quest.

## Required Reality Check

- Do not accept "looks correct" as evidence. Prove the important invariants.
- Write down the critical invariants for the slice: correctness, latency, cost, safety, idempotency, determinism, or data integrity.
- Measure at least one real non-LLM signal for the changed path when performance or scale is part of the claim.
- Record what could still be wrong, especially the hot path or bottleneck the model may have missed.
- If the same model wrote the code, do not treat its self-review as sufficient validation.
- If claiming parity or superiority to an industry tool, compare against a concrete external baseline instead of asserting it.

## Required Verification Floor

- `npx tsc -p convex --noEmit --pretty false`
- `npx tsc -p . --noEmit --pretty false`
- `npm run build`
- `npm run test:run`
- `npm run dogfood:verify`

## Additional Evidence When Applicable

- API or retrieval changes: capture route tests plus a concrete response example or dogfood trace.
- Performance-sensitive changes: measure latency, throughput, cost, or bundle impact with a script, benchmark, or before/after sample.
- Data-model or temporal changes: prove timestamps, causation links, and source hashes survive the loop.
- Competitive claims: state the exact baseline and the dimension being compared.

## Behavioral Constraints

- Prefer small slices over broad rewrites.
- Reuse existing telemetry, progressive-disclosure, and dogfood primitives before inventing new ones.
- Do not claim alignment without citing the source docs or implementation evidence.
- Do not use LLM praise, architecture compliments, or self-generated review as the main proof of quality.
- Surface tradeoffs early if a safe-looking abstraction risks blowing up latency, memory, or operator trust.
- If the work drifts, say why, fix it, and rerun the loop.

## Output Contract

Every loop should leave behind:

- a tested code change
- a dogfood or artifact check result
- a reality-check note covering the key invariant and the main remaining risk
- a short alignment status: `aligned`, `drifting`, or `violated`
- a concise `deltaFromVision` note in plain English
