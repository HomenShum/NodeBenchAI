/**
 * Prompt Enhancer Evaluation Scenarios
 *
 * These scenarios test:
 * 1. Memory context injection
 * 2. Entity extraction and expansion
 * 3. Persona inference from keywords
 * 4. Temporal context extraction
 * 5. Tool suggestion accuracy
 * 6. Multi-modal file context
 */

import { v } from "convex/values";

// ============================================================================
// TYPES
// ============================================================================

export interface EnhancementDiff {
  type: "added" | "context";
  content: string;
  source: string;
}

export interface EnhancementValidation {
  enhancedPromptMustInclude?: string[];
  enhancedPromptMustNotInclude?: string[];
  diffMustContain?: { source: string }[];
  suggestedToolsMustInclude?: string[];
  suggestedToolsMustNotInclude?: string[];
  injectedContextMustHave?: {
    entities?: { name: string }[];
    personaHint?: string;
    temporalRange?: { label: string };
    memory?: { entityName: string; qualityTier?: string }[];
  };
  finalPromptMustInclude?: string[];
}

export interface PromptEnhancerScenario {
  id: string;
  name: string;
  category: "memory-injection" | "entity-extraction" | "persona-inference" | "temporal" | "tool-suggestion" | "file-context" | "user-edit";
  originalPrompt: string;
  setup?: {
    injectMemory?: {
      entity: string;
      qualityTier: "excellent" | "good" | "fair" | "poor";
      facts: string[];
      ageInDays?: number;
    };
    attachedFileIds?: string[];
    dossierContext?: {
      actIndex: number;
      sectionType: string;
    };
    threadId?: string;
  };
  userEdit?: string;
  validation: EnhancementValidation;
}

// ============================================================================
// MEMORY INJECTION SCENARIOS
// ============================================================================

export const MEMORY_INJECTION_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_vague_entity",
    name: "Enhancement: Vague entity query gets memory context",
    category: "memory-injection",
    originalPrompt: "Tell me about DISCO",
    setup: {
      injectMemory: {
        entity: "DISCO",
        qualityTier: "good",
        facts: ["CEO: Fabian Niehaus", "HQ: Cologne", "Seed: €36M"],
      },
    },
    validation: {
      enhancedPromptMustInclude: ["Memory:", "DISCO", "good"],
      diffMustContain: [{ source: "memory:DISCO" }],
      suggestedToolsMustInclude: ["queryMemory"],
    },
  },
  {
    id: "enhance_excellent_memory",
    name: "Enhancement: Excellent tier memory with rich context",
    category: "memory-injection",
    originalPrompt: "What's the latest on GenomiQ?",
    setup: {
      injectMemory: {
        entity: "GenomiQ",
        qualityTier: "excellent",
        facts: [
          "CEO: Dr. Emily Park",
          "HQ: Boston",
          "Series B: $80M",
          "Platform: AI-powered genomics",
          "Employees: 150",
          "Founded: 2021",
        ],
        ageInDays: 3,
      },
    },
    validation: {
      enhancedPromptMustInclude: ["Memory:", "GenomiQ", "excellent", "6 facts"],
      diffMustContain: [{ source: "memory:GenomiQ" }],
      suggestedToolsMustInclude: ["queryMemory"],
      suggestedToolsMustNotInclude: ["getBankerGradeEntityInsights"], // Don't need enrichment
    },
  },
  {
    id: "enhance_stale_memory",
    name: "Enhancement: Stale memory flagged for refresh",
    category: "memory-injection",
    originalPrompt: "Update me on Tesla",
    setup: {
      injectMemory: {
        entity: "Tesla",
        qualityTier: "fair",
        facts: ["CEO: Elon Musk", "HQ: Austin"],
        ageInDays: 45,
      },
    },
    validation: {
      enhancedPromptMustInclude: ["Memory:", "Tesla", "45d old"],
      suggestedToolsMustInclude: ["queryMemory", "getLiveFeed"], // Stale = needs refresh
    },
  },
  {
    id: "enhance_no_memory",
    name: "Enhancement: No memory available",
    category: "memory-injection",
    originalPrompt: "Tell me about UnknownCorp",
    validation: {
      enhancedPromptMustNotInclude: ["Memory:"],
      suggestedToolsMustInclude: ["queryMemory", "getBankerGradeEntityInsights"],
    },
  },
];

// ============================================================================
// ENTITY EXTRACTION SCENARIOS
// ============================================================================

