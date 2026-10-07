"use node";

/**
 * Agent Loop — Perpetual multi-agent runtime.
 *
 * Scheduled tick (cron every 15 min):
 *   1. Query active agents
 *   2. Check eligibility (rate limit, budget, concurrency)
 *   3. Pull dispatched events
 *   4. Execute work cycle (digest → generate → post)
 *   5. Complete heartbeat with metrics
 *
 * Each agent role has domain-specific logic:
 *   research-analyst → digest intelligence → narrative post
 *   comms-analyst    → summarize comms → narrative post
 *   content-curator  → curate captures → LinkedIn post
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
// Note: getDispatchedEventsForAgent lives in agentLoopQueries.ts (non-node file)
import { generateText } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════════════
// AGENT ROLE PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  "research-analyst": `You are a research analyst agent. Synthesize the provided intelligence signals into a concise narrative update. Focus on:
- What changed and why it matters
- Specific numbers, dates, and facts
- Connections to broader trends
Write 2-3 paragraphs. Be precise, cite specifics, avoid speculation without flagging uncertainty.`,

  "comms-analyst": `You are a communications analyst agent. Summarize the provided messages and communications into actionable insights. Focus on:
- Key decisions or commitments made
- Action items and deadlines mentioned
- Sentiment and urgency signals
Write 2-3 paragraphs. Be factual, prioritize actionable information.`,

  "content-curator": `You are a content curator agent. From the provided captures and signals, create a polished content piece suitable for professional sharing. Focus on:
- The most interesting or novel finding
- Supporting evidence and data points
- A clear takeaway or question for the reader
Write in a clear, engaging style. 800-1200 characters.`,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tick the perpetual agent loop. Called by cron every 15 minutes.
 * Checks all active agents, runs eligible ones.
 */
export const tickAgentLoop = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[agentLoop] Tick started");

    // 1. Get all active agents with their posting capability
    const agents = await ctx.runQuery(
      internal.agentOS.listAgents,
      { status: "active" }
    );

    if (agents.length === 0) {
      console.log("[agentLoop] No active agents");
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;

    for (const agent of agents) {
      // 2. Check eligibility
      const capability = await ctx.runQuery(
        internal.domains.agents.agentPostingPipeline.getAgentPostingCapability,
        { agentId: agent.agentId }
      );

      if (!capability || !capability.canPost) {
        skipped++;
        continue;
      }

      // Check budget
      if (
        capability.budget.tokensRemaining !== null &&
        capability.budget.tokensRemaining <= 0
      ) {
        console.log(
          `[agentLoop] ${agent.agentId} budget exhausted`
        );
        skipped++;
        continue;
      }

      // Check concurrency
      if (
        capability.concurrentRunsAvailable !== null &&
        capability.concurrentRunsAvailable <= 0
      ) {
        console.log(
          `[agentLoop] ${agent.agentId} at max concurrent runs`
        );
        skipped++;
        continue;
      }

      // 3. Pull dispatched events for this agent
      const events = await ctx.runQuery(
        internal.domains.agents.agentLoopQueries.getDispatchedEventsForAgent,
        { agentId: agent.agentId, limit: 5 }
      );

      if (events.length === 0) {
        // No work to do — skip without starting heartbeat
        skipped++;
        continue;
      }

      // 4. Start heartbeat
      const heartbeat = await ctx.runMutation(
        internal.agentOS.recordHeartbeat,
        {
          agentId: agent.agentId,
          triggeredBy: "schedule",
          status: "started",
        }
      );

      if (heartbeat.rateLimited) {
        skipped++;
        continue;
      }

      // 5. Execute work cycle
      try {
        const result = await ctx.runAction(
          internal.domains.agents.agentLoop.executeAgentWorkCycle,
          {
            agentId: agent.agentId,
            agentRole: agent.persona,
            eventSummaries: events.map((e) => ({
              eventId: e.eventId,
              eventType: e.eventType,
              payload: e.payload,
            })),
          }
        );

        // 6. Complete heartbeat
        await ctx.runMutation(
          internal.agentOS.completeHeartbeat,
          {
            heartbeatId: heartbeat.heartbeatId,
            status: "completed",
            workQueueItemsProcessed: events.length,
            postsCreated: result.postsCreated,
            tokensBurned: result.tokensBurned,
            costUsd: result.costUsd,
          }
        );
        processed++;
      } catch (error: any) {
        // Complete heartbeat as failed
        await ctx.runMutation(
          internal.agentOS.completeHeartbeat,
          {
            heartbeatId: heartbeat.heartbeatId,
            status: "failed",
            errorMessage: error.message?.slice(0, 500),
          }
        );
        console.error(
          `[agentLoop] ${agent.agentId} work cycle failed:`,
          error.message
        );
      }
    }

    console.log(
      `[agentLoop] Tick complete: ${processed} processed, ${skipped} skipped`
    );
    return { processed, skipped };
  },
});

/**
 * Execute a single agent's work cycle — generate content from events and post.
 */
