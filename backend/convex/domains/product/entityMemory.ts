/**
 * entityMemory — Convex layer for the L1/L2 persistence of
 * .claude/rules/layered_memory.md.
 *
 *   L2 = entityTopicFiles (per entity + topic compacted facts)
 *   L1 = entityMemoryIndex (per entity one-liner cache)
 *
 * The compaction LOGIC lives in server/pipeline/topicCompaction.ts
 * (pure + tested). This module is pure glue:
 *   - compactBlockTopic (internalMutation): read row → call compactTopic
 *     → write row → trigger index rebuild.
 *   - rebuildMemoryIndex (internalMutation): scans all topic files for
 *     an entity, rebuilds the one-liner cache.
 *   - readTopic / listTopicsForEntity / getMemoryIndex (queries, BOUND).
 */

import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  compactTopic,
  type CompactionFact,
  type TopicFileContent,
} from "../../../server/pipeline/topicCompaction";
import {
  diffTopicFacts,
  buildNudgeText,
} from "../../../server/pipeline/changeDetector";

const MAX_TOPICS_PER_ENTITY = 20;

function parseTopic(json: string): TopicFileContent | null {
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray(parsed.facts) &&
      typeof parsed.topicName === "string"
    ) {
      return parsed as TopicFileContent;
    }
  } catch {
    // fall through
  }
  return null;
}

/* ==========================================================================
 * compactBlockTopic — single-entity, single-topic merge step.
 *
 * HONEST_STATUS returned: { status, added?, dropped? } so the caller (the
 * orchestrator) knows whether the compaction changed anything. If nothing
 * changed, we skip the index rebuild to save work.
 * ========================================================================== */
