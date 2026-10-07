/**
 * JIT Retrieval for Ultra-Long Multi-Angle Chat Sessions
 *
 * Pattern: "compaction first, JIT retrieval second, model overflow third".
 *
 * This module loads angle-specific artifacts ON DEMAND:
 *   - Does NOT inline full reports/pulse/me pages into the prompt
 *   - Instead fetches tiny descriptors in the prompt, then materializes specific
 *     slices only when the conversation pivots to that angle.
 *
 * Data sources it draws from:
 *   - productReports (formal investigations)
 *   - productClaims (factual claims)
 *   - productEvidenceItems (evidence)
 *   - productChatSessions / productChatEvents (past questions + answers)
 *   - dailyBriefMemories / dailyBriefTaskResults (daily context)
 *   - userWikiNotes (human-written notes)
 *   - agentMessages (Fast Agent conversations)
 *   - userEvents (personal tasks)
 *   - researchMemory (durable Hermes Layer 4 priorities)
 */

import { v } from "convex/values";
import { internalQuery, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ════════════════════════════════════════════════════════════════════
// ANGLE → DATA SOURCE MAPPING
// Each angle maps to a minimal set of data sources for targeted hydration
// ════════════════════════════════════════════════════════════════════

const ANGLE_DATA_SOURCES: Record<string, string[]> = {
  entity_profile: ["productReports", "productClaims", "userWikiNotes", "researchMemory"],
  public_signals: ["productChatSessions", "productChatEvents", "dailyBriefMemories"],
  funding_intelligence: ["productReports", "productClaims", "researchMemory"],
  financial_health: ["productReports", "productClaims", "researchMemory"],
  narrative_tracking: ["productChatSessions", "userWikiNotes", "researchMemory"],
  document_discovery: ["productReports", "productEvidenceItems"],
  competitive_intelligence: ["productReports", "productClaims", "researchMemory"],
  people_graph: ["userEvents", "researchMemory", "userWikiNotes"],
  market_dynamics: ["productReports", "productClaims"],
  regulatory_monitoring: ["productEvidenceItems", "productClaims"],
  executive_brief: ["dailyBriefMemories", "dailyBriefTaskResults"],
  daily_brief: ["dailyBriefMemories", "dailyBriefTaskResults", "userEvents"],
  deep_research: ["productReports", "productClaims", "productEvidenceItems", "researchMemory"],
  github_ecosystem: ["productReports", "productEvidenceItems"],
  academic_research: ["productReports", "productEvidenceItems"],
  patent_intelligence: ["productClaims", "productEvidenceItems"],
  world_monitor: ["productReports", "productChatSessions"],
};

// ════════════════════════════════════════════════════════════════════
// JIT RETRIEVAL CORE QUERY
// ════════════════════════════════════════════════════════════════════

export const hydrateAngle = internalQuery({
  args: {
    ownerKey: v.string(),
    userId: v.string(),
    angleId: v.string(),
    entitySlug: v.optional(v.string()),
    daysBack: v.optional(v.number()),
    maxItemsPerSource: v.optional(v.number()),
  },
  returns: v.object({
    angleId: v.string(),
    sources: v.array(v.object({
      sourceType: v.string(),
      itemCount: v.number(),
      items: v.array(v.any()),
    })),
    summary: v.string(),
    dataHash: v.string(),
    hydratedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 30;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const maxItems = args.maxItemsPerSource ?? 8;
    const sources: Array<{ sourceType: string; itemCount: number; items: any[] }> = [];

    const sourceTypes = ANGLE_DATA_SOURCES[args.angleId] ?? ["productReports"];

    for (const sourceType of sourceTypes) {
      try {
        const items = await fetchSource(ctx, sourceType, {
          ownerKey: args.ownerKey,
          userId: args.userId,
          entitySlug: args.entitySlug,
          cutoff,
          maxItems,
        });
        if (items.length > 0) {
          sources.push({ sourceType, itemCount: items.length, items });
        }
      } catch (err) {
        // Skip failing sources gracefully
        console.warn(`[JIT] hydrateAngle failed for ${sourceType}:`, err);
      }
    }

    const summary = buildAngleSummary(args.angleId, sources);
    const dataHash = hashString(JSON.stringify({ angle: args.angleId, items: sources.map((s) => ({ t: s.sourceType, n: s.itemCount })) }));

    return {
      angleId: args.angleId,
      sources,
      summary,
      dataHash,
      hydratedAt: Date.now(),
    };
  },
});

// ════════════════════════════════════════════════════════════════════
// PER-SOURCE FETCHERS
// ════════════════════════════════════════════════════════════════════

async function fetchSource(
  ctx: any,
  sourceType: string,
  args: { ownerKey: string; userId: string; entitySlug?: string; cutoff: number; maxItems: number },
): Promise<any[]> {
  switch (sourceType) {
    case "productReports": {
      if (!args.entitySlug) {
        const rows = await ctx.db
          .query("productReports")
          .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
          .order("desc")
          .take(args.maxItems);
        return rows.filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff).map(compactReport);
      }
      const rows = await ctx.db
        .query("productReports")
        .withIndex("by_owner_entity_updated", (q: any) =>
          q.eq("ownerKey", args.ownerKey).eq("entitySlug", args.entitySlug!),
        )
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff).map(compactReport);
    }

    case "productClaims": {
      const rows = await ctx.db
        .query("productClaims")
        .withIndex("by_owner_created", (q: any) => q.eq("ownerKey", args.ownerKey))
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.createdAt ?? 0) >= args.cutoff).map(compactClaim);
    }

    case "productEvidenceItems": {
      const rows = await ctx.db
        .query("productEvidenceItems")
        .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.createdAt ?? 0) >= args.cutoff).map(compactEvidence);
    }

    case "productChatSessions": {
      const rows = await ctx.db
        .query("productChatSessions")
        .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff).map(compactChatSession);
    }

    case "dailyBriefMemories": {
      const rows = await ctx.db
        .query("dailyBriefMemories")
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff).map(compactDailyBrief);
    }

    case "userWikiNotes": {
      // userWikiNotes only has by_owner_page index - scan and filter
      const rows = await ctx.db
        .query("userWikiNotes")
        .withIndex("by_owner_page", (q: any) => q.eq("ownerKey", args.ownerKey))
        .take(args.maxItems * 2);
      return rows
        .filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff)
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, args.maxItems)
        .map(compactNote);
    }

    case "userEvents": {
      const rows = await ctx.db
        .query("userEvents")
        .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
        .order("desc")
        .take(args.maxItems);
      return rows.filter((r: any) => (r.updatedAt ?? 0) >= args.cutoff).map(compactEvent);
    }

    case "researchMemory": {
      const rows = await ctx.db
        .query("researchMemory")
        .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
        .order("desc")
        .take(args.maxItems);
      return rows.map(compactMemory);
    }

    default:
      return [];
  }
}

