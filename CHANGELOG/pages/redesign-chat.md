# Redesign Chat

Append-only lane for the public redesign chat, reproducible answer receipts, and their
transition into an authenticated live conversation. Newest entries first.

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
