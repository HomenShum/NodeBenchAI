/**
 * Temporal Domain Mutations
 * CRUD operations for all 5 temporal tables:
 * - timeSeriesObservations
 * - timeSeriesSignals
 * - causalChains
 * - zeroDraftArtifacts
 * - proofPacks
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/* ================================================================== */
/* SOURCE REF VALIDATOR (shared)                                       */
/* ================================================================== */

const sourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  lineStart: v.optional(v.number()),
  lineEnd: v.optional(v.number()),
});

/* ================================================================== */
/* TIME SERIES OBSERVATIONS                                            */
/* ================================================================== */

export const insertObservation = mutation({
  args: {
    streamKey: v.string(),
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    sourceId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    entityKey: v.optional(v.string()),
    observationType: v.union(
      v.literal("numeric"),
      v.literal("categorical"),
      v.literal("event"),
      v.literal("text"),
    ),
    observedAt: v.number(),
    ingestionRunId: v.optional(v.string()),
    valueNumber: v.optional(v.number()),
    valueText: v.optional(v.string()),
    valueJson: v.optional(v.any()),
    units: v.optional(v.string()),
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    sourceExcerpt: v.optional(v.string()),
    sourceRefs: v.optional(v.array(sourceRefValidator)),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("timeSeriesObservations", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const batchInsertObservations = internalMutation({
  args: {
    observations: v.array(v.object({
      streamKey: v.string(),
      sourceType: v.union(
        v.literal("slack"),
        v.literal("github"),
        v.literal("jira"),
        v.literal("web"),
        v.literal("document"),
        v.literal("manual"),
        v.literal("system"),
      ),
      sourceId: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      entityKey: v.optional(v.string()),
      observationType: v.union(
        v.literal("numeric"),
        v.literal("categorical"),
        v.literal("event"),
        v.literal("text"),
      ),
      observedAt: v.number(),
      ingestionRunId: v.optional(v.string()),
      valueNumber: v.optional(v.number()),
      valueText: v.optional(v.string()),
      valueJson: v.optional(v.any()),
      units: v.optional(v.string()),
      headline: v.optional(v.string()),
      summary: v.optional(v.string()),
      sourceExcerpt: v.optional(v.string()),
      sourceRefs: v.optional(v.array(sourceRefValidator)),
      tags: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, { observations }) => {
    const now = Date.now();
    const ids: Id<"timeSeriesObservations">[] = [];
    for (const obs of observations) {
      const id = await ctx.db.insert("timeSeriesObservations", {
        ...obs,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

/* ================================================================== */
/* TIME SERIES SIGNALS                                                 */
/* ================================================================== */

export const insertSignal = mutation({
  args: {
    signalKey: v.string(),
    streamKey: v.string(),
    entityKey: v.optional(v.string()),
    signalType: v.union(
      v.literal("momentum"),
      v.literal("regime_shift"),
      v.literal("anomaly"),
      v.literal("causal_hint"),
      v.literal("opportunity_window"),
      v.literal("risk_window"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("watch"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    detectedAt: v.number(),
    windowStartAt: v.optional(v.number()),
    windowEndAt: v.optional(v.number()),
    confidence: v.number(),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    summary: v.string(),
    plainEnglish: v.string(),
    evidenceObservationIds: v.optional(v.array(v.id("timeSeriesObservations"))),
    sourceRefs: v.optional(v.array(sourceRefValidator)),
    recommendedAction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("timeSeriesSignals", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSignalStatus = mutation({
  args: {
    signalId: v.id("timeSeriesSignals"),
    status: v.union(
      v.literal("open"),
      v.literal("watch"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
  },
  handler: async (ctx, { signalId, status }) => {
    await ctx.db.patch(signalId, { status, updatedAt: Date.now() });
  },
});

/* ================================================================== */
/* CAUSAL CHAINS                                                       */
/* ================================================================== */

export const insertCausalChain = mutation({
  args: {
    chainKey: v.string(),
    title: v.string(),
    entityKey: v.optional(v.string()),
    rootQuestion: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("validated"),
      v.literal("contested"),
    ),
    timeframeStartAt: v.optional(v.number()),
    timeframeEndAt: v.optional(v.number()),
    summary: v.string(),
    plainEnglish: v.string(),
    outcome: v.optional(v.string()),
    nodes: v.array(v.object({
      timestamp: v.number(),
      label: v.string(),
      description: v.string(),
      evidenceObservationIds: v.optional(v.array(v.id("timeSeriesObservations"))),
    })),
    sourceRefs: v.optional(v.array(sourceRefValidator)),
  },
  handler: async (ctx, args) => {
    // Validate chronological order
    for (let i = 1; i < args.nodes.length; i++) {
      if (args.nodes[i].timestamp < args.nodes[i - 1].timestamp) {
        throw new Error(
          `Causal chain nodes must be chronological: node ${i} (${args.nodes[i].label}) ` +
          `precedes node ${i - 1} (${args.nodes[i - 1].label})`
        );
      }
    }
    const now = Date.now();
    return await ctx.db.insert("causalChains", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const appendCausalNode = mutation({
  args: {
    chainId: v.id("causalChains"),
    node: v.object({
      timestamp: v.number(),
      label: v.string(),
      description: v.string(),
      evidenceObservationIds: v.optional(v.array(v.id("timeSeriesObservations"))),
    }),
  },
  handler: async (ctx, { chainId, node }) => {
    const chain = await ctx.db.get(chainId);
    if (!chain) throw new Error(`Causal chain ${chainId} not found`);
    const lastNode = chain.nodes[chain.nodes.length - 1];
    if (lastNode && node.timestamp < lastNode.timestamp) {
      throw new Error(
        `New node timestamp must be after last node: ${node.label} (${node.timestamp}) < ${lastNode.label} (${lastNode.timestamp})`
      );
    }
    await ctx.db.patch(chainId, {
      nodes: [...chain.nodes, node],
      updatedAt: Date.now(),
    });
  },
});

export const updateCausalChainStatus = mutation({
  args: {
    chainId: v.id("causalChains"),
    status: v.union(
      v.literal("draft"),
      v.literal("validated"),
      v.literal("contested"),
    ),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, { chainId, status, outcome }) => {
    const patch: Record<string, unknown> = { status, updatedAt: Date.now() };
    if (outcome !== undefined) patch.outcome = outcome;
    await ctx.db.patch(chainId, patch);
  },
});

/* ================================================================== */
/* ZERO-DRAFT ARTIFACTS                                                */
/* ================================================================== */

export const insertZeroDraft = mutation({
  args: {
    artifactKey: v.string(),
    artifactType: v.union(
      v.literal("slack_message"),
      v.literal("email"),
      v.literal("spec_doc"),
      v.literal("pr_draft"),
      v.literal("architecture_note"),
      v.literal("career_plan"),
      v.literal("content_brief"),
    ),
    title: v.string(),
    summary: v.string(),
    plainEnglish: v.string(),
    targetAudience: v.optional(v.string()),
    bodyMarkdown: v.string(),
    linkedSignalIds: v.optional(v.array(v.id("timeSeriesSignals"))),
    linkedChainId: v.optional(v.id("causalChains")),
    sourceRefs: v.optional(v.array(sourceRefValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("zeroDraftArtifacts", {
      ...args,
      status: "draft" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const approveZeroDraft = mutation({
  args: {
    artifactId: v.id("zeroDraftArtifacts"),
  },
  handler: async (ctx, { artifactId }) => {
    const now = Date.now();
    await ctx.db.patch(artifactId, {
      status: "approved" as const,
      approvedAt: now,
      updatedAt: now,
    });
  },
});

export const updateZeroDraftStatus = mutation({
  args: {
    artifactId: v.id("zeroDraftArtifacts"),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("archived"),
    ),
  },
  handler: async (ctx, { artifactId, status }) => {
    const patch: Record<string, unknown> = { status, updatedAt: Date.now() };
    if (status === "approved") patch.approvedAt = Date.now();
    await ctx.db.patch(artifactId, patch);
  },
});

/* ================================================================== */
/* PROOF PACKS                                                         */
/* ================================================================== */

export const createProofPack = mutation({
  args: {
    packKey: v.string(),
    subjectType: v.union(
      v.literal("deployment"),
      v.literal("career_move"),
      v.literal("content_release"),
      v.literal("research_run"),
      v.literal("agent_loop"),
    ),
    subjectId: v.string(),
    summary: v.string(),
    checklist: v.array(v.object({
      label: v.string(),
      passed: v.boolean(),
      note: v.optional(v.string()),
    })),
    sourceRefs: v.optional(v.array(sourceRefValidator)),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
    taskSessionId: v.optional(v.id("agentTaskSessions")),
    zeroDraftArtifactIds: v.optional(v.array(v.id("zeroDraftArtifacts"))),
    metrics: v.optional(v.object({
      totalTokens: v.optional(v.number()),
      totalDurationMs: v.optional(v.number()),
      estimatedCostUsd: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const passCount = args.checklist.filter(c => c.passed).length;
    const allPassed = passCount === args.checklist.length;
    const now = Date.now();
    return await ctx.db.insert("proofPacks", {
      ...args,
      status: allPassed ? "ready" as const : "draft" as const,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateProofPackStatus = mutation({
  args: {
    packId: v.id("proofPacks"),
    status: v.union(
      v.literal("draft"),
      v.literal("ready"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { packId, status }) => {
    await ctx.db.patch(packId, { status, updatedAt: Date.now() });
  },
});
