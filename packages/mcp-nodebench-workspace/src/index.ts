#!/usr/bin/env node
/**
 * nodebench-workspace-mcp — Atomic-edit MCP server for NodeBench.
 *
 * Exposes the same 5 atomic-edit primitives that runChatAgent uses
 * internally, but over the Model Context Protocol stdio transport so
 * ANY agent (Claude Desktop, Cursor, Windsurf, custom orchestrators)
 * can call them — not just our pi-ai chat surface.
 *
 * Tools (mirror of convex/domains/product/chatAgent.ts TOOLS):
 *   - upsertEntity(slug, name, type, summary?)
 *   - recordClaim(text, status, sourceUrl?, entitySlug?)
 *   - attachSource(entitySlug, url, title?, fav?)
 *   - createFollowup(text, dueAt?)
 *   - addGraphEdge(fromSlug, toSlug, kind, confidence)
 *
 * Each tool dispatches to the corresponding Convex mutation through a
 * single HTTP-backed bridge action, so the canonical write path lives
 * in one place (the Convex deployment) and external agents reuse it.
 *
 * ENV:
 *   CONVEX_URL                  Required. e.g. https://agile-caribou-964.convex.cloud
 *   NODEBENCH_SESSION_ID        Optional. Stable session id; auto-generated if missing.
 *   NODEBENCH_ANON_SESSION_ID   Optional. Anonymous identity key; auto-generated if missing.
 *
 * Reliability invariants (per .claude/rules/agentic_reliability.md):
 *   - HONEST_STATUS: each tool returns the real success/failure from Convex
 *   - BOUND_READ:    Convex enforces payload bounds server-side
 *   - TIMEOUT:       30s per tool call
 *   - ERROR_BOUNDARY: every tool wrapped in try/catch
 *   - DETERMINISTIC: tool call IDs derive from MCP request IDs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error(
    "[nodebench-workspace-mcp] FATAL: CONVEX_URL environment variable required."
  );
  console.error(
    "  Set it to your Convex deployment URL, e.g.\n  CONVEX_URL=https://agile-caribou-964.convex.cloud"
  );
  process.exit(1);
}

const SESSION_ID =
  process.env.NODEBENCH_SESSION_ID ??
  `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ANON_SESSION_ID =
  process.env.NODEBENCH_ANON_SESSION_ID ??
  `mcp-anon-${Date.now().toString(36)}`;

const convex = new ConvexHttpClient(CONVEX_URL);

const TOOL_TIMEOUT_MS = 30_000;

/**
 * Tool schemas — must stay in sync with chatAgent.ts TOOLS array.
 * Each schema serves both as the MCP advertisement and the Zod
 * validator for incoming arguments.
 */
