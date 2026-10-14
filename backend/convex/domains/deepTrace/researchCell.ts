"use node";

/**
 * DeepTrace Runtime Re-Analysis Cell
 *
 * A bounded re-analysis sub-process that triggers when a DeepTrace investigation
 * has low confidence, low dimension coverage, or sparse evidence. It queries
 * existing DeepTrace state (dimension profiles, relationship graph, signals,
 * causal chains) through parallel branches to surface gaps, counter-hypotheses,
 * and coverage deficiencies.
 *
 * SCOPE: This cell does NOT acquire new external evidence or ingest new sources.
 * It re-analyzes and cross-references existing DeepTrace data to identify what
 * is missing and where the current assessment is weakest. For actual evidence
 * expansion, use the due-diligence orchestrator or narrative ingestion pipeline.
 *
 * Structure:
 *   planner → 2-4 parallel re-analysis branches → judge → merger
 *
 * Budget defaults:
 *   - max 3 parallel branches
 *   - max 2 refinement rounds
 *   - max 90 seconds wall clock
 *   - fixed tool-call budget per branch
 *
 * Output stays in standard DeepTrace format.
 */

import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { v } from "convex/values";

import {
  RESEARCH_CELL_DEFAULTS, shouldTriggerResearchCell, planResearchBranches, judgeBranches, mergeBranchResults,
  type TriggerInput, type ResearchBranch, type BranchResult, type ResearchCellOutput,
} from "./researchCellPolicy";
export * from "./researchCellPolicy";

// ---------------------------------------------------------------------------
// Convex action: full research cell execution
// ---------------------------------------------------------------------------

