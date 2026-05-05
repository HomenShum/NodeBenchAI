# Sprint Step 5 — Schema migration for Style profile + Agent patches

**Status:** Design complete. Implementation requires `npx convex dev` to register tables and codegen the API surface. Has not been executed because tables are net-new and the user has not given a green light to run schema migrations.

**Why this is its own doc:** Sprints S1-S4 ship by composing existing Convex tables (`batchAutopilotRuns`, `pipelineRuns`, `documents`). S5 is the first step that requires NEW tables — `styleProfiles`, `documentPatches`, and possibly `universes`. Schema changes need a deliberate migration moment.

## Tables to add

### 1. `styleProfiles`

Stores the operator's analyst manifest. Mirrors the YAML+markdown shape produced by [scripts/qa/inferStyle.ts](../../scripts/qa/inferStyle.ts).

```ts
styleProfiles: defineTable({
  userId: v.id("users"),
  /** Short label, e.g. "Founder / banker lens · v3" */
  label: v.string(),
  /** Slug, e.g. "founder_banker_lens_v3" */
  slug: v.string(),
  /** 1-2 sentence voice description */
  voice: v.string(),
  /** Ordered list of section headings ("Short answer", "Why it matters", ...) */
  sectionOrder: v.array(v.string()),
  /** Verbatim phrasings ("Take the call this week.") */
  recommendationPhrasings: v.array(v.string()),
  /** Risk dimensions the user checks */
  riskLens: v.array(v.string()),
  /** Source types the user favors */
  sourcePreferences: v.array(v.string()),
  /** Free-text rhythm description */
  sentenceRhythm: v.string(),
  /** 0..1 confidence in stability of the inference */
  confidence: v.number(),
  /** How many patterns the inferer extracted */
  patternsFound: v.number(),
  /** Provenance: source samples this was inferred from */
  provenance: v.array(v.object({
    label: v.string(),
    chars: v.number(),
    weightPct: v.number(),
  })),
  /** Model that did the inference */
  modelUsed: v.string(),
  inferredAt: v.number(),
  /** Soft-delete flag for swap workflow */
  isActive: v.boolean(),
})
.index("by_user_active", ["userId", "isActive"])
.index("by_user_inferred", ["userId", "inferredAt"]),
```

### 2. `documentPatches`

Bidirectional contract for chat/agent → document edits. Replaces the in-memory `pendingPatches` queue in [ReportNotebookView.tsx](../../src/features/redesign/components/ReportNotebookView.tsx).

```ts
documentPatches: defineTable({
  documentId: v.id("documents"),
  userId: v.id("users"),
  /** Who proposed the patch */
  source: v.union(v.literal("chat"), v.literal("agent")),
  /** Optional pipeline run that produced this patch (for audit) */
  pipelineRunId: v.optional(v.id("pipelineRuns")),
  batchAutopilotRunId: v.optional(v.id("batchAutopilotRuns")),
  /** Human-readable label for the patch row */
  label: v.string(),
  /** 1-line preview shown in the pending queue */
  preview: v.string(),
  /** Full HTML to be inserted (NodeBench TipTap-compatible) */
  html: v.string(),
  /** "pending" | "accepted" | "rejected" | "edited_then_accepted" */
  status: v.string(),
  proposedAt: v.number(),
  /** When status changed off "pending" */
  resolvedAt: v.optional(v.number()),
  /** If user edited before accepting, the final HTML they saved */
  acceptedHtml: v.optional(v.string()),
})
.index("by_document_status", ["documentId", "status"])
.index("by_user_status", ["userId", "status"])
.index("by_pipelineRun", ["pipelineRunId"]),
```

### 3. `universes` (Sprint S4 follow-up — needed for live ReportsSurface universe sections)

```ts
universes: defineTable({
  userId: v.id("users"),
  name: v.string(),
  slug: v.string(),
  /** Default style applied to reports in this universe */
  styleId: v.optional(v.id("styleProfiles")),
  /** Default rubric (free-text label) */
  rubric: v.string(),
  /** Whether the autopilot scheduler should run this universe on cadence */
  monitoring: v.boolean(),
  /** Cadence in minutes (e.g. 720 = twice daily) */
  monitoringMinutes: v.optional(v.number()),
  entityIds: v.array(v.string()),
  entityCount: v.number(),
  refreshedAt: v.number(),
})
.index("by_user_monitoring", ["userId", "monitoring"]),
```

## Convex actions / mutations to add

### `convex/domains/styleProfile/`

