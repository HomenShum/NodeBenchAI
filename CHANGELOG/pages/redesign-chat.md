# Redesign Chat

Append-only lane for the public redesign chat, reproducible answer receipts, and their
transition into an authenticated live conversation. Newest entries first.

## 2026-07-17 - Design nitpick pass over the 4-variant dogfood captures

Pixel review of every capture (desktop/mobile x dark/light + interactions) after the
recent workspace changes. Six findings, five fixed, one accepted:

- **Dishonest dark evidence (P1)**: the capture spec's `setTheme` wrote only legacy
  cockpit keys; `RedesignShell` reads `nodebench:redesign:theme`, so every "dark"
  screenshot since #561 was a light render mislabeled dark. Spec now writes the
  shell's key - pass-2 captures are the first honest dark evidence.
- **Contradictory state copy (P2)**: the context-miss banner titled itself
  "Notebook context selected" while the body said the context was unavailable.
  Title now tracks the miss.
- **Mobile truncation of load-bearing data (P2)**: the status row repeated the
  context title the chip below already carries, pushing "12 attached sources"
  into ellipsis at 390px. Row now leads with the count.
- **Emoji chips (P2)**: starter chips used platform emoji against an all-SVG
  surface; replaced with a shared STARTER_ICONS stroke-SVG set.
- **Floating meta text (P3)**: `flex: 1 + max-width: 36ch` reserved a title-sized
  column in the run-scope summary, leaving "Review · no shared writes" mid-air on
  desktop once the title moved. Content-sized with shrink+ellipsis kept.
- **Accepted**: first-chip two-line wrap is content-driven (dated title), not a
  layout defect.

Pass 3 re-capture: zero new findings; loop converged.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: `pending`
- Checks: `npx tsc --noEmit` -> 0 errors. Redesign feature suite -> 92 passed.
  CSS/lifecycle/shape guards + composer suite -> 34 passed post-rebase.
- Visual proof: `test-results/full-ui-dogfood/` pass-3 captures (not committed;
  regenerate via the dogfood spec).
- Preview: Tier B one-flow-regression runs on the PR.
- Production live: `not recorded` at entry time.

**Author**: Homen Shum + Claude Fable 5.
**Touches**: ChatSurface, ChatEmptyState, agent-workspace.css, full-ui-dogfood spec.

## 2026-07-17 - Honor JSON and table response shapes end to end

The last declared shape boundary falls: "as JSON" / "in a markdown table" are now
detected, instructed, and deterministically enforced. The policy reads the RAW model
output (parseMemo is lossy for structured blocks), extracts the first balanced JSON
block (string-aware brace scan, fence-stripped, 20k-char bound) or the longest
`| ... |` line run, validates, and fails closed with an honest retry message when the
model did not comply. Honesty on unsupported runs surfaces as a risks row - a
limitation cannot ride inside JSON without corrupting it. Both renderers now show
structured bodies in a bounded monospace block (`.rd-answer-structured`) with its own
horizontal scroll, via a shared `isStructuredAnswer` so they cannot disagree.

**PR / canonical main commit**: `#573` / `e7e423fb`.

**Evidence state**:
- Source: `merged`
- Checks: `npx tsc --noEmit` -> 0 errors. `npx vitest run chatRuns.responseShape +
  ChatResponseShape.guard + ChatRunLifecycle.guard` -> 30 passed (4 new: detector
  incl. incidental-mention negatives, fenced-JSON passthrough with brace-in-string,
  invalid-JSON fail-closed + risks-row honesty, table extraction + missing-table
  fail-closed).
- Visual proof: `not recorded` at entry time - mono block verified in the design pass.
- Preview: Tier B one-flow-regression runs on the PR.
- Production live: `not recorded` at entry time.

**Author**: Homen Shum + Claude Fable 5.
**Touches**: chat runtime + both answer renderers + agent-workspace.css.

## 2026-07-17 - Resolve the four hardening residuals from the production audit

