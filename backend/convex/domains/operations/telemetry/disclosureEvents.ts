/**
 * Disclosure Events - Canonical telemetry for progressive disclosure tracking
 *
 * This module provides:
 * 1. DisclosureEvent discriminated union type
 * 2. DisclosureSummary computed from events
 * 3. DisclosureLogger class for emitting events
 * 4. Episode-level reducer for computing summaries
 *
 * All disclosure metrics are computed ONLY by reducing events (never by inference).
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Surface types where disclosure events can occur
 */
export type DisclosureSurface =
  | "digest"
  | "fastAgent"
  | "serverAgent"
  | "calendar"
  | "document"
  | "evaluation"
  | "cli"
  | "api";

/**
 * Discriminated union for all disclosure events.
 * Episode-level metrics are computed ONLY by reducing these events.
 */
export type DisclosureEvent =
  | { t: number; kind: "skill.search"; query: string; topK: number; results: { name: string; score?: number }[] }
  | { t: number; kind: "skill.describe"; name: string; bytes?: number; tokensAdded?: number; hash?: string }
  | { t: number; kind: "skill.cache_hit"; name: string; hash: string }
  | { t: number; kind: "skill.fallback"; query: string; reason: string }
  | { t: number; kind: "tool.search"; query: string; topK: number; results: { toolName: string; server?: string; score?: number }[] }
  | { t: number; kind: "tool.describe"; toolNames: string[]; tokensAdded?: number }
  | { t: number; kind: "tool.invoke"; toolName: string; server?: string; ok: boolean; latencyMs?: number; error?: string }
  | { t: number; kind: "resource.load"; uri: string; owner: "skill" | "tool"; tokensAdded?: number }
  | { t: number; kind: "policy.confirm_requested"; toolName: string; draftId: string; riskTier: string }
  | { t: number; kind: "policy.confirm_granted"; draftId: string }
  | { t: number; kind: "policy.confirm_denied"; draftId: string; reason: string }
  | { t: number; kind: "budget.warning"; currentTokens: number; budgetLimit: number; expansionCost: number }
  | { t: number; kind: "budget.exceeded"; currentTokens: number; budgetLimit: number }
  | { t: number; kind: "enforcement.blocked"; rule: string; toolName?: string; reason: string }
  // Reasoning tool events - transparent step-by-step thinking
  | { t: number; kind: "reasoning.start"; toolName: "reasoningTool"; promptPreview: string; maxTokens: number }
  | { t: number; kind: "reasoning.thinking"; step: number; thought: string; tokensUsed?: number }
  | { t: number; kind: "reasoning.complete"; reasoningTokens: number; outputTokens: number; totalTokens: number; cost: number; durationMs: number };

/**
 * Episode summary aggregates events into actionable metrics.
 * Computed at end of session/turn for dashboard display.
 */
export interface DisclosureSummary {
  // Identity
  sessionId: string;
  surface: DisclosureSurface;
  startTime: number;
  endTime: number;
  durationMs: number;

  // Skill metrics
  skillSearchCalls: number;
  skillSearchQueries: string[];
  skillsActivated: string[];
  skillCacheHits: number;
  skillFallbacks: number;
  skillTokensAdded: number;

  // Tool metrics
  toolSearchCalls: number;
  toolsDiscovered: string[];
  toolsExpanded: string[];
  toolsInvoked: string[];
  toolInvokeErrors: number;
  toolTokensAdded: number;

  // Resource metrics (L3)
  resourcesLoaded: string[];
  resourceTokensAdded: number;

  // Policy metrics
  confirmationsRequested: number;
  confirmationsGranted: number;
  confirmationsDenied: number;

  // Budget metrics
  totalTokensAdded: number;
  budgetWarnings: number;
  budgetExceeded: boolean;

  // Enforcement metrics
  blockedAttempts: number;
  blockedReasons: string[];

  // Quality indicators
  usedSkillFirst: boolean;           // Did skill search happen before tool invoke?
  allToolsViaGateway: boolean;       // Were all tools invoked via gateway?
  skillBeforeToolInvoke: boolean;    // Was describeSkill called before first tool invoke?

  // Reasoning metrics
  reasoningInvocations: number;      // Number of reasoning tool calls
  reasoningThinkingSteps: number;    // Total thinking steps across all calls
  reasoningTokens: number;           // Total reasoning tokens used
  reasoningCost: number;             // Total cost of reasoning in USD
  avgReasoningDuration: number;      // Average reasoning duration in ms
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCLOSURE LOGGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DisclosureLogger - Collects events during an episode and computes summary
 *
 * Usage:
 *   const logger = new DisclosureLogger("session-123", "fastAgent");
 *   logger.logSkillSearch("company research", [{ name: "company-research", score: 0.92 }]);
 *   logger.logSkillDescribe("company-research", 450, "abc123");
 *   logger.logToolInvoke("lookupEntity", true, 120);
 *   const summary = logger.getSummary();
 */
export class DisclosureLogger {
  private sessionId: string;
  private surface: DisclosureSurface;
  private events: DisclosureEvent[] = [];
  private currentTokens: number = 0;

