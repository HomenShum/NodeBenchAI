/**
 * Intelligence Graph Schema — Layer E entity/people/investor tables
 *
 * Extends Deep Trace with Bloomberg-style intelligence coverage:
 * entities, aliases, people profiles, investor profiles, fund holdings,
 * ownership snapshots, and stakeholder analysis.
 *
 * These tables support sections 7, 10, and 20.3 of the v2 plan.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Entities — canonical entity records (companies, people, funds, products)
// ---------------------------------------------------------------------------

export const intelligenceEntities = defineTable({
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
  lastResearchedAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_key", ["entityKey"])
  .index("by_type_name", ["entityType", "canonicalName"])
  .index("by_sector", ["sector", "entityType"])
  .index("by_country", ["countryCode", "entityType"]);

// ---------------------------------------------------------------------------
// Entity Aliases — alternative names, tickers, identifiers
// ---------------------------------------------------------------------------

export const entityAliases = defineTable({
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
  createdAt: v.number(),
})
  .index("by_entity", ["entityId"])
  .index("by_entity_key", ["entityKey"])
  .index("by_alias", ["alias"])
  .index("by_alias_type", ["aliasType", "alias"]);

// ---------------------------------------------------------------------------
// People Profiles — executives, board members, key personnel
// ---------------------------------------------------------------------------

export const peopleProfiles = defineTable({
  entityId: v.id("intelligenceEntities"),
  entityKey: v.string(),
  fullName: v.string(),
  currentTitle: v.optional(v.string()),
  currentOrg: v.optional(v.string()),
  currentOrgEntityKey: v.optional(v.string()),
  bio: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  employmentHistory: v.array(v.object({
    orgName: v.string(),
    orgEntityKey: v.optional(v.string()),
    title: v.string(),
    startYear: v.optional(v.number()),
    endYear: v.optional(v.number()),
    isCurrent: v.boolean(),
  })),
  boardRoles: v.array(v.object({
    orgName: v.string(),
    orgEntityKey: v.optional(v.string()),
    role: v.string(),
    startYear: v.optional(v.number()),
    endYear: v.optional(v.number()),
    isCurrent: v.boolean(),
  })),
  educationHistory: v.optional(v.array(v.object({
    institution: v.string(),
    degree: v.optional(v.string()),
    field: v.optional(v.string()),
    year: v.optional(v.number()),
  }))),
  notableExits: v.optional(v.array(v.object({
    company: v.string(),
    exitType: v.string(),
    year: v.optional(v.number()),
    value: v.optional(v.string()),
  }))),
  credibilityScore: v.optional(v.number()),
  sourceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  lastUpdatedAt: v.number(),
  createdAt: v.number(),
})
  .index("by_entity_key", ["entityKey"])
  .index("by_current_org", ["currentOrgEntityKey"])
  .index("by_name", ["fullName"]);

// ---------------------------------------------------------------------------
// Investor Profiles — VCs, PE firms, angels, institutional investors
// ---------------------------------------------------------------------------

export const investorProfiles = defineTable({
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
  sourceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_key", ["entityKey"])
  .index("by_type", ["investorType"]);

// ---------------------------------------------------------------------------
// Fund Holdings — who holds what, at what level
// ---------------------------------------------------------------------------

export const fundHoldings = defineTable({
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
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_holder", ["holderEntityKey", "reportedDate"])
  .index("by_holding", ["holdingEntityKey", "reportedDate"])
  .index("by_type", ["holdingType"]);

// ---------------------------------------------------------------------------
// Ownership Snapshots — point-in-time cap table / holder structure
// ---------------------------------------------------------------------------

export const ownershipSnapshots = defineTable({
  entityKey: v.string(),
  asOfDate: v.string(),
  holders: v.array(v.object({
    holderEntityKey: v.string(),
    holderName: v.string(),
    holdingType: v.string(),
    percentOwnership: v.optional(v.number()),
    valueUsd: v.optional(v.number()),
  })),
  totalKnownOwnership: v.optional(v.number()),
  sourceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  snapshotHash: v.string(),
  createdAt: v.number(),
})
  .index("by_entity_date", ["entityKey", "asOfDate"])
  .index("by_hash", ["snapshotHash"]);

// ---------------------------------------------------------------------------
// Stakeholder Graphs — human logic layer (section 10)
// ---------------------------------------------------------------------------

export const stakeholderGraphs = defineTable({
  missionId: v.optional(v.string()),
  entityKey: v.string(),
  actors: v.array(v.object({
    actorKey: v.string(),
    actorName: v.string(),
    role: v.string(),
    goals: v.array(v.string()),
    fears: v.optional(v.array(v.string())),
    incentives: v.array(v.string()),
    constraints: v.optional(v.array(v.string())),
    visibilityScope: v.optional(v.string()),
  })),
  incentiveInterpretations: v.array(v.object({
    actorKey: v.string(),
    likelyObjective: v.string(),
    likelyBias: v.optional(v.string()),
    pressureSource: v.optional(v.string()),
    localOptimizationRisk: v.optional(v.string()),
    likelyFailureMode: v.optional(v.string()),
    evidenceRefs: v.optional(v.array(v.string())),
    confidence: v.number(),
  })),
  analysisNotes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityKey"])
  .index("by_mission", ["missionId"]);
