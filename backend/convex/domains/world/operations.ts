/**
 * World Graph Operations — CRUD + graph traversal for world intelligence
 *
 * Bloomberg-style global event and infrastructure monitoring.
 * Maps world events → regions → infrastructure → companies → supply chains.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

// ===========================================================================
// Queries — Geo Entities
// ===========================================================================

/** Get a single geo entity by its unique geoKey. */
export const getGeoEntity = query({
  args: { geoKey: v.string() },
  handler: async (ctx, { geoKey }) => {
    return await ctx.db
      .query("geoEntities")
      .withIndex("by_geo_key", (q) => q.eq("geoKey", geoKey))
      .first();
  },
});

/** Get all child geo entities of a parent geoKey. */
export const getChildGeoEntities = query({
  args: { parentGeoKey: v.string() },
  handler: async (ctx, { parentGeoKey }) => {
    return await ctx.db
      .query("geoEntities")
      .withIndex("by_parent", (q) => q.eq("parentGeoKey", parentGeoKey))
      .collect();
  },
});

// ===========================================================================
// Queries — Geo Relationships
// ===========================================================================

/** Get all relationships originating from a geoKey. */
export const getGeoRelationships = query({
  args: { geoKey: v.string() },
  handler: async (ctx, { geoKey }) => {
    return await ctx.db
      .query("geoRelationships")
      .withIndex("by_from_type", (q) => q.eq("fromGeoKey", geoKey))
      .collect();
  },
});

// ===========================================================================
// Queries — Infrastructure Assets
// ===========================================================================

/** Get a single infrastructure asset by assetKey. */
export const getInfrastructureAsset = query({
  args: { assetKey: v.string() },
  handler: async (ctx, { assetKey }) => {
    return await ctx.db
      .query("infrastructureAssets")
      .withIndex("by_asset_key", (q) => q.eq("assetKey", assetKey))
      .first();
  },
});

/** Get all infrastructure assets in a given geo region. */
export const getInfraByRegion = query({
  args: { geoKey: v.string() },
  handler: async (ctx, { geoKey }) => {
    return await ctx.db
      .query("infrastructureAssets")
      .withIndex("by_geo", (q) => q.eq("geoKey", geoKey))
      .collect();
  },
});

/** Get infrastructure assets filtered by type and status. */
export const getInfraByStatus = query({
  args: {
    assetType: v.union(
      v.literal("port"),
      v.literal("airport"),
      v.literal("pipeline"),
      v.literal("subsea_cable"),
      v.literal("power_plant"),
      v.literal("data_center"),
      v.literal("rail_hub"),
      v.literal("highway"),
      v.literal("refinery"),
      v.literal("warehouse"),
      v.literal("other"),
    ),
    status: v.union(
      v.literal("operational"),
      v.literal("degraded"),
      v.literal("offline"),
      v.literal("under_construction"),
      v.literal("decommissioned"),
    ),
  },
  handler: async (ctx, { assetType, status }) => {
    return await ctx.db
      .query("infrastructureAssets")
      .withIndex("by_type_status", (q) =>
        q.eq("assetType", assetType).eq("status", status),
      )
      .collect();
  },
});

// ===========================================================================
// Queries — Country Risk
// ===========================================================================

/** Get the latest risk snapshot for a country. */
export const getCountryRisk = query({
  args: { countryCode: v.string() },
  handler: async (ctx, { countryCode }) => {
    return await ctx.db
      .query("countryRiskSnapshots")
      .withIndex("by_country_date", (q) => q.eq("countryCode", countryCode))
      .order("desc")
      .first();
  },
});

