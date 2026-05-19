# Home Daily Brief — Live Wiring & Agent Logic

> Companion to `HOME_DAILY_BRIEF_SPEC.md` (section-to-backend mapping).
> This document covers the **implementation-level wiring**: React hooks,
> Convex subscriptions, mutation handlers, agent orchestration pipelines,
> real-time update flows, and state machines that turn the static prototype
> (`public/proto/home-v3.html`) into a live production surface.

---

## 1. Data Flow Architecture

```
                    ┌───────────────────────────────────────────┐
                    │          6:00 AM UTC CRON                  │
                    │   dailyMorningBrief.ts (orchestrator)     │
                    │                                           │
                    │  ingest → dashboard → snapshot → memory   │
                    │            → generate AgentDigestOutput    │
                    └──────────────┬────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   dailyBriefSnapshots table   │
                    │   (one row per day per user)  │
                    │                               │
                    │  digestOutput: AgentDigestOutput
                    │  dateString: "2026-05-16"     │
                    │  storyCount, topSources, ...  │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
     │  Home Surface │  │ LinkedIn    │  │ Briefing     │
     │  React App    │  │ Post Gen    │  │ Agent (Rail) │
     │              │  │             │  │              │
     │ useHomeBrief │  │ dailyLinked │  │ buildBrief   │
     │   () hook    │  │ InPost.ts   │  │ AgentPrompt  │
     └──────────────┘  └─────────────┘  └──────────────┘
```

---

## 2. The Canonical Payload: AgentDigestOutput

Every section of the Home brief derives from a single canonical object.
This is the **single source of truth** — no section queries raw feeds directly.

```typescript
// convex/domains/narrative/types.ts
interface AgentDigestOutput {
  dateString: string;                          // "2026-05-16"
  narrativeThesis: string;                     // 1-sentence thesis for the day

  // ── BLUF (Need to Know) ──
  signals: Array<{
    title: string;                             // headline (bold text)
    url?: string;
    summary: string;                           // expanded detail text
    hardNumbers?: string;                      // "$0.18/1K", "+40%"
    directQuote?: string;
    sources?: Array<{ label: string; url: string; tier: 1|2|3|4 }>;
    reflection: {
      what: string;                            // what happened
      soWhat: string;                          // why it matters
      nowWhat: string;                         // what to do
    };
  }>;

  // ── Actions ──
  actionItems: Array<{
    persona: "You" | "Agent" | "You + Agent";  // lead ownership
    action: string;                            // action description
    priority?: "P0" | "P1" | "P2";
    deadline?: string;
    linkedEntityId?: string;
    requiresHumanJudgment?: boolean;
    canBeFullyAutomated?: boolean;
  }>;

  // ── What Changed (entity spotlight) ──
  entitySpotlight?: Array<{
    name: string;                              // "Anthropic"
    type: "company" | "person" | "market" | "product";
    keyInsight: string;                        // "Enterprise tier repriced +40%"
    fundingStage?: string;
    keyFacts: string[];
    sources: Array<{ label: string; url: string }>;
    metricDelta?: {
      metric: string;                          // "enterprise_price_per_1k"
      currentValue: string;                    // "$0.18/1K"
      priorValue: string;                      // "$0.12/1K"
      changePercent: string;                   // "+50%"
    };
  }>;

  // ── Competing Explanations (Why Now?) ──
  competingExplanations?: Array<{
    title: string;                             // "Demand-driven confidence"
    explanation: string;
    evidenceLevel: "grounded" | "mixed" | "speculative";
    evidenceChecklist: {
      hasPrimarySource: boolean;               // Tier 1/2 domain
      hasCorroboration: boolean;               // 2+ distinct sources
      hasFalsifiableClaim: boolean;            // testable criteria (LLM-derived)
      hasQuantitativeData: boolean;            // hard numbers present
      hasNamedAttribution: boolean;            // person/entity cited
      isReproducible: boolean;                 // followable URL
    };
    checksPassing: number;                     // count of true in checklist
    checksTotal: number;                       // always 6
    falsificationCriteria: string;             // "If X exceeds Y, thesis fails"
    measurementApproach: string;
  }>;

  // ── Fact Checks ──
  factCheckFindings?: Array<{
    claim: string;
    status: "verified" | "partially_verified" | "unverified" | "false";
    explanation: string;
    confidence: number;
  }>;

  // ── Narrative Framing ──
  narrativeFraming?: {
    dominantStory: string;
    attentionShare: number;
    underReportedAngle: string;
  };

  // ── Metadata ──
  storyCount: number;
  topSources: string[];
  topCategories: string[];
  processingTimeMs: number;
}
```

---

## 3. React Hook Architecture

### 3.1 Primary Hook: `useHomeBrief()`

