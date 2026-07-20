// convex/tools/contextTools.ts
// Context management tools for Coordinator scratchpad and context compaction
// These tools enable stateful multi-step reasoning without context bloat
// INVARIANTS A/B/C enforced in code - not just prompts
//
// ═══════════════════════════════════════════════════════════════════════════
// AGENTIC CONTEXT ENGINEERING - RETRIEVAL LATENCY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
//
// This module implements explicit latency budgets and timeout handling for
// context retrieval operations to prevent slow retrievals from blocking
// agent responses.
//
// KEY STRATEGIES:
// 1. LATENCY BUDGETS: Each retrieval operation has a max time budget
// 2. TIMEOUT HANDLING: Graceful degradation with fallback values
// 3. PERFORMANCE MONITORING: Track retrieval latencies for optimization
// 4. PARALLEL EXECUTION: Use Promise.all with individual timeouts
// ═══════════════════════════════════════════════════════════════════════════

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { GoogleGenAI, createUserContent, Type } from "@google/genai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// ═══════════════════════════════════════════════════════════════════════════
// LATENCY BUDGET CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Latency budgets for different retrieval operations (in milliseconds)
 * These values are tuned for user-perceived responsiveness
 */
export const LATENCY_BUDGETS = {
  /** Fast operations - immediate response expected */
  FAST: 500,
  /** Standard operations - brief wait acceptable */
  STANDARD: 2000,
  /** Heavy operations - longer wait acceptable for better results */
  HEAVY: 5000,
  /** LLM calls - allow more time for generation */
  LLM_CALL: 15000,
  /** Total context assembly budget */
  CONTEXT_ASSEMBLY: 3000,
} as const;

/**
 * Performance metrics for retrieval operations
 * Used for monitoring and optimization
 */
export interface RetrievalMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  timedOut: boolean;
  fallbackUsed: boolean;
  error?: string;
}

/**
 * In-memory metrics buffer (last 100 operations)
 * In production, this would be persisted to a monitoring system
 */
const metricsBuffer: RetrievalMetrics[] = [];
const MAX_METRICS_BUFFER = 100;

/**
 * Record a retrieval metric
 */
function recordMetric(metric: RetrievalMetrics): void {
  metricsBuffer.push(metric);
  if (metricsBuffer.length > MAX_METRICS_BUFFER) {
    metricsBuffer.shift();
  }

  // Log slow operations for debugging
  if (metric.duration > LATENCY_BUDGETS.STANDARD) {
    console.warn(`[LATENCY] Slow operation: ${metric.operation} took ${metric.duration}ms`);
  }
  if (metric.timedOut) {
    console.warn(`[LATENCY] Operation timed out: ${metric.operation} (budget: ${metric.duration}ms)`);
  }
}

/**
 * Get recent retrieval metrics for analysis
 */
export function getRetrievalMetrics(): RetrievalMetrics[] {
  return [...metricsBuffer];
}

/**
 * Get average latency by operation type
 */
export function getAverageLatencies(): Map<string, number> {
  const latencies = new Map<string, { total: number; count: number }>();

  for (const metric of metricsBuffer) {
    const existing = latencies.get(metric.operation) ?? { total: 0, count: 0 };
    existing.total += metric.duration;
    existing.count++;
    latencies.set(metric.operation, existing);
  }

  const averages = new Map<string, number>();
  for (const [op, stat] of latencies) {
    averages.set(op, stat.total / stat.count);
  }
  return averages;
}

/**
 * Execute an operation with a timeout and fallback
 * Returns the result or fallback value if timeout/error occurs
 */
