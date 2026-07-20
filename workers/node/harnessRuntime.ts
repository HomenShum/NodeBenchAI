/**
 * harnessRuntime.ts — NodeBench Unified Agent Harness Runtime
 *
 * The conversation runtime that turns NodeBench from a dashboard into the
 * engine that orchestrates how agents gather, analyze, and act on intelligence.
 *
 * Unifies:
 *   - agentHarness.ts (plan → execute → synthesize)
 *   - engine/session.ts (session management, tool scoping)
 *   - engine/contextBridge.ts (SQLite persistence, learnings)
 *   - engine/conformance.ts (quality scoring)
 *   - nemoclaw/agentRunner.ts patterns (multi-provider, conversation loop, circuit breakers)
 *
 * Architecture (claw-code harness pattern):
 *   1. User message → classify intent + extract entities
 *   2. Plan tool chain (LLM or deterministic fallback)
 *   3. Execute plan with permission checks, cost tracking, trace streaming
 *   4. Observe results, adapt plan if needed (re-plan on failure)
 *   5. Synthesize into ResultPacket
 *   6. Persist session, extract learnings, update cost ledger
 *   7. Support multi-turn: subsequent queries reuse session context
 *
 * Session lifecycle:
 *   create → run (repeatable) → compact (when context grows) → end
 */

import {
  generatePlan,
  executeHarness,
  synthesizeResults,
  type HarnessPlan,
  type HarnessExecution,
  type HarnessStepResult,
  type HarnessTraceEvent,
} from "./agentHarness.js";
import {
  buildMemorySeedContext,
  recallEntityMemory,
  type EntityMemoryRecallEntry,
} from "./lib/entityMemoryRecall.js";
import { saveExtractedSkillTemplate, shouldExtractSkillTemplate } from "./lib/skillExtractor.js";
import { saveHarnessTraceDistillation } from "./lib/traceDistillation.js";
import type { McpTool } from "../packages/mcp-local/src/types.js";
import { deriveReportArtifactMode } from "../shared/reportArtifacts.js";

// ── Types ─────────────────────────────────────────────────────────────

export type PermissionMode = "allow" | "deny" | "prompt";

export interface PermissionPolicy {
  default: PermissionMode;
  toolOverrides: Record<string, PermissionMode>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TurnCost {
  turnIndex: number;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  timestamp: number;
}

export interface CompactionSummary {
  removedMessageCount: number;
  preservedMessageCount: number;
  toolsUsed: string[];
  pendingWork: string[];
  keyFiles: string[];
  currentState: string;
}

export interface HarnessMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  timestamp: number;
  turnIndex: number;
}

export interface SteeringEntry {
  id: string;
  payload: Record<string, unknown> | string;
  createdAt: number;
  source?: string;
}

export type HarnessRoutingMode = "executive" | "advisor";
export type HarnessRoutingSource = "automatic" | "user_forced";

export interface HarnessRoutingDecision {
  routingMode: HarnessRoutingMode;
  routingReason: string;
  routingSource: HarnessRoutingSource;
  plannerModel: string;
  executionModel: string;
  reasoningEffort: "medium" | "high";
}

export interface HarnessSessionState {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  status: "active" | "compacted" | "completed" | "error";
  preset: string;
  lens: string;
  messages: HarnessMessage[];
  turns: TurnRecord[];
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  compactions: CompactionSummary[];
  permissionPolicy: PermissionPolicy;
  entityContext: Record<string, unknown>;
  adaptationCount: number;
  pendingSteering: SteeringEntry[];
}

export interface TurnRecord {
  index: number;
  query: string;
  classification: string;
  entities: string[];
  routing: HarnessRoutingDecision;
  plan: HarnessPlan | null;
  stepResults: HarnessStepResult[];
  synthesizedResult: unknown;
  durationMs: number;
  costUsd: number;
  adaptations: number;
  timestamp: number;
}

export interface TraceEvent {
  type?: HarnessTraceEvent["type"];
  step: string;
  tool?: string;
  status: "ok" | "error" | "adapting" | "skip";
  detail?: string;
  durationMs?: number;
  stepId?: string;
  stepIndex?: number;
  groupId?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  preview?: string;
  startedAt?: number;
  completedAt?: number;
  injectedContext?: string[];
  steeringApplied?: boolean;
  timestamp: number;
}

export interface HarnessRunResult {
  sessionId: string;
  turnIndex: number;
  result: unknown;
  trace: TraceEvent[];
  durationMs: number;
  costUsd: number;
  classification: string;
  entities: string[];
  routing: HarnessRoutingDecision;
  planSteps: number;
  adaptations: number;
  sessionTotalCostUsd: number;
}

// ── Model pricing (per 1M tokens) ────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 },
  "gemini-3.1-flash-preview": { input: 0.15, output: 0.60 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-6": { input: 15.00, output: 75.00 },
};

const EXECUTIVE_PLANNER_MODEL = "gemini-3.1-flash-lite-preview";
const EXECUTIVE_EXECUTION_MODEL = "gemini-3.1-flash-lite-preview";
const ADVISOR_PLANNER_MODEL = "gemini-3.1-pro-preview";
const ADVISOR_EXECUTION_MODEL = "gemini-3.1-flash-preview";

function hasAdvisorOverride(query: string): boolean {
  return /\b(go deeper|deeper reasoning|think harder|show (?:the )?reasoning|show tradeoffs|pressure test|stress test|advisor mode|use advisor|opusplan)\b/i.test(query);
}

