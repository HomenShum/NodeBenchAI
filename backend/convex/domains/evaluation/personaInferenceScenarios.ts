/**
 * Persona Inference & Self-Repair Evaluation Scenarios
 *
 * These scenarios test:
 * 1. Persona inference from keywords (no hardcoded expectedPersona)
 * 2. Self-repair loops when data is missing
 * 3. Persona-specific output formatting
 */

import { v } from "convex/values";

// ============================================================================
// TYPES
// ============================================================================

export interface PersonaInferenceValidation {
  inferredPersonaMustBe?: string;
  inferredPersonaMustBeOneOf?: string[];
  outputMustMatch?: RegExp | string;
  outputMustContain?: string[];
  mustCallTools?: string[];
  mustNotCall?: string[];
  personaPackagingMustInclude?: string[];
}

export interface PersonaInferenceScenario {
  id: string;
  name: string;
  category: "persona-inference" | "self-repair";
  query: string;
  // NO expectedPersona - agent must infer
  setup?: {
    injectMemory?: {
      entity: string;
      facts: string[];
      missingFields?: string[];
      qualityTier?: "excellent" | "good" | "fair" | "poor";
    };
  };
  validation: PersonaInferenceValidation;
}

// ============================================================================
// PERSONA INFERENCE SCENARIOS
// ============================================================================

export const PERSONA_KEYWORD_INFERENCE_SCENARIOS: PersonaInferenceScenario[] = [
  {
    id: "infer_vc_from_keywords",
    name: "Persona Inference: VC from thesis keywords",
    category: "persona-inference",
    query: "What's DISCO's wedge and thesis fit? How does it compare to comps?",
    validation: {
      inferredPersonaMustBe: "EARLY_STAGE_VC",
      outputMustMatch: /Thesis|Why it matters|Competitive map/,
      personaPackagingMustInclude: ["Thesis", "Competitive", "What would change my mind"],
    },
  },
  {
    id: "infer_cto_from_security",
    name: "Persona Inference: CTO from CVE keywords",
    category: "persona-inference",
    query: "What's the security exposure for QuickJS? Any patches available?",
    validation: {
      inferredPersonaMustBe: "CTO_TECH_LEAD",
      outputMustMatch: /Exposure|Impact|Mitigation|Patch/,
      personaPackagingMustInclude: ["Exposure", "Impact", "Mitigation", "Patch"],
    },
  },
  {
    id: "infer_quant_from_metrics",
    name: "Persona Inference: Quant from signal keywords",
    category: "persona-inference",
    query: "What metrics should I track for DISCO? Any signals worth monitoring?",
    validation: {
      inferredPersonaMustBe: "QUANT_ANALYST",
      outputMustMatch: /Signal|Variables|Track|Data gaps/,
      personaPackagingMustInclude: ["Signal", "Variables", "Track"],
    },
  },
  {
    id: "infer_product_from_schema",
    name: "Persona Inference: Product designer from UI keywords",
    category: "persona-inference",
    query: "Generate a UI-ready card schema for DISCO with title, location, and keyPeople fields",
    validation: {
      inferredPersonaMustBe: "PRODUCT_DESIGNER",
      outputMustMatch: /schema|UI|card|fields/i,
      personaPackagingMustInclude: ["schema", "fields"],
    },
  },
  {
    id: "infer_sales_from_share",
    name: "Persona Inference: Sales engineer from share-ready keywords",
    category: "persona-inference",
    query: "Create a share-ready one-screen summary of VaultPay with objection handling",
    validation: {
      inferredPersonaMustBe: "SALES_ENGINEER",
      outputMustMatch: /summary|objection|CTA/i,
      personaPackagingMustInclude: ["Summary", "Objection"],
    },
  },
  {
    id: "infer_ecosystem_from_partnerships",
    name: "Persona Inference: Ecosystem partner from partnership keywords",
    category: "persona-inference",
    query: "What are the second-order effects of Salesforce's Agentforce? Who benefits?",
    validation: {
      inferredPersonaMustBe: "ECOSYSTEM_PARTNER",
      outputMustMatch: /second-order|ecosystem|beneficiaries|partners/i,
      personaPackagingMustInclude: ["Second-order effects", "Beneficiaries"],
    },
  },
  {
    id: "infer_founder_from_strategy",
    name: "Persona Inference: Founder from strategy keywords",
    category: "persona-inference",
    query: "What's DISCO's positioning strategy? How should they pivot their moat?",
    validation: {
      inferredPersonaMustBe: "FOUNDER_STRATEGY",
      outputMustMatch: /positioning|strategy|pivot|moat/i,
      personaPackagingMustInclude: ["Positioning", "Strategic implications"],
    },
  },
  {
    id: "infer_enterprise_from_pricing",
    name: "Persona Inference: Enterprise exec from procurement keywords",
    category: "persona-inference",
    query: "What's the pricing for Gemini 3? What are the P&L implications for our procurement?",
    validation: {
      inferredPersonaMustBe: "ENTERPRISE_EXEC",
      outputMustMatch: /pricing|cost|procurement|P&L/i,
      personaPackagingMustInclude: ["Cost", "Procurement"],
    },
  },
  {
    id: "infer_academic_from_literature",
    name: "Persona Inference: Academic from methodology keywords",
    category: "persona-inference",
    query: "Show me the papers on RyR2 calcium signaling. What's the methodology quality?",
    validation: {
      inferredPersonaMustBe: "ACADEMIC_RD",
      outputMustMatch: /papers|methodology|literature|citations/i,
      personaPackagingMustInclude: ["Key findings", "Methodology"],
    },
  },
  {
    id: "infer_banker_from_outreach",
    name: "Persona Inference: Banker from pipeline keywords",
    category: "persona-inference",
    query: "Add DISCO to my outreach pipeline for this week. What's their contact?",
    validation: {
      inferredPersonaMustBe: "JPM_STARTUP_BANKER",
      outputMustMatch: /outreach|pipeline|contact|target/i,
      personaPackagingMustInclude: ["Verdict", "Outreach angles", "Contact"],
    },
  },
];

