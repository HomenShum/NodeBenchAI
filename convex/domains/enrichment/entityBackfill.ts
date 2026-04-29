/**
 * Entity Backfill
 *
 * Promotes startups (from `fundingEvents`) and digest-spotlight entities
 * (from `digestCache.digest.entitySpotlight`) into `entityContexts` so the
 * `linkedinArchiveEntityLinks` join table picks them up on the next
 * rebuild. Fixes the orphan-row gap where 19/32 archive rows had no
 * matching `entityContexts` because the entity registry was hand-curated.
 *
 * Idempotent: keyed by `canonicalKey` (`buildCanonicalKey(type, name)`).
 * Re-runs upsert in place rather than creating duplicates.
 *
 * Note: replaces the legacy `entityPromotion.ts` createEntityFromFunding
 * mutation, which writes fields that no longer exist in the schema
 * (`name`, `status`, `priority`, `sector` at top level — schema has
 * `entityName`, `crmFields.industry`, etc.).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildCanonicalKey } from "../../lib/entityResolution";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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

function isGenericName(name: string | undefined | null): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length < 2) return true;
  if (
    n === "unknown" ||
    n === "company" ||
    n === "n/a" ||
    n === "tbd" ||
    n.startsWith("unknown ") ||
    /^(seed|series\s*[a-z]|growth|debt)$/i.test(n)
  ) {
    return true;
  }
  return false;
}

function formatUsd(amountUsd?: number, fallback?: string): string {
  if (typeof amountUsd === "number" && Number.isFinite(amountUsd) && amountUsd > 0) {
    if (amountUsd >= 1_000_000_000) return `$${(amountUsd / 1_000_000_000).toFixed(1)}B`;
    if (amountUsd >= 1_000_000) return `$${Math.round(amountUsd / 1_000_000)}M`;
    if (amountUsd >= 1_000) return `$${Math.round(amountUsd / 1_000)}K`;
    return `$${amountUsd}`;
  }
  return fallback ?? "n/a";
}

/* -------------------------------------------------------------------------- */
/*  Path 1: Funding events → entityContexts                                    */
/* -------------------------------------------------------------------------- */

export const upsertEntityFromFunding = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  returns: v.object({
    fundingEventId: v.id("fundingEvents"),
    companyId: v.optional(v.id("entityContexts")),
    created: v.boolean(),
    skipped: v.boolean(),
    skipReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.fundingEventId);
    if (!event) {
      return {
        fundingEventId: args.fundingEventId,
        companyId: undefined,
        created: false,
        skipped: true,
        skipReason: "funding_event_not_found",
      };
    }
    if (isGenericName(event.companyName)) {
      return {
        fundingEventId: args.fundingEventId,
        companyId: undefined,
        created: false,
        skipped: true,
        skipReason: "generic_company_name",
      };
    }

    const canonicalKey = buildCanonicalKey("company", event.companyName);

    // Already linked → just confirm and exit.
    if (event.companyId) {
      return {
        fundingEventId: args.fundingEventId,
        companyId: event.companyId,
        created: false,
        skipped: true,
        skipReason: "already_linked",
      };
    }

    const existing = await ctx.db
      .query("entityContexts")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonicalKey))
      .first();

    let entityId: Id<"entityContexts">;
    let created = false;

    if (existing) {
      entityId = existing._id;
      // Refresh access metadata so the freshness signal is honest.
      await ctx.db.patch(entityId, {
        lastAccessedAt: Date.now(),
        accessCount: (existing.accessCount ?? 0) + 1,
      });
    } else {
      const now = Date.now();
      const summary =
        event.description && event.description.trim().length > 0
          ? event.description.trim()
          : `${event.companyName} raised ${formatUsd(event.amountUsd, event.amountRaw)} (${event.roundType}).`;
      const sources = (event.sourceUrls ?? []).slice(0, 5).map((url, i) => ({
        name: event.sourceNames?.[i] ?? "source",
        url,
      }));
      const keyFacts: string[] = [];
      keyFacts.push(`${event.roundType} round: ${formatUsd(event.amountUsd, event.amountRaw)}`);
      if (event.sector) keyFacts.push(`Sector: ${event.sector}`);
      if (event.location) keyFacts.push(`Location: ${event.location}`);
      if (event.valuation) keyFacts.push(`Valuation: ${event.valuation}`);
      if (Array.isArray(event.leadInvestors) && event.leadInvestors.length > 0) {
        keyFacts.push(`Lead investors: ${event.leadInvestors.slice(0, 3).join(", ")}`);
      }

      entityId = await ctx.db.insert("entityContexts", {
        entityName: event.companyName,
        entityType: "company",
        summary,
        keyFacts,
        sources,
        crmFields: {
          companyName: event.companyName,
          description:
            event.description && event.description.trim().length > 0
              ? event.description
              : "",
          headline: "",
          hqLocation: event.location ?? "",
          city: "",
          state: "",
          country: "",
          website: "",
          email: "",
          phone: "",
          founders: [],
          foundersBackground: "",
          keyPeople: [],
          industry: event.sector ?? "",
          companyType: "",
          foundingYear: undefined,
          product: "",
          targetMarket: "",
          businessModel: "",
          fundingStage: event.roundType,
          totalFunding: formatUsd(event.amountUsd, event.amountRaw),
          lastFundingDate: new Date(event.announcedAt).toISOString().split("T")[0],
          investors: event.leadInvestors ?? [],
          investorBackground: "",
          competitors: [],
          competitorAnalysis: "",
          fdaApprovalStatus: "",
          fdaTimeline: "",
          newsTimeline: [],
          recentNews: "",
          keyEntities: [],
          researchPapers: [],
          partnerships: [],
          completenessScore: 25,
          dataQuality: "incomplete",
        },
        canonicalKey,
        researchedAt: now,
        researchedBy: undefined,
        lastAccessedAt: now,
        accessCount: 1,
        version: 1,
        isStale: false,
        ingestedAt: now,
      });
      created = true;
    }

    // Patch the funding event so future per-entity queries hit the
    // by_companyId index instead of the normalized-name fallback.
    await ctx.db.patch(args.fundingEventId, { companyId: entityId });

    return {
      fundingEventId: args.fundingEventId,
      companyId: entityId,
      created,
      skipped: false,
      skipReason: undefined,
    };
  },
});

