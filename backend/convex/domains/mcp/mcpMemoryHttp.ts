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

export const createMemoryHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const body = await readJson(request);
  const source = body?.entry ?? body;
  const key = source?.key;
  const content = source?.content;
  const metadata = source?.metadata;

  if (typeof key !== "string" || key.length === 0) return badRequest("Missing key");
  if (typeof content !== "string") return badRequest("Missing content");

  const id = await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
    entry: { key, content, metadata },
  });

  return ok({ success: true, entry: { id, key, content, metadata } }, 201);
});

export const listMemoryHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? undefined;
  const contains = url.searchParams.get("contains") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    return badRequest("Invalid limit");
  }

  const entries = await ctx.runQuery(internal.domains.mcp.mcpMemory.listMemory, {
    key,
    contains,
    limit,
  });

  return ok({ success: true, entries, count: entries.length });
});

export const getMemoryByIdHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const pathname = new URL(request.url).pathname;
  const id = extractIdFromPath(pathname, "/api/mcpMemory/");
  if (!id) return notFound();

  try {
    const entry = await ctx.runQuery(internal.domains.mcp.mcpMemory.getMemoryById, { id: id as any });
    if (!entry) return notFound("Memory entry not found");
    return ok({ success: true, entry });
  } catch (e) {
    return badRequest("Invalid memory id");
  }
});

export const deleteMemoryByIdHttp = httpAction(async (ctx, request) => {
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  const pathname = new URL(request.url).pathname;
  const id = extractIdFromPath(pathname, "/api/mcpMemory/");
  if (!id) return notFound();

  try {
    const deleted = await ctx.runMutation(internal.domains.mcp.mcpMemory.deleteMemoryById, { id: id as any });
    if (!deleted) return notFound("Memory entry not found");
    return ok({ success: true, deleted: true });
  } catch {
    return badRequest("Invalid memory id");
  }
});
