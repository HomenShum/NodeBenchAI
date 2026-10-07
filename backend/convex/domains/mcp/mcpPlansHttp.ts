import { httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { badRequest, notFound, ok, readJson, requireMcpSecret } from "./mcpHttpAuth";

function extractIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (!rest) return null;
  const [first, ...more] = rest.split("/").filter(Boolean);
  if (!first) return null;
  if (more.length > 0) return null;
  return first;
}

function normalizePlanPayload(body: any): {
  id: string;
  goal: string;
  steps: any;
  createdAt: string;
  updatedAt: string;
} | null {
  const source = body?.plan ?? body;
  const goal = source?.goal;
  const steps = source?.steps;
  if (typeof goal !== "string" || goal.length === 0) return null;
  if (steps === undefined) return null;

  const id =
    (typeof source?.id === "string" && source.id) ||
    `plan_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  const nowIso = new Date().toISOString();
  const createdAt =
    typeof source?.createdAt === "string" && source.createdAt ? source.createdAt : nowIso;
  const updatedAt =
    typeof source?.updatedAt === "string" && source.updatedAt ? source.updatedAt : nowIso;

  return { id, goal, steps, createdAt, updatedAt };
}

export const createPlanHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const body = await readJson(request);
  const plan = normalizePlanPayload(body);
  if (!plan) return badRequest("Invalid plan payload");

  await ctx.runMutation(internal.domains.mcp.mcpPlans.createPlan, { plan });
  return ok({ success: true, plan }, 201);
});

export const listPlansHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const goal = url.searchParams.get("goal") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    return badRequest("Invalid limit");
  }

  const plans = await ctx.runQuery(internal.domains.mcp.mcpPlans.listPlans, {
    goal,
    limit,
  });

  return ok({ success: true, plans, count: plans.length });
});

export const getPlanByIdHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const pathname = new URL(request.url).pathname;
  const planId = extractIdFromPath(pathname, "/api/mcpPlans/");
  if (!planId) return notFound();

  const plan = await ctx.runQuery(internal.domains.mcp.mcpPlans.getPlan, { planId });
  if (!plan) return notFound("Plan not found");
  return ok({ success: true, plan });
});

export const patchPlanByIdHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const pathname = new URL(request.url).pathname;
  const planId = extractIdFromPath(pathname, "/api/mcpPlans/");
  if (!planId) return notFound();

  const existing = await ctx.runQuery(internal.domains.mcp.mcpPlans.getPlan, { planId });
  if (!existing) return notFound("Plan not found");

  const body = await readJson(request);
  if (!body || (body.goal === undefined && body.steps === undefined)) {
    return badRequest("Provide at least one of: goal, steps");
  }

  const updated = {
    ...existing,
    goal: typeof body.goal === "string" ? body.goal : existing.goal,
    steps: body.steps !== undefined ? body.steps : existing.steps,
    updatedAt: new Date().toISOString(),
  };

  await ctx.runMutation(internal.domains.mcp.mcpPlans.updatePlan, {
    planId,
    plan: updated,
  });

  return ok({ success: true, plan: updated });
});

export const deletePlanByIdHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const pathname = new URL(request.url).pathname;
  const planId = extractIdFromPath(pathname, "/api/mcpPlans/");
  if (!planId) return notFound();

  const deleted = await ctx.runMutation(internal.domains.mcp.mcpPlans.deletePlan, { planId });
  if (!deleted) return notFound("Plan not found");

  return ok({ success: true, deleted: true });
});
