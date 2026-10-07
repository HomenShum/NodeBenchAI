import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";

export const createPlan = internalMutation({
  args: {
    plan: v.object({
      id: v.string(),
      goal: v.string(),
      steps: v.any(),
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("mcpPlans", {
      planId: args.plan.id,
      goal: args.plan.goal,
      steps: args.plan.steps,
      createdAt: new Date(args.plan.createdAt).getTime() || now,
      updatedAt: new Date(args.plan.updatedAt).getTime() || now,
    });
    return true;
  },
});

export const listPlans = internalQuery({
  args: {
    goal: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      goal: v.string(),
      steps: v.any(),
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const goalFilter = (args.goal ?? "").toLowerCase();
    const limit = args.limit && args.limit > 0 ? args.limit : 50;

    const rows = await ctx.db.query("mcpPlans").collect() as Doc<"mcpPlans">[];
    const filtered = goalFilter
      ? rows.filter((p: Doc<"mcpPlans">) => (p.goal ?? "").toLowerCase().includes(goalFilter))
      : rows;

    filtered.sort((a: Doc<"mcpPlans">, b: Doc<"mcpPlans">) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return filtered.slice(0, limit).map((plan: Doc<"mcpPlans">) => ({
      id: plan.planId,
      goal: plan.goal,
      steps: plan.steps,
      createdAt: new Date(plan.createdAt).toISOString(),
      updatedAt: new Date(plan.updatedAt).toISOString(),
    }));
  },
});

export const getPlan = internalQuery({
  args: {
    planId: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      goal: v.string(),
      steps: v.any(),
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const plan = await ctx.db
      .query("mcpPlans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .first() as Doc<"mcpPlans"> | null;
    if (!plan) return null;
    return {
      id: plan.planId,
      goal: plan.goal,
      steps: plan.steps,
      createdAt: new Date(plan.createdAt).toISOString(),
      updatedAt: new Date(plan.updatedAt).toISOString(),
    };
  },
});

export const updatePlan = internalMutation({
  args: {
    planId: v.string(),
    plan: v.object({
      id: v.string(),
      goal: v.string(),
      steps: v.any(),
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpPlans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .first() as Doc<"mcpPlans"> | null;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        goal: args.plan.goal,
        steps: args.plan.steps,
        updatedAt: new Date(args.plan.updatedAt).getTime() || now,
      });
      return true;
    }
    await ctx.db.insert("mcpPlans", {
      planId: args.plan.id,
      goal: args.plan.goal,
      steps: args.plan.steps,
      createdAt: new Date(args.plan.createdAt).getTime() || now,
      updatedAt: new Date(args.plan.updatedAt).getTime() || now,
    });
    return true;
  },
});

export const deletePlan = internalMutation({
  args: { planId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpPlans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .first() as Doc<"mcpPlans"> | null;
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
