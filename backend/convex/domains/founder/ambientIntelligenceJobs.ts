/**
 * Phase 11 — Ambient Intelligence Background Jobs
 *
 * Canonicalization pipeline, change detection, packet readiness, and pruning.
 * All jobs are internalMutation — called by Convex crons on fixed cadences.
 *
 * Phase 1: Heuristic keyword matching for classification.
 * Phase 2 will replace with LLM inference.
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

// ── Constants ────────────────────────────────────────────────────────
const MAX_INGESTION_BATCH = 10;
const MAX_CANONICAL_SCAN = 200;
const MAX_CHANGE_SCAN = 500;
const MAX_PRUNE_BATCH = 200;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// ── Classification ───────────────────────────────────────────────────

type CanonicalObjectType =
  | "thesis"
  | "decision"
  | "competitor_signal"
  | "build_item"
  | "open_question"
  | "contradiction"
  | "artifact_ref"
  | "initiative_update"
  | "market_signal"
  | "strategic_insight"
  | "risk"
  | "opportunity";

interface ExtractedObject {
  objectType: CanonicalObjectType;
  title: string;
  content: string;
  confidence: number;
  tags: string[];
}

const KEYWORD_RULES: Array<{
  keywords: string[];
  type: CanonicalObjectType;
  weight: number;
}> = [
  { keywords: ["decided", "chose", "accepted", "rejected", "approved", "declined"], type: "decision", weight: 0.8 },
  { keywords: ["competitor", "raised", "launched", "funding", "acquired", "ipo"], type: "competitor_signal", weight: 0.7 },
  { keywords: ["market", "trend", "industry", "sector", "growth", "demand"], type: "market_signal", weight: 0.6 },
  { keywords: ["risk", "threat", "vulnerable", "exposure", "liability"], type: "risk", weight: 0.75 },
  { keywords: ["opportunity", "could", "potential", "upside", "untapped"], type: "opportunity", weight: 0.65 },
  { keywords: ["build", "implement", "ship", "deploy", "release", "feature"], type: "build_item", weight: 0.7 },
  { keywords: ["contradict", "conflict", "mismatch", "drift", "inconsistent", "disagree"], type: "contradiction", weight: 0.85 },
  { keywords: ["mission", "wedge", "thesis", "vision", "strategy", "positioning"], type: "thesis", weight: 0.8 },
  { keywords: ["question", "unclear", "unknown", "investigate", "explore"], type: "open_question", weight: 0.5 },
  { keywords: ["artifact", "document", "file", "attachment", "deliverable"], type: "artifact_ref", weight: 0.5 },
  { keywords: ["initiative", "project", "workstream", "milestone", "sprint"], type: "initiative_update", weight: 0.6 },
];

function classifyContent(text: string, sourceType: string): ExtractedObject[] {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const wordCount = words.length;

  // Score each type by keyword density
  const scores: Array<{ type: CanonicalObjectType; score: number; matchCount: number }> = [];

  for (const rule of KEYWORD_RULES) {
    const matchCount = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > 0) {
      const density = matchCount / rule.keywords.length;
      scores.push({
        type: rule.type,
        score: density * rule.weight,
        matchCount,
      });
    }
  }

  // Sort by score descending, take top match(es)
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    // Default to strategic_insight
    return [
      {
        objectType: "strategic_insight",
        title: truncate(text, 80),
        content: text,
        confidence: computeConfidence(wordCount, 0),
        tags: [sourceType],
      },
    ];
  }

  // Source-type biases: boost certain types for certain sources
  const sourceBoosts: Record<string, CanonicalObjectType[]> = {
    chat: ["decision", "open_question"],
    agent_output: ["build_item", "initiative_update"],
    web_signal: ["competitor_signal", "market_signal"],
    mcp_tool: ["build_item", "artifact_ref"],
    file_change: ["artifact_ref", "build_item"],
    user_action: ["decision", "initiative_update"],
  };

  const boosted = sourceBoosts[sourceType] ?? [];

  // Take top 1-2 classifications (if second is close enough)
  const results: ExtractedObject[] = [];
  const top = scores[0];

  const topConfidence = computeConfidence(wordCount, top.matchCount);
  const adjustedConfidence = boosted.includes(top.type)
    ? Math.min(1, topConfidence + 0.1)
    : topConfidence;

  results.push({
    objectType: top.type,
    title: truncate(text, 80),
    content: text,
    confidence: adjustedConfidence,
    tags: [sourceType, top.type],
  });

  // If second classification is close (>70% of top score), also emit it
  if (scores.length > 1 && scores[1].score > top.score * 0.7) {
    const second = scores[1];
    results.push({
      objectType: second.type,
      title: truncate(text, 80),
      content: text,
      confidence: computeConfidence(wordCount, second.matchCount) * 0.8,
      tags: [sourceType, second.type],
    });
  }

  return results;
}

function computeConfidence(wordCount: number, matchCount: number): number {
  // Longer content + more keyword matches = higher confidence
  const lengthFactor = Math.min(1, wordCount / 50); // maxes at 50 words
  const matchFactor = Math.min(1, matchCount / 3);   // maxes at 3 matches
  return Math.round((lengthFactor * 0.4 + matchFactor * 0.6) * 100) / 100;
}

function truncate(text: string, maxLen: number): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}

// ===========================================================================
// 1. processIngestionQueue — every 30 seconds
// Pulls queued ingestion items and creates canonical objects.
// ===========================================================================

export const processIngestionQueue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db
      .query("ambientIngestionQueue")
      .withIndex("by_status", (q) => q.eq("processingStatus", "queued"))
      .order("asc")
      .take(MAX_INGESTION_BATCH);

    if (queued.length === 0) return { processed: 0, created: 0 };

    let created = 0;
    let processed = 0;

    for (const item of queued) {
      try {
        // Mark as processing
        await ctx.db.patch(item._id, { processingStatus: "processing" as const });

        const extracted = classifyContent(item.rawContent, item.sourceType);

        for (const obj of extracted) {
          const now = Date.now();
          await ctx.db.insert("ambientCanonicalObjects", {
            objectType: obj.objectType,
            companyId: item.companyId,
            workspaceId: item.workspaceId,
            title: obj.title,
            content: obj.content,
            confidence: obj.confidence,
            sourceIngestionIds: [item._id],
            isLatest: true,
            tags: obj.tags,
            extractedAt: now,
            updatedAt: now,
          });
          created++;
        }

        // Mark as canonicalized
        await ctx.db.patch(item._id, {
          processingStatus: "canonicalized" as const,
          processedAt: Date.now(),
        });
        processed++;
      } catch (_err) {
        // Mark as failed — don't crash the batch
        await ctx.db.patch(item._id, {
          processingStatus: "failed" as const,
          processedAt: Date.now(),
        });
        processed++;
      }
    }

    return { processed, created };
  },
});

// ===========================================================================
// 2. detectAmbientChanges — every 5 minutes
// Scans recently-updated canonical objects and writes change detections.
// ===========================================================================

const IMPACT_WEIGHTS: Record<string, number> = {
  thesis: 0.9,
  contradiction: 0.8,
  decision: 0.75,
  competitor_signal: 0.7,
  risk: 0.7,
  market_signal: 0.65,
  opportunity: 0.6,
  build_item: 0.5,
  initiative_update: 0.5,
  strategic_insight: 0.5,
  open_question: 0.3,
  artifact_ref: 0.2,
};

export const detectAmbientChanges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - FIVE_MINUTES_MS;

    // Get recently updated latest objects
    const recent = await ctx.db
      .query("ambientCanonicalObjects")
      .withIndex("by_latest", (q) => q.eq("isLatest", true))
      .order("desc")
      .take(MAX_CANONICAL_SCAN);

    // Filter to those updated in the last 5 minutes
    const changed = recent.filter((obj) => obj.updatedAt > cutoff);

    if (changed.length === 0) return { detections: 0 };

    let detections = 0;

    for (const obj of changed) {
      const baseImpact = IMPACT_WEIGHTS[obj.objectType] ?? 0.5;

      // Determine detection type
      let detectionType: "new_object" | "updated_object" | "contradiction" | "confidence_change" | "superseded";
      let impactReason: string;

      if (obj.objectType === "contradiction") {
        detectionType = "contradiction";
        impactReason = `Contradiction detected: "${truncate(obj.title, 60)}"`;
      } else if (obj.supersedes) {
        // Check confidence delta against the superseded object
        const prior = await ctx.db.get(obj.supersedes);
        if (prior && Math.abs(obj.confidence - prior.confidence) > 0.15) {
          detectionType = "confidence_change";
          impactReason = `Confidence shifted from ${prior.confidence.toFixed(2)} to ${obj.confidence.toFixed(2)} on "${truncate(obj.title, 50)}"`;
        } else {
          detectionType = "updated_object";
          impactReason = `${obj.objectType} updated: "${truncate(obj.title, 60)}"`;
        }
      } else if (obj.extractedAt > cutoff) {
        // Newly created in this window
        detectionType = "new_object";
        impactReason = `New ${obj.objectType}: "${truncate(obj.title, 60)}"`;
      } else {
        detectionType = "updated_object";
        impactReason = `${obj.objectType} updated: "${truncate(obj.title, 60)}"`;
      }

      // Boost impact for contradictions and thesis changes
      let impactScore = baseImpact;
      if (detectionType === "contradiction") impactScore = Math.min(1, impactScore + 0.1);
      if (detectionType === "confidence_change") impactScore = Math.min(1, impactScore + 0.05);

      await ctx.db.insert("ambientChangeDetections", {
        detectionType,
        objectId: obj._id,
        companyId: obj.companyId,
        priorState: obj.supersedes ? { supersededId: obj.supersedes } : undefined,
        currentState: { title: obj.title, confidence: obj.confidence, objectType: obj.objectType },
        impactScore: Math.round(impactScore * 100) / 100,
        impactReason,
        requiresAttention: impactScore > 0.5,
        detectedAt: now,
      });
      detections++;
    }

    return { detections };
  },
});

// ===========================================================================
// 3. assessPacketReadiness — every 15 minutes
// Computes staleness for each packet type per company.
// ===========================================================================

const PACKET_THRESHOLDS: Record<string, number> = {
  weekly_reset: 10,
  investor_update: 15,
  agent_brief: 5,
  competitor_readout: 8,
  pre_delegation: 5,
};

const PACKET_TYPES = [
  "weekly_reset",
  "investor_update",
  "agent_brief",
  "competitor_readout",
  "pre_delegation",
] as const;

export const assessPacketReadiness = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all existing packet readiness records to find companies
    const allReadiness = await ctx.db
      .query("ambientPacketReadiness")
      .withIndex("by_readiness")
      .take(200);

    // Deduplicate companies
    const companyIds = [...new Set(allReadiness.map((r) => r.companyId))];

    // Also find companies that have canonical objects but no readiness yet
    const recentObjects = await ctx.db
      .query("ambientCanonicalObjects")
      .withIndex("by_latest", (q) => q.eq("isLatest", true))
      .order("desc")
      .take(MAX_CANONICAL_SCAN);

    for (const obj of recentObjects) {
      if (obj.companyId && !companyIds.includes(obj.companyId)) {
        companyIds.push(obj.companyId);
      }
    }

    const stalePackets: Array<{ companyId: string; packetType: string; readiness: number }> = [];
    const now = Date.now();

    for (const companyId of companyIds) {
      for (const packetType of PACKET_TYPES) {
        // Find existing readiness record
        const existing = await ctx.db
          .query("ambientPacketReadiness")
          .withIndex("by_company_type", (q) =>
            q.eq("companyId", companyId).eq("packetType", packetType),
          )
          .first();

        const lastGenerated = existing?.lastGeneratedAt ?? 0;

        // Count changes since last generation
        const changes = await ctx.db
          .query("ambientChangeDetections")
          .withIndex("by_company", (q) => q.eq("companyId", companyId))
          .order("desc")
          .take(100);

        const changesSince = changes.filter((c) => c.detectedAt > lastGenerated).length;

        // Compute readiness score
        const threshold = PACKET_THRESHOLDS[packetType] ?? 10;
        const readinessScore = Math.round(Math.min(1, changesSince / threshold) * 100) / 100;

        // Build reason
        let reason: string | undefined;
        if (readinessScore > 0.7) {
          reason = `${changesSince} changes since last generation — high staleness`;
        } else if (readinessScore > 0.5) {
          reason = `${changesSince} changes since last generation — moderate staleness`;
        }

        // Upsert
        if (existing) {
          await ctx.db.patch(existing._id, {
            changesSinceLastGeneration: changesSince,
            readinessScore,
            suggestedRegenerationReason: reason,
            staleSince: readinessScore > 0.5 ? (existing.staleSince ?? now) : undefined,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("ambientPacketReadiness", {
            companyId,
            packetType: packetType as any,
            changesSinceLastGeneration: changesSince,
            readinessScore,
            suggestedRegenerationReason: reason,
            staleSince: readinessScore > 0.5 ? now : undefined,
            updatedAt: now,
          });
        }

        if (readinessScore > 0.5) {
          stalePackets.push({ companyId, packetType, readiness: readinessScore });
        }
      }
    }

    return { companiesScanned: companyIds.length, stalePackets };
  },
});

// ===========================================================================
// 4. pruneAndCompact — daily
// Cleans up old ingestion items, resolved detections, and superseded chains.
// ===========================================================================

export const pruneAndCompact = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - THIRTY_DAYS_MS;

    let ingestionsPruned = 0;
    let detectionsPruned = 0;
    let objectsCompacted = 0;

    // 1. Delete old ingestion queue items (canonicalized or failed, >30 days)
    const oldIngestions = await ctx.db
      .query("ambientIngestionQueue")
      .withIndex("by_status", (q) => q.eq("processingStatus", "canonicalized"))
      .take(MAX_PRUNE_BATCH);

    for (const item of oldIngestions) {
      if (item.createdAt < cutoff) {
        await ctx.db.delete(item._id);
        ingestionsPruned++;
      }
    }

    const oldFailed = await ctx.db
      .query("ambientIngestionQueue")
      .withIndex("by_status", (q) => q.eq("processingStatus", "failed"))
      .take(MAX_PRUNE_BATCH);

    for (const item of oldFailed) {
      if (item.createdAt < cutoff) {
        await ctx.db.delete(item._id);
        ingestionsPruned++;
      }
    }

    // 2. Delete resolved change detections older than 30 days
    const resolvedDetections = await ctx.db
      .query("ambientChangeDetections")
      .withIndex("by_attention", (q) => q.eq("requiresAttention", false))
      .take(MAX_CHANGE_SCAN);

    for (const det of resolvedDetections) {
      if (det.resolvedAt && det.resolvedAt < cutoff) {
        await ctx.db.delete(det._id);
        detectionsPruned++;
      }
    }

    // 3. Compact superseded canonical objects
    // Find non-latest objects older than 30 days
    const oldSuperseded = await ctx.db
      .query("ambientCanonicalObjects")
      .withIndex("by_latest", (q) => q.eq("isLatest", false))
      .order("asc")
      .take(MAX_PRUNE_BATCH);

    for (const obj of oldSuperseded) {
      if (obj.updatedAt < cutoff) {
        // Check that nothing references this object via supersedes
        // before deleting (only delete leaf nodes in the chain)
        const referencedBy = await ctx.db
          .query("ambientCanonicalObjects")
          .filter((q) => q.eq(q.field("supersedes"), obj._id))
          .take(1);

        if (referencedBy.length === 0) {
          // Safe to delete — no other object points to this one
          await ctx.db.delete(obj._id);
          objectsCompacted++;
        } else {
          // Re-point the referencing object's supersedes to skip this node
          const child = referencedBy[0];
          await ctx.db.patch(child._id, { supersedes: obj.supersedes });
          await ctx.db.delete(obj._id);
          objectsCompacted++;
        }
      }
    }

    return { ingestionsPruned, detectionsPruned, objectsCompacted };
  },
});
