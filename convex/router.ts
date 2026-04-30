"use node";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PersistentTextStreaming, StreamId } from "@convex-dev/persistent-text-streaming";
import { components } from "./_generated/api";
import { createCoordinatorAgent } from "./domains/agents/core/coordinatorAgent";
import { DEFAULT_MODEL, normalizeModelInput } from "./domains/agents/mcp_tools/models";
import { z } from "zod";
import {
  createPlanHttp,
  deletePlanByIdHttp,
  getPlanByIdHttp,
  listPlansHttp,
  patchPlanByIdHttp,
} from "./domains/mcp/mcpPlansHttp";
import {
  createMemoryHttp,
  deleteMemoryByIdHttp,
  getMemoryByIdHttp,
  listMemoryHttp,
} from "./domains/mcp/mcpMemoryHttp";
import {
  mcpGatewayHandler,
  mcpGatewayCorsHandler,
} from "./domains/mcp/mcpGatewayDispatcher";
import {
  dailyBriefHttp,
  fundingSearchHttp,
  researchQueueHttp,
  publishToQueueHttp,
} from "./domains/mcp/mcpBridgeHttp";

const http = httpRouter();

const persistentTextStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming
);

// Helper: Base64 encode ASCII strings without relying on Node or browser globals.
// Used for HTTP Basic Authorization headers in environments without btoa/Buffer.
function base64EncodeAscii(input: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++);
    const c2 = input.charCodeAt(i++);
    const c3 = input.charCodeAt(i++);

    const enc1 = c1 >> 2;
    const enc2 = ((c1 & 0x03) << 4) | (isNaN(c2) ? 0 : (c2 >> 4));
    const enc3 = isNaN(c2) ? 64 : (((c2 & 0x0f) << 2) | (isNaN(c3) ? 0 : (c3 >> 6)));
    const enc4 = isNaN(c3) ? 64 : (c3 & 0x3f);

    output += chars.charAt(enc1);
    output += chars.charAt(enc2);
    output += enc3 === 64 ? "=" : chars.charAt(enc3);
    output += enc4 === 64 ? "=" : chars.charAt(enc4);
  }
  return output;
}

// Voice agent helpers - Import from integrations domain
import { voiceAction, voiceConnect } from "./domains/integrations/voice/voiceActions";

// Pi-AI Pipeline MCP HTTP bridge
import {
  runPipelineHttp,
  runComposedPipelineHttp,
  getPipelineStatusHttp,
  listPipelineRunsHttp,
} from "./domains/pipelines/pipelineMcpHttp";