export const ENTITY_EXTRACTION_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_multi_entity",
    name: "Enhancement: Multiple entities detected",
    category: "entity-extraction",
    originalPrompt: "Compare Tesla and Rivian for our portfolio",
    validation: {
      injectedContextMustHave: {
        entities: [{ name: "Tesla" }, { name: "Rivian" }],
      },
      suggestedToolsMustInclude: ["queryMemory"],
    },
  },
  {
    id: "enhance_ground_truth_entity",
    name: "Enhancement: Ground truth entity matched",
    category: "entity-extraction",
    originalPrompt: "What's DISCO's current funding stage?",
    validation: {
      injectedContextMustHave: {
        entities: [{ name: "DISCO" }],
      },
      suggestedToolsMustInclude: ["queryMemory"],
    },
  },
  {
    id: "enhance_multiple_ground_truth",
    name: "Enhancement: Multiple ground truth entities",
    category: "entity-extraction",
    originalPrompt: "Compare VaultPay, GenomiQ, and Ambros funding strategies",
    validation: {
      injectedContextMustHave: {
        entities: [{ name: "VaultPay" }, { name: "GenomiQ" }, { name: "Ambros" }],
      },
      suggestedToolsMustInclude: ["queryMemory"],
    },
  },
  {
    id: "enhance_case_insensitive",
    name: "Enhancement: Case-insensitive entity matching",
    category: "entity-extraction",
    originalPrompt: "what about disco and VAULTPAY?",
    validation: {
      injectedContextMustHave: {
        entities: [{ name: "DISCO" }, { name: "VaultPay" }],
      },
    },
  },
  {
    id: "enhance_inferred_entity",
    name: "Enhancement: Inferred company-like entity",
    category: "entity-extraction",
    originalPrompt: "Research Acme Corp's market position",
    validation: {
      injectedContextMustHave: {
        entities: [{ name: "Acme Corp" }],
      },
    },
  },
];

// ============================================================================
// PERSONA INFERENCE SCENARIOS
// ============================================================================

