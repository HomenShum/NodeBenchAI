"use node";
/**
 * Enhanced Swarm Orchestrator with Industry-Leading Patterns (2026)
 *
 * Enhancements:
 * 1. OpenTelemetry Observability - Full distributed tracing
 * 2. Agent Checkpointing - Resume-from-failure + HITL
 * 3. Cost Tracking - Per-swarm cost attribution
 *
 * Based on patterns from:
 * - Anthropic (prompt caching, extended thinking)
 * - LangGraph (checkpointing, state management)
 * - OpenTelemetry (LLM observability)
 *
 * INDUSTRY_MONITOR: swarm_orchestrator
 * Keywords: ["multi-agent", "orchestration", "swarm", "parallel execution", "checkpointing"]
 * Auto-scans: Anthropic, OpenAI, LangChain for relevant updates
 * Last check: Daily via cron (6 AM UTC)
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { TelemetryLogger } from "../observability/telemetry";
import { CheckpointManager } from "./checkpointing";

/**
 * Enhanced swarm execution with observability and checkpointing
 *
 * This wraps the existing executeSwarmInternal with:
 * - Telemetry traces (OpenTelemetry)
 * - Checkpointing (LangGraph pattern)
 * - Cost tracking (per-swarm attribution)
 */
export const executeSwarmWithObservability = internalAction({
  args: {
    swarmId: v.string(),
    userId: v.id("users"),
    query: v.string(),
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
    const { swarmId, userId, query, model, tasks } = args;
    const ownedSwarm = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmStatusInternal,
      { swarmId, userId },
    );
    if (!ownedSwarm) {
      throw new Error("Swarm not found or unauthorized.");
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZE OBSERVABILITY
    // ═══════════════════════════════════════════════════════════════

    const logger = new TelemetryLogger("swarm_execution", {
      userId: userId as string,
      tags: ["swarm", "multi-agent", ...tasks.map(t => t.agentName)],
      metadata: {
        swarmId,
        query,
        model,
        agentCount: tasks.length,
      },
    });

    const swarmSpanId = logger.startAgentSpan("swarm", "orchestrator", {
      "agent.task_count": tasks.length,
    });

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZE CHECKPOINTING
    // ═══════════════════════════════════════════════════════════════

    const checkpointManager = new CheckpointManager(ctx, "swarm", `Swarm: ${query.slice(0, 50)}`);

    let workflowId: string | undefined;

    try {
      // Create initial checkpoint
      workflowId = await checkpointManager.start(userId as string, swarmId, {
        completedAgents: [],
        pendingAgents: tasks.map(t => t.taskId),
        agentResults: [],
      });

      logger.addSpanEvent(swarmSpanId, "checkpoint_created", { workflowId, checkpointNumber: 0 });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: SPAWN AGENTS
      // ═══════════════════════════════════════════════════════════════

      const spawningSpanId = logger.startSpan("spawn_agents", {}, swarmSpanId);

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "spawning",
        startedAt: Date.now(),
      });

      // Spawn agents via existing orchestrator
      const delegationTasks = tasks.map((task) => ({
        delegationId: crypto.randomUUID(),
        agentName: task.agentName as any,
        query: task.query,
      }));

      await ctx.runAction(internal.actions.parallelDelegation.scheduleDelegations, {
        runId: swarmId,
        userId,
        model,
        tasks: delegationTasks,
      });

      // Update task records
      for (let i = 0; i < tasks.length; i++) {
        await ctx.runMutation(internal.domains.agents.swarmMutations.updateTaskStatus, {
          taskId: tasks[i].taskId,
          status: "running",
          delegationId: delegationTasks[i].delegationId,
          startedAt: Date.now(),
        });
      }

      logger.endSpan(spawningSpanId);

      // Checkpoint after spawning
      await checkpointManager.checkpoint(workflowId, "spawning", 10, {
        completedAgents: [],
        pendingAgents: tasks.map(t => t.taskId),
        delegationIds: delegationTasks.map(d => d.delegationId),
      });

      logger.addSpanEvent(swarmSpanId, "agents_spawned", { count: tasks.length });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: POLL FOR COMPLETION
      // ═══════════════════════════════════════════════════════════════

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "executing",
      });

      const pollingSpanId = logger.startSpan("polling", {}, swarmSpanId);

      const maxPolls = 60; // 5 minutes max (5s interval)
      let pollCount = 0;

      while (pollCount < maxPolls) {
        pollCount++;

        const taskStatuses = await ctx.runQuery(
          internal.domains.agents.swarmQueries.getSwarmTasksInternal,
          { swarmId, userId }
        );

        const completed = taskStatuses.filter((t: any) => t.status === "completed").length;
        const failed = taskStatuses.filter((t: any) => t.status === "failed").length;
        const running = taskStatuses.filter((t: any) => t.status === "running").length;

        logger.addSpanEvent(pollingSpanId, "poll", {
          pollCount,
          completed,
          failed,
          running,
          total: tasks.length,
        });

        // Checkpoint progress every 3 agents or every 5 polls
        if (completed > 0 && (completed % 3 === 0 || pollCount % 5 === 0)) {
          const completedTaskIds = taskStatuses
            .filter((t: any) => t.status === "completed")
            .map((t: any) => t.taskId);

          const agentResults = taskStatuses
            .filter((t: any) => t.status === "completed" && t.result)
            .map((t: any) => ({
              agentId: t.taskId,
              agentName: t.agentName,
              role: t.role,
              result: t.result,
              timestamp: t.completedAt,
            }));

          const progress = 10 + (completed / tasks.length) * 50; // 10-60% for execution

          await checkpointManager.checkpoint(workflowId, "executing", progress, {
            completedAgents: completedTaskIds,
            pendingAgents: taskStatuses
              .filter((t: any) => t.status === "running" || t.status === "pending")
              .map((t: any) => t.taskId),
            agentResults,
          });

          logger.addSpanEvent(swarmSpanId, "checkpoint_saved", {
            completed,
            progress,
          });
        }

        // All completed
        if (completed + failed === tasks.length) {
          break;
        }

        // Wait 5 seconds
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      logger.endSpan(pollingSpanId);

      // ═══════════════════════════════════════════════════════════════
      // PHASE 3: GATHER RESULTS
      // ═══════════════════════════════════════════════════════════════

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "gathering",
      });

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
        logger.endSpan(swarmSpanId, "error", "No completed agents");
        await checkpointManager.error(workflowId, "No agents completed successfully");

        const trace = logger.endTrace("error", "No completed agents");
        await ctx.runMutation(internal.domains.observability.traces.saveTrace, { trace });

        await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
          swarmId,
          status: "failed",
          completedAt: Date.now(),
        });

        return;
      }

      await checkpointManager.checkpoint(workflowId, "gathering", 65, {
        completedAgents: results.map((r: any) => r.agentName),
        agentResults: results,
      });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 4: SYNTHESIS (WITH LLM TRACING)
      // ═══════════════════════════════════════════════════════════════

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "synthesizing",
      });

      const synthesisSpanId = logger.startSpan("synthesis", {}, swarmSpanId);

      // Add LLM call span for synthesis
      const llmSpanId = logger.startSpan("llm_call", {
        "llm.provider": "openrouter",
        "llm.model": "glm-4.7-flash",
        "llm.operation": "synthesis",
      }, synthesisSpanId);

      const synthesisStartTime = Date.now();

      const swarm = await ctx.runQuery(
        internal.domains.agents.swarmQueries.getSwarmStatusInternal,
        { swarmId, userId },
      );

      // Call existing synthesis function
      const synthesis = await ctx.runAction(
        internal.domains.agents.swarmOrchestrator.synthesizeResultsWithTelemetry,
        {
          query: swarm?.query || query,
          results,
          telemetrySpanId: llmSpanId,
        }
      );

      const synthesisLatency = Date.now() - synthesisStartTime;

      // Only record measured latency. Provider usage is unavailable in this path.
      logger.updateSpanAttributes(llmSpanId, {
        "llm.latency_ms": synthesisLatency,
      });

      logger.endSpan(llmSpanId);
      logger.endSpan(synthesisSpanId);

      await checkpointManager.checkpoint(workflowId, "synthesis", 90, {
        synthesisResult: synthesis.content,
      });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 5: FINALIZE
      // ═══════════════════════════════════════════════════════════════

      await ctx.runMutation(internal.domains.agents.swarmMutations.setSwarmResult, {
        swarmId,
        mergedResult: synthesis.content,
      });

      await checkpointManager.complete(workflowId, {
        synthesisResult: synthesis.content,
      });

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "completed",
        completedAt: Date.now(),
      });

      logger.endSpan(swarmSpanId);

      // ═══════════════════════════════════════════════════════════════
      // SAVE TELEMETRY
      // ═══════════════════════════════════════════════════════════════

      const trace = logger.endTrace("completed");
      await ctx.runMutation(internal.domains.observability.traces.saveTrace, { trace });

      console.log(`[SwarmEnhanced] ✅ Swarm ${swarmId} completed`);
      console.log(`[SwarmEnhanced]    Total cost: $${trace.totalCost?.toFixed(4)}`);
      console.log(`[SwarmEnhanced]    Total tokens: ${trace.totalTokens}`);
      console.log(`[SwarmEnhanced]    Trace ID: ${trace.traceId}`);
      console.log(`[SwarmEnhanced]    Workflow ID: ${workflowId}`);

    } catch (error: any) {
      console.error(`[SwarmEnhanced] ❌ Error:`, error.message);

      logger.endSpan(swarmSpanId, "error", error.message);

      if (workflowId) {
        await checkpointManager.error(workflowId, error.message);
      }

      const trace = logger.endTrace("error", error.message);
      await ctx.runMutation(internal.domains.observability.traces.saveTrace, { trace });

      await ctx.runMutation(internal.domains.agents.swarmMutations.updateSwarmStatus, {
        swarmId,
        status: "failed",
        completedAt: Date.now(),
      });

      throw error;
    }
  },
});