// JSON-RPC 2.0 MCP-compatible endpoint (minimal, JSON-only)
// Methods supported:
// - initialize
// - tools/list
// - tools/call
// - resources/list (files metadata as resources)
http.route({
  path: "/api/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Not authenticated" }, id: null }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Helper builders
    const ok = (id: string | number | null, result: any, extraHeaders: Record<string, string> = {}) =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result }),
        { status: 200, headers: { "Content-Type": "application/json", ...extraHeaders } }
      );
    const err = (id: string | number | null, code: number, message: string, data?: any, status = 400) =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, data } }),
        { status, headers: { "Content-Type": "application/json" } }
      );

    let body: any;
    try {
      body = await request.json();
    } catch {
      return err(null, -32700, "Parse error", undefined, 400);
    }

    // Support only single-message (no batch) for now
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return err(body?.id ?? null, -32600, "Invalid Request");
    }

    const { id, method, params } = body as { id: string | number | null; method: string; params?: any };

    // Static tool registry (schemas kept lightweight for now)
    const toolList = [
      {
        name: "list_files",
        description: "List the current user's files (optionally by fileType)",
        schema: {
          type: "object",
          properties: {
            fileType: { type: "string", description: "Filter by fileType (e.g. 'pdf','csv','video')" },
            limit: { type: "number", description: "Max number of files to return" },
          },
        },
      },
      {
        name: "get_file_metadata",
        description: "Get metadata for a specific file the user owns",
        schema: {
          type: "object",
          required: ["fileId"],
          properties: {
            fileId: { type: "string", description: "Id of the file (Convex Id<\"files\">)" },
          },
        },
      },
      {
        name: "get_recent_analyses",
        description: "List recent file analyses for the current user",
        schema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max number of analyses to return" },
          },
        },
      },
      {
        name: "semantic_search",
        description: "Vector search via RAG over the global namespace",
        schema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Number of results" },
          },
        },
      },
      {
        name: "ask_rag",
        description: "Answer a question using hybrid RAG (vector + keyword)",
        schema: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "User question" },
          },
        },
      },
    ];

    try {
      switch (method) {
        case "initialize": {
          // Minimal init; no session handling yet
          return ok(id ?? null, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {}, resources: {} },
          });
        }
        case "tools/list": {
          return ok(id ?? null, { tools: toolList });
        }
        case "tools/call": {
          const name = params?.name as string | undefined;
          const args: any = params?.arguments ?? {};
          if (!name) return err(id ?? null, -32602, "Missing tool name");

          // Dispatch tools
          if (name === "list_files") {
            const { fileType, limit } = args as { fileType?: string; limit?: number };
            const files = await ctx.runQuery(api.domains.documents.files.getUserFiles, {
              fileType: fileType,
              limit: limit,
            });
            return ok(id ?? null, { tool: name, data: files });
          }

          if (name === "get_file_metadata") {
            const { fileId } = args as { fileId?: string };
            if (!fileId) return err(id ?? null, -32602, "fileId is required");
            const file = await ctx.runQuery(internal.domains.documents.files.getFile, { fileId: fileId as unknown as Id<"files"> });
            if (!file || file.userId !== identity.subject) {
              return err(id ?? null, -32001, "File not found or access denied", undefined, 404);
            }
            return ok(id ?? null, { tool: name, data: file });
          }

          if (name === "get_recent_analyses") {
            const { limit } = args as { limit?: number };
            const analyses = await ctx.runQuery(api.domains.documents.files.getRecentAnalyses, { limit });
            return ok(id ?? null, { tool: name, data: analyses });
          }

          if (name === "semantic_search") {
            const { query, limit } = args as { query?: string; limit?: number };
            if (!query) return err(id ?? null, -32602, "query is required");
            const results = await ctx.runAction(api.domains.search.rag.semanticSearch, { query, limit });
            return ok(id ?? null, { tool: name, data: results });
          }

          if (name === "ask_rag") {
            const { prompt } = args as { prompt?: string };
            if (!prompt) return err(id ?? null, -32602, "prompt is required");
            const result = await ctx.runAction(api.domains.search.rag.askQuestion, { prompt });
            return ok(id ?? null, { tool: name, data: result });
          }

          return err(id ?? null, -32601, `Method not found: tool '${name}'`);
        }
        case "resources/list": {
          // Expose user files as resources (metadata only for now)
          const files = await ctx.runQuery(api.domains.documents.files.getUserFiles, { limit: 100 });
          const resources = files.map((f: any) => ({
            uri: `nodebench://file/${f._id}`,
            name: f.fileName,
            mimeType: f.mimeType,
            description: `User file (${f.fileType})`,
          }));
          return ok(id ?? null, { resources });
        }
        default:
          return err(id ?? null, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Internal error";
      return err(id ?? null, -32000, message, undefined, 500);
    }
  }),
});

// -----------------------------------------------------------------------------
// MCP persistence endpoints (mcp-3): plan + memory storage for external MCP servers
// Auth: x-mcp-secret must match process.env.MCP_SECRET
// -----------------------------------------------------------------------------

// Plans (collection routes)
http.route({ path: "/api/mcpPlans", method: "POST", handler: createPlanHttp });
http.route({ path: "/api/mcpPlans", method: "GET", handler: listPlansHttp });
// Plans (item routes)
http.route({ pathPrefix: "/api/mcpPlans/", method: "GET", handler: getPlanByIdHttp });
http.route({ pathPrefix: "/api/mcpPlans/", method: "PATCH", handler: patchPlanByIdHttp });
http.route({ pathPrefix: "/api/mcpPlans/", method: "DELETE", handler: deletePlanByIdHttp });