export const PERSONA_INFERENCE_ENHANCEMENT_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_persona_vc",
    name: "Enhancement: VC persona keywords detected",
    category: "persona-inference",
    originalPrompt: "What's DISCO's thesis fit and market wedge?",
    validation: {
      injectedContextMustHave: { personaHint: "EARLY_STAGE_VC" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_persona_banker",
    name: "Enhancement: Banker persona keywords detected",
    category: "persona-inference",
    originalPrompt: "Add DISCO to my outreach pipeline this week",
    validation: {
      injectedContextMustHave: { personaHint: "JPM_STARTUP_BANKER" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_persona_cto",
    name: "Enhancement: CTO persona keywords detected",
    category: "persona-inference",
    originalPrompt: "What's the security exposure for the QuickJS CVE?",
    validation: {
      injectedContextMustHave: { personaHint: "CTO_TECH_LEAD" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_persona_quant",
    name: "Enhancement: Quant persona keywords detected",
    category: "persona-inference",
    originalPrompt: "What signals should I track for DISCO? Any time-series data?",
    validation: {
      injectedContextMustHave: { personaHint: "QUANT_ANALYST" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_persona_product",
    name: "Enhancement: Product designer persona keywords",
    category: "persona-inference",
    originalPrompt: "Generate a UI card schema for DISCO with json fields",
    validation: {
      injectedContextMustHave: { personaHint: "PRODUCT_DESIGNER" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_persona_sales",
    name: "Enhancement: Sales engineer persona keywords",
    category: "persona-inference",
    originalPrompt: "Create a share-ready one-screen summary with objections",
    validation: {
      injectedContextMustHave: { personaHint: "SALES_ENGINEER" },
      diffMustContain: [{ source: "persona" }],
    },
  },
  {
    id: "enhance_no_persona",
    name: "Enhancement: No persona keywords - neutral",
    category: "persona-inference",
    originalPrompt: "Tell me about Tesla",
    validation: {
      injectedContextMustHave: {},
      enhancedPromptMustNotInclude: ["Persona hint:"],
    },
  },
];

// ============================================================================
// TEMPORAL EXTRACTION SCENARIOS
// ============================================================================

export const TEMPORAL_EXTRACTION_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_temporal_week",
    name: "Enhancement: Temporal - last week",
    category: "temporal",
    originalPrompt: "What happened with Tesla last week?",
    validation: {
      enhancedPromptMustInclude: ["Timeframe:", "last week"],
      diffMustContain: [{ source: "temporal" }],
    },
  },
  {
    id: "enhance_temporal_month",
    name: "Enhancement: Temporal - past month",
    category: "temporal",
    originalPrompt: "DISCO news from the past month",
    validation: {
      enhancedPromptMustInclude: ["Timeframe:", "month"],
      diffMustContain: [{ source: "temporal" }],
    },
  },
  {
    id: "enhance_temporal_quarter",
    name: "Enhancement: Temporal - Q4 2025",
    category: "temporal",
    originalPrompt: "Show me Q4 2025 funding rounds",
    validation: {
      enhancedPromptMustInclude: ["Timeframe:", "Q4 2025"],
      diffMustContain: [{ source: "temporal" }],
    },
  },
  {
    id: "enhance_temporal_specific_date",
    name: "Enhancement: Temporal - specific date range",
    category: "temporal",
    originalPrompt: "News between January 1 and January 7",
    validation: {
      enhancedPromptMustInclude: ["Timeframe:", "January"],
      diffMustContain: [{ source: "temporal" }],
    },
  },
  {
    id: "enhance_no_temporal",
    name: "Enhancement: No temporal context",
    category: "temporal",
    originalPrompt: "What is DISCO's platform technology?",
    validation: {
      enhancedPromptMustNotInclude: ["Timeframe:"],
    },
  },
];

// ============================================================================
// TOOL SUGGESTION SCENARIOS
// ============================================================================

export const TOOL_SUGGESTION_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_tool_research",
    name: "Enhancement: Research intent suggests enrichment tools",
    category: "tool-suggestion",
    originalPrompt: "Do a deep dive on VaultPay's funding history",
    validation: {
      suggestedToolsMustInclude: ["queryMemory", "getBankerGradeEntityInsights", "enrichCompanyDossier"],
    },
  },
  {
    id: "enhance_tool_news",
    name: "Enhancement: News intent suggests search tools",
    category: "tool-suggestion",
    originalPrompt: "What's the latest news about Salesforce?",
    validation: {
      suggestedToolsMustInclude: ["linkupSearch", "getLiveFeed"],
    },
  },
  {
    id: "enhance_tool_sec",
    name: "Enhancement: SEC intent suggests delegation",
    category: "tool-suggestion",
    originalPrompt: "Show me Tesla's 10-K filing highlights",
    validation: {
      suggestedToolsMustInclude: ["delegateToSECAgent"],
    },
  },
  {
    id: "enhance_tool_calendar",
    name: "Enhancement: Calendar intent suggests event tools",
    category: "tool-suggestion",
    originalPrompt: "Schedule a meeting with the VaultPay team",
    validation: {
      suggestedToolsMustInclude: ["createEvent"],
    },
  },
  {
    id: "enhance_tool_dossier",
    name: "Enhancement: Dossier intent suggests enrichment",
    category: "tool-suggestion",
    originalPrompt: "Build a comprehensive dossier on GenomiQ",
    validation: {
      suggestedToolsMustInclude: ["queryMemory", "getBankerGradeEntityInsights", "enrichCompanyDossier"],
    },
  },
  {
    id: "enhance_tool_comparison",
    name: "Enhancement: Comparison intent suggests decomposition",
    category: "tool-suggestion",
    originalPrompt: "Compare Tesla, Rivian, and Lucid market positions",
    validation: {
      suggestedToolsMustInclude: ["queryMemory"],
    },
  },
];

// ============================================================================
// FILE CONTEXT SCENARIOS
// ============================================================================

export const FILE_CONTEXT_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_file_pdf",
    name: "Enhancement: PDF file attached",
    category: "file-context",
    originalPrompt: "Analyze this pitch deck",
    setup: {
      attachedFileIds: ["mock_file_id_123"],
    },
    validation: {
      enhancedPromptMustInclude: ["Attached files:", "1 file(s)"],
      suggestedToolsMustInclude: ["analyzeMediaFile"],
    },
  },
  {
    id: "enhance_file_multiple",
    name: "Enhancement: Multiple files attached",
    category: "file-context",
    originalPrompt: "Compare these two decks",
    setup: {
      attachedFileIds: ["file_1", "file_2"],
    },
    validation: {
      enhancedPromptMustInclude: ["Attached files:", "2 file(s)"],
      suggestedToolsMustInclude: ["analyzeMediaFile"],
    },
  },
  {
    id: "enhance_file_image",
    name: "Enhancement: Image file with entity query",
    category: "file-context",
    originalPrompt: "Who are these people?",
    setup: {
      attachedFileIds: ["team_photo.png"],
    },
    validation: {
      enhancedPromptMustInclude: ["Attached files:"],
      suggestedToolsMustInclude: ["analyzeMediaFile"],
    },
  },
  {
    id: "enhance_no_files",
    name: "Enhancement: No files attached",
    category: "file-context",
    originalPrompt: "Tell me about DISCO",
    validation: {
      enhancedPromptMustNotInclude: ["Attached files:"],
      suggestedToolsMustNotInclude: ["analyzeMediaFile"],
    },
  },
];

// ============================================================================
// USER EDIT SCENARIOS
// ============================================================================

export const USER_EDIT_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_user_edit_preserved",
    name: "Enhancement: User edits are preserved",
    category: "user-edit",
    originalPrompt: "Research DISCO",
    userEdit: "Research DISCO focusing on their clinical pipeline",
    setup: {
      injectMemory: {
        entity: "DISCO",
        qualityTier: "good",
        facts: ["CEO: Fabian Niehaus"],
      },
    },
    validation: {
      finalPromptMustInclude: ["clinical pipeline", "Memory:"],
    },
  },
  {
    id: "enhance_user_edit_refine",
    name: "Enhancement: User refinement after enhancement",
    category: "user-edit",
    originalPrompt: "What's VaultPay's funding?",
    userEdit: "What's VaultPay's Series A funding specifically?",
    validation: {
      finalPromptMustInclude: ["Series A"],
    },
  },
  {
    id: "enhance_user_reject",
    name: "Enhancement: User can reject enhancement",
    category: "user-edit",
    originalPrompt: "Just tell me about DISCO briefly",
    validation: {
      // User rejects enhancement, original prompt preserved
      finalPromptMustInclude: ["Just tell me about DISCO briefly"],
    },
  },
];