export const runResearchCell = internalAction({
  args: {
    entityKey: v.string(),
    entityName: v.optional(v.string()),
    confidence: v.number(),
    dimensionCoverage: v.number(),
    durableSourceCount: v.number(),
    operatorRequested: v.optional(v.boolean()),
    existingFacts: v.optional(v.array(v.string())),
    maxBranches: v.optional(v.number()),
    maxRefinementRounds: v.optional(v.number()),
    maxWallClockMs: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ResearchCellOutput> => {
    const triggerInput: TriggerInput = {
      confidence: args.confidence,
      dimensionCoverage: args.dimensionCoverage,
      durableSourceCount: args.durableSourceCount,
      operatorRequested: args.operatorRequested ?? false,
    };

    const { trigger, reason } = shouldTriggerResearchCell(triggerInput);

    if (!trigger) {
      return {
        triggered: false,
        triggerReason: null,
        branchCount: 0,
        refinementRounds: 0,
        totalWallClockMs: 0,
        observedFacts: [],
        relationships: [],
        dimensionProfile: null,
        strongestHypothesis: null,
        counterHypothesis: null,
        recommendation: null,
        limitations: [],
        receipts: [],
        evidenceBundle: [],
      };
    }

    const maxBranches = Math.min(args.maxBranches ?? RESEARCH_CELL_DEFAULTS.maxBranches, RESEARCH_CELL_DEFAULTS.maxBranches);
    const maxRounds = Math.min(args.maxRefinementRounds ?? RESEARCH_CELL_DEFAULTS.maxRefinementRounds, RESEARCH_CELL_DEFAULTS.maxRefinementRounds);
    const wallClockBudget = Math.min(args.maxWallClockMs ?? RESEARCH_CELL_DEFAULTS.maxWallClockMs, RESEARCH_CELL_DEFAULTS.maxWallClockMs);

    const startMs = Date.now();
    const existingFacts = args.existingFacts ?? [];
    const branches = planResearchBranches(reason!, args.entityKey, existingFacts, maxBranches);

    // Execute branches — gather data from existing DeepTrace infrastructure
    const branchResults: BranchResult[] = [];
    let refinementRound = 0;

    for (refinementRound = 0; refinementRound < maxRounds; refinementRound++) {
      if (Date.now() - startMs > wallClockBudget) break;

      const pendingBranches = refinementRound === 0
        ? branches
        : branches.filter((b) => {
            const existing = branchResults.find((r) => r.branchId === `${b.branchId}-r${refinementRound - 1}`);
            return !existing || existing.usefulness < 0.5;
          });

      if (pendingBranches.length === 0) break;

      // Execute branches in parallel against existing DeepTrace queries
      const roundResults = await Promise.all(
        pendingBranches.map(async (branch) => {
          const branchStart = Date.now();
          const branchId = refinementRound === 0 ? branch.branchId : `${branch.branchId}-r${refinementRound}`;

          try {
            const result = await executeBranch(ctx, args.entityKey, args.entityName, branch);
            return {
              ...result,
              branchId,
              wallClockMs: Date.now() - branchStart,
            };
          } catch {
            return {
              branchId,
              strategy: branch.strategy,
              observedFacts: [],
              relationships: [],
              hypothesis: null,
              counterHypothesis: null,
              evidenceRefs: [],
              usefulness: 0,
              toolCallCount: 0,
              wallClockMs: Date.now() - branchStart,
            } satisfies BranchResult;
          }
        }),
      );

      branchResults.push(...roundResults);
    }

    const ranked = judgeBranches(branchResults);
    const merged = mergeBranchResults(ranked, args.entityKey);

    // Fetch the real dimension profile so the output contract is complete
    let dimensionProfile: Record<string, number> | null = null;
    try {
      const profile = await ctx.runQuery(api.domains.deepTrace.dimensions.getDimensionProfile, {
        entityKey: args.entityKey,
      });
      if (profile && (profile as any).dimensionState) {
        const state = (profile as any).dimensionState as Record<string, Record<string, any>>;
        dimensionProfile = {};
        for (const [family, metrics] of Object.entries(state)) {
          for (const [name, metric] of Object.entries(metrics)) {
            if (typeof metric?.score === "number") {
              dimensionProfile[`${family}.${name}`] = metric.score;
            }
          }
        }
      }
    } catch {
      // Non-fatal — profile may not exist yet
    }

    return {
      triggered: true,
      triggerReason: reason,
      branchCount: branches.length,
      refinementRounds: refinementRound,
      totalWallClockMs: Date.now() - startMs,
      ...merged,
      dimensionProfile,
    };
  },
});

// ---------------------------------------------------------------------------
// Branch execution — queries existing DeepTrace data
// ---------------------------------------------------------------------------

async function executeBranch(
  ctx: any,
  entityKey: string,
  entityName: string | undefined,
  branch: ResearchBranch,
): Promise<BranchResult> {
  let toolCalls = 0;
  const observedFacts: string[] = [];
  const relationships: BranchResult["relationships"] = [];
  const evidenceRefs: BranchResult["evidenceRefs"] = [];
  let hypothesis: string | null = null;
  let counterHypothesis: string | null = null;

  switch (branch.strategy) {
    case "evidence_gap_fill": {
      // Pull existing evidence and identify gaps
      const bundle = await ctx.runQuery(api.domains.deepTrace.dimensions.getDimensionBundle, {
        entityKey,
        evidenceLimit: 40,
      });
      toolCalls++;

      const evidence = (bundle as any)?.evidence ?? [];
      const unavailable = evidence.filter((e: any) => e.availability === "unavailable");
      observedFacts.push(`${evidence.length} evidence rows found, ${unavailable.length} unavailable`);

      // Pull relationship graph for additional evidence
      const graph = await ctx.runQuery(api.domains.knowledge.relationshipGraph.getEntityGraph, {
        entityKey,
        entityName,
        limit: 12,
      });
      toolCalls++;

      for (const edge of (graph as any)?.edges ?? []) {
        relationships.push({
          fromEntity: edge.fromEntityKey ?? entityKey,
          toEntity: edge.toEntityKey ?? "unknown",
          type: edge.relationshipType ?? "related",
          confidence: edge.confidence ?? 0.5,
          evidence: edge.summary ?? "",
        });
        if (edge.sourceRefs) {
          for (const ref of edge.sourceRefs.slice(0, 3)) {
            evidenceRefs.push({ label: ref.label, href: ref.href, kind: ref.kind });
          }
        }
      }

      hypothesis = relationships.length > 0
        ? `Entity ${entityKey} has ${relationships.length} documented relationships that may inform missing evidence.`
        : null;
      break;
    }

    case "counter_hypothesis": {
      // Pull signals and causal chains to generate counter-hypotheses
      const signals = await ctx.runQuery(api.domains.temporal.queries.getSignalsByEntity, {
        entityKey,
        limit: 8,
      });
      toolCalls++;

      const chains = await ctx.runQuery(api.domains.temporal.queries.getCausalChainsByEntity, {
        entityKey,
        limit: 6,
      });
      toolCalls++;

      for (const signal of (signals as any) ?? []) {
        observedFacts.push(`Signal: ${signal.label ?? signal.signalKey} = ${signal.value ?? "N/A"}`);
      }

      const chainList = (chains as any) ?? [];
      if (chainList.length > 0) {
        hypothesis = `Primary causal narrative: ${chainList[0]?.summary ?? "unknown"}`;
        counterHypothesis = chainList.length > 1
          ? `Alternative chain: ${chainList[1]?.summary ?? "no alternative"}`
          : "No alternative causal chain available — single-narrative risk.";
      }
      break;
    }

    case "dimension_coverage": {
      // Check which dimension families are missing data
      const profile = await ctx.runQuery(api.domains.deepTrace.dimensions.getDimensionProfile, {
        entityKey,
      });
      toolCalls++;

      const state = (profile as any)?.dimensionState;
      if (state) {
        for (const [family, metrics] of Object.entries(state) as [string, Record<string, any>][]) {
          const metricEntries = Object.entries(metrics);
          const available = metricEntries.filter(([, m]) => m.availability !== "unavailable");
          observedFacts.push(`${family}: ${available.length}/${metricEntries.length} metrics available`);
          if (available.length < metricEntries.length) {
            hypothesis = hypothesis ?? `Dimension family '${family}' has coverage gaps that may reduce profile reliability.`;
          }
        }
      }
      break;
    }

    case "source_diversification": {
      // Pull the full dimension profile which includes sourceRefs with
      // semantic `kind` fields (e.g. "news", "filing", "source_artifact"),
      // not hashed sourceRefIds which are opaque identifiers.
      const profile = await ctx.runQuery(api.domains.deepTrace.dimensions.getDimensionProfile, {
        entityKey,
      });
      toolCalls++;

      const sourceRefs: Array<{ label: string; kind?: string; href?: string }> =
        (profile as any)?.sourceRefs ?? [];
      const sourceKinds = new Set<string>();
      for (const ref of sourceRefs) {
        const kind = ref.kind ?? "unknown";
        sourceKinds.add(kind);
        evidenceRefs.push({ label: ref.label, href: ref.href, kind });
      }

      // Also pull relationship graph sourceRefs for additional diversity signal
      const graph = await ctx.runQuery(api.domains.knowledge.relationshipGraph.getEntityGraph, {
        entityKey,
        entityName,
        limit: 12,
      });
      toolCalls++;

      for (const edge of (graph as any)?.edges ?? []) {
        for (const ref of (edge.sourceRefs ?? []).slice(0, 3)) {
          const kind = ref.kind ?? "unknown";
          sourceKinds.add(kind);
          evidenceRefs.push({ label: ref.label, href: ref.href, kind });
        }
      }

      observedFacts.push(
        `Source type diversity: ${sourceKinds.size} distinct kinds detected (${[...sourceKinds].join(", ")})`,
      );
      if (sourceKinds.size < 3) {
        hypothesis = `Low source diversity (${sourceKinds.size} types: ${[...sourceKinds].join(", ")}) — findings may be single-source biased.`;
        counterHypothesis = "Source diversity may be adequate if the available sources are high-quality and cross-corroborated.";
      }
      break;
    }
  }

  // Compute usefulness based on what was gathered
  const factScore = Math.min(observedFacts.length / 5, 1) * 0.3;
  const relScore = Math.min(relationships.length / 5, 1) * 0.3;
  const evidenceScore = Math.min(evidenceRefs.length / 3, 1) * 0.2;
  const hypothesisScore = (hypothesis ? 0.1 : 0) + (counterHypothesis ? 0.1 : 0);
  const usefulness = factScore + relScore + evidenceScore + hypothesisScore;

  return {
    branchId: branch.branchId,
    strategy: branch.strategy,
    observedFacts,
    relationships,
    hypothesis,
    counterHypothesis,
    evidenceRefs,
    usefulness,
    toolCallCount: toolCalls,
    wallClockMs: 0, // Set by caller
  };
}
