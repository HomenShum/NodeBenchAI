/**
 * Multi-Turn & Session Resume Evaluation Scenarios
 *
 * These scenarios test:
 * 1. Context preservation across multiple turns
 * 2. Scratchpad invariant enforcement (A/C/D)
 * 3. Context compaction for long sessions
 * 4. Thread persistence with continueThread
 */

import { v } from "convex/values";

// ============================================================================
// TYPES
// ============================================================================

export interface TurnValidation {
  mustCallTools?: string[];
  mustCallBefore?: Record<string, string[]>;
  mustNotCall?: string[];
  scratchpadMustContain?: Record<string, any>;
  mustReuseContext?: boolean;
  messageIdMustDiffer?: boolean;
  memoryUpdatedEntitiesMustReset?: boolean;
  mustSynthesizeAcrossEntities?: boolean;
  outputMustContain?: string[];
  captureMessageId?: boolean;
}

export interface ScenarioTurn {
  query: string;
  validation?: TurnValidation;
}

export interface MultiTurnScenario {
  id: string;
  name: string;
  category: "multi-turn" | "invariants" | "compaction";
  turns: ScenarioTurn[];
  validation?: {
    toolCallCountMinimum?: number;
    mustCallTools?: string[];
    compactContextOutputMustHave?: string[];
    mustNotCallTwice?: string[];
  };
}

// ============================================================================
// MULTI-TURN SCENARIOS
// ============================================================================

export const MULTI_TURN_ENTITY_SCENARIOS: MultiTurnScenario[] = [
  {
    id: "multi_turn_entity_comparison",
    name: "Multi-turn: Entity comparison across turns",
    category: "multi-turn",
    turns: [
      {
        query: "Research Tesla for me",
        validation: {
          mustCallTools: ["initScratchpad", "queryMemory"],
          scratchpadMustContain: { activeEntities: ["Tesla"] },
        },
      },
      {
        query: "Now compare to Rivian",
        validation: {
          mustCallTools: ["decomposeQuery"],
          scratchpadMustContain: { activeEntities: ["Tesla", "Rivian"] },
          mustReuseContext: true,
        },
      },
      {
        query: "Which is better for our portfolio?",
        validation: {
          mustSynthesizeAcrossEntities: true,
          outputMustContain: ["Tesla", "Rivian", "comparison"],
        },
      },
    ],
  },
  {
    id: "multi_turn_deep_dive_continuation",
    name: "Multi-turn: Deep dive with continuation",
    category: "multi-turn",
    turns: [
      {
        query: "Tell me about DISCO Pharmaceuticals",
        validation: {
          mustCallTools: ["initScratchpad"],
          scratchpadMustContain: { activeEntities: ["DISCO"] },
        },
      },
      {
        query: "What about their funding history?",
        validation: {
          mustReuseContext: true,
          scratchpadMustContain: { activeEntities: ["DISCO"] },
          outputMustContain: ["€36M", "Seed"],
        },
      },
      {
        query: "And who are their investors?",
        validation: {
          mustReuseContext: true,
          outputMustContain: ["RA Capital"],
        },
      },
    ],
  },
  {
    id: "multi_turn_topic_switch",
    name: "Multi-turn: Topic switch with context preservation",
    category: "multi-turn",
    turns: [
      {
        query: "Research VaultPay's Series A",
        validation: {
          mustCallTools: ["initScratchpad"],
          scratchpadMustContain: { activeEntities: ["VaultPay"] },
        },
      },
      {
        query: "Actually, let's look at GenomiQ instead",
        validation: {
          scratchpadMustContain: { activeEntities: ["GenomiQ"] },
          // Old entity should be removed or deprioritized
        },
      },
      {
        query: "Compare GenomiQ to the previous company",
        validation: {
          scratchpadMustContain: { activeEntities: ["GenomiQ", "VaultPay"] },
          mustSynthesizeAcrossEntities: true,
        },
      },
    ],
  },
  {
    id: "multi_turn_refinement",
    name: "Multi-turn: Query refinement",
    category: "multi-turn",
    turns: [
      {
        query: "Show me biotech companies",
        validation: {
          mustCallTools: ["initScratchpad"],
          scratchpadMustContain: { currentIntent: "deep-research" },
        },
      },
      {
        query: "Focus on those with recent funding",
        validation: {
          mustReuseContext: true,
          outputMustContain: ["funding"],
        },
      },
      {
        query: "Only Series A or later",
        validation: {
          mustReuseContext: true,
          outputMustContain: ["Series A"],
        },
      },
    ],
  },
  {
    id: "multi_turn_persona_shift",
    name: "Multi-turn: Persona shift mid-conversation",
    category: "multi-turn",
    turns: [
      {
        query: "What's DISCO's thesis fit for our fund?",
        validation: {
          scratchpadMustContain: { currentIntent: "deep-research" },
          // Should infer EARLY_STAGE_VC
        },
      },
      {
        query: "Now evaluate them for banker outreach",
        validation: {
          // Should shift to JPM_STARTUP_BANKER
          outputMustContain: ["outreach", "contact"],
        },
      },
    ],
  },
  {
    id: "multi_turn_build_on_previous",
    name: "Multi-turn: Build on previous findings",
    category: "multi-turn",
    turns: [
      {
        query: "Find companies in the AI chip space",
        validation: {
          mustCallTools: ["initScratchpad"],
        },
      },
      {
        query: "Which ones have raised over $100M?",
        validation: {
          mustReuseContext: true,
        },
      },
      {
        query: "Create a comparison table of the top 3",
        validation: {
          mustReuseContext: true,
          mustSynthesizeAcrossEntities: true,
        },
      },
    ],
  },
];