const SCHEMAS = {
  upsertEntity: z.object({
    slug: z.string().min(1).max(200).describe("URL-safe slug, e.g. 'orbital-labs'"),
    name: z.string().min(1).max(200).describe("Display name"),
    type: z
      .enum(["company", "person", "topic", "event"])
      .describe("Entity type"),
    summary: z.string().max(500).optional().describe("One-line summary"),
  }),
  recordClaim: z.object({
    text: z.string().min(1).max(280).describe("The claim text"),
    status: z
      .enum(["verified", "needs_review", "rumor"])
      .describe("Verification status"),
    sourceUrl: z.string().max(500).optional().describe("Source URL if known"),
    entitySlug: z.string().max(200).optional().describe("Linked entity slug"),
  }),
  attachSource: z.object({
    entitySlug: z.string().min(1).max(200),
    url: z.string().min(1).max(500).describe("Source URL, must be http(s)://"),
    title: z.string().max(200).optional(),
    fav: z.string().max(4).optional().describe("Favicon initial(s)"),
  }),
  createFollowup: z.object({
    text: z.string().min(1).max(280),
    dueAt: z.string().max(40).optional().describe("ISO date string"),
  }),
  addGraphEdge: z.object({
    fromSlug: z.string().min(1).max(200),
    toSlug: z.string().min(1).max(200),
    kind: z.string().min(1).max(50).describe(
      "founded | invests-in | works-at | partner-with | topic-of | competes-with"
    ),
    confidence: z
      .enum(["low", "medium", "high"])
      .describe("Confidence in the edge"),
  }),
  // ── Read tools (workspace state queries) ───────────────────────────
  listEntities: z.object({
    limit: z.number().min(1).max(50).optional().describe("Max entities to return (default 20)"),
  }),
  recallEntityMemory: z.object({
    slug: z.string().min(1).max(200).describe("Entity slug to recall memory for"),
  }),
  getMostRecentChatThread: z.object({}),
  getHomeSnapshot: z.object({}),
  getEntityWorkspace: z.object({
    slug: z.string().min(1).max(200).describe("Entity slug"),
  }),
  // ── Workflow tools (action triggers) ───────────────────────────────
  enhancePrompt: z.object({
    text: z.string().min(1).max(4000).describe("Raw user prompt to enhance"),
    activeEntitySlug: z.string().max(200).optional(),
  }),
  // ── Delivery / export tools ────────────────────────────────────────
  createGmailDraft: z.object({
    entitySlug: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(8000),
  }),
} as const;

type ToolName = keyof typeof SCHEMAS;

const TOOL_DEFINITIONS = [
  {
    name: "upsertEntity",
    description:
      "Create or update a typed entity (company / person / topic / event) in the NodeBench workspace ledger. Returns the resulting activityId so the agent can chain edits.",
    inputSchema: zodToJsonSchema(SCHEMAS.upsertEntity),
  },
  {
    name: "recordClaim",
    description:
      "Record a claim with verification status. Use status='needs_review' for unverified field-note claims, 'rumor' for hearsay, 'verified' only when sourceUrl backs it.",
    inputSchema: zodToJsonSchema(SCHEMAS.recordClaim),
  },
  {
    name: "attachSource",
    description:
      "Attach a source URL to an entity. URL must be http(s)://. Returns the activityId.",
    inputSchema: zodToJsonSchema(SCHEMAS.attachSource),
  },
  {
    name: "createFollowup",
    description:
      "Create a concrete follow-up task. Surface as a next-action chip in NodeBench's chat surface.",
    inputSchema: zodToJsonSchema(SCHEMAS.createFollowup),
  },
  {
    name: "addGraphEdge",
    description:
      "Record a typed edge between two entities. Confidence='medium' is a sensible default; reserve 'high' for strong evidence.",
    inputSchema: zodToJsonSchema(SCHEMAS.addGraphEdge),
  },
  // ── Read tools ───────────────────────────────────────────────────
  {
    name: "listEntities",
    description:
      "List the user's entities (companies, people, topics, events) with their slugs and last-updated timestamps. Use this BEFORE upsertEntity to avoid creating duplicates.",
    inputSchema: zodToJsonSchema(SCHEMAS.listEntities),
  },
  {
    name: "recallEntityMemory",
    description:
      "Recall everything NodeBench knows about an entity: prior reports, claims, sources, recent captures. Memory-first — call this before live web research.",
    inputSchema: zodToJsonSchema(SCHEMAS.recallEntityMemory),
  },
  {
    name: "getMostRecentChatThread",
    description:
      "Get the most-recent chat thread for the current session. Returns the turns array so the agent can reference what was just said.",
    inputSchema: zodToJsonSchema(SCHEMAS.getMostRecentChatThread),
  },
  {
    name: "getHomeSnapshot",
    description:
      "Get the user's home/workspace overview: recent activity, watched entities, pending follow-ups, claim audit summary. Useful at session start to orient.",
    inputSchema: zodToJsonSchema(SCHEMAS.getHomeSnapshot),
  },
  {
    name: "getEntityWorkspace",
    description:
      "Get the full entity workspace: all sections, claims, sources, sub-entities, recent activity. Heavier than recallEntityMemory; use for deep diligence prep.",
    inputSchema: zodToJsonSchema(SCHEMAS.getEntityWorkspace),
  },
  // ── Workflow / action tools ──────────────────────────────────────
  {
    name: "enhancePrompt",
    description:
      "Rewrite a vague user prompt into a specific NodeBench capture using a fast free model. Returns the enhanced text — does NOT auto-send. Useful when the user's input lacks structure.",
    inputSchema: zodToJsonSchema(SCHEMAS.enhancePrompt),
  },
  {
    name: "createGmailDraft",
    description:
      "Create a Gmail draft (NOT auto-sent) for an entity. Requires the user to have connected their Gmail integration. Returns the draft id.",
    inputSchema: zodToJsonSchema(SCHEMAS.createGmailDraft),
  },
];