  constructor(sessionId: string, surface: DisclosureSurface) {
    this.sessionId = sessionId;
    this.surface = surface;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SKILL EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  logSkillSearch(query: string, results: { name: string; score?: number }[], topK: number = 5): void {
    this.events.push({
      t: Date.now(),
      kind: "skill.search",
      query,
      topK,
      results,
    });
  }

  logSkillDescribe(name: string, tokensAdded: number, hash?: string): void {
    this.currentTokens += tokensAdded;
    this.events.push({
      t: Date.now(),
      kind: "skill.describe",
      name,
      tokensAdded,
      hash,
    });
  }

  logSkillCacheHit(name: string, hash: string): void {
    this.events.push({
      t: Date.now(),
      kind: "skill.cache_hit",
      name,
      hash,
    });
  }

  logSkillFallback(query: string, reason: string): void {
    this.events.push({
      t: Date.now(),
      kind: "skill.fallback",
      query,
      reason,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  logToolSearch(query: string, results: { toolName: string; server?: string; score?: number }[], topK: number = 5): void {
    this.events.push({
      t: Date.now(),
      kind: "tool.search",
      query,
      topK,
      results,
    });
  }

  logToolDescribe(toolNames: string[], tokensAdded: number): void {
    this.currentTokens += tokensAdded;
    this.events.push({
      t: Date.now(),
      kind: "tool.describe",
      toolNames,
      tokensAdded,
    });
  }

  logToolInvoke(toolName: string, ok: boolean, latencyMs?: number, error?: string, server?: string): void {
    this.events.push({
      t: Date.now(),
      kind: "tool.invoke",
      toolName,
      server,
      ok,
      latencyMs,
      error,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESOURCE EVENTS (L3)
  // ─────────────────────────────────────────────────────────────────────────

  logResourceLoad(uri: string, owner: "skill" | "tool", tokensAdded: number): void {
    this.currentTokens += tokensAdded;
    this.events.push({
      t: Date.now(),
      kind: "resource.load",
      uri,
      owner,
      tokensAdded,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POLICY EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  logConfirmationRequested(toolName: string, draftId: string, riskTier: string): void {
    this.events.push({
      t: Date.now(),
      kind: "policy.confirm_requested",
      toolName,
      draftId,
      riskTier,
    });
  }

  logConfirmationGranted(draftId: string): void {
    this.events.push({
      t: Date.now(),
      kind: "policy.confirm_granted",
      draftId,
    });
  }

  logConfirmationDenied(draftId: string, reason: string): void {
    this.events.push({
      t: Date.now(),
      kind: "policy.confirm_denied",
      draftId,
      reason,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUDGET EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  logBudgetWarning(currentTokens: number, budgetLimit: number, expansionCost: number): void {
    this.events.push({
      t: Date.now(),
      kind: "budget.warning",
      currentTokens,
      budgetLimit,
      expansionCost,
    });
  }

  logBudgetExceeded(currentTokens: number, budgetLimit: number): void {
    this.events.push({
      t: Date.now(),
      kind: "budget.exceeded",
      currentTokens,
      budgetLimit,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENFORCEMENT EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  logEnforcementBlocked(rule: string, reason: string, toolName?: string): void {
    this.events.push({
      t: Date.now(),
      kind: "enforcement.blocked",
      rule,
      reason,
      toolName,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REASONING EVENTS - Transparent step-by-step thinking
  // ─────────────────────────────────────────────────────────────────────────

  logReasoningStart(promptPreview: string, maxTokens: number): void {
    this.events.push({
      t: Date.now(),
      kind: "reasoning.start",
      toolName: "reasoningTool",
      promptPreview: promptPreview.slice(0, 100), // Truncate for display
      maxTokens,
    });
  }

  logReasoningThinking(step: number, thought: string, tokensUsed?: number): void {
    this.events.push({
      t: Date.now(),
      kind: "reasoning.thinking",
      step,
      thought: thought.slice(0, 200), // Truncate for display
      tokensUsed,
    });
  }

  logReasoningComplete(reasoningTokens: number, outputTokens: number, totalTokens: number, cost: number, durationMs: number): void {
    this.events.push({
      t: Date.now(),
      kind: "reasoning.complete",
      reasoningTokens,
      outputTokens,
      totalTokens,
      cost,
      durationMs,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────────────────────

  getEvents(): DisclosureEvent[] {
    return [...this.events];
  }

  getCurrentTokens(): number {
    return this.currentTokens;
  }

  getSummary(): DisclosureSummary {
    return reduceDisclosureEvents(this.events, this.sessionId, this.surface);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EPISODE-LEVEL REDUCER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute summary from raw events - this is the ONLY way to compute disclosure metrics.
 * Never infer metrics from other sources.
 */
export function reduceDisclosureEvents(
  events: DisclosureEvent[],
  sessionId: string = "",
  surface: DisclosureSurface = "evaluation"
): DisclosureSummary {
  if (events.length === 0) {
    return {
      sessionId,
      surface,
      startTime: 0,
      endTime: 0,
      durationMs: 0,
      skillSearchCalls: 0,
      skillSearchQueries: [],
      skillsActivated: [],
      skillCacheHits: 0,
      skillFallbacks: 0,
      skillTokensAdded: 0,
      toolSearchCalls: 0,
      toolsDiscovered: [],
      toolsExpanded: [],
      toolsInvoked: [],
      toolInvokeErrors: 0,
      toolTokensAdded: 0,
      resourcesLoaded: [],
      resourceTokensAdded: 0,
      confirmationsRequested: 0,
      confirmationsGranted: 0,
      confirmationsDenied: 0,
      totalTokensAdded: 0,
      budgetWarnings: 0,
      budgetExceeded: false,
      blockedAttempts: 0,
      blockedReasons: [],
      usedSkillFirst: false,
      allToolsViaGateway: true,
      skillBeforeToolInvoke: false,
      reasoningInvocations: 0,
      reasoningThinkingSteps: 0,
      reasoningTokens: 0,
      reasoningCost: 0,
      avgReasoningDuration: 0,
    };
  }

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const startTime = sorted[0].t;
  const endTime = sorted[sorted.length - 1].t;

  // Skill metrics
  const skillSearches = events.filter((e): e is Extract<DisclosureEvent, { kind: "skill.search" }> => e.kind === "skill.search");
  const skillDescribes = events.filter((e): e is Extract<DisclosureEvent, { kind: "skill.describe" }> => e.kind === "skill.describe");
  const skillCacheHits = events.filter((e): e is Extract<DisclosureEvent, { kind: "skill.cache_hit" }> => e.kind === "skill.cache_hit");
  const skillFallbacks = events.filter((e): e is Extract<DisclosureEvent, { kind: "skill.fallback" }> => e.kind === "skill.fallback");

  // Tool metrics
  const toolSearches = events.filter((e): e is Extract<DisclosureEvent, { kind: "tool.search" }> => e.kind === "tool.search");
  const toolDescribes = events.filter((e): e is Extract<DisclosureEvent, { kind: "tool.describe" }> => e.kind === "tool.describe");
  const toolInvokes = events.filter((e): e is Extract<DisclosureEvent, { kind: "tool.invoke" }> => e.kind === "tool.invoke");

  // Resource metrics
  const resourceLoads = events.filter((e): e is Extract<DisclosureEvent, { kind: "resource.load" }> => e.kind === "resource.load");

  // Policy metrics
  const confirmRequests = events.filter((e): e is Extract<DisclosureEvent, { kind: "policy.confirm_requested" }> => e.kind === "policy.confirm_requested");
  const confirmGrants = events.filter((e): e is Extract<DisclosureEvent, { kind: "policy.confirm_granted" }> => e.kind === "policy.confirm_granted");
  const confirmDenies = events.filter((e): e is Extract<DisclosureEvent, { kind: "policy.confirm_denied" }> => e.kind === "policy.confirm_denied");

  // Budget metrics
  const budgetWarnings = events.filter((e): e is Extract<DisclosureEvent, { kind: "budget.warning" }> => e.kind === "budget.warning");
  const budgetExceeds = events.filter((e): e is Extract<DisclosureEvent, { kind: "budget.exceeded" }> => e.kind === "budget.exceeded");

  // Enforcement metrics
  const blocked = events.filter((e): e is Extract<DisclosureEvent, { kind: "enforcement.blocked" }> => e.kind === "enforcement.blocked");

  // Reasoning metrics
  const reasoningStarts = events.filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.start" }> => e.kind === "reasoning.start");
  const reasoningThinking = events.filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.thinking" }> => e.kind === "reasoning.thinking");
  const reasoningCompletes = events.filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.complete" }> => e.kind === "reasoning.complete");

  // Quality indicators
  const firstSkillSearch = skillSearches[0]?.t ?? Infinity;
  const firstSkillDescribe = skillDescribes[0]?.t ?? Infinity;
  const firstToolInvoke = toolInvokes[0]?.t ?? Infinity;

  const usedSkillFirst = firstSkillSearch < firstToolInvoke;
  const skillBeforeToolInvoke = firstSkillDescribe < firstToolInvoke;

  // Compute token totals
  const skillTokensAdded = skillDescribes.reduce((sum, e) => sum + (e.tokensAdded ?? 0), 0);
  const toolTokensAdded = toolDescribes.reduce((sum, e) => sum + (e.tokensAdded ?? 0), 0);
  const resourceTokensAdded = resourceLoads.reduce((sum, e) => sum + (e.tokensAdded ?? 0), 0);

  return {
    sessionId,
    surface,
    startTime,
    endTime,
    durationMs: endTime - startTime,

    // Skill metrics
    skillSearchCalls: skillSearches.length,
    skillSearchQueries: skillSearches.map((e) => e.query),
    skillsActivated: Array.from(new Set(skillDescribes.map((e) => e.name))),
    skillCacheHits: skillCacheHits.length,
    skillFallbacks: skillFallbacks.length,
    skillTokensAdded,

    // Tool metrics
    toolSearchCalls: toolSearches.length,
    toolsDiscovered: Array.from(new Set(toolSearches.flatMap((e) => e.results.map((r) => r.toolName)))),
    toolsExpanded: Array.from(new Set(toolDescribes.flatMap((e) => e.toolNames))),
    toolsInvoked: Array.from(new Set(toolInvokes.map((e) => e.toolName))),
    toolInvokeErrors: toolInvokes.filter((e) => !e.ok).length,
    toolTokensAdded,

    // Resource metrics
    resourcesLoaded: resourceLoads.map((e) => e.uri),
    resourceTokensAdded,

    // Policy metrics
    confirmationsRequested: confirmRequests.length,
    confirmationsGranted: confirmGrants.length,
    confirmationsDenied: confirmDenies.length,

    // Budget metrics
    totalTokensAdded: skillTokensAdded + toolTokensAdded + resourceTokensAdded,
    budgetWarnings: budgetWarnings.length,
    budgetExceeded: budgetExceeds.length > 0,

    // Enforcement metrics
    blockedAttempts: blocked.length,
    blockedReasons: blocked.map((e) => e.reason),

    // Quality indicators
    usedSkillFirst,
    allToolsViaGateway: true, // Assumed true when using this logger
    skillBeforeToolInvoke,

    // Reasoning metrics
    reasoningInvocations: reasoningStarts.length,
    reasoningThinkingSteps: reasoningThinking.length,
    reasoningTokens: reasoningCompletes.reduce((sum, e) => sum + e.reasoningTokens, 0),
    reasoningCost: reasoningCompletes.reduce((sum, e) => sum + e.cost, 0),
    avgReasoningDuration: reasoningCompletes.length > 0
      ? reasoningCompletes.reduce((sum, e) => sum + e.durationMs, 0) / reasoningCompletes.length
      : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estimate token count from text (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a simple hash from a string (for cache keying)
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

/**
 * Generate disclosure warnings for a summary (non-scored, Week 1-2 mode)
 */
export function generateDisclosureWarnings(summary: DisclosureSummary, scenarioId: string, model: string): string[] {
  const warnings: string[] = [];

  // Warning: No skill search before tool invoke (for non-trivial scenarios)
  if (!summary.usedSkillFirst && summary.toolsInvoked.length > 0) {
    warnings.push(`[${model}/${scenarioId}] No skill search before tool invoke`);
  }

  // Warning: Too many tools expanded
  if (summary.toolsExpanded.length > 10) {
    warnings.push(`[${model}/${scenarioId}] Expanded ${summary.toolsExpanded.length} tools (>10)`);
  }

  // Warning: No skill activation at all
  if (summary.skillsActivated.length === 0 && summary.toolsInvoked.length > 0) {
    warnings.push(`[${model}/${scenarioId}] No skill activated despite tool invocations`);
  }

  // Warning: Budget exceeded
  if (summary.budgetExceeded) {
    warnings.push(`[${model}/${scenarioId}] Token budget exceeded`);
  }

  // Warning: Enforcement blocked
  if (summary.blockedAttempts > 0) {
    warnings.push(`[${model}/${scenarioId}] ${summary.blockedAttempts} blocked attempts: ${summary.blockedReasons.join(", ")}`);
  }

  return warnings;
}

/**
 * Serialize a disclosure event to NDJSON format
 */
export function serializeDisclosureEventNDJSON(event: DisclosureEvent): string {
  return JSON.stringify(event);
}

/**
 * Serialize an episode result to NDJSON format
 */
export function serializeEpisodeNDJSON(episode: {
  model: string;
  scenario: string;
  ok: boolean;
  latencyMs: number;
  disclosure: DisclosureSummary;
}): string {
  return JSON.stringify(episode);
}