// ============================================================================
// AMBIGUOUS PERSONA SCENARIOS (Multiple valid interpretations)
// ============================================================================

export const AMBIGUOUS_PERSONA_SCENARIOS: PersonaInferenceScenario[] = [
  {
    id: "ambiguous_funding_analysis",
    name: "Persona Inference: Funding analysis (VC or Banker)",
    category: "persona-inference",
    query: "Analyze DISCO's €36M seed round",
    validation: {
      inferredPersonaMustBeOneOf: ["EARLY_STAGE_VC", "JPM_STARTUP_BANKER", "QUANT_ANALYST"],
      outputMustContain: ["€36M"],
    },
  },
  {
    id: "ambiguous_just_entity",
    name: "Persona Inference: Just entity name (defaults reasonably)",
    category: "persona-inference",
    query: "DISCO",
    validation: {
      // Ultra-vague should default to JPM_STARTUP_BANKER per instructions
      inferredPersonaMustBe: "JPM_STARTUP_BANKER",
      outputMustContain: ["DISCO"],
    },
  },
  {
    id: "ambiguous_mixed_signals",
    name: "Persona Inference: Mixed signals (thesis + contact)",
    category: "persona-inference",
    query: "What's DISCO's thesis fit and can you get their contact?",
    validation: {
      // "thesis fit" → VC, "contact" → Banker
      // Should pick one and proceed
      inferredPersonaMustBeOneOf: ["EARLY_STAGE_VC", "JPM_STARTUP_BANKER"],
      outputMustContain: ["DISCO"],
    },
  },
];

// ============================================================================
// SELF-REPAIR SCENARIOS
// ============================================================================

export const SELF_REPAIR_SCENARIOS: PersonaInferenceScenario[] = [
  {
    id: "self_repair_missing_contact",
    name: "Self-Repair: Missing contact triggers enrichment",
    category: "self-repair",
    query: "Get me DISCO's contact for outreach",
    setup: {
      injectMemory: {
        entity: "DISCO",
        facts: ["CEO: Fabian Niehaus", "HQ: Cologne"],
        missingFields: ["primaryContact", "email"],
        qualityTier: "fair",
      },
    },
    validation: {
      inferredPersonaMustBe: "JPM_STARTUP_BANKER",
      mustCallTools: ["queryMemory", "enrichCompanyDossier"],
      outputMustContain: ["contact"],
    },
  },
  {
    id: "self_repair_missing_funding",
    name: "Self-Repair: Missing funding triggers enrichment",
    category: "self-repair",
    query: "What's VaultPay's latest funding?",
    setup: {
      injectMemory: {
        entity: "VaultPay",
        facts: ["HQ: London", "CEO: James Wilson"],
        missingFields: ["funding", "lastRound"],
        qualityTier: "fair",
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "getBankerGradeEntityInsights"],
      outputMustContain: ["funding"],
    },
  },
  {
    id: "self_repair_missing_competitors",
    name: "Self-Repair: Missing competitors triggers search",
    category: "self-repair",
    query: "Who are DISCO's main competitors?",
    setup: {
      injectMemory: {
        entity: "DISCO",
        facts: ["Seed: €36M", "Platform: Disc-Seq"],
        missingFields: ["competitors"],
        qualityTier: "good",
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "linkupSearch"],
      outputMustContain: ["competitor"],
    },
  },
  {
    id: "self_repair_stale_news",
    name: "Self-Repair: Stale news triggers refresh",
    category: "self-repair",
    query: "What's the latest news on Tesla?",
    setup: {
      injectMemory: {
        entity: "Tesla",
        facts: ["CEO: Elon Musk", "HQ: Austin", "News: Q2 earnings (6 months ago)"],
        qualityTier: "fair",
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "getLiveFeed"],
      outputMustContain: ["Tesla"],
    },
  },
  {
    id: "self_repair_missing_sec_data",
    name: "Self-Repair: Missing SEC data triggers delegation",
    category: "self-repair",
    query: "Show me Tesla's latest 10-K highlights",
    setup: {
      injectMemory: {
        entity: "Tesla",
        facts: ["CEO: Elon Musk", "Ticker: TSLA"],
        missingFields: ["secFilings", "10K"],
        qualityTier: "fair",
      },
    },
    validation: {
      mustCallTools: ["queryMemory", "delegateToSECAgent"],
      outputMustContain: ["10-K"],
    },
  },
  {
    id: "self_repair_no_repair_needed",
    name: "Self-Repair: Complete data skips repair",
    category: "self-repair",
    query: "Is GenomiQ ready for banker outreach?",
    setup: {
      injectMemory: {
        entity: "GenomiQ",
        facts: [
          "CEO: Dr. Emily Park",
          "HQ: Boston",
          "Series B: $80M",
          "Primary contact: emily.park@genomiq.com",
          "Recent news: Partnership announced (2 days ago)",
        ],
        qualityTier: "excellent",
      },
    },
    validation: {
      inferredPersonaMustBe: "JPM_STARTUP_BANKER",
      mustCallTools: ["queryMemory"],
      mustNotCall: ["enrichCompanyDossier", "getBankerGradeEntityInsights"],
      outputMustContain: ["GenomiQ", "ready"],
    },
  },
];