// ============================================================================
// INVARIANT SCENARIOS
// ============================================================================

export const INVARIANT_SCENARIOS: MultiTurnScenario[] = [
  {
    id: "invariant_a_message_isolation",
    name: "Invariant A: Message ID isolation",
    category: "invariants",
    turns: [
      {
        query: "Research DISCO",
        validation: {
          captureMessageId: true,
          mustCallTools: ["initScratchpad"],
        },
      },
      {
        query: "Now research Ambros",
        validation: {
          messageIdMustDiffer: true,
          memoryUpdatedEntitiesMustReset: true,
          mustCallTools: ["initScratchpad"],
        },
      },
    ],
  },
  {
    id: "invariant_c_memory_dedupe",
    name: "Invariant C: Memory deduplication",
    category: "invariants",
    turns: [
      {
        query: "Deep dive on Tesla with full enrichment",
        validation: {
          mustCallTools: ["updateMemoryFromReview"],
          scratchpadMustContain: { memoryUpdatedEntities: ["company:TSLA"] },
        },
      },
    ],
    validation: {
      mustNotCallTwice: ["updateMemoryFromReview"],
    },
  },
  {
    id: "invariant_c_no_duplicate_writes",
    name: "Invariant C: No duplicate memory writes in same turn",
    category: "invariants",
    turns: [
      {
        query: "Research Tesla and also check their SEC filings",
        validation: {
          mustCallTools: ["queryMemory", "updateMemoryFromReview"],
        },
      },
    ],
    validation: {
      mustNotCallTwice: ["updateMemoryFromReview"],
    },
  },
  {
    id: "invariant_d_capability_version",
    name: "Invariant D: Capability version check before planning",
    category: "invariants",
    turns: [
      {
        query: "Plan a comprehensive analysis of the AI chip market",
        validation: {
          mustCallBefore: { discoverCapabilities: ["sequentialThinking"] },
          scratchpadMustContain: { capabilitiesVersion: /^v\d+/ },
        },
      },
    ],
  },
  {
    id: "invariant_a_fresh_per_message",
    name: "Invariant A: Fresh scratchpad per user message",
    category: "invariants",
    turns: [
      {
        query: "What's new with Tesla?",
        validation: {
          mustCallTools: ["initScratchpad"],
          scratchpadMustContain: { stepCount: 0, toolCallCount: 0 },
        },
      },
      {
        query: "And their competitors?",
        validation: {
          mustCallTools: ["initScratchpad"],
          scratchpadMustContain: { stepCount: 0, toolCallCount: 0 },
        },
      },
    ],
  },
  {
    id: "invariant_safety_limits",
    name: "Invariant: Safety limits enforcement",
    category: "invariants",
    turns: [
      {
        query: "Do an extremely comprehensive analysis of Tesla, including every SEC filing, all news, all competitors, founder backgrounds, and create a full investment memo",
        validation: {
          // Should hit limits and gracefully stop
          scratchpadMustContain: { stepCount: 8 }, // MAX_STEPS_PER_QUERY
        },
      },
    ],
  },
];