```typescript
// src/features/home/hooks/useHomeBrief.ts
export function useHomeBrief(userId: string) {
  const today = toLocalDateString(new Date());  // "2026-05-16" in user's TZ

  // ── Core brief data (single subscription) ──
  const snapshot = useQuery(api.domains.narrative.getDailyBrief, {
    userId,
    dateString: today,
  });

  // ── Entity reports for carousel (separate subscription) ──
  const reports = useQuery(api.domains.reports.listRecent, {
    userId,
    limit: 12,
    orderBy: "updatedAt",
    statusFilter: ["verified", "watching", "review", "drafting", "live"],
  });

  // ── User's entity positions for annotations ──
  const positions = useQuery(api.domains.portfolio.userPositions, {
    userId,
  });

  // ── Upcoming events for What to Watch ──
  const events = useQuery(api.domains.calendar.upcomingCatalysts, {
    userId,
    entityIds: positions?.map(p => p.entityId) ?? [],
    horizon: 14,
  });

  // ── Signal triage for Daily Sweep ──
  const sweep = useQuery(api.domains.signals.dailySweep, {
    userId,
    dateString: today,
  });

  // Derive BLUF items with position annotations
  const blufItems = useMemo(() => {
    if (!snapshot?.digestOutput?.signals) return [];
    return snapshot.digestOutput.signals
      .sort((a, b) => significanceRank(b) - significanceRank(a))
      .slice(0, 4)
      .map(signal => ({
        ...signal,
        confidence: deriveConfidence(signal),
        position: findUserPosition(positions, signal),
      }));
  }, [snapshot, positions]);

  return {
    isLoading: snapshot === undefined,
    brief: snapshot?.digestOutput ?? null,
    blufItems,
    reports: reports ?? [],
    positions: positions ?? [],
    events: events ?? [],
    sweep: sweep ?? null,
    dateString: today,
    cutoffTime: snapshot?.cutoffUtc ?? "06:00 UTC",
  };
}
```

### 3.2 Confidence Derivation (Deterministic)

```typescript
// src/features/home/lib/evidenceScoring.ts

/**
 * Derives confidence level from evidence checklist.
 * Deterministic — same checklist always produces same confidence.
 * See: Anthropic "Building Effective Agents" (2024) — boolean gates.
 */
export function deriveConfidence(
  signal: SignalWithEvidence
): "verified" | "estimated" | "speculative" {
  const checklist = signal.evidenceChecklist;
  if (!checklist) return "speculative";

  const passing = [
    checklist.hasPrimarySource,
    checklist.hasCorroboration,
    checklist.hasFalsifiableClaim,
    checklist.hasQuantitativeData,
    checklist.hasNamedAttribution,
    checklist.isReproducible,
  ].filter(Boolean).length;

  if (passing >= 5) return "verified";
  if (passing >= 3) return "estimated";
  return "speculative";
}

/**
 * Maps confidence to badge color.
 * Deterministic lookup — no LLM involved.
 */
export const CONFIDENCE_COLORS = {
  verified:    { bg: "rgba(74,222,128,0.12)", text: "#4ade80", border: "rgba(74,222,128,0.25)" },
  estimated:   { bg: "rgba(251,191,36,0.12)", text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
  speculative: { bg: "rgba(248,113,113,0.12)", text: "#f87171", border: "rgba(248,113,113,0.25)" },
} as const;
```

### 3.3 Position Annotation Derivation

```typescript
// src/features/home/lib/positionAnnotation.ts

/**
 * Matches a signal to the user's entity graph to produce
 * the "You:" annotation under each BLUF item.
 *
 * Pattern: Claude Code "scratchpad-first" — derive from stored state,
 * never re-compute on render.
 */
export function findUserPosition(
  positions: UserEntityPosition[],
  signal: Signal
): PositionAnnotation | null {
  // Extract entity IDs mentioned in signal
  const entityKeys = extractEntityKeys(signal.title + " " + signal.summary);

  // Find matching user position
  const match = positions.find(p =>
    entityKeys.some(key =>
      p.entitySlug === key || p.entityName.toLowerCase().includes(key)
    )
  );

  if (!match) return null;

  return {
    relationship: match.relationship,       // "vendor dependency"
    exposure: formatCurrency(match.annualValue) + "/yr " + match.exposureType,
    context: match.activeContext,            // "partnership deal in negotiation"
  };
}
```

---

## 4. Convex Backend — Queries & Mutations

### 4.1 Daily Brief Query

