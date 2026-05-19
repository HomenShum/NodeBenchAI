# Home Daily Brief — Interactive Backend Architecture

## Overview

The Home surface daily brief is a BLUF-first (Bottom Line Up Front) personalized
briefing that transforms raw signals from the `dailyMorningBrief` pipeline into
an interactive, clickable, professional-grade daily intelligence product.

Every section maps to real Convex backend data. Nothing is static prose —
each element is a **live view** into the entity graph, signal pipeline, and
narrative engine.

## Pipeline Flow (Data → Home Surface)

```
6:00 AM UTC — dailyMorningBrief.ts (orchestrator)
  │
  ├─ STEP 1: Ingest feeds (HN, GitHub, Dev.to, ArXiv, news APIs)
  │   → FeedItemLite[]
  │
  ├─ STEP 2: Calculate dashboard metrics
  │   → StickyDashboard stats
  │
  ├─ STEP 3: Store → dailyBriefSnapshots (Convex table)
  │
  ├─ STEP 4: Initialize domain memory
  │   → dailyBriefMemories { features[], signals[] }
  │
  └─ STEP 5: Generate executive brief
      → AgentDigestOutput (the canonical payload)

10:00 AM UTC — dailyLinkedInPost.ts (optional distribution)
  │
  ├─ Fetch AgentDigestOutput from latest brief
  ├─ Generate competingExplanations (Phase 7)
  ├─ Format for LinkedIn (3-post thread)
  └─ Post via linkedinPosting.ts
```

## Section-to-Backend Mapping

### 1. Entity Carousel (Mini Report Cards)

**What it shows**: Scrolling carousel of entity report cards — each card is a
mini version of the Reports page `rd-report-card`.

**Backend source**:
```typescript
// Convex query
const reports = useQuery(api.domains.reports.list, {
  userId,
  limit: 12,
  orderBy: "updatedAt",
  filter: { status: ["verified", "watching", "review"] }
});
```

**Data shape per card**:
```typescript
interface MiniReportCard {
  entityId: string;
  entity: string;              // "Anthropic"
  kind: "Diligence" | "Event" | "Theme" | "Coverage";
  status: "verified" | "watching" | "review";
  headline: string;            // Latest signal headline
  sourceCount: number;
  claimCount: number;
  updatedAt: string;           // relative: "2h ago"
  statusDot: "live" | "review" | "stale" | "drafting";
}
```

**Interactions**:
- **Click** → navigate to entity report page (`/reports/{entityId}`)
- **Hover** → show dock overlay with sources, claims, and action buttons
- **Dock "Open"** → full report view
- **Dock "Ask"** → open right rail chat with entity context pre-loaded

### 2. Portfolio Exposure Strip

**What it shows**: Aggregate portfolio impact summary — how many tracked entities
are affected, estimated dollar exposure, active deals impacted.

**Backend source**:
```typescript
// Derived from user's entity watchlist + today's signals
const exposure = useQuery(api.domains.portfolio.dailyExposure, {
  userId,
  briefDate: today
});

interface PortfolioExposure {
  entitiesAffected: number;      // count of tracked entities with signals today
  estimatedSpendAtRisk: number;  // sum of API spend / vendor contracts affected
  activeDealsImpacted: number;   // deals with status "negotiating" | "active"
  exposureDetails: Array<{
    entityId: string;
    relationship: "vendor" | "investor" | "competitor" | "partner" | "prospect";
    annualValue: number;
    riskLevel: "high" | "medium" | "low";
  }>;
}
```

**Interactions**:
- **Click entity count** → expand inline list of affected entities
- **Click spend figure** → navigate to portfolio exposure detail view
- **Click deal count** → filter actions to deal-related items only

### 3. BLUF — Need to Know

**What it shows**: 4 bullets — conclusion first, then supporting detail.
Each has a confidence badge and personal position annotation.

