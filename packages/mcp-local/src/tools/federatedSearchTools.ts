/**
 * Federated search MCP tools — agent-facing layer for PR1 (Convex-native).
 *
 * Four tools (per the user spec):
 *   1. search_memory          — federated query across all 7 collections
 *   2. lookup_entity          — single entity lookup by URI/slug
 *   3. search_report_context  — search inside one report's notebook + claims
 *   4. suggest_related        — vector "more like this" given a rootUri
 *
 * Pattern: thin shim over the Convex `domains/search/federatedSearch:federatedSearch`
 * action. Same gateway/secret pattern as deepSimTools.
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - BOUND: input limit clamped to 25 per collection, 50 total.
 *   - HONEST_STATUS: gateway errors surface as { success: false, error }.
 *   - TIMEOUT: 8s gateway timeout (vs 3s on the action) so the action's
 *     own 3s budget governs and we don't double-time out.
 *   - BOUND_READ: response body capped at 2 MB.
 *   - ERROR_BOUNDARY: try/catch around fetch + parse.
 *   - DETERMINISTIC: pure pass-through; the action is the source of order.
 *
 * See: convex/domains/search/federatedSearch.ts (the action this wraps).
 */

import type { McpTool } from "../types.js";

/* -------------------------------------------------------------------------- */
/* Gateway transport (mirrors deepSimTools shape)                              */
/* -------------------------------------------------------------------------- */

const GATEWAY_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type GatewayResult<T> = { success: true; data: T } | { success: false; error: string };

function normalizeGatewayBaseUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes(".convex.cloud")) {
    return trimmed.replace(".convex.cloud", ".convex.site");
  }
  return trimmed;
}

function getGatewayConfig(): { siteUrl: string; secret: string } | null {
  const siteUrl = normalizeGatewayBaseUrl(
    process.env.CONVEX_SITE_URL ||
      process.env.VITE_CONVEX_URL ||
      process.env.CONVEX_URL,
  );
  const secret = process.env.MCP_SECRET;
  if (!siteUrl || !secret) return null;
  return { siteUrl, secret };
}

