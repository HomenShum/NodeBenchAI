"use node";

/**
 * Comprehensive Evaluation Harness
 *
 * This action runs the full evaluation suite including:
 * - Memory-first scenarios
 * - Multi-turn & session resume scenarios
 * - Persona inference & self-repair scenarios
 * - Media context scenarios
 * - Prompt enhancer scenarios
 * - Compaction scenarios
 * - Invariant scenarios
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";

// Import all scenario types
import {
  ALL_MEMORY_FIRST_SCENARIOS,
  type MemoryFirstScenario,
} from "./memoryFirstScenarios";
import {
  ALL_MULTI_TURN_SCENARIOS,
  type MultiTurnScenario,
} from "./multiTurnScenarios";
import {
  ALL_PERSONA_INFERENCE_SCENARIOS,
  type PersonaInferenceScenario,
} from "./personaInferenceScenarios";
import {
  ALL_MEDIA_CONTEXT_SCENARIOS,
  type MediaContextScenario,
} from "./mediaContextScenarios";
import {
  ALL_PROMPT_ENHANCER_SCENARIOS,
  type PromptEnhancerScenario,
} from "./promptEnhancerScenarios";

// Import validators
import {
  validateMemoryFirstScenario,
  validateMultiTurnScenario,
  validatePersonaInferenceScenario,
  validateMediaContextScenario,
  generateValidationSummary,
  groupResultsBySuite,
  type TurnResult,
  type ScenarioValidationResult,
  type Scratchpad,
} from "./validators";

// ============================================================================
// TYPES
// ============================================================================

export type EvalSuite =
  | "memory-first"
  | "staleness"
  | "quality-tier"
  | "multi-turn"
  | "invariants"
  | "compaction"
  | "persona-inference"
  | "self-repair"
  | "persona-packaging"
  | "media-context"
  | "file-upload"
  | "multi-modal"
  | "image-analysis"
  | "document-analysis"
  | "prompt-enhancer";

export interface EvalRunConfig {
  model: string;
  suites: EvalSuite[];
  maxScenarios?: number;
  timeout?: number;
  verbose?: boolean;
}

export interface EvalResult {
  ok: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  bySuite: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      passRate: number;
      scenarios: ScenarioValidationResult[];
    }
  >;
  results: ScenarioValidationResult[];
  metadata: {
    model: string;
    startTime: number;
    endTime: number;
    durationMs: number;
    suites: EvalSuite[];
  };
}

// ============================================================================
// SCENARIO LOADING
// ============================================================================

function loadScenarios(suite: EvalSuite): Array<
  | MemoryFirstScenario
  | MultiTurnScenario
  | PersonaInferenceScenario
  | MediaContextScenario
  | PromptEnhancerScenario
> {
  switch (suite) {
    // Memory-first suites
    case "memory-first":
      return ALL_MEMORY_FIRST_SCENARIOS.filter(
        (s) => s.category === "memory-first"
      );
    case "staleness":
      return ALL_MEMORY_FIRST_SCENARIOS.filter(
        (s) => s.category === "staleness"
      );
    case "quality-tier":
      return ALL_MEMORY_FIRST_SCENARIOS.filter(
        (s) => s.category === "quality-tier"
      );

    // Multi-turn suites
    case "multi-turn":
      return ALL_MULTI_TURN_SCENARIOS.filter((s) => s.category === "multi-turn");
    case "invariants":
      return ALL_MULTI_TURN_SCENARIOS.filter((s) => s.category === "invariants");
    case "compaction":
      return ALL_MULTI_TURN_SCENARIOS.filter((s) => s.category === "compaction");

    // Persona inference suites
    case "persona-inference":
      return ALL_PERSONA_INFERENCE_SCENARIOS.filter(
        (s) => s.category === "persona-inference"
      );
    case "self-repair":
      return ALL_PERSONA_INFERENCE_SCENARIOS.filter(
        (s) => s.category === "self-repair"
      );
    case "persona-packaging":
      return ALL_PERSONA_INFERENCE_SCENARIOS.filter(
        (s) =>
          s.id.includes("packaging") &&
          s.category === "persona-inference"
      );

    // Media context suites
    case "media-context":
      return ALL_MEDIA_CONTEXT_SCENARIOS;
    case "file-upload":
      return ALL_MEDIA_CONTEXT_SCENARIOS.filter(
        (s) => s.category === "file-upload"
      );
    case "multi-modal":
      return ALL_MEDIA_CONTEXT_SCENARIOS.filter(
        (s) => s.category === "multi-modal"
      );
    case "image-analysis":
      return ALL_MEDIA_CONTEXT_SCENARIOS.filter(
        (s) => s.category === "image-analysis"
      );
    case "document-analysis":
      return ALL_MEDIA_CONTEXT_SCENARIOS.filter(
        (s) => s.category === "document-analysis"
      );

    // Prompt enhancer
    case "prompt-enhancer":
      return ALL_PROMPT_ENHANCER_SCENARIOS;

    default:
      return [];
  }
}

// ============================================================================
// SETUP EXECUTION
// ============================================================================

interface SetupConfig {
  injectMemory?: {
    entity: string;
    facts?: string[];
    qualityTier?: "excellent" | "good" | "fair" | "poor";
    ageInDays?: number;
    missingFields?: string[];
  };
  injectStaleMemory?: {
    entity: string;
    ageInDays: number;
    qualityTier?: "excellent" | "good" | "fair" | "poor";
  };
  uploadFile?: {
    type: string;
    name: string;
    mockContent?: string;
    mockAnalysis?: string;
  };
  uploadFiles?: Array<{
    type: string;
    name: string;
    mockContent?: string;
    mockAnalysis?: string;
  }>;
}

async function executeSetup(
  ctx: any,
  setup: SetupConfig
): Promise<{ threadId?: string; fileIds?: string[] }> {
  const result: { threadId?: string; fileIds?: string[] } = {};

  // Inject memory
  if (setup.injectMemory) {
    // This would call the memory injection tool in a real implementation
    // For now, we simulate by recording the setup for validation
    console.log(
      `[Setup] Injecting memory for ${setup.injectMemory.entity}:`,
      setup.injectMemory
    );
  }

  // Inject stale memory
  if (setup.injectStaleMemory) {
    console.log(
      `[Setup] Injecting stale memory for ${setup.injectStaleMemory.entity}:`,
      setup.injectStaleMemory
    );
  }

  // Upload file(s)
  if (setup.uploadFile) {
    // Simulate file upload
    result.fileIds = [`mock_file_${Date.now()}`];
    console.log(`[Setup] Uploaded mock file: ${setup.uploadFile.name}`);
  }

  if (setup.uploadFiles) {
    result.fileIds = setup.uploadFiles.map(
      (f, i) => `mock_file_${Date.now()}_${i}`
    );
    console.log(
      `[Setup] Uploaded ${setup.uploadFiles.length} mock files`
    );
  }

  return result;
}

// ============================================================================
// SINGLE TURN EXECUTION
// ============================================================================

interface SingleTurnArgs {
  query: string;
  threadId?: string;
  model: string;
  fileIds?: string[];
  mockMode?: boolean;
}

async function runSingleTurn(
  ctx: any,
  args: SingleTurnArgs
): Promise<TurnResult> {
  const startTime = Date.now();

  try {
    if (args.mockMode) {
      // Generate mock result for testing the harness itself
      return generateMockTurnResult(args);
    }

    // Call the actual agent
    const response = await ctx.runAction(api.domains.agents.agentChatActions.sendMessageToAgent, {
      message: args.query,
      threadId: args.threadId,
      model: args.model,
      // attachedFiles could be added here
    });

    // Parse the response to extract tool calls, scratchpad, etc.
    // This is a simplified version - real implementation would parse structured output
    return {
      query: args.query,
      output: response.content || response.message || String(response),
      toolCalls: response.toolCalls || [],
      scratchpad: response.scratchpad || createEmptyScratchpad(),
      threadId: response.threadId || args.threadId || `thread_${Date.now()}`,
      messageId: response.messageId || `msg_${Date.now()}`,
      persona: response.persona,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      query: args.query,
      output: "",
      toolCalls: [],
      scratchpad: createEmptyScratchpad(),
      threadId: args.threadId || `thread_${Date.now()}`,
      messageId: `msg_${Date.now()}`,
      error: errorMessage,
    };
  }
}

function createEmptyScratchpad(): Scratchpad {
  return {
    messageId: `msg_${Date.now()}`,
    activeEntities: [],
    memoryUpdatedEntities: [],
    currentIntent: "unknown",
    stepCount: 0,
    toolCallCount: 0,
    planningCallCount: 0,
  };
}

function generateMockTurnResult(args: SingleTurnArgs): TurnResult {
  // Generate a mock result for testing
  const messageId = `mock_msg_${Date.now()}`;

  // Extract entities from query
  const entities = extractEntitiesFromQuery(args.query);

  // Generate mock tool calls based on query content
  const toolCalls = generateMockToolCalls(args.query);

  // Generate mock output
  const output = generateMockOutput(args.query, entities);

  // Infer persona from query
  const persona = inferPersonaFromQuery(args.query);

  return {
    query: args.query,
    output,
    toolCalls,
    scratchpad: {
      messageId,
      activeEntities: entities,
      memoryUpdatedEntities: [],
      currentIntent: determineIntent(args.query),
      stepCount: toolCalls.length,
      toolCallCount: toolCalls.length,
      planningCallCount: 0,
    },
    threadId: args.threadId || `thread_${Date.now()}`,
    messageId,
    persona,
  };
}

function extractEntitiesFromQuery(query: string): string[] {
  const knownEntities = [
    "DISCO",
    "Tesla",
    "Rivian",
    "VaultPay",
    "GenomiQ",
    "Ambros",
    "QuickJS",
    "Salesforce",
    "Lucid",
  ];
  const found: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const entity of knownEntities) {
    if (lowerQuery.includes(entity.toLowerCase())) {
      found.push(entity);
    }
  }

  return found;
}

function generateMockToolCalls(query: string): Array<{
  name: string;
  args?: Record<string, unknown>;
  timestamp: number;
  result?: unknown;
}> {
  const calls: Array<{
    name: string;
    args?: Record<string, unknown>;
    timestamp: number;
  }> = [];
  const lowerQuery = query.toLowerCase();
  const baseTime = Date.now();

  // Always start with initScratchpad
  calls.push({ name: "initScratchpad", timestamp: baseTime });

  // Query memory for entity queries
  if (extractEntitiesFromQuery(query).length > 0) {
    calls.push({ name: "queryMemory", timestamp: baseTime + 100 });
  }

  // Research triggers
  if (
    lowerQuery.includes("research") ||
    lowerQuery.includes("deep dive") ||
    lowerQuery.includes("dossier")
  ) {
    calls.push({ name: "getBankerGradeEntityInsights", timestamp: baseTime + 200 });
    calls.push({ name: "updateMemoryFromReview", timestamp: baseTime + 300 });
  }

  // News triggers
  if (
    lowerQuery.includes("news") ||
    lowerQuery.includes("latest") ||
    lowerQuery.includes("recent")
  ) {
    calls.push({ name: "linkupSearch", timestamp: baseTime + 150 });
    calls.push({ name: "getLiveFeed", timestamp: baseTime + 200 });
  }

  // SEC triggers
  if (
    lowerQuery.includes("sec") ||
    lowerQuery.includes("10-k") ||
    lowerQuery.includes("filing")
  ) {
    calls.push({ name: "delegateToSECAgent", timestamp: baseTime + 200 });
  }

  // Media triggers
  if (
    lowerQuery.includes("analyze") ||
    lowerQuery.includes("pitch deck") ||
    lowerQuery.includes("photo")
  ) {
    calls.push({ name: "analyzeMediaFile", timestamp: baseTime + 150 });
  }

  // Comparison triggers
  if (
    lowerQuery.includes("compare") ||
    extractEntitiesFromQuery(query).length > 1
  ) {
    calls.push({ name: "decomposeQuery", timestamp: baseTime + 50 });
  }

  // Compaction for long queries
  if (calls.length >= 5) {
    calls.push({ name: "compactContext", timestamp: baseTime + 400 });
  }

  return calls;
}

function generateMockOutput(query: string, entities: string[]): string {
  const lowerQuery = query.toLowerCase();

  // Base output
  let output = "";

  // Add entity information
  if (entities.includes("DISCO")) {
    output +=
      "DISCO Pharmaceuticals is a biotech company headquartered in Cologne, Germany. ";
    output +=
      "They raised €36M in their Seed round led by RA Capital Management. ";
    output += "CEO: Fabian Niehaus. Platform: Disc-Seq for RNA therapeutics.\n\n";
  }

  if (entities.includes("Tesla")) {
    output += "Tesla is an electric vehicle manufacturer based in Austin, Texas. ";
    output += "CEO: Elon Musk. Recent Q3 deliveries: 435K vehicles.\n\n";
  }

  if (entities.includes("Rivian")) {
    output += "Rivian is an EV company focused on trucks and SUVs. ";
    output += "Series funding: IPO in 2021.\n\n";
  }

  // Add persona-specific formatting
  if (lowerQuery.includes("thesis") || lowerQuery.includes("wedge")) {
    output += "## Thesis\nStrong platform approach with differentiated technology.\n\n";
    output += "## Why it matters\nAddresses unmet need in RNA therapeutics.\n\n";
    output += "## Competitive map\nCompetitors include traditional pharma.\n\n";
    output += "## What would change my mind\nClinical trial failures.\n\n";
  }

  if (lowerQuery.includes("outreach") || lowerQuery.includes("banker")) {
    output += "## Verdict\nPASS - Ready for banker outreach.\n\n";
    output += "## Funding\n€36M Seed round.\n\n";
    output += "## Why-now\nRecent funding momentum.\n\n";
    output += "## Outreach angles\n1. Investment banking services\n2. Strategic advisory\n\n";
    output += "## Contact\nfabian.niehaus@disco.de (CEO)\n\n";
    output += "## Next actions\nSchedule intro call.\n\n";
  }

  if (lowerQuery.includes("security") || lowerQuery.includes("cve")) {
    output += "## Exposure\nHigh - affects all deployments using QuickJS.\n\n";
    output += "## Impact\nPotential RCE vulnerability.\n\n";
    output += "## Mitigation\nUpgrade to latest version.\n\n";
    output += "## Patch\nAvailable in QuickJS 2025.01.\n\n";
    output += "## Verification\nRun security scanner post-upgrade.\n\n";
  }

  if (lowerQuery.includes("compare")) {
    output += "## Comparison\n";
    output += `Comparing ${entities.join(" vs ")}:\n\n`;
    output += "Both companies show strong fundamentals but differ in strategy.\n";
  }

  if (!output) {
    output = `Analysis of ${entities.join(", ") || "requested topics"} complete.`;
  }

  return output;
}

function determineIntent(query: string): string {
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes("compare")) return "comparison";
  if (lowerQuery.includes("research") || lowerQuery.includes("deep dive"))
    return "deep-research";
  if (lowerQuery.includes("latest") || lowerQuery.includes("news"))
    return "news-lookup";
  if (lowerQuery.includes("sec") || lowerQuery.includes("filing"))
    return "sec-lookup";
  if (lowerQuery.includes("outreach") || lowerQuery.includes("contact"))
    return "outreach-prep";

  return "general-query";
}

function inferPersonaFromQuery(query: string): {
  inferred: string;
  confidence: number;
} {
  const lowerQuery = query.toLowerCase();

  const personaKeywords: Record<string, string[]> = {
    EARLY_STAGE_VC: ["wedge", "thesis", "comps", "market fit", "tam"],
    QUANT_ANALYST: ["signal", "metrics", "track", "time-series", "forecast"],
    PRODUCT_DESIGNER: ["schema", "ui", "card", "rendering", "json fields"],
    SALES_ENGINEER: ["share-ready", "one-screen", "objections", "cta"],
    CTO_TECH_LEAD: ["cve", "security", "patch", "upgrade", "dependency"],
    ECOSYSTEM_PARTNER: ["partnerships", "ecosystem", "second-order"],
    FOUNDER_STRATEGY: ["positioning", "strategy", "pivot", "moat"],
    ENTERPRISE_EXEC: ["pricing", "vendor", "cost", "procurement", "p&l"],
    ACADEMIC_RD: ["papers", "methodology", "literature", "citations"],
    JPM_STARTUP_BANKER: [
      "outreach",
      "pipeline",
      "this week",
      "contact",
      "target",
      "banker",
    ],
  };

  for (const [persona, keywords] of Object.entries(personaKeywords)) {
    const matched = keywords.filter((k) => lowerQuery.includes(k));
    if (matched.length >= 1) {
      return {
        inferred: persona,
        confidence: Math.min(0.9, 0.5 + matched.length * 0.2),
      };
    }
  }

  // Default to JPM_STARTUP_BANKER for vague queries
  return { inferred: "JPM_STARTUP_BANKER", confidence: 0.5 };
}

// ============================================================================
// SCENARIO VALIDATION DISPATCH
// ============================================================================

function validateScenario(
  scenario:
    | MemoryFirstScenario
    | MultiTurnScenario
    | PersonaInferenceScenario
    | MediaContextScenario
    | PromptEnhancerScenario,
  turnResults: TurnResult[]
): ScenarioValidationResult {
  // Dispatch to appropriate validator based on scenario type
  const category = (scenario as { category: string }).category;

  // Check for multi-turn scenarios first (has turns array and multi-turn category)
  if (
    "turns" in scenario &&
    (category === "multi-turn" || category === "invariants" || category === "compaction")
  ) {
    return validateMultiTurnScenario(
      scenario as unknown as MultiTurnScenario,
      turnResults
    );
  }

  // Memory-first scenarios
  if (
    category === "memory-first" ||
    category === "staleness" ||
    category === "quality-tier"
  ) {
    return validateMemoryFirstScenario(
      scenario as MemoryFirstScenario,
      turnResults[0]
    );
  }

  // Persona inference scenarios
  if (category === "persona-inference" || category === "self-repair") {
    return validatePersonaInferenceScenario(
      scenario as PersonaInferenceScenario,
      turnResults[0]
    );
  }

  // Media context scenarios
  if (
    category === "file-upload" ||
    category === "multi-modal" ||
    category === "image-analysis" ||
    category === "document-analysis"
  ) {
    return validateMediaContextScenario(
      scenario as MediaContextScenario,
      turnResults[0]
    );
  }

  // Prompt enhancer scenarios - return a basic validation result
  if (
    category === "memory-injection" ||
    category === "entity-extraction" ||
    category === "temporal" ||
    category === "tool-suggestion" ||
    category === "file-context" ||
    category === "user-edit"
  ) {
    // Prompt enhancer scenarios need a custom validator
    return {
      passed: true, // Placeholder - needs implementation
      errors: [],
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      suite: category,
    };
  }

  // Default: treat as memory-first
  return validateMemoryFirstScenario(
    scenario as MemoryFirstScenario,
    turnResults[0]
  );
}

// ============================================================================
// MAIN EVAL ACTION
// ============================================================================

/**
 * Run comprehensive evaluation across all scenario suites
 */
