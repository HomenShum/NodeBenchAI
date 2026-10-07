/**
 * Linkedin Archive Entity Links
 *
 * Denormalized many-to-many between `linkedinPostArchive` and
 * `entityContexts`. Convex doesn't index array fields for `contains`
 * queries, so we materialize one row per `(archiveRow, entity)` pair to
 * make per-entity retrieval cheap (single `withIndex("by_company_postedAt")`
 * call instead of an O(N) scan).
 *
 * Pattern: scratchpad-first → structuring → join-table compaction.
 * Prior art: Anthropic Claude Code MEMORY.md (file-system layered memory),
 * generic Convex many-to-many denormalization.
 *
 * Populated by:
 *   - rebuildAllArchiveEntityLinks (one-shot full rebuild from scratch)
 *   - upsertArchiveRowEntityLinks  (per-row, called by the funding backfill)
 *
 * Read by:
 *   - getEntityFindings (public, EntityPage / report cards)
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

/**
 * Normalize a name for case-insensitive substring matching.
 *  - Lowercase
 *  - Strip punctuation that the digest agent or LLMs add (.,!?:;'"`)
 *  - Collapse whitespace
 *  - Strip common suffixes like ", Inc." that wouldn't appear in casual mentions
 */
function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, "")
    .replace(/,?\s+(inc\.?|llc|ltd\.?|corp\.?|corporation|co\.?)$/i, "")
    .replace(/[–—\-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-boundary regex for an entity name. Required so "Google" doesn't
 * match "Googleplex" and "MCP" doesn't match arbitrary letter sequences.
 */
function entityRegex(entityName: string): RegExp {
  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "gi");
}

/**
 * Detect the funding-tracker formatter's `Trace:` prefix line:
 *
 *     Trace: single-source | 1 sources | confidence 100% | event nd7…
 *
 * If an entity's only matches in the post are inside such a line,
 * we skip the link — the mention is the formatter literal, not a
 * real company reference. Otherwise the entityContext "Trace" (a
 * real $3M-seed company) accidentally links to every funding-tracker
 * post regardless of who the post is actually about.
 */
function isFormatterPrefixLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (line.length - trimmed.length < 2) return false; // must be indented
  return /^(Trace|Sources|Risk|Audience|Opportunity|Founder lens|Product|Industry):/i.test(
    trimmed,
  );
}

/**
 * Count "real" mentions of an entity in the post content — excluding
 * matches that fall inside formatter prefix lines.
 */
function countRealMentions(content: string, regex: RegExp): number {
  // Reset lastIndex defensively in case the regex was re-used.
  regex.lastIndex = 0;
  let real = 0;
  for (const match of content.matchAll(regex)) {
    const idx = match.index ?? 0;
    const lineStart = content.lastIndexOf("\n", idx - 1) + 1;
    const lineEnd = content.indexOf("\n", idx);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (isFormatterPrefixLine(line)) continue;
    real += 1;
  }
  return real;
}

type LinkPlan = {
  companyId: Id<"entityContexts">;
  matchSource: "findings_round" | "content_mention";
};