```typescript
// convex/domains/narrative/queries.ts
export const getDailyBrief = query({
  args: {
    userId: v.string(),
    dateString: v.string(),
  },
  handler: async (ctx, args) => {
    // Fetch the canonical snapshot
    const snapshot = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date", q => q.eq("dateString", args.dateString))
      .first();

    if (!snapshot) return null;

    // Enrich with user-specific context
    const positions = await ctx.db
      .query("userEntityPositions")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();

    return {
      ...snapshot,
      digestOutput: enrichWithPositions(snapshot.digestOutput, positions),
    };
  },
});
```

### 4.2 Action Item Mutations

```typescript
// convex/domains/actions/mutations.ts

/**
 * Toggle action item completion.
 * Wires to the checkbox toggle in the ACTIONS table.
 *
 * Invariants:
 *   - HONEST_STATUS: returns actual new status, never assumes
 *   - DETERMINISTIC: same input always produces same state transition
 *   - BOUND: max 100 actions per user per day (eviction on overflow)
 */
export const toggleActionStatus = mutation({
  args: {
    actionId: v.id("actionItems"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action || action.userId !== args.userId) {
      throw new Error("Action not found or unauthorized");
    }

    const newStatus = action.status === "done" ? "pending" : "done";
    const completedAt = newStatus === "done" ? Date.now() : undefined;

    await ctx.db.patch(args.actionId, {
      status: newStatus,
      completedAt,
    });

    return { actionId: args.actionId, status: newStatus };
  },
});

/**
 * Delegate action to agent.
 * Wires to clicking "Agent" in the Lead column.
 *
 * This creates a background agent run scoped to the specific action.
 * Returns 202 + runId per the async reliability pattern.
 */
export const delegateToAgent = mutation({
  args: {
    actionId: v.id("actionItems"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action) throw new Error("Action not found");

    // Idempotency: reject if already delegated
    const existingRun = await ctx.db
      .query("agentRuns")
      .withIndex("by_action", q => q.eq("actionId", args.actionId))
      .filter(q => q.neq(q.field("status"), "completed"))
      .first();

    if (existingRun) {
      return { runId: existingRun._id, status: "already_running" };
    }

    // Create the agent run
    const runId = await ctx.db.insert("agentRuns", {
      userId: args.userId,
      actionId: args.actionId,
      type: "action_execution",
      status: "pending",
      tools: determineToolsForAction(action),
      context: {
        action: action.action,
        entityId: action.linkedEntityId,
        deadline: action.deadline,
      },
      createdAt: Date.now(),
    });

    // Schedule the agent execution
    await ctx.scheduler.runAfter(0, api.domains.agents.executeRun, {
      runId,
    });

    // Update action status
    await ctx.db.patch(args.actionId, {
      status: "in_progress",
      agentRunId: runId,
    });

    return { runId, status: "delegated" };
  },
});
```

### 4.3 Event Reminder / Calendar Integration

```typescript
// convex/domains/calendar/mutations.ts

/**
 * Generate ICS download for a catalyst event.
 * Wires to clicking a date in the What to Watch table.
 */
export const generateICS = action({
  args: {
    eventId: v.id("calendarEvents"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.runQuery(api.domains.calendar.getEvent, {
      eventId: args.eventId,
    });

    if (!event) throw new Error("Event not found");

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${toICSDate(event.date)}`,
      `SUMMARY:${event.event}`,
      `DESCRIPTION:Decision trigger: ${event.decisionTrigger}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    return { ics, filename: `${event.event.replace(/\s+/g, "_")}.ics` };
  },
});
```

---

## 5. Agent Logic — Briefing Agent (Right Rail)

### 5.1 System Prompt Construction

```typescript
// src/features/agents/lib/briefingAgentPrompt.ts

/**
 * Builds the system prompt for the briefing agent.
 * Pattern: "scratchpad-first" — agent receives structured context,
 * not raw feeds.
 *
 * The prompt includes:
 *   1. Today's digest (AgentDigestOutput)
 *   2. User's entity positions (what they care about)
 *   3. Recent threads (conversation continuity)
 *   4. Available tools
 *   5. Behavioral constraints
 */
export function buildBriefingAgentPrompt(
  digest: AgentDigestOutput,
  userContext: UserContext
): string {
  return `You are the NodeBench Briefing Agent for ${userContext.userName}.
Today is ${digest.dateString}. Your role: answer questions about today's
intelligence brief and help the user take action.

## Today's Brief Summary
Thesis: ${digest.narrativeThesis}
Stories: ${digest.storyCount} processed from ${digest.topSources.join(", ")}

## Key Signals (Need to Know)
${digest.signals.map((s, i) =>
  `${i+1}. ${s.title}
   Detail: ${s.summary}
   Evidence: ${deriveConfidence(s)} (${countChecks(s)}/6 checks)
   Sources: ${s.sources?.map(src => src.label).join(", ") ?? "none"}`
).join("\n\n")}

