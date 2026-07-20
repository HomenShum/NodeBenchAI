# Morning Dossier P0 Implementation

> **PR Date:** December 14, 2025
> **Status:** ✅ P0 Complete with Production Hardening
> **Build:** ✅ Passing

---

## Problem / Goal

**Before:** The Morning Dossier page rendered raw RSS-style log lines ("Trending on Hacker News with 35 points and 6 comments") instead of editorial prose synthesis. Backend failures ("Pending — run this follow-up") leaked into the UI. No structured brief generation existed.

**After:** Users see a 3-Act executive intelligence brief with:
- **Act I:** Coverage & Freshness summary
- **Act II:** Signal cards with synthesis prose + evidence grids (when `generatedBrief` exists)
- **Act III:** Filtered actions (backend failures suppressed via `ActionStatus` enum)

---

## Changes by Subsystem

### Backend (Convex)

**`convex/domains/research/briefGenerator.ts`** (NEW)
- OpenAI Structured Outputs with `DailyBriefJSONSchema`
- Production-grade prose hygiene enforcement with 14 lint rules:
  - Bullets, numbered lists, full URLs, www URLs, domain patterns
  - ISO timestamps, 12h/24h time patterns
  - Feed-log tells: "Trending on", "X points", "Y comments", "stars", "upvotes"
- Regeneration loop with violation-specific feedback (up to 4 attempts)
- Structured telemetry logging for monitoring (`briefGenerator.generation_success`, `briefGenerator.validation_failed`, `briefGenerator.api_error`, `briefGenerator.generation_exhausted`)

**`convex/domains/research/dailyBriefMemoryMutations.ts`** (MODIFIED)
- Added `updateMemoryContext` internal mutation for storing `generatedBrief`
- Already internal-only (`internalMutation`) — not client-callable ✅

### Frontend (React)

**`src/features/research/components/SignalCard.tsx`** (NEW)
- Expandable card with headline, synthesis prose, and EvidenceGrid
- `SignalList` component for rendering arrays
- Glassmorphism styling with Tailwind

**`src/features/research/components/EvidenceGrid.tsx`** (NEW)
- Horizontal scrollable evidence cards with fade edges
- `EvidenceCard`: favicon, title (linked), relevance badge, score indicator
- Responsive layout

**`src/features/research/components/ScrollytellingLayout.tsx`** (MODIFIED)
- Extended `ScrollySection.content` with `signals?: Signal[]` and `actions?: Action[]`
- `SectionRenderer` conditionally renders `SignalList` when signals present

**`src/features/research/views/WelcomeLanding.tsx`** (MODIFIED)
- Consumes `memory?.context?.generatedBrief` as `DailyBriefPayload`
- `hasStructuredBrief` flag for conditional rendering
- Act III filtering uses `ActionStatus` enum when structured brief exists
- Fallback to legacy string-matching for pre-existing data

---

## Contracts Introduced

### DailyBriefPayload (Canonical Schema)
```typescript
interface DailyBriefPayload {
  meta: { date, headline, summary, confidence?, version? }
  actI: { title, synthesis, topSources[], totalItems, sourcesCount }
  actII: { title, synthesis, signals: Signal[] }
  actIII: { title, synthesis, actions: Action[] }
  dashboard?: { vizArtifact?, sourceBreakdown?, trendingTags? }
}
```

### Signal Interface
```typescript
interface Signal {
  id: string;
  headline: string;         // 5-10 words
  synthesis: string;        // 2-4 prose sentences (no bullets/URLs)
  evidence: Evidence[];     // 1-5 items
  relatedSignalIds?: string[];
}
```

### Evidence Interface
```typescript
interface Evidence {
  id, source, title, url, publishedAt, relevance, score?, favicon?
}
```

### ActionStatus Enum
```typescript
type ActionStatus = "proposed" | "insufficient_data" | "skipped" | "in_progress" | "completed";
```

---

## Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| `generatedBrief` absent | Falls back to raw feed items in Act II (legacy behavior) |
| `signals[]` empty | Renders prose paragraphs from `content.body[]` |
| Deep dive `status: "skipped"` or `"insufficient_data"` | Filtered out, not rendered in UI |
| Legacy deep dives (no status field) | String-matching filter: "Pending", "Completed — no notes" removed |

---

## Security & Best Practices