// Memory (collection routes)
http.route({ path: "/api/mcpMemory", method: "POST", handler: createMemoryHttp });
http.route({ path: "/api/mcpMemory", method: "GET", handler: listMemoryHttp });
// Memory (item routes)
http.route({ pathPrefix: "/api/mcpMemory/", method: "GET", handler: getMemoryByIdHttp });
http.route({ pathPrefix: "/api/mcpMemory/", method: "DELETE", handler: deleteMemoryByIdHttp });

// MCP Bridge — platform intelligence endpoints for external MCP servers
// Auth: x-mcp-secret must match process.env.MCP_SECRET
http.route({ path: "/api/mcpBridge/daily-brief", method: "GET", handler: dailyBriefHttp });
http.route({ path: "/api/mcpBridge/funding", method: "GET", handler: fundingSearchHttp });
http.route({ path: "/api/mcpBridge/research", method: "GET", handler: researchQueueHttp });
http.route({ path: "/api/mcpBridge/publish", method: "POST", handler: publishToQueueHttp });

// MCP Gateway dispatcher — single endpoint for all 53 gateway tools
// Auth: x-mcp-secret must match process.env.MCP_SECRET
http.route({ path: "/api/mcpGateway", method: "POST", handler: mcpGatewayHandler });
http.route({ path: "/api/mcpGateway", method: "OPTIONS", handler: mcpGatewayCorsHandler });

http.route({
  path: "/api/stream/:runId",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const runIdParam = url.pathname.split("/").pop();

    if (!runIdParam) {
      return new Response("Missing runId", { status: 400 });
    }

    const runId = runIdParam;
    // Legacy function - aiAgents module doesn't exist
    // For now, just return a stub response since we can't access db from action context
    // const run = await ctx.runQuery(api.aiAgents.getAgentRun, { runId });
    // const run = await ctx.db.get(runId); // Can't use ctx.db in action
    const run = { _id: runId, status: "completed" }; // Stub
    if (!run) {
      return new Response("Run not found", { status: 404 });
    }

    const encoder = new TextEncoder();
    let lastSeq: number | undefined = undefined;
    let isClosed = false;

    const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, payload: any) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    };

    const loadEvents = async () => {
      // Legacy function - aiAgents module doesn't exist
      // const events = await ctx.runQuery(api.aiAgents.listAgentRunEvents, { runId });
      const events: any[] = []; // No events for now
      return events
        .filter((event: any) => (lastSeq === undefined ? true : event.seq > lastSeq))
        .sort((a: any, b: any) => a.seq - b.seq)
        .slice(-100);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sendEvent(controller, { kind: "sse.hello", message: "connected" });

        const dispatchInitial = async () => {
          try {
            const initialEvents = await loadEvents();
            for (const event of initialEvents) {
              lastSeq = event.seq;
              sendEvent(controller, {
                kind: event.kind,
                message: event.message,
                data: event.data,
                seq: event.seq,
                createdAt: event.createdAt,
              });
            }
          } catch (error: any) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "error", message: String(error?.message ?? "Failed to load events") })}\n\n`));
            controller.close();
            isClosed = true;
            return;
          }
        };

        void dispatchInitial();

        const interval = setInterval(() => {
          void (async () => {
            if (isClosed) return;
            try {
              const newEvents = await loadEvents();
              if (!newEvents.length) {
                controller.enqueue(encoder.encode(`: heartbeat\n\n`));
                return;
              }
              for (const event of newEvents) {
                lastSeq = event.seq;
                sendEvent(controller, {
                  kind: event.kind,
                  message: event.message,
                  data: event.data,
                  seq: event.seq,
                  createdAt: event.createdAt,
                });
              }
            } catch (error: any) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "error", message: String(error?.message ?? "Failed to load events") })}\n\n`));
              controller.close();
              isClosed = true;
            }
          })();
        }, 1500);

        controller.enqueue(encoder.encode(`retry: 5000\n\n`));

        return () => {
          clearInterval(interval);
          isClosed = true;
        };
      },
      cancel() {
        isClosed = true;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// Google OAuth start
http.route({
  path: "/api/google/oauth/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response("Unauthorized", { status: 401 });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const scope = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" ");
    const url = new URL(request.url);
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/google/oauth/callback`;
    if (!clientId) {
      return new Response("Missing GOOGLE_CLIENT_ID env", { status: 500 });
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", identity.subject);

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  }),
});

  // Google OAuth callback
  http.route({
    path: "/api/google/oauth/callback",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
    // The state parameter contains the user's identity.subject from the OAuth start
    // We use this to identify the user since the callback is a direct browser redirect
    // and doesn't have the auth context
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!state) {
      return new Response("Missing state parameter", { status: 400 });
    }

    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) {
      return new Response(`OAuth error: ${err}`, { status: 400 });
    }
    if (!code) {
      return new Response("Missing code", { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/google/oauth/callback`;
    if (!clientId || !clientSecret) {
      return new Response("Missing Google OAuth env vars", { status: 500 });
    }

    const tokenEndpoint = "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(`Token exchange failed: ${text}`, { status: 500 });
    }
    const tokenJson = await tokenRes.json();
    const accessToken: string | undefined = tokenJson.access_token;
    const refreshToken: string | undefined = tokenJson.refresh_token;
    const expiresIn: number | undefined = tokenJson.expires_in;
    const tokenType: string | undefined = tokenJson.token_type;
    const scope: string | undefined = tokenJson.scope;
    const expiryDate = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

    if (!accessToken) {
      return new Response("No access token in response", { status: 500 });
    }

    // Fetch user email
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let email: string | undefined;
    if (userInfoRes.ok) {
      const info = await userInfoRes.json();
      email = info.email as string | undefined;
    }

    const refs = await import("./_generated/api");
    // Pass the userId (from state) to saveTokens so it can associate tokens with the correct user
    await ctx.runMutation((refs as any).internal.domains.integrations.gmail.saveTokens, {
      userId: state,
      email,
      accessToken,
      refreshToken,
      scope,
      expiryDate,
      tokenType,
    });
    // Note: Gmail sync will be triggered by the user from the UI after redirect
    // The tokens are already saved with the correct userId from the state parameter

    // Redirect back to the app (localhost for dev, or production URL)
    const postRedirect = process.env.GOOGLE_POST_LOGIN_REDIRECT || "http://localhost:5173";
    return new Response(null, { status: 302, headers: { Location: postRedirect } });
  }),
});