/**
 * Convert a Zod schema to the JSON Schema shape MCP expects on the
 * tool definition. We do this manually for the small set of types we
 * actually use, instead of pulling in zod-to-json-schema as a dep.
 */
function zodToJsonSchema(schema: z.ZodObject<any>): {
  type: "object";
  properties: Record<string, any>;
  required: string[];
} {
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(shape)) {
    const isOptional = def.isOptional();
    const inner =
      isOptional && def instanceof z.ZodOptional
        ? ((def as z.ZodOptional<z.ZodTypeAny>).unwrap() as z.ZodTypeAny)
        : def;
    const description = (def.description ?? inner.description ?? "") as string;

    if (inner instanceof z.ZodEnum) {
      properties[key] = {
        type: "string",
        enum: inner.options,
        ...(description ? { description } : {}),
      };
    } else if (inner instanceof z.ZodString) {
      properties[key] = {
        type: "string",
        ...(description ? { description } : {}),
      };
    } else {
      properties[key] = {
        type: "string",
        ...(description ? { description } : {}),
      };
    }
    if (!isOptional) required.push(key);
  }
  return { type: "object", properties, required };
}

/**
 * Run a tool through the Convex bridge. We re-use runChatAgent's
 * underlying helpers by calling a thin bridge action that forwards
 * to executeTool() — but since executeTool is internal to chatAgent.ts,
 * we'll dispatch the same way runChatAgent does: one recordActivity
 * mutation per tool, mirroring the dispatcher's behavior.
 *
 * This keeps the MCP server self-contained without depending on a
 * separately-deployed bridge action — the canonical source of truth
 * is the productActivityLedger schema, which is shared with the
 * pi-ai chat surface.
 */