function planLinksForRow(
  row: {
    content: string;
    metadata?: any;
  },
  entities: Array<{
    _id: Id<"entityContexts">;
    entityName: string;
    normalized: string;
    regex: RegExp;
  }>,
): LinkPlan[] {
  const plans = new Map<string, LinkPlan>();

  // 1) Findings rounds (highest signal — the post is literally about this round)
  const rounds: any[] = row.metadata?.findings?.rounds ?? [];
  for (const round of rounds) {
    const roundCompany = typeof round?.companyName === "string" ? round.companyName : "";
    const roundCompanyId = round?.companyId;
    if (typeof roundCompanyId === "string" && roundCompanyId.length > 0) {
      // Direct ID — trust it.
      plans.set(roundCompanyId, {
        companyId: roundCompanyId as Id<"entityContexts">,
        matchSource: "findings_round",
      });
      continue;
    }
    if (!roundCompany) continue;
    const roundNormalized = normalizeForMatch(roundCompany);
    if (!roundNormalized) continue;
    for (const entity of entities) {
      if (
        roundNormalized === entity.normalized ||
        roundNormalized.includes(entity.normalized) ||
        entity.normalized.includes(roundNormalized)
      ) {
        if (!plans.has(entity._id)) {
          plans.set(entity._id, { companyId: entity._id, matchSource: "findings_round" });
        }
      }
    }
  }

  // 2) Plain-text mention scan (covers daily_digest signals and prose).
  // Skip matches that appear ONLY inside a formatter prefix line — those
  // are formatter literals like "Trace:" / "Risk:" rather than real
  // entity mentions. Also skip very-short names (<= 3 chars) entirely:
  // their false-positive rate against arbitrary prose is unworkable.
  for (const entity of entities) {
    if (plans.has(entity._id)) continue;
    if (entity.entityName.trim().length <= 3) continue;
    const realMentions = countRealMentions(row.content, entity.regex);
    if (realMentions > 0) {
      plans.set(entity._id, { companyId: entity._id, matchSource: "content_mention" });
    }
  }

  return [...plans.values()];
}

/* -------------------------------------------------------------------------- */
/*  Mutation: upsert links for a single archive row                            */
/* -------------------------------------------------------------------------- */

export const upsertArchiveRowEntityLinks = internalMutation({
  args: {
    archiveRowId: v.id("linkedinPostArchive"),
  },
  returns: v.object({
    archiveRowId: v.id("linkedinPostArchive"),
    linksCreated: v.number(),
    linksDeleted: v.number(),
    linksKept: v.number(),
    matchedEntityIds: v.array(v.id("entityContexts")),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.archiveRowId);
    if (!row) {
      return {
        archiveRowId: args.archiveRowId,
        linksCreated: 0,
        linksDeleted: 0,
        linksKept: 0,
        matchedEntityIds: [],
      };
    }

    // Exclude stale entityContexts (duplicates marked by the canonicalKey
    // backfill) so per-entity link counts aren't split across dupes.
    const entityDocs = await ctx.db.query("entityContexts").collect();
    const entities = entityDocs
      .filter((e) => !e.isStale)
      .map((e) => ({
        _id: e._id,
        entityName: e.entityName,
        normalized: normalizeForMatch(e.entityName),
        regex: entityRegex(e.entityName),
      }));

    const desired = planLinksForRow({ content: row.content, metadata: row.metadata }, entities);
    const desiredById = new Map(desired.map((p) => [p.companyId, p]));

    const existing = await ctx.db
      .query("linkedinArchiveEntityLinks")
      .withIndex("by_archive_row", (q) => q.eq("archiveRowId", args.archiveRowId))
      .collect();

    let linksCreated = 0;
    let linksDeleted = 0;
    let linksKept = 0;

    // Delete stale, keep valid.
    for (const link of existing) {
      const want = desiredById.get(link.companyId);
      if (!want) {
        await ctx.db.delete(link._id);
        linksDeleted += 1;
        continue;
      }
      if (link.matchSource !== want.matchSource || link.postedAt !== row.postedAt) {
        await ctx.db.patch(link._id, {
          matchSource: want.matchSource,
          postedAt: row.postedAt,
          postType: row.postType,
          dateString: row.dateString,
        });
      }
      desiredById.delete(link.companyId);
      linksKept += 1;
    }

    // Insert remaining desired links.
    for (const plan of desiredById.values()) {
      await ctx.db.insert("linkedinArchiveEntityLinks", {
        archiveRowId: args.archiveRowId,
        companyId: plan.companyId,
        postedAt: row.postedAt,
        postType: row.postType,
        dateString: row.dateString,
        matchSource: plan.matchSource,
      });
      linksCreated += 1;
    }

    return {
      archiveRowId: args.archiveRowId,
      linksCreated,
      linksDeleted,
      linksKept,
      matchedEntityIds: desired.map((d) => d.companyId),
    };
  },
});

/* -------------------------------------------------------------------------- */
/*  Internal queries                                                           */
/* -------------------------------------------------------------------------- */

