"use node";
/**
 * swarmOrchestrator.ts
 *
 * Parallel SubAgent Swarm Orchestration
 * Implements Fan-Out/Gather pattern for parallel agent execution.
 *
 * Key features:
 * - Creates swarm + thread together for instant UI feedback
 * - Executes agents in parallel via scheduler (fire-and-forget)
 * - LLM synthesis when all agents complete
 * - Unique state key isolation per agent
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ============================================================================
// Types & Constants
// ============================================================================

export const AGENT_SHORTCUTS: Record<string, string> = {
  doc: "DocumentAgent",
  media: "MediaAgent",
  sec: "SECAgent",
  finance: "OpenBBAgent",
  research: "EntityResearchAgent",
};

export const VALID_AGENTS = [
  "DocumentAgent",
  "MediaAgent",
  "SECAgent",
  "OpenBBAgent",
  "EntityResearchAgent",
] as const;

type AgentName = (typeof VALID_AGENTS)[number];

interface AgentConfig {
  agentName: string;
  role: string;
  query: string;
  stateKeyPrefix: string;
}

// ============================================================================
// Main Orchestration Actions
// ============================================================================

/**
 * Parse a /spawn command and extract query + agents
 */
export function parseSpawnCommand(input: string): {
  query: string;
  agents: string[];
} | null {
  // Match: /spawn "query" --agents=doc,media,sec
  // Or: /spawn query --agents=doc,media,sec
  const spawnMatch = input.match(/^\/spawn\s+(.+?)(?:\s+--agents?=([^\s]+))?$/i);
  if (!spawnMatch) return null;

  let query = spawnMatch[1].trim();
  // Remove quotes if present
  if ((query.startsWith('"') && query.endsWith('"')) ||
      (query.startsWith("'") && query.endsWith("'"))) {
    query = query.slice(1, -1);
  }

  // Parse agents
  let agents: string[] = [];
  if (spawnMatch[2]) {
    agents = spawnMatch[2].split(",").map((a) => {
      const trimmed = a.trim().toLowerCase();
      return AGENT_SHORTCUTS[trimmed] || trimmed;
    });
  } else {
    // Default agents if none specified
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  // Validate agents
  agents = agents.filter((a) =>
    VALID_AGENTS.includes(a as AgentName)
  );

  if (agents.length === 0) {
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  return { query, agents };
}

/**
 * Create a swarm with a new thread - returns immediately for instant UI
 */
export const createSwarm = action({
  args: {
    query: v.string(),
    agents: v.array(v.string()),
    pattern: v.optional(
      v.union(
        v.literal("fan_out_gather"),
        v.literal("pipeline"),
        v.literal("swarm")
      )
    ),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (!query || query.length > 4_000) {
      throw new Error("Team query must contain 1 to 4,000 characters.");
    }
    const agents = Array.from(new Set(args.agents))
      .filter((agent): agent is AgentName => VALID_AGENTS.includes(agent as AgentName))
      .slice(0, VALID_AGENTS.length);
    if (agents.length === 0) {
      throw new Error("At least one supported agent is required.");
    }
    const pattern = args.pattern ?? "fan_out_gather";
    const model = (args.model ?? "claude-sonnet-4.6").trim();
    if (!model || model.length > 160) {
      throw new Error("Model identifier must contain 1 to 160 characters.");
    }

    // Get userId from auth context (works for both authenticated and anonymous users)
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required to create a team. Please sign in.");
    }
    const swarmId = crypto.randomUUID();
    const now = Date.now();

    // 1. Create thread first for instant UI feedback
    const threadId = await ctx.runAction(
      internal.domains.agents.fastAgentPanelStreaming.createThreadForUserInternal,
      {
        userId,
        title: `Swarm: ${query.slice(0, 40)}...`,
        model,
      }
    );

    // 2. Generate agent configs with unique state key prefixes
    const agentConfigs: AgentConfig[] = agents.map((agentName: string, idx: number) => ({
      agentName,
      role: getAgentRole(agentName),
      query: `${query} (Focus: ${getAgentFocus(agentName)})`,
      stateKeyPrefix: `${agentName}:${swarmId.slice(0, 8)}:${idx}`,
    }));

    // 3. Create swarm record
    await ctx.runMutation(internal.domains.agents.swarmMutations.createSwarmRecord, {
      swarmId,
      userId,
      threadId: threadId as string,
      name: `Swarm: ${query.slice(0, 30)}`,
      query,
      pattern,
      agentConfigs,
    });

    // 4. Link thread to swarm
    await ctx.runMutation(internal.domains.agents.swarmMutations.linkThreadToSwarm, {
      threadId: threadId as Id<"chatThreadsStream">,
      swarmId,
    });

    // 5. Create task records
    const tasks = agentConfigs.map((config) => ({
      taskId: crypto.randomUUID(),
      agentName: config.agentName,
      query: config.query,
      role: config.role,
      stateKeyPrefix: config.stateKeyPrefix,
    }));

    await ctx.runMutation(internal.domains.agents.swarmMutations.createSwarmTasks, {
      swarmId,
      tasks,
    });

    // 6. Schedule swarm execution (fire-and-forget)
    await ctx.scheduler.runAfter(0, internal.domains.agents.swarmOrchestrator.executeSwarmInternal, {
      swarmId,
      userId,
      model,
      tasks,
    });

    return {
      swarmId,
      threadId: threadId as string,
      taskCount: tasks.length,
    };
  },
});

/**
 * Internal action to execute swarm agents in parallel
 */
export const executeSwarmInternal = internalAction({
  args: {
    swarmId: v.string(),
    userId: v.id("users"),
    model: v.string(),
    tasks: v.array(
      v.object({
        taskId: v.string(),
        agentName: v.string(),
        query: v.string(),
        role: v.string(),
        stateKeyPrefix: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { swarmId, userId, model, tasks } = args;
    const startTime = Date.now();
    const ownedSwarm = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmStatusInternal,
      { swarmId, userId },
    );
    if (!ownedSwarm) {
      throw new Error("Swarm not found or unauthorized.");
    }

    try {
      // 1. Update status to spawning
      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "spawning",
        startedAt: startTime,
      });

      // 2. Schedule all agent delegations in parallel
      const delegationTasks = tasks.map((task: { taskId: string; agentName: string; query: string }) => ({
        delegationId: crypto.randomUUID(),
        agentName: task.agentName as any, // Type coercion for AgentName
        query: task.query,
      }));

      // Use existing delegation scheduler
      await ctx.runAction(internal.actions.parallelDelegation.scheduleDelegations, {
        runId: swarmId,
        userId,
        model,
        tasks: delegationTasks,
      });

      // 3. Update task records with delegation IDs and set to running
      for (let i = 0; i < tasks.length; i++) {
        await ctx.runMutation(internal.domains.agents.swarmMutations.updateTaskStatus, {
          taskId: tasks[i].taskId,
          status: "running",
          delegationId: delegationTasks[i].delegationId,
          startedAt: Date.now(),
        });
      }

      // 4. Update status to executing
      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "executing",
      });

      // 5. Poll for completion (with timeout)
      const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
      const POLL_INTERVAL_MS = 2000; // 2 seconds
      let elapsed = 0;
      let completedPoll = false;

      while (elapsed < MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        elapsed += POLL_INTERVAL_MS;

        // Check delegation statuses
        const delegations = await ctx.runQuery(
          internal.domains.agents.agentDelegations.listByRunInternal as any,
          { runId: swarmId, userId }
        );

        // On first ticks, delegation records may not exist yet; don't treat empty as "all completed".
        if (!Array.isArray(delegations) || delegations.length < delegationTasks.length) {
          continue;
        }

        const allCompleted = delegations.every(
          (d: any) => d.status === "completed" || d.status === "failed"
        );

        if (allCompleted) {
          // Update task records with results
          for (const delegation of delegations) {
            const idx = delegationTasks.findIndex((t: { delegationId: string }) => t.delegationId === delegation.delegationId);
            const task = idx >= 0 ? tasks[idx] : null;
            if (task) {
              // Get the final write event for this delegation
              const events = await ctx.runQuery(
                internal.domains.agents.agentDelegations.getWriteEventsInternal as any,
                { delegationId: delegation.delegationId, limit: 500 }
              );
              const finalEvent = events.find((e: any) => e.kind === "final");

              await ctx.runMutation(internal.domains.agents.swarmMutations.updateTaskStatus, {
                taskId: task.taskId,
                status: delegation.status === "completed" ? "completed" : "failed",
                result: finalEvent?.textChunk || delegation.result,
                resultSummary: (finalEvent?.textChunk || delegation.result || "").slice(0, 200),
                completedAt: Date.now(),
                elapsedMs: Date.now() - startTime,
                errorMessage: delegation.errorMessage,
              });
            }
          }
          completedPoll = true;
          break;
        }
      }

      if (!completedPoll) {
        await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
          swarmId,
          status: "failed",
          completedAt: Date.now(),
          elapsedMs: Date.now() - startTime,
        });
        return;
      }

      // 6. Gather results and synthesize
      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "gathering",
      });

      // Get all task results
      const completedTasks = await ctx.runQuery(
        internal.domains.agents.swarmQueries.getSwarmTasksInternal,
        { swarmId, userId }
      );

      const results = completedTasks
        .filter((t: any) => t.status === "completed" && t.result)
        .map((t: any) => ({
          agentName: t.agentName,
          role: t.role,
          result: t.result,
        }));

      if (results.length === 0) {
        await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
          swarmId,
          status: "failed",
          completedAt: Date.now(),
          elapsedMs: Date.now() - startTime,
        });
        return;
      }

      // 7. Synthesize results via TRACE (Verifiable Orchestrator pattern)
      // Instead of passing raw results to the LLM for merging (Risk 1: Hallucination),
      // we use deterministic tools and only expose metadata to the LLM.
      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "synthesizing",
      });

      const swarm = await ctx.runQuery(
        internal.domains.agents.swarmQueries.getSwarmStatusInternal,
        { swarmId, userId },
      );

      // TRACE finalization: deterministic merge + audit log + optional AI analysis
      const traceOutput = await ctx.runAction(
        internal.domains.agents.traceOrchestrator.executeTraceFinalization,
        {
          userId,
          executionId: swarmId,
          executionType: "swarm" as const,
          query: swarm?.query || "",
          agentResults: results,
          generateAnalysis: true,
        }
      );

      // Build the enhanced result with clear separation of deterministic vs AI content
      const { buildTraceEnhancedResult } = await import("./traceOrchestrator");
      const auditSummary = await ctx.runQuery(
        internal.domains.agents.traceAuditLog.getAuditSummaryInternal,
        { executionId: swarmId, userId }
      );

      // Deterministic merge of raw agent results with provenance markers
      const rawMergedData = results
        .filter((r: { result: string }) => r.result && r.result.length > 50)
        .map((r: { agentName: string; role: string; result: string }) =>
          `[Source: ${r.agentName} (${r.role})]\n${r.result}`
        )
        .join("\n\n---\n\n");

      const enhancedResult = buildTraceEnhancedResult(
        rawMergedData,
        traceOutput.analysis,
        auditSummary,
      );

      // 8. Save merged result
      await ctx.runMutation(internal.domains.agents.swarmMutations.setSwarmResult, {
        swarmId,
        mergedResult: enhancedResult,
      });

      // 9. Add synthesis as assistant message to thread
      // This makes the result appear in the chat
      const swarmRecord = await ctx.runQuery(
        internal.domains.agents.swarmQueries.getSwarmStatusInternal,
        { swarmId, userId },
      );

      if (swarmRecord?.threadId) {
        // Get the thread's agentThreadId for adding message
        const thread = await ctx.runQuery(
          internal.domains.agents.fastAgentPanelStreaming.getThreadByStreamIdInternal,
          { threadId: swarmRecord.threadId as Id<"chatThreadsStream"> }
        );

        if (thread?.agentThreadId) {
          // Add the synthesis as a message (using the agent component)
          // For now, we'll store it in the swarm record - UI will display it
          console.log(`[swarmOrchestrator] Synthesis complete for ${swarmId}`);
        }
      }

      console.log(`[swarmOrchestrator] ✅ Swarm ${swarmId} completed in ${Date.now() - startTime}ms`);

    } catch (error: any) {
      console.error(`[swarmOrchestrator] ❌ Swarm ${swarmId} failed:`, error.message);

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "failed",
        completedAt: Date.now(),
        elapsedMs: Date.now() - startTime,
      });
    }
  },
});

