/**
 * Memory-First Evaluation Scenarios
 *
 * These scenarios test the memory-first protocol where agents should:
 * 1. Call queryMemory BEFORE external API calls
 * 2. Use cached memory when fresh and high-quality
 * 3. Trigger enrichment when memory is stale or poor quality
 */

import { v } from "convex/values";

// ============================================================================
// TYPES
// ============================================================================

export interface MemoryInjection {
  entityName: string;
  entityType?: "company" | "person" | "oss_project";
  facts: string[];
  ageInDays: number;
  qualityTier: "excellent" | "good" | "fair" | "poor";
  isStale?: boolean;
  sources?: Array<{ type: "primary" | "secondary" | "tertiary"; name: string }>;
  missingFields?: string[];
}

export interface ScenarioValidation {
  mustCallTools?: string[];
  mustCallBefore?: Record<string, string[]>;
  mustNotCallFirst?: string[];
  mustNotCall?: string[];
  mustUseMemoryFacts?: boolean;
  toolOrdering?: string[];
  outputMustContain?: string[];
  personaGateMustFail?: string;
  personaGateMustPass?: string;
}

export interface MemoryFirstScenario {
  id: string;
  name: string;
  category: "memory-first" | "staleness" | "quality-tier";
  query: string;
  setup?: {
    injectMemory?: MemoryInjection;
    injectStaleMemory?: MemoryInjection;
  };
  expectedPersona?: string;
  expectedEntityId?: string;
  expectedOutcome?: "PASS" | "FAIL";
  validation: ScenarioValidation;
}

// ============================================================================
// AMBIGUOUS QUERY SCENARIOS
// ============================================================================