export async function withLatencyBudget<T>(
  operation: string,
  budgetMs: number,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ result: T; metrics: RetrievalMetrics }> {
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${budgetMs}ms`)), budgetMs)
      ),
    ]);

    const endTime = Date.now();
    const metrics: RetrievalMetrics = {
      operation,
      startTime,
      endTime,
      duration: endTime - startTime,
      success: true,
      timedOut: false,
      fallbackUsed: false,
    };
    recordMetric(metrics);

    return { result, metrics };
  } catch (err) {
    const endTime = Date.now();
    const isTimeout = err instanceof Error && err.message.includes("Timeout");

    const metrics: RetrievalMetrics = {
      operation,
      startTime,
      endTime,
      duration: endTime - startTime,
      success: false,
      timedOut: isTimeout,
      fallbackUsed: true,
      error: err instanceof Error ? err.message : String(err),
    };
    recordMetric(metrics);

    console.warn(`[LATENCY] ${operation} failed (${isTimeout ? 'timeout' : 'error'}), using fallback`);
    return { result: fallback, metrics };
  }
}

/**
 * Execute multiple operations in parallel with individual budgets
 * Each operation has its own timeout and fallback
 */
export async function parallelWithBudgets<T extends Record<string, unknown>>(
  operations: {
    [K in keyof T]: {
      fn: () => Promise<T[K]>;
      budget: number;
      fallback: T[K];
    };
  }
): Promise<{ results: T; metrics: RetrievalMetrics[] }> {
  const keys = Object.keys(operations) as (keyof T)[];
  const startTime = Date.now();

  const promises = keys.map(async (key) => {
    const op = operations[key];
    const { result, metrics } = await withLatencyBudget(
      String(key),
      op.budget,
      op.fn,
      op.fallback
    );
    return { key, result, metrics };
  });

  const results = await Promise.all(promises);

  const finalResults = {} as T;
  const allMetrics: RetrievalMetrics[] = [];

  for (const { key, result, metrics } of results) {
    finalResults[key] = result;
    allMetrics.push(metrics);
  }

  const totalDuration = Date.now() - startTime;
  console.log(`[LATENCY] Parallel operations completed in ${totalDuration}ms`);

  return { results: finalResults, metrics: allMetrics };
}

// Persistence helpers (optional, keyed by agentThreadId + userId)
async function loadPersistedScratchpad(ctx: any, agentThreadId?: string, userId?: string) {
  if (!agentThreadId || !userId) return null;
  const existing = await ctx.db
    .query("agentScratchpads")
    .withIndex("by_agent_thread", (q: any) => q.eq("agentThreadId", agentThreadId))
    .first();
  if (!existing || String(existing.userId) !== String(userId)) return null;
  return existing;
}

async function savePersistedScratchpad(ctx: any, agentThreadId: string, userId: string, scratchpad: any) {
  const now = Date.now();
  const existing = await ctx.db
    .query("agentScratchpads")
    .withIndex("by_agent_thread", (q: any) => q.eq("agentThreadId", agentThreadId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { scratchpad, updatedAt: now });
  } else {
    await ctx.db.insert("agentScratchpads", {
      agentThreadId,
      userId: userId as any,
      scratchpad,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Generate unique messageId (browser-safe, no Node crypto)
// ═══════════════════════════════════════════════════════════════════════════

function newMessageId(): string {
  // Use Math.random for browser compatibility (no Node crypto needed)
  const randomPart = Math.random().toString(36).substring(2, 14);
  return `msg_${Date.now()}_${randomPart}`;
}

// Helper: Add unique item to array (no duplicates)
function addUnique(arr: string[], item: string): string[] {
  if (!arr.includes(item)) arr.push(item);
  return arr;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRATCHPAD SCHEMA
// Persistent state structure for Coordinator between steps
// INVARIANT A: messageId enforces per-message isolation
// INVARIANT C: memoryUpdatedEntities tracks memory dedupe
// ═══════════════════════════════════════════════════════════════════════════

// Task schema for pendingTasks/completedTasks
const taskSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  suggestedTool: z.string().optional(),
  status: z.string().optional(),
});

export const scratchpadSchema = z.object({
  // INVARIANT A: Message isolation
  messageId: z.string().describe("Unique ID for current user message - hard isolation"),
  
  // INVARIANT C: Memory dedupe tracking
  memoryUpdatedEntities: z.array(z.string()).default([]).describe("Canonical keys already updated this message"),
  
  // INVARIANT D: Capability version tracking
  capabilitiesVersion: z.string().nullable().default(null).describe("Version of cached capabilities"),
  
  // Existing fields
  activeEntities: z.array(z.string()).default([]),
  activeTheme: z.string().nullable().default(null),
  lastPlan: z.object({
    nodes: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
    edges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    linearPlan: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
  }).nullable().default(null),
  lastCapabilities: z.object({
    version: z.string().optional(),
    directTools: z.array(z.object({ name: z.string(), purpose: z.string() })).optional(),
  }).nullable().default(null),
  compactContext: z.object({
    facts: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    missing: z.array(z.string()).optional(),
    summary: z.string().optional(),
    messageId: z.string().optional(),
  }).nullable().default(null),
  workingSet: z.object({
    compactionMode: z.literal("deterministic_compaction_first"),
    summary: z.string(),
    priorityLedger: z.array(z.string()),
    activeAngles: z.array(z.string()),
    angleCapsules: z.array(z.object({
      angleId: z.string(),
      displayName: z.string(),
      summary: z.string(),
      sourceLabels: z.array(z.string()),
    })),
    jitSlices: z.array(z.object({
      label: z.string(),
      summary: z.string(),
      source: z.union([
        z.literal("entity_cache"),
        z.literal("pulse"),
        z.literal("daily_brief"),
        z.literal("user_context"),
        z.literal("known_state"),
      ]),
      angleIds: z.array(z.string()),
    })),
    hotWindow: z.array(z.object({
      role: z.union([z.literal("user"), z.literal("assistant"), z.literal("system")]),
      content: z.string(),
    })),
    contextRotRisk: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]),
    messagesCompacted: z.number(),
    builtAt: z.number(),
  }).nullable().default(null),
  lastToolOutput: z.string().nullable().default(null),
  pendingTasks: z.array(taskSchema).default([]),
  completedTasks: z.array(taskSchema).default([]),
  currentIntent: z.string().nullable().default(null),
  
  // Section tracking for per-section artifact linking
  activeSectionKey: z.string().nullable().default(null).describe("Human-readable section key (e.g., 'market_landscape')"),
  activeSectionId: z.string().nullable().default(null).describe("Stable machine ID for linking artifacts"),
  
  // Safety limits tracking
  stepCount: z.number().default(0),
  toolCallCount: z.number().default(0),
  planningCallCount: z.number().default(0),
  
  // Timestamps
  createdAt: z.number().default(Date.now()),
  updatedAt: z.number().default(Date.now()),
});

export type Scratchpad = z.infer<typeof scratchpadSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// COMPACT CONTEXT SCHEMA
// Strict output schema for deterministic context compression
// ═══════════════════════════════════════════════════════════════════════════

export const compactContextSchema = z.object({
  facts: z.array(z.string()).describe("Key facts extracted from tool output"),
  constraints: z.array(z.string()).describe("Constraints or limitations discovered"),
  missing: z.array(z.string()).describe("Information still missing"),
  derivedEntities: z.array(z.string()).describe("New entities discovered"),
  openQuestions: z.array(z.string()).describe("Questions that remain unanswered"),
  nextSteps: z.array(z.string()).describe("Suggested next actions"),
  summary: z.string().describe("One-paragraph summary of the tool output"),
});

export type CompactContext = z.infer<typeof compactContextSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #1: initScratchpad
// Initialize a fresh scratchpad for a new conversation/task
// INVARIANT A: Always generates new messageId for hard isolation
// ═══════════════════════════════════════════════════════════════════════════

export const initScratchpad = createTool({
  description: `Initialize a FRESH scratchpad for the current user message.
MANDATORY: Call this at the START of EVERY new user message.
Generates a unique messageId that all subsequent tools must match.`,

  args: z.object({
    currentIntent: z.string().optional().describe("Classified intent: greeting|comparison|deep-research|etc"),
    activeEntities: z.array(z.string()).optional().describe("Initial entities to track"),
    activeTheme: z.string().optional().describe("Theme if applicable"),
    agentThreadId: z.string().optional().describe("Optional agentThreadId to persist scratchpad"),
    userId: z.string().optional().describe("User id for persistence (required if agentThreadId provided)"),
  }),

  handler: async (ctx, args) => {
    // INVARIANT A: New messageId for every user message
    const messageId = newMessageId();

    // Try to load an existing scratchpad if persistence is enabled
    const persisted = await loadPersistedScratchpad(ctx, args.agentThreadId, args.userId);
    let scratchpad: Scratchpad;

    if (persisted) {
      scratchpad = {
        ...(persisted.scratchpad as Scratchpad),
        messageId,
        currentIntent: args.currentIntent || persisted.scratchpad?.currentIntent || null,
        activeEntities: args.activeEntities ?? persisted.scratchpad?.activeEntities ?? [],
        activeTheme: args.activeTheme ?? persisted.scratchpad?.activeTheme ?? null,
        stepCount: 0,
        toolCallCount: 0,
        planningCallCount: 0,
        updatedAt: Date.now(),
      };
    } else {
      scratchpad = {
        // INVARIANT A: Message isolation
        messageId,
        
        // INVARIANT C: Memory dedupe tracking (fresh)
        memoryUpdatedEntities: [],
        
        // INVARIANT D: Capability version (will be set when discoverCapabilities runs)
        capabilitiesVersion: null,
        
        // Existing fields
        activeEntities: args.activeEntities || [],
        activeTheme: args.activeTheme || null,
        lastPlan: null,
        lastCapabilities: null,
        compactContext: null,
        workingSet: null,
        lastToolOutput: null,
        pendingTasks: [],
        completedTasks: [],
        currentIntent: args.currentIntent || null,
        
        // Section tracking (null until setActiveSection is called)
        activeSectionKey: null,
        activeSectionId: null,
        
        // Safety limits (fresh counters)
        stepCount: 0,
        toolCallCount: 0,
        planningCallCount: 0,
        
        // Timestamps
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    if (args.agentThreadId && args.userId) {
      await savePersistedScratchpad(ctx, args.agentThreadId, args.userId, scratchpad);
    }

    return scratchpad;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #2: updateScratchpad
// Update scratchpad state after a tool call
// INVARIANT A: Guards messageId - refuses to mutate on mismatch
// ═══════════════════════════════════════════════════════════════════════════

export const updateScratchpad = createTool({
  description: `Update the scratchpad after completing a tool call.
REQUIRES messageId match - refuses to mutate if messageId doesn't match.
Call this AFTER each tool to maintain state continuity.`,

  args: z.object({
    messageId: z.string().describe("REQUIRED: Must match scratchpad.messageId"),
    currentScratchpad: scratchpadSchema.describe("Current scratchpad state"),
    agentThreadId: z.string().optional().describe("Optional agentThreadId to persist scratchpad"),
    userId: z.string().optional().describe("User id for persistence (required if agentThreadId provided)"),
    updates: z.object({
      activeEntities: z.array(z.string()).optional(),
      activeTheme: z.string().nullable().optional(),
      lastPlan: z.object({
        nodes: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
        edges: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
        linearPlan: z.array(z.object({ id: z.string(), description: z.string() })).optional(),
      }).optional(),
      lastCapabilities: z.object({
        version: z.string().optional(),
        directTools: z.array(z.object({ name: z.string(), purpose: z.string() })).optional(),
      }).optional(),
      capabilitiesVersion: z.string().optional(),
      compactContext: z.object({
        facts: z.array(z.string()).optional(),
        summary: z.string().optional(),
        messageId: z.string().optional(),
      }).optional(),
      workingSet: z.object({
        compactionMode: z.literal("deterministic_compaction_first"),
        summary: z.string(),
        priorityLedger: z.array(z.string()),
        activeAngles: z.array(z.string()),
        angleCapsules: z.array(z.object({
          angleId: z.string(),
          displayName: z.string(),
          summary: z.string(),
          sourceLabels: z.array(z.string()),
        })),
        jitSlices: z.array(z.object({
          label: z.string(),
          summary: z.string(),
          source: z.union([
            z.literal("entity_cache"),
            z.literal("pulse"),
            z.literal("daily_brief"),
            z.literal("user_context"),
            z.literal("known_state"),
          ]),
          angleIds: z.array(z.string()),
        })),
        hotWindow: z.array(z.object({
          role: z.union([z.literal("user"), z.literal("assistant"), z.literal("system")]),
          content: z.string(),
        })),
        contextRotRisk: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]),
        messagesCompacted: z.number(),
        builtAt: z.number(),
      }).nullable().optional(),
      lastToolOutput: z.string().optional(),
      completedTask: taskSchema.optional(),
      newPendingTasks: z.array(taskSchema).optional(),
      incrementToolCall: z.boolean().optional(),
      incrementPlanningCall: z.boolean().optional(),
    }).describe("Fields to update"),
  }),

  handler: async (ctx, args) => {
    // INVARIANT A: Guard messageId
    if (args.currentScratchpad.messageId !== args.messageId) {
      console.error(`[updateScratchpad] messageId MISMATCH: expected ${args.currentScratchpad.messageId}, got ${args.messageId}`);
      return {
        ok: false,
        reason: "messageId_mismatch",
        scratchpad: null,
      };
    }
    
    const updated: Scratchpad = {
      ...args.currentScratchpad,
      updatedAt: Date.now(),
      stepCount: args.currentScratchpad.stepCount + 1,
      toolCallCount: args.updates.incrementToolCall 
        ? args.currentScratchpad.toolCallCount + 1 
        : args.currentScratchpad.toolCallCount,
      planningCallCount: args.updates.incrementPlanningCall 
        ? args.currentScratchpad.planningCallCount + 1 
        : args.currentScratchpad.planningCallCount,
    };

    // Apply updates
    if (args.updates.activeEntities) {
      updated.activeEntities = [
        ...new Set([...updated.activeEntities, ...args.updates.activeEntities])
      ];
    }
    if (args.updates.activeTheme !== undefined) {
      updated.activeTheme = args.updates.activeTheme;
    }
    if (args.updates.lastPlan !== undefined) {
      updated.lastPlan = args.updates.lastPlan;
    }
    if (args.updates.lastCapabilities !== undefined) {
      updated.lastCapabilities = args.updates.lastCapabilities;
    }
    if (args.updates.capabilitiesVersion !== undefined) {
      updated.capabilitiesVersion = args.updates.capabilitiesVersion;
    }
    if (args.updates.compactContext !== undefined) {
      // INVARIANT B: Only accept compactContext if it has matching messageId
      const ctx = args.updates.compactContext;
      if (ctx && ctx.messageId && ctx.messageId !== args.messageId) {
        console.warn("[updateScratchpad] Rejecting compactContext with wrong messageId");
      } else {
        updated.compactContext = ctx;
      }
    }
    if (args.updates.workingSet !== undefined) {
      updated.workingSet = args.updates.workingSet ?? null;
    }
    if (args.updates.lastToolOutput !== undefined) {
      updated.lastToolOutput = args.updates.lastToolOutput;
    }
    if (args.updates.completedTask) {
      updated.completedTasks = [...updated.completedTasks, args.updates.completedTask];
      updated.pendingTasks = updated.pendingTasks.filter(
        t => JSON.stringify(t) !== JSON.stringify(args.updates.completedTask)
      );
    }
    if (args.updates.newPendingTasks) {
      updated.pendingTasks = [...updated.pendingTasks, ...args.updates.newPendingTasks];
    }

    if (args.agentThreadId && args.userId) {
      await savePersistedScratchpad(ctx, args.agentThreadId, args.userId, updated);
    }

    return { ok: true, scratchpad: updated };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #2B: setActiveSection
// Set the current section for artifact linking
// Called before generating or researching each dossier section
// ═══════════════════════════════════════════════════════════════════════════

export const setActiveSection = createTool({
  description: `Set the active section for artifact linking.
Call this BEFORE running tools or generating content for a dossier section.
All artifacts discovered in that section will be automatically linked to it.

Example section keys: executive_summary, market_landscape, funding_signals, risk_flags`,

  args: z.object({
    messageId: z.string().describe("REQUIRED: Must match scratchpad.messageId"),
    currentScratchpad: scratchpadSchema.describe("Current scratchpad state"),
    sectionKey: z.string().describe("Section key (e.g., 'market_landscape')"),
    runId: z.string().describe("The run/thread ID for stable ID generation"),
    agentThreadId: z.string().optional().describe("Optional agentThreadId to persist scratchpad"),
    userId: z.string().optional().describe("User id for persistence (required if agentThreadId provided)"),
  }),

  handler: async (ctx, args) => {
    // INVARIANT A: Guard messageId
    if (args.currentScratchpad.messageId !== args.messageId) {
      return {
        ok: false,
        reason: "messageId_mismatch",
        scratchpad: null,
      };
    }
    
    // Generate stable section ID
    // Using simple hash here - matches shared/sectionIds.ts hashSync
    const input = `${args.runId}|${args.sectionKey}`;
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    const sectionId = `sec_${Math.abs(hash).toString(36)}`;
    
    const updated: Scratchpad = {
      ...args.currentScratchpad,
      activeSectionKey: args.sectionKey,
      activeSectionId: sectionId,
      updatedAt: Date.now(),
    };
    
    if (args.agentThreadId && args.userId) {
      await savePersistedScratchpad(ctx, args.agentThreadId, args.userId, updated);
    }

    return {
      ok: true,
      scratchpad: updated,
      sectionKey: args.sectionKey,
      sectionId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #3: compactContext
// Compress tool output into structured, deterministic format
// INVARIANT B: Only fallback to previousContext if SAME messageId
// ═══════════════════════════════════════════════════════════════════════════

// Empty context schema (safe fallback)
const EMPTY_CONTEXT: CompactContext & { messageId?: string } = {
  facts: [],
  constraints: [],
  missing: ["Unable to extract - proceeding with raw output"],
  derivedEntities: [],
  openQuestions: [],
  nextSteps: ["Continue with available information"],
  summary: "",
};

export const compactContext = createTool({
  description: `Compress verbose tool output into a compact, structured format.
REQUIRES messageId - only falls back to previousContext if SAME messageId.
Call this AFTER any non-trivial tool to prevent context bloat.

Returns a strict schema with: facts, constraints, missing, derivedEntities, openQuestions, nextSteps, summary, messageId.`,

  args: z.object({
    messageId: z.string().describe("REQUIRED: Current message ID for isolation"),
    toolName: z.string().describe("Name of the tool that produced the output"),
    toolOutput: z.string().describe("Raw output from the tool (stringified)"),
    currentGoal: z.string().describe("What you're trying to achieve"),
    previousContext: z.object({
      facts: z.array(z.string()).optional(),
      constraints: z.array(z.string()).optional(),
      missing: z.array(z.string()).optional(),
      summary: z.string().optional(),
      messageId: z.string().optional(),
    }).optional().describe("Previous compactContext if any"),
  }),

  handler: async (_ctx, args) => {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    
    // INVARIANT B: Check if previousContext belongs to same message
    const previousMessageId = args.previousContext?.messageId;
    const canUsePrevious = previousMessageId === args.messageId;
    
    // Fallback structure - stamped with current messageId
    const fallback: CompactContext & { messageId: string } = {
      ...EMPTY_CONTEXT,
      messageId: args.messageId,
      summary: typeof args.toolOutput === 'string' 
        ? args.toolOutput.slice(0, 500) 
        : JSON.stringify(args.toolOutput).slice(0, 500),
    };

    if (!geminiKey) {
      console.warn("[compactContext] No Gemini API key - returning fallback");
      return fallback;
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const prompt = `Extract ONLY essential information from this tool output.

TOOL: ${args.toolName}
GOAL: ${args.currentGoal}

TOOL OUTPUT:
${typeof args.toolOutput === 'string' ? args.toolOutput : JSON.stringify(args.toolOutput, null, 2)}

${args.previousContext ? `PREVIOUS CONTEXT:\n${JSON.stringify(args.previousContext, null, 2)}` : ''}

Return a JSON object with EXACTLY these keys:
- facts: array of key facts (strings)
- constraints: array of limitations discovered (strings)
- missing: array of information still needed (strings)
- derivedEntities: array of new entities discovered (strings)
- openQuestions: array of unanswered questions (strings)
- nextSteps: array of suggested next actions (strings)
- summary: one-paragraph summary (string)

BE CONCISE. Remove all verbose explanations and redundant details.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        facts: { type: Type.ARRAY, items: { type: Type.STRING } },
        constraints: { type: Type.ARRAY, items: { type: Type.STRING } },
        missing: { type: Type.ARRAY, items: { type: Type.STRING } },
        derivedEntities: { type: Type.ARRAY, items: { type: Type.STRING } },
        openQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
        summary: { type: Type.STRING },
      },
      required: ["facts", "constraints", "missing", "derivedEntities", "openQuestions", "nextSteps", "summary"],
    } as const;

    // Helper to check if result is "empty" (all arrays empty)
    const isResultEmpty = (result: CompactContext): boolean => {
      return (
        result.facts.length === 0 &&
        result.constraints.length === 0 &&
        result.missing.length === 0 &&
        result.derivedEntities.length === 0 &&
        result.openQuestions.length === 0 &&
        result.nextSteps.length === 0 &&
        (!result.summary || result.summary.trim().length === 0)
      );
    };

    // Helper to check if previous context has meaningful data
    const previousHasData = (prev: any): boolean => {
      if (!prev) return false;
      const p = prev as CompactContext;
      const hasFacts = Array.isArray(p.facts) && p.facts.length > 0;
      const hasConstraints = Array.isArray(p.constraints) && p.constraints.length > 0;
      const hasEntities = Array.isArray(p.derivedEntities) && p.derivedEntities.length > 0;
      const hasSummary = typeof p.summary === 'string' && p.summary.trim().length > 0;
      return hasFacts || hasConstraints || hasEntities || hasSummary;
    };

    try {
      const response = await ai.models.generateContent({
        model: getLlmModel("router", "gemini"),
        contents: createUserContent([{ text: prompt }]),
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const json = JSON.parse(response.text ?? "{}");
      
      // Validate against schema
      const parsed = compactContextSchema.safeParse(json);
      if (!parsed.success) {
        console.warn("[compactContext] Schema validation failed");
        // INVARIANT B: Only use previous if SAME messageId
        if (canUsePrevious && previousHasData(args.previousContext)) {
          console.warn("[compactContext] Preserving previous context (same messageId)");
          return { ...args.previousContext, messageId: args.messageId };
        }
        return fallback;
      }
      
      // INVARIANT B + MICRO-GAP 1: Check if result is empty but previous had data (same messageId only)
      if (isResultEmpty(parsed.data) && canUsePrevious && previousHasData(args.previousContext)) {
        console.warn("[compactContext] Result empty but previous had data - preserving previous (same messageId)");
        return { ...args.previousContext, messageId: args.messageId };
      }
      
      // Stamp output with messageId for future invariant checks
      return { ...parsed.data, messageId: args.messageId };
    } catch (err) {
      console.error("[compactContext] Error:", err);
      // INVARIANT B: Only use previous if SAME messageId
      if (canUsePrevious && previousHasData(args.previousContext)) {
        console.warn("[compactContext] Error occurred - preserving previous context (same messageId)");
        return { ...args.previousContext, messageId: args.messageId };
      }
      return fallback;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #4: getScratchpadSummary
// Get a brief summary of current scratchpad state for context
// ═══════════════════════════════════════════════════════════════════════════

export const getScratchpadSummary = createTool({
  description: `Get a brief summary of current scratchpad state.
Useful for understanding where you are in a multi-step task and checking limits.`,

  args: z.object({
    scratchpad: scratchpadSchema,
  }),

  handler: async (_ctx, args) => {
    const s = args.scratchpad;
    return {
      // Identification
      messageId: s.messageId,
      
      // Counters & limits
      stepCount: s.stepCount,
      toolCallCount: s.toolCallCount,
      planningCallCount: s.planningCallCount,
      
      // Safety limit status
      stepsRemaining: 8 - s.stepCount,
      toolCallsRemaining: 12 - s.toolCallCount,
      planningCallsRemaining: 2 - s.planningCallCount,
      
      // State
      activeEntities: s.activeEntities,
      activeTheme: s.activeTheme,
      currentIntent: s.currentIntent,
      pendingTaskCount: s.pendingTasks.length,
      completedTaskCount: s.completedTasks.length,
      
      // Capabilities
      capabilitiesVersion: s.capabilitiesVersion,
      hasCapabilities: s.lastCapabilities !== null,
      
      // Context
      hasCompactContext: s.compactContext !== null,
      hasWorkingSet: s.workingSet !== null,
      hasPlan: s.lastPlan !== null,
      activeAngles: s.workingSet?.activeAngles ?? [],
      activeAngleCount: s.workingSet?.activeAngles?.length ?? 0,
      jitSliceCount: s.workingSet?.jitSlices?.length ?? 0,
      priorityLedgerCount: s.workingSet?.priorityLedger?.length ?? 0,
      contextRotRisk: s.workingSet?.contextRotRisk ?? null,
      
      // Memory dedupe tracking (Invariant C)
      memoryUpdatedEntities: s.memoryUpdatedEntities,
      memoryUpdatedCount: s.memoryUpdatedEntities.length,
      
      // Timing
      ageMs: Date.now() - s.createdAt,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #5: markMemoryUpdated
// Track that entity memory was updated (Invariant C: Memory Dedupe)
// ═══════════════════════════════════════════════════════════════════════════

export const markMemoryUpdated = createTool({
  description: `Mark that entity memory was updated for this messageId.
INVARIANT C: Prevents double-writes by tracking which entities have been updated.
Call this after ANY tool that writes to entityContexts.`,

  args: z.object({
    messageId: z.string().describe("REQUIRED: Must match scratchpad.messageId"),
    canonicalKey: z.string().describe("Entity key, e.g., 'company:TSLA' or 'person:sam-altman'"),
    currentScratchpad: scratchpadSchema.describe("Current scratchpad state"),
    agentThreadId: z.string().optional().describe("Optional agentThreadId to persist scratchpad"),
    userId: z.string().optional().describe("User id for persistence (required if agentThreadId provided)"),
  }),

  handler: async (ctx, args) => {
    // INVARIANT A: Guard messageId
    if (args.currentScratchpad.messageId !== args.messageId) {
      console.error(`[markMemoryUpdated] messageId MISMATCH`);
      return {
        ok: false,
        reason: "messageId_mismatch",
        scratchpad: null,
      };
    }
    
    // Check if already marked
    if (args.currentScratchpad.memoryUpdatedEntities.includes(args.canonicalKey)) {
      return {
        ok: true,
        alreadyMarked: true,
        scratchpad: args.currentScratchpad,
      };
    }
    
    // Add to tracking array
    const updated: Scratchpad = {
      ...args.currentScratchpad,
      memoryUpdatedEntities: addUnique(
        [...args.currentScratchpad.memoryUpdatedEntities],
        args.canonicalKey
      ),
      updatedAt: Date.now(),
    };
    
    if (args.agentThreadId && args.userId) {
      await savePersistedScratchpad(ctx, args.agentThreadId, args.userId, updated);
    }

    return {
      ok: true,
      alreadyMarked: false,
      scratchpad: updated,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #6: isMemoryUpdated
// Check if entity was already updated this message (Invariant C: Memory Dedupe)
// ═══════════════════════════════════════════════════════════════════════════

export const isMemoryUpdated = createTool({
  description: `Check if entity memory was already updated for this messageId.
INVARIANT C: Use this BEFORE calling updateMemoryFromReview to prevent double-writes.`,

  args: z.object({
    canonicalKey: z.string().describe("Entity key to check"),
    scratchpad: scratchpadSchema.describe("Current scratchpad state"),
  }),

  handler: async (_ctx, args) => {
    const wasUpdated = args.scratchpad.memoryUpdatedEntities.includes(args.canonicalKey);
    return {
      canonicalKey: args.canonicalKey,
      wasUpdated,
      memoryUpdatedEntities: args.scratchpad.memoryUpdatedEntities,
    };
  },
});