// Slack OAuth start
http.route({
  path: "/api/slack/oauth/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const clientId = process.env.SLACK_CLIENT_ID;
    const scope = process.env.SLACK_SCOPES || "chat:write users:read channels:read";
    const redirectUri = process.env.SLACK_REDIRECT_URI || `${url.origin}/api/slack/oauth/callback`;
    if (!clientId) return new Response("Missing SLACK_CLIENT_ID env", { status: 500 });

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", identity.subject);

    return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
  }),
});

// Slack OAuth callback
http.route({
  path: "/api/slack/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) return new Response(`OAuth error: ${err} `, { status: 400 });
    if (!code) return new Response("Missing code", { status: 400 });

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = process.env.SLACK_REDIRECT_URI || `${url.origin}/api/slack/oauth/callback`;
    if (!clientId || !clientSecret) return new Response("Missing Slack OAuth env", { status: 500 });

    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.ok) {
      return new Response(`Token exchange failed: ${JSON.stringify(tokenJson)}`, { status: 500 });
    }

    const access_token = tokenJson.access_token as string;
    const scope = tokenJson.scope as string | undefined;
    const token_type = tokenJson.token_type as string | undefined;
    const bot_user_id = tokenJson.bot_user_id as string | undefined;
    const team = tokenJson.team as { id?: string; name?: string } | undefined;
    const authed_user = tokenJson.authed_user as { id?: string; access_token?: string } | undefined;

    const refs = await import("./_generated/api");
    await ctx.runMutation((refs as any).internal.domains.integrations.integrations.slackSaveTokens, {
      teamId: team?.id,
      teamName: team?.name,
      botUserId: bot_user_id,
      authedUserId: authed_user?.id,
      accessToken: access_token,
      userAccessToken: authed_user?.access_token,
      scope,
      tokenType: token_type,
    });
    // Enqueue Slack sync
    await ctx.runMutation((refs as any).internal.domains.documents.syncMutations.enqueueSlackSync, {});

    const postRedirect = process.env.SLACK_POST_LOGIN_REDIRECT || "/";
    return new Response(null, { status: 302, headers: { Location: postRedirect } });
  }),
});