| Checkpoint | Status |
|------------|--------|
| `updateMemoryContext` internal-only | ✅ Uses `internalMutation` |
| Prose hygiene blocks UI-visible regressions | ✅ 14 lint rules with regeneration loop |
| Deep dive failures suppressed at generator level | ✅ `ActionStatus` enum filtering |
| VizArtifact `data.url` rejection | ✅ `SafeVegaChart` validates |
| Vega-Embed actions disabled | ✅ Documented in component |

---

## Test Evidence

### Build
```
✓ 5270 modules transformed
✓ built in 16.64s
```

### Screenshots
- `morning-dossier-act1-act2.png` — 3-Act structure visible
- `morning-dossier-scrolled.png` — Act II signals section
- `morning-dossier-full.png` — Full page layout

### Verified User Flows
1. ✅ Morning Dossier loads with 3-Act scrollytelling
2. ✅ Act I shows coverage metrics (132 items, 5 sources)
3. ✅ Act II falls back to feed items (no `generatedBrief` in test data)
4. ✅ Act III shows filtered "Next steps (Fast Agent)" button
5. ✅ Dashboard updates on scroll (IntersectionObserver working)

---

## Known Limitations (P1)

| Item | Description |
|------|-------------|
| Evidence ↔ Dashboard binding | Hover chart point doesn't highlight evidence cards yet |
| VizArtifact chart slot | Agent-emitted charts not integrated into dashboard |
| Snapshot test corpus | No golden JSON payloads for regression testing |
| Telemetry dashboard | Console logging only; no persistent log table |

---

## Original Gap Analysis (Archived)

<details>
<summary>Click to expand original gap analysis</summary>

### Gap 4: Evidence Cards Not in Scrolly (✅ RESOLVED)
- Created `EvidenceGrid.tsx` with horizontal scrollable cards
- Integrated into `SignalCard.tsx`

### Gap 5: Dashboard Tooltip Has No Evidence Links (P1)
- Chart tooltips don't show linked evidence
- Requires `linkedEvidenceRefs` on chart data points

### Gap 6: No VizArtifact Integration Path (P1)
- `SafeVegaChart` exists but no agent emission path
- Dashboard uses hardcoded chart structures

### Gap 7: Duplicate Scroll Logic (P2)
- Two `ScrollytellingLayout.tsx` files with similar `useInView`
- Should consolidate to `src/hooks/useInView.ts`

### Gap 8: Missing Observability Logging (✅ RESOLVED)
- Added structured telemetry in `briefGenerator.ts`
- Console logging with JSON format for ingestion

</details>

---

## Implementation Priority Matrix (Updated)

| Priority | Workstream | Status | Effort | Impact |
|----------|-----------|--------|--------|--------|
| **P0** | Wire Structured Outputs + Generate Real Brief | ✅ DONE | 3d | HIGH |
| **P0** | SignalCard + EvidenceGrid Components | ✅ DONE | 2d | HIGH |
| **P0** | Filter Empty Deep Dives in Act III | ✅ DONE | 0.5d | MEDIUM |
| **P0** | Production Hardening (Prose Hygiene) | ✅ DONE | 1d | HIGH |
| **P0** | Production Hardening (Telemetry) | ✅ DONE | 0.5d | MEDIUM |
| **P1** | Dashboard Evidence Linking | TODO | 2d | MEDIUM |
| **P1** | VizArtifact Rendering Path | TODO | 1d | MEDIUM |
| **P2** | Consolidate useInView Hook | TODO | 0.5d | LOW |
---

## Files Summary

### Created
| File | Purpose |
|------|---------|
| `convex/domains/research/briefGenerator.ts` | OpenAI Structured Outputs + prose hygiene + telemetry |
| `src/features/research/components/SignalCard.tsx` | Signal headline + synthesis + EvidenceGrid |
| `src/features/research/components/EvidenceGrid.tsx` | Horizontal scrollable evidence cards |

### Modified
| File | Changes |
|------|---------|
| `convex/domains/research/dailyBriefMemoryMutations.ts` | Added `updateMemoryContext` internal mutation |
| `src/features/research/components/ScrollytellingLayout.tsx` | Extended content type with `signals[]`, `actions[]` |
| `src/features/research/views/WelcomeLanding.tsx` | Consumes `generatedBrief`, ActionStatus filtering |

---

*End of P0 Implementation Summary*