export const getAllArchiveRowsForLinking = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("linkedinPostArchive"),
      content: v.string(),
      metadata: v.optional(v.any()),
      postedAt: v.number(),
      postType: v.string(),
      dateString: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("linkedinPostArchive").collect();
    return rows.map((r) => ({
      _id: r._id,
      content: r.content,
      metadata: r.metadata,
      postedAt: r.postedAt,
      postType: r.postType,
      dateString: r.dateString,
    }));
  },
});

/* -------------------------------------------------------------------------- */
/*  Action: rebuild all links from scratch                                     */
/* -------------------------------------------------------------------------- */

export const rebuildAllArchiveEntityLinks = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const rows = await ctx.runQuery(
      internal.domains.social.linkedinArchiveEntityLinks.getAllArchiveRowsForLinking,
      {},
    );

    let created = 0;
    let deleted = 0;
    let kept = 0;
    const perRow: Array<{ id: string; matched: number }> = [];

    for (const row of rows) {
      if (dryRun) {
        perRow.push({ id: row._id, matched: 0 });
        continue;
      }
      const result = await ctx.runMutation(
        internal.domains.social.linkedinArchiveEntityLinks.upsertArchiveRowEntityLinks,
        { archiveRowId: row._id },
      );
      created += result.linksCreated;
      deleted += result.linksDeleted;
      kept += result.linksKept;
      if (result.matchedEntityIds.length > 0) {
        perRow.push({ id: row._id, matched: result.matchedEntityIds.length });
      }
    }

    const summary = {
      totalRows: rows.length,
      created,
      deleted,
      kept,
      rowsWithMatches: perRow.length,
      dryRun,
    };
    console.log(`[archiveEntityLinks] ${JSON.stringify(summary)}`);
    return { summary, perRow: perRow.slice(0, 20) };
  },
});

/* -------------------------------------------------------------------------- */
/*  Public query: getEntityFindings                                            */
/* -------------------------------------------------------------------------- */

/**
 * List entities that have at least one archive link, with link counts.
 * Used by the LinkedInPostArchiveView "By entity" pivot to populate the
 * entity selector without scanning all archive content client-side.
 */