**Backend source**:
```typescript
// From AgentDigestOutput.signals[] — top 4 by significance
const blufItems = digestOutput.signals
  .sort((a, b) => significanceRank(b) - significanceRank(a))
  .slice(0, 4)
  .map(signal => ({
    headline: signal.title,
    detail: signal.summary,
    hardNumbers: signal.hardNumbers,
    confidence: deriveConfidence(signal),     // from evidence checklist
    sourceCount: signal.sources?.length ?? 0,
    // Personal position from user's entity graph
    position: getUserEntityPosition(userId, signal.entityKeys)
  }));

interface BLUFItem {
  headline: string;
  detail: string;
  hardNumbers?: string;
  confidence: "verified" | "estimated" | "speculative";
  sourceCount: number;
  position: {
    relationship: string;     // "vendor dependency"
    exposure: string;         // "$1.8M/yr API spend"
    context: string;          // "partnership deal in negotiation"
  };
}
```

**Confidence derivation** (deterministic, from evidence checklist):
```
verified    → 5-6 of 6 checks passing (grounded)
estimated   → 3-4 of 6 checks passing (mixed)
speculative → 0-2 of 6 checks passing
```

**Evidence checklist** (6 boolean checks):
1. `hasPrimarySource` — Tier 1/2 domain (SEC, Reuters, WSJ)
2. `hasCorroboration` — 2+ distinct source domains
3. `hasFalsifiableClaim` — LLM-generated falsification criteria
4. `hasQuantitativeData` — Hard numbers present
5. `hasNamedAttribution` — Named entity/person cited
6. `isReproducible` — Followable URL exists

**Interactions**:
- **Click headline** → expand to full signal detail with source links
- **Click confidence badge** → show evidence checklist breakdown
- **Click position annotation** → navigate to entity relationship page
- **Hover** → show source preview tooltip

### 4. Twin Action Cards

**What it shows**: Two cards side-by-side:
- **Next Best Action** — highest-priority action derived from signals
- **Daily Sweep** — triage summary of overnight signals

**Backend source**:
```typescript
// Next Best Action — from AgentDigestOutput.actionItems[0]
const nextAction = digestOutput.actionItems
  .sort((a, b) => priorityRank(b) - priorityRank(a))[0];

// Daily Sweep — from signal triage pipeline
const sweep = useQuery(api.domains.signals.dailySweep, {
  userId,
  date: today
});

interface DailySweep {
  totalTriaged: number;
  items: Array<{
    signal: string;
    action: "escalated" | "queued" | "deferred" | "auto-refreshed";
    destination: "Now" | "Prep" | "Batch" | "Archive";
  }>;
}
```

**Interactions**:
- **"Open memo" button** → navigate to Decision Workbench with pre-loaded context
- **"View prep queue" button** → navigate to Inbox with "Prep" filter
- **Click sweep item** → navigate to signal detail
- **Sweep lane labels** (Now/Prep/Batch) → filter Inbox by lane

### 5. What Changed — Compact Cards (2×2)

**What it shows**: Top 4 entity-level changes with big numbers, "vs prior"
context, and specific implications.

**Backend source**:
```typescript
// From AgentDigestOutput.entitySpotlight[] merged with delta tracking
const changes = digestOutput.entitySpotlight
  .filter(e => e.keyInsight && hasDelta(e))
  .slice(0, 4)
  .map(entity => ({
    entity: entity.name,
    metric: extractMetric(entity.keyInsight),
    prior: getPriorValue(entity.name, metric),  // from entity history
    implication: generateImplication(entity, userContext),
    sources: entity.sources
  }));

interface ChangeCard {
  entityId: string;
  entity: string;              // "Anthropic"
  metric: string;              // "+40%"
  metricLabel: string;         // "across all plan levels, effective June 1"
  prior: string;               // "was: flat since Q3 2025 · $0.12/1K → $0.18/1K"
  implication: string;         // personalized to user's position
  sources: Source[];
}
```

**"vs prior" derivation**:
```typescript
// Entity history table tracks metric snapshots
const priorValue = await ctx.db.query("entityMetricHistory")
  .filter(q => q.eq(q.field("entityId"), entityId))
  .filter(q => q.eq(q.field("metricKey"), metricKey))
  .order("desc")
  .first();
```

**Interactions**:
- **Click card** → navigate to entity report page
- **Click metric number** → show time-series chart (last 90 days)
- **Click "vs prior"** → show full history of this metric
- **Click implication arrow** → open the specific action (memo, model, slide)

### 6. Competing Views — Why Now?

**What it shows**: Inline row of 3 competing explanations with evidence scores.