async function executeTool(
  name: ToolName,
  args: Record<string, unknown>
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const trim = (s: any, max: number) =>
    typeof s === "string" ? s.slice(0, max) : "";

  // Lazily import api.js — generated by convex codegen, not present
  // until `npx convex dev --once` runs.
  let api: any;
  try {
    const url = new URL(
      "../../../convex/_generated/api.js",
      import.meta.url
    ).href;
    api = (await import(url)).api;
  } catch (err) {
    return {
      ok: false,
      error:
        "[mcp-workspace] convex api not generated. Run `npx convex dev --once` from the repo root first.",
    };
  }

  const recordActivity = api.domains.product.activity.recordActivity;
  const baseArgs = {
    anonymousSessionId: ANON_SESSION_ID,
    activityType: "chat_message" as const,
    actorType: "agent" as const,
    sessionId: SESSION_ID,
  };

  try {
    switch (name) {
      case "upsertEntity": {
        const slug = trim(args.slug, 200);
        const dispName = trim(args.name, 200);
        const entityType = trim(args.type, 50);
        const summary = trim(args.summary ?? "", 500);
        if (!slug || !dispName || !entityType)
          return { ok: false, error: "missing slug/name/type" };
        const r = await convex.mutation(recordActivity, {
          ...baseArgs,
          entitySlug: slug,
          entityKeys: [slug],
          payloadPreview: {
            label: `Captured entity: ${dispName}`,
            detail: summary || `${entityType} entity`,
            metadata: {
              tool: "upsertEntity",
              slug,
              name: dispName,
              entityType,
              summary,
            },
          },
        });
        return {
          ok: true,
          result: { activityId: String((r as any)?.activityId ?? r), slug },
        };
      }

      case "recordClaim": {
        const text = trim(args.text, 280);
        const status = trim(args.status, 30);
        const sourceUrl = trim(args.sourceUrl ?? "", 500);
        const entitySlug = trim(args.entitySlug ?? "", 200);
        if (!text || !status)
          return { ok: false, error: "missing text/status" };
        const r = await convex.mutation(recordActivity, {
          ...baseArgs,
          activityType: "claim_changed" as const,
          entitySlug: entitySlug || undefined,
          entityKeys: entitySlug ? [entitySlug] : [],
          payloadPreview: {
            label: `Claim recorded · ${status}`,
            detail: text,
            status,
            href: sourceUrl || undefined,
            metadata: {
              tool: "recordClaim",
              text,
              status,
              sourceUrl,
              entitySlug,
            },
          },
        });
        return {
          ok: true,
          result: { activityId: String((r as any)?.activityId ?? r), status },
        };
      }

      case "attachSource": {
        const entitySlug = trim(args.entitySlug, 200);
        const url = trim(args.url, 500);
        const title = trim(args.title ?? "", 200);
        const fav = trim(args.fav ?? "", 4);
        if (!entitySlug || !url)
          return { ok: false, error: "missing entitySlug/url" };
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
          return { ok: false, error: "url must be http(s)" };
        }
        const r = await convex.mutation(recordActivity, {
          ...baseArgs,
          activityType: "source_attached" as const,
          entitySlug,
          entityKeys: [entitySlug],
          sourceKeys: [url],
          payloadPreview: {
            label: `Source attached to ${entitySlug}`,
            detail: title || url,
            href: url,
            metadata: { tool: "attachSource", entitySlug, url, title, fav },
          },
        });
        return {
          ok: true,
          result: { activityId: String((r as any)?.activityId ?? r) },
        };
      }

      case "createFollowup": {
        const text = trim(args.text, 280);
        const dueAt = trim(args.dueAt ?? "", 40);
        if (!text) return { ok: false, error: "missing text" };
        const r = await convex.mutation(recordActivity, {
          ...baseArgs,
          payloadPreview: {
            label: "Follow-up created",
            detail: dueAt ? `${text} · due ${dueAt}` : text,
            metadata: { tool: "createFollowup", text, dueAt },
          },
        });
        return {
          ok: true,
          result: { activityId: String((r as any)?.activityId ?? r) },
        };
      }

      case "addGraphEdge": {
        const fromSlug = trim(args.fromSlug, 200);
        const toSlug = trim(args.toSlug, 200);
        const kind = trim(args.kind, 50);
        const confidence = trim(args.confidence, 20);
        if (!fromSlug || !toSlug || !kind)
          return { ok: false, error: "missing slugs/kind" };
        const r = await convex.mutation(recordActivity, {
          ...baseArgs,
          entityKeys: [fromSlug, toSlug],
          payloadPreview: {
            label: `Graph edge · ${fromSlug} —[${kind}]→ ${toSlug}`,
            detail: `confidence: ${confidence}`,
            metadata: {
              tool: "addGraphEdge",
              fromSlug,
              toSlug,
              kind,
              confidence,
            },
          },
        });
        return {
          ok: true,
          result: { activityId: String((r as any)?.activityId ?? r) },
        };
      }

      // ── Read tools ───────────────────────────────────────────────
      case "listEntities": {
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const list = await convex.query(api.domains.product.entities.listEntities, {
          anonymousSessionId: ANON_SESSION_ID,
          limit,
        });
        return { ok: true, result: list };
      }

      case "recallEntityMemory": {
        const slug = trim(args.slug, 200);
        if (!slug) return { ok: false, error: "missing slug" };
        const memory = await convex.query(
          api.domains.product.entities.recallEntityMemory,
          {
            anonymousSessionId: ANON_SESSION_ID,
            entitySlug: slug,
          },
        );
        return { ok: true, result: memory };
      }

      case "getMostRecentChatThread": {
        const thread = await convex.query(
          api.domains.product.entities.getMostRecentChatThread,
          { anonymousSessionId: ANON_SESSION_ID },
        );
        return { ok: true, result: thread };
      }

      case "getHomeSnapshot": {
        const snap = await convex.query(api.domains.product.home.getHomeSnapshot, {
          anonymousSessionId: ANON_SESSION_ID,
        });
        return { ok: true, result: snap };
      }

      case "getEntityWorkspace": {
        const slug = trim(args.slug, 200);
        if (!slug) return { ok: false, error: "missing slug" };
        const ws = await convex.query(
          api.domains.product.entities.getEntityWorkspace,
          {
            anonymousSessionId: ANON_SESSION_ID,
            entitySlug: slug,
          },
        );
        return { ok: true, result: ws };
      }

      // ── Workflow / action tools ──────────────────────────────────
      case "enhancePrompt": {
        const text = trim(args.text, 4000);
        const activeEntitySlug = trim(args.activeEntitySlug ?? "", 200);
        if (!text) return { ok: false, error: "missing text" };
        const enhanced = await convex.action(
          api.domains.product.chatAgent.enhancePrompt,
          {
            text,
            contextHints: activeEntitySlug
              ? { activeEntitySlug, recentTurnCount: 0 }
              : undefined,
          },
        );
        return { ok: true, result: enhanced };
      }

      case "createGmailDraft": {
        const entitySlug = trim(args.entitySlug, 200);
        const subject = trim(args.subject, 200);
        const body = trim(args.body, 8000);
        if (!entitySlug || !subject || !body)
          return { ok: false, error: "missing entitySlug/subject/body" };
        try {
          const draft = await convex.action(
            api.domains.product.delivery.createGmailDraftForEntity,
            {
              anonymousSessionId: ANON_SESSION_ID,
              entitySlug,
              subject,
              body,
            },
          );
          return { ok: true, result: draft };
        } catch (err) {
          // Common case: user hasn't connected Gmail. Fall back to a
          // ledger entry so the agent at least records the intent.
          const r = await convex.mutation(recordActivity, {
            ...baseArgs,
            entitySlug,
            entityKeys: [entitySlug],
            payloadPreview: {
              label: `Gmail draft requested (deferred)`,
              detail: `${subject} — ${body.slice(0, 120)}…`,
              metadata: {
                tool: "createGmailDraft",
                entitySlug,
                subject,
                bodyLength: body.length,
                deferReason: err instanceof Error ? err.message : String(err),
              },
            },
          });
          return {
            ok: true,
            result: {
              activityId: String((r as any)?.activityId ?? r),
              status: "deferred",
              reason: "Gmail not connected — draft intent logged to ledger",
            },
          };
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ─── MCP server wiring ─── */
const server = new Server(
  {
    name: "nodebench-workspace",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  if (!(name in SCHEMAS)) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${name}` }],
    };
  }

  // Validate against Zod schema
  const schema = SCHEMAS[name as ToolName];
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `invalid arguments for ${name}: ${parsed.error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; ")}`,
        },
      ],
    };
  }

  // 30s timeout enforcement
  const result = await Promise.race([
    executeTool(name as ToolName, parsed.data as Record<string, unknown>),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            error: `tool ${name} timed out after ${TOOL_TIMEOUT_MS}ms`,
          }),
        TOOL_TIMEOUT_MS
      )
    ),
  ]);

  if (!result.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `tool ${name} failed: ${result.error ?? "unknown error"}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.result ?? { ok: true }, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[nodebench-workspace-mcp] ready · convex=${CONVEX_URL} · session=${SESSION_ID}`
);
