# Surface Contract Spec v1 (`nodebench-surface-contract-v1`)

One-page spec for executable UI contracts: an app publishes machine-readable
surface declarations, and a generic verifier enforces that the rendered UI
never drifts from them. Written to be portable — nothing below is specific to
NodeBench, and a second implementation (NodeVideo) is converging on the same
shape. Reference implementation: `surfaces/*.contract.json` +
`tests/e2e/ui-contract-runner.spec.ts` (DOM layers) +
`convex/domains/redesign/chatRuns.contract.test.ts` (state-schema layer).

## The three layers

| Layer | Claim | Checked by |
|---|---|---|
| L1 drivable | a disciplined accessibility tree exists | ARIA tooling, agents |
| L2 declared | anchors, geometry, theme wiring, forced states | generic DOM runner, per PR |
| L3 verifiable meaning | per-state content schemas (fields that MUST/NEVER appear) | executor driving the real runtime functions |

## Schema (per surface, one JSON file)

- `schema` — version const, e.g. `nodebench-surface-contract-v1`. Any breaking
  field change bumps it; consumers reject unknown majors.
- `surface`, `route`, `description`
- `theme` — `{ storageKey, attribute, values }`. The runner and the app MUST
  read the same key; this clause exists because a key drift shipped weeks of
  mislabeled dark-mode evidence.
- `viewports` — named `{ width, height }` matrices.
- `anchors[]` — `{ why, testId | selector | role+name, presence?, count? }`.
  Prefer `role`+accessible-name (the contract is a curated view of the ARIA
  tree any agent already speaks); `testId` for machine anchors; raw `selector`
  last.
- `geometry[]` — `{ why, selector, viewport, gridTracks?, minWidthPx? }`
  asserted against COMPUTED style. Overflow booleans and CSS-source string
  matching both miss real collapses; computed geometry does not.
- `states[]` — `{ name, why, url, expectText, forbidText? }`. Every state must
  be deep-link forcible; state copy must agree with reality (a title may not
  claim success while the body admits failure).
- `answerPacket` (L3) — `{ states: [{ shape, prompt, rawText?, supported,
  unsupported }] }` where each expectation block supports: `require[]`,
  `forbid[]`, `requirePatterns{}`, `forbidPatterns{}`, `maxWords`, `lineCount`,
  `parsesAs`, `riskRowPattern`. Executed through the REAL production functions,
  never reimplementations. `forbid` is load-bearing when compact rendering is
  driven by field emptiness.
- Every clause carries `why` — a contract line without a reason rots into
  cargo cult.

## Verifier contract

1. Generic: one runner executes EVERY manifest; adding a surface adds no code.
2. Runs per-PR in CI against a real preview; failure blocks merge.
3. Accepts a base URL so any independent party can replay the full contract
   against production. Self-attestation (the app's own CI) is the floor, not
   the ceiling — held-out replay is the trust story.
4. Proven non-vacuous: flipping any clause to a wrong value must fail the
   matching tests. Record the reversion proof in the PR.

## Served projection (agent-facing, optional)

A build step MAY project contracts into a public affordance manifest (e.g.
`/.well-known/agent-ui.json`): surfaces, routes, anchors, actions — never
internal QA clauses. Requirements:

- Generated from the repo contracts, never hand-edited (one source of truth).
- **Fail-closed hash binding**: embed the build's commit SHA + emitted bundle
  fingerprint + `generatedAt`, and instruct consumers to cross-check the
  fingerprint against the actually-served bundle and DISTRUST the manifest on
  mismatch. A stale contract describing a newer UI is a confident lie to every
  visiting agent — worse than no contract.

## What stays outside contracts

Aesthetic judgment ("does it look designed") is permanently a vision/taste
call. Contracts absorb everything objectively checkable so vision QA spends
its variance only where it is irreplaceable.

## Prior art

Repo's own `UI_CONTRACT.md` evidence protocol and `designSystem.ts`
manifest+audit pattern · WAI-ARIA roles/accessible names · agents.md and MCP
progressive discovery (machine-readable affordances) · Storybook play
functions · `/.well-known` precedents (`robots.txt`, `ai-plugin.json`).
