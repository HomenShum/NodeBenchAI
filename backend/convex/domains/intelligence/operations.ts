/**
 * Intelligence Graph Operations — CRUD + graph expansion for entity/people/investor tracking
 *
 * Provides queries and mutations for the intelligence domain tables:
 * intelligenceEntities, entityAliases, peopleProfiles, investorProfiles,
 * fundHoldings, ownershipSnapshots, stakeholderGraphs.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

// ===========================================================================
// Queries
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. getEntity — by entityKey
// ---------------------------------------------------------------------------

export const getEntity = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    return ctx.db
      .query("intelligenceEntities")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();
  },
});

// ---------------------------------------------------------------------------
// 2. resolveAlias — given an alias string, resolve to canonical entity
// ---------------------------------------------------------------------------

export const resolveAlias = query({
  args: { alias: v.string() },
  handler: async (ctx, { alias }) => {
    const aliasRecord = await ctx.db
      .query("entityAliases")
      .withIndex("by_alias", (q) => q.eq("alias", alias))
      .first();
    if (!aliasRecord) return null;
    const entity = await ctx.db.get(aliasRecord.entityId);
    return entity ? { alias: aliasRecord, entity } : null;
  },
});

// ---------------------------------------------------------------------------
// 3. getEntityWithAliases — entity + all its aliases
// ---------------------------------------------------------------------------

export const getEntityWithAliases = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    const entity = await ctx.db
      .query("intelligenceEntities")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();
    if (!entity) return null;
    const aliases = await ctx.db
      .query("entityAliases")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();
    return { entity, aliases };
  },
});

// ---------------------------------------------------------------------------
// 4. searchEntities — by entityType, sector, or countryCode (up to 50)
// ---------------------------------------------------------------------------

export const searchEntities = query({
  args: {
    entityType: v.optional(
      v.union(
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
    ),
    sector: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityType, sector, countryCode, limit }) => {
    const cap = Math.min(limit ?? 50, 50);

    // Prefer the most selective index available
    if (sector && entityType) {
      return ctx.db
        .query("intelligenceEntities")
        .withIndex("by_sector", (q) => q.eq("sector", sector).eq("entityType", entityType))
        .take(cap);
    }
    if (sector) {
      return ctx.db
        .query("intelligenceEntities")
        .withIndex("by_sector", (q) => q.eq("sector", sector))
        .take(cap);
    }
    if (countryCode && entityType) {
      return ctx.db
        .query("intelligenceEntities")
        .withIndex("by_country", (q) => q.eq("countryCode", countryCode).eq("entityType", entityType))
        .take(cap);
    }
    if (countryCode) {
      return ctx.db
        .query("intelligenceEntities")
        .withIndex("by_country", (q) => q.eq("countryCode", countryCode))
        .take(cap);
    }
    if (entityType) {
      return ctx.db
        .query("intelligenceEntities")
        .withIndex("by_type_name", (q) => q.eq("entityType", entityType))
        .take(cap);
    }

    // Fallback: full scan (capped)
    return ctx.db.query("intelligenceEntities").take(cap);
  },
});

// ---------------------------------------------------------------------------
// 5. getPersonProfile — by entityKey
// ---------------------------------------------------------------------------

export const getPersonProfile = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    return ctx.db
      .query("peopleProfiles")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();
  },
});

// ---------------------------------------------------------------------------
// 6. getInvestorProfile — by entityKey
// ---------------------------------------------------------------------------

export const getInvestorProfile = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    return ctx.db
      .query("investorProfiles")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();
  },
});

// ---------------------------------------------------------------------------
// 7. getHoldings — all holdings for a given holderEntityKey
// ---------------------------------------------------------------------------

export const getHoldings = query({
  args: { holderEntityKey: v.string() },
  handler: async (ctx, { holderEntityKey }) => {
    return ctx.db
      .query("fundHoldings")
      .withIndex("by_holder", (q) => q.eq("holderEntityKey", holderEntityKey))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// 8. getOwnershipSnapshot — latest snapshot for an entity
// ---------------------------------------------------------------------------

export const getOwnershipSnapshot = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    // by_entity_date index is [entityKey, asOfDate] — collect all for entity,
    // take last (highest asOfDate lexicographic sort)
    const snapshots = await ctx.db
      .query("ownershipSnapshots")
      .withIndex("by_entity_date", (q) => q.eq("entityKey", entityKey))
      .order("desc")
      .first();
    return snapshots;
  },
});

// ---------------------------------------------------------------------------
// 9. getStakeholderGraph — by entityKey
// ---------------------------------------------------------------------------

export const getStakeholderGraph = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    return ctx.db
      .query("stakeholderGraphs")
      .withIndex("by_entity", (q) => q.eq("entityKey", entityKey))
      .first();
  },
});

// ---------------------------------------------------------------------------
// 10. getEntityNetwork — graph expansion: all related entities
// ---------------------------------------------------------------------------

export const getEntityNetwork = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    // Core entity
    const entity = await ctx.db
      .query("intelligenceEntities")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();
    if (!entity) return null;

    // Aliases
    const aliases = await ctx.db
      .query("entityAliases")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .collect();

    // Holdings where this entity is the holder (outbound investments)
    const holdingsAsHolder = await ctx.db
      .query("fundHoldings")
      .withIndex("by_holder", (q) => q.eq("holderEntityKey", entityKey))
      .collect();

    // Holdings where this entity is held (inbound investors)
    const holdingsAsHeld = await ctx.db
      .query("fundHoldings")
      .withIndex("by_holding", (q) => q.eq("holdingEntityKey", entityKey))
      .collect();

    // People at this org
    const people = await ctx.db
      .query("peopleProfiles")
      .withIndex("by_current_org", (q) => q.eq("currentOrgEntityKey", entityKey))
      .collect();

    // Investor profiles for this entity
    const investorProfile = await ctx.db
      .query("investorProfiles")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", entityKey))
      .first();

    // Collect unique related entityKeys for resolution
    const relatedKeys = new Set<string>();
    for (const h of holdingsAsHolder) relatedKeys.add(h.holdingEntityKey);
    for (const h of holdingsAsHeld) relatedKeys.add(h.holderEntityKey);
    for (const p of people) {
      if (p.entityKey !== entityKey) relatedKeys.add(p.entityKey);
    }
    relatedKeys.delete(entityKey); // exclude self

    // Resolve related entities (batch lookup)
    const relatedEntities: any[] = [];
    for (const key of relatedKeys) {
      const related = await ctx.db
        .query("intelligenceEntities")
        .withIndex("by_entity_key", (q) => q.eq("entityKey", key))
        .first();
      if (related) relatedEntities.push(related);
    }

    return {
      entity,
      aliases,
      holdingsAsHolder,
      holdingsAsHeld,
      people,
      investorProfile,
      relatedEntities,
    };
  },
});

// ===========================================================================
// Mutations
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. upsertEntity — create or update by entityKey (idempotent)
// ---------------------------------------------------------------------------

export const upsertEntity = mutation({
  args: {
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
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("acquired"),
      v.literal("dissolved"),
      v.literal("unknown"),
    ),
    description: v.optional(v.string()),
    sector: v.optional(v.string()),
    subsector: v.optional(v.string()),
    headquarters: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    foundedYear: v.optional(v.number()),
    website: v.optional(v.string()),
    wikidataId: v.optional(v.string()),
    linkedEntityContextId: v.optional(v.id("entityContexts")),
    dimensionProfileId: v.optional(v.id("dimensionProfiles")),
    durableSourceCount: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("intelligenceEntities")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", args.entityKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("intelligenceEntities", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// 2. addAlias — add alias to entity
// ---------------------------------------------------------------------------

export const addAlias = mutation({
  args: {
    entityId: v.id("intelligenceEntities"),
    entityKey: v.string(),
    alias: v.string(),
    aliasType: v.union(
      v.literal("legal_name"),
      v.literal("trade_name"),
      v.literal("ticker"),
      v.literal("cusip"),
      v.literal("isin"),
      v.literal("lei"),
      v.literal("abbreviation"),
      v.literal("former_name"),
      v.literal("nickname"),
      v.literal("other"),
    ),
    isPrimary: v.boolean(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate alias on same entity
    const existing = await ctx.db
      .query("entityAliases")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", args.entityKey))
      .collect();
    const dupe = existing.find(
      (a) => a.alias === args.alias && a.aliasType === args.aliasType,
    );
    if (dupe) return dupe._id;

    return ctx.db.insert("entityAliases", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// 3. upsertPersonProfile — create or update person by entityKey
// ---------------------------------------------------------------------------

export const upsertPersonProfile = mutation({
  args: {
    entityId: v.id("intelligenceEntities"),
    entityKey: v.string(),
    fullName: v.string(),
    currentTitle: v.optional(v.string()),
    currentOrg: v.optional(v.string()),
    currentOrgEntityKey: v.optional(v.string()),
    bio: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    employmentHistory: v.array(
      v.object({
        orgName: v.string(),
        orgEntityKey: v.optional(v.string()),
        title: v.string(),
        startYear: v.optional(v.number()),
        endYear: v.optional(v.number()),
        isCurrent: v.boolean(),
      }),
    ),
    boardRoles: v.array(
      v.object({
        orgName: v.string(),
        orgEntityKey: v.optional(v.string()),
        role: v.string(),
        startYear: v.optional(v.number()),
        endYear: v.optional(v.number()),
        isCurrent: v.boolean(),
      }),
    ),
    educationHistory: v.optional(
      v.array(
        v.object({
          institution: v.string(),
          degree: v.optional(v.string()),
          field: v.optional(v.string()),
          year: v.optional(v.number()),
        }),
      ),
    ),
    notableExits: v.optional(
      v.array(
        v.object({
          company: v.string(),
          exitType: v.string(),
          year: v.optional(v.number()),
          value: v.optional(v.string()),
        }),
      ),
    ),
    credibilityScore: v.optional(v.number()),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          kind: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("peopleProfiles")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", args.entityKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, lastUpdatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("peopleProfiles", {
      ...args,
      lastUpdatedAt: now,
      createdAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// 4. upsertInvestorProfile — create or update investor by entityKey
// ---------------------------------------------------------------------------

export const upsertInvestorProfile = mutation({
  args: {
    entityId: v.id("intelligenceEntities"),
    entityKey: v.string(),
    firmName: v.string(),
    investorType: v.union(
      v.literal("vc"),
      v.literal("pe"),
      v.literal("angel"),
      v.literal("corporate"),
      v.literal("sovereign_wealth"),
      v.literal("institutional"),
      v.literal("family_office"),
      v.literal("other"),
    ),
    aum: v.optional(v.string()),
    focusSectors: v.optional(v.array(v.string())),
    focusStages: v.optional(v.array(v.string())),
    focusGeographies: v.optional(v.array(v.string())),
    portfolioSize: v.optional(v.number()),
    notablePortfolio: v.optional(v.array(v.string())),
    keyPartners: v.optional(v.array(v.string())),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          kind: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("investorProfiles")
      .withIndex("by_entity_key", (q) => q.eq("entityKey", args.entityKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("investorProfiles", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// 5. recordHolding — add/update fund holding
// ---------------------------------------------------------------------------

export const recordHolding = mutation({
  args: {
    holderEntityKey: v.string(),
    holdingEntityKey: v.string(),
    holdingType: v.union(
      v.literal("equity"),
      v.literal("debt"),
      v.literal("convertible"),
      v.literal("warrant"),
      v.literal("option"),
      v.literal("other"),
    ),
    percentOwnership: v.optional(v.number()),
    sharesHeld: v.optional(v.number()),
    valueUsd: v.optional(v.number()),
    reportedDate: v.string(),
    filingRef: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing holding with same holder+holding+date (update if found)
    const existing = await ctx.db
      .query("fundHoldings")
      .withIndex("by_holder", (q) =>
        q.eq("holderEntityKey", args.holderEntityKey).eq("reportedDate", args.reportedDate),
      )
      .collect();
    const match = existing.find(
      (h) => h.holdingEntityKey === args.holdingEntityKey && h.holdingType === args.holdingType,
    );

    if (match) {
      await ctx.db.patch(match._id, { ...args, updatedAt: now });
      return match._id;
    }

    return ctx.db.insert("fundHoldings", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// 6. recordOwnershipSnapshot — with hash-based dedup
// ---------------------------------------------------------------------------

export const recordOwnershipSnapshot = mutation({
  args: {
    entityKey: v.string(),
    asOfDate: v.string(),
    holders: v.array(
      v.object({
        holderEntityKey: v.string(),
        holderName: v.string(),
        holdingType: v.string(),
        percentOwnership: v.optional(v.number()),
        valueUsd: v.optional(v.number()),
      }),
    ),
    totalKnownOwnership: v.optional(v.number()),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          kind: v.optional(v.string()),
        }),
      ),
    ),
    snapshotHash: v.string(),
  },
  handler: async (ctx, args) => {
    // Hash-based dedup: skip if identical snapshot already recorded
    const existing = await ctx.db
      .query("ownershipSnapshots")
      .withIndex("by_hash", (q) => q.eq("snapshotHash", args.snapshotHash))
      .first();
    if (existing) return existing._id;

    return ctx.db.insert("ownershipSnapshots", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// 7. upsertStakeholderGraph — create or update stakeholder analysis
// ---------------------------------------------------------------------------

export const upsertStakeholderGraph = mutation({
  args: {
    missionId: v.optional(v.string()),
    entityKey: v.string(),
    actors: v.array(
      v.object({
        actorKey: v.string(),
        actorName: v.string(),
        role: v.string(),
        goals: v.array(v.string()),
        fears: v.optional(v.array(v.string())),
        incentives: v.array(v.string()),
        constraints: v.optional(v.array(v.string())),
        visibilityScope: v.optional(v.string()),
      }),
    ),
    incentiveInterpretations: v.array(
      v.object({
        actorKey: v.string(),
        likelyObjective: v.string(),
        likelyBias: v.optional(v.string()),
        pressureSource: v.optional(v.string()),
        localOptimizationRisk: v.optional(v.string()),
        likelyFailureMode: v.optional(v.string()),
        evidenceRefs: v.optional(v.array(v.string())),
        confidence: v.number(),
      }),
    ),
    analysisNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("stakeholderGraphs")
      .withIndex("by_entity", (q) => q.eq("entityKey", args.entityKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("stakeholderGraphs", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