## User's Entity Positions
${userContext.positions.map(p =>
  `- ${p.entityName}: ${p.relationship} ($${p.annualValue}/yr) — ${p.activeContext}`
).join("\n")}

## Competing Explanations (Why Now?)
${(digest.competingExplanations ?? []).map(v =>
  `- ${v.title} (${v.checksPassing}/${v.checksTotal}): ${v.explanation}
   Falsify: ${v.falsificationCriteria}`
).join("\n")}

## Available Tools
- entity_lookup: Deep entity intelligence lookup
- signal_search: Search across today's signals and historical data
- draft_memo: Create a decision memo in the Workspace
- check_entity_health: Run health check on any tracked entity
- refresh_report: Trigger a fresh report generation for an entity

## Behavioral Constraints
- NEVER fabricate data. If you don't know, say so and suggest a tool call.
- ALWAYS cite source indices when referencing brief content: [1], [2], etc.
- When the user asks "what should I do?", reference the Actions table first.
- When asked about an entity, check their position first for personalization.
- Prefer brief, actionable responses. The user already read the brief.`;
}
```

### 5.2 Agent Tool Dispatch

```typescript
// convex/domains/agents/briefingTools.ts

/**
 * Tools available to the briefing agent.
 * Each tool follows the McpTool contract:
 *   { name, description, inputSchema, handler }
 *
 * Pattern: Orchestrator-Workers — briefing agent is the orchestrator,
 * each tool is a stateless worker.
 */
export const briefingTools = [
  {
    name: "entity_lookup",
    description: "Look up deep entity intelligence for any company/person",
    inputSchema: {
      type: "object",
      properties: {
        entityName: { type: "string" },
        sections: {
          type: "array",
          items: { type: "string", enum: ["overview", "funding", "team", "risks", "signals"] },
          default: ["overview", "signals"],
        },
      },
      required: ["entityName"],
    },
    handler: async (ctx, args) => {
      // Query entity from graph
      const entity = await ctx.runQuery(api.domains.entities.findByName, {
        name: args.entityName,
      });
      if (!entity) return { error: `Entity "${args.entityName}" not found in graph` };

      // Fetch requested sections
      const sections = await Promise.all(
        args.sections.map(section =>
          ctx.runQuery(api.domains.entities.getSection, {
            entityId: entity._id,
            section,
          })
        )
      );

      return { entity: entity.name, sections: Object.fromEntries(
        args.sections.map((s, i) => [s, sections[i]])
      )};
    },
  },

  {
    name: "signal_search",
    description: "Search signals from today's brief and historical data",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        dateRange: { type: "number", description: "Days back to search", default: 7 },
      },
      required: ["query"],
    },
    handler: async (ctx, args) => {
      const results = await ctx.runQuery(api.domains.signals.search, {
        query: args.query,
        daysBack: args.dateRange ?? 7,
        limit: 10,
      });
      return { matches: results.length, signals: results };
    },
  },

  {
    name: "draft_memo",
    description: "Create a decision memo in the Workspace with pre-filled context",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        context: { type: "string" },
        entityIds: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
    handler: async (ctx, args) => {
      const memoId = await ctx.runMutation(api.domains.workspace.createMemo, {
        title: args.title,
        body: args.context ?? "",
        entityIds: args.entityIds ?? [],
        source: "briefing_agent",
      });
      return { memoId, url: `/workspace/memo/${memoId}` };
    },
  },

  {
    name: "check_entity_health",
    description: "Run health check — source freshness, data completeness, drift detection",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string" } },
      required: ["entityId"],
    },
    handler: async (ctx, args) => {
      const health = await ctx.runQuery(api.domains.entities.healthCheck, {
        entityId: args.entityId,
      });
      return health;
    },
  },

  {
    name: "refresh_report",
    description: "Trigger fresh report generation for an entity (background)",
    inputSchema: {
      type: "object",
      properties: { entityId: { type: "string" } },
      required: ["entityId"],
    },
    handler: async (ctx, args) => {
      // Async reliability: returns 202 + runId
      const runId = await ctx.runMutation(api.domains.reports.triggerRefresh, {
        entityId: args.entityId,
        source: "briefing_agent",
      });
      return { runId, status: "queued", message: "Report refresh queued. Check status in ~2 min." };
    },
  },
];
```

### 5.3 Agent Conversation Flow (State Machine)

