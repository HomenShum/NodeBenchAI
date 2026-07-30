# Entity notebook Live surface

Append-only lane for the block-stream editor, its read/edit transition, capture
shortcut, and fail-closed notebook authority behavior. Newest entries first.

## 2026-07-29 - Arm desktop capture from read mode

Make Cmd/Ctrl+E enter edit mode and focus the first editable Live block. Empty
notebooks create exactly one block, while active text inputs, repeated shortcuts,
shared routes, and notebooks containing only read-only blocks remain protected.

**PR / canonical main commit**: PENDING #601 MAIN SHA / FINAL QA.

**Evidence state**:
- Source: pending on PR #601.
- Checks: TypeScript passed; the focused EntityNotebookSurface and EntityNotebookLive scenario pack passed 15/15; production build passed; the NodeKit reference corpus gate passed 10/10 records with 21 facts and 53 citations.
- Visual proof: pending authenticated Chrome capture; failing-before and passing-after behavior receipts are in `evidence/note-surface-live-capture/`.
- Preview: pending exact-head deployment after this update.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
**Touches**: [`entity-notebook-surface.md`](entity-notebook-surface.md).