export const executeAgentWorkCycle = internalAction({
  args: {
    agentId: v.string(),
    agentRole: v.string(),
    eventSummaries: v.array(
      v.object({
        eventId: v.string(),
        eventType: v.string(),
        payload: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { agentId, agentRole, eventSummaries } = args;
    console.log(
      `[agentLoop] ${agentId} processing ${eventSummaries.length} events`
    );

    // Build context from events
    const eventContext = eventSummaries
      .map(
        (e) =>
          `[${e.eventType}] ${typeof e.payload === "object" ? JSON.stringify(e.payload) : String(e.payload ?? "")}`
      )
      .join("\n\n");

    // Pull latest digest for additional context
    let digestContext = "";
    try {
      const digestResult = await ctx.runAction(
        internal.domains.agents.digestAgent.generateDigestWithFactChecks,
        { persona: "GENERAL", model: "qwen3-coder-free", hoursBack: 24 }
      );
      if (digestResult.success && digestResult.digest) {
        const digest = digestResult.digest as Record<string, unknown>;
        digestContext = `\n\nLATEST INTELLIGENCE:\nThesis: ${digest.narrativeThesis ?? "N/A"}\n`;
        if (Array.isArray(digest.signals) && digest.signals.length > 0) {
          digestContext += digest.signals
            .slice(0, 3)
            .map(
              (s: any) =>
                `- ${s.title}: ${s.summary}${s.hardNumbers ? ` (${s.hardNumbers})` : ""}`
            )
            .join("\n");
        }
      }
    } catch {
      console.log(`[agentLoop] ${agentId} digest unavailable, proceeding with events only`);
    }

    // Generate content using free model
    const systemPrompt =
      AGENT_SYSTEM_PROMPTS[agentRole] ?? AGENT_SYSTEM_PROMPTS["research-analyst"];
    const model = getLanguageModelSafe("qwen3-coder-free");

    const { text, usage } = await generateText({
      model,
      system: systemPrompt,
      prompt: `EVENTS TO PROCESS:\n${eventContext}${digestContext}`,
      maxOutputTokens: 800,
      temperature: 0.7,
    });

    const content = text.trim();
    const tokensBurned = (usage?.totalTokens ?? 0);
    console.log(
      `[agentLoop] ${agentId} generated ${content.length} chars, ${tokensBurned} tokens`
    );

    // Determine posting channel based on agent role
    let postsCreated = 0;

    // All agents try to post to LinkedIn if authorized
    const agent = await ctx.runQuery(
      internal.agentOS.getAgent,
      { agentId }
    );

    if (agent?.allowedChannels.includes("linkedin")) {
      const postResult = await ctx.runAction(
        internal.domains.agents.agentPostingPipeline.createAgentLinkedInPost,
        {
          agentId,
          content,
          postType: eventSummaries[0]?.eventType ?? "intelligence_update",
          persona: agentRole === "content-curator" ? "FOUNDER" : "GENERAL",
          target: "organization" as const,
        }
      );
      if (postResult.success) postsCreated++;
    }

    return {
      postsCreated,
      tokensBurned,
      costUsd: 0, // Free model
      contentLength: content.length,
    };
  },
});

/**
 * Run a single agent's work cycle on demand (event-triggered or manual).
 */
export const tickSingleAgent = internalAction({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.runQuery(
      internal.agentOS.getAgent,
      { agentId: args.agentId }
    );
    if (!agent || agent.status !== "active") {
      return { skipped: true, reason: "agent_not_active" };
    }

    const events = await ctx.runQuery(
      internal.domains.agents.agentLoopQueries.getDispatchedEventsForAgent,
      { agentId: args.agentId, limit: 5 }
    );
    if (events.length === 0) {
      return { skipped: true, reason: "no_events" };
    }

    // Start heartbeat
    const heartbeat = await ctx.runMutation(
      internal.agentOS.recordHeartbeat,
      {
        agentId: args.agentId,
        triggeredBy: "event",
        status: "started",
      }
    );
    if (heartbeat.rateLimited) {
      return { skipped: true, reason: "rate_limited" };
    }

    try {
      const result = await ctx.runAction(
        internal.domains.agents.agentLoop.executeAgentWorkCycle,
        {
          agentId: args.agentId,
          agentRole: agent.persona,
          eventSummaries: events.map((e) => ({
            eventId: e.eventId,
            eventType: e.eventType,
            payload: e.payload,
          })),
        }
      );

      await ctx.runMutation(
        internal.agentOS.completeHeartbeat,
        {
          heartbeatId: heartbeat.heartbeatId,
          status: "completed",
          workQueueItemsProcessed: events.length,
          postsCreated: result.postsCreated,
          tokensBurned: result.tokensBurned,
          costUsd: result.costUsd,
        }
      );

      return { processed: true, ...result };
    } catch (error: any) {
      await ctx.runMutation(
        internal.agentOS.completeHeartbeat,
        {
          heartbeatId: heartbeat.heartbeatId,
          status: "failed",
          errorMessage: error.message?.slice(0, 500),
        }
      );
      return { processed: false, error: error.message };
    }
  },
});

