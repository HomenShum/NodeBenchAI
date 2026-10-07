/**
 * DCF Progress Tracker
 *
 * Manages the 7-step workflow tracking with state persistence
 * Follows LangGraph checkpointing pattern for rollback/resume
 */

import { mutation, query } from "../../../_generated/server";
import { v } from "convex/values";

/**
 * 7-Step DCF Workflow
 */
export const DCF_WORKFLOW_STEPS = [
  { id: 1, name: "Initialize", description: "Set up analysis parameters" },
  { id: 2, name: "Fetch Financials", description: "Retrieve SEC EDGAR data" },
  { id: 3, name: "Fetch Market Data", description: "Get current price and beta" },
  { id: 4, name: "Calculate WACC", description: "Compute discount rate" },
  { id: 5, name: "Project Cash Flows", description: "Build 5-year FCF projections" },
  { id: 6, name: "Calculate Valuation", description: "Discount to present value" },
  { id: 7, name: "Evaluate Model", description: "Compare to ground truth" },
] as const;

/**
 * Step Status Types
 */
export type StepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

/**
 * Progress Step
 */
export type ProgressStep = {
  stepId: number;
  name: string;
  description: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  result?: any;
};

/**
 * Initialize a new DCF progress session
 */
export const initializeProgress = mutation({
  args: {
    ticker: v.string(),
    userId: v.optional(v.string()),
    scenario: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    steps: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    const sessionId = `dcf-${args.ticker}-${Date.now()}`;

    // Initialize all steps as pending
    const steps: ProgressStep[] = DCF_WORKFLOW_STEPS.map((step) => ({
      stepId: step.id,
      name: step.name,
      description: step.description,
      status: "pending" as StepStatus,
    }));

    // Store in database (using a simple document for now)
    // In production, would use LangGraph checkpointing with PostgreSQL
    await ctx.db.insert("dcfProgressSessions", {
      sessionId,
      ticker: args.ticker,
      userId: args.userId,
      scenario: args.scenario,
      steps: steps as any,
      currentStep: 0,
      status: "initialized",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      sessionId,
      steps,
    };
  },
});

/**
 * Update step status
 */
export const updateStepStatus = mutation({
  args: {
    sessionId: v.string(),
    stepId: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find session
    const session = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    // Update step
    const steps = [...(session.steps as ProgressStep[])];
    const stepIndex = steps.findIndex((s) => s.stepId === args.stepId);

    if (stepIndex === -1) {
      throw new Error(`Step not found: ${args.stepId}`);
    }

    const step = steps[stepIndex];
    const now = Date.now();

    // Update status
    step.status = args.status;

    if (args.status === "in_progress" && !step.startedAt) {
      step.startedAt = now;
    }

    if (args.status === "completed" || args.status === "failed") {
      step.completedAt = now;
      if (step.startedAt) {
        step.durationMs = now - step.startedAt;
      }
    }

    if (args.result) {
      step.result = args.result;
    }

    if (args.error) {
      step.error = args.error;
    }

    // Update session
    await ctx.db.patch(session._id, {
      steps: steps as any,
      currentStep: args.stepId,
      updatedAt: now,
    });

    return {
      sessionId: args.sessionId,
      step,
    };
  },
});

/**
 * Get current progress
 */
export const getProgress = query({
  args: {
    sessionId: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    ticker: v.string(),
    scenario: v.string(),
    currentStep: v.number(),
    steps: v.array(v.any()),
    percentComplete: v.number(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    const steps = session.steps as ProgressStep[];
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const percentComplete = Math.round((completedSteps / steps.length) * 100);

    return {
      sessionId: session.sessionId,
      ticker: session.ticker,
      scenario: session.scenario,
      currentStep: session.currentStep,
      steps: steps as any,
      percentComplete,
      status: session.status,
    };
  },
});

/**
 * Complete the session
 */
export const completeSession = mutation({
  args: {
    sessionId: v.string(),
    finalResult: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    await ctx.db.patch(session._id, {
      status: "completed",
      finalResult: args.finalResult,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      sessionId: args.sessionId,
      status: "completed",
    };
  },
});

/**
 * Fail the session
 */
export const failSession = mutation({
  args: {
    sessionId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    await ctx.db.patch(session._id, {
      status: "failed",
      error: args.error,
      failedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      sessionId: args.sessionId,
      status: "failed",
      error: args.error,
    };
  },
});

/**
 * Get all sessions for a ticker
 */
export const getSessionsByTicker = query({
  args: {
    ticker: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("ticker"), args.ticker))
      .order("desc")
      .take(args.limit || 10);

    return sessions.map((session) => ({
      sessionId: session.sessionId,
      ticker: session.ticker,
      scenario: session.scenario,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      currentStep: session.currentStep,
    }));
  },
});

/**
 * Rollback to a specific step (LangGraph-style checkpointing)
 */
export const rollbackToStep = mutation({
  args: {
    sessionId: v.string(),
    targetStepId: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    const steps = [...(session.steps as ProgressStep[])];

    // Reset all steps after the target step
    steps.forEach((step) => {
      if (step.stepId > args.targetStepId) {
        step.status = "pending";
        step.startedAt = undefined;
        step.completedAt = undefined;
        step.durationMs = undefined;
        step.result = undefined;
        step.error = undefined;
      }
    });

    await ctx.db.patch(session._id, {
      steps: steps as any,
      currentStep: args.targetStepId,
      status: "rolled_back",
      updatedAt: Date.now(),
    });

    return {
      sessionId: args.sessionId,
      rolledBackTo: args.targetStepId,
      steps,
    };
  },
});

/**
 * Branch from a checkpoint to try alternative approach
 */
export const branchFromCheckpoint = mutation({
  args: {
    sourceSessionId: v.string(),
    checkpointStepId: v.number(),
    newScenario: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sourceSession = await ctx.db
      .query("dcfProgressSessions")
      .filter((q) => q.eq(q.field("sessionId"), args.sourceSessionId))
      .first();

    if (!sourceSession) {
      throw new Error(`Source session not found: ${args.sourceSessionId}`);
    }

    // Create new session branched from checkpoint
    const newSessionId = `${args.sourceSessionId}-branch-${Date.now()}`;
    const sourceSteps = sourceSession.steps as ProgressStep[];

    // Copy steps up to checkpoint, reset steps after
    const newSteps = sourceSteps.map((step) => {
      if (step.stepId <= args.checkpointStepId) {
        return { ...step }; // Keep completed steps
      } else {
        return {
          stepId: step.stepId,
          name: step.name,
          description: step.description,
          status: "pending" as StepStatus,
        };
      }
    });

    await ctx.db.insert("dcfProgressSessions", {
      sessionId: newSessionId,
      ticker: sourceSession.ticker,
      userId: sourceSession.userId,
      scenario: args.newScenario || sourceSession.scenario,
      steps: newSteps as any,
      currentStep: args.checkpointStepId,
      status: "branched",
      parentSessionId: args.sourceSessionId,
      branchedFrom: args.checkpointStepId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      newSessionId,
      parentSessionId: args.sourceSessionId,
      branchedFrom: args.checkpointStepId,
      steps: newSteps,
    };
  },
});