// GitHub OAuth start
http.route({
  path: "/api/github/oauth/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const clientId = process.env.GITHUB_CLIENT_ID;
    const scope = process.env.GITHUB_SCOPES || "read:user";
    const redirectUri = process.env.GITHUB_REDIRECT_URI || `${url.origin}/api/github/oauth/callback`;
    if (!clientId) return new Response("Missing GITHUB_CLIENT_ID env", { status: 500 });

    const authUrl = new URL("https://github.com/login/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", identity.subject);
    authUrl.searchParams.set("allow_signup", "true");

    return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
  }),
});

// GitHub OAuth callback
http.route({
  path: "/api/github/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) return new Response(`OAuth error: ${err}`, { status: 400 });
    if (!code) return new Response("Missing code", { status: 400 });

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI || `${url.origin}/api/github/oauth/callback`;
    if (!clientId || !clientSecret) return new Response("Missing GitHub OAuth env", { status: 500 });

    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(`Token exchange failed: ${text}`, { status: 500 });
    }
    const tokenJson = await tokenRes.json();
    const access_token = tokenJson.access_token as string | undefined;
    const token_type = tokenJson.token_type as string | undefined;
    const scope = tokenJson.scope as string | undefined;
    if (!access_token) return new Response("No access token", { status: 500 });

    // Fetch username
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.github+json" },
    });
    let username: string | undefined;
    if (userRes.ok) {
      const info = await userRes.json();
      username = info.login as string | undefined;
    }

    const refs = await import("./_generated/api");
    await ctx.runMutation((refs as any).internal.domains.integrations.integrations.githubSaveTokens, {
      username,
      accessToken: access_token,
      scope,
      tokenType: token_type,
    });
    // Enqueue GitHub sync
    await ctx.runMutation((refs as any).internal.domains.documents.syncMutations.enqueueGithubSync, {});

    const postRedirect = process.env.GITHUB_POST_LOGIN_REDIRECT || "/";
    return new Response(null, { status: 302, headers: { Location: postRedirect } });
  }),
});

// Notion OAuth start
http.route({
  path: "/api/notion/oauth/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const clientId = process.env.NOTION_CLIENT_ID;
    const redirectUri = process.env.NOTION_REDIRECT_URI || `${url.origin}/api/notion/oauth/callback`;
    if (!clientId) return new Response("Missing NOTION_CLIENT_ID env", { status: 500 });

    const authUrl = new URL("https://api.notion.com/v1/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("owner", "user");
    authUrl.searchParams.set("state", identity.subject);

    return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
  }),
});

// Notion OAuth callback
http.route({
  path: "/api/notion/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) return new Response(`OAuth error: ${err}`, { status: 400 });
    if (!code) return new Response("Missing code", { status: 400 });

    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI || `${url.origin}/api/notion/oauth/callback`;
    if (!clientId || !clientSecret) return new Response("Missing Notion OAuth env", { status: 500 });

    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + base64EncodeAscii(`${clientId}:${clientSecret}`),
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(`Token exchange failed: ${text}`, { status: 500 });
    }
    const tokenJson = await tokenRes.json();
    const access_token = tokenJson.access_token as string | undefined;
    const workspace_id = tokenJson.workspace_id as string | undefined;
    const workspace_name = tokenJson.workspace_name as string | undefined;
    const bot_id = tokenJson.bot_id as string | undefined;
    if (!access_token) return new Response("No access token", { status: 500 });

    const refs = await import("./_generated/api");
    await ctx.runMutation((refs as any).internal.domains.integrations.integrations.notionSaveTokens, {
      workspaceId: workspace_id,
      workspaceName: workspace_name,
      botId: bot_id,
      accessToken: access_token,
    });
    // Enqueue Notion sync
    await ctx.runMutation((refs as any).internal.domains.documents.syncMutations.enqueueNotionSync, {});

    const postRedirect = process.env.NOTION_POST_LOGIN_REDIRECT || "/";
    return new Response(null, { status: 302, headers: { Location: postRedirect } });
  }),
});

