"use node";

/**
 * Canonical Planner — Fast / Slow / Pulse orchestration using OpenRouter
 *
 * Single entrypoint for agent runtime. On-the-go users get immediate answers
 * from cached state. Deep work continues in the background.
 *
 * Fast lane: 1 ReAct loop, ≤3 tool calls, ≤15s budget, reads from cache first.
 * Slow lane: planner fan-out → scratchpad → structuring → projections.
 * Pulse: scheduled slow run writing into a pulse page.
 */

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { injectLessonsForThread } from "./lessons/lessonInjection";
import { toAnonymousProductOwnerKey } from "../product/helpers";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunMode = "fast" | "slow" | "pulse" | "background";

export interface PlannerResult {
  mode: RunMode;
  runId?: string;
  answer?: string;
  modelId?: string;
  latencyMs: number;
  fromCache: boolean;
}

// ─── Intent Classification Prompt ───────────────────────────────────────────

const INTENT_CLASSIFIER_SYSTEM = `You are the NodeBench intent classifier.
Given a user message, classify the required runtime mode:

- "fast" → simple lookup, retrieval, or question that can be answered from existing cached state. Examples: "what's the latest on Acme?", "remind me what I noted", "any news?"
- "slow" → deep research, synthesis, multi-source analysis, or request to update the entity notebook. Examples: "run full diligence", "compare competitors", "update funding section"
- "pulse" → only used by cron triggers, never user-initiated

Respond with ONLY one word: fast or slow.`;

// ─── Fast Lane Prompt ───────────────────────────────────────────────────────