export const listFundingEventsForBackfill = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("fundingEvents"),
      companyName: v.string(),
      hasCompanyId: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("fundingEvents").collect();
    return rows.map((r) => ({
      _id: r._id,
      companyName: r.companyName,
      hasCompanyId: !!r.companyId,
    }));
  },
});

export const promoteFundingEventsToEntities = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const limit = args.limit ?? 1000;

    const events = await ctx.runQuery(
      internal.domains.enrichment.entityBackfill.listFundingEventsForBackfill,
      {},
    );

    let created = 0;
    let linkedExisting = 0;
    let skipped = 0;
    const sample: Array<{ fundingEventId: string; status: string }> = [];

    for (const event of events.slice(0, limit)) {
      if (dryRun) {
        sample.push({
          fundingEventId: event._id,
          status: event.hasCompanyId
            ? "would_skip_already_linked"
            : isGenericName(event.companyName)
              ? "would_skip_generic"
              : "would_create_or_link",
        });
        if (event.hasCompanyId || isGenericName(event.companyName)) {
          skipped += 1;
        } else {
          created += 1;
        }
        continue;
      }

      const result = await ctx.runMutation(
        internal.domains.enrichment.entityBackfill.upsertEntityFromFunding,
        { fundingEventId: event._id },
      );
      if (result.skipped) {
        skipped += 1;
      } else if (result.created) {
        created += 1;
      } else {
        linkedExisting += 1;
      }
      if (sample.length < 10) {
        sample.push({
          fundingEventId: event._id,
          status: result.skipped
            ? `skipped:${result.skipReason}`
            : result.created
              ? "created"
              : "linked_existing",
        });
      }
    }

    const summary = {
      totalEvents: events.length,
      considered: Math.min(events.length, limit),
      created,
      linkedExisting,
      skipped,
      dryRun,
    };
    console.log(`[entityBackfill:funding] ${JSON.stringify(summary)}`);
    return { summary, sample };
  },
});

/* -------------------------------------------------------------------------- */
/*  Path 2: digestCache.entitySpotlight → entityContexts                       */
/* -------------------------------------------------------------------------- */

