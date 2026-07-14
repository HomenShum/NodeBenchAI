# Changelog Lane Template

Each lane is append-only. Add the newest entry directly below the title and description.

```md
## YYYY-MM-DD — Short imperative title
What changed and why in 1–3 sentences. Mention the user-visible effect and any important verification.

**PR / canonical main commit**: `#NNN` / `<squash SHA>`.
Use `PENDING #NNN MAIN SHA / FINAL QA` only while the merge or exact-revision
verification is genuinely pending; replace it before the final release commit.

**Evidence state**:
- Source: `<merged | pending>`
- Checks: `<exact commands/result/SHA | not recorded>`
- Visual proof: `<path | not recorded>`
- Preview: `<URL + assertions | not recorded>`
- Production live: `<URL + deployed revision + assertions | not recorded>`

**Author**: Homen Shum + `<agent or contributor>`.
**Touches**: `other/lane.md` if this is part of a multi-surface change; use a
real relative Markdown link in the completed entry.
```

Skip entries for generated files, pure formatting, lockfile churn, or changes that would not help a future maintainer understand the surface.
Never fabricate screenshots, QA receipts, findings, Agentic UI Bar scores, test
counts, preview results, or production-live claims. A green build proves only
the build that ran; it does not prove a deployment.
