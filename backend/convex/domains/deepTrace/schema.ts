import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  deepTraceDimensionSourceRefValidator,
  dimensionAvailabilityValidator,
  dimensionFamilyValidator,
  dimensionStateValidator,
  effectDirectionValidator,
  policyContextValidator,
} from "./dimensionModel";

const sourceRef = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
  publishedAtIso: v.optional(v.string()),
});

export const relationshipObservations = defineTable({
  observationKey: v.string(),
  subjectEntityKey: v.string(),
  subjectEntityId: v.optional(v.id("entityContexts")),
  relatedEntityKey: v.string(),
  relatedEntityId: v.optional(v.id("entityContexts")),
  relatedEntityName: v.string(),
  relatedEntityType: v.optional(v.string()),
  relationshipType: v.string(),
  direction: v.optional(v.union(v.literal("outbound"), v.literal("inbound"), v.literal("bidirectional"))),
  claimText: v.string(),
  summary: v.optional(v.string()),
  status: v.union(
    v.literal("active"),
    v.literal("watch"),
    v.literal("historical"),
    v.literal("disputed"),
  ),
  confidence: v.number(),
  freshness: v.optional(v.number()),
  effectiveAt: v.optional(v.number()),
  observedAt: v.number(),
  sourceRefs: v.optional(v.array(sourceRef)),
  sourceArtifactId: v.optional(v.id("sourceArtifacts")),
  evidencePackId: v.optional(v.id("evidencePacks")),
  linkedChainId: v.optional(v.id("causalChains")),
  metadata: v.optional(v.any()),
  observationHash: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_subject_type_time", ["subjectEntityKey", "relationshipType", "observedAt"])
  .index("by_subject_time", ["subjectEntityKey", "observedAt"])
  .index("by_related_time", ["relatedEntityKey", "observedAt"])
  .index("by_status_time", ["status", "observedAt"])
  .index("by_observation_key", ["observationKey"])
  .index("by_hash", ["observationHash"]);

export const relationshipEdges = defineTable({
  edgeKey: v.string(),
  subjectEntityKey: v.string(),
  subjectEntityId: v.optional(v.id("entityContexts")),
  relatedEntityKey: v.string(),
  relatedEntityId: v.optional(v.id("entityContexts")),
  relatedEntityName: v.string(),
  relatedEntityType: v.optional(v.string()),
  relationshipType: v.string(),
  direction: v.optional(v.union(v.literal("outbound"), v.literal("inbound"), v.literal("bidirectional"))),
  status: v.union(
    v.literal("active"),
    v.literal("watch"),
    v.literal("historical"),
    v.literal("disputed"),
  ),
  confidence: v.number(),
  freshness: v.optional(v.number()),
  summary: v.string(),
  latestObservationId: v.optional(v.id("relationshipObservations")),
  observationCount: v.number(),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  sourceRefs: v.optional(v.array(sourceRef)),
  linkedChainId: v.optional(v.id("causalChains")),
  metadata: v.optional(v.any()),
  updatedAt: v.number(),
})
  .index("by_subject_type", ["subjectEntityKey", "relationshipType"])
  .index("by_subject_status", ["subjectEntityKey", "status"])
  .index("by_related_type", ["relatedEntityKey", "relationshipType"])
  .index("by_last_seen", ["subjectEntityKey", "lastSeenAt"])
  .index("by_edge_key", ["edgeKey"]);

export const worldEvents = defineTable({
  eventKey: v.string(),
  title: v.string(),
  summary: v.string(),
  topic: v.string(),
  severity: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical"),
  ),
  status: v.union(
    v.literal("open"),
    v.literal("watch"),
    v.literal("resolved"),
    v.literal("dismissed"),
  ),
  countryCode: v.optional(v.string()),
  region: v.optional(v.string()),
  placeName: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  happenedAt: v.number(),
  detectedAt: v.number(),
  sourceRefs: v.array(sourceRef),
  primaryEntityKey: v.optional(v.string()),
  linkedEntityKeys: v.optional(v.array(v.string())),
  linkedChainId: v.optional(v.id("causalChains")),
  watchlistKeys: v.optional(v.array(v.string())),
  dedupeHash: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_country_detected", ["countryCode", "detectedAt"])
  .index("by_topic_detected", ["topic", "detectedAt"])
  .index("by_severity_detected", ["severity", "detectedAt"])
  .index("by_status_detected", ["status", "detectedAt"])
  .index("by_primary_entity_detected", ["primaryEntityKey", "detectedAt"])
  .index("by_event_key", ["eventKey"])
  .index("by_dedupe_hash", ["dedupeHash"]);

export const watchlists = defineTable({
  watchlistKey: v.string(),
  title: v.string(),
  scopeType: v.union(
    v.literal("company"),
    v.literal("sector"),
    v.literal("geography"),
    v.literal("theme"),
    v.literal("mixed"),
  ),
  entityKeys: v.optional(v.array(v.string())),
  sectorKeys: v.optional(v.array(v.string())),
  countryCodes: v.optional(v.array(v.string())),
  themeTags: v.optional(v.array(v.string())),
  refreshCadence: v.union(
    v.literal("hourly"),
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("manual"),
  ),
  alertThreshold: v.union(
    v.literal("all"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  lastMissionRunId: v.optional(v.string()),
  lastRefreshedAt: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_updated", ["status", "updatedAt"])
  .index("by_scope_updated", ["scopeType", "updatedAt"])
  .index("by_created_by_updated", ["createdBy", "updatedAt"])
  .index("by_watchlist_key", ["watchlistKey"]);

export const dimensionProfiles = defineTable({
  profileKey: v.string(),
  entityKey: v.string(),
  entityId: v.optional(v.id("entityContexts")),
  entityType: v.string(),
  entityName: v.optional(v.string()),
  dimensionState: dimensionStateValidator,
  regimeLabel: v.string(),
  policyContext: policyContextValidator,
  confidence: v.number(),
  coverageRatio: v.number(),
  summary: v.string(),
  stateHash: v.string(),
  sourceRefs: v.array(deepTraceDimensionSourceRefValidator),
  lastComputedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityKey"])
  .index("by_regime_updated", ["regimeLabel", "updatedAt"])
  .index("by_profile_key", ["profileKey"]);

export const dimensionSnapshots = defineTable({
  snapshotKey: v.string(),
  entityKey: v.string(),
  entityId: v.optional(v.id("entityContexts")),
  entityType: v.string(),
  entityName: v.optional(v.string()),
  asOfDate: v.string(),
  dimensionState: dimensionStateValidator,
  regimeLabel: v.string(),
  policyContext: policyContextValidator,
  stateHash: v.string(),
  triggerEventKey: v.optional(v.string()),
  sourceRefs: v.array(deepTraceDimensionSourceRefValidator),
  createdAt: v.number(),
})
  .index("by_entity_asOfDate", ["entityKey", "asOfDate"])
  .index("by_regime_asOfDate", ["regimeLabel", "asOfDate"])
  .index("by_snapshot_key", ["snapshotKey"]);

export const dimensionEvidence = defineTable({
  evidenceKey: v.string(),
  entityKey: v.string(),
  entityId: v.optional(v.id("entityContexts")),
  entityType: v.string(),
  entityName: v.optional(v.string()),
  dimensionFamily: dimensionFamilyValidator,
  dimensionName: v.string(),
  availability: dimensionAvailabilityValidator,
  rawValue: v.union(v.number(), v.string(), v.null()),
  normalizedScore: v.optional(v.union(v.number(), v.null())),
  rationale: v.string(),
  sourceRefIds: v.array(v.string()),
  sourceRefs: v.array(deepTraceDimensionSourceRefValidator),
  sourceArtifactId: v.optional(v.id("sourceArtifacts")),
  evidencePackId: v.optional(v.id("evidencePacks")),
  linkedChainId: v.optional(v.id("causalChains")),
  effectiveAt: v.optional(v.number()),
  observedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_dimension_time", ["entityKey", "dimensionFamily", "dimensionName", "observedAt"])
  .index("by_dimension_time", ["dimensionFamily", "dimensionName", "observedAt"])
  .index("by_evidence_key", ["evidenceKey"]);

export const dimensionInteractions = defineTable({
  interactionKey: v.string(),
  entityKey: v.string(),
  entityId: v.optional(v.id("entityContexts")),
  entityType: v.string(),
  entityName: v.optional(v.string()),
  dimensions: v.array(v.string()),
  pairKey: v.string(),
  effectDirection: effectDirectionValidator,
  magnitude: v.number(),
  interactionSummary: v.string(),
  sourceRefIds: v.array(v.string()),
  sourceRefs: v.array(deepTraceDimensionSourceRefValidator),
  linkedEvidenceKeys: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_updated", ["entityKey", "updatedAt"])
  .index("by_dimension_pair", ["pairKey", "updatedAt"])
  .index("by_interaction_key", ["interactionKey"]);