// ============================================================================
// DOSSIER CONTEXT SCENARIOS
// ============================================================================

export const DOSSIER_CONTEXT_SCENARIOS: PromptEnhancerScenario[] = [
  {
    id: "enhance_dossier_context",
    name: "Enhancement: Dossier context injected",
    category: "file-context",
    originalPrompt: "Expand on this section",
    setup: {
      dossierContext: {
        actIndex: 1,
        sectionType: "Funding & Financials",
      },
    },
    validation: {
      enhancedPromptMustInclude: ["dossier", "Funding"],
      diffMustContain: [{ source: "dossier" }],
    },
  },
  {
    id: "enhance_dossier_chart_context",
    name: "Enhancement: Dossier chart context",
    category: "file-context",
    originalPrompt: "Update this chart",
    setup: {
      dossierContext: {
        actIndex: 2,
        sectionType: "Competitive Analysis",
      },
    },
    validation: {
      enhancedPromptMustInclude: ["dossier", "Competitive"],
    },
  },
];

// ============================================================================
// ALL PROMPT ENHANCER SCENARIOS
// ============================================================================

export const ALL_PROMPT_ENHANCER_SCENARIOS: PromptEnhancerScenario[] = [
  ...MEMORY_INJECTION_SCENARIOS,
  ...ENTITY_EXTRACTION_SCENARIOS,
  ...PERSONA_INFERENCE_ENHANCEMENT_SCENARIOS,
  ...TEMPORAL_EXTRACTION_SCENARIOS,
  ...TOOL_SUGGESTION_SCENARIOS,
  ...FILE_CONTEXT_SCENARIOS,
  ...USER_EDIT_SCENARIOS,
  ...DOSSIER_CONTEXT_SCENARIOS,
];

// ============================================================================
// SCENARIO VALIDATOR SCHEMA
// ============================================================================

export const promptEnhancerScenarioValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(
    v.literal("memory-injection"),
    v.literal("entity-extraction"),
    v.literal("persona-inference"),
    v.literal("temporal"),
    v.literal("tool-suggestion"),
    v.literal("file-context"),
    v.literal("user-edit")
  ),
  originalPrompt: v.string(),
  setup: v.optional(
    v.object({
      injectMemory: v.optional(
        v.object({
          entity: v.string(),
          qualityTier: v.union(
            v.literal("excellent"),
            v.literal("good"),
            v.literal("fair"),
            v.literal("poor")
          ),
          facts: v.array(v.string()),
          ageInDays: v.optional(v.number()),
        })
      ),
      attachedFileIds: v.optional(v.array(v.string())),
      dossierContext: v.optional(
        v.object({
          actIndex: v.number(),
          sectionType: v.string(),
        })
      ),
      threadId: v.optional(v.string()),
    })
  ),
  userEdit: v.optional(v.string()),
  validation: v.object({
    enhancedPromptMustInclude: v.optional(v.array(v.string())),
    enhancedPromptMustNotInclude: v.optional(v.array(v.string())),
    diffMustContain: v.optional(v.array(v.object({ source: v.string() }))),
    suggestedToolsMustInclude: v.optional(v.array(v.string())),
    suggestedToolsMustNotInclude: v.optional(v.array(v.string())),
    injectedContextMustHave: v.optional(v.any()),
    finalPromptMustInclude: v.optional(v.array(v.string())),
  }),
});
