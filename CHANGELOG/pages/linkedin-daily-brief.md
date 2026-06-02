# LinkedIn daily brief — changelog

Per-surface lane for the daily LinkedIn digest pipeline
(`convex/workflows/dailyLinkedInPost.ts`, `convex/workflows/ainewsBriefFormat.ts`).
Newest first.

## 2026-06-02 — AINews-style reformat

Reshaped the daily brief (06:15 UTC GENERAL post + the 09:00/15:00 persona
lanes) to read like the Latent.Space / smol.ai "AINews" roundup.

- **New module** `ainewsBriefFormat.ts` — pure, dependency-free, unit-tested
  scaffolding: bracketed top-3 headline, one-line dek, "we scanned N stories
  across M sources" provenance line, and a top-story prose lead.
- **`formatDigestForLinkedIn`** (the live daily brief) Post 1 now opens with the
  headline → dek → provenance → prose lead, then the existing number-dense signal
  bullets (de-duped against the lead).
- **`formatDigestForPersona`** (Deal Flow Brief / Tech Radar) gets the same
  headline + provenance header.
- **Provenance is honest** (HONEST_SCORES): every count printed is a real
  measured value (`storyCount` = feed items scanned, `topSources.length`); when
  counts are missing the line degrades to count-free phrasing rather than
  fabricating coverage.
- **Footer never dropped**: `briefFooterCap` reserves the `[1/3] #tags` footer's
  budget before truncating, replacing the old tail-truncating `capPost` on the
  posts it touches.
- **Bug fixed en route**: `clip()` appended the ellipsis *after* slicing to `max`,
  so it could overflow the headline/dek budgets by 3 chars — now reserves the
  ellipsis budget first.
- 35 scenario tests added and wired into the CI Runtime-smoke gate.
