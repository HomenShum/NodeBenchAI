/**
 * Ultra-Long Chat Orchestrator
 *
 * Coordinates the full turn:
 *   1. Record turn + check compression budget
 *   2. Classify angles from prompt
 *   3. JIT-hydrate active angles (evict stale)
 *   4. Build compacted working set (summary + priority ledger + angle capsules + hot window)
 *   5. Compress evidence if over threshold
 *   6. Save checkpoint
 *   7. Route to advisor/executor model lanes
 *
 * Pattern: Compaction FIRST, JIT retrieval SECOND, model overflow THIRD.
 *
 * MODEL ROUTING (per user rules):
 *   - Kimi K2.6 → advisor/orchestrator lane
 *   - Gemini 3.x (3.1 Pro / 3 Flash / 3.1 Flash-Lite) → preferred executor lanes
 *   - GPT-5.4 mini / MiniMax M2.7 → secondary executor lanes
 *   - Gemini 3.1 Pro / GPT-5.4 → background heavy lane (long context)
 */

import { v } from "convex/values";
import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ════════════════════════════════════════════════════════════════════
// ANGLE CLASSIFIER (deterministic keyword-based, mirrors shared compaction)
// ════════════════════════════════════════════════════════════════════

const ANGLE_KEYWORDS: Record<string, string[]> = {
  entity_profile: ["company", "profile", "overview", "what is", "background"],
  public_signals: ["recent", "latest", "today", "news", "pulse"],
  funding_intelligence: ["funding", "raised", "round", "valuation", "investor", "series"],
  financial_health: ["revenue", "financial", "profit", "burn", "runway"],
  narrative_tracking: ["narrative", "story", "positioning", "pivot"],
  document_discovery: ["document", "pdf", "memo", "report", "filing"],
  competitive_intelligence: ["compare", "versus", "vs", "competitor"],
  people_graph: ["founder", "ceo", "team", "hiring manager"],
  market_dynamics: ["market", "industry", "category", "trend"],
  regulatory_monitoring: ["regulation", "sec", "fda", "compliance"],
  executive_brief: ["brief", "summary", "executive"],
  daily_brief: ["daily brief", "today", "digest"],
  deep_research: ["deep research", "deep dive"],
};

function classifyAngles(prompt: string, maxAngles = 4): string[] {
  const lower = prompt.toLowerCase();
  const matches: Array<{ angleId: string; score: number }> = [];

  for (const [angleId, keywords] of Object.entries(ANGLE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += kw.length; // favor longer phrases
    }
    if (score > 0) matches.push({ angleId, score });
  }

  matches.sort((a, b) => b.score - a.score);
  const active = matches.slice(0, maxAngles).map((m) => m.angleId);
  if (active.length === 0) active.push("entity_profile"); // always default
  return active;
}

// ════════════════════════════════════════════════════════════════════
// EVIDENCE COMPRESSION (deterministic ladder)
// Level 0: no compression, full detail
// Level 1: summarize per-source (keep top 3 per source)
// Level 2: single paragraph per source
// Level 3: single-line per source
// ════════════════════════════════════════════════════════════════════

function compressEvidenceSummary(
  currentSummary: string,
  newLevel: 0 | 1 | 2 | 3,
): string {
  if (newLevel === 0) return currentSummary;

  const lines = currentSummary.split("\n").filter(Boolean);
  if (newLevel === 1) {
    // Keep top 3 lines per paragraph
    const paragraphs = currentSummary.split(/\n\n+/);
    return paragraphs
      .map((p) => p.split("\n").slice(0, 3).join("\n"))
      .join("\n\n");
  }
  if (newLevel === 2) {
    // Single paragraph per source (first line)
    const paragraphs = currentSummary.split(/\n\n+/);
    return paragraphs.map((p) => p.split("\n")[0]).join("\n\n").slice(0, 2000);
  }
  // Level 3: single line per source, max 800 chars total
  const first = lines.slice(0, 8).join("; ");
  return first.slice(0, 800);
}

// ════════════════════════════════════════════════════════════════════
// WORKING SET BUILDER (prompt assembly)
// ════════════════════════════════════════════════════════════════════

interface WorkingSet {
  summary: string;
  priorityLedger: string[];
  activeAngles: string[];
  angleCapsules: Array<{ angleId: string; summary: string; sourceLabels: string[] }>;
  hotWindow: Array<{ role: string; content: string }>;
  compressionLevel: number;
  tokenEstimate: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough 4 chars per token
}

