# Edition Ingestion Flywheel — Phase 8 Plan

**Status**: planning doc, pre-implementation.
**Trigger**: 2026-05-09 follow-up sprint, Track D. The editorial home (`/redesign`) is the live default after Phase 7d. Track B seeded `industryUpdates` so guest §1 isn't empty. Now we need ingestion paths for §2 Hypotheses, §3 Forecasts, §4 Scoreboard, §5 Capabilities, and §6 Footnotes/Sources so a guest visiting at any time gets a full edition without needing auth.
**Source of truth**: [HomenShum/free-first-agentic-github-stack](https://github.com/HomenShum/free-first-agentic-github-stack) — 94-entry catalog of free-first APIs. This plan ranks the catalog by impact-to-effort for editorial sections.
**Related**:
- [`docs/architecture/HOME_EDITORIAL_REDESIGN.md`](HOME_EDITORIAL_REDESIGN.md) — what the home renders.
- [`.claude/rules/agentic_reliability.md`](../../.claude/rules/agentic_reliability.md) — every ingestion path must satisfy the 8-point checklist.
- [`.claude/rules/live_dom_verification.md`](../../.claude/rules/live_dom_verification.md) — Phase 8 acceptance is "guest sees rich content on prod", verified live.
- [`convex/domains/monitoring/publicTrendingSeed.ts`](../../convex/domains/monitoring/publicTrendingSeed.ts) — Track B's HN+arXiv seed; Phase 8 follows the same shape.

---

## 0. Goal

A guest visiting `https://www.nodebenchai.com/redesign` at any hour of any day sees:
- §1 Pulse: 5+ trending rows (already shipped via Track B)
- §2 Hypotheses: 3+ active narrative hypotheses with deterministic 6-bool checklists
- §3 Forecasts: 3+ open forecast questions with current probability + Brier history
- §4 Scoreboard: 4+ key stats with delta and source URL
- §5 Capabilities: 6+ capability rows with status (existing / emerging / sci-fi)
- §6 Footnotes: 8+ source citations with publisher + first-quote + URL

— every day, automatically, with no human in the loop, on a free-tier budget.

The acceptance criterion is mechanical: `npx tsx scripts/verify-live.ts` greps the live DOM for the section data attributes and counts the rendered items.

---

## 1. Per-section ingestion map

The 94-entry free-first catalog has direct hits for every editorial section. Each row below picks the BEST 1-2 sources, specifies the Convex table the data lands in, the cron that fires it, the transformation, the cadence, and the effort estimate.

### §1 Pulse — already shipped

**Sources**: HackerNews top stories + arXiv cs.AI recent submissions.
**Status**: SHIPPED in Track B (2026-05-09). `seedPublicTrending` runs every 6h, writes to `industryUpdates`. Guest §1 renders `provenance: "public-trending"` with 8+ rows.

**Phase 8a opportunity**: Add **GDELT** as a third source for global news angle (currently US-tech-heavy). GDELT's normalized event API gives per-day event volumes and tone scores — a richer signal than HN scores. Effort: S (~1 day, GDELT has a free Cloud API endpoint).

### §2 Hypotheses — competing explanations

**Current state**: `narrativeHypotheses` table is populated by the LinkedIn pipeline (`convex/workflows/dailyLinkedInPost.ts`) but only when the founder writes a post. Empty for many days.

**Best free source**: **OpenAlex API** (free, 100k credits/day, 28-day rolling cs.AI works) PLUS **arXiv abstracts** (already pulling in §1).

**How**: A new internal action `seedHypothesesFromAbstracts`:
1. Fetch top 20 arXiv cs.AI abstracts of the day.
2. Run a prompt over each: "Extract the falsifiable claim and the measurement approach. If neither is present, return null."
3. Use a free OpenRouter model (e.g. `nvidia/nemotron-nano-9b-v2:free` or `google/gemini-2.5-flash-lite-preview-09-2025` from the catalog's `openrouter-free-models` entry, 28 zero-cost models available 2026-05-08).
4. Insert as `narrativeHypotheses` rows with `status: "active"`, `claimForm`, `measurementApproach`, `falsificationCriteria`, `confidence: 0.5`, `speculativeRisk: "moderate"`. Source artifact = the arXiv URL with first-quote stored.

**Convex table**: `narrativeHypotheses` (existing).
**Cron**: every 12h.
**Transformation**: arXiv abstract → JSON-mode prompt → narrativeHypothesis row.
**Cadence**: ~10 hypotheses/day (filtered for null returns).
**License**: arXiv abstracts are public; OpenAlex is free-key with 100k/day.
**Effort**: M (~2 days). Requires routing through `internal.lib.openrouter` (not yet wired).
**Risk**: LLM extraction quality — first pass may be noisy. Mitigate with deterministic 6-bool checklist already in `editionQueries.ts:242` (`deriveHypothesisChecklist`) — only hypotheses passing ≥3/6 are surfaced in §2.

### §3 Forecasts — open questions with Brier scoring

**Current state**: Empty by design until manually authored. Forecasts are in `forecastQuestions` table (already exists per schema).

**Best free source**: **GDELT** for trend-detection (which topics are accelerating in news coverage) + **manual seed of 5 evergreen questions** (e.g. "Will GPT-6 ship in 2026?", "Will Claude be #1 on HumanEval at year-end?").

**How**: 
- One-time seed: insert 8 evergreen forecast questions covering AI capability + safety + commercial milestones.
- Daily cron: rescore based on news-volume signal from GDELT. If GDELT shows a 3-day spike in coverage of a forecast's topic, surface it as "active" in §3.

**Convex table**: `forecastQuestions` (existing).
**Cron**: daily.
**Transformation**: GDELT topic-volume time series → boolean "active this week" flag.
**Cadence**: 8 questions seeded once; daily rescore touches each one.
**License**: GDELT is public domain (US gov funded).
**Effort**: M (~2 days). Brier scoring requires a "ground truth" lookup — for evergreen questions, no scoring possible until they resolve. Phase 8b can add the scoring loop.
**Risk**: GDELT topic mapping is noisy. Mitigate by hand-curating the 8 seed questions to topics with clear keywords.

### §4 Scoreboard — key stats with delta

**Current state**: `dailyBriefSnapshots.dashboardMetrics.keyStats` (schema.ts:7123). Populated by LinkedIn pipeline. Sometimes empty.

**Best free sources**:
- **FRED API** for macro stats (CPI, unemployment, fed funds rate). Requires free API key — ONE-TIME setup.
- **GitHub Models** API for model count / total downloads (the catalog references this).
- **OpenAlex** for "papers/day in cs.AI" rolling 7-day counter.

**How**: New internal action `seedDailyKeyStats`:
1. Call FRED for `CPIAUCSL` (CPI), `UNRATE` (unemployment), `FEDFUNDS` (fed funds). 3 stats.
2. Call OpenAlex `/works?filter=concepts.id:C124101348&from_publication_date=...` for cs.AI paper count last 7 days vs prior 7. 1 stat with delta.
3. Optional: HN total stories today vs 7-day average. 1 stat.

**Convex table**: `dashboardKeyStats` (NEW — small, ~6 rows/day) OR augment `dailyBriefSnapshots.dashboardMetrics.keyStats` (preferred — no schema change).
**Cron**: daily at 09:00 UTC.
**Transformation**: time series → `{ label, value, deltaPct, sourceUrl }`.
**Cadence**: 5 stats/day, snapshot.
**License**: FRED is US gov public; OpenAlex is free with attribution.
**Effort**: M (~2 days). Need to plumb FRED API key into Convex env + handle the snapshot insertion.
**Risk**: FRED API key required; need to add to Convex env. Plan: ship Phase 8a using only OpenAlex + HN (no key required), defer FRED to Phase 8b.

### §5 Capabilities — three-bucket dot grids

**Current state**: `dailyBriefSnapshots.dashboardMetrics.capabilities` and `techReadiness`. Populated by LinkedIn pipeline.

**Best free source**: **arXiv categories aggregated by week** + **GitHub trending AI repos**. The catalog includes `discoverTrendingRepos` already in `crons.ts:88`.

**How**: 
- arXiv: count this week's submissions in cs.AI, cs.CL, cs.LG, cs.RO, cs.CV. Each becomes a "capability area" row.
- GitHub trending (already running hourly): top AI repos this week by stars-gained-7-days. Each becomes a "capability tool" row.
- Bucket: <10 papers/week → emerging; 10-50 → existing; 50+ → mainstream.

**Convex table**: `dashboardCapabilities` (NEW) OR reuse `dailyBriefSnapshots.dashboardMetrics.capabilities`.
**Cron**: weekly (Monday 06:00 UTC).
**Transformation**: arXiv weekly counts + GitHub trending → 6-row capability grid with bucket label.
**Cadence**: 6 rows/week, regenerated weekly.
**License**: arXiv public, GitHub Search API free with rate limits.
**Effort**: M (~2 days). GitHub trending already piped — only need the aggregator.
**Risk**: bucketing thresholds are heuristic. Mitigate by surfacing the raw count next to the label so readers can recalibrate.

### §6 Footnotes — sources with publisher attribution

**Current state**: `evidenceArtifacts` (existing) + `industryUpdates` slice. Track B already populates the latter.

**Best free sources**:
- **Wikimedia API** for canonical encyclopedia grounding (when a §1 row mentions a known entity, link to the Wikipedia page).
- **Crossref REST** for DOI metadata when arXiv abstracts cite a journal paper.
- **SEC EDGAR** for any company-filing reference (if a §1 row mentions an SEC filing, fetch the canonical URL).

**How**: post-processing step on §1 ingestion (HN + arXiv + GDELT):
1. For each row, run NER on `title + summary` to extract entity names.
2. Look up each entity in Wikidata Query Service → get canonical Wikipedia URL.
3. Insert `evidenceArtifacts` row with `publisher: "Wikipedia"`, `extractedQuotes: [{ text: <first sentence of Wikipedia summary> }]`.

**Convex table**: `evidenceArtifacts` (existing) — 8+ rows/day.
**Cron**: piggyback on §1 ingestion.
**Transformation**: §1 rows → entity NER → Wikidata QID → Wikipedia URL → evidenceArtifact.
**Cadence**: ~10 footnotes/day.
**License**: Wikipedia content is CC BY-SA — attribute and link required (we already do).
**Effort**: L (~3 days). NER step needs an LLM call OR a smaller deterministic regex of known entity patterns. Phase 8a should defer NER and just link the §1 rows themselves as evidenceArtifacts (every HN/arXiv URL becomes a footnote).

**Phase 8a simplification**: skip NER, use §1 URLs directly as footnotes. Each §1 row's URL → 1 evidenceArtifact entry. Same source = different table row; the editorial render combines them in §6.

---

## 2. Phasing — Phase 8a (sprint A) → Phase 8b (sprint B) → backlog

### Phase 8a — ship in next 2 days (target completion: 2026-05-11)

These three deliver the largest user-visible delta with minimal new infra:

1. **§6 Footnotes from §1 URLs** (S, ~half day):
   - Augment `seedPublicTrending` (Track B) to also insert `evidenceArtifacts` rows for each §1 URL.
   - Publisher = "Hacker News" or "arXiv" depending on source. First-quote = the title + first sentence of summary.
   - **Acceptance**: `getEditionFootnotes` returns ≥8 artifacts on prod for guest visitors.

2. **§3 Forecasts seed (8 evergreen questions)** (M, ~1 day):
   - One-time mutation `seedEvergreenForecasts` inserts 8 rows into `forecastQuestions`.
   - Topics: GPT-6 ship date, Claude HumanEval rank EOY, AGI safety regulation, MCP adoption, etc.
   - Each has a manually-authored falsification criterion.
   - **Acceptance**: §3 renders 8 forecast cards on prod.

3. **§4 Scoreboard via OpenAlex + HN totals** (M, ~1 day):
   - New action `seedDailyKeyStats` runs daily at 09:00 UTC.
   - Computes 5 stats: cs.AI papers last 7 days, delta vs prior 7 days, HN AI-tagged stories last 24h, GitHub stars on top trending AI repo, total HN front-page volume.
   - Snapshots into `dailyBriefSnapshots.dashboardMetrics.keyStats` for `dateKey: today`.
   - No new API keys required — OpenAlex with email-only header, HN/Firebase keyless, GitHub free.
   - **Acceptance**: §4 renders 5 stats with deltas on prod.

**Phase 8a definition of done**: a guest visiting `/redesign` on 2026-05-12 sees:
- §1: 8+ trending rows (already shipped)
- §3: 8 forecast cards (NEW)
- §4: 5 stats with delta (NEW)
- §6: 8+ footnotes (NEW)

### Phase 8b — Phase 8a + 5 days

4. **§2 Hypotheses from arXiv abstracts** (M, ~2 days): Wire up OpenRouter free models, JSON-mode extraction, deterministic checklist filter.
5. **§5 Capabilities weekly grid** (M, ~2 days): arXiv-categorized weekly counts + GitHub trending → 6-row dot grid.
6. **GDELT integration** (S, ~1 day): Daily news-volume signal → forecast activation marker, §1 trending angle.
7. **FRED API for macro stats** (S, ~1 day): Add Convex env var, plumb 3 macro indicators into §4 scoreboard.

**Phase 8b definition of done**: §2 has 3+ hypotheses, §5 has 6-row capability grid, §3 forecast cards have a "trending this week" badge driven by GDELT, §4 macro stats added.

### Backlog (Phase 8c+)

8. NER on §1 → Wikipedia entity grounding (Wikidata Query Service).
9. Crossref DOI lookup for arXiv-cited journals.
10. SEC EDGAR ingestion for company filings mentioned in pulse.
11. Multi-language: GDELT + Wikimedia in non-English locales.
12. ~~**Monthly retrospective expansion**~~ — SHIPPED in Phase 8c misc PR (#293). Now returns `topResolved`, `weeklyPulseTotals`, `dailyHistogram`, `dayKeys`, `pulseSource`.

### Phase 9a — SHIPPED (2026-05-09)

The original Phase 9 deferred list (PR #296) was overly conservative — four of the six items turned out to be shippable without the new infrastructure I claimed was required.  Phase 9a sprint shipped them as four independent PRs, each with verification floor + live-verify per `.claude/rules/live_dom_verification.md`.

13. **`format-strip / listen`** — ✅ SHIPPED in **PR #297** (commit `7a83e2f0`).
    Architecture: new Convex action `domains/integrations/voice/editionTts.generateEditionAudio` wraps ElevenLabs server-side (key never bundled).  Audio cached in Convex `_storage` keyed by `${dateKey}|${voiceId}`.  Same-day clicks cost $0.  FormatStrip renders Listen button with idle/loading/ready/error states + inline `<audio controls>`.
    Cost cap: `MAX_SCRIPT_CHARS=2000` → ~$0.30/generation max → ~$18/month worst case at 1 generation/day.
    Live: action returns `ok:false, error:"ELEVENLABS_API_KEY missing — TTS not configured"` until the env var is set on Convex prod.  HONEST_STATUS path verified.

14. **`format-strip / watch`** — ❌ STILL DEFERRED.  Still needs a video pipeline (Remotion or similar).  No new video-render infrastructure landed in Phase 9a.  Estimated effort: L (5-7 days).  See Phase 10 backlog.

15. **GDELT integration** — ✅ SHIPPED in **PR #300** (commit `5ca4d209`).
    The "paid tier required" claim was wrong — `https://api.gdeltproject.org/api/v2/doc/doc?...&format=json` is FREE with no key (rate-limited ~1 req/5s).  Once-daily cron at 08:00 UTC fits comfortably.
    New `convex/domains/monitoring/gdeltSeed.ts` writes to `industryUpdates` (provider="gdelt") + paired `evidenceArtifacts`.  Diversifies §1 trending (was HN+arXiv US-tech-heavy) with global-news angle.  Reuses existing `upsertPublicTrending` + `upsertPublicTrendingFootnotes` so URL dedupe is shared.
    Live: action returns `ok:false, error:"AbortError"` or `error:"HTTP 429"` when rate-limited (HONEST_STATUS) — confirmed both failure modes.  Production cron will run once daily, well within rate limits.

16. **FRED API for macro stats** — ❌ STILL DEFERRED.  Requires free API key registration.  No FRED wiring landed in Phase 9a.  Estimated effort: S (1 day) once key obtained.  See Phase 10 backlog.

17. **MCP-server-count auto-counter** — ✅ SHIPPED in **PR #299** (commit `6ad60a8d`).
    The "no public API" claim was correct, but the rendered HTML at `https://mcpservers.org/all` includes a `Showing 1-30 of N servers` SEO tagline that's stable enough to scrape daily.
    New `convex/domains/research/mcpServerCountSeed.ts` regex-extracts the integer and patches today's `dailyBriefSnapshots.dashboardMetrics.keyStats` with a `MCP servers tracked` row + day-over-day delta.  Cron at 06:00 UTC daily.  No frontend change — existing Scoreboard component picks it up.
    Live: verified via `npx convex run` — wrote `count=8173` to today's snapshot.

18. **§5 capability page deltas** — ✅ SHIPPED in **PR #298** (commit `3f0e7cba`).
    New query `getCapabilitiesDelta(windowDays)` reads today's `techReadiness` + the closest snapshot ≤ today - windowDays, computes per-bucket deltas honestly.  New hook `useCapabilitiesDelta(7)`.  CapabilitiesMap renders `+N` / `-N` / `→` badges with tooltip referencing the comparison window.
    HONEST_STATUS: `null` per-bucket when no prior snapshot to compare → component renders **nothing** (NOT "→") so the user is never misled about whether a comparison happened.
    Live: query verified — returns `today/prior/deltas` for `windowDays=7` with `priorDateString: "2026-05-03"`.

### Phase 10 — genuinely deferred

Two items genuinely need new infrastructure beyond what Phase 9a could ship without scope creep:

19. **`format-strip / watch` (video rendering)** — Phase 10.  No video pipeline in the repo.  Would need Remotion/ffmpeg/similar, an asset rendering server, and storage for rendered MP4s.  Effort: L (5-7 days).
20. **FRED API for macro stats at scale** — Phase 10 backlog.  Free tier limits + key registration required.  Adding 1-2 macro indicators (CPI, unemployment) is straightforward once the key is plumbed; doing it RIGHT (cache by datapoint, handle revisions) is the real work.  Effort: S (1 day) for minimal, M (3 days) for production-ready.

---

## 3. Reliability invariants (every ingestion path)

Every action introduced by this plan MUST pass `.claude/rules/agentic_reliability.md`'s 8-point checklist. Track B's `publicTrendingSeed.ts` is the reference template:

- **BOUND**: `MAX_*` constant per source; bounded reads on Convex queries.
- **HONEST_STATUS**: per-source counts returned; failed sources don't silently zero.
- **HONEST_SCORES**: never hardcode relevance/confidence floors; default `false`/`0`/`"UNKNOWN"` when uncomputable.
- **TIMEOUT**: `AbortController` with explicit budget per upstream call.
- **SSRF**: hostname allowlist for every `fetch()`. The catalog's `cautions` field flags rate-limit + auth requirements per source.
- **BOUND_READ**: streaming reader with size cap (256 KB tested baseline) on every external response.
- **ERROR_BOUNDARY**: every action wrapped in try/catch returning structured failure JSON.
- **DETERMINISTIC**: idempotency key (URL or DOI or QID) before insert. Re-runs never double-write.

The catalog's per-entry `cautions` field maps directly: e.g. `arxiv-api` warns "no more than one request every three seconds" — implementations must throttle accordingly.

---

## 4. Risks & gotchas

| Risk | Source | Mitigation |
|---|---|---|
| Rate-limit ban (arXiv 1 req/3s, SEC 10 req/s) | catalog cautions | Per-source throttle in `boundedFetch`; backoff on 429. |
| LLM extraction quality (§2 hypotheses) | OpenRouter free model variance | Deterministic 6-bool filter (≥3/6 to surface); flag low-confidence with badge. |
| FRED API key unavailable | requires registration | Defer FRED to Phase 8b; ship Phase 8a without macro indicators. |
| GDELT topic mapping noise | catalog cautions | Hand-curate 8 forecast topics; cross-check with HN volume before activating "trending" badge. |
| Wikipedia content drift | revision IDs not pinned | Capture `revid` at fetch time; cite page URL + revid in evidenceArtifacts. |
| Attribution license violations | Wikipedia CC BY-SA, GDELT public domain, etc. | Display source publisher + URL on every footnote; never re-host raw text. |
| LLM hallucinated entities (§6 NER) | NER can extract phantom entities | Phase 8a defers NER entirely; use §1 URLs as direct footnote sources. |
| Cron drift after GHA outage | Convex crons are independent of GHA, so safe | Verified — Convex crons fire even when Actions is account-blocked. |

---

## 5. Acceptance criteria (mechanical)

After Phase 8a ships, the following must hold on `https://www.nodebenchai.com/redesign` for a guest visitor (no auth, no localStorage state):

```bash
# §1 — trending pulse
npx convex run domains/research/editionQueries:getTodayPulse '{"limit":8}' \
  | grep -c '"provenance": "public-trending"'  # expect 1
npx convex run domains/research/editionQueries:getTodayPulse '{"limit":8}' \
  | grep -c '"_id":'  # expect ≥5

# §3 — forecasts seeded
npx convex run domains/research/editionQueries:getOpenForecasts '{}' \
  | grep -c '"questionId":'  # expect ≥8

# §4 — scoreboard with delta
npx convex run domains/research/editionQueries:getDailyEdition \
  '{"dateKey":"<today>"}' | jq '.snapshot.dashboardMetrics.keyStats | length'  # expect ≥5

# §6 — footnotes have content
npx convex run domains/research/editionQueries:getEditionFootnotes \
  '{"industryLimit":8}' | jq '.industry | length'  # expect ≥8
```

And via live-DOM verification:

```bash
# Tier A — raw HTML grep
npx tsx scripts/verify-live.ts  # extends to count rows in each section
# Tier B — Playwright real browser
npm run live-smoke  # extends to assert section counts post-hydration
```

The verification script (`scripts/verify-live.ts`) should be extended in Phase 8a to grep for these counts so the "shipped to prod" claim is mechanical, not narrative.

---

## 6. Why this plan (rationale)

Three rules already point this direction; Phase 8 is the worked example:

- **`usability_scorecard.md`**: "The output is the distribution. Every result is shareable." A guest with a full edition is a screenshot-worthy page; an empty edition is a non-event. Phase 8a delivers a screenshot-worthy first impression with zero auth friction.
- **`reexamine_design_reduction.md`**: "Earned complexity. Every section must justify its existence." Currently §2/§3/§4/§5/§6 silently render empty for most guests — they don't earn their place. Phase 8 either populates them or honestly hides them; no half-states.
- **`scratchpad_first.md`**: agents (and editors) iterate on a markdown narrative. The editorial home is the public version of that narrative. Ingestion = automating the daily narrative-pass for guests who can't see the founder's private scratchpad.

Free-first ingestion is also the cheapest signal of NodeBench's positioning — "operating intelligence for founders" — because it lets the home demonstrate operating intelligence on AI itself, every day, with no human curation required for the baseline.

---

## 7. Open questions

1. **Should §3 forecasts be seeded from the catalog's evergreen list, or pulled from a public forecasting API (e.g. Manifold / Metaculus)?** The catalog doesn't include either. Phase 8a uses hand-authored seeds; Phase 8c could explore Manifold (paid? free? unclear).
2. **Do we want a "submit a forecast" CTA for authed users?** Out of scope for ingestion plan; flagged for product.
3. **Should GDELT noise filtering use an LLM or a deterministic keyword index?** Phase 8b will start with deterministic; LLM upgrade in 8c if quality is poor.
4. **Phase 8 cadence — should we ship 8a as a single PR or split per section?** Recommend single PR for Phase 8a (footnotes + forecasts + scoreboard are independent; can land together once tested).
