/**
 * Founder Platform Operations — queries and mutations
 *
 * CRUD + aggregation for the 18 founder domain tables.
 * All list queries are bounded with .take() to prevent unbounded reads.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ===========================================================================
// Auth Helpers — workspace ownership validation
// ===========================================================================

/**
 * Require authentication and return the user's subject identifier.
 * Throws if the caller is not authenticated.
 */
async function requireAuth(ctx: { auth: QueryCtx["auth"] }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required");
  return identity.subject;
}

/**
 * Assert that the authenticated caller owns the given workspace.
 * Returns the caller's userId. Throws on auth failure or access denied.
 */
async function assertWorkspaceOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  workspaceId: Id<"founderWorkspaces">,
): Promise<string> {
  const userId = await requireAuth(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.ownerUserId !== userId) {
    throw new Error("Access denied");
  }
  return userId;
}

/**
 * Given a companyId, resolve its workspace and assert ownership.
 * Returns { userId, company }.
 */
async function assertCompanyOwner(
  ctx: { db: QueryCtx["db"]; auth: QueryCtx["auth"] },
  companyId: Id<"founderCompanies">,
) {
  const userId = await requireAuth(ctx);
  const company = await ctx.db.get(companyId);
  if (!company) throw new Error("Access denied");
  const workspace = await ctx.db.get(company.workspaceId);
  if (!workspace || workspace.ownerUserId !== userId) {
    throw new Error("Access denied");
  }
  return { userId, company };
}

// ===========================================================================
// Queries
// ===========================================================================

// ---------------------------------------------------------------------------
// getMyWorkspace — resolve the authenticated user's workspace (first match)
// ---------------------------------------------------------------------------

export const getMyWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return ctx.db
      .query("founderWorkspaces")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .first();
  },
});

// ---------------------------------------------------------------------------
// getMyCompany — resolve the authenticated user's first company (convenience)
// ---------------------------------------------------------------------------

export const getMyCompany = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const workspace = await ctx.db
      .query("founderWorkspaces")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .first();
    if (!workspace) return null;
    return ctx.db
      .query("founderCompanies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
  },
});

// ---------------------------------------------------------------------------
// getWorkspace — by ID
// ---------------------------------------------------------------------------

export const getWorkspace = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await requireAuth(ctx);
    const ws = await ctx.db.get(workspaceId);
    if (!ws || ws.ownerUserId !== userId) return null;
    return ws;
  },
});

// ---------------------------------------------------------------------------
// getCompany — by ID
// ---------------------------------------------------------------------------

export const getCompany = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db.get(companyId);
  },
});

// ---------------------------------------------------------------------------
// getCompaniesByWorkspace — all companies in a workspace (max 20)
// ---------------------------------------------------------------------------

export const getCompaniesByWorkspace = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    return ctx.db
      .query("founderCompanies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(20);
  },
});

// ---------------------------------------------------------------------------
// getInitiativesByCompany — all initiatives for a company (max 50)
// ---------------------------------------------------------------------------

export const getInitiativesByCompany = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getAgentsByWorkspace — all agents in a workspace (max 50)
// ---------------------------------------------------------------------------

export const getAgentsByWorkspace = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    return ctx.db
      .query("founderAgents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getSignalsByCompany — signals for a company (max 100)
// ---------------------------------------------------------------------------

export const getSignalsByCompany = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 50, 100);
    return ctx.db
      .query("founderSignals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(cap);
  },
});

// ---------------------------------------------------------------------------
// getDecisionsByCompany — decisions for a company (max 50)
// ---------------------------------------------------------------------------

export const getDecisionsByCompany = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderDecisions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getInterventionsByCompany — interventions for a company (max 50)
// ---------------------------------------------------------------------------

export const getInterventionsByCompany = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderInterventions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getPendingActionsByCompany — pending actions for a company (max 50)
// ---------------------------------------------------------------------------

export const getPendingActionsByCompany = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderPendingActions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getLatestSnapshot — most recent context snapshot for a company
// ---------------------------------------------------------------------------

