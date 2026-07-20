/**
 * Voice Agent — Gemini Live API Function Declarations
 *
 * Defines tools that Gemini can call during a live voice session.
 * Tools are sent in the WebSocket config message and executed client-side
 * when Gemini returns a toolCall event.
 *
 * Also exports server-side tool executors for when tool calls
 * need to hit the Convex backend.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

// ── Convex client ──────────────────────────────────────────────────────────

let _convex: ConvexHttpClient | null = null;
function getConvex(): ConvexHttpClient {
  if (!_convex) {
    const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
    if (!convexUrl) {
      throw new Error("CONVEX_URL environment variable is required");
    }
    _convex = new ConvexHttpClient(convexUrl);
  }
  return _convex;
}

// ── Gemini Function Declarations ───────────────────────────────────────────

/**
 * Returns Gemini-format tool declarations for the Live API config message.
 * These are sent when the WebSocket session is established.
 */
export function getGeminiVoiceTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "search_documents",
          description: "Search through the user's documents by content or title",
          parameters: {
            type: "object" as const,
            properties: {
              query: { type: "string" as const, description: "Search query" },
              limit: { type: "number" as const, description: "Max results (default 5)" },
            },
            required: ["query"],
          },
        },
        {
          name: "get_document",
          description: "Get the full content of a specific document by ID",
          parameters: {
            type: "object" as const,
            properties: {
              documentId: { type: "string" as const, description: "Document ID" },
            },
            required: ["documentId"],
          },
        },
        {
          name: "create_document",
          description: "Create a new document with title and content",
          parameters: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const, description: "Document title" },
              body: { type: "string" as const, description: "Document content" },
            },
            required: ["title", "body"],
          },
        },
        {
          name: "search_web",
          description: "Search the web for current information",
          parameters: {
            type: "object" as const,
            properties: {
              query: { type: "string" as const, description: "Search query" },
            },
            required: ["query"],
          },
        },
        {
          name: "list_tasks",
          description: "List the user's tasks",
          parameters: {
            type: "object" as const,
            properties: {
              start: { type: "number" as const, description: "Start timestamp (ms)" },
              end: { type: "number" as const, description: "End timestamp (ms)" },
            },
          },
        },
        {
          name: "create_task",
          description: "Create a new task for the user",
          parameters: {
            type: "object" as const,
            properties: {
              title: { type: "string" as const, description: "Task title" },
              description: { type: "string" as const, description: "Task description" },
              dueDate: { type: "string" as const, description: "Due date (ISO format)" },
              priority: { type: "string" as const, description: "Priority level" },
            },
            required: ["title"],
          },
        },
      ],
    },
  ];
}

// ── Server-side tool executors ─────────────────────────────────────────────

type ToolResult = Record<string, unknown>;

/**
 * Execute a tool call from Gemini and return the result.
 * Called by the server when it proxies tool calls, or by the client
 * via a POST endpoint.
 */
export async function executeVoiceTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_documents": {
        const results = await getConvex().query(api.documents.search, {
          query: String(args.query ?? ""),
          limit: typeof args.limit === "number" ? args.limit : 5,
        });
        return {
          count: results.length,
          documents: results.map((doc: Record<string, unknown>) => ({
            id: doc._id,
            title: doc.title,
            snippet: typeof doc.body === "string" ? doc.body.slice(0, 200) : "",
          })),
        };
      }

      case "get_document": {
        const doc = await getConvex().query(api.documents.getDocument, {
          documentId: String(args.documentId) as never,
        });
        if (!doc) return { error: "Document not found" };
        return { id: doc._id, title: doc.title, body: doc.body };
      }

      case "create_document": {
        const docId = await getConvex().mutation(api.documents.createDocument, {
          title: String(args.title ?? "Untitled"),
          body: String(args.body ?? ""),
          userId,
        });
        return { success: true, documentId: docId, message: `Created "${args.title}"` };
      }

      case "search_web": {
        const nodebenchUrl = (process.env.NODEBENCH_API_URL ?? "").replace(/\/+$/, "");
        const allowPaidSearch =
          process.env.NODEBENCH_ALLOW_PAID_SEARCH === "true" ||
          process.env.LINKUP_SEARCH_ALLOW_PAID === "true";
        if (nodebenchUrl) {
          const apiKey = process.env.NODEBENCH_API_KEY ?? process.env.NODEBENCH_API_TOKEN ?? "";
          const response = await fetch(`${nodebenchUrl}/v1/search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
              query: String(args.query),
              mode: "fast",
              outputType: "searchResults",
              maxResults: 3,
              includeSources: true,
              allowPaidSearch,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) return { error: `Search failed: ${response.status}` };
          const data = (await response.json()) as any;
          return {
            answer: "",
            sources: (data.results ?? []).slice(0, 3).map((s: any) => ({
              name: s.title ?? s.name,
              url: s.url,
              snippet: String(s.snippet ?? "").slice(0, 150),
            })),
          };
        }

        if (!allowPaidSearch) return { error: "NodeBench search route not configured; paid Linkup fallback disabled" };
        const apiKey = process.env.LINKUP_API_KEY;
        if (!apiKey) return { error: "Linkup API key not configured" };
        const response = await fetch("https://api.linkup.so/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ q: String(args.query), depth: "standard", outputType: "sourcedAnswer" }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return { error: `Search failed: ${response.status}` };
        const data = (await response.json()) as { answer?: string; sources?: Array<{ name?: string; url?: string; snippet?: string }> };
        return {
          answer: data.answer,
          sources: data.sources?.slice(0, 3).map((s) => ({ name: s.name, url: s.url, snippet: s.snippet?.slice(0, 150) })),
        };
      }

      case "list_tasks": {
        const tasks = await getConvex().query(api.documentTasks.listTasks, {
          start: typeof args.start === "number" ? args.start : undefined,
          end: typeof args.end === "number" ? args.end : undefined,
        });
        return {
          count: tasks.length,
          tasks: tasks.map((t: Record<string, unknown>) => ({
            id: t._id, title: t.title, status: t.status, priority: t.priority,
          })),
        };
      }

      case "create_task": {
        const taskId = await getConvex().mutation(api.documentTasks.createTask, {
          title: String(args.title ?? "Untitled"),
          description: typeof args.description === "string" ? args.description : undefined,
          dueDate: typeof args.dueDate === "string" ? new Date(args.dueDate).getTime() : undefined,
          priority: typeof args.priority === "string" ? args.priority : undefined,
        });
        return { success: true, taskId, message: `Created task "${args.title}"` };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    console.error(`[voice-tool] ${name} error:`, error);
    return { error: `Tool execution failed: ${error instanceof Error ? error.message : "Unknown"}` };
  }
}