```
                  ┌──────────────────┐
                  │    IDLE           │
                  │  "What changed    │
                  │   today?" CTA     │
                  └────────┬─────────┘
                           │ user sends message
                           ▼
                  ┌──────────────────┐
                  │   THINKING        │
                  │  streaming dots   │
                  │  agent processes  │
                  └────────┬─────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     ┌────────────────┐       ┌────────────────┐
     │  DIRECT ANSWER  │       │  TOOL CALL      │
     │  (no tools)     │       │  entity_lookup  │
     │                 │       │  signal_search  │
     │  Stream text    │       │  draft_memo     │
     └────────┬───────┘       └────────┬───────┘
              │                         │ tool returns
              │                         ▼
              │               ┌────────────────┐
              │               │  SYNTHESIZE     │
              │               │  agent combines │
              │               │  tool result +  │
              │               │  brief context  │
              │               └────────┬───────┘
              │                         │
              └─────────┬───────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │    RESPONDED      │
              │  message visible  │
              │  back to IDLE     │
              └──────────────────┘
```

---

## 6. Real-Time Update Flows

### 6.1 Brief Generation → UI Update

```
CRON (6 AM UTC)
  │
  ├─ dailyMorningBrief.ts runs
  │   └─ Inserts row into dailyBriefSnapshots
  │
  ├─ Convex reactivity triggers
  │   └─ useQuery(getDailyBrief) re-fires
  │
  └─ React components re-render
      ├─ BLUFSection gets new signals[]
      ├─ ChangeCards gets new entitySpotlight[]
      ├─ CompetingViews gets new competingExplanations[]
      └─ ActionsTable gets new actionItems[]
```

No polling needed. Convex subscriptions push updates automatically when
the `dailyBriefSnapshots` row is inserted or updated.

### 6.2 Action Checkbox → Cross-Component Update

```
User clicks checkbox on Action #2
  │
  ├─ React onClick handler
  │   └─ useMutation(toggleActionStatus)({ actionId })
  │
  ├─ Convex mutation runs
  │   └─ Patches actionItems row: status = "done"
  │
  ├─ Convex reactivity triggers
  │   ├─ ActionsTable re-renders (row shows strikethrough)
  │   ├─ PortfolioExposure re-derives (deal count decrements)
  │   └─ BriefingAgent context refreshes (if thread is active)
  │
  └─ Optimistic update (immediate UI feedback)
      └─ useOptimisticUpdate patches local state before server round-trip
```

### 6.3 Agent Delegation → Background Run → Notification

```
User clicks "Agent" lead on action "Run Bug0 competitive teardown"
  │
  ├─ delegateToAgent mutation fires
  │   ├─ Creates agentRuns row (status: "pending")
  │   ├─ Schedules executeRun via ctx.scheduler.runAfter(0)
  │   └─ Returns { runId, status: "delegated" }
  │
  ├─ UI updates immediately:
  │   └─ Action row shows "Agent working..." spinner
  │
  ├─ Background agent executes:
  │   ├─ Creates scratchpad (layer 3 — ephemeral → persisted)
  │   ├─ Calls web_search, entity_lookup, etc.
  │   ├─ Writes findings to scratchpad sections
  │   ├─ Runs structuring pass → structured output
  │   └─ Updates agentRuns row: status = "completed"
  │
  ├─ Convex reactivity:
  │   ├─ Action row updates: "Agent done — review results"
  │   └─ Report card in carousel updates if entity data changed
  │
  └─ Right rail notification:
      └─ Briefing agent receives context update
          "I completed the Bug0 competitive teardown. Key findings: ..."
```

---

## 7. Watch ↔ Actions Cross-Linking (Bidirectional)

### 7.1 Data Model

```typescript
// Events and actions share linkedEventId / linkedActionIds
interface CatalystEvent {
  _id: string;
  event: string;
  date: string;
  decisionTrigger: string;
  linkedActionIds: string[];      // actions that depend on this event
}

interface ActionItem {
  _id: string;
  action: string;
  linkedEventId?: string;         // the event that triggers this action
  deadline: string;               // often derived from event date
}
```

### 7.2 UI Wiring

```typescript
// src/features/home/components/WatchTable.tsx

function WatchTable({ events, actions }: Props) {
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  // Derive which action IDs should be highlighted
  const highlightedActionIds = useMemo(() => {
    if (!hoveredEventId) return new Set<string>();
    const event = events.find(e => e._id === hoveredEventId);
    return new Set(event?.linkedActionIds ?? []);
  }, [hoveredEventId, events]);

  return (
    <>
      <table>
        {events.map(event => (
          <tr
            key={event._id}
            onMouseEnter={() => setHoveredEventId(event._id)}
            onMouseLeave={() => setHoveredEventId(null)}
          >
            <td>{event.event}</td>
            <td>{event.date}</td>
            <td>{event.decisionTrigger}</td>
          </tr>
        ))}
      </table>

      {/* Pass highlight set to ActionsTable */}
      <ActionsTable
        actions={actions}
        highlightedIds={highlightedActionIds}
      />
    </>
  );
}
```

---

## 8. Evidence Checklist — Deterministic Boolean Pipeline