/** Get all countries with risk at or above "elevated". */
export const getHighRiskCountries = query({
  args: {},
  handler: async (ctx) => {
    const elevated = await ctx.db
      .query("countryRiskSnapshots")
      .withIndex("by_risk_date", (q) => q.eq("overallRisk", "elevated"))
      .order("desc")
      .collect();
    const high = await ctx.db
      .query("countryRiskSnapshots")
      .withIndex("by_risk_date", (q) => q.eq("overallRisk", "high"))
      .order("desc")
      .collect();
    const critical = await ctx.db
      .query("countryRiskSnapshots")
      .withIndex("by_risk_date", (q) => q.eq("overallRisk", "critical"))
      .order("desc")
      .collect();

    // Deduplicate by countryCode — keep only the latest snapshot per country
    const seen = new Set<string>();
    const results: (typeof elevated)[number][] = [];
    // Process critical first (highest priority), then high, then elevated
    for (const snapshot of [...critical, ...high, ...elevated]) {
      if (!seen.has(snapshot.countryCode)) {
        seen.add(snapshot.countryCode);
        results.push(snapshot);
      }
    }
    return results;
  },
});

// ===========================================================================
// Queries — Entity Exposure Edges
// ===========================================================================

/** Get all exposure edges for a given entity. */
export const getEntityExposures = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    return await ctx.db
      .query("entityExposureEdges")
      .withIndex("by_entity", (q) => q.eq("entityKey", entityKey))
      .collect();
  },
});

/** Get all entities exposed to a given geo region. */
export const getGeoExposures = query({
  args: { geoKey: v.string() },
  handler: async (ctx, { geoKey }) => {
    return await ctx.db
      .query("entityExposureEdges")
      .withIndex("by_geo", (q) => q.eq("geoKey", geoKey))
      .collect();
  },
});

// ===========================================================================
// Queries — Market Signals
// ===========================================================================