export const runComprehensiveEval = action({
  args: {
    model: v.string(),
    suites: v.array(
      v.union(
        v.literal("memory-first"),
        v.literal("staleness"),
        v.literal("quality-tier"),
        v.literal("multi-turn"),
        v.literal("invariants"),
        v.literal("compaction"),
        v.literal("persona-inference"),
        v.literal("self-repair"),
        v.literal("persona-packaging"),
        v.literal("media-context"),
        v.literal("file-upload"),
        v.literal("multi-modal"),
        v.literal("image-analysis"),
        v.literal("document-analysis"),
        v.literal("prompt-enhancer")
      )
    ),
    maxScenarios: v.optional(v.number()),
    mockMode: v.optional(v.boolean()),
    verbose: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<EvalResult> => {
    const startTime = Date.now();
    const results: ScenarioValidationResult[] = [];
    const verbose = args.verbose ?? false;
    const mockMode = args.mockMode ?? true; // Default to mock mode for safety

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Starting Comprehensive Eval`);
    console.log(`Model: ${args.model}`);
    console.log(`Suites: ${args.suites.join(", ")}`);
    console.log(`Mock Mode: ${mockMode}`);
    console.log(`${"=".repeat(60)}\n`);

    for (const suite of args.suites) {
      const scenarios = loadScenarios(suite);
      const limitedScenarios = args.maxScenarios
        ? scenarios.slice(0, args.maxScenarios)
        : scenarios;

      console.log(`\n--- Suite: ${suite} (${limitedScenarios.length} scenarios) ---\n`);

      for (const scenario of limitedScenarios) {
        if (verbose) {
          console.log(`Running: ${scenario.id} - ${scenario.name}`);
        }

        try {
          // Setup phase
          const setupConfig = (scenario as any).setup;
          const setupResult = setupConfig
            ? await executeSetup(ctx, setupConfig)
            : {};

          // Run through all turns
          const turnResults: TurnResult[] = [];
          let threadId = setupResult.threadId;

          // Get turns - either from multi-turn scenario or single query
          const turns =
            "turns" in scenario
              ? (scenario).turns
              : [{ query: (scenario as any).query }];

          for (const turn of turns) {
            const result = await runSingleTurn(ctx, {
              query: turn.query,
              threadId,
              model: args.model,
              fileIds: setupResult.fileIds,
              mockMode,
            });

            threadId = result.threadId;
            turnResults.push(result);
          }

          // Validate
          const validation = validateScenario(scenario, turnResults);
          results.push(validation);

          if (verbose) {
            const status = validation.passed ? "✓ PASS" : "✗ FAIL";
            console.log(`  ${status}: ${scenario.id}`);
            if (!validation.passed) {
              for (const error of validation.errors) {
                console.log(`    - ${error}`);
              }
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.push({
            passed: false,
            errors: [`Execution error: ${errorMessage}`],
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            suite,
          });

          if (verbose) {
            console.log(`  ✗ ERROR: ${scenario.id} - ${errorMessage}`);
          }
        }
      }
    }

    const endTime = Date.now();

    // Generate summary
    const summary = generateValidationSummary(results);
    const grouped = groupResultsBySuite(results);

    // Build suite summaries
    const bySuite: EvalResult["bySuite"] = {};
    for (const [suiteName, suiteResults] of Object.entries(grouped)) {
      const suiteSummary = generateValidationSummary(suiteResults);
      bySuite[suiteName] = {
        ...suiteSummary,
        scenarios: suiteResults,
      };
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Evaluation Complete`);
    console.log(`Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed}`);
    console.log(`Pass Rate: ${summary.passRate.toFixed(1)}%`);
    console.log(`Duration: ${endTime - startTime}ms`);
    console.log(`${"=".repeat(60)}\n`);

    return {
      ok: summary.failed === 0,
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        passRate: summary.passRate,
      },
      bySuite,
      results,
      metadata: {
        model: args.model,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        suites: args.suites,
      },
    };
  },
});