// ════════════════════════════════════════════════════════════════════
// COMPACTORS (keep each item tiny for prompt efficiency)
// ════════════════════════════════════════════════════════════════════

function compactReport(r: any) {
  return {
    id: r._id,
    title: String(r.title ?? "").slice(0, 120),
    summary: String(r.summary ?? "").slice(0, 280),
    updatedAt: r.updatedAt,
  };
}

function compactClaim(r: any) {
  return {
    id: r._id,
    text: String(r.text ?? "").slice(0, 240),
    confidence: r.confidence,
    updatedAt: r.updatedAt ?? r.createdAt,
  };
}

function compactEvidence(r: any) {
  return {
    id: r._id,
    description: String(r.description ?? r.text ?? "").slice(0, 200),
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt,
  };
}

function compactChatSession(r: any) {
  return {
    id: r._id,
    query: String(r.query ?? "").slice(0, 160),
    title: String(r.title ?? "").slice(0, 120),
    status: r.status,
    updatedAt: r.updatedAt,
  };
}

function compactDailyBrief(r: any) {
  return {
    id: r._id,
    dateString: r.dateString,
    goal: String(r.goal ?? "").slice(0, 160),
    featureCount: Array.isArray(r.features) ? r.features.length : 0,
    updatedAt: r.updatedAt,
  };
}