The 2026-07-16 audit cycle left four filed residuals (#567-#570); all four land here.

1. **Red tests CI could not see (#567)** - three ScratchnodeEventsSurface tests failed on
   clean main (`TypeError: reading 'product'`) because the test's api mock predated
   ImportRecapButton's `domains.product.scratchnodeImport` query, and the runtime-smoke
   allowlist never ran the file. The api mock is now a Proxy that degrades unknown
   function refs to unresolved queries, the missing `useMutation` mock is added, two
   scenarios cover the import affordance's published/unresolved gates, and the file joins
   the CI allowlist.
2. **Timer-only cancel guard (#568)** - Stop and submit are both always rendered: Stop in
   a reserved `visibility:hidden` slot, submit staying at identical coordinates while
   streaming (disabled). A double-click's second click lands on an inert control at ANY
   user double-click interval; the 400ms arming stays as defense in depth.
3. **Shape detector gap (#569)** - "in one sentence", "a single paragraph", and
   "under N words" are now detected, instructed via an exhaustive
   `responseShapeSystemInstructions` switch, and deterministically enforced (first-sentence
   extraction, prose collapse, sentence-accumulating word budget). Honesty survives
   compaction: unsupported runs carry `Source needed:` within the requested shape.
   JSON/table stay model-side deliberately - the render path is markdown prose.
4. **No computed-geometry regression capture (#570)** - one-flow-regression (Tier B,
   per-PR) gains a 390x844 test asserting `.rd-shell__main` resolves to ONE grid track and
   `main#main-content` stays >300px wide - the audit's 70px collapse was invisible to both
   the CSS-source string guard and the document-overflow boolean.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: `pending`
- Checks: `npx tsc --noEmit` -> 0 errors. Full runtime-smoke allowlist locally ->
  312 passed / 25 skipped (integration skips without env keys, matching CI). Adjacent
  guards (ChatResponseShape, ChatRunLifecycle, ChatContinuation, sourceVerificationPolicy)
  -> 12 passed.
- Visual proof: `not recorded` - behavior changes are runtime/composer mechanics.
- Preview: Tier B one-flow-regression includes the new 390px geometry test on this PR.
- Production live: `not recorded` at entry time.

**Author**: Homen Shum + Claude Fable 5.
**Touches**: [components/fast-agent-panel.md](../components/fast-agent-panel.md) is NOT
touched - the composer change is redesign-chat's UniversalComposer, not FastAgentPanel.

## 2026-07-17 - Ground "best source" superlatives on their own citation

`applyDeterministicResponsePolicy` only rewrote unsupported "best/strongest source|claim"
superlatives when the run had **zero** URL-backed evidence rows. In a mixed run - one real
URL plus several cached section labels like `Setup` or `Rising Action` - the superlative
passed through, so an answer could claim "strongest supported claim with its best source"
while the rendered best source was a label with no URL. On a paid runtime path that is a
false confidence signal, not honest degradation.

The gate is now sentence-level: a superlative stands only if its own sentence carries a
`[N]` citation resolving to a URL-backed evidence row; otherwise that sentence is rewritten
to "source or claim requiring verification" and the source-needed limitation is appended.
A superlative citing a cached label, or citing nothing, is rewritten even when a URL-backed
row exists elsewhere in the same run. The "best/strongest" pattern now lives in one shared
constant used by both the sanitizer and the gate so they cannot disagree.

This closes the residual left open by the 2026-07-16 audit follow-up (#565 fixed four of
the five P1s; this is the fifth). Tracked as #566.

**PR / canonical main commit**: `#571` / `6198dc39`.

**Evidence state**:
- Source: `merged`
- Checks: `npx tsc -p convex --noEmit --pretty false` -> 0 errors. `npx vitest run
  convex/domains/redesign/chatRuns.responseShape.test.ts` -> 16 passed (3 new: grounded
  citation kept, cached-label citation rewritten, uncited superlative rewritten). Gate
  reverted to run-level in isolation to prove the guard: the cached-label and uncited cases
  fail `expected 'acme is the strongest supported claim...' not to contain 'strongest
  supported claim'` (2 failed / 14 passed), restored -> 16 passed.
- Visual proof: `not recorded` - the answer body is runtime-produced; no rendered surface
  markup changed.
- Preview: `not recorded`
- Production live: `not recorded`

**Author**: Homen Shum + Claude Opus 4.8.
**Touches**: chat-runtime only.

## 2026-07-17 - Honor title-only requests behind any determiner

`detectRequestedResponseShape` recognized `return only the title` but not `return only
its title`: the determiner group listed articles (`a`/`the`) and no possessives, so the
possessive phrasing fell through to the five-section memo and silently overrode an
explicit user output constraint on a paid run. The determiner set now lives in one
`TITLE_DETERMINER` constant shared by every title pattern, so the patterns cannot drift
apart again. User-visible effect: a prompt ending `return only its title` now returns one
plain title line instead of a Short answer / Why it matters / Evidence / Risks / Next
action memo.

This was found by re-verifying the 2026-07-16 production audit against `main` rather than
trusting it. Four of its five P1s were already fixed by #550/#561/#564 within hours of the
run; only this one survived. The suite stayed green throughout because every title case it
asserted used the one phrasing that worked - so the regression tests here use the audit's
**verbatim** production prompts, and both new test files were added to the CI runtime-smoke
allowlist, which is an explicit file list rather than a full-suite run.

Also corrected the `UniversalComposer` header comment, which still claimed "no provider
names in UI / provider names appear only in the trace" - the opposite of the disclosure
contract shipped in #550 - and pinned `DEFAULT_TIERS` to the runtime's `modelForTier` with
a parity test, since the two were hand-maintained mirrors with no test binding them.

**PR / canonical main commit**: `#565` / `b2d12ae0`.

**Evidence state**:
- Source: `merged`
- Checks: `npx tsc --noEmit --pretty false` -> 0 errors. `npx vitest run
  convex/domains/redesign/chatRuns.responseShape.test.ts
  src/features/redesign/components/UniversalComposer.test.tsx` -> 16 passed. Fix reverted
  in isolation to prove the guard: audit prompt fails `expected { kind: 'memo' } to deeply
  equal { kind: 'title_only' }` (2 failed / 11 passed), restored -> 16 passed. Redesign
  sweep `npx vitest run convex/domains/redesign src/features/redesign shared/redesign` ->
  141 passed, 3 failed in `ScratchnodeEventsSurface.test.tsx`, confirmed pre-existing on
  clean `main` with all edits stashed and unrelated to this change.
- Visual proof: `not recorded` - no rendered surface changed; the response body shape is
  produced by the runtime, and the composer edit is a comment.
- Preview: `not recorded`
- Production live: `not recorded`

**Author**: Homen Shum + Claude Opus 4.8.
**Touches**: this change is chat-runtime only; no other lane.

## 2026-07-16 - Contract NodeBench to one decision workspace

NodeBench now has one primary product surface: the runtime-backed conversation at
`/redesign/chat`. The former Home, Reports, Inbox, Me, Workspace, mobile-shell, command
palette, and reproducible-answer destinations no longer mount competing application
trees. Their URLs preserve useful report, artifact, attention, settings, and receipt
context while replacing into the same conversation and keeping the composer available.
The old cockpit fallback is also removed from the main site: retired or unknown product
paths now resolve to the same chat, while read-only delivery routes and the separately
hosted Workspace keep their bounded contracts.
Main-site report graph, notebook, cards, sources, map, and brief editor URLs now carry
their report and artifact into chat instead of mounting another interactive workspace.

The header is reduced to product identity, explicit authentication, and theme. It no
longer duplicates the composer with global search or exposes wide mode, five peer tabs,
or ambiguous `Continue` copy. Runtime sources, approvals, exports, follow-ups, receipts,
provider/model metadata, usage, cost, and failure/retry states remain protected.

**PR / canonical main commit**: pending CI-gated candidate.

**Evidence state**: responsive before/after evidence and the protected function ledger
remain outside git under `.qa/evidence/2026-07-16-one-surface/`.

**Author**: Homen Shum + Codex.

## 2026-07-16 - Normalize structured answer typography

Structured answer copy now uses the compact product reading scale instead of an oversized
display treatment: 14px at a calm 450 weight with a 1.55 line height. The answer card and
mobile transcript use the existing spacing tokens for a quieter, more consistent rhythm.

This is presentation-only. Browser comparison confirmed identical answer text, visible
content, and accessibility snapshots; runtime provenance, controls, and touch targets are
unchanged. The focused chat guards, typecheck, design-system suite, and production build
pass, and the visual-rubric type-scale score improves from 0 to 1 without regression.

**PR / canonical main commit**: pending CI-gated candidate.

**Evidence state**: local responsive evidence remains outside git under `.qa/evidence/`.

**Author**: Homen Shum + Codex.

## 2026-07-16 - Continue an immutable answer in live chat

Reproducible answer receipts now separate two intents that were previously collapsed:
`Re-run prompt` starts a fresh reproducible run, while `Continue in chat` opens the real
chat surface with the receipt's prompt, answer, and source lineage already visible. The
composer remains available beneath that context, so the receipt is no longer a dead end.

Follow-up runs persist a bounded, role-aware conversation context and parent receipt hash.
The backend sanitizes this context before grounding the next answer and strips both fields
from public hash lookups, preventing a shared receipt URL from leaking private follow-up
conversation history. Reload recovery reconstructs the same transcript from stored run
context instead of inventing UI-only state.

The release also excludes the route-lazy markdown editor chunk from Workbox precaching;
it remains network loaded and runtime cached, avoiding an unrelated 2 MiB precache ceiling
from blocking production builds as dependency versions move.

**PR / canonical main commit**: pending CI-gated candidate.

**Evidence state**:
- Root TypeScript and 14 focused continuation/chat contract tests passed locally.
- Production build reached the full client bundle; final release proof is recorded on the PR.
- Responsive receipt-to-chat browser evidence remains outside git under `.qa/evidence/`.

**Author**: Homen Shum + Codex.
**Touches**: [`../integrations/pipeline-runtime.md`](../integrations/pipeline-runtime.md).
