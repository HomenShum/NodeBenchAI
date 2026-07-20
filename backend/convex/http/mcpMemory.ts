import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const write = httpAction(async (ctx, request) => {
  const body = await request.json();
  await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, body);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});

export const read = httpAction(async (ctx, request) => {
  const body = await request.json();
  const entry = await ctx.runQuery(internal.domains.mcp.mcpMemory.readMemory, { key: body.key });
  return new Response(JSON.stringify(entry), { status: entry ? 200 : 404 });
});

export const list = httpAction(async (ctx, request) => {
  const body = await request.json();
  const entries = await ctx.runQuery(internal.domains.mcp.mcpMemory.listMemory, { filter: body.filter ?? "" });
  return new Response(JSON.stringify(entries), { status: 200 });
});

export const deleteMemory = httpAction(async (ctx, request) => {
  const body = await request.json();
  const success = await ctx.runMutation(internal.domains.mcp.mcpMemory.deleteMemory, { key: body.key });
  if (!success) {
    return new Response(JSON.stringify({ success: false, error: "Not found" }), { status: 404 });
  }
  return new Response(JSON.stringify({ success: true }), { status: 200 });
});
