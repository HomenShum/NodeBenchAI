/**
 * World Graph Schema — Layer E world intelligence tables
 *
 * Supports Bloomberg-style global event and infrastructure monitoring.
 * Maps world events → regions → infrastructure → companies → supply chains.
 *
 * Section 8 and 20.4 of the v2 plan.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Geo Entities — countries, regions, cities, ports, routes
// ---------------------------------------------------------------------------

export const geoEntities = defineTable({
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
  riskLevel: v.optional(v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("elevated"),
    v.literal("high"),
    v.literal("critical"),
  )),
  description: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_geo_key", ["geoKey"])
  .index("by_type", ["geoType"])
  .index("by_country", ["countryCode", "geoType"])
  .index("by_parent", ["parentGeoKey"]);

// ---------------------------------------------------------------------------
// Geo Relationships — connections between geo entities
// ---------------------------------------------------------------------------

export const geoRelationships = defineTable({
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
  criticality: v.optional(v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical"),
  )),
  sourceRef: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_from_type", ["fromGeoKey", "relationshipType"])
  .index("by_to_type", ["toGeoKey", "relationshipType"])
  .index("by_status", ["status"]);

// ---------------------------------------------------------------------------
// Infrastructure Assets — ports, cables, pipelines, power plants
// ---------------------------------------------------------------------------

export const infrastructureAssets = defineTable({
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
  sourceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_asset_key", ["assetKey"])
  .index("by_type_status", ["assetType", "status"])
  .index("by_country", ["countryCode", "assetType"])
  .index("by_geo", ["geoKey"]);

// ---------------------------------------------------------------------------
// Country Risk Snapshots — point-in-time risk assessment
// ---------------------------------------------------------------------------

export const countryRiskSnapshots = defineTable({
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
  sourceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  snapshotHash: v.string(),
  createdAt: v.number(),
})
  .index("by_country_date", ["countryCode", "asOfDate"])
  .index("by_risk_date", ["overallRisk", "asOfDate"]);

// ---------------------------------------------------------------------------
// Entity Exposure Edges — company ↔ world graph connections
// ---------------------------------------------------------------------------

export const entityExposureEdges = defineTable({
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
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityKey", "exposureType"])
  .index("by_geo", ["geoKey", "exposureType"])
  .index("by_asset", ["assetKey", "exposureType"])
  .index("by_severity", ["severity"]);

// ---------------------------------------------------------------------------
// Market Signals — macro indicators, sector signals
// ---------------------------------------------------------------------------

export const marketSignals = defineTable({
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
  createdAt: v.number(),
})
  .index("by_signal_key", ["signalKey"])
  .index("by_type_observed", ["signalType", "observedAt"])
  .index("by_country_observed", ["countryCode", "observedAt"])
  .index("by_sector_observed", ["sector", "observedAt"]);