**Backend source**:
```typescript
// From competingExplanations (Phase 7 of narrative pipeline)
const views = await competingExplanations.generate({
  signals: digestOutput.signals,
  factChecks: digestOutput.factCheckFindings,
  entities: digestOutput.entitySpotlight
});

interface CompetingView {
  title: string;                    // "Demand-driven confidence"
  explanation: string;
  evidenceLevel: "grounded" | "mixed" | "speculative";
  checksPassing: number;            // e.g., 5
  checksTotal: number;              // always 6
  measurementApproach: string;
  falsificationCriteria: string;
  evidenceChecklist: EvidenceChecklist;
}
```

**Interactions**:
- **Click score chip** → expand to show full evidence checklist (6 checks)
- **Click view title** → expand explanation + falsification criteria
- **Hover score** → tooltip: "5 of 6 evidence checks passed"

### 7. What to Watch — Events Table

**What it shows**: Upcoming catalysts with decision triggers.

**Backend source**:
```typescript
// From entity calendar + signal-derived events
const events = useQuery(api.domains.calendar.upcomingCatalysts, {
  userId,
  entityIds: trackedEntityIds,
  horizon: 14  // days
});

interface CatalystEvent {
  eventId: string;
  entity: string;
  event: string;               // "Anthropic board call"
  date: string;                // "May 22"
  decisionTrigger: string;     // "Rebalance exposure if..."
  linkedActionIds: string[];   // actions that depend on this event
}
```

**Interactions**:
- **Click event** → navigate to entity timeline view
- **Click date** → add to calendar (ICS download)
- **Click decision trigger** → create/open the action linked to this event
- **Hover row** → highlight linked actions in the Actions table below

### 8. Actions Table

**What it shows**: Prioritized action items with ownership (You/Agent/You+Agent).

**Backend source**:
```typescript
// From AgentDigestOutput.actionItems[] + user task queue
const actions = digestOutput.actionItems
  .map(item => ({
    ...item,
    lead: determineOwnership(item),
    deadline: inferDeadline(item, events),
    priority: item.urgency
  }));

interface ActionItem {
  actionId: string;
  action: string;
  lead: "You" | "Agent" | "You + Agent";
  priority: "P0" | "P1" | "P2";
  deadline: string;
  linkedEventId?: string;      // links to What to Watch event
  linkedEntityId?: string;
  status: "pending" | "in_progress" | "done";
}
```

**Lead determination**:
```typescript
function determineOwnership(item: ActionItem): string {
  if (item.requiresHumanJudgment) return "You";
  if (item.canBeFullyAutomated) return "Agent";
  return "You + Agent";
}
```

**Interactions**:
- **Click action** → open action detail / start execution
- **Click "Agent" lead** → trigger agent to begin this action autonomously
- **Click "You + Agent"** → open collaborative workspace
- **Click priority badge** → cycle P0 → P1 → P2 (with confirmation)
- **Click deadline** → show linked event + adjust deadline
- **Checkbox** → mark action complete (animates out, updates status)

### 9. Sources — Footnotes

**What it shows**: Numbered source citations.

**Backend source**:
```typescript
// Aggregated from all sections' source references
const sources = deduplicateAndRank(
  ...digestOutput.signals.flatMap(s => s.sources ?? []),
  ...digestOutput.entitySpotlight.flatMap(e => e.sources ?? [])
);

interface SourceCitation {
  index: number;
  publication: string;         // "Anthropic Blog"
  title: string;               // "Enterprise Pricing Update"
  date: string;                // "May 15 2026"
  url?: string;
  tier: 1 | 2 | 3 | 4;        // TIER1=gov, TIER2=major news, etc.
}
```

**Interactions**:
- **Click source number** → scroll to/highlight where this source is cited
- **Click source title** → open URL in new tab
- **Hover** → show source tier badge + credibility indicator

### 10. Right Rail — Briefing Agent

**What it shows**: Conversational interface for follow-up questions about
today's brief, with entity list and thread history.

**Backend source**:
```typescript
// Agent panel connects to real-time chat backend
const agentConfig = {
  systemPrompt: buildBriefingAgentPrompt(digestOutput, userContext),
  tools: ["entity_lookup", "signal_search", "draft_memo", "check_entity_health"],
  context: {
    todaysBrief: digestOutput,
    userEntities: trackedEntities,
    recentThreads: last4Threads
  }
};
```