function looksHighStakes(query: string): boolean {
  return /\b(board|investor|fundraise|fundraising|acquisition|m&a|due diligence|legal|compliance|security incident|outage|negotiation)\b/i.test(query);
}

export function buildRoutingGuidance(decision: HarnessRoutingDecision): string {
  if (decision.routingMode === "advisor") {
    return "ADVISOR MODE: plan more explicitly, surface tradeoffs, and prefer stronger cross-checks before synthesis.";
  }
  return "EXECUTIVE MODE: keep the plan lean, fast, and evidence-first unless new ambiguity appears.";
}

export function decideHarnessRouting(args: {
  query: string;
  classification: string;
  entities?: string[];
  userForcedAdvisor?: boolean;
  evidenceConflict?: boolean;
  priorFailure?: boolean;
  highStakes?: boolean;
}): HarnessRoutingDecision {
  const entities = args.entities ?? [];
  const forcedAdvisor = args.userForcedAdvisor ?? hasAdvisorOverride(args.query);
  const highStakes = args.highStakes ?? looksHighStakes(args.query);
  const artifactMode = deriveReportArtifactMode(args.query);

  if (forcedAdvisor) {
    return {
      routingMode: "advisor",
      routingReason: "User explicitly asked for deeper reasoning.",
      routingSource: "user_forced",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (args.priorFailure) {
    return {
      routingMode: "advisor",
      routingReason: "Prior execution failed and needs a deeper retry.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (args.evidenceConflict) {
    return {
      routingMode: "advisor",
      routingReason: "Conflicting evidence requires a stronger planning pass.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (args.classification === "plan_proposal") {
    return {
      routingMode: "advisor",
      routingReason: "Planning requests need deeper upfront reasoning.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (artifactMode === "prep_brief") {
    return {
      routingMode: "advisor",
      routingReason: "Prep briefs need stronger synthesis before the handoff-ready brief is saved.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (args.classification === "multi_entity" && entities.length >= 3) {
    return {
      routingMode: "advisor",
      routingReason: "Multi-entity comparison increases cross-check and synthesis complexity.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  if (highStakes) {
    return {
      routingMode: "advisor",
      routingReason: "High-stakes requests should bias toward deeper verification.",
      routingSource: "automatic",
      plannerModel: ADVISOR_PLANNER_MODEL,
      executionModel: ADVISOR_EXECUTION_MODEL,
      reasoningEffort: "high",
    };
  }

  return {
    routingMode: "executive",
    routingReason: "Routine request fits the fast execution lane.",
    routingSource: "automatic",
    plannerModel: EXECUTIVE_PLANNER_MODEL,
    executionModel: EXECUTIVE_EXECUTION_MODEL,
    reasoningEffort: "medium",
  };
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 0.15, output: 0.60 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

function toRuntimeTraceEvent(event: HarnessTraceEvent): Omit<TraceEvent, "timestamp"> {
  if (event.type === "trace") {
    return {
      type: event.type,
      step: event.step,
      tool: event.tool,
      status: event.status,
      detail: event.detail,
    };
  }

  if (event.type === "step_start") {
    return {
      type: event.type,
      step: "step_start",
      stepId: event.stepId,
      stepIndex: event.stepIndex,
      groupId: event.groupId,
      tool: event.toolName,
      model: event.model,
      status: "ok",
      detail: event.purpose,
      startedAt: event.startedAt,
    };
  }

  return {
    type: event.type,
    step: "step_done",
    stepId: event.stepId,
    stepIndex: event.stepIndex,
    groupId: event.groupId,
    tool: event.toolName,
    model: event.model,
    status: event.success ? "ok" : "error",
    detail: event.error ?? event.preview ?? `${event.toolName} completed`,
    durationMs: event.durationMs,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    costUsd: event.costUsd,
    preview: event.preview,
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    injectedContext: event.injectedContext,
    steeringApplied: event.steeringApplied,
  };
}

// ── Session store ────────────────────────────────────────────────────

const sessions = new Map<string, HarnessSessionState>();
const MAX_SESSIONS = 200;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const COMPACTION_THRESHOLD = 40; // messages before auto-compact

function genSessionId(): string {
  return `hns_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivityAt > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

function evictOldest(): void {
  if (sessions.size < MAX_SESSIONS) return;
  let oldest: HarnessSessionState | null = null;
  for (const s of sessions.values()) {
    if (!oldest || s.lastActivityAt < oldest.lastActivityAt) oldest = s;
  }
  if (oldest) sessions.delete(oldest.id);
}

// ── Permission checks ────────────────────────────────────────────────

function checkPermission(policy: PermissionPolicy, toolName: string): PermissionMode {
  return policy.toolOverrides[toolName] ?? policy.default;
}

// ── Session compaction ───────────────────────────────────────────────

function compactSession(session: HarnessSessionState): CompactionSummary {
  const messages = session.messages;
  if (messages.length < COMPACTION_THRESHOLD) {
    return { removedMessageCount: 0, preservedMessageCount: messages.length, toolsUsed: [], pendingWork: [], keyFiles: [], currentState: "no compaction needed" };
  }

  // Preserve system message + last 10 messages
  const systemMsgs = messages.filter(m => m.role === "system");
  const recentCount = 10;
  const recent = messages.slice(-recentCount);
  const removed = messages.slice(systemMsgs.length, -recentCount);

  // Extract summary from removed messages
  const toolsUsed = [...new Set(removed.filter(m => m.toolName).map(m => m.toolName!))];
  const userRequests = removed.filter(m => m.role === "user").map(m => m.content.slice(0, 100));

  // Scan for pending work indicators
  const pendingWork: string[] = [];
  for (const msg of removed) {
    const lower = msg.content.toLowerCase();
    for (const keyword of ["todo", "next", "pending", "remaining", "should also", "follow up"]) {
      if (lower.includes(keyword)) {
        const sentence = msg.content.split(/[.!?\n]/).find(s => s.toLowerCase().includes(keyword));
        if (sentence) pendingWork.push(sentence.trim().slice(0, 120));
      }
    }
  }

  // Key files referenced
  const filePattern = /(?:[\w/.-]+\.(?:ts|tsx|js|json|md|py|rs))/g;
  const keyFiles = [...new Set(removed.flatMap(m => m.content.match(filePattern) ?? []))].slice(0, 15);

  const currentState = `Processed ${userRequests.length} queries. Tools used: ${toolsUsed.join(", ")}. ${pendingWork.length > 0 ? `Pending: ${pendingWork[0]}` : "No pending work."}`;

  // Build compaction summary message
  const compactionMessage: HarnessMessage = {
    role: "system",
    content: `[Session Compacted] ${removed.length} messages summarized.\n\nUser requests: ${userRequests.join("; ")}\nTools used: ${toolsUsed.join(", ")}\nKey files: ${keyFiles.join(", ")}\n${pendingWork.length > 0 ? `Pending work: ${pendingWork.join("; ")}` : ""}\n\nContinue from where you left off. Do not recap — proceed directly.`,
    timestamp: Date.now(),
    turnIndex: session.turns.length,
  };

  // Replace messages
  session.messages = [...systemMsgs, compactionMessage, ...recent];

  const summary: CompactionSummary = {
    removedMessageCount: removed.length,
    preservedMessageCount: session.messages.length,
    toolsUsed,
    pendingWork: pendingWork.slice(0, 5),
    keyFiles,
    currentState,
  };

  session.compactions.push(summary);
  session.status = "compacted";

  return summary;
}

// ── Harness Runtime ──────────────────────────────────────────────────

export class HarnessRuntime {
  private tools: Map<string, McpTool>;
  private allTools: McpTool[];

  constructor(tools: McpTool[]) {
    this.allTools = tools;
    this.tools = new Map(tools.map(t => [t.name, t]));
  }

  // ── Session lifecycle ────────────────────────────────────────────

  createSession(options: {
    preset?: string;
    lens?: string;
    permissionPolicy?: Partial<PermissionPolicy>;
    entityContext?: Record<string, unknown>;
  } = {}): HarnessSessionState {
    cleanExpiredSessions();
    evictOldest();

    const session: HarnessSessionState = {
      id: genSessionId(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "active",
      preset: options.preset ?? "founder",
      lens: options.lens ?? "founder",
      messages: [{
        role: "system",
        content: `You are NodeBench, an operating intelligence agent for founders. You have access to ${this.allTools.length} tools for research, analysis, verification, and decision support. Current lens: ${options.lens ?? "founder"}.`,
        timestamp: Date.now(),
        turnIndex: 0,
      }],
      turns: [],
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      compactions: [],
      permissionPolicy: {
        default: options.permissionPolicy?.default ?? "allow",
        toolOverrides: options.permissionPolicy?.toolOverrides ?? {},
      },
      entityContext: options.entityContext ?? {},
      adaptationCount: 0,
      pendingSteering: [],
    };

    sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): HarnessSessionState | undefined {
    const s = sessions.get(id);
    if (s) s.lastActivityAt = Date.now();
    return s;
  }

  listSessions(): Array<{
    id: string;
    preset: string;
    lens: string;
    status: string;
    turnCount: number;
    totalCostUsd: number;
    messageCount: number;
    createdAt: number;
    lastActivityAt: number;
  }> {
    return Array.from(sessions.values()).map(s => ({
      id: s.id,
      preset: s.preset,
      lens: s.lens,
      status: s.status,
      turnCount: s.turns.length,
      totalCostUsd: Math.round(s.totalCostUsd * 10000) / 10000,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
    }));
  }

  endSession(id: string): boolean {
    const s = sessions.get(id);
    if (!s) return false;
    s.status = "completed";
    sessions.delete(id);
    return true;
  }

  compactSession(id: string): CompactionSummary | null {
    const s = sessions.get(id);
    if (!s) return null;
    return compactSession(s);
  }

  queueSteering(
    id: string,
    payload: Record<string, unknown> | string,
    source?: string,
  ): SteeringEntry | null {
    const session = sessions.get(id);
    if (!session) return null;

    const entry: SteeringEntry = {
      id: `steer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      payload,
      createdAt: Date.now(),
      source,
    };
    session.pendingSteering.push(entry);
    session.lastActivityAt = Date.now();
    return entry;
  }

  getPendingSteeringCount(id: string): number | null {
    const session = sessions.get(id);
    if (!session) return null;
    return session.pendingSteering.length;
  }

  private consumePendingSteering(session: HarnessSessionState): Record<string, unknown> | string | null {
    const next = session.pendingSteering.shift();
    return next?.payload ?? null;
  }

  getSessionTrace(id: string): TraceEvent[] | null {
    const s = sessions.get(id);
    if (!s) return null;
    return s.turns.flatMap(t =>
      t.stepResults.map(sr => ({
        type: "step_done" as const,
        step: "tool_call",
        tool: sr.toolName,
        status: sr.success ? "ok" as const : "error" as const,
        detail: sr.error ?? `${sr.toolName} completed`,
        durationMs: sr.durationMs,
        stepId: sr.stepId,
        stepIndex: sr.stepIndex,
        groupId: sr.groupId,
        model: sr.model,
        tokensIn: sr.tokensIn,
        tokensOut: sr.tokensOut,
        costUsd: sr.costUsd,
        preview: sr.preview,
        startedAt: sr.startedAt,
        completedAt: sr.completedAt,
        injectedContext: sr.injectedContext,
        steeringApplied: sr.steeringApplied,
        timestamp: t.timestamp,
      }))
    );
  }

  getSessionCost(id: string): { totalUsd: number; perTurn: TurnCost[] } | null {
    const s = sessions.get(id);
    if (!s) return null;
    return {
      totalUsd: s.totalCostUsd,
      perTurn: s.turns.map((t, i) => ({
        turnIndex: i,
        model: "gemini-3.1-flash-lite-preview",
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        costUsd: t.costUsd,
        timestamp: t.timestamp,
      })),
    };
  }

  // ── Main execution loop ──────────────────────────────────────────

  async run(
    sessionId: string,
    query: string,
    options: {
      onTrace?: (event: TraceEvent) => void;
      onPlan?: (plan: HarnessPlan) => void;
      maxAdaptations?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<HarnessRunResult> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === "completed") throw new Error(`Session ${sessionId} is completed`);

    session.lastActivityAt = Date.now();
    const startMs = Date.now();
    const turnIndex = session.turns.length;
    const trace: TraceEvent[] = [];
    const maxAdaptations = options.maxAdaptations ?? 2;
    const timeoutMs = options.timeoutMs ?? 30_000;

    const emitTrace = (event: Omit<TraceEvent, "timestamp">) => {
      const full: TraceEvent = { ...event, timestamp: Date.now() };
      trace.push(full);
      options.onTrace?.(full);
    };

    // Auto-compact if messages are getting long
    if (session.messages.length > COMPACTION_THRESHOLD) {
      emitTrace({ step: "compact_session", status: "ok", detail: `${session.messages.length} messages → compacting` });
      compactSession(session);
    }

    // Add user message to history
    session.messages.push({
      role: "user",
      content: query,
      timestamp: Date.now(),
      turnIndex,
    });

    // ── Step 1: Build callTool (needed for classification, planning, execution, synthesis) ──
    const callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      // Permission check
      const perm = checkPermission(session.permissionPolicy, name);
      if (perm === "deny") {
        emitTrace({ step: "permission_denied", tool: name, status: "error", detail: `Tool ${name} denied by policy` });
        return { error: true, message: `Permission denied for tool: ${name}` };
      }

      const tool = this.tools.get(name);
      if (!tool) {
        return { error: true, message: `Tool not found: ${name}` };
      }

      const toolStart = Date.now();
      try {
        const result = await Promise.race([
          tool.handler(args),
          new Promise((_, reject) => setTimeout(() => reject(new Error("tool_timeout")), Math.min(timeoutMs, 15_000))),
        ]);

        // Estimate cost for this tool call
        const inputEstimate = JSON.stringify(args).length / 4;
        const outputEstimate = JSON.stringify(result).length / 4;
        const callCost = estimateCost("gemini-3.1-flash-lite-preview", inputEstimate, outputEstimate);
        session.totalCostUsd += callCost;

        // Log to session messages
        session.messages.push({
          role: "tool",
          content: JSON.stringify(result).slice(0, 3000),
          toolName: name,
          timestamp: Date.now(),
          turnIndex,
        });

        return result;
      } catch (err: any) {
        emitTrace({ step: "tool_error", tool: name, status: "error", detail: err?.message, durationMs: Date.now() - toolStart });
        return { error: true, message: err?.message ?? "Unknown error" };
      }
    };

    // Check if LLM is available (call_llm tool exists OR GEMINI_API_KEY is set)
    const hasLLM = this.tools.has("call_llm") || !!process.env.GEMINI_API_KEY;

    // ── Step 2: Classify intent + entities ──────────────────────
    emitTrace({ step: "classify_query", status: "ok", detail: query.slice(0, 80) });

    let classification = this.classifyWithRegex(query);

    if (hasLLM) {
      try {
        // Use call_llm via callTool for classification (multi-provider)
        const classifyResult = await callTool("call_llm", {
          prompt: `Classify this query. Return ONLY valid JSON.\n\nQuery: "${query}"\n\nReturn:\n{"type": "weekly_reset" | "pre_delegation" | "important_change" | "company_search" | "competitor" | "multi_entity" | "plan_proposal" | "general", "entities": ["entity1"], "entity": "primary entity or null"}\n\nRules: company_search = mentions a company, multi_entity = compares 2+ companies, competitor = asks about competitors, weekly_reset = weekly summary, important_change = what changed, plan_proposal = planning/strategy, general = everything else. entities = extract all company/product/person names.`,
          maxTokens: 200,
          temperature: 0,
        }) as any;
        const text = classifyResult?.response ?? classifyResult?.text ?? "";
        const jsonMatch = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          classification = {
            type: parsed.type ?? classification.type,
            entities: Array.isArray(parsed.entities) ? parsed.entities : classification.entities,
            entity: parsed.entity ?? classification.entity,
          };
          emitTrace({ step: "classify_result", status: "ok", detail: `LLM: ${classification.type} → [${classification.entities.join(", ")}]` });
        } else {
          emitTrace({ step: "classify_result", status: "ok", detail: `Regex (LLM no JSON): ${classification.type}` });
        }
      } catch {
        emitTrace({ step: "classify_result", status: "ok", detail: `Regex fallback: ${classification.type}` });
      }
    } else {
      emitTrace({ step: "classify_result", status: "ok", detail: `Regex: ${classification.type} → [${classification.entities.join(", ")}]` });
    }

    // Inject session context for follow-up queries ONLY when:
    // 1. Not the first turn
    // 2. Current classification is "general" (no specific intent detected)
    // 3. Current query extracted no entities of its own
    if (turnIndex > 0 && classification.type === "general" && classification.entities.length === 0) {
      const lastTurn = session.turns[turnIndex - 1];
      if (lastTurn?.entities.length > 0) {
        classification.entities = [...lastTurn.entities];
        emitTrace({ step: "context_inject", status: "ok", detail: `Inherited entities: ${classification.entities.join(", ")}` });
      }
    }

    // ── Step 3: Generate plan ───────────────────────────────────
    let recalledMemory: EntityMemoryRecallEntry[] = [];
    const ownerKey = typeof session.entityContext.ownerKey === "string" ? session.entityContext.ownerKey : null;
    if (ownerKey && classification.entities.length > 0) {
      try {
        recalledMemory = await recallEntityMemory({
          ownerKey,
          entityTargets: classification.entities,
          limit: 3,
        });
        emitTrace({
          step: "memory_recall",
          status: "ok",
          detail: recalledMemory.length > 0
            ? `Loaded ${recalledMemory.length} entity memory entr${recalledMemory.length === 1 ? "y" : "ies"}`
            : "No stored entity memory matched",
        });
      } catch (err: any) {
        emitTrace({
          step: "memory_recall",
          status: "error",
          detail: err?.message ?? "Entity memory recall failed",
        });
      }
    } else {
      emitTrace({
        step: "memory_recall",
        status: "skip",
        detail: ownerKey ? "No entities extracted for recall" : "No ownerKey available for scoped recall",
      });
    }

    let plan: HarnessPlan | null = null;
    const routing = decideHarnessRouting({
      query,
      classification: classification.type,
      entities: classification.entities,
    });
    const planningQuery = `${query.trim()}\n\n[${buildRoutingGuidance(routing)}]`;
    emitTrace({
      step: "routing_mode",
      tool: routing.plannerModel,
      status: "ok",
      detail: `${routing.routingMode}: ${routing.routingReason}`,
    });
    if (hasLLM) {
      try {
        emitTrace({ step: "plan_generate", tool: "call_llm", status: "ok" });
        plan = await generatePlan(
          planningQuery,
          classification.type,
          classification.entities,
          session.lens,
          callTool,
          {
            recalledMemory,
          },
        );
        options.onPlan?.(plan);
        emitTrace({ step: "plan_ready", status: "ok", detail: `${plan.steps.length} steps: ${plan.steps.map(s => s.toolName).join(" → ")}` });
      } catch (err: any) {
        emitTrace({ step: "plan_generate", status: "error", detail: err?.message });
      }
    }

    // Fallback: deterministic plan
    if (!plan) {
      plan = await generatePlan(planningQuery, classification.type, classification.entities, session.lens, callTool, {
        recalledMemory,
      });
      emitTrace({ step: "plan_fallback", status: "ok", detail: `Deterministic: ${plan.steps.length} steps` });
      options.onPlan?.(plan);
    }

    // ── Step 4: Execute plan ────────────────────────────────────
    emitTrace({ step: "execute_plan", status: "ok", detail: `Executing ${plan.steps.length} steps` });

    const memorySeedContext = buildMemorySeedContext(recalledMemory);
    const execution = await executeHarness(plan, callTool, (event) => {
      emitTrace(toRuntimeTraceEvent(event));
    }, {
      seedContext: memorySeedContext,
      consumeUserSteering: (step) => {
        const payload = step.acceptsSteering ? this.consumePendingSteering(session) : null;
        if (payload != null) {
          emitTrace({
            step: "steering_dequeued",
            tool: step.toolName,
            status: "ok",
            detail: `${step.id} consumed queued steering`,
          });
        }
        return payload;
      },
    });

    // ── Step 5: Adaptation — re-plan on significant failures ────
    let adaptations = 0;
    const failedSteps = execution.stepResults.filter(s => !s.success);
    if (failedSteps.length > 0 && failedSteps.length >= plan.steps.length / 2 && adaptations < maxAdaptations && hasLLM) {
      adaptations++;
      session.adaptationCount++;
      emitTrace({ step: "adapt_plan", status: "adapting", detail: `${failedSteps.length}/${plan.steps.length} failed — re-planning` });

      const failedTools = failedSteps.map(s => s.toolName);
      const recoveryQuery = `${query} (retry: ${failedTools.join(", ")} failed)`;
      try {
        const recoveryPlan = await generatePlan(recoveryQuery, classification.type, classification.entities, session.lens, callTool, {
          recalledMemory,
        });
        recoveryPlan.steps = recoveryPlan.steps.filter(s => !failedTools.includes(s.toolName));
        if (recoveryPlan.steps.length > 0) {
          const recoveryExec = await executeHarness(recoveryPlan, callTool, (event) => {
            const traceEvent = toRuntimeTraceEvent(event);
            emitTrace({
              ...traceEvent,
              detail: traceEvent.detail ? `[recovery] ${traceEvent.detail}` : "[recovery]",
            });
          }, {
            seedContext: memorySeedContext,
            consumeUserSteering: (step) => {
              const payload = step.acceptsSteering ? this.consumePendingSteering(session) : null;
              if (payload != null) {
                emitTrace({
                  step: "steering_dequeued",
                  tool: step.toolName,
                  status: "ok",
                  detail: `[recovery] ${step.id} consumed queued steering`,
                });
              }
              return payload;
            },
          });
          execution.stepResults.push(...recoveryExec.stepResults);
        }
      } catch {
        emitTrace({ step: "adapt_failed", status: "error", detail: "Recovery plan generation failed" });
      }
    }

    // ── Step 6: Synthesize results ──────────────────────────────
    emitTrace({ step: "synthesize", status: "ok", detail: `${execution.stepResults.filter(s => s.success).length} successful results` });

    // Extract entity name properly — use classification first, then regex from original query
    const entityName = classification.entities[0]
      ?? classification.entity
      ?? this.extractEntity(query)
      ?? query.replace(/^(tell me about|what are the|analyze|research|who are)\s+/i, "").split(/[?.!,]/)[0].trim().slice(0, 50);

    let synthesized: any;
    try {
      synthesized = await synthesizeResults(execution, query, session.lens, callTool);
    } catch {
      synthesized = {
        entityName,
        answer: `Processed ${execution.stepResults.length} steps. ${execution.stepResults.filter(s => s.success).length} succeeded.`,
        confidence: 30,
        signals: [],
        changes: [],
        risks: [],
        comparables: [],
        nextActions: [],
        nextQuestions: [],
        sources: [],
      };
    }

    // Add assistant response to history
    session.messages.push({
      role: "assistant",
      content: typeof synthesized.answer === "string" ? synthesized.answer : JSON.stringify(synthesized).slice(0, 2000),
      timestamp: Date.now(),
      turnIndex,
    });

    // ── Step 6: Record turn ─────────────────────────────────────
    const durationMs = Date.now() - startMs;
    const turnCostEstimate = plan.steps.length * 0.005 + (adaptations * 0.002);
    session.totalCostUsd += turnCostEstimate;

    const turn: TurnRecord = {
      index: turnIndex,
      query,
      classification: classification.type,
      entities: classification.entities,
      routing,
      plan,
      stepResults: execution.stepResults,
      synthesizedResult: synthesized,
      durationMs,
      costUsd: turnCostEstimate,
      adaptations,
      timestamp: Date.now(),
    };
    session.turns.push(turn);

    const skillQualityPassed = shouldExtractSkillTemplate({
      plan,
      stepResults: execution.stepResults,
      synthesizedResult: synthesized,
    });
    if (skillQualityPassed) {
      try {
        const extractedSkill = saveExtractedSkillTemplate({
          source: "harness_runtime",
          sessionId: session.id,
          turnIndex,
          query,
          classification: classification.type,
          lens: session.lens,
          entities: classification.entities,
          plan,
          stepResults: execution.stepResults,
          synthesizedResult: synthesized,
        });
        emitTrace({
          step: "skill_extract",
          status: "ok",
          detail: `Extracted reusable skill ${extractedSkill.signature}`,
        });
      } catch (err: any) {
        emitTrace({
          step: "skill_extract",
          status: "error",
          detail: err?.message ?? "Skill extraction failed",
        });
      }
    } else {
      emitTrace({
        step: "skill_extract",
        status: "skip",
        detail: "Skipped skill extraction because the run did not meet the quality gate",
      });
    }

    try {
      const distillationRecord = saveHarnessTraceDistillation({
        source: "harness_runtime",
        sessionId: session.id,
        turnIndex,
        query,
        classification: classification.type,
        lens: session.lens,
        entities: classification.entities,
        plan,
        stepResults: execution.stepResults,
        synthesizedResult: synthesized,
      });
      emitTrace({
        step: "distill_export",
        status: "ok",
        detail: `Exported trace distillation ${distillationRecord.distillationId}`,
      });
    } catch (err: any) {
      emitTrace({
        step: "distill_export",
        status: "error",
        detail: err?.message ?? "Trace distillation export failed",
      });
    }

    emitTrace({ step: "turn_complete", status: "ok", detail: `${durationMs}ms, $${turnCostEstimate.toFixed(4)}, ${adaptations} adaptations`, durationMs });

    return {
      sessionId: session.id,
      turnIndex,
      result: synthesized,
      trace,
      durationMs,
      costUsd: turnCostEstimate,
      classification: classification.type,
      entities: classification.entities,
      routing,
      planSteps: plan.steps.length,
      adaptations,
      sessionTotalCostUsd: session.totalCostUsd,
    };
  }

  // ── LLM classifier ─────────────────────────────────────────────

  // ── Deterministic regex classifier (no API key needed) ──────

  private classifyWithRegex(query: string): { type: string; entities: string[]; entity?: string } {
    const q = query.toLowerCase().trim();

    // Weekly reset / briefing
    if (/\b(weekly|week|briefing|reset|what happened|status update|catch me up)\b/.test(q)) {
      return { type: "weekly_reset", entities: [] };
    }

    // Important change
    if (/\b(what changed|what's new|what is new|since last|recent changes|updates?)\b/.test(q) && !/\bplan\b/.test(q)) {
      return { type: "important_change", entities: [] };
    }

    // Pre-delegation
    if (/\b(delegate|handoff|hand off|assign|outsource)\b/.test(q)) {
      return { type: "pre_delegation", entities: [] };
    }

    // Plan proposal — requires explicit planning words, not just "how should"
    if (/\b(plan\s+(?:a|for|to|my)|propose|roadmap|go.to.market|gtm|build\s+(?:a|me)|create\s+(?:a|me)|design\s+(?:a|me))\b/.test(q) && !/\b(tell|about|who|what is)\b/.test(q)) {
      return { type: "plan_proposal", entities: [] };
    }
    if (/\bstrategy\s+for\b/.test(q)) {
      return { type: "plan_proposal", entities: [] };
    }

    // Multi-entity comparison
    const vsMatch = q.match(/(.+?)\s+(?:vs\.?|versus|compared?\s+to|against)\s+(.+)/i);
    if (vsMatch) {
      const entities = [vsMatch[1].trim(), vsMatch[2].trim()]
        .map(e => e.replace(/\b(compare|tell\s+me\s+about|in|the|of|for|and)\b/gi, "").trim())
        .filter(e => e.length > 1);
      if (entities.length >= 2) {
        return { type: "multi_entity", entities, entity: entities[0] };
      }
    }

    // Competitor analysis
    if (/\b(competitors?|competing|rivals?|alternatives?|compete with)\b/.test(q)) {
      // Try "X competitors" or "competitors of X" patterns
      const compOfMatch = query.match(/(?:competitors?\s+(?:of|for|to)\s+)([A-Z][A-Za-z\s]+?)(?:\s*[?.!]|$)/i);
      const whoAreMatch = query.match(/(?:who\s+are\s+)([A-Z][A-Za-z\s]+?)(?:'s?\s+)?(?:competitors?|rivals?)/i);
      const entity = compOfMatch?.[1]?.trim() ?? whoAreMatch?.[1]?.trim() ?? this.extractEntity(query);
      return { type: "competitor", entities: entity ? [entity] : [], entity };
    }

    // Company search — detect capitalized proper nouns as entity names
    const entity = this.extractEntity(q);
    if (entity && /\b(tell|about|analyze|research|look up|what is|who is|show me|investigate)\b/.test(q)) {
      return { type: "company_search", entities: [entity], entity };
    }
    if (entity && entity.length > 2) {
      return { type: "company_search", entities: [entity], entity };
    }

    return { type: "general", entities: [] };
  }

  private extractEntity(query: string): string | undefined {
    // Match capitalized multi-word names (e.g., "Stripe", "Open AI", "Goldman Sachs")
    const capMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
    if (capMatch && !["Tell", "What", "How", "Who", "Why", "Where", "When", "Show", "Plan", "Compare", "Analyze"].includes(capMatch[1])) {
      return capMatch[1];
    }

    // Match quoted entities
    const quotedMatch = query.match(/"([^"]+)"|'([^']+)'/);
    if (quotedMatch) return quotedMatch[1] ?? quotedMatch[2];

    // Match "about X" pattern
    const aboutMatch = query.match(/\babout\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+(?:company|payments|strategy|revenue|funding|market|risks?|competitors?|products?)|[.?!]|$)/i);
    if (aboutMatch) return aboutMatch[1].trim();

    return undefined;
  }

  // classifyWithLLM removed — classification now uses callTool("call_llm", ...) in the run() method

  // ── Deterministic fallback plan ────────────────────────────────

  private buildFallbackPlan(query: string, type: string, entities: string[], lens: string): HarnessPlan {
    const entity = entities[0]
      ?? this.extractEntity(query)
      ?? query.replace(/^(tell me about|what are the|analyze|research|who are|compare)\s+/i, "").split(/[?.!,]/)[0].trim().slice(0, 50);
    const year = new Date().getFullYear();

    const plans: Record<string, () => HarnessPlan> = {
      weekly_reset: () => ({
        objective: "Generate founder weekly reset",
        classification: type, entityTargets: entities,
        steps: [{ id: "s1", toolName: "founder_local_weekly_reset", args: { daysBack: 7 }, purpose: "Weekly reset packet" }],
        synthesisPrompt: "Format as weekly founder reset with changes, contradictions, and next 3 moves.",
      }),
      company_search: () => ({
        objective: `Analyze ${entity}`,
        classification: type, entityTargets: entities,
        steps: [
          { id: "s1", toolName: "web_search", args: { query: `${entity} company overview strategy ${year}`, maxResults: 5 }, purpose: "Web intelligence", parallel: true },
          { id: "s2", toolName: "run_recon", args: { target: entity, focus: query }, purpose: "Deep recon", parallel: true },
          { id: "s3", toolName: "founder_local_gather", args: { daysBack: 7 }, purpose: "Local context", parallel: true },
        ],
        synthesisPrompt: `Synthesize intelligence about ${entity} for a ${lens} audience.`,
      }),
      multi_entity: () => {
        const steps = entities.slice(0, 4).map((e, i) => ({
          id: `s${i + 1}`, toolName: "web_search",
          args: { query: `${e} company overview ${year}`, maxResults: 3 },
          purpose: `Research ${e}`, parallel: true,
        }));
        return {
          objective: `Compare ${entities.join(" vs ")}`,
          classification: type, entityTargets: entities, steps,
          synthesisPrompt: `Compare ${entities.join(", ")} across key dimensions for a ${lens} audience.`,
        };
      },
    };

    const planFn = plans[type];
    if (planFn) return planFn();

    // Default
    return {
      objective: query,
      classification: type, entityTargets: entities,
      steps: [
        { id: "s1", toolName: "founder_local_gather", args: { daysBack: 7 }, purpose: "Gather context", parallel: true },
        { id: "s2", toolName: "web_search", args: { query: `${query} ${year}`, maxResults: 3 }, purpose: "Web research", parallel: true },
      ],
      synthesisPrompt: `Answer "${query}" using gathered intelligence for a ${lens} audience.`,
    };
  }

  // ── Slash commands ─────────────────────────────────────────────

  getSlashCommands(): Array<{ name: string; description: string; hint?: string }> {
    return [
      { name: "/status", description: "Show session status (turns, cost, messages)" },
      { name: "/cost", description: "Show cost breakdown per turn" },
      { name: "/compact", description: "Compact session context to free space" },
      { name: "/trace", description: "Show execution trace for last turn" },
      { name: "/tools", description: "List available tools", hint: "[search term]" },
      { name: "/permissions", description: "Show/modify tool permission policy" },
      { name: "/sessions", description: "List all active sessions" },
      { name: "/help", description: "Show available commands" },
    ];
  }

  async handleSlashCommand(sessionId: string, command: string): Promise<{ text: string; data?: unknown }> {
    const session = sessions.get(sessionId);
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case "/status":
        if (!session) return { text: "No active session." };
        return {
          text: `Session ${session.id}\nTurns: ${session.turns.length}\nMessages: ${session.messages.length}\nCost: $${session.totalCostUsd.toFixed(4)}\nStatus: ${session.status}\nCompactions: ${session.compactions.length}`,
          data: { id: session.id, turns: session.turns.length, messages: session.messages.length, cost: session.totalCostUsd, status: session.status },
        };

      case "/cost":
        if (!session) return { text: "No active session." };
        const costs = session.turns.map((t, i) => `Turn ${i}: $${t.costUsd.toFixed(4)} (${t.durationMs}ms, ${t.stepResults.length} steps)`);
        return {
          text: `Total: $${session.totalCostUsd.toFixed(4)}\n${costs.join("\n")}`,
          data: this.getSessionCost(sessionId),
        };

      case "/compact":
        if (!session) return { text: "No active session." };
        const summary = compactSession(session);
        return {
          text: `Compacted: removed ${summary.removedMessageCount} messages, ${summary.preservedMessageCount} preserved.\nTools used: ${summary.toolsUsed.join(", ")}\nPending: ${summary.pendingWork.join("; ") || "none"}`,
          data: summary,
        };

      case "/trace": {
        if (!session) return { text: "No active session." };
        const lastTurn = session.turns[session.turns.length - 1];
        if (!lastTurn) return { text: "No turns executed yet." };
        const steps = lastTurn.stepResults.map(s => `${s.success ? "✓" : "✗"} ${s.toolName} (${s.durationMs}ms)`);
        return {
          text: `Turn ${lastTurn.index}: ${lastTurn.classification}\nSteps:\n${steps.join("\n")}`,
          data: lastTurn,
        };
      }

      case "/tools": {
        const search = parts.slice(1).join(" ").toLowerCase();
        const matched = this.allTools
          .filter(t => !search || t.name.toLowerCase().includes(search) || t.description.toLowerCase().includes(search))
          .slice(0, 20);
        return {
          text: `${matched.length} tools${search ? ` matching "${search}"` : ""}:\n${matched.map(t => `• ${t.name}: ${t.description.slice(0, 60)}`).join("\n")}`,
          data: matched.map(t => ({ name: t.name, description: t.description.slice(0, 100) })),
        };
      }

      case "/permissions":
        if (!session) return { text: "No active session." };
        return {
          text: `Default: ${session.permissionPolicy.default}\nOverrides: ${JSON.stringify(session.permissionPolicy.toolOverrides)}`,
          data: session.permissionPolicy,
        };

      case "/sessions":
        return {
          text: this.listSessions().map(s => `${s.id} (${s.preset}/${s.lens}) — ${s.turnCount} turns, $${s.totalCostUsd.toFixed(4)}`).join("\n") || "No active sessions.",
          data: this.listSessions(),
        };

      case "/help":
        return {
          text: this.getSlashCommands().map(c => `${c.name}${c.hint ? " " + c.hint : ""} — ${c.description}`).join("\n"),
        };

      default:
        return { text: `Unknown command: ${cmd}. Type /help for available commands.` };
    }
  }

  // ── Health & metrics ───────────────────────────────────────────

  getHealth(): {
    activeSessions: number;
    totalTools: number;
    uptimeMs: number;
    memoryMb: number;
  } {
    return {
      activeSessions: sessions.size,
      totalTools: this.allTools.length,
      uptimeMs: Date.now() - (sessions.size > 0 ? Math.min(...Array.from(sessions.values()).map(s => s.createdAt)) : Date.now()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }
}