The evidence checklist is the most important trust mechanism in the brief.
Every check is deterministic — no LLM involved in scoring.

```typescript
// convex/domains/narrative/evidenceChecklist.ts

/**
 * Computes the 6-boolean evidence checklist for a signal.
 * Deterministic: same input → same output.
 * See: grounded_eval.md — Layer 2 (claim-level grounding filter)
 *
 * These booleans are computed ONCE during brief generation and stored.
 * The UI just reads them — never recomputes.
 */
export function computeEvidenceChecklist(
  signal: RawSignal,
  sources: Source[]
): EvidenceChecklist {
  return {
    // Check 1: Primary source from Tier 1 or Tier 2 domain
    hasPrimarySource: sources.some(s =>
      TIER_1_DOMAINS.includes(extractDomain(s.url)) ||
      TIER_2_DOMAINS.includes(extractDomain(s.url))
    ),

    // Check 2: Corroboration from 2+ distinct source domains
    hasCorroboration:
      new Set(sources.map(s => extractDomain(s.url))).size >= 2,

    // Check 3: Falsifiable claim (LLM-derived, but stored as boolean)
    // This is the ONLY check involving an LLM, and it's computed
    // during brief generation, not at render time.
    hasFalsifiableClaim: signal.falsificationCriteria != null &&
      signal.falsificationCriteria.length > 10,

    // Check 4: Quantitative data (hard numbers present)
    hasQuantitativeData: /\$[\d,.]+|[\d.]+%|\d+[xX]|\d+\s*(billion|million|M|B|K)/
      .test(signal.title + " " + signal.summary),

    // Check 5: Named attribution (person or entity cited by name)
    hasNamedAttribution: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(signal.summary) ||
      signal.directQuote != null,

    // Check 6: Reproducible URL (at least one followable link)
    isReproducible: sources.some(s =>
      s.url && s.url.startsWith("http") && !s.url.includes("paywalled")
    ),
  };
}

// Tier domains for primary source check
const TIER_1_DOMAINS = [
  "sec.gov", "federalregister.gov", "arxiv.org", "patents.google.com",
  "congress.gov", "who.int", "worldbank.org",
];

const TIER_2_DOMAINS = [
  "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "nytimes.com",
  "theinformation.com", "techcrunch.com", "nature.com", "science.org",
];
```

---

## 9. Competing Explanations — Generation Pipeline

```typescript
// convex/domains/narrative/actions/competingExplanations.ts

/**
 * Generates 3 competing explanations for "Why Now?"
 *
 * Pattern: self-judge loop — generate candidates, score with evidence
 * checklist, rank by grounding level, return top 3.
 *
 * Pipeline:
 *   1. LLM generates 5 candidate explanations from signals + entities
 *   2. Each candidate gets evidence checklist scored deterministically
 *   3. Sort by checksPassing descending
 *   4. Take top 3 (ensuring diversity: at least one grounded, one speculative)
 *   5. Generate falsification criteria for each
 */
export async function generateCompetingExplanations(
  ctx: ActionCtx,
  args: {
    signals: Signal[];
    factChecks: FactCheck[];
    entities: EntitySpotlight[];
  }
): Promise<CompetingExplanation[]> {

  // Step 1: Generate candidates (LLM call)
  const candidates = await generateCandidates(ctx, args);

  // Step 2: Score each with deterministic evidence checklist
  const scored = candidates.map(candidate => ({
    ...candidate,
    evidenceChecklist: computeExplanationEvidence(candidate, args),
    checksPassing: countPassing(computeExplanationEvidence(candidate, args)),
    checksTotal: 6,
  }));

  // Step 3: Sort by evidence score
  scored.sort((a, b) => b.checksPassing - a.checksPassing);

  // Step 4: Select diverse top 3
  const selected = selectDiverseTop3(scored);

  // Step 5: Derive evidence level label
  return selected.map(s => ({
    ...s,
    evidenceLevel: s.checksPassing >= 5 ? "grounded" as const
                 : s.checksPassing >= 3 ? "mixed" as const
                 : "speculative" as const,
  }));
}
```

---

## 10. Export Actions (Footer Buttons)

### 10.1 Email Digest

```typescript
// convex/domains/distribution/actions/emailDigest.ts
export const sendEmailDigest = action({
  args: { userId: v.string(), dateString: v.string() },
  handler: async (ctx, args) => {
    const brief = await ctx.runQuery(api.domains.narrative.getDailyBrief, args);
    if (!brief) throw new Error("No brief for " + args.dateString);

    const html = renderBriefToEmail(brief.digestOutput);
    await sendEmail({
      to: args.userId,   // resolved to email via user profile
      subject: `NodeBench Daily Brief — ${args.dateString}`,
      html,
    });

    return { status: "sent" };
  },
});
```

