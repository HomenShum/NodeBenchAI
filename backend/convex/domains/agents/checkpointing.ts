/**
 * Agent Checkpointing System
 *
 * Industry Pattern (2026): State persistence for long-running agents
 * - Save progress at key milestones
 * - Resume from last checkpoint on failure
 * - Enable human-in-the-loop workflows (pause/review/resume)
 * - Rewind/replay for debugging
 *
 * Based on:
 * - LangGraph's PostgresSaver (2024-2026 pattern)
 * - Anthropic/OpenAI agent best practices
 * - Temporal workflow patterns
 *
 * Use Cases:
 * - Swarm orchestrator (5min+ jobs with 10+ agents)
 * - Financial DCF workflows (multi-step analysis)
 * - Multi-day research tasks
 * - Workflows requiring human approval
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checkpoint = Snapshot of agent state at a point in time
 *
 * Design principles:
 * - Immutable: Each checkpoint is append-only
 * - Versioned: Sequential checkpoint numbers
 * - Recoverable: Can resume from any checkpoint
 * - Queryable: Search by workflowId, status, step
 */
export interface CheckpointState {
  // Identity
  workflowId: string; // UUID for entire workflow (e.g., swarmId, dcfModelId)
  checkpointId: string; // UUID for this specific checkpoint
  checkpointNumber: number; // Sequential: 1, 2, 3...
  parentCheckpointId?: string; // For branching (not typical, but supported)

  // Workflow metadata
  workflowType: string; // "swarm", "dcf_analysis", "research_task", etc.
  workflowName: string; // Human-readable name
  userId?: string;
  sessionId?: string;

  // State
  currentStep: string; // "gathering", "exploration", "synthesis", "approval_pending"
  status: "active" | "paused" | "completed" | "error" | "waiting_approval";
  progress: number; // 0-100%

  // Agent state (varies by workflow type)
  state: {
    // For swarm orchestrator
    completedAgents?: string[]; // Agent IDs that finished
    pendingAgents?: string[]; // Agent IDs still running
    agentResults?: Array<{
      agentId: string;
      role: string;
      result: string;
      timestamp: number;
    }>;
    synthesisResult?: string;

    // For DCF workflow
    modelId?: string;
    dataGathered?: boolean;
    assumptionsMade?: boolean;
    calculationsComplete?: boolean;

    // Generic state
    variables?: Record<string, any>; // Workflow-specific variables
    context?: Record<string, any>; // Additional context
  };

  // Execution metadata
  createdAt: number; // Checkpoint creation time
  error?: string; // If status=error
  estimatedTimeRemaining?: number; // ms
  nextScheduledAction?: string; // What happens next
}

/**
 * Checkpoint configuration for different workflow types
 */
export interface CheckpointConfig {
  workflowType: string;
  checkpointFrequency: "every_step" | "major_milestones" | "on_error"; // When to checkpoint
  retentionDays: number; // How long to keep checkpoints
  enableAutoResume: boolean; // Auto-resume on failure
  enableHumanReview: boolean; // Pause for human approval
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKPOINT MANAGER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CheckpointManager - Helper for saving/loading checkpoints
 *
 * Usage:
 * const manager = new CheckpointManager(ctx, "swarm", "Multi-agent research");
 * const workflowId = await manager.start({ initialState });
 * await manager.checkpoint("exploration", 30, { completedAgents: [...] });
 * const state = await manager.loadLatest(workflowId);
 * await manager.resume(workflowId);
 */
export class CheckpointManager {
  constructor(
    private ctx: any,
    private workflowType: string,
    private workflowName: string,
    private config: Partial<CheckpointConfig> = {}
  ) {}

  /**
   * Start new workflow (create checkpoint #0)
   */
  async start(
    userId?: string,
    sessionId?: string,
    initialState: Record<string, any> = {}
  ): Promise<string> {
    const workflowId = this.generateId();
    const checkpointId = this.generateId();

    await this.ctx.runMutation(internal.domains.agents.checkpointing.saveCheckpoint, {
      checkpoint: {
        workflowId,
        checkpointId,
        checkpointNumber: 0,
        workflowType: this.workflowType,
        workflowName: this.workflowName,
        userId,
        sessionId,
        currentStep: "initialized",
        status: "active",
        progress: 0,
        state: initialState,
        createdAt: Date.now(),
      },
    });

    return workflowId;
  }