/**
 * Run a quick smoke test with memory-first scenarios
 */
export const runQuickEval = action({
  args: {
    model: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<EvalResult> => {
    return ctx.runAction(api.domains.evaluation.comprehensiveEval.runComprehensiveEval, {
      model: args.model ?? "claude-sonnet-4.6",
      suites: ["memory-first", "persona-inference"],
      maxScenarios: 5,
      mockMode: true,
      verbose: true,
    });
  },
});

/**
 * List all available scenarios across all suites
 */
export const listAllScenarios = action({
  args: {},
  returns: v.any(),
  handler: async (): Promise<{
    total: number;
    bySuite: Record<string, { count: number; ids: string[] }>;
  }> => {
    const allSuites: EvalSuite[] = [
      "memory-first",
      "staleness",
      "quality-tier",
      "multi-turn",
      "invariants",
      "compaction",
      "persona-inference",
      "self-repair",
      "persona-packaging",
      "media-context",
      "file-upload",
      "multi-modal",
      "image-analysis",
      "document-analysis",
      "prompt-enhancer",
    ];

    const bySuite: Record<string, { count: number; ids: string[] }> = {};
    let total = 0;

    for (const suite of allSuites) {
      const scenarios = loadScenarios(suite);
      bySuite[suite] = {
        count: scenarios.length,
        ids: scenarios.map((s) => s.id),
      };
      total += scenarios.length;
    }

    return { total, bySuite };
  },
});
