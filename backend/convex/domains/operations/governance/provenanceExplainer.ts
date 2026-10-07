/**
 * Provenance Explainer & Promotion Policy — Operator Explainability
 *
 * Answers: "Why is this here?" by tracing the full provenance chain:
 *   post → evidence artifacts → claims → temporal facts → thesis
 *
 * Enforces the observation vs promotion boundary:
 *   - Agents can WRITE observations (posts, evidence artifacts, candidate claims)
 *   - Agents CANNOT PROMOTE (supersede facts, revise theses, upgrade correlations)
 *     ...unless gates pass (judge metrics + verification + HITL approval)
 *
 * Architecture upgrade: makes the system *defensible* and *auditable*.
 */

import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
  query,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// WRITE CLASSIFICATION — Observation vs Promotion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write types that agents can perform WITHOUT approval.
 * These are "observations" — raw data that doesn't change system state.
 */
export const OBSERVATION_WRITES = [
  "create_post",              // Draft a social post
  "create_evidence_artifact", // Ingest a source document
  "create_candidate_claim",   // Propose a claim (not yet verified)
  "create_draft_section",     // Write a draft section
  "log_tool_output",          // Record tool execution result
  "create_chunk",             // Chunk a document for indexing
  "log_heartbeat",            // Record agent activity
  "log_metric",               // Record a judge metric
] as const;

/**
 * Write types that REQUIRE gate checks and possibly HITL approval.
 * These are "promotions" — they change the system's knowledge state.
 */
export const PROMOTION_WRITES = [
  "supersede_fact",           // Replace a temporal fact with a newer one
  "revise_thesis",            // Change a narrative thesis
  "upgrade_correlation",      // Upgrade correlation type (e.g., to "causal")
  "publish_post",             // Make a post public (LinkedIn, etc.)
  "promote_claim",            // Promote candidate claim to verified
  "modify_trust_tier",        // Change an agent's trust level
  "delete_evidence",          // Remove evidence from the system
  "modify_ground_truth",      // Change a ground truth fact
] as const;

export type ObservationWrite = (typeof OBSERVATION_WRITES)[number];
export type PromotionWrite = (typeof PROMOTION_WRITES)[number];

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTION GATE — Can this write proceed?
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether a promotion write is allowed.
 * Gates: judge metrics pass + agent trust sufficient + optional HITL
 */
