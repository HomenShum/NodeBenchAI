# LinkedIn daily brief — changelog

Per-surface lane for the daily LinkedIn digest pipeline
(`convex/workflows/dailyLinkedInPost.ts`, `convex/workflows/ainewsBriefFormat.ts`).
Newest first.

## 2026-06-02 — Free-model-first routing with a publish quality gate

Made the brief actually *use* the top free models, which it previously only
listed as never-reached fallbacks.

- **Root cause:** `generateDigestWithFactChecks` ([digestAgent.ts]) built its
  fallback chain as `[kimi-k2.6 (paid), ...freeModels, ...paidFallbacks]` —
  the comment said "try ALL free models first" but the code put the paid
  default first, so kimi-k2.6 won on attempt 1 every time and the free models
  were never reached. There was also **no quality gate** — success meant
  "the JSON parsed," not "the digest is good."
- **Fix:** for the auto-selected (non-explicit) case the chain is now
  `[topFreeModels(gated), kimi-k2.6, gpt-5.4-mini, gemini-flash-lite, haiku]`.
  Top 3 free models are tried first; an explicitly requested model is still
  honored first.
- **Quality gate** `assessDigestQuality()` (in `ainewsBriefFormat.ts`): a free
  model's output is only published if it clears the AINews bar — ≥3 usable
  signals, ≥2 carrying a hard number or source URL, and a narrative thesis.
  Below the bar → fall through to the paid trusted tail. Paid models are not
  gated (they are the safety net).
- **Honest fallbacks:** if nothing clears the bar but something parsed, the
  best parsed digest is published (logged, not faked); only a total parse
  failure returns `success:false`.
- This also keeps the brief's model lane **fresh for free**: the hourly
  `freeModelDiscovery` scanner curates `getFreeModels()`, so the free
  candidates track current OpenRouter releases without manual edits.
- Affects all digest→social-post generators that share
  `generateDigestWithFactChecks` (daily brief, founder post, project-idea post).
- 6 new scenario tests for the gate (thin / numberless / no-thesis / padded /
  custom-threshold). Suite now 41 tests, in the CI Runtime-smoke gate.
- **Known gap (not addressed):** the *paid* allowlist `APPROVED_MODELS` is
  still hand-maintained and ~1 generation behind the frontier
  (no `gpt-5.5` / `claude-opus-4.8`). Adding them needs verified SDK IDs +
  real pricing/context specs; not fabricated here. The brief does not use the
  frontier flagships, so this does not affect brief output today.

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