async function callGateway<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<GatewayResult<T>> {
  const config = getGatewayConfig();
  if (!config) {
    return {
      success: false,
      error:
        "Missing CONVEX_SITE_URL/VITE_CONVEX_URL/CONVEX_URL or MCP_SECRET. Cannot reach federated search backend.",
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    const res = await fetch(`${config.siteUrl}/api/mcpGateway`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mcp-secret": config.secret,
      },
      body: JSON.stringify({ fn, args }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return {
        success: false,
        error: `Response too large (${contentLength} bytes, max ${MAX_RESPONSE_BYTES}).`,
      };
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        success: false,
        error: `Response body too large (${text.length} chars, max ${MAX_RESPONSE_BYTES}).`,
      };
    }

    let payload: GatewayResult<T> & { message?: string };
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `Gateway returned non-JSON response (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    if (!res.ok) {
      const errMsg =
        payload && typeof (payload as any).error === "string"
          ? (payload as any).error
          : payload && typeof (payload as any).message === "string"
            ? (payload as any).message
            : `Gateway HTTP ${res.status}`;
      return { success: false, error: errMsg };
    }
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "unknown");
    return { success: false, error: `Gateway call failed: ${message}` };
  }
}

function bound(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/* -------------------------------------------------------------------------- */
/* Tool: search_memory                                                          */
/* -------------------------------------------------------------------------- */

const COLLECTIONS = [
  "nb_entities",
  "nb_reports",
  "nb_notebook_blocks",
  "nb_claims",
  "nb_sources",
  "nb_captures",
  "nb_threads",
] as const;

export const federatedSearchTools: McpTool[] = [
  {
    name: "search_memory",
    description:
      "Federated keyword search across NodeBench's 7 memory collections (entities, reports, notebook blocks, claims, sources, quick captures, chat threads). Returns shaped handles with type, uri, title, snippet, score, source, and suggested next actions. Privacy-scoped by the caller's identity — anonymous callers get only public/source collections.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search query string. Empty string returns zero results without error.",
        },
        collections: {
          type: "array",
          items: { type: "string", enum: [...COLLECTIONS] },
          description: "Subset of collections to search. Default: all 7.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 25,
          default: 8,
          description: "Per-collection limit (clamped to [1, 25]). Total result cap is 50.",
        },
        anonymousSessionId: {
          type: "string",
          description: "Optional anonymous session ID for guest users. Authenticated callers ignore this.",
        },
      },
      required: ["q"],
    },
    handler: async (args: {
      q: string;
      collections?: string[];
      limit?: number;
      anonymousSessionId?: string;
    }) => {
      const started = Date.now();
      const limit = bound(args.limit, 1, 25, 8);
      const result = await callGateway("federatedSearch", {
        q: args.q,
        collections: args.collections,
        limit,
        anonymousSessionId: args.anonymousSessionId,
      });
      const elapsedMs = Date.now() - started;
      if (!result.success) {
        return { success: false, error: result.error, elapsedMs };
      }
      return { success: true, data: result.data, elapsedMs };
    },
  },

  /* ------------------------------------------------------------------------ */
  /* Tool: lookup_entity — single entity by uri (entity://<slug>)               */
  /* ------------------------------------------------------------------------ */
  {
    name: "lookup_entity",
    description:
      "Look up a single entity by URI (entity://<slug>) or by canonical name. Backed by the federated search action filtered to nb_entities. Returns the top match's full handle (type, uri, title, snippet, source, actions).",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "Entity URI like 'entity://anthropic'. If omitted, supply 'name' instead.",
        },
        name: {
          type: "string",
          description: "Entity display name (e.g., 'Anthropic'). Used as fallback when no URI is supplied.",
        },
        anonymousSessionId: {
          type: "string",
          description: "Optional anonymous session ID for guest users.",
        },
      },
    },
    handler: async (args: { uri?: string; name?: string; anonymousSessionId?: string }) => {
      const started = Date.now();
      const seed = args.uri?.startsWith("entity://")
        ? args.uri.slice("entity://".length)
        : args.uri ?? args.name ?? "";
      const trimmed = seed.trim();
      if (!trimmed) {
        return {
          success: false,
          error: "lookup_entity requires either 'uri' or 'name'",
          elapsedMs: Date.now() - started,
        };
      }
      const result = await callGateway<any>("federatedSearch", {
        q: trimmed,
        collections: ["nb_entities"],
        limit: 1,
        anonymousSessionId: args.anonymousSessionId,
      });
      const elapsedMs = Date.now() - started;
      if (!result.success) {
        return { success: false, error: result.error, elapsedMs };
      }
      const entityCollection = (result.data?.collections ?? []).find(
        (c: any) => c.collection === "nb_entities",
      );
      const top = entityCollection?.results?.[0] ?? null;
      return { success: true, data: { match: top, found: !!top }, elapsedMs };
    },
  },

  /* ------------------------------------------------------------------------ */
  /* Tool: search_report_context                                                */
  /* ------------------------------------------------------------------------ */
  {
    name: "search_report_context",
    description:
      "Search within a single report's context — notebook blocks, claims, and the report itself. Useful when an agent already has a target report and needs to find a specific quote, claim, or block. Returns blocks/claims that match the query, plus the parent report handle.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: {
          type: "string",
          description: "Convex report ID (full _id, not URI). Required.",
        },
        q: { type: "string", description: "Search query string." },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 25,
          default: 8,
          description: "Per-collection limit.",
        },
        anonymousSessionId: { type: "string" },
      },
      required: ["reportId", "q"],
    },
    handler: async (args: {
      reportId: string;
      q: string;
      limit?: number;
      anonymousSessionId?: string;
    }) => {
      const started = Date.now();
      const limit = bound(args.limit, 1, 25, 8);
      const result = await callGateway<any>("federatedSearch", {
        q: args.q,
        collections: ["nb_reports", "nb_notebook_blocks", "nb_claims"],
        limit,
        anonymousSessionId: args.anonymousSessionId,
      });
      const elapsedMs = Date.now() - started;
      if (!result.success) {
        return { success: false, error: result.error, elapsedMs };
      }
      // Filter to just the requested report's context. The action returns
      // owner-scoped results; we narrow further by reportId at the URI level.
      const wantUri = `report://${args.reportId}`;
      const data = result.data;
      const reports = (data?.collections ?? []).find((c: any) => c.collection === "nb_reports");
      const blocks = (data?.collections ?? []).find((c: any) => c.collection === "nb_notebook_blocks");
      const claims = (data?.collections ?? []).find((c: any) => c.collection === "nb_claims");
      const reportMatch =
        reports?.results?.find((r: any) => r.uri === wantUri) ?? null;
      return {
        success: true,
        data: {
          report: reportMatch,
          blocks: blocks?.results ?? [],
          claims: claims?.results ?? [],
          partial: data?.partial ?? false,
          timedOut: data?.timedOut ?? false,
        },
        elapsedMs,
      };
    },
  },

  /* ------------------------------------------------------------------------ */
  /* Tool: inspect_topology_shape                                               */
  /* ------------------------------------------------------------------------ */
  {
    name: "inspect_topology_shape",
    description:
      "Inspect the persisted Convex topology shape for the Reports graph. Use this after search_memory/search_report_context when deciding whether to expand a dense Mapper cluster, inspect an outlier, or reuse first-ring graph context before live search. Returns density, PCA, centroid/outlier, clusters, neighbors, and recommended retrieval actions.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "Optional graph node id to inspect. If omitted, the current hot/dense node is selected.",
        },
        rootId: {
          type: "string",
          description: "Optional report root id, e.g. daily_<id> or li_<id>.",
        },
        view: {
          type: "string",
          enum: ["density", "pca", "centroid"],
          default: "density",
          description: "Topology projection to inspect.",
        },
        mode: {
          type: "string",
          enum: ["focus", "clustered", "expanded"],
          default: "clustered",
          description: "Report graph scale mode.",
        },
        query: { type: "string", description: "Optional report search/filter query." },
        stage: { type: "string", description: "Optional report stage filter." },
        kind: { type: "string", description: "Optional report type filter." },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 120,
          default: 96,
          description: "Bounded report graph limit.",
        },
      },
    },
    handler: async (args: {
      nodeId?: string;
      rootId?: string;
      view?: "density" | "pca" | "centroid";
      mode?: "focus" | "clustered" | "expanded";
      query?: string;
      stage?: string;
      kind?: string;
      limit?: number;
    }) => {
      const started = Date.now();
      const result = await callGateway<any>("inspectReportTopologyShape", {
        nodeId: args.nodeId,
        rootId: args.rootId,
        view: args.view ?? "density",
        mode: args.mode ?? "clustered",
        query: args.query,
        stage: args.stage,
        kind: args.kind,
        limit: bound(args.limit, 1, 120, 96),
      });
      const elapsedMs = Date.now() - started;
      if (!result.success) {
        return { success: false, error: result.error, elapsedMs };
      }
      return { success: true, data: result.data, elapsedMs };
    },
  },

  /* ------------------------------------------------------------------------ */
  /* Tool: suggest_related                                                      */
  /* ------------------------------------------------------------------------ */
  {
    name: "suggest_related",
    description:
      "Suggest related items given a root URI (entity://, report://, etc.). PR1 implementation uses the root's title as the seed query and federated keyword search. PR2 will swap in true vector 'more like this' once embeddings are wired per collection.",
    inputSchema: {
      type: "object",
      properties: {
        rootUri: {
          type: "string",
          description: "Root URI to find neighbors for. Required.",
        },
        seedTitle: {
          type: "string",
          description:
            "Optional explicit seed title. If omitted, the root URI is parsed and used as the query (e.g., 'entity://anthropic' becomes 'anthropic').",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 25,
          default: 5,
          description: "Per-collection neighbor limit.",
        },
        anonymousSessionId: { type: "string" },
      },
      required: ["rootUri"],
    },
    handler: async (args: {
      rootUri: string;
      seedTitle?: string;
      limit?: number;
      anonymousSessionId?: string;
    }) => {
      const started = Date.now();
      const limit = bound(args.limit, 1, 25, 5);
      const seed = (args.seedTitle ?? args.rootUri.replace(/^[a-z]+:\/\//i, "")).trim();
      if (!seed) {
        return {
          success: false,
          error: "suggest_related could not derive a seed query from rootUri",
          elapsedMs: Date.now() - started,
        };
      }
      const result = await callGateway<any>("federatedSearch", {
        q: seed,
        // Skip the root's own collection-shape; suggest neighbors across
        // entities, reports, blocks, threads.
        collections: ["nb_entities", "nb_reports", "nb_notebook_blocks", "nb_threads"],
        limit,
        anonymousSessionId: args.anonymousSessionId,
      });
      const elapsedMs = Date.now() - started;
      if (!result.success) {
        return { success: false, error: result.error, elapsedMs };
      }
      // Drop the root itself from the neighbor list (uri equality).
      const collections = (result.data?.collections ?? []).map((c: any) => ({
        ...c,
        results: (c.results ?? []).filter((r: any) => r.uri !== args.rootUri),
      }));
      const total = collections.reduce(
        (sum: number, c: any) => sum + (c.results?.length ?? 0),
        0,
      );
      return {
        success: true,
        data: {
          rootUri: args.rootUri,
          seed,
          collections,
          total,
        },
        elapsedMs,
      };
    },
  },
];