```ts
// queries.ts
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("styleProfiles")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("isActive", true))
      .unique();
  },
});

// actions.ts
export const infer = action({
  args: {
    samples: v.array(v.object({ label: v.string(), text: v.string() })),
  },
  handler: async (ctx, args) => {
    // Mirror scripts/qa/inferStyle.ts exactly
    const result = await runPiOrAiSdkCompletion({
      systemPrompt: STYLE_INFERENCE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(args.samples) }],
      tier: "free",                    // gemini-3.1-flash-lite
      taskCategory: "summarization",
      responseSchema: STYLE_INFERENCE_SCHEMA,
    });
    // Persist via ctx.runMutation(internal.styleProfile.mutations.upsertProfile, { ... });
    return result;
  },
});

// mutations.ts
export const upsertProfile = internalMutation({ ... });
```

### `convex/domains/documentPatches/`

```ts
// mutations.ts
export const proposePatch = mutation({
  args: {
    documentId: v.id("documents"),
    source: v.union(v.literal("chat"), v.literal("agent")),
    label: v.string(),
    preview: v.string(),
    html: v.string(),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    return await ctx.db.insert("documentPatches", {
      ...args,
      userId,
      status: "pending",
      proposedAt: Date.now(),
    });
  },
});

export const acceptPatch = mutation({ ... });
export const rejectPatch = mutation({ ... });

// queries.ts
export const listPending = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documentPatches")
      .withIndex("by_document_status", (q) =>
        q.eq("documentId", args.documentId).eq("status", "pending"))
      .order("desc")
      .take(20);
  },
});
```

## Migration runbook (when ready to ship)

1. `git checkout -b sprint/s5-schema`
2. Edit [convex/schema.ts](../../convex/schema.ts):
   - Add the three table definitions above (styleProfiles, documentPatches, universes)
3. Create directories + files:
   ```
   convex/domains/styleProfile/queries.ts
   convex/domains/styleProfile/mutations.ts
   convex/domains/styleProfile/actions.ts
   convex/domains/documentPatches/queries.ts
   convex/domains/documentPatches/mutations.ts
   ```
4. `npx convex dev --once --typecheck=enable` — registers tables and indexes.
5. `npx convex codegen` — refreshes `convex/_generated/api.d.ts`.
6. Wire client hooks:
   - `src/features/redesign/hooks/useStyleProfileLive.ts` — replace `MeSurface` fixture
   - `src/features/redesign/hooks/usePendingPatches.ts` — replace `ReportNotebookView` in-memory queue
   - `src/features/redesign/hooks/useUniversesLive.ts` — replace `ReportsSurface.universes` import
7. Verification floor:
   ```
   npx tsc --noEmit
   npm run build
   npx tsx scripts/qa/inferStyle.ts --self      # ensure inferer still works
   npx playwright test tests/e2e/full-ui-dogfood.spec.ts
   npm run qa:redesign                           # multi-persona Gemini judge
   ```
8. Seed the dogfood user's style profile from [scripts/qa/inferStyle.ts](../../scripts/qa/inferStyle.ts) output so the demo works for any visitor.

## Why we stopped before merging

- Sprints S1-S4 ship as additive composition over existing tables — no schema migration risk.
- S5 introduces three new tables with foreign keys (`styleProfiles → users`, `documentPatches → documents → users`, `universes → styleProfiles`). That's a real migration moment that needs:
  1. User confirmation
  2. A clean local Convex run
  3. Codegen to land on the same branch as the UI wiring
- Half-shipping the hook without the table makes `useQuery` return `undefined` forever and the live indicator pill never flips. Better to ship as one atomic piece.

## What's already in place for S5

- [scripts/qa/inferStyle.ts](../../scripts/qa/inferStyle.ts) — full reference implementation of the Gemini call
- [scripts/qa/inferStyle.ts:30](../../scripts/qa/inferStyle.ts:30) `SELF_SAMPLES` — seed corpus
- [scripts/qa/inferStyle.ts:83](../../scripts/qa/inferStyle.ts:83) `SCHEMA` — already in `responseSchema` shape
- The `StyleProfileSection` UI in [MeSurface.tsx](../../src/features/redesign/surfaces/MeSurface.tsx) already consumes the `MemoStyle` shape that maps 1:1 to the `styleProfiles` table
- The `pendingPatches` consumer in [ReportNotebookView.tsx:84](../../src/features/redesign/components/ReportNotebookView.tsx:84) already takes the `{ source, label, preview, patch.html }` shape

Once tables land, the UI wires up in <30 lines of new hook code per surface.