  /**
   * Save checkpoint at current step
   */
  async checkpoint(
    workflowId: string,
    currentStep: string,
    progress: number,
    state: Record<string, any>,
    status: CheckpointState["status"] = "active",
    error?: string
  ): Promise<string> {
    const latest = await this.loadLatest(workflowId);
    if (!latest) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const checkpointId = this.generateId();

    await this.ctx.runMutation(internal.domains.agents.checkpointing.saveCheckpoint, {
      checkpoint: {
        workflowId,
        checkpointId,
        checkpointNumber: latest.checkpointNumber + 1,
        parentCheckpointId: latest.checkpointId,
        workflowType: this.workflowType,
        workflowName: this.workflowName,
        userId: latest.userId,
        sessionId: latest.sessionId,
        currentStep,
        status,
        progress,
        state: { ...latest.state, ...state },
        createdAt: Date.now(),
        error,
      },
    });

    return checkpointId;
  }

  /**
   * Load latest checkpoint for workflow
   */
  async loadLatest(workflowId: string): Promise<CheckpointState | null> {
    return await this.ctx.runQuery(
      internal.domains.agents.checkpointing.getLatestCheckpoint,
      { workflowId }
    );
  }

  /**
   * Load specific checkpoint by ID
   */
  async loadById(checkpointId: string): Promise<CheckpointState | null> {
    return await this.ctx.runQuery(
      internal.domains.agents.checkpointing.getCheckpointById,
      { checkpointId }
    );
  }

  /**
   * Load checkpoint by number
   */
  async loadByNumber(workflowId: string, checkpointNumber: number): Promise<CheckpointState | null> {
    return await this.ctx.runQuery(
      internal.domains.agents.checkpointing.getCheckpointByNumber,
      { workflowId, checkpointNumber }
    );
  }

  /**
   * List all checkpoints for workflow (for replay/debugging)
   */
  async listCheckpoints(workflowId: string): Promise<CheckpointState[]> {
    return await this.ctx.runQuery(
      internal.domains.agents.checkpointing.listCheckpoints,
      { workflowId }
    );
  }

  /**
   * Mark workflow as completed
   */
  async complete(workflowId: string, finalState: Record<string, any>): Promise<void> {
    await this.checkpoint(workflowId, "completed", 100, finalState, "completed");
  }

  /**
   * Mark workflow as error
   */
  async error(workflowId: string, errorMessage: string): Promise<void> {
    const latest = await this.loadLatest(workflowId);
    if (latest) {
      await this.checkpoint(
        workflowId,
        latest.currentStep,
        latest.progress,
        latest.state,
        "error",
        errorMessage
      );
    }
  }

  /**
   * Pause workflow for human review
   */
  async pauseForApproval(workflowId: string, approvalContext: any): Promise<void> {
    const latest = await this.loadLatest(workflowId);
    if (latest) {
      await this.checkpoint(
        workflowId,
        latest.currentStep,
        latest.progress,
        { ...latest.state, approvalContext },
        "waiting_approval"
      );
    }
  }