const FAST_LANE_SYSTEM = `You are NodeBench Fast Lane — a concise research assistant.
Answer from the provided cached context. If the context is insufficient, say so briefly and suggest a deep run.
Rules:
- Be direct and specific. No fluff.
- Cite sources when possible.
- If data is stale, mention it.
- Keep answers under 150 words for on-the-go readability.`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateThreadId(): string {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatCacheForPrompt(cache: any): string {
  if (!cache) return "No cached data available.";
  const parts: string[] = [];

  parts.push(`Entity: ${cache.entity.name} (${cache.entity.entityType})`);
  parts.push(`Summary: ${cache.entity.summary}`);

  if (cache.memory) {
    parts.push(`\n--- Entity Memory ---\n${cache.memory.indexJson}`);
  }

  if (cache.acceptedBlocks?.length) {
    parts.push(`\n--- Notebook Content ---`);
    for (const block of cache.acceptedBlocks.slice(0, 20)) {
      parts.push(`[${block.authorKind}] ${block.text}`);
    }
  }

  if (cache.latestProjections?.length) {
    parts.push(`\n--- Latest Projections ---`);
    for (const proj of cache.latestProjections.slice(0, 10)) {
      parts.push(
        `- [${proj.blockType}] ${proj.title}: ${proj.summary ?? ""} (confidence: ${proj.overallTier})`,
      );
    }
  }

  if (cache.latestPulse) {
    parts.push(`\n--- Latest Pulse (${cache.latestPulse.dateKey}) ---`);
    parts.push(`Status: ${cache.latestPulse.status}`);
    if (cache.latestPulse.summaryMarkdown) {
      parts.push(cache.latestPulse.summaryMarkdown.slice(0, 400));
    }
  }

  return parts.join("\n");
}

// ─── Action: Plan and execute fast lane ─────────────────────────────────────

export const planAndRunFast = internalAction({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    threadId: v.optional(v.string()),
    userMessage: v.string(),
    forceMode: v.optional(v.union(v.literal("fast"), v.literal("slow"))),
  },
  returns: v.object({
    mode: v.string(),
    runId: v.optional(v.string()),
    answer: v.optional(v.string()),
    modelId: v.optional(v.string()),
    latencyMs: v.number(),
    fromCache: v.boolean(),
  }),
  handler: async (ctx, args): Promise<PlannerResult> => {
    const startTime = Date.now();
    const threadId = args.threadId ?? generateThreadId();

    // 1. Fetch cached entity state
    const cache = await ctx.runQuery(
      internal.domains.agents.canonicalRuntimeQueries.getEntityFastLaneCache,
      { ownerKey: args.ownerKey, entitySlug: args.entitySlug },
    );

    // 2. Classify intent (unless forced)
    let mode: RunMode = "fast";
    if (args.forceMode) {
      mode = args.forceMode;
    } else {
      // FU-3: inject relevant lessons into system prompt (best-effort).
      const intentSystemPrompt = await injectLessonsForThread(
        ctx,
        threadId,
        INTENT_CLASSIFIER_SYSTEM,
        { turnId: startTime },
      );
      const classification = await ctx.runAction(
        internal.domains.models.modelRouter.route,
        {
          taskCategory: "agent_loop",
          tier: "free",
          systemPrompt: intentSystemPrompt,
          messages: [{ role: "user" as const, content: args.userMessage }],
          maxTokens: 10,
          temperature: 0,
          cacheKey: `intent:${args.userMessage.slice(0, 80)}`,
          // B-PR8: thread + monotonic turn id so failover lessons land in
          // the right thread and prefer-id queries find this turn.
          threadId,
          turnId: startTime,
        },
      );
      const raw = classification.text.trim().toLowerCase();
      mode = raw.includes("slow") ? "slow" : "fast";
    }

    // 3. FAST LANE — answer from cache immediately
    if (mode === "fast") {
      const contextText = formatCacheForPrompt(cache);
      // FU-3: inject relevant lessons into system prompt (best-effort).
      const fastSystemPrompt = await injectLessonsForThread(
        ctx,
        threadId,
        FAST_LANE_SYSTEM,
        { turnId: startTime + 1 },
      );
      const result = await ctx.runAction(
        internal.domains.models.modelRouter.route,
        {
          taskCategory: "synthesis",
          tier: "cheap",
          systemPrompt: fastSystemPrompt,
          messages: [
            {
              role: "user" as const,
              content: `Context:\n${contextText}\n\nUser question: ${args.userMessage}`,
            },
          ],
          maxTokens: 512,
          temperature: 0.3,
          // B-PR8: scope failover lessons to this thread + turn.
          threadId,
          turnId: startTime + 1,
        },
      );

      // Log the fast interaction as a message (fire-and-forget)
      await ctx
        .runMutation(
          internal.domains.agents.canonicalRuntimeMutations.insertAgentMessage,
          {
            ownerKey: args.ownerKey,
            threadId,
            role: "assistant",
            content: result.text,
            surfaceOrigin: "drawer",
            model: result.modelId,
            tokensUsed: result.inputTokens + result.outputTokens,
            elapsedMs: Date.now() - startTime,
            createdAt: Date.now(),
          },
        )
        .catch(() => {});

      return {
        mode: "fast",
        answer: result.text,
        modelId: result.modelId,
        latencyMs: Date.now() - startTime,
        fromCache: result.fromCache,
      };
    }

    // 4. SLOW LANE — create run, return immediately so client can subscribe
    const runId = await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.createRunRecord,
      {
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        goal: args.userMessage,
        status: "queued",
        currentCheckpoint: 0,
        totalCheckpoints: 3,
        thinkingBudgetTokens: 4000,
        thinkingTokensUsed: 0,
        modelName: "openrouter/glm-4.7",
        startedAt: startTime,
        lastActivityAt: startTime,
      },
    );

    // Insert placeholder message in thread
    await ctx
      .runMutation(
        internal.domains.agents.canonicalRuntimeMutations.insertAgentMessage,
        {
          ownerKey: args.ownerKey,
          threadId,
          role: "assistant",
          content: `Running deep analysis for ${args.entitySlug}...`,
          surfaceOrigin: "drawer",
          createdAt: Date.now(),
        },
      )
      .catch(() => {});

    // Kick off slow orchestration asynchronously (fire-and-forget)
    ctx
      .runAction(internal.domains.agents.canonicalPlanner.runSlowOrchestrator, {
        runId,
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        threadId,
        userMessage: args.userMessage,
      })
      .catch(() => {});

    return {
      mode: "slow",
      runId,
      latencyMs: Date.now() - startTime,
      fromCache: false,
    };
  },
});