export const listEntitiesWithArchiveLinks = query({
  args: {},
  returns: v.array(
    v.object({
      companyId: v.id("entityContexts"),
      entityName: v.string(),
      entityType: v.string(),
      linkCount: v.number(),
      latestPostedAt: v.number(),
      postTypes: v.array(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const links = await ctx.db
      .query("linkedinArchiveEntityLinks")
      .collect();
    const byCompany = new Map<
      string,
      { count: number; latestPostedAt: number; postTypes: Set<string> }
    >();
    for (const link of links) {
      const existing = byCompany.get(link.companyId);
      if (!existing) {
        byCompany.set(link.companyId, {
          count: 1,
          latestPostedAt: link.postedAt,
          postTypes: new Set([link.postType]),
        });
      } else {
        existing.count += 1;
        existing.latestPostedAt = Math.max(existing.latestPostedAt, link.postedAt);
        existing.postTypes.add(link.postType);
      }
    }
    const out: Array<{
      companyId: Id<"entityContexts">;
      entityName: string;
      entityType: string;
      linkCount: number;
      latestPostedAt: number;
      postTypes: string[];
    }> = [];
    for (const [companyId, info] of byCompany.entries()) {
      const entity = await ctx.db.get(companyId as Id<"entityContexts">);
      if (!entity) continue;
      if (entity.isStale) continue; // hide duplicates marked stale by the canonicalKey backfill
      out.push({
        companyId: companyId as Id<"entityContexts">,
        entityName: entity.entityName,
        entityType: entity.entityType,
        linkCount: info.count,
        latestPostedAt: info.latestPostedAt,
        postTypes: [...info.postTypes].sort(),
      });
    }
    out.sort((a, b) => b.latestPostedAt - a.latestPostedAt);
    return out;
  },
});

export const getEntityFindings = query({
  args: {
    companyId: v.id("entityContexts"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    entity: v.object({
      _id: v.id("entityContexts"),
      entityName: v.string(),
      entityType: v.string(),
    }),
    fundingEvents: v.array(
      v.object({
        _id: v.id("fundingEvents"),
        companyName: v.string(),
        roundType: v.string(),
        amountRaw: v.string(),
        amountUsd: v.optional(v.number()),
        leadInvestors: v.array(v.string()),
        sector: v.optional(v.string()),
        valuation: v.optional(v.string()),
        sourceUrls: v.array(v.string()),
        sourceNames: v.array(v.string()),
        confidence: v.number(),
        verificationStatus: v.string(),
        announcedAt: v.number(),
      }),
    ),
    archivePosts: v.array(
      v.object({
        _id: v.id("linkedinPostArchive"),
        dateString: v.string(),
        postType: v.string(),
        persona: v.string(),
        postUrl: v.optional(v.string()),
        postedAt: v.number(),
        matchSource: v.string(),
        contentExcerpt: v.string(),
        sourceUrls: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 25;
    const entity = await ctx.db.get(args.companyId);
    if (!entity) {
      throw new Error(`Entity not found: ${args.companyId}`);
    }

    // ---- Funding events (by direct companyId link if populated, else by name) ----
    const byIdEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_companyId", (q) => q.eq("companyId", args.companyId))
      .collect();

    const normalizedEntity = normalizeForMatch(entity.entityName);
    let fundingEventDocs = byIdEvents;
    if (fundingEventDocs.length === 0 && normalizedEntity.length >= 3) {
      // Cap to a reasonable scan budget — fundingEvents is bounded (~hundreds).
      const scan = await ctx.db
        .query("fundingEvents")
        .withIndex("by_announcedAt")
        .order("desc")
        .take(500);
      fundingEventDocs = scan.filter(
        (e) => normalizeForMatch(e.companyName) === normalizedEntity,
      );
    }

    fundingEventDocs.sort((a, b) => b.announcedAt - a.announcedAt);
    const fundingEvents = fundingEventDocs.slice(0, limit).map((e) => ({
      _id: e._id,
      companyName: e.companyName,
      roundType: e.roundType,
      amountRaw: e.amountRaw,
      amountUsd: e.amountUsd,
      leadInvestors: e.leadInvestors,
      sector: e.sector,
      valuation: e.valuation,
      sourceUrls: e.sourceUrls,
      sourceNames: e.sourceNames,
      confidence: e.confidence,
      verificationStatus: e.verificationStatus,
      announcedAt: e.announcedAt,
    }));

    // ---- Archive posts (via denormalized link table) ----
    const links = await ctx.db
      .query("linkedinArchiveEntityLinks")
      .withIndex("by_company_postedAt", (q) => q.eq("companyId", args.companyId))
      .order("desc")
      .take(limit);

    const archivePosts = await Promise.all(
      links.map(async (link) => {
        const row = await ctx.db.get(link.archiveRowId);
        if (!row) return null;
        const sourceUrls: string[] = [];
        const rounds: any[] = row.metadata?.findings?.rounds ?? [];
        for (const round of rounds) {
          if (Array.isArray(round?.sourceUrls)) {
            for (const url of round.sourceUrls) {
              if (typeof url === "string" && url.length > 0 && !sourceUrls.includes(url)) {
                sourceUrls.push(url);
              }
            }
          }
        }
        return {
          _id: row._id,
          dateString: row.dateString,
          postType: row.postType,
          persona: row.persona,
          postUrl: row.postUrl,
          postedAt: row.postedAt,
          matchSource: link.matchSource,
          contentExcerpt: row.content.slice(0, 280),
          sourceUrls: sourceUrls.slice(0, 5),
        };
      }),
    );

    return {
      entity: {
        _id: entity._id,
        entityName: entity.entityName,
        entityType: entity.entityType,
      },
      fundingEvents,
      archivePosts: archivePosts.filter((p): p is NonNullable<typeof p> => p !== null),
    };
  },
});
