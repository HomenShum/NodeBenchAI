import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const create = httpAction(async (ctx, request) => {
  const body = await request.json();
  await ctx.runMutation(internal.domains.mcp.mcpPlans.createPlan, { plan: body.plan });
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});

export const get = httpAction(async (ctx, request) => {
  const body = await request.json();
  const plan = await ctx.runQuery(internal.domains.mcp.mcpPlans.getPlan, { planId: body.planId });
  return new Response(JSON.stringify(plan), { status: plan ? 200 : 404 });
});

export const update = httpAction(async (ctx, request) => {
  const body = await request.json();
  await ctx.runMutation(internal.domains.mcp.mcpPlans.updatePlan, { planId: body.planId, plan: body.plan });
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