export const checkPromotionPolicy = internalQuery({
  args: {
    agentId: v.string(),
    writeType: v.string(),
    targetType: v.string(),
    targetId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.string(),
    requiresHitl: v.boolean(),
    gateResults: v.object({
      isObservation: v.boolean(),
      judgeGatePassed: v.optional(v.boolean()),
      trustGatePassed: v.optional(v.boolean()),
      hitlRequired: v.boolean(),
      hitlApproved: v.optional(v.boolean()),
    }),
  }),
  handler: async (ctx, { agentId, writeType, targetType, targetId }) => {
    // ── Observation writes always allowed ─────────────────────────
    if ((OBSERVATION_WRITES as readonly string[]).includes(writeType)) {
      return {
        allowed: true,
        reason: `"${writeType}" is an observation write — no gate required`,
        requiresHitl: false,
        gateResults: {
          isObservation: true,
          hitlRequired: false,
        },
      };
    }

    // ── Promotion writes require gates ────────────────────────────

    // Gate 1: Agent trust check
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    const trustTier = identity?.authorTrustTier ?? "new";
    const TRUST_SCORES: Record<string, number> = {
      verified: 1.0, established: 0.75, new: 0.5, quarantined: 0.1, banned: 0.0,
    };
    const trustScore = TRUST_SCORES[trustTier] ?? 0.5;
    const PROMOTION_MIN_TRUST: Record<string, number> = {
      supersede_fact: 0.75,
      revise_thesis: 0.75,
      upgrade_correlation: 0.75,
      publish_post: 0.75,
      promote_claim: 0.5,
      modify_trust_tier: 0.9,
      delete_evidence: 0.9,
      modify_ground_truth: 0.9,
    };
    const requiredTrust = PROMOTION_MIN_TRUST[writeType] ?? 0.75;
    const trustGatePassed = trustScore >= requiredTrust;

    if (!trustGatePassed) {
      return {
        allowed: false,
        reason: `Agent trust ${trustScore} (${trustTier}) < required ${requiredTrust} for "${writeType}"`,
        requiresHitl: false,
        gateResults: {
          isObservation: false,
          trustGatePassed: false,
          hitlRequired: false,
        },
      };
    }

    // Gate 2: Judge metrics check (if target has been evaluated)
    const metrics = await ctx.db
      .query("judgeMetrics")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .order("desc")
      .first();

    const judgeGatePassed = metrics ? metrics.criticalPass === true : true; // No metrics = pass (first-time)

    if (!judgeGatePassed) {
      return {
        allowed: false,
        reason: `Judge metrics failed for ${targetType}:${targetId} — cannot promote`,
        requiresHitl: false,
        gateResults: {
          isObservation: false,
          judgeGatePassed: false,
          trustGatePassed: true,
          hitlRequired: false,
        },
      };
    }

    // Gate 3: HITL required for high-impact promotions
    const HITL_REQUIRED_WRITES = [
      "modify_ground_truth",
      "modify_trust_tier",
      "delete_evidence",
      "upgrade_correlation",
    ];
    const hitlRequired = HITL_REQUIRED_WRITES.includes(writeType);

    if (hitlRequired) {
      // Check if there's an approved HITL decision
      const approval = await ctx.db
        .query("promotionApprovals")
        .withIndex("by_target", (q) =>
          q.eq("targetType", targetType).eq("targetId", targetId)
        )
        .order("desc")
        .first();

      const hitlApproved =
        approval?.decision === "approved" &&
        approval.writeType === writeType;

      if (!hitlApproved) {
        return {
          allowed: false,
          reason: `"${writeType}" requires human approval — pending HITL review`,
          requiresHitl: true,
          gateResults: {
            isObservation: false,
            judgeGatePassed: true,
            trustGatePassed: true,
            hitlRequired: true,
            hitlApproved: false,
          },
        };
      }
    }

    return {
      allowed: true,
      reason: `All gates passed for "${writeType}" on ${targetType}:${targetId}`,
      requiresHitl: false,
      gateResults: {
        isObservation: false,
        judgeGatePassed: true,
        trustGatePassed: true,
        hitlRequired,
        hitlApproved: hitlRequired ? true : undefined,
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HITL APPROVAL QUEUE
// ═══════════════════════════════════════════════════════════════════════════

/** Submit a promotion for HITL review */
export const requestApproval = internalMutation({
  args: {
    agentId: v.string(),
    writeType: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    justification: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("promotionApprovals", {
      agentId: args.agentId,
      writeType: args.writeType,
      targetType: args.targetType,
      targetId: args.targetId,
      justification: args.justification,
      context: args.context,
      decision: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      requestedAt: Date.now(),
    });
  },
});

/** Approve or reject a pending promotion (called by human operator) */
export const reviewApproval = internalMutation({
  args: {
    approvalId: v.id("promotionApprovals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewedBy: v.string(),
    reviewNotes: v.optional(v.string()),
  },
  handler: async (ctx, { approvalId, decision, reviewedBy, reviewNotes }) => {
    await ctx.db.patch(approvalId, {
      decision,
      reviewedBy,
      reviewedAt: Date.now(),
      reviewNotes,
    });
  },
});

/** Get pending approvals for the operator console */
export const getPendingApprovals = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return ctx.db
      .query("promotionApprovals")
      .withIndex("by_decision", (q) => q.eq("decision", "pending"))
      .order("desc")
      .take(50);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE CHAIN — "Why is this here?"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trace the full provenance chain for any artifact in the system.
 * Returns: the complete chain from output back to source evidence.
 */
export const traceProvenance = internalQuery({
  args: {
    targetType: v.string(),
    targetId: v.string(),
  },
  returns: v.object({
    target: v.object({
      type: v.string(),
      id: v.string(),
    }),
    chain: v.array(
      v.object({
        step: v.number(),
        type: v.string(),
        id: v.string(),
        description: v.string(),
        timestamp: v.optional(v.number()),
        metadata: v.optional(v.any()),
      })
    ),
    judgeMetrics: v.array(v.any()),
    groundTruthFacts: v.array(v.any()),
    approvals: v.array(v.any()),
  }),
  handler: async (ctx, { targetType, targetId }) => {
    const chain: Array<{
      step: number;
      type: string;
      id: string;
      description: string;
      timestamp?: number;
      metadata?: any;
    }> = [];

    let stepNum = 0;

    // Step 0: The target itself
    chain.push({
      step: stepNum++,
      type: targetType,
      id: targetId,
      description: `Target: ${targetType}:${targetId}`,
    });

    // Step 1: Find evidence packs linked to this target
    // (Evidence packs link agent runs to artifact chunks)
    const evidencePacks = await ctx.db
      .query("evidencePacks")
      .filter((q) =>
        q.or(
          q.eq(q.field("runId"), targetId),
          q.eq(q.field("label"), targetId)
        )
      )
      .collect();

    for (const pack of evidencePacks) {
      chain.push({
        step: stepNum++,
        type: "evidence_pack",
        id: pack._id.toString(),
        description: `Evidence pack: ${pack.label ?? "unlabeled"} (${(pack.chunkIds as string[])?.length ?? 0} chunks)`,
        timestamp: pack.createdAt,
      });
    }

    // Step 2: Find source artifacts
    const artifacts = await ctx.db
      .query("sourceArtifacts")
      .filter((q) => q.eq(q.field("runId"), targetId))
      .collect();

    for (const artifact of artifacts) {
      chain.push({
        step: stepNum++,
        type: "source_artifact",
        id: artifact._id.toString(),
        description: `Source: ${artifact.sourceType} from ${artifact.sourceUrl ?? "unknown"}`,
        timestamp: artifact.fetchedAt,
        metadata: {
          sourceUrl: artifact.sourceUrl,
          contentHash: artifact.contentHash,
          sourceType: artifact.sourceType,
        },
      });
    }

    // Step 3: Find verification audit log entries
    const auditEntries = await ctx.db
      .query("verificationAuditLog")
      .filter((q) =>
        q.and(
          q.eq(q.field("targetType"), targetType),
          q.eq(q.field("targetId"), targetId)
        )
      )
      .collect();

    for (const entry of auditEntries) {
      chain.push({
        step: stepNum++,
        type: "verification",
        id: entry._id.toString(),
        description: `Verification: ${entry.action} → ${entry.verdict} (confidence: ${entry.confidence})`,
        timestamp: entry.performedAt,
        metadata: {
          action: entry.action,
          verdict: entry.verdict,
          confidence: entry.confidence,
          reasoning: entry.reasoning,
          sourceUrls: entry.sourceUrls,
        },
      });
    }

    // Step 4: Find agent run events
    const runEvents = await ctx.db
      .query("agentRunEvents")
      .filter((q) => q.eq(q.field("runId"), targetId))
      .order("asc")
      .take(20);

    for (const event of runEvents) {
      chain.push({
        step: stepNum++,
        type: "agent_event",
        id: event._id.toString(),
        description: `Agent event: ${event.eventType} (seq ${event.seq})`,
        timestamp: event.createdAt,
        metadata: {
          eventType: event.eventType,
          seq: event.seq,
        },
      });
    }

    // Fetch judge metrics for this target
    const judgeMetrics = await ctx.db
      .query("judgeMetrics")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .collect();

    // Fetch related ground truth facts
    const groundTruthFacts = await ctx.db
      .query("groundTruthFacts")
      .filter((q) => q.eq(q.field("subject"), targetId))
      .collect();

    // Fetch promotion approvals
    const approvals = await ctx.db
      .query("promotionApprovals")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .collect();

    return {
      target: { type: targetType, id: targetId },
      chain,
      judgeMetrics,
      groundTruthFacts,
      approvals,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE SUMMARY — Concise explainability for operator console
// ═══════════════════════════════════════════════════════════════════════════

/** Get a human-readable provenance summary for an artifact */
export const getProvenanceSummary = internalQuery({
  args: {
    targetType: v.string(),
    targetId: v.string(),
  },
  returns: v.object({
    summary: v.string(),
    evidenceCount: v.number(),
    verificationCount: v.number(),
    judgeEvaluationCount: v.number(),
    approvalStatus: v.string(),
    criticalPass: v.boolean(),
  }),
  handler: async (ctx, { targetType, targetId }) => {
    // Count evidence
    const artifacts = await ctx.db
      .query("sourceArtifacts")
      .filter((q) => q.eq(q.field("runId"), targetId))
      .collect();

    // Count verifications
    const verifications = await ctx.db
      .query("verificationAuditLog")
      .filter((q) =>
        q.and(
          q.eq(q.field("targetType"), targetType),
          q.eq(q.field("targetId"), targetId)
        )
      )
      .collect();

    // Count judge evaluations
    const metrics = await ctx.db
      .query("judgeMetrics")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .collect();

    // Check approval status
    const approval = await ctx.db
      .query("promotionApprovals")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .order("desc")
      .first();

    const approvalStatus = approval?.decision ?? "none";
    const latestMetric = metrics[metrics.length - 1];
    const criticalPass = latestMetric?.criticalPass ?? false;

    const parts: string[] = [];
    parts.push(`${targetType}:${targetId}`);
    parts.push(`${artifacts.length} evidence source(s)`);
    parts.push(`${verifications.length} verification(s)`);
    parts.push(`${metrics.length} judge evaluation(s)`);
    if (latestMetric) {
      parts.push(`critical: ${criticalPass ? "PASS" : "FAIL"}`);
    }
    parts.push(`approval: ${approvalStatus}`);

    return {
      summary: parts.join(" | "),
      evidenceCount: artifacts.length,
      verificationCount: verifications.length,
      judgeEvaluationCount: metrics.length,
      approvalStatus,
      criticalPass,
    };
  },
});
