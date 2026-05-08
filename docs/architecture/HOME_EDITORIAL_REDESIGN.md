# Home — Editorial Redesign Proposal

**Status**: design audit + phased implementation plan. Pre-implementation.
**Trigger**: user feedback 2026-05-08 — *"feel like if we draw professional references, there are much better ways to design this home page, for example, check out https://ai-2027.com/"* + *"we do have daily content pipeline with linkedin daily brief, we can sync them all up and expand"*.
**Related**: PR #276 (home reduction), `usability_scorecard.md`, `reexamine_design_reduction.md`, `self_judge_loop.md`, `forecasting_os.md`.

---

## 0. Headline finding

**The data substrate is already ai-2027-shaped.** `dailyBriefSnapshots.dashboardMetrics` (convex/schema.ts:7123) contains:

| Schema field | What ai-2027 renders as |
|---|---|
| `meta.timelineProgress` | Left-rail chronological scroll-spy |
| `charts.trendLine` | Right-rail "Unreliable Agent" line chart |
| `charts.marketShare` | Right-rail compute/share donut |
| `techReadiness: { existing, emerging, sciFi }` | **Three-bucket "Currently Exists / Emerging Tech / Science Fiction" dot grids** |
| `keyStats: KeyStat[]` | Right-rail scoreboard rows (Approval, Revenue, Valuation, ...) |
| `capabilities: CapabilityEntry[]` | AI Capabilities icon grid (Hacking, Coding, Politics, ...) |
| `entityGraph: { nodes, edges }` | Inline compute-scaling diagram |
| `annotations` | Footnote-style citations |

This is not coincidence — the schema is a port. The LinkedIn pipeline (`convex/workflows/dailyLinkedInPost.ts`) writes here daily.

**`narrativeHypotheses`** (schema.ts:13982) is the competing-explanations substrate:
- `claimForm` + `measurementApproach` + `falsificationCriteria` + `confidence` + `speculativeRisk`
- `supportingEvidenceCount` / `contradictingEvidenceCount` → evidence breakdown
- `competingHypothesisIds` → hypothesis link graph
- Paired with `evidenceChecklistValidator` (6 booleans → grounded/mixed/speculative via `deriveEvidenceLevel`)

**`pulseReports`** (schema.ts:15308) is per-entity daily pulse:
- `summaryMarkdown` (already markdown narrative)
- `changeCount` / `materialChangeCount` for delta badges

**Conclusion**: the home doesn't need new infra. It needs an editorial render pass over data that's already produced and queryable. This collapses Variant C (single-document daily edition) from "ambitious bet" to "render what exists."

---

## 1. What ai-2027.com actually does (observed 2026-05-08)

Captured 4 progressive scroll screenshots. Structural choices:

1. **Three-column scroll-spine.** Left = chronological scroll-spy. Center = serif narrative. Right = sticky "live dashboard" that swaps panels with scroll position.
2. **Single narrative thread.** No card grid. H2 chapter headers ARE the scroll anchors.
3. **Co-temporal right rail.** Right-rail panels are the state of the world at the chapter you're reading.
4. **Calibrated dot-grids.** "Currently Exists / Emerging Tech / Science Fiction" rendered as three 6-dot strips per claim.
5. **Inline `<details>`** for tangents (PR #276 already uses this).
6. **Editorial typography.** Serif body, generous line-height, no card chrome, footnote superscripts.
7. **Format strip**: "Daniel Kokotajlo, Scott Alexander... | Published April 3rd 2025 | PDF | listen | watch".

---

## 2. Why this matters for NodeBench

Three rules already point this direction; ai-2027 is the worked example:

- `usability_scorecard.md`: "**The output is the distribution. Every result is shareable.**"
- `reexamine_design_reduction.md`: "**Earned complexity.** Every section must justify its existence."
- `scratchpad_first.md`: agents write *markdown narrative* before structured output. The home should mirror what the agent produces — not hide it behind tiles.

Current home (post-PR #276) is structurally correct (5 sections, 2 collapsed) but editorially flat: it reads as a tool dashboard, not a daily edition of operating intelligence.

---

## 3. Three competing variants

Per `self_judge_loop.md`: never produce one version. Each variant has a clear sweet spot.

### Variant A — "Editorial long-read" (full ai-2027 transplant)

**Shape**:
- Left rail (220px sticky): scroll-spy `Today · This week · 30d · Quarter · Year`. Replaces redesign tab nav at home only.
- Center column (max 720px): serif narrative — *Pulse → What moved → What it means → What to look at*. WhatChangedStrip dissolves into prose with footnote-cited claims.
- Right rail (320px sticky): co-temporal widgets driven by `dashboardMetrics`.
- Format strip on every Decision Memo: `PDF · listen · watch · share-link`.

**Tradeoffs**:
- ✅ Strongest editorial identity. Hard to copy.
- ✅ Right-rail context-swap is the "wow" moment.
- ❌ Scroll-spy + IntersectionObserver + per-section right-rail payloads is real engineering.
- ❌ Mobile collapse story is hard.
- ❌ Serif body conflicts with existing Manrope.

**Effort**: ~5 days. **Risk**: high (mobile + font).

---

### Variant B — "Magazine cover + reduced home below" (low-risk delta)

**Shape**:
- Above fold: full-width "Today's edition" cover (one headline + one chart + one citation).
- Below fold: keep PR #276 structure unchanged.
- Adopt only footnote-style citations + format strip globally.

**Tradeoffs**:
- ✅ Smallest delta (~1-2 days).
- ✅ Cover hero is screenshot-worthy.
- ❌ Only the cover is editorial; rest is still cards.
- ❌ Doesn't capture the right-rail co-temporal innovation.

**Effort**: ~1-2 days. **Risk**: low.

---

### Variant C — "Single-document daily edition" — **RECOMMENDED**

**Shape**:
- One column, max 720px. No rails desktop OR mobile.
- Numbered editorial structure:
  - `1. What moved today` ← `pulseReports.summaryMarkdown` + `changeCount`
  - `2. The competing explanations` ← `narrativeHypotheses` rendered with 6-dot strips
  - `3. What to look at this week` ← `forecasts` with Δ badges (per `forecasting_os.md`)
  - `4. Today's scoreboard` ← `dailyBriefSnapshots.dashboardMetrics.keyStats` rendered inline
  - `5. Capabilities map` ← `dashboardMetrics.capabilities` + `techReadiness` dot grid
  - `Footnotes` ← `evidenceArtifacts` + `industryUpdates`
- Inline charts/citations like ai-2027 (compute-scaling diagram from `entityGraph`).
- Operations dashboard becomes a rendered table inside section 4.
- Mobile and desktop are identical.

**Tradeoffs**:
- ✅ Strongest editorial identity, closest to ai-2027 in spirit.
- ✅ Mobile parity by construction.
- ✅ Maximally screenshot-worthy.
- ✅ **Daily content pipeline already exists** — the LinkedIn workflow writes the substrate every morning.
- ❌ Eliminates the 3-col Operations grid from home (moves to `/?surface=memo` or a dedicated route).
- ❌ Loses "operational tool" feel. Risk of being read as a blog rather than software.
- ❌ Bet on positioning shift: "operating intelligence" → "daily intelligence brief".

**Effort**: ~3-4 days for layout (content pipeline ready). **Risk**: medium (positioning).

---

## 4. Recommendation (revised)

**Variant C as Phase 7.** The content pipeline that previously gated this is confirmed to exist. The schema is already ai-2027 shape. Variant B's "cover hero only" leaves the right-rail co-temporal innovation on the table, and the user explicitly named ai-2027 as the reference — meaning the long-read shape, not just the cover.

Phasing:

- **Phase 7a — Editorial render (2 days)**. Build the single-column daily-edition shell. Bind each section to its existing query. Deploy behind `/?edition=1` flag. Keep current home reachable at `/`.
- **Phase 7b — Scroll-spy + footnote citations (1 day)**. Add chapter anchors driven by `dashboardMetrics.meta.timelineProgress`. Render `evidenceArtifacts` as inline footnote superscripts.
- **Phase 7c — Format strip + share artifact (1 day)**. PDF render via existing `publicShares` table. `share-link` opens a public route. (Listen/watch deferred — TTS/video infra is separate.)
- **Phase 7d — Promote (decision gate)**. After 7a-c live behind flag, run `dogfood:full:local` + `gemini-qa-loop` for 3 cycles. If editorial scorecard ≥ 75/100 (per `usability_scorecard.md`), promote `?edition=1` to default at `/`. Otherwise iterate.

Variants A and B remain on the shelf. A's three-column scroll-spine can be added as Phase 8 if the editorial column proves out and the right-rail co-temporal panels are wanted as a desktop enhancement. B is now strictly dominated by C since the content cost objection is gone.

---

## 5. Concrete data binding (Phase 7a)

Each section names the table, query, and editorial render rule.

### §1 — "What moved today"

- **Source**: `pulseReports` (15308) where `dateKey === today` AND `ownerKey === currentUser`.
- **Render**: render `summaryMarkdown` as serif paragraph. Inline a Δ badge: `[N material changes]`. Link entity slug → `/redesign/entity/{slug}`.
- **Empty state**: "No pulse generated yet today. Last pulse: {dateKey}."

### §2 — "The competing explanations"

- **Source**: `narrativeHypotheses` (13982) where `status IN (active, supported, weakened)` AND `updatedAt >= today - 24h`. Group by `threadId`.
- **Render**: each hypothesis = one paragraph block:
  - H1 label + title (serif heading)
  - `claimForm` (body)
  - **6-dot strip** rendering `evidenceChecklist` booleans (per `validators.ts`). Filled = pass. `deriveEvidenceLevel` → text annotation `[grounded]` / `[mixed]` / `[speculative]`.
  - `falsificationCriteria` rendered as small italic line: *"Would change my mind: ..."*
  - Tally line: `{supportingEvidenceCount} supporting · {contradictingEvidenceCount} contradicting`.
- **Compete-link**: when two hypotheses share `competingHypothesisIds`, render a connector line between blocks.
- **Empty state**: hide section. Don't fake hypotheses.

### §3 — "What to look at this week"

- **Source**: `getTopForecastsForLinkedIn` (forecastManager.ts:311) — already exists, already enriched with `previousProbability`.
- **Render**: per forecast — claim line, current probability bold, Δ badge `[was 62%, +6pp today]` (existing `formatDeltaBadge` from `forecasting_os.md`), Brier note if resolved.
- **Cap**: 5 forecasts. "View all forecasts →" link to `/forecasts`.

### §4 — "Today's scoreboard"

- **Source**: `dailyBriefSnapshots` (7123), latest by `dateString DESC`. `dashboardMetrics.keyStats`.
- **Render**: inline two-column table — label + value + small delta arrow. Mirror ai-2027's right-rail scoreboard format.
- **No card chrome** — flush table, hairline rule above and below.

### §5 — "Capabilities map" (the dot grids)

- **Source**: `dashboardMetrics.techReadiness: { existing, emerging, sciFi }` + `dashboardMetrics.capabilities`.
- **Render**: three rows, each labeled (`Currently Exists`, `Emerging`, `Science Fiction`), with a 6-dot strip showing the count out of total. Below: capability icon grid (Hacking, Coding, Politics, Bioweapons, Robotics, Forecasting from `capabilities`).
- **This is the visual signature** — the section that makes the home feel like ai-2027.

### Footnotes

- **Source**: `evidenceArtifacts` (13631) referenced by §1-§3 via `evidenceArtifactIds`. Plus `industryUpdates` (13221) capped at 8 most-recent.
- **Render**: numbered list, monospace caption, link → `evidenceArtifact.url` or `industryUpdates.sourceUrl`. Footnote superscripts inline in body sections link here via anchor.

---

## 6. What this proposal does NOT do

- Does **not** propose touching the redesign tab nav (Home / Reports / Chat / Inbox / Me) — canonical per `CLAUDE.md`.
- Does **not** propose changing Decision Workbench, Postmortem, or Telemetry surfaces. Editorial pattern is home-only until proven.
- Does **not** propose introducing a new font for Phase 7. Manrope at editorial scale (1.7 line-height, 17px body) before considering a serif.
- Does **not** propose removing the operations dashboard from the product — only moving it off home into `?surface=memo` in §3 of the new home or a dedicated `/operations` route.
- Does **not** propose new tables. The substrate is complete.

---

## 7. Verification plan

Per `live_dom_verification.md` and `pre_release_review.md` Layer 8:

1. `npm run live-smoke` extended with editorial-home assertions:
   - `[data-section="what-moved"]` rendered and has body text
   - `[data-section="competing-explanations"]` either rendered or absent (no fake state)
   - `[data-dot-grid]` count matches `techReadiness` totals
   - `[data-footnote]` superscripts link to anchors that exist
2. `scripts/verify-live.ts` extended with editorial signals.
3. Mobile viewport (375px) — single column should match desktop. No horizontal overflow.
4. Reduced-motion: scroll-spy active class still applies, no scroll-jacking.
5. `npm run dogfood:full:local` to capture before/after for `/dogfood`.
6. `gemini-qa-loop` (per `gemini_qa_loop.md`) — Pro+Flash rotation, target editorial scorecard ≥ 75/100 after 3 cycles before flipping `?edition=1` to default.
7. Per `agentic_reliability.md`: every query in §5 has BOUND (caps), HONEST_STATUS (no fake 200 on missing data), HONEST_SCORES (`evidenceChecklist` is already deterministic-boolean — keep it).

---

## 8. Decisions (locked 2026-05-08)

User directive: *"do no need new route, build revamp ontop of existing redeisgn"*.

1. **No new route.** Phase 7a lands inside `src/features/redesign/surfaces/HomeSurface.tsx` directly. The 3-col operations grid collapses into a `<details>` accordion inside §4 of the new editorial home, NOT a separate `/operations` route.
2. **Format strip in 7c = PDF + share-link only.** `publicShares` table already exists. Listen (TTS) + watch (video) deferred to Phase 8 — separate infra.
3. **Promotion gate = manual call.** After Phase 7a-c land behind `?edition=1` and `npm run dogfood:full:local` produces clean evidence, ship a manual promotion. `gemini-qa-loop` informs the call but doesn't auto-promote.

---

**Next action**: open PR #279 implementing Phase 7a — editorial render of `HomeSurface.tsx` behind `?edition=1` flag, binding §1-§5 to the existing Convex queries per §5.
