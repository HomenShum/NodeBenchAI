# Redesign Chat

Append-only lane for the public redesign chat, reproducible answer receipts, and their
transition into an authenticated live conversation. Newest entries first.

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
