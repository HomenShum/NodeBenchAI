/**
 * hydrateEntities — compaction-first writer for the canonical entity graph.
 *
 * Rule: sub-agents NEVER write entities/edges/claims/claimEvidence directly.
 * The research orchestrator emits raw findings into the scratchpad; this
 * module is the single compaction boundary that normalizes those findings
 * into the canonical graph.
 *
 * See .claude/rules/scratchpad_first.md and layered_memory.md.
 */

import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { v } from "convex/values";

/** Input finding emitted by a sub-agent into the scratchpad. */
const findingSchema = v.object({
  subject: v.object({
    entityKey: v.string(),
    canonicalName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("subsidiary"),
      v.literal("person"),
      v.literal("fund"),
      v.literal("investor"),
      v.literal("product"),
      v.literal("facility"),
      v.literal("organization"),
      v.literal("other"),
    ),
    aliases: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
    sector: v.optional(v.string()),
    website: v.optional(v.string()),
  }),
  edges: v.optional(
    v.array(
      v.object({
        toEntityKey: v.string(),
        toCanonicalName: v.string(),
        toEntityType: v.union(
          v.literal("company"),
          v.literal("subsidiary"),
          v.literal("person"),
          v.literal("fund"),
          v.literal("investor"),
          v.literal("product"),
          v.literal("facility"),
          v.literal("organization"),
          v.literal("other"),
        ),
        relationFamily: v.string(),
        relationType: v.string(),
        confidence: v.number(),
        sourceRefs: v.array(v.string()),
        validFrom: v.optional(v.number()),
      }),
    ),
  ),
  claims: v.optional(
    v.array(
      v.object({
        predicate: v.string(),
        objectEntityKey: v.optional(v.string()),
        literalValue: v.optional(v.string()),
        polarity: v.union(
          v.literal("supports"),
          v.literal("contradicts"),
          v.literal("neutral"),
        ),
        confidence: v.number(),
        evidence: v.optional(
          v.array(
            v.object({
              sourceTier: v.union(
                v.literal("T1"),
                v.literal("T2"),
                v.literal("T3"),
                v.literal("USER"),
                v.literal("INTERNAL"),
              ),
              url: v.optional(v.string()),
              quoteHash: v.optional(v.string()),
              pageNumber: v.optional(v.number()),
              evidenceWeight: v.number(),
            }),
          ),
        ),
      }),
    ),
  ),
});

/**
 * Compact a batch of findings into the canonical entity graph.
 *
 * Guarantees:
 *   - Idempotent on (entityKey, relationType, toEntityKey) tuples.
 *   - Upsert semantics — existing entities keep their entityId.
 *   - All writes happen inside the mutation, so partial failures roll back.
 *   - HONEST_SCORES: confidence is never floored; if the finding lacks
 *     confidence the finding is rejected upstream, not silently defaulted.
 */