// ─── Action: Slow orchestrator ──────────────────────────────────────────────

export const runSlowOrchestrator = internalAction({
  args: {
    runId: v.id("extendedThinkingRuns"),
    ownerKey: v.string(),
    entitySlug: v.string(),
    threadId: v.string(),
    userMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Update run status → running
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.updateRunStatus,
      {
        runId: args.runId,
        status: "running",
        lastActivityAt: Date.now(),
      },
    );

    // Create scratchpad (linked by agentThreadId = our threadId)
    const scratchpadId = await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.createScratchpad,
      {
        agentThreadId: args.threadId,
        userId: "", // Will be resolved server-side or left empty for now
        scratchpad: { markdown: `## Slow Run: ${args.userMessage}\n\n` },
        createdAt: startTime,
        updatedAt: startTime,
        entitySlug: args.entitySlug,
        status: "streaming",
        mode: "live",
      },
    );

    // Insert first checkpoint
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.insertCheckpoint,
      {
        runId: args.runId,
        index: 0,
        status: "scored",
        promptHash: "plan",
        modelName: "openrouter/glm-4.7",
        headline: "Plan execution",
        latencyMs: 0,
        judgedAt: Date.now(),
      },
    );

    // Fetch cache
    const cache = await ctx.runQuery(
      internal.domains.agents.canonicalRuntimeQueries.getEntityFastLaneCache,
      { ownerKey: args.ownerKey, entitySlug: args.entitySlug },
    );

    const contextText = formatCacheForPrompt(cache);

    // FU-3: inject relevant lessons into system prompt (best-effort).
    const slowSystemPrompt = await injectLessonsForThread(
      ctx,
      args.threadId,
      `You are NodeBench Slow Lane — deep research synthesis.
Analyze the provided context and produce structured sections.
Each section must have a title, summary, and body.
Mark confidence: verified | corroborated | single-source | unverified.`,
      { turnId: startTime },
    );

    // Run synthesis (slow lane uses standard tier)
    const result = await ctx.runAction(
      internal.domains.models.modelRouter.route,
      {
        taskCategory: "synthesis",
        tier: "standard",
        systemPrompt: slowSystemPrompt,
        messages: [
          {
            role: "user" as const,
            content: `Context:\n${contextText}\n\nUser request: ${args.userMessage}\n\nProduce structured analysis sections.`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.3,
        // B-PR8: scope failover lessons to the slow-lane thread/turn.
        threadId: args.threadId,
        turnId: startTime,
      },
    );

    // Update scratchpad
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.updateScratchpad,
      {
        scratchpadId,
        scratchpad: {
          markdown: `## Slow Run: ${args.userMessage}\n\n${result.text}`,
        },
        status: "structuring",
        updatedAt: Date.now(),
      },
    );

    // Write diligence projection (scratchpadRunId uses threadId string)
    if (cache?.entity.id) {
      await ctx.runMutation(
        internal.domains.agents.canonicalRuntimeMutations.insertProjection,
        {
          ownerKey: args.ownerKey,
          entityId: cache.entity.id,
          entitySlug: args.entitySlug,
          blockType: "projection",
          scratchpadRunId: args.threadId,
          version: 1,
          overallTier: "single-source",
          headerText: "Deep Analysis",
          bodyProse: result.text,
          sourceCount: 0,
          updatedAt: Date.now(),
        },
      );
    }

    // Final checkpoint
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.insertCheckpoint,
      {
        runId: args.runId,
        index: 1,
        status: "scored",
        promptHash: "synthesis",
        modelName: result.modelId,
        headline: "Structured synthesis",
        thinkingTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startTime,
        judgedAt: Date.now(),
      },
    );

    // Mark run ready
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.updateRunStatus,
      {
        runId: args.runId,
        status: "completed",
        completedAt: Date.now(),
        lastActivityAt: Date.now(),
        thinkingTokensUsed: result.inputTokens + result.outputTokens,
      },
    );

    // Update thread message
    await ctx
      .runMutation(
        internal.domains.agents.canonicalRuntimeMutations.insertAgentMessage,
        {
          ownerKey: args.ownerKey,
          threadId: args.threadId,
          role: "assistant",
          content: result.text,
          surfaceOrigin: "drawer",
          model: result.modelId,
          tokensUsed: result.inputTokens + result.outputTokens,
          elapsedMs: Date.now() - startTime,
          createdAt: Date.now(),
        },
      )
      .catch(() => {});
  },
});