/**
 * Cancel a running swarm
 */
export const cancelSwarm = action({
  args: {
    swarmId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Authentication required to cancel a team.");
    }
    const swarm = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmStatusInternal,
      { swarmId: args.swarmId, userId },
    );
    if (!swarm) {
      throw new Error("Swarm not found or unauthorized.");
    }

    await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
      swarmId: args.swarmId,
      status: "cancelled",
      completedAt: Date.now(),
    });

    // Cancel all pending/running tasks
    const tasks = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmTasksInternal,
      { swarmId: args.swarmId, userId },
    );

    for (const task of tasks) {
      if (task.status === "pending" || task.status === "running") {
        await ctx.runMutation(internal.domains.agents.swarmMutations.updateTaskStatus, {
          taskId: task.taskId,
          status: "cancelled",
          completedAt: Date.now(),
        });
      }
    }

    return { cancelled: true };
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function getAgentRole(agentName: string): string {
  const roles: Record<string, string> = {
    DocumentAgent: "Document search and analysis specialist",
    MediaAgent: "Video, image, and media content researcher",
    SECAgent: "SEC filings and regulatory document expert",
    OpenBBAgent: "Financial data and market analysis specialist",
    EntityResearchAgent: "Entity profiling and relationship researcher",
  };
  return roles[agentName] || "Research specialist";
}

function getAgentFocus(agentName: string): string {
  const focuses: Record<string, string> = {
    DocumentAgent: "documents, papers, and written content",
    MediaAgent: "videos, images, and multimedia",
    SECAgent: "SEC filings, 10-K, 10-Q, and regulatory documents",
    OpenBBAgent: "stock data, financial metrics, and market trends",
    EntityResearchAgent: "companies, people, and entity relationships",
  };
  return focuses[agentName] || "general research";
}