export const compactFindings = internalMutation({
  args: {
    runId: v.string(),
    findings: v.array(findingSchema),
  },
  handler: async (ctx, { runId, findings }) => {
    const now = Date.now();
    const entityIdByKey = new Map<string, Id<"intelligenceEntities">>();

    // Pass 1: upsert every subject + edge target into intelligenceEntities.
    const allSubjects = new Map<
      string,
      {
        entityKey: string;
        canonicalName: string;
        entityType:
          | "company"
          | "subsidiary"
          | "person"
          | "fund"
          | "investor"
          | "product"
          | "facility"
          | "organization"
          | "other";
        summary?: string;
        aliases?: string[];
        sector?: string;
        website?: string;
      }
    >();

    for (const f of findings) {
      allSubjects.set(f.subject.entityKey, f.subject);
      for (const e of f.edges ?? []) {
        if (!allSubjects.has(e.toEntityKey)) {
          allSubjects.set(e.toEntityKey, {
            entityKey: e.toEntityKey,
            canonicalName: e.toCanonicalName,
            entityType: e.toEntityType,
          });
        }
      }
    }

    for (const s of allSubjects.values()) {
      const existing = await ctx.db
        .query("intelligenceEntities")
        .withIndex("by_entity_key", (q) => q.eq("entityKey", s.entityKey))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          canonicalName: s.canonicalName,
          description: s.summary ?? existing.description,
          sector: s.sector ?? existing.sector,
          website: s.website ?? existing.website,
          lastResearchedAt: now,
          updatedAt: now,
        });
        entityIdByKey.set(s.entityKey, existing._id);
      } else {
        const newId = await ctx.db.insert("intelligenceEntities", {
          entityKey: s.entityKey,
          canonicalName: s.canonicalName,
          entityType: s.entityType,
          status: "active",
          description: s.summary,
          sector: s.sector,
          website: s.website,
          lastResearchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        entityIdByKey.set(s.entityKey, newId);
      }

      // Aliases — insert only new ones (dedupe on alias string).
      for (const alias of s.aliases ?? []) {
        const existingAlias = await ctx.db
          .query("entityAliases")
          .withIndex("by_alias", (q) => q.eq("alias", alias))
          .filter((q) =>
            q.eq(q.field("entityKey"), s.entityKey),
          )
          .unique();
        if (!existingAlias) {
          await ctx.db.insert("entityAliases", {
            entityId: entityIdByKey.get(s.entityKey)!,
            entityKey: s.entityKey,
            alias,
            aliasType: "other",
            isPrimary: false,
            sourceRef: `run:${runId}`,
            createdAt: now,
          });
        }
      }
    }

    // Pass 2: edges, deduped on (fromId, toId, relationType).
    let edgeInserts = 0;
    for (const f of findings) {
      const fromId = entityIdByKey.get(f.subject.entityKey);
      if (!fromId) continue;
      for (const e of f.edges ?? []) {
        const toId = entityIdByKey.get(e.toEntityKey);
        if (!toId) continue;

        const dup = await ctx.db
          .query("edges")
          .withIndex("by_from_rel", (q) =>
            q.eq("fromId", fromId).eq("relationType", e.relationType),
          )
          .filter((q) => q.eq(q.field("toId"), toId))
          .first();

        if (dup) {
          // Refresh confidence + sourceRefs monotonically.
          const merged = Array.from(
            new Set([...(dup.sourceRefs ?? []), ...e.sourceRefs]),
          );
          await ctx.db.patch(dup._id, {
            confidence: Math.max(dup.confidence, e.confidence),
            sourceRefs: merged,
          });
        } else {
          await ctx.db.insert("edges", {
            fromId,
            toId,
            relationFamily: e.relationFamily,
            relationType: e.relationType,
            confidence: e.confidence,
            sourceRefs: e.sourceRefs,
            validFrom: e.validFrom,
          });
          edgeInserts++;
        }
      }
    }

    // Pass 3: claims + claim evidence.
    let claimInserts = 0;
    for (const f of findings) {
      const subjectId = entityIdByKey.get(f.subject.entityKey);
      if (!subjectId) continue;
      for (const c of f.claims ?? []) {
        const objectId = c.objectEntityKey
          ? entityIdByKey.get(c.objectEntityKey)
          : undefined;
        const claimId = await ctx.db.insert("claims", {
          subjectEntityId: subjectId,
          predicate: c.predicate,
          objectEntityId: objectId,
          literalValue: c.literalValue,
          polarity: c.polarity,
          confidence: c.confidence,
          extractedAt: now,
        });
        claimInserts++;
        for (const ev of c.evidence ?? []) {
          await ctx.db.insert("claimEvidence", {
            claimId,
            sourceTier: ev.sourceTier,
            url: ev.url,
            quoteHash: ev.quoteHash,
            pageNumber: ev.pageNumber,
            evidenceWeight: ev.evidenceWeight,
          });
        }
      }
    }

    return {
      entityCount: entityIdByKey.size,
      edgeInserts,
      claimInserts,
      runId,
      compactedAt: now,
    };
  },
});
