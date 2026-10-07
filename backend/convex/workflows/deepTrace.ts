"use node";

import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";

function buildMissionWorkflow(title: string, summary: string, tierTwo = true) {
  return {
    title,
    summary,
    defaultWorkflow: [
      "plan_decompose_mission",
      "parallel_due_diligence_subtasks",
      "record_execution_step",
      "record_execution_decision",
      "judge_verify_subtask",
      "build_causal_chain",
      "merge_compose_output",
      tierTwo ? "sniff_record_human_review" : null,
    ].filter(Boolean),
    orchestrationNotes: [
      "Mission harness remains the orchestration plane for non-trivial investigations.",
      "Convex is the durable store for relationships, world events, causal chains, and watchlists.",
      "Use sniff-checks for tier-2 claims before publish or operator-visible merge steps.",
    ],
  };
}

export const runEntityIntelligenceMission = action({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
    researchCell: v.optional(v.boolean()),
    forceResearchCell: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const [graph, ownership, supplyChain, timeline, signals, causalChains] = await Promise.all([
      ctx.runQuery(api.domains.knowledge.relationshipGraph.getEntityGraph, {
        entityKey: args.entityKey,
        entityName: args.entityName,
        limit: 24,
      }),
      ctx.runQuery(api.domains.knowledge.relationshipGraph.getOwnershipSnapshot, {
        entityKey: args.entityKey,
        entityName: args.entityName,
      }),
      ctx.runQuery(api.domains.knowledge.relationshipGraph.getSupplyChainView, {
        entityKey: args.entityKey,
        entityName: args.entityName,
      }),
      ctx.runQuery(api.domains.knowledge.relationshipGraph.getRelationshipTimeline, {
        entityKey: args.entityKey,
        entityName: args.entityName,
        limit: 20,
      }),
      ctx.runQuery(api.domains.temporal.queries.getSignalsByEntity, {
        entityKey: args.entityKey,
        limit: 8,
      }),
      ctx.runQuery(api.domains.temporal.queries.getCausalChainsByEntity, {
        entityKey: args.entityKey,
        limit: 6,
      }),
    ]);

    // Optionally enable the research cell for threshold-based bounded re-analysis,
    // or force it for operator-driven deeper review.
    let researchCellOutput: { triggered: boolean; [key: string]: unknown } | null = null;
    if (args.researchCell || args.forceResearchCell) {
      const bundle = await ctx.runQuery(api.domains.deepTrace.dimensions.getDimensionBundle, {
        entityKey: args.entityKey,
        evidenceLimit: 40,
      });
      const profile = (bundle as any)?.profile;
      const confidence = profile?.confidence ?? 0;
      const coverageRatio = profile?.coverageRatio ?? 0;

      // Count durable evidence sources by collecting unique sourceRefIds from
      // evidence rows — not graph edges, which measure relationship density.
      const evidenceRows: any[] = (bundle as any)?.evidence ?? [];
      const uniqueSourceRefs = new Set<string>();
      for (const row of evidenceRows) {
        for (const refId of row.sourceRefIds ?? []) {
          uniqueSourceRefs.add(refId);
        }
      }
      const durableSourceCount = uniqueSourceRefs.size;

      researchCellOutput = await ctx.runAction(
        internal.domains.deepTrace.researchCell.runResearchCell,
        {
          entityKey: args.entityKey,
          entityName: args.entityName,
          confidence,
          dimensionCoverage: coverageRatio,
          durableSourceCount,
          operatorRequested: args.forceResearchCell ?? false,
          existingFacts: ((signals as any) ?? [])
            .slice(0, 5)
            .map((s: any) => `${s.label ?? s.signalKey}: ${s.value ?? "N/A"}`),
        },
      );
    }

    return {
      mission: buildMissionWorkflow(
        `Entity intelligence mission for ${args.entityName ?? args.entityKey}`,
        "Unifies relationship mapping, ownership, supply chain, and causal analysis into one DeepTrace investigation.",
      ),
      graph,
      ownership,
      supplyChain,
      timeline,
      signals,
      causalChains,
      researchCell: researchCellOutput,
      nextActions: [
        "Verify supplier and customer claims with filing-grade evidence.",
        "Escalate investor and board network inferences through judge and human sniff-check.",
        "Build or refresh causal chains where world events affect this entity.",
        ...(researchCellOutput?.triggered
          ? ["Review research cell findings and merge into investigation output."]
          : []),
      ],
    };
  },
});

export const runWorldMonitorMission = action({
  args: {
    topic: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    entityKey: v.optional(v.string()),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"))),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const [snapshot, cluster] = await Promise.all([
      ctx.runQuery(api.domains.monitoring.worldMonitor.getMapSnapshot, {
        status: "open",
        limit: 120,
      }),
      ctx.runQuery(api.domains.monitoring.worldMonitor.getEventCluster, {
        topic: args.topic,
        countryCode: args.countryCode,
        entityKey: args.entityKey,
        severity: args.severity,
        limit: 40,
      }),
    ]);

    return {
      mission: buildMissionWorkflow(
        "World monitor mission",
        "Tracks open-source world events, clusters them by geography and topic, and links them into company-impact causal analysis.",
      ),
      snapshot,
      cluster,
      filters: args,
      nextActions: [
        "Promote high-severity world events into causal chain candidates.",
        "Link affected entities before merge so trace replay remains navigable.",
        "Refresh relevant watchlists when thresholded events accumulate.",
      ],
    };
  },
});

export const refreshWatchlist = action({
  args: {
    watchlistKey: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const digest = await ctx.runQuery(api.domains.monitoring.worldMonitor.getWatchlistDigest, {
      status: "active",
    });
    const watchlist = digest.watchlists.find((item: any) => item.watchlistKey === args.watchlistKey) ?? null;

    return {
      mission: buildMissionWorkflow(
        `Refresh watchlist ${args.watchlistKey}`,
        "Refreshes a DeepTrace watchlist, reviews thresholded events, and packages any causal deltas for operator review.",
        false,
      ),
      watchlist,
      availableWatchlists: digest.watchlists,
      refreshStatus: watchlist
        ? {
            watchlistKey: watchlist.watchlistKey,
            alertEventCount: watchlist.alertEventCount,
            matchingEventCount: watchlist.matchingEventCount,
            lastMissionRunId: watchlist.lastMissionRunId ?? null,
          }
        : {
            watchlistKey: args.watchlistKey,
            missing: true,
          },
    };
  },
});