// ============================================================================
// COMPACTION SCENARIOS
// ============================================================================

export const COMPACTION_SCENARIOS: MultiTurnScenario[] = [
  {
    id: "compaction_long_research",
    name: "Compaction: Long research triggers compaction",
    category: "compaction",
    turns: [
      {
        query: "Build a comprehensive dossier on Tesla, including SEC filings, founder backgrounds, and competitive analysis",
        validation: {
          mustCallTools: ["compactContext"],
        },
      },
    ],
    validation: {
      toolCallCountMinimum: 5,
      mustCallTools: ["compactContext"],
      compactContextOutputMustHave: ["facts", "constraints", "missing", "nextSteps"],
    },
  },
  {
    id: "compaction_multi_entity_research",
    name: "Compaction: Multi-entity research needs compaction",
    category: "compaction",
    turns: [
      {
        query: "Compare Tesla, Rivian, and Lucid's market positions, funding history, and leadership teams",
        validation: {
          mustCallTools: ["decomposeQuery", "compactContext"],
        },
      },
    ],
    validation: {
      toolCallCountMinimum: 6,
      mustCallTools: ["compactContext"],
    },
  },
  {
    id: "compaction_preserves_key_facts",
    name: "Compaction: Preserves key facts after compaction",
    category: "compaction",
    turns: [
      {
        query: "Research DISCO Pharmaceuticals thoroughly",
        validation: {
          mustCallTools: ["compactContext"],
        },
      },
      {
        query: "Based on what you found, is DISCO ready for outreach?",
        validation: {
          mustReuseContext: true,
          outputMustContain: ["€36M", "Cologne"],
        },
      },
    ],
  },
  {
    id: "compaction_context_summary",
    name: "Compaction: Can summarize compacted context",
    category: "compaction",
    turns: [
      {
        query: "Deep dive on VaultPay and GenomiQ",
        validation: {
          mustCallTools: ["compactContext"],
        },
      },
      {
        query: "What have we learned so far?",
        validation: {
          mustCallTools: ["getScratchpadSummary"],
          outputMustContain: ["VaultPay", "GenomiQ"],
        },
      },
    ],
  },
];

// ============================================================================
// ALL MULTI-TURN SCENARIOS
// ============================================================================

export const ALL_MULTI_TURN_SCENARIOS: MultiTurnScenario[] = [
  ...MULTI_TURN_ENTITY_SCENARIOS,
  ...INVARIANT_SCENARIOS,
  ...COMPACTION_SCENARIOS,
];

// ============================================================================
// SCENARIO VALIDATOR SCHEMA
// ============================================================================

export const multiTurnScenarioValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(v.literal("multi-turn"), v.literal("invariants"), v.literal("compaction")),
  turns: v.array(
    v.object({
      query: v.string(),
      validation: v.optional(
        v.object({
          mustCallTools: v.optional(v.array(v.string())),
          mustCallBefore: v.optional(v.any()),
          mustNotCall: v.optional(v.array(v.string())),
          scratchpadMustContain: v.optional(v.any()),
          mustReuseContext: v.optional(v.boolean()),
          messageIdMustDiffer: v.optional(v.boolean()),
          memoryUpdatedEntitiesMustReset: v.optional(v.boolean()),
          mustSynthesizeAcrossEntities: v.optional(v.boolean()),
          outputMustContain: v.optional(v.array(v.string())),
          captureMessageId: v.optional(v.boolean()),
        })
      ),
    })
  ),
  validation: v.optional(
    v.object({
      toolCallCountMinimum: v.optional(v.number()),
      mustCallTools: v.optional(v.array(v.string())),
      compactContextOutputMustHave: v.optional(v.array(v.string())),
      mustNotCallTwice: v.optional(v.array(v.string())),
    })
  ),
});