### 10.2 Slack Integration

```typescript
// convex/domains/distribution/actions/slackPost.ts
export const postToSlack = action({
  args: {
    userId: v.string(),
    dateString: v.string(),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    const brief = await ctx.runQuery(api.domains.narrative.getDailyBrief, args);
    if (!brief) throw new Error("No brief");

    const blocks = renderBriefToSlackBlocks(brief.digestOutput);
    await slackApi.chat.postMessage({
      channel: args.channelId,
      blocks,
      text: `Daily Brief — ${args.dateString}`,
    });

    return { status: "posted" };
  },
});
```

### 10.3 Copy Link / PDF

```typescript
// Client-side handlers (no backend needed)

// Copy link: generates a shareable URL with the brief date
function handleCopyLink(dateString: string) {
  const url = `${window.location.origin}/?surface=ask&brief=${dateString}`;
  navigator.clipboard.writeText(url);
  toast("Link copied");
}

// PDF: uses browser print with print-optimized stylesheet
function handleExportPDF() {
  window.print();  // @media print stylesheet handles formatting
}
```

---

## 11. State Machines

### 11.1 Brief Loading States

```
┌─────────────┐  snapshot === undefined   ┌──────────────┐
│  LOADING     │◀────────────────────────│  PAGE MOUNT   │
│  skeleton    │                          └──────────────┘
│  shimmer     │
└──────┬──────┘
       │ snapshot !== null
       ▼
┌─────────────┐
│  READY       │  All sections render from digestOutput
│  interactive │
└──────┬──────┘
       │ user navigates to different date
       ▼
┌─────────────┐  fetch new snapshot
│  SWITCHING   │  old data visible + loading indicator
│  date        │
└──────┬──────┘
       │ new snapshot arrives
       ▼
┌─────────────┐
│  READY       │  New date's brief renders
└─────────────┘
```

### 11.2 Action Item States

```
┌──────────┐  delegateToAgent()  ┌─────────────┐
│  pending  │──────────────────▶│ in_progress  │
│  ○        │                    │  ◑ (spinner) │
└────┬─────┘                    └──────┬──────┘
     │ toggleActionStatus()            │ agent completes
     ▼                                 ▼
┌──────────┐                    ┌─────────────┐
│  done     │                    │  review      │
│  ● (fill) │                    │  agent done  │
│  strike   │                    │  needs human │
└──────────┘                    └─────────────┘
```

### 11.3 Report Card Status Lifecycle

```
┌──────────┐  agent runs    ┌──────────┐  sources     ┌──────────┐
│ drafting  │──────────────▶│ review    │─────────────▶│ verified │
│ ◌ blue   │                │ ◌ amber  │  confirm     │ ● green  │
└──────────┘                └──────────┘              └────┬─────┘
                                                          │ 7d no update
                                                          ▼
                                                    ┌──────────┐
                                                    │  stale    │
                                                    │  ◌ red    │
                                                    └──────────┘
```

---

## 12. Reliability Invariants

Per `.claude/rules/agentic_reliability.md`, every backend operation
in this pipeline must satisfy:

| Check | Applied to | Implementation |
|-------|-----------|----------------|
| **BOUND** | Action items per user/day | Max 100, FIFO eviction |
| **HONEST_STATUS** | delegateToAgent returns | Never 200 on failure; actual status returned |
| **HONEST_SCORES** | Evidence checklist | No hardcoded floors; checksPassing = actual count |
| **TIMEOUT** | Agent tool calls | AbortController, 30s per tool, 5min per run |
| **SSRF** | source.url in checklist | URL validated before any fetch |
| **BOUND_READ** | Entity lookup responses | 50KB cap on section data |
| **ERROR_BOUNDARY** | Brief rendering | Each section wrapped in error boundary |
| **DETERMINISTIC** | Evidence scoring | Same checklist → same confidence label, always |

---

## 13. Subscription Map (What Queries When)

| Component | Convex Query | Reactivity |
|-----------|-------------|------------|
| MiniReportCarousel | `reports.listRecent` | Re-renders when any report status changes |
| PortfolioStrip | `portfolio.dailyExposure` | Re-renders when positions or signals change |
| BLUFSection | `narrative.getDailyBrief` | Re-renders when daily snapshot updates |
| TwinActionCards | `narrative.getDailyBrief` + `signals.dailySweep` | Both subscriptions |
| ChangeCards | `narrative.getDailyBrief` | Derives from entitySpotlight[] |
| CompetingViews | `narrative.getDailyBrief` | Derives from competingExplanations[] |
| WatchTable | `calendar.upcomingCatalysts` | Re-renders when events added/changed |
| ActionsTable | `narrative.getDailyBrief` + `actions.userActions` | Combined subscription |
| SourcesFooter | `narrative.getDailyBrief` | Derived from all section sources |
| BriefingAgent | `chatThreads.recent` + brief context | Thread + brief combined |
| EntitySidebar | `entities.trackedByUser` | Re-renders when entity graph changes |