function buildWorkingSetMarkdown(ws: WorkingSet): string {
  const sections: string[] = [];

  sections.push("## Session Working Set");
  sections.push(`**Compression Level:** ${ws.compressionLevel}`);
  sections.push(`**Token Estimate:** ~${ws.tokenEstimate}`);
  sections.push("");

  if (ws.summary) {
    sections.push("### Rolling Evidence Summary");
    sections.push(ws.summary);
    sections.push("");
  }

  if (ws.priorityLedger.length > 0) {
    sections.push("### What Matters To Me");
    sections.push(ws.priorityLedger.map((p) => `- ${p}`).join("\n"));
    sections.push("");
  }

  if (ws.angleCapsules.length > 0) {
    sections.push("### Active Angle Capsules");
    for (const capsule of ws.angleCapsules) {
      sections.push(`**${capsule.angleId}** — from [${capsule.sourceLabels.join(", ")}]`);
      sections.push(capsule.summary);
      sections.push("");
    }
  }

  if (ws.hotWindow.length > 0) {
    sections.push("### Recent Conversation (Hot Window)");
    for (const turn of ws.hotWindow) {
      sections.push(`**${turn.role.toUpperCase()}:** ${turn.content.slice(0, 400)}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

// ════════════════════════════════════════════════════════════════════
// ORCHESTRATOR ACTION
// ════════════════════════════════════════════════════════════════════

export const runTurn = internalAction({
  args: {
    sessionId: v.id("researchSessions"),
    ownerKey: v.string(),
    userId: v.string(),
    prompt: v.string(),
    entitySlug: v.optional(v.string()),
    hotWindow: v.optional(v.array(v.object({
      role: v.string(),
      content: v.string(),
    }))),
    estimatedPromptTokens: v.optional(v.number()),
  },
  returns: v.object({
    turnNumber: v.number(),
    activeAngles: v.array(v.string()),
    hydratedItems: v.number(),
    compressionLevel: v.number(),
    checkpointId: v.string(),
    workingSetMarkdown: v.string(),
    tokenEstimate: v.number(),
    advisorModel: v.string(),
    executorModels: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<any> => {
    // 1) Record turn, check compression budget
    const estimatedTokens = args.estimatedPromptTokens ?? estimateTokens(args.prompt);
    const turnInfo: any = await ctx.runMutation(
      internal.domains.research.researchSessionLifecycle.recordTurn,
      { sessionId: args.sessionId, tokensConsumed: estimatedTokens },
    );

    // 2) Classify angles
    const activeAngles = classifyAngles(args.prompt);

    // 3) Evict stale angles (10 min threshold)
    await ctx.runMutation(
      internal.domains.research.researchSessionLifecycle.evictStaleAngles,
      { sessionId: args.sessionId, staleThresholdMs: 10 * 60 * 1000 },
    );

    // 4) JIT-hydrate active angles
    const hydration: any = await ctx.runAction(
      internal.domains.research.researchSessionJit.hydrateAnglesForSession,
      {
        sessionId: args.sessionId,
        ownerKey: args.ownerKey,
        userId: args.userId,
        angleIds: activeAngles,
        entitySlug: args.entitySlug,
        daysBack: 30,
      },
    );

    // 5) Load session, get relevant memory (durable priorities)
    const session: any = await ctx.runQuery(
      internal.domains.research.researchSessionLifecycle.getSession as any,
      { sessionId: args.sessionId },
    );
    const relevantMemory: any = await ctx.runQuery(
      internal.domains.research.researchSessionLifecycle.getRelevantMemory as any,
      {
        userId: args.userId,
        entity: args.entitySlug,
        topic: session?.topic,
        limit: 8,
      },
    );

    // 6) Compress evidence if needed
    let compressionLevel: 0 | 1 | 2 | 3 = (session?.compressionLevel ?? 0) as 0 | 1 | 2 | 3;
    if (turnInfo.shouldCompress) {
      const newLevel = turnInfo.suggestedLevel as 0 | 1 | 2 | 3;
      const compressed = compressEvidenceSummary(session?.evidenceSummary ?? "", newLevel);
      await ctx.runMutation(
        internal.domains.research.researchSessionLifecycle.compressEvidence,
        {
          sessionId: args.sessionId,
          compressedSummary: compressed,
          newLevel,
        },
      );
      compressionLevel = newLevel;
    }

    // 7) Build working set
    const priorityLedger = (relevantMemory ?? [])
      .slice(0, 6)
      .map((m: any) => `${m.claim} (confidence: ${m.confidence.toFixed(2)})`);

    const angleCapsules = hydration.hydratedAngles.map((a: any) => ({
      angleId: a.angleId,
      summary: a.summary,
      sourceLabels: [`${a.sourceCount} sources`],
    }));

    const hotWindow = (args.hotWindow ?? []).slice(-10);
    const workingSet: WorkingSet = {
      summary: session?.evidenceSummary ?? "",
      priorityLedger,
      activeAngles,
      angleCapsules,
      hotWindow,
      compressionLevel,
      tokenEstimate: 0,
    };
    const workingSetMarkdown = buildWorkingSetMarkdown(workingSet);
    workingSet.tokenEstimate = estimateTokens(workingSetMarkdown);

    // 8) Save checkpoint (LangGraph style)
    const checkpointId: any = await ctx.runMutation(
      internal.domains.research.researchSessionLifecycle.saveCheckpoint,
      {
        sessionId: args.sessionId,
        threadId: `thread_${args.sessionId}`,
        turnNumber: turnInfo.turnNumber,
        checkpointNs: "orchestrator",
        state: {
          prompt: args.prompt,
          activeAngles,
          hydratedAngles: hydration.hydratedAngles,
          workingSet,
          compressionLevel,
        },
        nextNodes: ["advisor_plan", "executor_respond"],
      },
    );

    // 9) Model routing policy
    const advisorModel = "kimi-k2.6";
    const executorModels = selectExecutorModels(workingSet.tokenEstimate);

    return {
      turnNumber: turnInfo.turnNumber,
      activeAngles,
      hydratedItems: hydration.totalItems,
      compressionLevel,
      checkpointId: String(checkpointId),
      workingSetMarkdown,
      tokenEstimate: workingSet.tokenEstimate,
      advisorModel,
      executorModels,
    };
  },
});

// ════════════════════════════════════════════════════════════════════
// EXECUTOR MODEL SELECTION
// Based on prompt size, pick appropriate Gemini 3+ executor
// ════════════════════════════════════════════════════════════════════

function selectExecutorModels(tokenEstimate: number): string[] {
  // Primary: Gemini 3.x lanes based on size
  if (tokenEstimate > 220_000) {
    // Heavy context - Gemini 3.1 Pro (1M context) or GPT-5.4 (1.05M)
    return ["gemini-3.1-pro-preview", "gpt-5.4", "gemini-2.5-pro"];
  }
  if (tokenEstimate > 120_000) {
    // Medium context - Gemini 3 Flash (1M) or Kimi K2.6 (262K)
    return ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "kimi-k2.6"];
  }
  if (tokenEstimate > 40_000) {
    // Normal context - Gemini 3 Flash or Flash-Lite, or MiniMax M2.7
    return ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "minimax-m2.7"];
  }
  // Small context - fastest/cheapest executor
  return ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gpt-5.4-mini"];
}

// ════════════════════════════════════════════════════════════════════
// MEMORY CAPTURE: after a turn, extract durable priorities
// ════════════════════════════════════════════════════════════════════

export const captureTurnMemory = internalAction({
  args: {
    sessionId: v.id("researchSessions"),
    userId: v.string(),
    userPrompt: v.string(),
    assistantResponse: v.string(),
    topic: v.string(),
    entity: v.optional(v.string()),
  },
  returns: v.object({
    memoriesRecorded: v.number(),
  }),
  handler: async (ctx, args): Promise<any> => {
    // Extract durable priorities from user prompt using simple heuristics
    const priorities = extractDurablePriorities(args.userPrompt);
    let memoriesRecorded = 0;

    for (const claim of priorities) {
      await ctx.runMutation(
        internal.domains.research.researchSessionLifecycle.recordMemory,
        {
          userId: args.userId,
          sessionId: String(args.sessionId),
          claim,
          confidence: 0.8,
          entity: args.entity,
          topic: args.topic,
          tags: ["priority", "user_stated"],
        },
      );
      memoriesRecorded++;
    }

    // Append evidence delta
    const evidenceDelta = `[Turn ${Date.now()}] ${args.userPrompt.slice(0, 200)} → ${args.assistantResponse.slice(0, 200)}`;
    await ctx.runMutation(
      internal.domains.research.researchSessionLifecycle.appendEvidence,
      {
        sessionId: args.sessionId,
        detailRef: `turn:${Date.now()}`,
        summaryDelta: evidenceDelta,
      },
    );

    return { memoriesRecorded };
  },
});

function extractDurablePriorities(prompt: string): string[] {
  const sentences = prompt.split(/(?<=[.!?])\s+/g).map((s) => s.trim()).filter(Boolean);
  const priorities: string[] = [];

  for (const sentence of sentences) {
    if (/\b(i need|i want|i care|i'm trying|important|priority|interview|offer|negotiate|help me|remind me|remember)\b/i.test(sentence)) {
      priorities.push(sentence.slice(0, 200));
    }
  }

  return priorities.slice(0, 3);
}