// ============================================================================
// PERSONA PACKAGING VALIDATION SCENARIOS
// ============================================================================

export const PERSONA_PACKAGING_SCENARIOS: PersonaInferenceScenario[] = [
  {
    id: "packaging_banker_format",
    name: "Packaging: Banker output format validation",
    category: "persona-inference",
    query: "Evaluate DISCO for my weekly target list",
    validation: {
      inferredPersonaMustBe: "JPM_STARTUP_BANKER",
      personaPackagingMustInclude: [
        "Verdict", // PASS/FAIL
        "Funding",
        "Why-now",
        "Outreach angles",
        "Contact",
        "Next actions",
      ],
    },
  },
  {
    id: "packaging_vc_format",
    name: "Packaging: VC output format validation",
    category: "persona-inference",
    query: "Write an investment thesis for DISCO",
    validation: {
      inferredPersonaMustBe: "EARLY_STAGE_VC",
      personaPackagingMustInclude: [
        "Thesis",
        "Why it matters",
        "Competitive map",
        "What would change my mind",
        "Risks",
      ],
    },
  },
  {
    id: "packaging_cto_format",
    name: "Packaging: CTO output format validation",
    category: "persona-inference",
    query: "Security assessment for QuickJS CVE-2025-62495",
    validation: {
      inferredPersonaMustBe: "CTO_TECH_LEAD",
      personaPackagingMustInclude: [
        "Exposure",
        "Impact",
        "Mitigation",
        "Patch",
        "Verification",
      ],
    },
  },
];

// ============================================================================
// ALL PERSONA INFERENCE SCENARIOS
// ============================================================================

export const ALL_PERSONA_INFERENCE_SCENARIOS: PersonaInferenceScenario[] = [
  ...PERSONA_KEYWORD_INFERENCE_SCENARIOS,
  ...AMBIGUOUS_PERSONA_SCENARIOS,
  ...SELF_REPAIR_SCENARIOS,
  ...PERSONA_PACKAGING_SCENARIOS,
];

// ============================================================================
// SCENARIO VALIDATOR SCHEMA
// ============================================================================

export const personaInferenceScenarioValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(v.literal("persona-inference"), v.literal("self-repair")),
  query: v.string(),
  setup: v.optional(
    v.object({
      injectMemory: v.optional(
        v.object({
          entity: v.string(),
          facts: v.array(v.string()),
          missingFields: v.optional(v.array(v.string())),
          qualityTier: v.optional(
            v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor"))
          ),
        })
      ),
    })
  ),
  validation: v.object({
    inferredPersonaMustBe: v.optional(v.string()),
    inferredPersonaMustBeOneOf: v.optional(v.array(v.string())),
    outputMustMatch: v.optional(v.any()), // RegExp
    outputMustContain: v.optional(v.array(v.string())),
    mustCallTools: v.optional(v.array(v.string())),
    mustNotCall: v.optional(v.array(v.string())),
    personaPackagingMustInclude: v.optional(v.array(v.string())),
  }),
});