  /**
   * Resume workflow after approval
   */
  async resume(workflowId: string, approvalDecision?: any): Promise<CheckpointState> {
    const latest = await this.loadLatest(workflowId);
    if (!latest) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (latest.status === "waiting_approval") {
      await this.checkpoint(
        workflowId,
        latest.currentStep,
        latest.progress,
        { ...latest.state, approvalDecision },
        "active"
      );
    }

    return (await this.loadLatest(workflowId))!;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX MUTATIONS - Persist Checkpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save checkpoint to database
 */
export const saveCheckpoint = internalMutation({
  args: {
    checkpoint: v.object({
      workflowId: v.string(),
      checkpointId: v.string(),
      checkpointNumber: v.number(),
      parentCheckpointId: v.optional(v.string()),
      workflowType: v.string(),
      workflowName: v.string(),
      userId: v.optional(v.string()),
      sessionId: v.optional(v.string()),
      currentStep: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("error"),
        v.literal("waiting_approval")
      ),
      progress: v.number(),
      state: v.any(), // Varies by workflow type
      createdAt: v.number(),
      error: v.optional(v.string()),
      estimatedTimeRemaining: v.optional(v.number()),
      nextScheduledAction: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("checkpoints", args.checkpoint);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX QUERIES - Load Checkpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get latest checkpoint for workflow
 */
export const getLatestCheckpoint = internalQuery({
  args: { workflowId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .order("desc")
      .first();
  },
});

/**
 * Get checkpoint by ID
 */
export const getCheckpointById = internalQuery({
  args: { checkpointId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_checkpoint_id", (q) => q.eq("checkpointId", args.checkpointId))
      .first();
  },
});

/**
 * Get checkpoint by number
 */
export const getCheckpointByNumber = internalQuery({
  args: {
    workflowId: v.string(),
    checkpointNumber: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .filter((q) => q.eq(q.field("checkpointNumber"), args.checkpointNumber))
      .first();
  },
});

/**
 * List all checkpoints for workflow
 */
export const listCheckpoints = internalQuery({
  args: { workflowId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("checkpoints")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .order("asc")
      .collect();
  },
});

/**
 * List workflows by status (for monitoring dashboard)
 */
export const listWorkflowsByStatus = query({
  args: {
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("waiting_approval")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    // Get latest checkpoints for each workflow
    const allCheckpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(limit * 2);

    // Deduplicate by workflowId (keep only latest)
    const latestByWorkflow = new Map<string, any>();
    for (const checkpoint of allCheckpoints) {
      if (
        !latestByWorkflow.has(checkpoint.workflowId) ||
        checkpoint.checkpointNumber > latestByWorkflow.get(checkpoint.workflowId).checkpointNumber
      ) {
        latestByWorkflow.set(checkpoint.workflowId, checkpoint);
      }
    }

    return Array.from(latestByWorkflow.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
});

/**
 * Get workflows waiting for approval (HITL queue)
 */
export const getApprovalQueue = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("checkpoints")
      .withIndex("by_status", (q) => q.eq("status", "waiting_approval"))
      .order("desc");

    const checkpoints = await query.collect();

    // Deduplicate by workflowId
    const latestByWorkflow = new Map<string, any>();
    for (const checkpoint of checkpoints) {
      if (
        !latestByWorkflow.has(checkpoint.workflowId) ||
        checkpoint.checkpointNumber > latestByWorkflow.get(checkpoint.workflowId).checkpointNumber
      ) {
        latestByWorkflow.set(checkpoint.workflowId, checkpoint);
      }
    }

    let workflows = Array.from(latestByWorkflow.values());

    // Filter by userId if provided
    if (args.userId) {
      workflows = workflows.filter((w) => w.userId === args.userId);
    }

    return workflows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete old checkpoints (scheduled cleanup)
 */
export const deleteOldCheckpoints = internalMutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

    const oldCheckpoints = await ctx.db
      .query("checkpoints")
      .filter((q) => q.lt(q.field("createdAt"), cutoffTime))
      .collect();

    for (const checkpoint of oldCheckpoints) {
      await ctx.db.delete(checkpoint._id);
    }

    return { deleted: oldCheckpoints.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example 1: Swarm Orchestrator with Checkpointing
 *
 * const manager = new CheckpointManager(ctx, "swarm", "Financial Analysis Swarm");
 *
 * // Start workflow
 * const workflowId = await manager.start(userId, sessionId, {
 *   completedAgents: [],
 *   pendingAgents: agentIds,
 * });
 *
 * // Checkpoint after each agent completes
 * for (const agent of agents) {
 *   const result = await executeAgent(agent);
 *
 *   await manager.checkpoint(workflowId, "exploration", progress, {
 *     completedAgents: [...state.completedAgents, agent.id],
 *     agentResults: [...state.agentResults, { agentId: agent.id, result }],
 *   });
 * }
 *
 * // Pause for human review before synthesis
 * await manager.pauseForApproval(workflowId, {
 *   question: "Approve synthesis of these 5 agent results?",
 *   preview: results.slice(0, 200),
 * });
 *
 * // User approves via UI
 * await manager.resume(workflowId, { approved: true });
 *
 * // Complete workflow
 * await manager.complete(workflowId, { synthesisResult: finalAnswer });
 *
 *
 * Example 2: Resume Failed Swarm
 *
 * const manager = new CheckpointManager(ctx, "swarm", "");
 * const state = await manager.loadLatest(workflowId);
 *
 * if (state.status === "error") {
 *   // Resume from last checkpoint
 *   const completedAgents = state.state.completedAgents;
 *   const pendingAgents = state.state.pendingAgents;
 *
 *   // Only execute pending agents (save time + cost)
 *   for (const agentId of pendingAgents) {
 *     // ...
 *   }
 * }
 */