export const compactBlockTopic = internalMutation({
  args: {
    entitySlug: v.string(),
    topicName: v.string(),
    /** New facts derived from the scratchpad's structured output. */
    newFacts: v.array(
      v.object({
        text: v.string(),
        sourceRefId: v.optional(v.string()),
        observedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingRow = await ctx.db
      .query("entityTopicFiles")
      .withIndex("by_entity_topic", (q) =>
        q.eq("entitySlug", args.entitySlug).eq("topicName", args.topicName),
      )
      .first();

    const existing = existingRow ? parseTopic(existingRow.contentJson) : null;
    const verdict = compactTopic({
      topicName: args.topicName,
      existing,
      newFacts: args.newFacts as ReadonlyArray<CompactionFact>,
      compactedAtMs: Date.now(),
    });

    if (verdict.status === "unchanged") {
      return { status: "unchanged" as const };
    }

    const contentJson = JSON.stringify(verdict.newContent);
    const oneLineSummary = verdict.newContent.oneLineSummary;
    const factCount = verdict.newContent.facts.length;
    const compactedAt = verdict.newContent.compactedAt;
    const schemaVersion = verdict.newContent.schemaVersion;

    if (existingRow) {
      await ctx.db.patch(existingRow._id, {
        contentJson,
        oneLineSummary,
        factCount,
        compactedAt,
        schemaVersion,
      });
    } else {
      await ctx.db.insert("entityTopicFiles", {
        entitySlug: args.entitySlug,
        topicName: args.topicName,
        contentJson,
        oneLineSummary,
        factCount,
        compactedAt,
        schemaVersion,
      });
    }

    // Regenerate the per-entity index. Cheap — read <=20 topic rows.
    const topics = await ctx.db
      .query("entityTopicFiles")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .take(MAX_TOPICS_PER_ENTITY);
    const indexEntries = topics.map((t) => ({
      topicName: t.topicName,
      oneLineSummary: t.oneLineSummary,
      factCount: t.factCount,
      compactedAt: t.compactedAt,
    }));
    const indexJson = JSON.stringify(indexEntries);
    const totalFactCount = topics.reduce((s, t) => s + t.factCount, 0);
    const existingIndex = await ctx.db
      .query("entityMemoryIndex")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .first();
    if (existingIndex) {
      await ctx.db.patch(existingIndex._id, {
        indexJson,
        topicCount: topics.length,
        totalFactCount,
        lastRebuildAt: Date.now(),
      });
    } else {
      await ctx.db.insert("entityMemoryIndex", {
        entitySlug: args.entitySlug,
        indexJson,
        topicCount: topics.length,
        totalFactCount,
        lastRebuildAt: Date.now(),
      });
    }

    // Material-change detection: diff existing vs new, emit a nudge when
    // significance = "material". changeDetector.ts is pure + tested; we
    // call createNudge from nudges.ts so the existing nudge surface picks
    // it up automatically. BOUND + ERROR_BOUNDARY: nudge creation is
    // wrapped in try/catch so a notification failure never taints the
    // compaction write. We also only fire when status !== "unchanged"
    // (which we already returned above).
    if (existing) {
      try {
        const diff = diffTopicFacts({
          topicName: args.topicName,
          previousFacts: existing.facts.map((f) => ({
            text: f.text,
            sourceRefId: f.sourceRefId,
            observedAt: f.observedAt,
          })),
          nextFacts: verdict.newContent.facts.map((f) => ({
            text: f.text,
            sourceRefId: f.sourceRefId,
            observedAt: f.observedAt,
          })),
        });
        if (diff.significance === "material" && diff.addedFacts.length > 0) {
          // Resolve ownerKey via productEntities.
          const entity = await ctx.db
            .query("productEntities")
            .withIndex("by_slug", (q) => q.eq("slug", args.entitySlug))
            .first();
          if (entity && typeof entity.ownerKey === "string") {
            const { title, summary } = buildNudgeText({
              entityLabel: entity.title ?? args.entitySlug,
              topicName: args.topicName,
              diff,
            });
            await ctx.runMutation(
              internal.domains.product.nudges.createNudge,
              {
                ownerKey: entity.ownerKey,
                type: "report_changed",
                title,
                summary,
                actionLabel: "Open entity",
                actionTargetSurface: "entity",
                actionTargetId: args.entitySlug,
              },
            );
          }
        }
      } catch {
        // ERROR_BOUNDARY — nudge creation failure never taints compaction.
      }
    }

    return {
      status: verdict.status,
      added:
        verdict.status === "updated" || verdict.status === "bounded"
          ? verdict.added
          : undefined,
      droppedToCap:
        verdict.status === "bounded" ? verdict.droppedToCap : undefined,
    };
  },
});

export const readTopic = query({
  args: {
    entitySlug: v.string(),
    topicName: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("entityTopicFiles")
      .withIndex("by_entity_topic", (q) =>
        q.eq("entitySlug", args.entitySlug).eq("topicName", args.topicName),
      )
      .first();
    if (!row) return null;
    return {
      entitySlug: row.entitySlug,
      topicName: row.topicName,
      oneLineSummary: row.oneLineSummary,
      factCount: row.factCount,
      compactedAt: row.compactedAt,
      content: parseTopic(row.contentJson),
    };
  },
});

export const listTopicsForEntity = query({
  args: {
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("entityTopicFiles")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .take(MAX_TOPICS_PER_ENTITY);
    return rows.map((r) => ({
      topicName: r.topicName,
      oneLineSummary: r.oneLineSummary,
      factCount: r.factCount,
      compactedAt: r.compactedAt,
    }));
  },
});

export const getMemoryIndex = query({
  args: {
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("entityMemoryIndex")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .first();
    if (!row) {
      return {
        entitySlug: args.entitySlug,
        topicCount: 0,
        totalFactCount: 0,
        lastRebuildAt: 0,
        entries: [] as Array<{
          topicName: string;
          oneLineSummary: string;
          factCount: number;
          compactedAt: number;
        }>,
      };
    }
    let entries: Array<{
      topicName: string;
      oneLineSummary: string;
      factCount: number;
      compactedAt: number;
    }> = [];
    try {
      const parsed = JSON.parse(row.indexJson);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      // stale JSON — index will rebuild on next compaction
    }
    return {
      entitySlug: row.entitySlug,
      topicCount: row.topicCount,
      totalFactCount: row.totalFactCount,
      lastRebuildAt: row.lastRebuildAt,
      entries,
    };
  },
});