// MCP endpoints
http.route({
  path: "/api/mcp/connect",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { url, name, apiKey } = await request.json();

      if (!url || !name) {
        return new Response(JSON.stringify({ error: "URL and name are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Try to create the server; if it already exists, fall back to the existing id.
      let serverId: Id<"mcpServers"> | null = null;
      try {
        serverId = await ctx.runMutation(api.domains.mcp.mcp.addMcpServer, { name, url, apiKey });
      } catch (err: any) {
        const alreadyExists = err instanceof Error && err.message?.includes("already exists");
        if (!alreadyExists) {
          throw err;
        }
        const existing = await ctx.runQuery(api.domains.mcp.mcp.listMcpServers, {});
        const match = existing.find((s: any) => s.name === name);
        serverId = match?._id ?? null;
      }

      if (!serverId) {
        return new Response(JSON.stringify({ error: "Unable to register MCP server" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Kick off connection and tool discovery (non-blocking)
      await ctx.runAction(internal.domains.mcp.mcp.connectToServer, { serverId });

      // Return currently discovered tools
      const tools = await ctx.runQuery(api.domains.mcp.mcp.getMcpTools, { serverId, availableOnly: true });

      return new Response(
        JSON.stringify({
          serverId,
          serverName: name,
          tools,
          message: "MCP server registered and connection initiated",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to connect to MCP server" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/api/mcp/disconnect",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { serverId } = await request.json();
      if (!serverId) {
        return new Response(JSON.stringify({ error: "serverId is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      await ctx.runAction(internal.domains.mcp.mcp.disconnectFromServer, { serverId });
      return new Response(JSON.stringify({ message: "Disconnected from MCP server", serverId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to disconnect from MCP server" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

http.route({
  path: "/api/mcp/invoke",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { serverId, toolName, args } = await request.json();
      if (!toolName) {
        return new Response(JSON.stringify({ error: "toolName is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await ctx.runAction((api as any).domains.mcp.mcpClient.callMcpTool, {
        serverId,
        toolName,
        parameters: args ?? {},
      });

      return new Response(
        JSON.stringify({
          result: result.result,
          success: result.success,
          error: result.error,
          serverId: result.serverId ?? serverId,
          serverName: result.serverName,
        }),
        { status: result.success ? 200 : 500, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to invoke MCP tool" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

// Persistent Text Streaming endpoint for FastAgentPanel

// CORS preflight handler
http.route({
  path: "/api/chat-stream",
  method: "OPTIONS",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", origin ?? "*");
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }),
});

http.route({
  path: "/api/chat-stream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("Origin");
    const { streamId, model } = (await request.json()) as {
      streamId: string;
      model?: string;
    };

    try {
      const streamingMessage = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getMessageByStreamId, {
        streamId,
      });

      if (!streamingMessage) {
        return new Response(JSON.stringify({ error: "Message not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin ?? "*",
          },
        });
      }

      const streamingThread = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getThreadByStreamId, {
        threadId: streamingMessage.threadId,
      });

      if (!streamingThread || !streamingThread.agentThreadId) {
        return new Response(JSON.stringify({ error: "Thread configuration error" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin ?? "*",
          },
        });
      }

      const messages = await ctx.runQuery(internal.domains.agents.fastAgentPanelStreaming.getThreadMessagesForStreaming, {
        threadId: streamingMessage.threadId,
      });

      const lastUserMessage = messages
        .filter((m: any) => m.role === "user" && m._id !== streamingMessage._id && m.content?.trim())
        .pop();

      if (!lastUserMessage || !lastUserMessage.content) {
        return new Response(JSON.stringify({ error: "No user message found" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin ?? "*",
          },
        });
      }

      const prompt = lastUserMessage.content;
      const threadModel = (streamingThread)?.model as string | undefined;
      const modelName = normalizeModelInput(model || threadModel || DEFAULT_MODEL);
      const agentThreadId = streamingThread.agentThreadId;
      console.log(`[chat-stream-agent] Prompt: "${prompt.substring(0, 50)}..." for thread ${agentThreadId} with model ${modelName}`);

      const chatAgent = createCoordinatorAgent(modelName);

      const generateChat = async (
        innerCtx: any,
        _requestContext: any,
        _stream: StreamId,
        chunkAppender: (chunk: string) => Promise<void>
      ) => {
        let fullResponse = "";
        try {
          const { messageId: promptMessageId } = await chatAgent.saveMessage(innerCtx, {
            threadId: agentThreadId,
            prompt,
          });

          const result = await chatAgent.streamText(innerCtx, { threadId: agentThreadId }, { promptMessageId });

          if (result.messageId) {
            await ctx.runMutation(internal.domains.agents.fastAgentPanelStreaming.markStreamStarted, {
              messageId: streamingMessage._id,
              agentMessageId: result.messageId,
            });
          }

          for await (const chunk of result.textStream) {
            fullResponse += chunk;
            await chunkAppender(chunk);
          }

          await ctx.runMutation(internal.domains.agents.fastAgentPanelStreaming.markStreamComplete, {
            messageId: streamingMessage._id,
            finalContent: fullResponse,
            status: "complete",
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          await chunkAppender(`Error: ${errorMsg}`);

          await ctx.runMutation(internal.domains.agents.fastAgentPanelStreaming.markStreamComplete, {
            messageId: streamingMessage._id,
            finalContent: fullResponse || `Error: ${errorMsg}`,
            status: "error",
          });
        }
      };

      const response = await persistentTextStreaming.stream(
        ctx,
        request,
        streamId as StreamId,
        generateChat
      );

      response.headers.set("Access-Control-Allow-Origin", origin ?? "*");
      response.headers.set("Vary", "Origin");
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");

      return response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[chat-stream-agent] ERROR:`, error);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin ?? "*",
        },
      });
    }
  }),
});

// Voice agent endpoints (for RTVI / Daily bots)
http.route({
  path: "/voice/connect",
  method: "POST",
  handler: voiceConnect,
});

http.route({
  path: "/voice/action",
  method: "POST",
  handler: voiceAction,
});

// ============================================================================
// Pi-AI Pipeline MCP HTTP bridge — external agents drive pipelines via curl
// Auth: x-mcp-secret header matching MCP_SECRET env var.
// ============================================================================

http.route({ path: "/mcp/pipeline/run", method: "POST", handler: runPipelineHttp });
http.route({
  path: "/mcp/pipeline/run-composed",
  method: "POST",
  handler: runComposedPipelineHttp,
});
http.route({ path: "/mcp/pipeline/status", method: "GET", handler: getPipelineStatusHttp });
http.route({ path: "/mcp/pipeline/list", method: "GET", handler: listPipelineRunsHttp });

// ============================================================================
// Twilio SMS Webhooks (for A2P 10DLC compliance)
// ============================================================================

/**
 * Incoming SMS webhook - receives messages from users
 * Handles: STOP, HELP, START, and conversational replies
 * Twilio sends form-urlencoded POST with: From, To, Body, MessageSid, etc.
 */
http.route({
  path: "/twilio/sms/incoming",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Parse form-urlencoded body from Twilio
      const formData = await request.formData();
      const from = formData.get("From") as string;
      const to = formData.get("To") as string;
      const body = (formData.get("Body") as string || "").trim();
      const messageSid = formData.get("MessageSid") as string;

      console.log(`[twilio/sms/incoming] From: ${from}, Body: "${body}", SID: ${messageSid}`);

      // Normalize the message for keyword detection
      const normalizedBody = body.toUpperCase();

      // Standard TCPA/A2P compliance keywords
      const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
      const HELP_KEYWORDS = ["HELP", "INFO"];
      const START_KEYWORDS = ["START", "YES", "SUBSCRIBE", "UNSTOP"];

      let responseMessage = "";

      if (STOP_KEYWORDS.includes(normalizedBody)) {
        // User wants to opt-out
        // Note: Twilio automatically handles STOP at the carrier level, but we log it
        await ctx.runMutation(internal.domains.integrations.sms.handleSmsOptOut, { phoneNumber: from });
        responseMessage = "You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe.";
        console.log(`[twilio/sms/incoming] Opt-out processed for ${from}`);
      } else if (HELP_KEYWORDS.includes(normalizedBody)) {
        // User needs help
        responseMessage = "NodeBench AI SMS Notifications. Reply STOP to unsubscribe. Msg&Data Rates May Apply. For support visit nodebench.ai/help";
      } else if (START_KEYWORDS.includes(normalizedBody)) {
        // User wants to opt back in
        await ctx.runMutation(internal.domains.integrations.sms.handleSmsOptIn, { phoneNumber: from });
        responseMessage = "NodeBench AI: You're now subscribed to SMS notifications. Reply HELP for support or STOP to unsubscribe at any time.";
        console.log(`[twilio/sms/incoming] Opt-in processed for ${from}`);
      } else {
        // Log the incoming message for potential agent processing
        await ctx.runMutation(internal.domains.integrations.sms.logIncomingSms, {
          from,
          to,
          body,
          messageSid,
        });
        // Don't auto-reply to conversational messages - agent will handle if needed
        responseMessage = "";
      }

      // Return TwiML response
      const twiml = responseMessage
        ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMessage}</Message></Response>`
        : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

      return new Response(twiml, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    } catch (error) {
      console.error("[twilio/sms/incoming] Error:", error);
      // Return empty TwiML to acknowledge receipt
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }
  }),
});

/**
 * SMS Status callback - receives delivery status updates
 * Twilio sends: MessageSid, MessageStatus, ErrorCode, etc.
 */
http.route({
  path: "/twilio/sms/status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const formData = await request.formData();
      const messageSid = formData.get("MessageSid") as string;
      const messageStatus = formData.get("MessageStatus") as string;
      const errorCode = formData.get("ErrorCode") as string | null;

      console.log(`[twilio/sms/status] SID: ${messageSid}, Status: ${messageStatus}, Error: ${errorCode || "none"}`);

      // Update the SMS log with delivery status
      await ctx.runMutation(internal.domains.integrations.sms.updateSmsStatus, {
        messageSid,
        status: messageStatus,
        errorCode: errorCode || undefined,
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("[twilio/sms/status] Error:", error);
      return new Response("OK", { status: 200 });
    }
  }),
});

export default http;
// Billing: Dev upgrade (no Stripe)
http.route({
  path: "/api/billing/dev-upgrade",
  method: "GET",
  handler: httpAction(async (ctx, _request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const refs = await import("./_generated/api");
      await ctx.runMutation((refs as any).internal.domains.billing.billing.activateSubscription, {
        userId: identity.subject as Id<"users">,
        source: "dev",
      });
      return new Response(null, { status: 302, headers: { Location: "/?billing=upgraded" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`Upgrade failed: ${msg}`, { status: 500 });
    }
  }),
});

// Billing: Stripe success redirect
http.route({
  path: "/api/billing/success",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");
    const identity = await ctx.auth.getUserIdentity();
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

    if (!sessionId) {
      return new Response("Missing session_id", { status: 400 });
    }

    let targetUserId: Id<"users"> | null = null;
    let paymentIntentId: string | undefined;

    if (STRIPE_SECRET_KEY) {
      try {
        const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        });
        if (!res.ok) {
          const text = await res.text();
          return new Response(`Stripe fetch error: ${text}`, { status: 500 });
        }
        const data: any = await res.json();
        paymentIntentId = data.payment_intent ?? undefined;
        const metaUserId: string | undefined = data.metadata?.userId;
        if (metaUserId) {
          targetUserId = metaUserId as unknown as Id<"users">;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Stripe verify failed: ${msg}`, { status: 500 });
      }
    } else {
      // No Stripe configured; fall back to current user
      if (identity) targetUserId = identity.subject as Id<"users">;
    }

    if (!targetUserId) {
      // Fallback: use current identity if available
      if (identity) {
        targetUserId = identity.subject as Id<"users">;
      } else {
        return new Response("Unable to determine user", { status: 400 });
      }
    }

    try {
      const refs = await import("./_generated/api");
      await ctx.runMutation((refs as any).internal.domains.billing.billing.activateSubscription, {
        userId: targetUserId,
        source: STRIPE_SECRET_KEY ? "stripe" : "dev",
        sessionId,
        paymentIntentId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`Activation failed: ${msg}`, { status: 500 });
    }

    return new Response(null, { status: 302, headers: { Location: "/?billing=upgraded" } });
  }),
});
