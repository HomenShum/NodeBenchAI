import { httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { badRequest, ok, requireMcpSecret, readJson, serverError } from "./mcpHttpAuth";

// GET /api/mcpBridge/daily-brief?date=YYYY-MM-DD&persona=GENERAL
export const dailyBriefHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const dateString = url.searchParams.get("date") ?? undefined;
  const persona = url.searchParams.get("persona") ?? undefined;

  try {
    const result = await ctx.runQuery(
      internal.domains.mcp.mcpBridgeQueries.getDailyBrief,
      { dateString, persona }
    );
    return ok({ success: true, ...result });
  } catch (e: any) {
    return serverError(e.message ?? "Failed to fetch daily brief");
  }
});

// GET /api/mcpBridge/funding?q=company&roundType=seed&limit=20&daysBack=30
export const fundingSearchHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? undefined;
  const roundType = url.searchParams.get("roundType") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const daysBackRaw = url.searchParams.get("daysBack");
  const daysBack = daysBackRaw ? Number(daysBackRaw) : undefined;

  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    return badRequest("Invalid limit");
  }

  try {
    const events = await ctx.runQuery(
      internal.domains.mcp.mcpBridgeQueries.searchFunding,
      { query, roundType, limit, daysBack }
    );
    return ok({ success: true, events, count: events.length });
  } catch (e: any) {
    return serverError(e.message ?? "Failed to search funding");
  }
});

// GET /api/mcpBridge/research?status=queued&limit=20
export const researchQueueHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    return badRequest("Invalid limit");
  }

  try {
    const tasks = await ctx.runQuery(
      internal.domains.mcp.mcpBridgeQueries.getResearchQueue,
      { status, limit }
    );
    return ok({ success: true, tasks, count: tasks.length });
  } catch (e: any) {
    return serverError(e.message ?? "Failed to fetch research queue");
  }
});

// POST /api/mcpBridge/publish  { content, postType, persona?, target?, priority? }
export const publishToQueueHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const body = await readJson(request);
  if (!body) return badRequest("Invalid JSON body");

  const content = body.content;
  const postType = body.postType;

  if (typeof content !== "string" || content.length === 0) {
    return badRequest("Missing content");
  }
  if (typeof postType !== "string" || postType.length === 0) {
    return badRequest("Missing postType");
  }

  try {
    const result = await ctx.runMutation(
      internal.domains.mcp.mcpBridgeQueries.publishToQueue,
      {
        content,
        postType,
        persona: body.persona,
        target: body.target,
        priority: body.priority,
      }
    );
    return ok({ success: true, ...result }, result.queued ? 201 : 200);
  } catch (e: any) {
    return serverError(e.message ?? "Failed to publish to queue");
  }
});