export const AMBIGUOUS_QUERY_SCENARIOS: MemoryFirstScenario[] = [
  {
    id: "memory_ambiguous_disco",
    name: "Memory: Ambiguous DISCO query",
    category: "memory-first",
    query: "What do we know about DISCO?",
    validation: {
      mustCallTools: ["queryMemory"],
      mustCallBefore: { queryMemory: ["lookupGroundTruthEntity", "getBankerGradeEntityInsights"] },
      mustNotCallFirst: ["lookupGroundTruthEntity"],
    },
  },
  {
    id: "memory_recall_tesla",
    name: "Memory: Recall previous Tesla research",
    category: "memory-first",
    query: "Remind me about Tesla's latest numbers",
    setup: {
      injectMemory: {
        entityName: "Tesla",
        entityType: "company",
        facts: ["CEO: Elon Musk", "Q3 2025 deliveries: 435K", "Market cap: $800B"],
        ageInDays: 5,
        qualityTier: "good",
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      mustUseMemoryFacts: true,
      mustNotCall: ["linkupSearch", "delegateToEntityResearchAgent"],
    },
  },
  {
    id: "memory_what_we_discussed",
    name: "Memory: Reference previous discussion",
    category: "memory-first",
    query: "What did we find out about Ambros earlier?",
    setup: {
      injectMemory: {
        entityName: "Ambros",
        entityType: "company",
        facts: ["CEO: Dr. Sarah Chen", "HQ: Irvine", "Series A: $125M", "Platform: ADC"],
        ageInDays: 2,
        qualityTier: "excellent",
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      mustUseMemoryFacts: true,
      outputMustContain: ["Ambros", "Sarah Chen", "Irvine"],
    },
  },
  {
    id: "memory_context_query",
    name: "Memory: Context-dependent query",
    category: "memory-first",
    query: "How does their funding compare to competitors?",
    setup: {
      injectMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: ["Seed: €36M", "Lead investor: RA Capital", "Platform: Disc-Seq"],
        ageInDays: 10,
        qualityTier: "good",
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      outputMustContain: ["€36M"],
    },
  },
  {
    id: "memory_no_entity_hint",
    name: "Memory: Query without explicit entity name",
    category: "memory-first",
    query: "Tell me more about that biotech we looked at yesterday",
    setup: {
      injectMemory: {
        entityName: "GenomiQ",
        entityType: "company",
        facts: ["HQ: Boston", "Series B: $80M", "Focus: Cancer genomics"],
        ageInDays: 1,
        qualityTier: "good",
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      mustUseMemoryFacts: true,
    },
  },
];

// ============================================================================
// STALENESS SCENARIOS
// ============================================================================

export const STALENESS_SCENARIOS: MemoryFirstScenario[] = [
  {
    id: "stale_banker_disco",
    name: "Staleness: DISCO fails banker window (>30 days)",
    category: "staleness",
    query: "Is DISCO ready for banker outreach this week?",
    setup: {
      injectStaleMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: ["Seed: €36M", "CEO: Fabian Niehaus"],
        ageInDays: 45,
        qualityTier: "fair",
        isStale: true,
      },
    },
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    validation: {
      outputMustContain: ["stale", "outdated", "refresh"],
      personaGateMustFail: "JPM_STARTUP_BANKER",
    },
  },
  {
    id: "stale_vc_acceptable",
    name: "Staleness: 45-day memory OK for VC (<60 days)",
    category: "staleness",
    query: "What's DISCO's thesis fit for our fund?",
    setup: {
      injectStaleMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: ["Seed: €36M", "Platform: Disc-Seq", "Focus: Drug discovery"],
        ageInDays: 45,
        qualityTier: "good",
        isStale: false,
      },
    },
    expectedPersona: "EARLY_STAGE_VC",
    expectedOutcome: "PASS",
    validation: {
      personaGateMustPass: "EARLY_STAGE_VC",
      outputMustContain: ["thesis", "DISCO"],
    },
  },
  {
    id: "stale_quant_fails",
    name: "Staleness: Quant analyst fails at 65 days (>60 days)",
    category: "staleness",
    query: "What signals should I track for VaultPay?",
    setup: {
      injectStaleMemory: {
        entityName: "VaultPay",
        entityType: "company",
        facts: ["Series A: $45M", "HQ: London"],
        ageInDays: 65,
        qualityTier: "fair",
        isStale: true,
      },
    },
    expectedPersona: "QUANT_ANALYST",
    expectedOutcome: "FAIL",
    validation: {
      personaGateMustFail: "QUANT_ANALYST",
    },
  },
  {
    id: "stale_triggers_refresh",
    name: "Staleness: Stale memory triggers enrichment",
    category: "staleness",
    query: "Get me the latest on NeuralForge",
    setup: {
      injectStaleMemory: {
        entityName: "NeuralForge",
        entityType: "company",
        facts: ["Seed: $12M"],
        ageInDays: 40,
        qualityTier: "poor",
        isStale: true,
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "getBankerGradeEntityInsights"],
      toolOrdering: ["queryMemory", "getBankerGradeEntityInsights"],
    },
  },
  {
    id: "stale_fresh_skips_enrichment",
    name: "Staleness: Fresh memory skips enrichment",
    category: "staleness",
    query: "Quick update on Tesla",
    setup: {
      injectMemory: {
        entityName: "Tesla",
        entityType: "company",
        facts: ["CEO: Elon Musk", "Q4 earnings beat", "New factory in Mexico"],
        ageInDays: 3,
        qualityTier: "excellent",
        isStale: false,
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      mustNotCall: ["getBankerGradeEntityInsights", "enrichCompanyDossier", "linkupSearch"],
    },
  },
  {
    id: "stale_academic_needs_primary",
    name: "Staleness: Academic persona needs primary source",
    category: "staleness",
    query: "Show me the research on RyR2 calcium signaling",
    setup: {
      injectMemory: {
        entityName: "RyR2",
        entityType: "oss_project",
        facts: ["Calcium channel research", "Alzheimer's connection"],
        ageInDays: 20,
        qualityTier: "fair",
        sources: [{ type: "secondary", name: "News article" }],
      },
    },
    expectedPersona: "ACADEMIC_RD",
    expectedOutcome: "FAIL",
    validation: {
      personaGateMustFail: "ACADEMIC_RD",
    },
  },
  {
    id: "stale_academic_passes_with_primary",
    name: "Staleness: Academic passes with primary source",
    category: "staleness",
    query: "What does the literature say about QuickJS security?",
    setup: {
      injectMemory: {
        entityName: "QuickJS",
        entityType: "oss_project",
        facts: ["CVE-2025-62495", "High severity", "Heap buffer overflow"],
        ageInDays: 15,
        qualityTier: "excellent",
        sources: [
          { type: "primary", name: "CVE Database" },
          { type: "primary", name: "GitHub Advisory" },
        ],
      },
    },
    expectedPersona: "ACADEMIC_RD",
    expectedOutcome: "PASS",
    validation: {
      personaGateMustPass: "ACADEMIC_RD",
    },
  },
  {
    id: "stale_cto_passes_recent",
    name: "Staleness: CTO passes with recent CVE data",
    category: "staleness",
    query: "What's the security exposure for QuickJS?",
    setup: {
      injectMemory: {
        entityName: "QuickJS",
        entityType: "oss_project",
        facts: ["CVE-2025-62495", "High severity", "Patch available in v2025.12.20"],
        ageInDays: 7,
        qualityTier: "excellent",
      },
    },
    expectedPersona: "CTO_TECH_LEAD",
    expectedOutcome: "PASS",
    validation: {
      personaGateMustPass: "CTO_TECH_LEAD",
      outputMustContain: ["CVE", "patch"],
    },
  },
];

// ============================================================================
// QUALITY TIER SCENARIOS
// ============================================================================

export const QUALITY_TIER_SCENARIOS: MemoryFirstScenario[] = [
  {
    id: "quality_excellent_skip_enrichment",
    name: "Quality: Excellent tier skips re-enrichment",
    category: "quality-tier",
    query: "Tell me about DISCO for my weekly target list",
    setup: {
      injectMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: [
          "CEO: Fabian Niehaus",
          "HQ: Cologne, Germany",
          "Seed: €36M",
          "Lead investor: RA Capital",
          "Platform: Disc-Seq",
          "Focus: Drug discovery",
          "Founded: 2023",
          "Employees: 50+",
          "Primary contact: press@disco-pharma.com",
          "Recent news: Partnership with Roche announced",
        ],
        ageInDays: 5,
        qualityTier: "excellent",
        sources: [
          { type: "primary", name: "Company website" },
          { type: "primary", name: "Press release" },
          { type: "secondary", name: "TechCrunch article" },
        ],
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      mustNotCall: ["getBankerGradeEntityInsights", "enrichCompanyDossier"],
    },
  },
  {
    id: "quality_poor_triggers_enrichment",
    name: "Quality: Poor tier triggers full enrichment",
    category: "quality-tier",
    query: "Research DISCO for investment thesis",
    setup: {
      injectMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: ["Name: DISCO Pharmaceuticals"],
        ageInDays: 10,
        qualityTier: "poor",
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "getBankerGradeEntityInsights"],
      toolOrdering: ["queryMemory", "getBankerGradeEntityInsights", "updateMemoryFromReview"],
    },
  },
  {
    id: "quality_fair_context_dependent",
    name: "Quality: Fair tier depends on persona needs",
    category: "quality-tier",
    query: "Quick overview of VaultPay",
    setup: {
      injectMemory: {
        entityName: "VaultPay",
        entityType: "company",
        facts: ["HQ: London", "Series A: $45M", "Focus: Payments"],
        ageInDays: 15,
        qualityTier: "fair",
      },
    },
    validation: {
      mustCallTools: ["queryMemory"],
      // Fair quality is sufficient for casual queries
    },
  },
  {
    id: "quality_good_banker_needs_more",
    name: "Quality: Good tier insufficient for banker (needs contact)",
    category: "quality-tier",
    query: "Get me VaultPay's contact for outreach",
    setup: {
      injectMemory: {
        entityName: "VaultPay",
        entityType: "company",
        facts: ["HQ: London", "Series A: $45M", "CEO: James Wilson"],
        ageInDays: 10,
        qualityTier: "good",
        missingFields: ["primaryContact", "email"],
      },
    },
    expectedPersona: "JPM_STARTUP_BANKER",
    validation: {
      mustCallTools: ["queryMemory", "enrichCompanyDossier"],
      outputMustContain: ["contact"],
    },
  },
  {
    id: "quality_excellent_has_all_fields",
    name: "Quality: Excellent tier has all required fields",
    category: "quality-tier",
    query: "Ready to reach out to GenomiQ?",
    setup: {
      injectMemory: {
        entityName: "GenomiQ",
        entityType: "company",
        facts: [
          "CEO: Dr. Emily Park",
          "HQ: Boston",
          "Series B: $80M",
          "Primary contact: emily.park@genomiq.com",
          "Recent funding: December 2025",
        ],
        ageInDays: 5,
        qualityTier: "excellent",
      },
    },
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    validation: {
      mustCallTools: ["queryMemory"],
      mustNotCall: ["enrichCompanyDossier"],
      personaGateMustPass: "JPM_STARTUP_BANKER",
    },
  },
  {
    id: "quality_schema_density_product_designer",
    name: "Quality: Product designer needs schema density",
    category: "quality-tier",
    query: "Generate a UI card schema for DISCO",
    setup: {
      injectMemory: {
        entityName: "DISCO",
        entityType: "company",
        facts: ["Name: DISCO", "Location: Cologne"],
        ageInDays: 5,
        qualityTier: "poor",
      },
    },
    expectedPersona: "PRODUCT_DESIGNER",
    validation: {
      mustCallTools: ["queryMemory", "getBankerGradeEntityInsights"],
      outputMustContain: ["schema", "title", "location"],
    },
  },
];

// ============================================================================
// ALL MEMORY-FIRST SCENARIOS
// ============================================================================

export const ALL_MEMORY_FIRST_SCENARIOS: MemoryFirstScenario[] = [
  ...AMBIGUOUS_QUERY_SCENARIOS,
  ...STALENESS_SCENARIOS,
  ...QUALITY_TIER_SCENARIOS,
];

// ============================================================================
// SCENARIO VALIDATOR SCHEMA
// ============================================================================

export const memoryFirstScenarioValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(v.literal("memory-first"), v.literal("staleness"), v.literal("quality-tier")),
  query: v.string(),
  setup: v.optional(
    v.object({
      injectMemory: v.optional(
        v.object({
          entityName: v.string(),
          entityType: v.optional(v.union(v.literal("company"), v.literal("person"), v.literal("oss_project"))),
          facts: v.array(v.string()),
          ageInDays: v.number(),
          qualityTier: v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor")),
          isStale: v.optional(v.boolean()),
          sources: v.optional(
            v.array(
              v.object({
                type: v.union(v.literal("primary"), v.literal("secondary"), v.literal("tertiary")),
                name: v.string(),
              })
            )
          ),
          missingFields: v.optional(v.array(v.string())),
        })
      ),
      injectStaleMemory: v.optional(
        v.object({
          entityName: v.string(),
          entityType: v.optional(v.union(v.literal("company"), v.literal("person"), v.literal("oss_project"))),
          facts: v.array(v.string()),
          ageInDays: v.number(),
          qualityTier: v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor")),
          isStale: v.optional(v.boolean()),
          sources: v.optional(
            v.array(
              v.object({
                type: v.union(v.literal("primary"), v.literal("secondary"), v.literal("tertiary")),
                name: v.string(),
              })
            )
          ),
          missingFields: v.optional(v.array(v.string())),
        })
      ),
    })
  ),
  expectedPersona: v.optional(v.string()),
  expectedEntityId: v.optional(v.string()),
  expectedOutcome: v.optional(v.union(v.literal("PASS"), v.literal("FAIL"))),
  validation: v.object({
    mustCallTools: v.optional(v.array(v.string())),
    mustCallBefore: v.optional(v.any()),
    mustNotCallFirst: v.optional(v.array(v.string())),
    mustNotCall: v.optional(v.array(v.string())),
    mustUseMemoryFacts: v.optional(v.boolean()),
    toolOrdering: v.optional(v.array(v.string())),
    outputMustContain: v.optional(v.array(v.string())),
    personaGateMustFail: v.optional(v.string()),
    personaGateMustPass: v.optional(v.string()),
  }),
});