export const getLatestSnapshot = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderContextSnapshots")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();
  },
});

// ---------------------------------------------------------------------------
// getTimelineEvents — recent timeline events for a company (max 100)
// ---------------------------------------------------------------------------

export const getTimelineEvents = query({
  args: {
    companyId: v.id("founderCompanies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit }) => {
    await assertCompanyOwner(ctx, companyId);
    const cap = Math.min(limit ?? 50, 100);
    return ctx.db
      .query("founderTimelineEvents")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(cap);
  },
});

// ---------------------------------------------------------------------------
// getDashboardSummary — aggregated view for a company dashboard
// ---------------------------------------------------------------------------

export const getDashboardSummary = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    // Initiatives by status
    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(100);

    const initiativesByStatus: Record<string, number> = {};
    for (const init of initiatives) {
      initiativesByStatus[init.status] = (initiativesByStatus[init.status] ?? 0) + 1;
    }

    // Agents by status (look up via company)
    const agents = await ctx.db
      .query("founderAgents")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const agentsByStatus: Record<string, number> = {};
    for (const agent of agents) {
      agentsByStatus[agent.status] = (agentsByStatus[agent.status] ?? 0) + 1;
    }

    // Top 5 interventions by priority
    const allInterventions = await ctx.db
      .query("founderInterventions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const topInterventions = allInterventions
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 5);

    // Latest snapshot
    const latestSnapshot = await ctx.db
      .query("founderContextSnapshots")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .first();

    // Top 5 pending actions by priority
    const allActions = await ctx.db
      .query("founderPendingActions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const topPendingActions = allActions
      .filter((a) => a.status === "open" || a.status === "in_progress")
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 5);

    return {
      initiativesByStatus,
      agentsByStatus,
      topInterventions,
      latestSnapshot,
      topPendingActions,
    };
  },
});

// ===========================================================================
// Mutations
// ===========================================================================

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------