// ─── Action: Pulse scheduler trigger ────────────────────────────────────────

export const triggerPulseForEntity = internalAction({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    dateKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Ensure pulse page exists
    let page = await ctx.runQuery(
      internal.domains.agents.canonicalRuntimeQueries.getEntityNotebookPage,
      {
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        pageType: "pulse",
        dateKey: args.dateKey,
      },
    );

    if (!page) {
      page = {
        _id: await ctx.runMutation(
          internal.domains.agents.canonicalRuntimeMutations.upsertNotebookPage,
          {
            ownerKey: args.ownerKey,
            entitySlug: args.entitySlug,
            pageType: "pulse",
            title: `Pulse — ${args.entitySlug} — ${args.dateKey}`,
            dateKey: args.dateKey,
            createdAt: startTime,
            updatedAt: startTime,
          },
        ),
      };
    }

    // Create run
    const runId = await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.createRunRecord,
      {
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        goal: `Daily pulse for ${args.entitySlug}`,
        status: "queued",
        currentCheckpoint: 0,
        totalCheckpoints: 2,
        thinkingBudgetTokens: 4000,
        thinkingTokensUsed: 0,
        modelName: "openrouter/glm-4.7",
        startedAt: startTime,
        lastActivityAt: startTime,
      },
    );

    // Create pulse report row
    await ctx.runMutation(
      internal.domains.agents.canonicalRuntimeMutations.upsertPulseReport,
      {
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        dateKey: args.dateKey,
        status: "generating",
        changeCount: 0,
        materialChangeCount: 0,
        generatedAt: startTime,
      },
    );

    // Kick off slow orchestration in pulse mode
    ctx
      .runAction(internal.domains.agents.canonicalPlanner.runSlowOrchestrator, {
        runId,
        ownerKey: args.ownerKey,
        entitySlug: args.entitySlug,
        threadId: generateThreadId(),
        userMessage: `Generate daily pulse for ${args.entitySlug}. Summarize what changed since the last pulse.`,
      })
      .catch(() => {});

    return { runId, pageId: page!._id };
  },
});

// ─── Public Action: Frontend-facing fast lane ───────────────────────────────

export const runFastLane = action({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    threadId: v.optional(v.string()),
    userMessage: v.string(),
    forceMode: v.optional(v.union(v.literal("fast"), v.literal("slow"))),
  },
  returns: v.object({
    mode: v.string(),
    runId: v.optional(v.string()),
    answer: v.optional(v.string()),
    modelId: v.optional(v.string()),
    latencyMs: v.number(),
    fromCache: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const rawUserId = await getAuthUserId(ctx);
    const ownerKey = rawUserId
      ? `user:${String(rawUserId)}`
      : toAnonymousProductOwnerKey(args.anonymousSessionId);
    if (!ownerKey) {
      throw new Error("Authentication or anonymous session required");
    }
    return await ctx.runAction(
      internal.domains.agents.canonicalPlanner.planAndRunFast,
      {
        ownerKey,
        entitySlug: args.entitySlug,
        threadId: args.threadId,
        userMessage: args.userMessage,
        forceMode: args.forceMode,
      },
    );
  },
});