function compactNote(r: any) {
  return {
    id: r._id,
    body: String(r.body ?? "").slice(0, 300),
    updatedAt: r.updatedAt,
  };
}

function compactEvent(r: any) {
  return {
    id: r._id,
    title: String(r.title ?? "").slice(0, 120),
    status: r.status,
    priority: r.priority,
    updatedAt: r.updatedAt,
  };
}

function compactMemory(r: any) {
  return {
    id: r._id,
    claim: String(r.claim ?? "").slice(0, 240),
    confidence: r.confidence,
    entity: r.entity,
    topic: r.topic,
    accessCount: r.accessCount,
  };
}

// ════════════════════════════════════════════════════════════════════
// ANGLE SUMMARY BUILDER
// ════════════════════════════════════════════════════════════════════

function buildAngleSummary(
  angleId: string,
  sources: Array<{ sourceType: string; itemCount: number; items: any[] }>,
): string {
  if (sources.length === 0) {
    return `Angle "${angleId}" has no recent data.`;
  }

  const totalItems = sources.reduce((sum, s) => sum + s.itemCount, 0);
  const lines: string[] = [];
  lines.push(`Angle "${angleId}" hydrated with ${totalItems} items across ${sources.length} source(s):`);

  for (const source of sources.slice(0, 4)) {
    const sample = source.items.slice(0, 2);
    const preview = sample
      .map((item) => {
        if (item.title) return `- ${item.title}`;
        if (item.text) return `- ${item.text.slice(0, 80)}`;
        if (item.query) return `- Q: ${item.query}`;
        if (item.body) return `- ${item.body.slice(0, 80)}`;
        if (item.claim) return `- ${item.claim.slice(0, 80)}`;
        return null;
      })
      .filter(Boolean)
      .join("\n");
    lines.push(`\n[${source.sourceType}] ${source.itemCount} items:\n${preview}`);
  }

  return lines.join("\n").slice(0, 2000);
}

// ════════════════════════════════════════════════════════════════════
// HELPER: deterministic hash (no crypto needed)
// ════════════════════════════════════════════════════════════════════

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

// ════════════════════════════════════════════════════════════════════
// PUBLIC ACTION: hydrate angles, merge into session, return summaries
// ════════════════════════════════════════════════════════════════════

export const hydrateAnglesForSession = internalAction({
  args: {
    sessionId: v.id("researchSessions"),
    ownerKey: v.string(),
    userId: v.string(),
    angleIds: v.array(v.string()),
    entitySlug: v.optional(v.string()),
    daysBack: v.optional(v.number()),
  },
  returns: v.object({
    hydratedAngles: v.array(v.object({
      angleId: v.string(),
      summary: v.string(),
      sourceCount: v.number(),
      dataHash: v.string(),
    })),
    totalItems: v.number(),
  }),
  handler: async (ctx, args): Promise<any> => {
    const hydratedAngles: any[] = [];
    let totalItems = 0;

    for (const angleId of args.angleIds) {
      const result = await ctx.runQuery(
        internal.domains.research.researchSessionJit.hydrateAngle,
        {
          ownerKey: args.ownerKey,
          userId: args.userId,
          angleId,
          entitySlug: args.entitySlug,
          daysBack: args.daysBack,
        },
      );

      // Persist loaded angle state into session
      await ctx.runMutation(
        internal.domains.research.researchSessionLifecycle.loadAngle,
        {
          sessionId: args.sessionId,
          angleId,
          summary: result.summary,
          fullDataRef: `angle:${angleId}:${result.dataHash}`,
          dataHash: result.dataHash,
        },
      );

      hydratedAngles.push({
        angleId,
        summary: result.summary,
        sourceCount: result.sources.length,
        dataHash: result.dataHash,
      });
      totalItems += result.sources.reduce((sum: number, s: any) => sum + s.itemCount, 0);
    }

    return { hydratedAngles, totalItems };
  },
});