**Interactions**:
- **"What changed today?" CTA** → pre-filled query to agent
- **Quick action pills** → trigger specific agent workflows
- **Entity list click** → open entity detail in main content
- **Thread history click** → resume previous conversation
- **Composer submit** → send question to briefing agent with today's brief as context

## Carousel Mini Report Cards — Design Spec

The entity carousel at the top of the Home surface uses **mini versions of the
`rd-report-card`** from the Reports page. Key differences from the current
halo cards:

### Current (halo cards) → Target (mini report cards)

| Element | Halo Card (current) | Mini Report Card (target) |
|---------|--------------------|-----------------------------|
| Width | 172px | 220px |
| Header | Colored gradient band + icon | Status dot + entity name + kind chip |
| Body | 1-line signal text | 1-line headline + metrics row |
| Footer | None (hidden dock) | Updated timestamp + "Open →" link |
| Hover | Full dock overlay | Subtle lift + border accent |
| Data fields | entity, signal, sources, freshness | entity, kind, status, headline, sources, claims, updated |

### Mini Report Card HTML structure:
```html
<article class="mini-report-card" data-status="verified">
  <header class="mini-report-card__head">
    <span class="mini-report-card__dot" data-status="verified"></span>
    <span class="mini-report-card__entity">Anthropic</span>
    <span class="mini-report-card__kind">Diligence</span>
  </header>
  <p class="mini-report-card__headline">Enterprise tier repriced +40% across all SKUs</p>
  <div class="mini-report-card__metrics">
    <span><strong>14</strong> sources</span>
    <span><strong>5</strong> claims</span>
    <span class="mini-report-card__updated">2h ago</span>
  </div>
  <div class="mini-report-card__foot">
    <span class="mini-report-card__lens">Founder lens</span>
    <a class="mini-report-card__cta">Open &rarr;</a>
  </div>
</article>
```

### CSS sizing (compressed from rd-report-card):
```css
.mini-report-card {
  width: 220px;
  padding: 12px 14px;
  border: 1px solid var(--line-faint);
  border-radius: var(--r);
  background: var(--panel);
  cursor: pointer;
  flex-shrink: 0;
}
/* Entity: 12px (vs 14px), headline: 10px, metrics: 9px */
/* Hide: checkbox, full action buttons, style gallery */
/* Show: entity + dot, 1-line headline, metrics row, updated, "Open →" */
```

## Interactivity Summary

Every section of the daily brief supports 3 tiers of interaction:

| Tier | Gesture | Effect |
|------|---------|--------|
| **Read** | View | Static content renders from backend data |
| **Expand** | Click/hover | Detail overlay, evidence checklist, source preview |
| **Act** | Click CTA | Navigate to entity page, trigger agent, open memo, start action |

## Key Convex Tables

| Table | Purpose | Home Section |
|-------|---------|-------------|
| `dailyBriefSnapshots` | Raw feed data per day | Source for all sections |
| `dailyBriefMemories` | Features + signals | BLUF, What Changed |
| `entityMetricHistory` | Historical metrics | "vs prior" on change cards |
| `userEntityPositions` | User's relationship to entities | Position annotations |
| `signalTriage` | Overnight signal routing | Daily Sweep card |
| `actionItems` | User task queue | Actions table |
| `calendarEvents` | Upcoming catalysts | What to Watch |
| `chatThreads` | Conversation history | Right rail threads |

## File References

| File | Role |
|------|------|
| `convex/workflows/dailyMorningBrief.ts` | 6 AM orchestrator |
| `convex/domains/agents/digestAgent.ts` | AgentDigestOutput type |
| `convex/domains/research/narrative/actions/competingExplanations.ts` | Evidence-backed explanations |
| `convex/domains/research/narrative/adapters/briefAdapter.ts` | Signal → NarrativeEvent |
| `convex/domains/social/linkedinPosting.ts` | LinkedIn distribution |
| `src/features/redesign/surfaces/ReportsSurface.tsx` | Report card reference (rd-report-card) |
| `public/proto/home-v3.html` | Prototype implementation |