/** Get recent market signals by type, ordered newest first. */
export const getRecentMarketSignals = query({
  args: {
    signalType: v.union(
      v.literal("macro_indicator"),
      v.literal("sector_trend"),
      v.literal("commodity_price"),
      v.literal("currency_move"),
      v.literal("yield_curve"),
      v.literal("volatility"),
      v.literal("sentiment"),
      v.literal("regulatory_change"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { signalType, limit }) => {
    const n = limit ?? 20;
    return await ctx.db
      .query("marketSignals")
      .withIndex("by_type_observed", (q) => q.eq("signalType", signalType))
      .order("desc")
      .take(n);
  },
});

// ===========================================================================
// Queries — Supply Chain Graph Traversal
// ===========================================================================

/**
 * Trace an entity's full supply chain graph:
 *   entity → exposure edges → geo entities → infrastructure assets → geo relationships
 *
 * Returns the connected subgraph for a single entity.
 */
export const getSupplyChainMap = query({
  args: { entityKey: v.string() },
  handler: async (ctx, { entityKey }) => {
    // Step 1: Get all exposure edges for this entity
    const exposures = await ctx.db
      .query("entityExposureEdges")
      .withIndex("by_entity", (q) => q.eq("entityKey", entityKey))
      .collect();

    // Step 2: Resolve unique geoKeys and assetKeys from exposures
    const geoKeysSet = new Set<string>();
    const assetKeysSet = new Set<string>();
    for (const edge of exposures) {
      if (edge.geoKey) geoKeysSet.add(edge.geoKey);
      if (edge.assetKey) assetKeysSet.add(edge.assetKey);
    }

    // Step 3: Fetch geo entities
    const geoEntities = await Promise.all(
      [...geoKeysSet].map((geoKey) =>
        ctx.db
          .query("geoEntities")
          .withIndex("by_geo_key", (q) => q.eq("geoKey", geoKey))
          .first(),
      ),
    );
    const resolvedGeos = geoEntities.filter(Boolean);

    // Step 4: Fetch infrastructure assets — from exposure edges + from geo locations
    const assetsByKey = await Promise.all(
      [...assetKeysSet].map((assetKey) =>
        ctx.db
          .query("infrastructureAssets")
          .withIndex("by_asset_key", (q) => q.eq("assetKey", assetKey))
          .first(),
      ),
    );
    const assetsByGeo = await Promise.all(
      [...geoKeysSet].map((geoKey) =>
        ctx.db
          .query("infrastructureAssets")
          .withIndex("by_geo", (q) => q.eq("geoKey", geoKey))
          .collect(),
      ),
    );

    // Deduplicate infrastructure assets by assetKey
    const infraMap = new Map<string, (typeof assetsByKey)[number]>();
    for (const asset of assetsByKey) {
      if (asset) infraMap.set(asset.assetKey, asset);
    }
    for (const geoAssets of assetsByGeo) {
      for (const asset of geoAssets) {
        if (!infraMap.has(asset.assetKey)) {
          infraMap.set(asset.assetKey, asset);
        }
      }
    }
    const infrastructure = [...infraMap.values()];

    // Step 5: Fetch geo relationships originating from any involved geoKey
    const relationships = (
      await Promise.all(
        [...geoKeysSet].map((geoKey) =>
          ctx.db
            .query("geoRelationships")
            .withIndex("by_from_type", (q) => q.eq("fromGeoKey", geoKey))
            .collect(),
        ),
      )
    ).flat();

    return {
      entityKey,
      exposures,
      geoEntities: resolvedGeos,
      infrastructure,
      relationships,
    };
  },
});

// ===========================================================================
// Mutations — Geo Entities
// ===========================================================================

/** Create or update a geo entity by geoKey (idempotent). */
export const upsertGeoEntity = mutation({
  args: {
    geoKey: v.string(),
    name: v.string(),
    geoType: v.union(
      v.literal("country"),
      v.literal("region"),
      v.literal("city"),
      v.literal("port"),
      v.literal("route"),
      v.literal("cable"),
      v.literal("power_asset"),
      v.literal("conflict_zone"),
      v.literal("economic_zone"),
    ),
    parentGeoKey: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    riskLevel: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("elevated"),
        v.literal("high"),
        v.literal("critical"),
      ),
    ),
    description: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("geoEntities")
      .withIndex("by_geo_key", (q) => q.eq("geoKey", args.geoKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("geoEntities", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ===========================================================================
// Mutations — Geo Relationships
// ===========================================================================

/** Create or update a relationship between two geo entities. */
export const upsertGeoRelationship = mutation({
  args: {
    fromGeoKey: v.string(),
    toGeoKey: v.string(),
    relationshipType: v.union(
      v.literal("located_in"),
      v.literal("ships_through"),
      v.literal("depends_on"),
      v.literal("disrupted_by"),
      v.literal("connects_to"),
      v.literal("borders"),
      v.literal("supplies_power"),
      v.literal("supplies_data"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("disrupted"),
      v.literal("severed"),
      v.literal("historical"),
    ),
    capacityDescription: v.optional(v.string()),
    criticality: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("critical"),
      ),
    ),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Match on fromGeoKey + relationshipType, then filter toGeoKey
    const existing = await ctx.db
      .query("geoRelationships")
      .withIndex("by_from_type", (q) =>
        q.eq("fromGeoKey", args.fromGeoKey).eq("relationshipType", args.relationshipType),
      )
      .filter((q) => q.eq(q.field("toGeoKey"), args.toGeoKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("geoRelationships", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ===========================================================================
// Mutations — Infrastructure Assets
// ===========================================================================

/** Create or update an infrastructure asset by assetKey (idempotent). */
export const upsertInfrastructureAsset = mutation({
  args: {
    assetKey: v.string(),
    name: v.string(),
    assetType: v.union(
      v.literal("port"),
      v.literal("airport"),
      v.literal("pipeline"),
      v.literal("subsea_cable"),
      v.literal("power_plant"),
      v.literal("data_center"),
      v.literal("rail_hub"),
      v.literal("highway"),
      v.literal("refinery"),
      v.literal("warehouse"),
      v.literal("other"),
    ),
    geoKey: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    ownerEntityKey: v.optional(v.string()),
    operatorEntityKey: v.optional(v.string()),
    capacityDescription: v.optional(v.string()),
    status: v.union(
      v.literal("operational"),
      v.literal("degraded"),
      v.literal("offline"),
      v.literal("under_construction"),
      v.literal("decommissioned"),
    ),
    riskFactors: v.optional(v.array(v.string())),
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
      .query("infrastructureAssets")
      .withIndex("by_asset_key", (q) => q.eq("assetKey", args.assetKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("infrastructureAssets", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update just the status of an infrastructure asset. */
export const updateInfraStatus = mutation({
  args: {
    assetKey: v.string(),
    status: v.union(
      v.literal("operational"),
      v.literal("degraded"),
      v.literal("offline"),
      v.literal("under_construction"),
      v.literal("decommissioned"),
    ),
  },
  handler: async (ctx, { assetKey, status }) => {
    const existing = await ctx.db
      .query("infrastructureAssets")
      .withIndex("by_asset_key", (q) => q.eq("assetKey", assetKey))
      .first();

    if (!existing) {
      throw new Error(`Infrastructure asset not found: ${assetKey}`);
    }
    await ctx.db.patch(existing._id, { status, updatedAt: Date.now() });
    return existing._id;
  },
});

// ===========================================================================
// Mutations — Country Risk Snapshots
// ===========================================================================

/** Record a new country risk snapshot with snapshotHash deduplication. */
export const recordCountryRiskSnapshot = mutation({
  args: {
    countryCode: v.string(),
    asOfDate: v.string(),
    overallRisk: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("elevated"),
      v.literal("high"),
      v.literal("critical"),
    ),
    riskDimensions: v.object({
      political: v.optional(v.number()),
      economic: v.optional(v.number()),
      security: v.optional(v.number()),
      regulatory: v.optional(v.number()),
      infrastructure: v.optional(v.number()),
      natural_disaster: v.optional(v.number()),
    }),
    activeEvents: v.optional(v.array(v.string())),
    narrative: v.optional(v.string()),
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
    // Dedup: check if this exact snapshot already exists
    const existing = await ctx.db
      .query("countryRiskSnapshots")
      .withIndex("by_country_date", (q) =>
        q.eq("countryCode", args.countryCode).eq("asOfDate", args.asOfDate),
      )
      .filter((q) => q.eq(q.field("snapshotHash"), args.snapshotHash))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("countryRiskSnapshots", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Mutations — Entity Exposure Edges
// ===========================================================================

/** Create or update an entity exposure edge (idempotent on entityKey + geoKey + assetKey + exposureType). */
export const upsertEntityExposure = mutation({
  args: {
    entityKey: v.string(),
    geoKey: v.optional(v.string()),
    assetKey: v.optional(v.string()),
    exposureType: v.union(
      v.literal("headquartered"),
      v.literal("operates_in"),
      v.literal("supplies_from"),
      v.literal("sells_to"),
      v.literal("ships_through"),
      v.literal("depends_on_infra"),
      v.literal("exposed_to_risk"),
      v.literal("has_workforce"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    revenueExposurePct: v.optional(v.number()),
    description: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Match on entityKey + exposureType, then filter by geoKey and assetKey
    const candidates = await ctx.db
      .query("entityExposureEdges")
      .withIndex("by_entity", (q) =>
        q.eq("entityKey", args.entityKey).eq("exposureType", args.exposureType),
      )
      .collect();

    const existing = candidates.find(
      (e) =>
        (e.geoKey ?? null) === (args.geoKey ?? null) &&
        (e.assetKey ?? null) === (args.assetKey ?? null),
    );

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("entityExposureEdges", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ===========================================================================
// Mutations — Market Signals
// ===========================================================================

/** Record a new market signal (upsert by signalKey). */
export const recordMarketSignal = mutation({
  args: {
    signalKey: v.string(),
    signalType: v.union(
      v.literal("macro_indicator"),
      v.literal("sector_trend"),
      v.literal("commodity_price"),
      v.literal("currency_move"),
      v.literal("yield_curve"),
      v.literal("volatility"),
      v.literal("sentiment"),
      v.literal("regulatory_change"),
    ),
    name: v.string(),
    value: v.number(),
    unit: v.optional(v.string()),
    direction: v.union(
      v.literal("up"),
      v.literal("down"),
      v.literal("flat"),
      v.literal("volatile"),
    ),
    magnitude: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("significant"),
      v.literal("extreme"),
    ),
    countryCode: v.optional(v.string()),
    sector: v.optional(v.string()),
    impactedEntityKeys: v.optional(v.array(v.string())),
    narrative: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("marketSignals")
      .withIndex("by_signal_key", (q) => q.eq("signalKey", args.signalKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, createdAt: existing.createdAt });
      return existing._id;
    }
    return await ctx.db.insert("marketSignals", {
      ...args,
      createdAt: now,
    });
  },
});