export const createWorkspace = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const ownerUserId = await requireAuth(ctx);
    const now = Date.now();
    return ctx.db.insert("founderWorkspaces", {
      name,
      ownerUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// createCompany
// ---------------------------------------------------------------------------

export const createCompany = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    name: v.string(),
    canonicalMission: v.string(),
    wedge: v.string(),
    foundingMode: v.union(
      v.literal("start_new"),
      v.literal("continue_existing"),
      v.literal("merged"),
    ),
    companyState: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("forming"),
        v.literal("operating"),
        v.literal("pivoting"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    const now = Date.now();
    return ctx.db.insert("founderCompanies", {
      workspaceId: args.workspaceId,
      name: args.name,
      canonicalMission: args.canonicalMission,
      wedge: args.wedge,
      foundingMode: args.foundingMode,
      companyState: args.companyState ?? "idea",
      status: "active",
      identityConfidence: 0.5,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateCompany — partial update
// ---------------------------------------------------------------------------

export const updateCompany = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    name: v.optional(v.string()),
    canonicalMission: v.optional(v.string()),
    wedge: v.optional(v.string()),
    companyState: v.optional(
      v.union(
        v.literal("idea"),
        v.literal("forming"),
        v.literal("operating"),
        v.literal("pivoting"),
      ),
    ),
    foundingMode: v.optional(
      v.union(
        v.literal("start_new"),
        v.literal("continue_existing"),
        v.literal("merged"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("archived"),
      ),
    ),
    identityConfidence: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, ...fields }) => {
    await assertCompanyOwner(ctx, companyId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(companyId, patch);
    return companyId;
  },
});

// ---------------------------------------------------------------------------
// createInitiative
// ---------------------------------------------------------------------------

export const createInitiative = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    title: v.string(),
    objective: v.string(),
    ownerType: v.optional(
      v.union(
        v.literal("founder"),
        v.literal("agent"),
        v.literal("shared"),
      ),
    ),
    productId: v.optional(v.id("founderProducts")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderInitiatives", {
      companyId: args.companyId,
      title: args.title,
      objective: args.objective,
      ownerType: args.ownerType ?? "founder",
      productId: args.productId,
      status: "active",
      riskLevel: "low",
      priorityScore: 50,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateInitiative — partial update
// ---------------------------------------------------------------------------

export const updateInitiative = mutation({
  args: {
    initiativeId: v.id("founderInitiatives"),
    title: v.optional(v.string()),
    objective: v.optional(v.string()),
    ownerType: v.optional(
      v.union(
        v.literal("founder"),
        v.literal("agent"),
        v.literal("shared"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("blocked"),
        v.literal("paused"),
        v.literal("completed"),
        v.literal("archived"),
      ),
    ),
    riskLevel: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
      ),
    ),
    priorityScore: v.optional(v.number()),
    latestSummary: v.optional(v.string()),
  },
  handler: async (ctx, { initiativeId, ...fields }) => {
    const userId = await requireAuth(ctx);
    const initiative = await ctx.db.get(initiativeId);
    if (!initiative) throw new Error("Access denied");
    await assertCompanyOwner(ctx, initiative.companyId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(initiativeId, patch);
    return initiativeId;
  },
});

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

export const createAgent = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    name: v.string(),
    agentType: v.union(
      v.literal("claude_code"),
      v.literal("openclaw"),
      v.literal("nodebench_background"),
      v.literal("other"),
    ),
    runtimeSurface: v.optional(
      v.union(
        v.literal("local"),
        v.literal("remote"),
        v.literal("hybrid"),
      ),
    ),
    mode: v.optional(
      v.union(
        v.literal("passive"),
        v.literal("guided"),
        v.literal("bounded_proactive"),
      ),
    ),
    companyId: v.optional(v.id("founderCompanies")),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    const now = Date.now();
    return ctx.db.insert("founderAgents", {
      workspaceId: args.workspaceId,
      name: args.name,
      agentType: args.agentType,
      runtimeSurface: args.runtimeSurface ?? "local",
      mode: args.mode ?? "passive",
      companyId: args.companyId,
      status: "healthy",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateAgentStatus
// ---------------------------------------------------------------------------

export const updateAgentStatus = mutation({
  args: {
    agentId: v.id("founderAgents"),
    status: v.union(
      v.literal("healthy"),
      v.literal("blocked"),
      v.literal("waiting"),
      v.literal("drifting"),
      v.literal("ambiguous"),
    ),
    currentGoal: v.optional(v.string()),
    lastSummary: v.optional(v.string()),
  },
  handler: async (ctx, { agentId, status, currentGoal, lastSummary }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, agent.workspaceId);
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status,
      lastHeartbeatAt: now,
      updatedAt: now,
    };
    if (currentGoal !== undefined) patch.currentGoal = currentGoal;
    if (lastSummary !== undefined) patch.lastSummary = lastSummary;
    await ctx.db.patch(agentId, patch);
    return agentId;
  },
});

// ---------------------------------------------------------------------------
// ingestSignal
// ---------------------------------------------------------------------------

export const ingestSignal = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    sourceType: v.union(
      v.literal("founder_note"),
      v.literal("agent_output"),
      v.literal("market"),
      v.literal("customer"),
      v.literal("product"),
      v.literal("execution"),
      v.literal("memo"),
      v.literal("other"),
    ),
    title: v.string(),
    content: v.string(),
    importanceScore: v.optional(v.number()),
    initiativeId: v.optional(v.id("founderInitiatives")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    return ctx.db.insert("founderSignals", {
      companyId: args.companyId,
      sourceType: args.sourceType,
      title: args.title,
      content: args.content,
      importanceScore: args.importanceScore ?? 50,
      initiativeId: args.initiativeId,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// createDecision
// ---------------------------------------------------------------------------

export const createDecision = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    title: v.string(),
    rationale: v.string(),
    initiativeId: v.optional(v.id("founderInitiatives")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderDecisions", {
      companyId: args.companyId,
      title: args.title,
      rationale: args.rationale,
      initiativeId: args.initiativeId,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateDecisionStatus
// ---------------------------------------------------------------------------

export const updateDecisionStatus = mutation({
  args: {
    decisionId: v.id("founderDecisions"),
    status: v.union(
      v.literal("proposed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("deferred"),
    ),
  },
  handler: async (ctx, { decisionId, status }) => {
    const decision = await ctx.db.get(decisionId);
    if (!decision) throw new Error("Access denied");
    await assertCompanyOwner(ctx, decision.companyId);
    await ctx.db.patch(decisionId, { status, updatedAt: Date.now() });
    return decisionId;
  },
});

// ---------------------------------------------------------------------------
// createIntervention
// ---------------------------------------------------------------------------

export const createIntervention = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    title: v.string(),
    description: v.string(),
    priorityScore: v.number(),
    confidence: v.number(),
    expectedImpact: v.string(),
    initiativeId: v.optional(v.id("founderInitiatives")),
    decisionId: v.optional(v.id("founderDecisions")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderInterventions", {
      companyId: args.companyId,
      title: args.title,
      description: args.description,
      priorityScore: args.priorityScore,
      confidence: args.confidence,
      expectedImpact: args.expectedImpact,
      initiativeId: args.initiativeId,
      decisionId: args.decisionId,
      status: "suggested",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateInterventionStatus
// ---------------------------------------------------------------------------

export const updateInterventionStatus = mutation({
  args: {
    interventionId: v.id("founderInterventions"),
    status: v.union(
      v.literal("suggested"),
      v.literal("accepted"),
      v.literal("in_progress"),
      v.literal("done"),
      v.literal("deferred"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { interventionId, status }) => {
    const intervention = await ctx.db.get(interventionId);
    if (!intervention) throw new Error("Access denied");
    await assertCompanyOwner(ctx, intervention.companyId);
    await ctx.db.patch(interventionId, { status, updatedAt: Date.now() });
    return interventionId;
  },
});

// ---------------------------------------------------------------------------
// recordOutcome
// ---------------------------------------------------------------------------

export const recordOutcome = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    interventionId: v.id("founderInterventions"),
    summary: v.string(),
    resultType: v.union(
      v.literal("positive"),
      v.literal("neutral"),
      v.literal("negative"),
      v.literal("unknown"),
    ),
    measuredImpact: v.optional(v.string()),
    initiativeId: v.optional(v.id("founderInitiatives")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    return ctx.db.insert("founderOutcomes", {
      companyId: args.companyId,
      interventionId: args.interventionId,
      summary: args.summary,
      resultType: args.resultType,
      measuredImpact: args.measuredImpact,
      initiativeId: args.initiativeId,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// generateSnapshot
// ---------------------------------------------------------------------------

export const generateSnapshot = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    snapshotType: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("event_triggered"),
    ),
    summary: v.string(),
    topPriorities: v.array(v.string()),
    topRisks: v.array(v.string()),
    openQuestions: v.array(v.string()),
    agentId: v.optional(v.id("founderAgents")),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    return ctx.db.insert("founderContextSnapshots", {
      companyId: args.companyId,
      snapshotType: args.snapshotType,
      summary: args.summary,
      topPriorities: args.topPriorities,
      topRisks: args.topRisks,
      openQuestions: args.openQuestions,
      generatedByAgentId: args.agentId,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// createTimelineEvent
// ---------------------------------------------------------------------------

export const createTimelineEvent = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    entityType: v.string(),
    entityId: v.string(),
    eventType: v.string(),
    summary: v.string(),
    evidenceRefs: v.optional(v.array(v.string())),
    companyId: v.optional(v.id("founderCompanies")),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderTimelineEvents", {
      workspaceId: args.workspaceId,
      entityType: args.entityType,
      entityId: args.entityId,
      eventType: args.eventType,
      summary: args.summary,
      evidenceRefs: args.evidenceRefs ?? [],
      companyId: args.companyId,
      correlationId: args.correlationId,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// createPendingAction
// ---------------------------------------------------------------------------

export const createPendingAction = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    title: v.string(),
    description: v.string(),
    priorityScore: v.number(),
    ownerType: v.optional(
      v.union(
        v.literal("founder"),
        v.literal("agent"),
      ),
    ),
    initiativeId: v.optional(v.id("founderInitiatives")),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderPendingActions", {
      companyId: args.companyId,
      title: args.title,
      description: args.description,
      priorityScore: args.priorityScore,
      ownerType: args.ownerType ?? "founder",
      initiativeId: args.initiativeId,
      dueAt: args.dueAt,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updatePendingActionStatus
// ---------------------------------------------------------------------------

export const updatePendingActionStatus = mutation({
  args: {
    actionId: v.id("founderPendingActions"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("done"),
      v.literal("deferred"),
    ),
  },
  handler: async (ctx, { actionId, status }) => {
    const action = await ctx.db.get(actionId);
    if (!action) throw new Error("Access denied");
    await assertCompanyOwner(ctx, action.companyId);
    await ctx.db.patch(actionId, { status, updatedAt: Date.now() });
    return actionId;
  },
});

// ===========================================================================
// Remote Agent Command Layer — Task Packets
// ===========================================================================

// ---------------------------------------------------------------------------
// getTaskPacket — by ID
// ---------------------------------------------------------------------------

export const getTaskPacket = query({
  args: { taskPacketId: v.id("founderTaskPackets") },
  handler: async (ctx, { taskPacketId }) => {
    const task = await ctx.db.get(taskPacketId);
    if (!task) return null;
    await assertWorkspaceOwner(ctx, task.workspaceId);
    return task;
  },
});

// ---------------------------------------------------------------------------
// getTasksByAgent — tasks for a specific agent, optionally filtered by status (max 50)
// ---------------------------------------------------------------------------

export const getTasksByAgent = query({
  args: {
    agentId: v.id("founderAgents"),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("dispatched"),
        v.literal("running"),
        v.literal("waiting_approval"),
        v.literal("blocked"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, { agentId, status }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return [];
    await assertWorkspaceOwner(ctx, agent.workspaceId);
    if (status) {
      return ctx.db
        .query("founderTaskPackets")
        .withIndex("by_agent", (q) => q.eq("targetAgentId", agentId).eq("taskStatus", status))
        .take(50);
    }
    return ctx.db
      .query("founderTaskPackets")
      .withIndex("by_agent", (q) => q.eq("targetAgentId", agentId))
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getTasksByCompany — tasks for a company, optionally filtered by status (max 100)
// ---------------------------------------------------------------------------

export const getTasksByCompany = query({
  args: {
    companyId: v.id("founderCompanies"),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("dispatched"),
        v.literal("running"),
        v.literal("waiting_approval"),
        v.literal("blocked"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, { companyId, status }) => {
    await assertCompanyOwner(ctx, companyId);
    if (status) {
      return ctx.db
        .query("founderTaskPackets")
        .withIndex("by_company", (q) => q.eq("companyId", companyId).eq("taskStatus", status))
        .take(100);
    }
    return ctx.db
      .query("founderTaskPackets")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(100);
  },
});

// ---------------------------------------------------------------------------
// getPendingTasks — active tasks in a workspace (max 50)
// ---------------------------------------------------------------------------

export const getPendingTasks = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const all = await ctx.db
      .query("founderTaskPackets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);

    return all
      .filter(
        (t) =>
          t.taskStatus === "queued" ||
          t.taskStatus === "dispatched" ||
          t.taskStatus === "running" ||
          t.taskStatus === "waiting_approval",
      )
      .slice(0, 50);
  },
});

// ---------------------------------------------------------------------------
// getTaskHistory — recent tasks in a workspace, ordered desc (max 200)
// ---------------------------------------------------------------------------

export const getTaskHistory = query({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, limit }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const cap = Math.min(limit ?? 50, 200);
    return ctx.db
      .query("founderTaskPackets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(cap);
  },
});

// ---------------------------------------------------------------------------
// createTaskPacket
// ---------------------------------------------------------------------------

export const createTaskPacket = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    targetAgentId: v.id("founderAgents"),
    taskType: v.union(
      v.literal("retrieve_items"),
      v.literal("setup_resource"),
      v.literal("run_analysis"),
      v.literal("execute_action"),
      v.literal("check_status"),
      v.literal("generate_artifact"),
      v.literal("custom"),
    ),
    title: v.string(),
    instructions: v.string(),
    requestedCapabilities: v.array(v.string()),
    permissionMode: v.union(
      v.literal("auto_allowed"),
      v.literal("ask_first"),
      v.literal("manual_only"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    returnFormat: v.union(
      v.literal("summary_only"),
      v.literal("summary_plus_evidence"),
      v.literal("full_artifacts"),
      v.literal("structured_data"),
    ),
    requestedBy: v.union(
      v.literal("founder"),
      v.literal("orchestrator"),
      v.literal("background_job"),
    ),
    companyId: v.optional(v.id("founderCompanies")),
    initiativeId: v.optional(v.id("founderInitiatives")),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    const now = Date.now();
    const approvalStatus =
      args.permissionMode === "auto_allowed" ? "not_required" as const : "pending" as const;
    return ctx.db.insert("founderTaskPackets", {
      workspaceId: args.workspaceId,
      targetAgentId: args.targetAgentId,
      taskType: args.taskType,
      title: args.title,
      instructions: args.instructions,
      requestedCapabilities: args.requestedCapabilities,
      permissionMode: args.permissionMode,
      approvalStatus,
      taskStatus: "queued",
      priority: args.priority,
      returnFormat: args.returnFormat,
      requestedBy: args.requestedBy,
      companyId: args.companyId,
      initiativeId: args.initiativeId,
      evidenceIds: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

export const updateTaskStatus = mutation({
  args: {
    taskPacketId: v.id("founderTaskPackets"),
    taskStatus: v.union(
      v.literal("queued"),
      v.literal("dispatched"),
      v.literal("running"),
      v.literal("waiting_approval"),
      v.literal("blocked"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    result: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    evidenceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { taskPacketId, taskStatus, result, errorMessage, evidenceIds }) => {
    const task = await ctx.db.get(taskPacketId);
    if (!task) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, task.workspaceId);
    const now = Date.now();
    const patch: Record<string, unknown> = { taskStatus, updatedAt: now };

    if (taskStatus === "dispatched") patch.dispatchedAt = now;
    if (taskStatus === "completed" || taskStatus === "failed") patch.completedAt = now;
    if (result !== undefined) patch.result = result;
    if (errorMessage !== undefined) patch.errorMessage = errorMessage;
    if (evidenceIds !== undefined) patch.evidenceIds = evidenceIds;

    await ctx.db.patch(taskPacketId, patch);
    return taskPacketId;
  },
});

// ---------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------

export const cancelTask = mutation({
  args: { taskPacketId: v.id("founderTaskPackets") },
  handler: async (ctx, { taskPacketId }) => {
    const task = await ctx.db.get(taskPacketId);
    if (!task) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, task.workspaceId);
    await ctx.db.patch(taskPacketId, {
      taskStatus: "cancelled",
      updatedAt: Date.now(),
    });
    return taskPacketId;
  },
});

// ===========================================================================
// Remote Agent Command Layer — Agent Presence
// ===========================================================================

// ---------------------------------------------------------------------------
// getAgentPresence — latest presence record for an agent
// ---------------------------------------------------------------------------

export const getAgentPresence = query({
  args: { agentId: v.id("founderAgents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return null;
    await assertWorkspaceOwner(ctx, agent.workspaceId);
    return ctx.db
      .query("founderAgentPresence")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .first();
  },
});

// ---------------------------------------------------------------------------
// getConnectedAgents — all currently connected agents in a workspace (max 50)
// ---------------------------------------------------------------------------

export const getConnectedAgents = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const all = await ctx.db
      .query("founderAgentPresence")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);

    return all.filter((p) => p.isConnected).slice(0, 50);
  },
});

// ---------------------------------------------------------------------------
// getWorkspacePresence — all presence records in a workspace (max 100)
// ---------------------------------------------------------------------------

export const getWorkspacePresence = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    return ctx.db
      .query("founderAgentPresence")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);
  },
});

// ---------------------------------------------------------------------------
// registerAgentConnection — upsert presence record
// ---------------------------------------------------------------------------

export const registerAgentConnection = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    agentId: v.id("founderAgents"),
    connectionId: v.string(),
    connectionType: v.union(
      v.literal("websocket"),
      v.literal("local_bridge"),
      v.literal("polling"),
    ),
    capabilities: v.array(v.string()),
    runtimeInfo: v.optional(
      v.object({
        platform: v.string(),
        version: v.optional(v.string()),
        environment: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    const now = Date.now();

    // Check for existing presence record for this agent
    const existing = await ctx.db
      .query("founderAgentPresence")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        connectionId: args.connectionId,
        connectionType: args.connectionType,
        isConnected: true,
        lastPingAt: now,
        capabilities: args.capabilities,
        runtimeInfo: args.runtimeInfo,
        connectedAt: now,
        disconnectedAt: undefined,
      });
      return existing._id;
    }

    return ctx.db.insert("founderAgentPresence", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      connectionId: args.connectionId,
      connectionType: args.connectionType,
      isConnected: true,
      lastPingAt: now,
      capabilities: args.capabilities,
      runtimeInfo: args.runtimeInfo,
      connectedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateAgentPing — heartbeat
// ---------------------------------------------------------------------------

export const updateAgentPing = mutation({
  args: { agentId: v.id("founderAgents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, agent.workspaceId);
    const existing = await ctx.db
      .query("founderAgentPresence")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastPingAt: Date.now() });
      return existing._id;
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// disconnectAgent
// ---------------------------------------------------------------------------

export const disconnectAgent = mutation({
  args: { agentId: v.id("founderAgents") },
  handler: async (ctx, { agentId }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, agent.workspaceId);
    const existing = await ctx.db
      .query("founderAgentPresence")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isConnected: false,
        disconnectedAt: Date.now(),
      });
      return existing._id;
    }
    return null;
  },
});

// ===========================================================================
// Remote Agent Command Layer — Command Messages
// ===========================================================================

// ---------------------------------------------------------------------------
// getConversationMessages — messages in a conversation thread (max 200)
// ---------------------------------------------------------------------------

export const getConversationMessages = query({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    conversationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, conversationId, limit }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const cap = Math.min(limit ?? 100, 200);
    // Filter by workspace to prevent cross-tenant message access
    const messages = await ctx.db
      .query("founderCommandMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(cap);
    return messages.filter((m) => m.workspaceId === workspaceId);
  },
});

// ---------------------------------------------------------------------------
// getRecentMessages — recent messages in a workspace (max 50)
// ---------------------------------------------------------------------------

export const getRecentMessages = query({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, limit }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    const cap = Math.min(limit ?? 50, 50);
    return ctx.db
      .query("founderCommandMessages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(cap);
  },
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export const sendMessage = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    conversationId: v.string(),
    senderType: v.union(
      v.literal("founder"),
      v.literal("orchestrator"),
      v.literal("agent"),
    ),
    messageType: v.union(
      v.literal("text"),
      v.literal("task_request"),
      v.literal("task_result"),
      v.literal("approval_request"),
      v.literal("approval_response"),
      v.literal("status_update"),
      v.literal("evidence"),
      v.literal("error"),
    ),
    content: v.string(),
    senderAgentId: v.optional(v.id("founderAgents")),
    taskPacketId: v.optional(v.id("founderTaskPackets")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderCommandMessages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      senderType: args.senderType,
      messageType: args.messageType,
      content: args.content,
      senderAgentId: args.senderAgentId,
      taskPacketId: args.taskPacketId,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Remote Agent Command Layer — Approval Queue
// ===========================================================================

// ---------------------------------------------------------------------------
// getPendingApprovals — pending approvals in a workspace (max 20)
// ---------------------------------------------------------------------------

export const getPendingApprovals = query({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    await assertWorkspaceOwner(ctx, workspaceId);
    return ctx.db
      .query("founderApprovalQueue")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId).eq("status", "pending"))
      .take(20);
  },
});

// ---------------------------------------------------------------------------
// createApproval
// ---------------------------------------------------------------------------

export const createApproval = mutation({
  args: {
    workspaceId: v.id("founderWorkspaces"),
    taskPacketId: v.id("founderTaskPackets"),
    agentId: v.id("founderAgents"),
    title: v.string(),
    description: v.string(),
    requestedCapabilities: v.array(v.string()),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await assertWorkspaceOwner(ctx, args.workspaceId);
    return ctx.db.insert("founderApprovalQueue", {
      workspaceId: args.workspaceId,
      taskPacketId: args.taskPacketId,
      agentId: args.agentId,
      title: args.title,
      description: args.description,
      requestedCapabilities: args.requestedCapabilities,
      riskLevel: args.riskLevel,
      status: "pending",
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// resolveApproval — approve or reject, cascading to the linked task packet
// ---------------------------------------------------------------------------

export const resolveApproval = mutation({
  args: {
    approvalId: v.id("founderApprovalQueue"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    reviewerNote: v.optional(v.string()),
  },
  handler: async (ctx, { approvalId, status, reviewerNote }) => {
    const now = Date.now();

    const approval = await ctx.db.get(approvalId);
    if (!approval) throw new Error("Access denied");
    await assertWorkspaceOwner(ctx, approval.workspaceId);

    // Update the approval record
    await ctx.db.patch(approvalId, {
      status,
      reviewedAt: now,
      reviewerNote,
    });

    // Cascade to the linked task packet
    if (status === "approved") {
      await ctx.db.patch(approval.taskPacketId, {
        approvalStatus: "approved",
        approvedBy: "founder",
        taskStatus: "queued",
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(approval.taskPacketId, {
        approvalStatus: "rejected",
        taskStatus: "cancelled",
        updatedAt: now,
      });
    }

    return approvalId;
  },
});

// ---------------------------------------------------------------------------
// getRelatedEntities — related entities for a company (max 20)
// ---------------------------------------------------------------------------

export const getRelatedEntities = query({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    await assertCompanyOwner(ctx, companyId);
    return ctx.db
      .query("founderRelatedEntities")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20);
  },
});

// ---------------------------------------------------------------------------
// createRelatedEntity
// ---------------------------------------------------------------------------

export const createRelatedEntity = mutation({
  args: {
    companyId: v.id("founderCompanies"),
    entityType: v.union(
      v.literal("product"),
      v.literal("partner"),
      v.literal("competitor"),
      v.literal("comparable"),
      v.literal("market_signal"),
      v.literal("design_partner"),
      v.literal("investor"),
    ),
    name: v.string(),
    relationship: v.string(),
    whyItMatters: v.string(),
    externalRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertCompanyOwner(ctx, args.companyId);
    const now = Date.now();
    return ctx.db.insert("founderRelatedEntities", {
      companyId: args.companyId,
      entityType: args.entityType,
      name: args.name,
      relationship: args.relationship,
      whyItMatters: args.whyItMatters,
      externalRef: args.externalRef,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// updateRelatedEntity — partial update
// ---------------------------------------------------------------------------

export const updateRelatedEntity = mutation({
  args: {
    entityId: v.id("founderRelatedEntities"),
    entityType: v.optional(
      v.union(
        v.literal("product"),
        v.literal("partner"),
        v.literal("competitor"),
        v.literal("comparable"),
        v.literal("market_signal"),
        v.literal("design_partner"),
        v.literal("investor"),
      ),
    ),
    name: v.optional(v.string()),
    relationship: v.optional(v.string()),
    whyItMatters: v.optional(v.string()),
    externalRef: v.optional(v.string()),
  },
  handler: async (ctx, { entityId, ...fields }) => {
    const entity = await ctx.db.get(entityId);
    if (!entity) throw new Error("Access denied");
    await assertCompanyOwner(ctx, entity.companyId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(entityId, patch);
    return entityId;
  },
});
