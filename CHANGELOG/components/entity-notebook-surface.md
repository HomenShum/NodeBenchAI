# Entity notebook surface

Append-only lane for the entity notebook composition boundary that selects the
fallback or Live notebook and passes workspace authority into the mounted
surface. Newest entries first.

## 2026-07-29 - Preserve write authority across read mode

Pass the notebook's underlying write authority into the Live surface instead of
discarding it when the route renders in read mode. The Live component now owns
the temporary read-only mask, allowing an authorized reader to use the capture
shortcut without granting write access to shared or read-only notebooks.

**PR / canonical main commit**: #601 / `8416106a42729967b4ba3a6a397a95fc0e539bfa`.

**Evidence state**:
- Source: merged to `main` through PR #601.
- Checks: TypeScript passed; the focused EntityNotebookSurface and EntityNotebookLive scenario pack passed 15/15; production build passed; required PR and main-branch checks passed.
- Visual proof: pending authenticated Chrome capture; component focus behavior is recorded in `evidence/note-surface-live-capture/after.txt`.
- Preview: PR preview and post-deploy verification passed.
- Production live: commit `8416106a` is contained in production deployment `dpl_BhEFBRrSuUg2MszCZLwa9fbkMQqW`; authenticated state-matrix proof remains pending and must not be inferred from deployment alone.

**Author**: Homen Shum + Codex.
**Touches**: [`entity-notebook-live.md`](entity-notebook-live.md).
