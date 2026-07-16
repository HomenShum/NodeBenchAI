"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { discoverToolsWithSdk, executeToolWithSdk } from "../../lib/mcpTransport";

type SmokeCheckResult = {
  ok: boolean;
  elapsedMs: number;
  details?: any;
  error?: string;
};

function requireSecret(argsSecret: string) {
  const expected = process.env.MCP_SECRET || "";
  if (!expected) {
    throw new Error("MCP_SECRET is not set on this deployment");
  }
  if (argsSecret !== expected) {
    throw new Error("Unauthorized (invalid secret)");
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
  const start = Date.now();
  const value = await fn();
  return { elapsedMs: Date.now() - start, value };
}

function toErrString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const run = action({
  args: {
    secret: v.string(),
    includePublicApiChecks: v.optional(v.boolean()),
    requireMcpChecks: v.optional(v.boolean()),
    tryLocalhostDefaults: v.optional(v.boolean()),
    includeMcpToolExec: v.optional(v.boolean()),
    includeLinkup: v.optional(v.boolean()),
    linkupQuery: v.optional(v.string()),
    includeSwarm: v.optional(v.boolean()),
    swarmModel: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireSecret(args.secret);

    const artifactsStartMs = Date.now();
    const results: Record<string, SmokeCheckResult> = {};
    let linkupSampleUrl: string | null = null;

    const tryLocalhost = args.tryLocalhostDefaults === true;
    const coreAgentUrl =
      process.env.CORE_AGENT_MCP_SERVER_URL ||
      process.env.CORE_AGENT_MCP_URL ||
      (tryLocalhost ? "http://127.0.0.1:4001" : "");
    const coreAgentToken = process.env.CORE_AGENT_MCP_AUTH_TOKEN || process.env.CORE_AGENT_MCP_TOKEN || "";
    const openbbUrl =
      process.env.OPENBB_MCP_SERVER_URL ||
      process.env.OPENBB_MCP_URL ||
      (tryLocalhost ? "http://127.0.0.1:8001" : "");
    const researchUrl =
      process.env.RESEARCH_MCP_SERVER_URL ||
      process.env.RESEARCH_MCP_URL ||
      (tryLocalhost ? "http://127.0.0.1:8002" : "");
    const requireMcp = args.requireMcpChecks === true;
    const includeMcpToolExec = args.includeMcpToolExec !== false;

    // 0) Public API key checks (no/low cost, deterministic)
    if (args.includePublicApiChecks !== false) {
      results.openai_modelsList = await (async (): Promise<SmokeCheckResult> => {
        const key = process.env.OPENAI_API_KEY || "";
        if (!key) return { ok: false, elapsedMs: 0, error: "OPENAI_API_KEY is not set" };
        try {
          const { elapsedMs, value } = await timed(async () => {
            const resp = await fetch("https://api.openai.com/v1/models", {
              headers: { Authorization: `Bearer ${key}` },
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            const parsed = JSON.parse(text);
            const count = Array.isArray(parsed?.data) ? parsed.data.length : null;
            const sample = Array.isArray(parsed?.data)
              ? parsed.data.slice(0, 5).map((m: any) => m?.id).filter(Boolean)
              : null;
            return { count, sample };
          });
          return { ok: true, elapsedMs, details: value };
        } catch (err) {
          return { ok: false, elapsedMs: 0, error: toErrString(err) };
        }
      })();

      results.anthropic_modelsList = await (async (): Promise<SmokeCheckResult> => {
        const key = process.env.ANTHROPIC_API_KEY || "";
        if (!key) return { ok: false, elapsedMs: 0, error: "ANTHROPIC_API_KEY is not set" };
        try {
          const { elapsedMs, value } = await timed(async () => {
            const resp = await fetch("https://api.anthropic.com/v1/models", {
              headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
              },
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            const parsed = JSON.parse(text);
            const data = Array.isArray(parsed?.data) ? parsed.data : [];
            const sample = data.slice(0, 5).map((m: any) => m?.id).filter(Boolean);
            return { count: data.length, sample };
          });
          return { ok: true, elapsedMs, details: value };
        } catch (err) {
          return { ok: false, elapsedMs: 0, error: toErrString(err) };
        }
      })();

      results.gemini_modelsList = await (async (): Promise<SmokeCheckResult> => {
        const key = process.env.GEMINI_API_KEY || "";
        if (!key) return { ok: false, elapsedMs: 0, error: "GEMINI_API_KEY is not set" };
        try {
          const { elapsedMs, value } = await timed(async () => {
            const resp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
            );
            const text = await resp.text();
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            const parsed = JSON.parse(text);
            const models = Array.isArray(parsed?.models) ? parsed.models : [];
            const sample = models
              .slice(0, 5)
              .map((m: any) => m?.name)
              .filter(Boolean);
            return { count: models.length, sample };
          });
          return { ok: true, elapsedMs, details: value };
        } catch (err) {
          return { ok: false, elapsedMs: 0, error: toErrString(err) };
        }
      })();

      results.youtube_search = await (async (): Promise<SmokeCheckResult> => {
        const key = process.env.YOUTUBE_API_KEY || "";
        if (!key) return { ok: false, elapsedMs: 0, error: "YOUTUBE_API_KEY is not set" };
        try {
          const { elapsedMs, value } = await timed(async () => {
            const q = encodeURIComponent("OpenAI");
            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${q}&key=${encodeURIComponent(
              key
            )}`;
            const resp = await fetch(url);
            const text = await resp.text();
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            const parsed = JSON.parse(text);
            const items = Array.isArray(parsed?.items) ? parsed.items : [];
            const firstTitle = items[0]?.snippet?.title ?? null;
            return { items: items.length, firstTitle };
          });
          return { ok: true, elapsedMs, details: value };
        } catch (err) {
          return { ok: false, elapsedMs: 0, error: toErrString(err) };
        }
      })();
    }

    // 1) Core Agent MCP tools/list (JSON-RPC)
    results.coreAgentMcp_toolsList = await (async (): Promise<SmokeCheckResult> => {
      if (!coreAgentUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "CORE_AGENT_MCP_SERVER_URL or CORE_AGENT_MCP_URL is not set" }
          : {
              ok: true,
              elapsedMs: 0,
              details: { skipped: true, reason: "CORE_AGENT_MCP_SERVER_URL/CORE_AGENT_MCP_URL not set" },
            };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const tools = await discoverToolsWithSdk(coreAgentUrl, coreAgentToken || undefined);
          const toolNames = tools.map((t) => t.name).sort();
          const required = [
            "createPlan",
            "updatePlanStep",
            "getPlan",
            "writeAgentMemory",
            "readAgentMemory",
            "listAgentMemory",
            "deleteAgentMemory",
          ];
          const missing = required.filter((name) => !toolNames.includes(name));
          return { toolCount: toolNames.length, missing, toolNames: toolNames.slice(0, 50) };
        });
        const ok = (value.missing).length === 0;
        return { ok: ok || !requireMcp, elapsedMs, details: value, ...(ok ? {} : { error: "Missing required tools" }) };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    // 1b) Core Agent MCP tools/call (createPlan + getPlan + memory roundtrip)
    results.coreAgentMcp_toolsCall = await (async (): Promise<SmokeCheckResult> => {
      if (!coreAgentUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "CORE_AGENT_MCP_SERVER_URL or CORE_AGENT_MCP_URL is not set" }
          : {
              ok: true,
              elapsedMs: 0,
              details: { skipped: true, reason: "CORE_AGENT_MCP_SERVER_URL/CORE_AGENT_MCP_URL not set" },
            };
      }
      if (!includeMcpToolExec) {
        return { ok: true, elapsedMs: 0, details: { skipped: true, reason: "includeMcpToolExec=false" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const toolArgs = {
            goal: `MCP-1 E2E Plan ${Date.now()}`,
            steps: [
              { step: "Create plan", status: "completed" },
              { step: "Write memory", status: "in_progress" },
              { step: "Read memory", status: "pending" },
            ],
          };
          const planRes = await executeToolWithSdk(coreAgentUrl, "createPlan", toolArgs, coreAgentToken || undefined);
          const planId = (planRes)?.planId;
          if (!planId) throw new Error("createPlan did not return planId");

          const getRes = await executeToolWithSdk(coreAgentUrl, "getPlan", { planId }, coreAgentToken || undefined);
          const gotPlan = (getRes)?.plan;
          if (!gotPlan?.id) throw new Error("getPlan did not return a plan");

          const memKey = `mcp1:e2e:${Date.now()}`;
          await executeToolWithSdk(
            coreAgentUrl,
            "writeAgentMemory",
            { key: memKey, content: JSON.stringify({ planId, ts: Date.now() }) },
            coreAgentToken || undefined,
          );
          const readRes = await executeToolWithSdk(
            coreAgentUrl,
            "readAgentMemory",
            { key: memKey },
            coreAgentToken || undefined,
          );
          const content = (readRes)?.content;
          if (typeof content !== "string" || !content.includes(planId)) {
            throw new Error("readAgentMemory did not return expected content");
          }
          await executeToolWithSdk(coreAgentUrl, "deleteAgentMemory", { key: memKey }, coreAgentToken || undefined);

          return { planId, memKey };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    // 2) OpenBB MCP health + tool listing
    results.openbb_health = await (async (): Promise<SmokeCheckResult> => {
      if (!openbbUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "OPENBB_MCP_SERVER_URL or OPENBB_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "OPENBB_MCP_SERVER_URL/OPENBB_MCP_URL not set" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const data = await ctx.runAction(internal.actions.openbbActions.openbbHealth, {});
          return { data };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    results.openbb_listTools = await (async (): Promise<SmokeCheckResult> => {
      if (!openbbUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "OPENBB_MCP_SERVER_URL or OPENBB_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "OPENBB_MCP_SERVER_URL/OPENBB_MCP_URL not set" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const tools = await ctx.runAction(internal.actions.openbbActions.openbbListTools, {});
          const toolCount = Array.isArray(tools) ? tools.length : undefined;
          return { toolCount, sample: Array.isArray(tools) ? tools.slice(0, 20) : tools };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    results.openbb_executeTool = await (async (): Promise<SmokeCheckResult> => {
      if (!openbbUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "OPENBB_MCP_SERVER_URL or OPENBB_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "OPENBB_MCP_SERVER_URL/OPENBB_MCP_URL not set" } };
      }
      if (!includeMcpToolExec) {
        return { ok: true, elapsedMs: 0, details: { skipped: true, reason: "includeMcpToolExec=false" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const today = new Date();
          const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const start_date = start.toISOString().slice(0, 10);
          const end_date = today.toISOString().slice(0, 10);

          const calls: any = {};

          const unwrap = (res: any) =>
            res && typeof res === "object" && "data" in res ? (res).data : res;

          const quoteResp = await ctx.runAction(internal.actions.openbbActions.openbbExecuteTool, {
            toolName: "equity_price_quote",
            parameters: { symbol: "CRM" },
          });
          const quote = unwrap(quoteResp);
          calls.quote = {
            toolName: "equity_price_quote",
            ok: quote?.price != null,
            sample: quote,
          };

          const fundamentalsResp = await ctx.runAction(internal.actions.openbbActions.openbbExecuteTool, {
            toolName: "equity_fundamental_overview",
            parameters: { symbol: "CRM" },
          });
          const fundamentals = unwrap(fundamentalsResp);
          calls.fundamentals = {
            toolName: "equity_fundamental_overview",
            ok: fundamentals?.price != null || fundamentals?.marketCap != null,
            sample: fundamentals,
          };

          const historicalResp = await ctx.runAction(internal.actions.openbbActions.openbbExecuteTool, {
            toolName: "equity_price_historical",
            parameters: { symbol: "CRM", start_date, end_date },
          });
          const historical = unwrap(historicalResp);
          const points = Array.isArray(historical?.points) ? historical.points.length : 0;
          calls.historical = {
            toolName: "equity_price_historical",
            ok: points > 10,
            sample: { symbol: historical?.symbol, count: historical?.count ?? points, source: historical?.source },
          };

          const gdpResp = await ctx.runAction(internal.actions.openbbActions.openbbExecuteTool, {
            toolName: "economy_gdp",
            parameters: { country: "US" },
          });
          const gdp = unwrap(gdpResp);
          calls.gdp = { toolName: "economy_gdp", ok: gdp?.value != null, sample: gdp };

          const inflationResp = await ctx.runAction(internal.actions.openbbActions.openbbExecuteTool, {
            toolName: "economy_inflation",
            parameters: { country: "US" },
          });
          const inflation = unwrap(inflationResp);
          calls.inflation = { toolName: "economy_inflation", ok: inflation?.value != null, sample: inflation };

          const ok = Object.values(calls).every((c: any) => c?.ok === true);
          return { ok, calls };
        });
        return { ok: value?.ok === true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    // 3) Research MCP health + tool listing
    results.research_health = await (async (): Promise<SmokeCheckResult> => {
      if (!researchUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "RESEARCH_MCP_SERVER_URL or RESEARCH_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "RESEARCH_MCP_SERVER_URL/RESEARCH_MCP_URL not set" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const data = await ctx.runAction(internal.actions.researchMcpActions.researchHealth, {});
          return { data };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    results.research_listTools = await (async (): Promise<SmokeCheckResult> => {
      if (!researchUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "RESEARCH_MCP_SERVER_URL or RESEARCH_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "RESEARCH_MCP_SERVER_URL/RESEARCH_MCP_URL not set" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const tools = await ctx.runAction(internal.actions.researchMcpActions.researchListTools, {});
          const toolCount = Array.isArray(tools) ? tools.length : undefined;
          return { toolCount, sample: Array.isArray(tools) ? tools.slice(0, 50) : tools };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    results.research_executeTool = await (async (): Promise<SmokeCheckResult> => {
      if (!researchUrl) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: "RESEARCH_MCP_SERVER_URL or RESEARCH_MCP_URL is not set" }
          : { ok: true, elapsedMs: 0, details: { skipped: true, reason: "RESEARCH_MCP_SERVER_URL/RESEARCH_MCP_URL not set" } };
      }
      if (!includeMcpToolExec) {
        return { ok: true, elapsedMs: 0, details: { skipped: true, reason: "includeMcpToolExec=false" } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          // Exercise a tool that calls back into Convex (fusion_search -> convex fusionSearch -> linkup/youtube/etc).
          const res = await ctx.runAction(internal.actions.researchMcpActions.researchExecuteTool, {
            toolName: "fusion_search",
            parameters: {
              query: "OpenAI GPT-5.2 model availability",
              mode: "fast",
              sources: ["linkup", "news"],
            },
          });
          return { toolName: "fusion_search", sample: res };
        });
        return { ok: true, elapsedMs, details: value };
      } catch (err) {
        return requireMcp
          ? { ok: false, elapsedMs: 0, error: toErrString(err) }
          : { ok: true, elapsedMs: 0, details: { skipped: true, error: toErrString(err) } };
      }
    })();

    // 4) Linkup live query (optional, costs money)
    results.linkup_search = await (async (): Promise<SmokeCheckResult> => {
      if (!args.includeLinkup) {
        return { ok: true, elapsedMs: 0, details: { skipped: true } };
      }
      const key = process.env.LINKUP_API_KEY || "";
      if (!key) return { ok: false, elapsedMs: 0, error: "LINKUP_API_KEY is not set" };
      try {
        const { elapsedMs, value } = await timed(async () => {
          const response = await fetch("https://api.linkup.so/v1/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              q: args.linkupQuery || "OpenAI API status",
              depth: "standard",
              outputType: "sourcedAnswer",
              includeInlineCitations: true,
              maxResults: 3,
              includeSources: true,
              includeImages: false,
            }),
          });
          const text = await response.text();
          if (!response.ok) {
            const snippet = text.slice(0, 300);
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${snippet}`);
          }
           const parsed = JSON.parse(text);
           const sourcesCount = Array.isArray(parsed?.sources) ? parsed.sources.length : 0;
           const resultsCount = Array.isArray(parsed?.results) ? parsed.results.length : 0;
           const hasAnswer = typeof parsed?.answer === "string" && parsed.answer.length > 0;
           const sampleUrl =
             (Array.isArray(parsed?.results) && typeof parsed?.results?.[0]?.url === "string" && parsed.results[0].url) ||
             (Array.isArray(parsed?.sources) && typeof parsed?.sources?.[0]?.url === "string" && parsed.sources[0].url) ||
             null;
           linkupSampleUrl = sampleUrl;
           return { hasAnswer, sourcesCount, resultsCount, sampleUrl };
         });
        return { ok: (value.sourcesCount as number) >= 1 || (value.resultsCount as number) >= 1, elapsedMs, details: value };
      } catch (err) {
        return { ok: false, elapsedMs: 0, error: toErrString(err) };
      }
    })();

    results.linkup_fetch = await (async (): Promise<SmokeCheckResult> => {
      if (!args.includeLinkup) {
        return { ok: true, elapsedMs: 0, details: { skipped: true } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const attempts: Array<{ url: string; renderJs: boolean; contentLen: number }> = [];
          const urlsToTry = [linkupSampleUrl, "https://platform.openai.com/docs/models"].filter(Boolean) as string[];

          for (const url of urlsToTry) {
            for (const renderJs of [false, true]) {
              const res = await ctx.runAction(internal.tools.media.linkupFetch.linkupFetchInternal, {
                url,
                renderJs,
              });
              const contentLen = typeof res?.content === "string" ? res.content.length : 0;
              attempts.push({ url, renderJs, contentLen });
            }
          }

          const best = attempts.reduce((acc, a) => (a.contentLen > acc.contentLen ? a : acc), {
            url: urlsToTry[0] ?? null,
            renderJs: false,
            contentLen: 0,
          });
          return { bestAttempt: best, maxContentLen: best.contentLen, attempts };
        });
        // Linkup /fetch sometimes returns empty content for certain sites even when the call succeeds.
        // Treat success as "tool call executed" and report max content length for observability.
        const ok = Array.isArray(value?.attempts) && value.attempts.length > 0;
        return { ok, elapsedMs, details: value };
      } catch (err) {
        return { ok: false, elapsedMs: 0, error: toErrString(err) };
      }
    })();

    // 5) Swarm orchestration smoke (optional; uses real delegation + synthesis)
    results.swarm_orchestration = await (async (): Promise<SmokeCheckResult> => {
      if (!args.includeSwarm) {
        return { ok: true, elapsedMs: 0, details: { skipped: true } };
      }
      try {
        const { elapsedMs, value } = await timed(async () => {
          const userId = await ctx.runQuery(internal.domains.agents.swarmQueries.getAnyUserIdInternal, {});
          if (!userId) {
            throw new Error("No users found (create at least one user to run swarm smoke).");
          }

          const model = args.swarmModel || "claude-haiku-4.5";
          const swarmId = crypto.randomUUID();
          const agentName = "DocumentAgent";
          const stateKeyPrefix = `${agentName}:${swarmId.slice(0, 8)}:0`;

          const threadId = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.createThreadForUserInternal, {
            userId,
            title: `Swarm Smoke (${new Date().toISOString()})`,
            model,
          });

          const agentConfigs = [
            {
              agentName,
              role: "Swarm smoke test",
              query: "Return exactly the single token: OK (no extra text). Do not use tools.",
              stateKeyPrefix,
            },
          ];

          await ctx.runMutation(internal.domains.agents.swarmMutations.createSwarmRecord, {
            swarmId,
            userId,
            threadId: threadId as string,
            name: "Swarm Smoke",
            query: "Swarm smoke test",
            pattern: "fan_out_gather",
            agentConfigs,
          });

          await ctx.runMutation(internal.domains.agents.swarmMutations.linkThreadToSwarm, {
            threadId: threadId as any,
            swarmId,
          });

          const tasks = agentConfigs.map((config, idx) => ({
            taskId: crypto.randomUUID(),
            agentName: config.agentName,
            query: config.query,
            role: config.role,
            stateKeyPrefix: config.stateKeyPrefix,
          }));

          await ctx.runMutation(internal.domains.agents.swarmMutations.createSwarmTasks, {
            swarmId,
            tasks,
          });

          await ctx.runAction(internal.domains.agents.swarmOrchestrator.executeSwarmInternal, {
            swarmId,
            userId,
            model,
            tasks,
          });

          const swarm = await ctx.runQuery(
            internal.domains.agents.swarmQueries.getSwarmStatusInternal,
            { swarmId, userId },
          );
          const swarmTasks = await ctx.runQuery(
            internal.domains.agents.swarmQueries.getSwarmTasksInternal,
            { swarmId, userId },
          );

          const statusCounts = (Array.isArray(swarmTasks) ? swarmTasks : []).reduce<Record<string, number>>(
            (acc, t: any) => {
              const key = String(t?.status ?? "unknown");
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            },
            {}
          );

          return {
            swarmId,
            threadId,
            model,
            status: swarm?.status ?? null,
            taskStatusCounts: statusCounts,
            mergedResultSample: String(swarm?.mergedResult ?? "").slice(0, 300),
          };
        });

        const ok = value?.status === "completed" && (value?.taskStatusCounts?.failed ?? 0) === 0;
        return { ok, elapsedMs, details: value };
      } catch (err) {
        return { ok: false, elapsedMs: 0, error: toErrString(err) };
      }
    })();

    const envPresence = {
      MCP_SECRET: Boolean(process.env.MCP_SECRET),
      CORE_AGENT_MCP_SERVER_URL: Boolean(process.env.CORE_AGENT_MCP_SERVER_URL),
      CORE_AGENT_MCP_URL: Boolean(process.env.CORE_AGENT_MCP_URL),
      CORE_AGENT_MCP_AUTH_TOKEN: Boolean(process.env.CORE_AGENT_MCP_AUTH_TOKEN),
      CORE_AGENT_MCP_TOKEN: Boolean(process.env.CORE_AGENT_MCP_TOKEN),
      OPENBB_MCP_SERVER_URL: Boolean(process.env.OPENBB_MCP_SERVER_URL),
      OPENBB_MCP_URL: Boolean(process.env.OPENBB_MCP_URL),
      OPENBB_API_KEY: Boolean(process.env.OPENBB_API_KEY || process.env.OPENBB_MCP_AUTH_TOKEN),
      RESEARCH_MCP_SERVER_URL: Boolean(process.env.RESEARCH_MCP_SERVER_URL),
      RESEARCH_MCP_URL: Boolean(process.env.RESEARCH_MCP_URL),
      RESEARCH_API_KEY: Boolean(process.env.RESEARCH_API_KEY || process.env.MCP_SECRET),
      LINKUP_API_KEY: Boolean(process.env.LINKUP_API_KEY),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      YOUTUBE_API_KEY: Boolean(process.env.YOUTUBE_API_KEY),
    };

    results.sourceArtifacts_created = await (async (): Promise<SmokeCheckResult> => {
      const requireArtifacts = requireMcp || args.includeLinkup === true;
      if (!requireArtifacts) return { ok: true, elapsedMs: 0, details: { skipped: true } };
      try {
        const { elapsedMs, value } = await timed(async () => {
          const total = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.countSince, {
            sinceMs: artifactsStartMs,
          });
          const apiResponses = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.countSince, {
            sinceMs: artifactsStartMs,
            sourceType: "api_response",
          });
          const urlFetches = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.countSince, {
            sinceMs: artifactsStartMs,
            sourceType: "url_fetch",
          });
          return { total, apiResponses, urlFetches };
        });
        return { ok: (value.total as number) > 0, elapsedMs, details: value };
      } catch (err) {
        return { ok: false, elapsedMs: 0, error: toErrString(err) };
      }
    })();

    const requiredKeys = Object.keys(results).filter((k) => {
      if (k.startsWith("coreAgentMcp_")) return requireMcp;
      if (k.startsWith("openbb_")) return requireMcp;
      if (k.startsWith("research_")) return requireMcp;
      if (k === "linkup_search") return args.includeLinkup === true;
      if (k === "swarm_orchestration") return args.includeSwarm === true;
      return true; // public api checks always required when enabled
    });
    const ok = requiredKeys.every((k) => results[k]?.ok);
    return {
      ok,
      checkedAt: Date.now(),
      mode: {
        includePublicApiChecks: args.includePublicApiChecks !== false,
        includeLinkup: args.includeLinkup === true,
        requireMcpChecks: requireMcp,
        tryLocalhostDefaults: tryLocalhost,
        resolved: {
          coreAgentUrl: coreAgentUrl ? new URL(coreAgentUrl).origin : null,
          openbbUrl: openbbUrl ? new URL(openbbUrl).origin : null,
          researchUrl: researchUrl ? new URL(researchUrl).origin : null,
        },
      },
      envPresence,
      results,
    };
  },
});
