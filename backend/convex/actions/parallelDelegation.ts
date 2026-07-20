"use node";
// convex/actions/parallelDelegation.ts
// Scheduler-based parallel delegation execution
// Each delegation runs as a separate action (no OCC fights between agents)

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { stepCountIs } from "@convex-dev/agent";
import type { Id } from "../_generated/dataModel";

// Import validators from agentDelegations
import { agentNameValidator } from "../domains/agents/agentDelegations";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type AgentName = "DocumentAgent" | "MediaAgent" | "SECAgent" | "OpenBBAgent" | "EntityResearchAgent";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Create subagent instance
// ═══════════════════════════════════════════════════════════════════════════

async function createSubagent(agentName: AgentName, model: string) {
  switch (agentName) {
    case "DocumentAgent": {
      const { createDocumentAgent } = await import("../domains/agents/core/subagents/document_subagent/documentAgent");
      return createDocumentAgent(model);
    }
    case "MediaAgent": {
      const { createMediaAgent } = await import("../domains/agents/core/subagents/media_subagent/mediaAgent");
      return createMediaAgent(model);
    }
    case "SECAgent": {
      const { createSECAgent } = await import("../domains/agents/core/subagents/sec_subagent/secAgent");
      return createSECAgent(model);
    }
    case "OpenBBAgent": {
      const { createOpenBBAgent } = await import("../domains/agents/core/subagents/openbb_subagent/openbbAgent");
      return createOpenBBAgent(model);
    }
    case "EntityResearchAgent": {
      const { createEntityResearchAgent } = await import("../domains/agents/core/subagents/entity_subagent/entityResearchAgent");
      return createEntityResearchAgent(model);
    }
    default:
      throw new Error(`Unknown agent: ${agentName}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Ensure thread exists for subagent
// ═══════════════════════════════════════════════════════════════════════════

async function ensureThread(
  ctx: any,
  agent: any,
  userId: Id<"users">
): Promise<string> {
  // Create a new thread for this delegation
  const { threadId } = await agent.createThread(ctx, { userId });
  return threadId;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ACTION: Execute a single delegation
// Called by scheduler (fire-and-forget from coordinator)
// ═══════════════════════════════════════════════════════════════════════════

export const executeDelegation = internalAction({
  args: {
    delegationId: v.string(),
    agentName: agentNameValidator,
    query: v.string(),
    runId: v.string(),
    userId: v.id("users"),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const { delegationId, agentName, query, runId, userId, model } = args;
    
    // Fix A: Action owns seq counter, passed into each emitWriteEvent
    let seq = 0;
    
    const emit = async (
      kind: "delta" | "tool_start" | "tool_end" | "note" | "final",
      opts: { textChunk?: string; toolName?: string; metadata?: any } = {}
    ) => {
      await ctx.runMutation(internal.domains.agents.agentDelegations.emitWriteEvent, {
        delegationId,
        seq: seq++,
        kind,
        textChunk: opts.textChunk,
        toolName: opts.toolName,
        metadata: opts.metadata,
      });
    };
    
    try {
      // 1. Update status to running
      await ctx.runMutation(internal.domains.agents.agentDelegations.updateStatus, {
        delegationId,
        status: "running",
      });
      
      // 2. Emit start event
      await emit("note", { textChunk: `Starting ${agentName}...` });
      
      // 3. Create subagent
      const agent = await createSubagent(agentName, model);
      
      // 4. Create thread for this delegation
      const threadId = await ensureThread(ctx, agent, userId);
      
      // Update delegation with thread ID
      await ctx.runMutation(internal.domains.agents.agentDelegations.updateStatus, {
        delegationId,
        status: "running",
        subagentThreadId: threadId,
      });
      
      await emit("note", { textChunk: `Thread created: ${threadId.slice(0, 8)}...` });
      
      // 5. Run agent with streaming callbacks
      // CRITICAL: Pass evaluationUserId so tools like askHuman can access userId
      const contextWithUserId = {
        ...ctx,
        evaluationUserId: userId,
        userId, // Also set userId directly for tools that check it
      };
      
      const result = await agent.generateText(
        contextWithUserId,
        { threadId, userId },
        {
          prompt: query,
          stopWhen: stepCountIs(8),
        }
      );
      
      // 6. Extract tool names used (if available)
      const toolsUsed: string[] = [];
      if (result.steps) {
        for (const step of result.steps) {
          if (step.toolCalls) {
            for (const tc of step.toolCalls) {
              if (tc.toolName && !toolsUsed.includes(tc.toolName)) {
                toolsUsed.push(tc.toolName);
                await emit("tool_end", { toolName: tc.toolName });
              }
            }
          }
        }
      }
      
      // 7. Emit final output
      await emit("final", {
        textChunk: result.text,
        metadata: {
          toolsUsed,
          threadId,
          messageId: result.messageId,
        },
      });
      
      // 8. Update status to completed
      await ctx.runMutation(internal.domains.agents.agentDelegations.updateStatus, {
        delegationId,
        status: "completed",
      });
      
      console.log(`[executeDelegation] ✅ ${agentName} completed for delegation ${delegationId}`);
      
    } catch (error: any) {
      console.error(`[executeDelegation] ❌ ${agentName} failed for delegation ${delegationId}:`, error.message);
      
      // Emit error event
      await emit("note", { textChunk: `Error: ${error.message}` });
      
      // Update status to failed
      await ctx.runMutation(internal.domains.agents.agentDelegations.updateStatus, {
        delegationId,
        status: "failed",
        errorMessage: error.message,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH SCHEDULING ACTION
// Called by parallelDelegate tool to schedule multiple delegations at once
// ═══════════════════════════════════════════════════════════════════════════

export const scheduleDelegations = internalAction({
  args: {
    runId: v.string(),
    userId: v.id("users"),
    model: v.string(),
    tasks: v.array(v.object({
      delegationId: v.string(),
      agentName: agentNameValidator,
      query: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const { runId, userId, model, tasks } = args;
    
    const delegationIds: string[] = [];
    
    for (const task of tasks) {
      // 1. Create delegation record
      await ctx.runMutation(internal.domains.agents.agentDelegations.createDelegation, {
        runId,
        delegationId: task.delegationId,
        userId,
        agentName: task.agentName,
        query: task.query,
      });
      
      delegationIds.push(task.delegationId);
      
      // 2. Schedule execution (fire-and-forget)
      await ctx.scheduler.runAfter(0, internal.actions.parallelDelegation.executeDelegation, {
        delegationId: task.delegationId,
        agentName: task.agentName,
        query: task.query,
        runId,
        userId,
        model,
      });
    }
    
    console.log(`[scheduleDelegations] Scheduled ${tasks.length} delegations for run ${runId}`);
    
    return {
      runId,
      delegationIds,
      count: tasks.length,
    };
  },
});