/**
 * Resume a failed swarm from last checkpoint
 */
export const resumeFailedSwarm = internalAction({
  args: {
    swarmId: v.string(),
    workflowId: v.string(),
  },
  handler: async (ctx, args) => {
    const manager = new CheckpointManager(ctx, "swarm", "");

    // Load latest checkpoint
    const checkpoint = await manager.loadLatest(args.workflowId);
    if (!checkpoint) {
      throw new Error(`Workflow ${args.workflowId} not found`);
    }

    if (checkpoint.status !== "error") {
      throw new Error(`Workflow not in error state: ${checkpoint.status}`);
    }
    if (!checkpoint.userId) {
      throw new Error("Workflow owner is unavailable.");
    }
    const userId = checkpoint.userId as Id<"users">;

    console.log(`[SwarmEnhanced] Resuming from checkpoint #${checkpoint.checkpointNumber}`);
    console.log(`[SwarmEnhanced] Completed agents: ${checkpoint.state.completedAgents?.length || 0}`);
    console.log(`[SwarmEnhanced] Pending agents: ${checkpoint.state.pendingAgents?.length || 0}`);

    // Get swarm details
    const swarm = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmStatusInternal,
      { swarmId: args.swarmId, userId },
    );

    if (!swarm) {
      throw new Error("Swarm not found");
    }

    // Resume execution (only execute pending agents)
    const pendingTaskIds = checkpoint.state.pendingAgents || [];
    const tasks = await ctx.runQuery(
      internal.domains.agents.swarmQueries.getSwarmTasksInternal,
      { swarmId: args.swarmId, userId },
    );

    const pendingTasks = tasks.filter((t: any) => pendingTaskIds.includes(t.taskId));

    if (pendingTasks.length === 0) {
      // All agents completed, just re-run synthesis
      console.log("[SwarmEnhanced] All agents completed, re-running synthesis");

      const results = checkpoint.state.agentResults || [];
      const synthesis = await ctx.runAction(
        internal.domains.agents.swarmOrchestrator.synthesizeResultsWithTelemetry,
        {
          query: swarm.query,
          results,
          telemetrySpanId: "resume",
        }
      );

      await ctx.runMutation(internal.domains.agents.swarmMutations.setSwarmResult, {
        swarmId: args.swarmId,
        mergedResult: synthesis.content,
      });

      await manager.complete(args.workflowId, {
        synthesisResult: synthesis.content,
      });

      console.log("[SwarmEnhanced] ✅ Swarm resumed and completed");
      return;
    }

    // Re-execute pending agents
    console.log(`[SwarmEnhanced] Re-executing ${pendingTasks.length} pending agents`);

    // TODO: Re-schedule pending agents via delegation scheduler
    // For now, throw an error to indicate manual intervention needed
    throw new Error(
      `Resume implementation incomplete. ${pendingTasks.length} agents need re-execution.`
    );
  },
});