---

## Appendix A: File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `public/proto/home-v3.html` | Static prototype (all interactions JS-only) | ✅ Complete |
| `docs/architecture/HOME_DAILY_BRIEF_SPEC.md` | Section → backend mapping spec | ✅ Complete |
| `docs/architecture/HOME_DAILY_BRIEF_LIVE_WIRING.md` | This document (implementation wiring) | ✅ Complete |
| `convex/workflows/dailyMorningBrief.ts` | 6 AM orchestrator (brief generation) | ✅ Exists |
| `convex/workflows/dailyLinkedInPost.ts` | 10 AM distribution (LinkedIn 3-post thread) | ✅ Exists |
| `convex/domains/research/narrative/actions/competingExplanations.ts` | WHY NOW? generation | ✅ Exists |
| `convex/domains/research/briefGenerator.ts` | DailyBriefPayload generation (signals + actions) | ✅ Exists |
| `convex/domains/ai/morningDigestQueries.ts` | Digest data builder (feedItems, signals, prefs) | ✅ Exists |
| `convex/domains/product/home.ts` | Home snapshot query + pulse preview | ✅ Exists |
| `src/features/home/lib/briefTypes.ts` | Canonical type definitions (AgentDigestOutput etc.) | ✅ Created |
| `src/features/home/lib/evidenceScoring.ts` | Confidence derivation (deterministic, 40 tests) | ✅ Created |
| `src/features/home/lib/positionAnnotation.ts` | Position annotation matching | ✅ Created |
| `src/features/home/hooks/useHomeBrief.ts` | Primary React hook (adapter composition) | ✅ Created |
| `src/features/agents/lib/briefingAgentPrompt.ts` | Agent system prompt builder | ⬜ Phase 3 |
| `src/features/agents/components/FastAgentPanel/` | Right rail agent panel | ✅ Exists |

## Appendix B: Gap Analysis — Existing Backend vs. Wiring Doc

The wiring doc (sections 2-5) describes an idealized architecture.  The
existing Convex backend already implements most of it under different names.

| Wiring Doc Table | Actual Table | Shape Difference |
|-----------------|-------------|-----------------|
| `dailyBriefSnapshots.digestOutput` | `dailyBriefSnapshots.dashboardMetrics` | Adapter maps `keyStats` → `signals`, `topTrending` → thesis |
| `actionItems` | `actionDrafts` | Similar shape; `actionDrafts` has `status` + `userId` |
| `userEntityPositions` | `entityStates` + `entityProfiles` | Different granularity; positions are derived |
| `calendarEvents` | `calendarArtifacts` + `calendarDateMarkers` | Name mismatch; shape is compatible |
| `agentRuns` | Exists in agent domain | Compatible shape |

The `useHomeBrief()` hook acts as the adapter layer: it composes existing
SWR hooks (`useTodayPulseSwr`, `useLatestDailyBriefSnapshotSwr`) and maps
them to the canonical `AgentDigestOutput` shape.  As the backend migrates
toward the canonical shape, the adapter code shrinks.

## Appendix C: Migration from Prototype to Live

### Phase 1: Data Layer ✅ DONE
1. ✅ Create `briefTypes.ts` — canonical type definitions
2. ✅ Create `evidenceScoring.ts` — deterministic confidence (40 tests passing)
3. ✅ Create `positionAnnotation.ts` — entity key matching (21 tests passing)
4. ✅ Create `useHomeBrief()` hook — adapter composition over existing SWR hooks
5. ⬜ Wire `toggleActionStatus` mutation to checkbox (needs `actionDrafts` adapter)

### Phase 2: Components (Next)
6. Port `MiniReportCarousel` from prototype → React component
7. Port `BLUFSection` with expandable detail + evidence popup
8. Port `CompetingViews` with chip expansion
9. Port `ChangeCards` with metric history expansion
10. Port `WatchTable` ↔ `ActionsTable` cross-highlighting

### Phase 3: Agent Integration
11. Wire `BriefingAgent` right rail to real chat backend
12. Build `briefingAgentPrompt.ts` with the 5-tool dispatch
13. Wire `delegateToAgent` flow for action delegation
14. Add background run notification pathway

### Phase 4: Distribution
15. Wire footer export buttons (Email, Slack, Copy Link, PDF)
16. Add date picker for historical brief navigation
17. Add `@media print` stylesheet optimization
18. Add error boundaries per section