export const upsertEntityFromDigestSpotlight = internalMutation({
  args: {
    name: v.string(),
    type: v.string(),
    keyInsight: v.string(),
    fundingStage: v.optional(v.string()),
    sourceDateString: v.string(),
  },
  returns: v.object({
    name: v.string(),
    companyId: v.optional(v.id("entityContexts")),
    created: v.boolean(),
    skipped: v.boolean(),
    skipReason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (isGenericName(args.name)) {
      return {
        name: args.name,
        companyId: undefined,
        created: false,
        skipped: true,
        skipReason: "generic_name",
      };
    }

    // The digest agent emits entityType strings like "company", "person",
    // "biotech", "tech". Normalize to the schema's two-value union.
    const entityType: "company" | "person" =
      args.type.toLowerCase().includes("person") || args.type.toLowerCase().includes("founder")
        ? "person"
        : "company";

    const canonicalKey = buildCanonicalKey(entityType, args.name);

    const existing = await ctx.db
      .query("entityContexts")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonicalKey))
      .first();

    if (existing) {
      // Append the insight as a new keyFact if not already present.
      const insight = args.keyInsight.trim();
      const facts = existing.keyFacts ?? [];
      const alreadyHas = facts.some(
        (f) => normalizeForMatch(f) === normalizeForMatch(insight),
      );
      const nextFacts = alreadyHas ? facts : [...facts, insight].slice(-10);
      await ctx.db.patch(existing._id, {
        keyFacts: nextFacts,
        lastAccessedAt: Date.now(),
        accessCount: (existing.accessCount ?? 0) + 1,
      });
      return {
        name: args.name,
        companyId: existing._id,
        created: false,
        skipped: false,
        skipReason: undefined,
      };
    }

    const now = Date.now();
    const entityId = await ctx.db.insert("entityContexts", {
      entityName: args.name,
      entityType,
      summary: args.keyInsight.trim() || `${args.name} — observed in ${args.sourceDateString} digest.`,
      keyFacts: args.fundingStage ? [args.keyInsight, `Stage: ${args.fundingStage}`] : [args.keyInsight],
      sources: [],
      crmFields:
        entityType === "company"
          ? {
              companyName: args.name,
              description: args.keyInsight.trim(),
              headline: "",
              hqLocation: "",
              city: "",
              state: "",
              country: "",
              website: "",
              email: "",
              phone: "",
              founders: [],
              foundersBackground: "",
              keyPeople: [],
              industry: "",
              companyType: "",
              foundingYear: undefined,
              product: "",
              targetMarket: "",
              businessModel: "",
              fundingStage: args.fundingStage ?? "",
              totalFunding: "",
              lastFundingDate: "",
              investors: [],
              investorBackground: "",
              competitors: [],
              competitorAnalysis: "",
              fdaApprovalStatus: "",
              fdaTimeline: "",
              newsTimeline: [],
              recentNews: "",
              keyEntities: [],
              researchPapers: [],
              partnerships: [],
              completenessScore: 15,
              dataQuality: "incomplete",
            }
          : undefined,
      canonicalKey,
      researchedAt: now,
      researchedBy: undefined,
      lastAccessedAt: now,
      accessCount: 1,
      version: 1,
      isStale: false,
      ingestedAt: now,
    });

    return {
      name: args.name,
      companyId: entityId,
      created: true,
      skipped: false,
      skipReason: undefined,
    };
  },
});

export const listDigestSpotlightForBackfill = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      dateString: v.string(),
      spotlight: v.array(
        v.object({
          name: v.string(),
          type: v.string(),
          keyInsight: v.string(),
          fundingStage: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("digestCache").collect();
    return rows
      .map((r) => ({
        dateString: r.dateString,
        spotlight: r.digest?.entitySpotlight ?? [],
      }))
      .filter((r) => r.spotlight.length > 0);
  },
});

export const promoteDigestEntitiesToEntities = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const rows = await ctx.runQuery(
      internal.domains.enrichment.entityBackfill.listDigestSpotlightForBackfill,
      {},
    );

    // Deduplicate by (entityType, normalized name) — the digest agent
    // emits the same entity in multiple cached digests.
    const seen = new Map<
      string,
      {
        name: string;
        type: string;
        keyInsight: string;
        fundingStage?: string;
        sourceDateString: string;
      }
    >();
    for (const row of rows) {
      for (const entity of row.spotlight) {
        if (isGenericName(entity.name)) continue;
        const entityType: "company" | "person" = entity.type
          .toLowerCase()
          .includes("person")
          ? "person"
          : "company";
        const key = `${entityType}:${normalizeForMatch(entity.name)}`;
        if (!seen.has(key)) {
          seen.set(key, {
            name: entity.name,
            type: entity.type,
            keyInsight: entity.keyInsight,
            fundingStage: entity.fundingStage,
            sourceDateString: row.dateString,
          });
        }
      }
    }

    let created = 0;
    let linkedExisting = 0;
    let skipped = 0;
    const sample: Array<{ name: string; status: string }> = [];

    for (const [, entity] of seen) {
      if (dryRun) {
        sample.push({ name: entity.name, status: "would_create_or_link" });
        created += 1;
        continue;
      }
      const result = await ctx.runMutation(
        internal.domains.enrichment.entityBackfill.upsertEntityFromDigestSpotlight,
        {
          name: entity.name,
          type: entity.type,
          keyInsight: entity.keyInsight,
          fundingStage: entity.fundingStage,
          sourceDateString: entity.sourceDateString,
        },
      );
      if (result.skipped) skipped += 1;
      else if (result.created) created += 1;
      else linkedExisting += 1;
      if (sample.length < 10) {
        sample.push({
          name: entity.name,
          status: result.skipped
            ? `skipped:${result.skipReason}`
            : result.created
              ? "created"
              : "linked_existing",
        });
      }
    }

    const summary = {
      digestsScanned: rows.length,
      uniqueEntities: seen.size,
      created,
      linkedExisting,
      skipped,
      dryRun,
    };
    console.log(`[entityBackfill:digest] ${JSON.stringify(summary)}`);
    return { summary, sample };
  },
});