/**
 * Wrapper for synthesis with telemetry support
 */
export const synthesizeResultsWithTelemetry = internalAction({
  args: {
    query: v.string(),
    results: v.array(
      v.object({
        agentName: v.string(),
        role: v.string(),
        result: v.string(),
      })
    ),
    telemetrySpanId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Call existing synthesis logic
    const resultSummaries = args.results
      .map(
        (r, i) => `
--- Agent ${i + 1}: ${r.agentName} (${r.role}) ---
${r.result}
`
      )
      .join("\n");

    const synthesisResult = await ctx.runAction(
      internal.domains.agents.mcp_tools.reasoningTool.getReasoning,
      {
        prompt: `You are a synthesis agent. Merge multiple research results into a unified, coherent answer.

Original Query: "${args.query}"

Research Results from ${args.results.length} parallel agents:
${resultSummaries}

Create a unified answer that:
1. Captures the key findings from all agents
2. Resolves any contradictions or notes disagreements
3. Provides a complete, coherent answer to the original query
4. Cites which agent provided each piece of information
5. Notes unresolved uncertainty without inventing a numeric score

Provide the synthesized answer:`,
        systemPrompt: "You are a multi-agent synthesis expert. Think step-by-step to merge findings from parallel agents into a coherent, comprehensive answer that resolves contradictions and captures all key insights.",
        maxTokens: 3000,
        extractStructured: true,
      }
    );

    const text = synthesisResult.structuredResponse || synthesisResult.response;
    return { content: text };
  },
});
