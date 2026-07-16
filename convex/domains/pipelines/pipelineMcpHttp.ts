/**
 * Pipeline MCP HTTP Bridge
 *
 * Lightweight HTTP entry points so external MCP servers, agents, and
 * `curl`-based integrations can drive pipelines without holding a
 * Convex client.
 *
 *   POST /mcp/pipeline/run          → kicks off any pipeline kind
 *   POST /mcp/pipeline/run-composed → kicks off a composed pipeline
 *   GET  /mcp/pipeline/status       → reads a run + steps + stream
 *   GET  /mcp/pipeline/list         → lists recent runs
 *
 * Auth: shared-secret header `x-mcp-secret`. Set via `MCP_SECRET` env var.
 * SSRF: endpoints are read/write but URLs are constant; no user-controlled
 * fetches.
 */

import { httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function check(req: Request): boolean {
  const provided = req.headers.get("x-mcp-secret") ?? "";
  const expected = process.env.MCP_SECRET ?? "";
  return Boolean(expected) && provided === expected;
}

// The secret-gated bridge is a service principal. Its owner is fixed on the
// server so request bodies and query strings can never select another owner.
const MCP_PIPELINE_OWNER_KEY = "mcp:shared-service";

export const runPipelineHttp = httpAction(async (ctx, request) => {
  if (!check(request)) return unauthorized();
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { pipelineKind, spec, title, modelId, forceFresh, linkupDepth } = body ?? {};
  if (
    pipelineKind !== "code_gen" &&
    pipelineKind !== "design_gen" &&
    pipelineKind !== "research"
  ) {
    return new Response(
      JSON.stringify({ error: "invalid_pipelineKind", got: pipelineKind }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  if (typeof spec !== "string" || spec.length === 0) {
    return new Response(JSON.stringify({ error: "spec_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(
    internal.domains.pipelines.pipelineWorkflow.startPipelineRunInternal,
    {
      pipelineKind,
      spec,
      title,
      modelId,
      ownerKey: MCP_PIPELINE_OWNER_KEY,
      forceFresh: forceFresh === true,
      linkupDepth: linkupDepth === "deep" ? "deep" : undefined,
    },
  );
  return new Response(JSON.stringify(result), {
    status: 202, // accepted; durable workflow runs async
    headers: { "Content-Type": "application/json" },
  });
});

export const runComposedPipelineHttp = httpAction(async (ctx, request) => {
  if (!check(request)) return unauthorized();
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { composition, spec, title, modelId, forceFresh, linkupDepth } = body ?? {};
  const validCompositions = new Set([
    "research_then_code",
    "research_then_design",
    "code_then_design",
  ]);
  if (!validCompositions.has(composition)) {
    return new Response(
      JSON.stringify({ error: "invalid_composition", got: composition }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  if (typeof spec !== "string" || spec.length === 0) {
    return new Response(JSON.stringify({ error: "spec_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await ctx.runMutation(
    internal.domains.pipelines.pipelineWorkflow.startComposedPipelineRunInternal,
    {
      composition,
      spec,
      title,
      modelId,
      ownerKey: MCP_PIPELINE_OWNER_KEY,
      forceFresh: forceFresh === true,
      linkupDepth: linkupDepth === "deep" ? "deep" : undefined,
    },
  );
  return new Response(JSON.stringify(result), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});

export const getPipelineStatusHttp = httpAction(async (ctx, request) => {
  if (!check(request)) return unauthorized();
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  if (!runId) {
    return new Response(JSON.stringify({ error: "runId_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const detail = await ctx.runQuery(
    internal.domains.pipelines.pipelineRunsQueries.getRunDetailInternal,
    { runId, ownerKey: MCP_PIPELINE_OWNER_KEY },
  );
  if (!detail) {
    return new Response(JSON.stringify({ error: "not_found", runId }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(detail), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export const listPipelineRunsHttp = httpAction(async (ctx, request) => {
  if (!check(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 100);
  const result = await ctx.runQuery(
    internal.domains.pipelines.pipelineRunsQueries.listRecentRunsInternal,
    { limit, ownerKey: MCP_PIPELINE_OWNER_KEY },
  );
  return new Response(JSON.stringify({ runs: result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