/* -------------------------------------------------------------------------- */
/*  Path 3: backfill canonicalKey on legacy entityContexts                     */
/* -------------------------------------------------------------------------- */

/**
 * Some legacy entityContexts rows (created before canonicalKey was added
 * to the schema) lack the field, so the `by_canonicalKey` upsert path
 * misses them and creates duplicates. Walk all rows, fill in
 * canonicalKey where absent — keyed by (entityType, entityName).
 *
 * If two rows hash to the same canonicalKey, keep the earlier one and
 * mark the later as `isStale: true` so it's de-prioritized in the UI
 * (we don't delete — that would break inbound foreign keys).
 */
export const backfillEntityContextsCanonicalKey = internalMutation({
  args: {},
  returns: v.object({
    totalRows: v.number(),
    patched: v.number(),
    duplicateMarkedStale: v.number(),
    sample: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("entityContexts").collect();
    const byKey = new Map<string, Id<"entityContexts">>();
    let patched = 0;
    let duplicateMarkedStale = 0;
    const sample: string[] = [];

    // Sort by creation time so the earliest row wins on collision.
    rows.sort((a, b) => a._creationTime - b._creationTime);

    for (const row of rows) {
      const wantedKey = buildCanonicalKey(
        row.entityType as "company" | "person",
        row.entityName,
      );
      const existing = byKey.get(wantedKey);
      if (existing) {
        // Duplicate — mark as stale.
        if (!row.isStale) {
          await ctx.db.patch(row._id, {
            isStale: true,
            canonicalKey: row.canonicalKey ?? wantedKey,
          });
          duplicateMarkedStale += 1;
          if (sample.length < 10) {
            sample.push(`stale_dup ${row.entityName} (${row._id})`);
          }
        }
        continue;
      }
      byKey.set(wantedKey, row._id);
      if (row.canonicalKey !== wantedKey) {
        await ctx.db.patch(row._id, { canonicalKey: wantedKey });
        patched += 1;
        if (sample.length < 10) {
          sample.push(`patched ${row.entityName} → ${wantedKey}`);
        }
      }
    }

    return {
      totalRows: rows.length,
      patched,
      duplicateMarkedStale,
      sample,
    };
  },
});

/* -------------------------------------------------------------------------- */
/*  Combined: full backfill + relink                                           */
/* -------------------------------------------------------------------------- */

export const fullEntityBackfillAndRelink = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    // Step 0: canonicalKey backfill — ensures the upsert path dedupes
    // against legacy rows (Google, etc.) that were created before
    // canonicalKey was added to the schema.
    let canonical: any = null;
    if (!dryRun) {
      canonical = await ctx.runMutation(
        internal.domains.enrichment.entityBackfill.backfillEntityContextsCanonicalKey,
        {},
      );
    }
    const funding = await ctx.runAction(
      internal.domains.enrichment.entityBackfill.promoteFundingEventsToEntities,
      { dryRun },
    );
    const digest = await ctx.runAction(
      internal.domains.enrichment.entityBackfill.promoteDigestEntitiesToEntities,
      { dryRun },
    );
    let relink: any = null;
    if (!dryRun) {
      relink = await ctx.runAction(
        internal.domains.social.linkedinArchiveEntityLinks.rebuildAllArchiveEntityLinks,
        { dryRun: false },
      );
    }
    return { canonical, funding, digest, relink, dryRun };
  },
});
