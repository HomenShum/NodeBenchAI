"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { McpTool } from "../../../packages/mcp-local/src/types.js";
import { entityEnrichmentTools } from "../../../packages/mcp-local/src/tools/entityEnrichmentTools.js";
import { founderLocalPipelineTools } from "../../../packages/mcp-local/src/tools/founderLocalPipeline.js";
import { llmTools } from "../../../packages/mcp-local/src/tools/llmTools.js";
import { monteCarloTools } from "../../../packages/mcp-local/src/tools/monteCarloTools.js";
import { reconTools } from "../../../packages/mcp-local/src/tools/reconTools.js";
import { webTools } from "../../../packages/mcp-local/src/tools/webTools.js";
import {
  executeHarness,
  generatePlan,
  synthesizeResults,
} from "../../../server/agentHarness.js";
import { buildSearchForecastGate } from "./searchForecastGate.js";

type SearchTraceEntry = {
  step: string;
  tool?: string;
  status: string;
  detail?: string;
  durationMs?: number;
  startedAt: number;
};

type SearchClassification = {
  type: string;
  entity?: string;
  entities?: string[];
  lens: string;
};

const SEARCH_TOOLS: McpTool[] = [
  ...webTools,
  ...reconTools,
  ...founderLocalPipelineTools,
  ...entityEnrichmentTools,
  ...llmTools,
  ...monteCarloTools,
];

const CONVEX_TOOL_TIMEOUT_MS = 45_000;

function buildTraceEntry(
  step: string,
  status: string,
  detail?: string,
  tool?: string,
  durationMs?: number,
): SearchTraceEntry {
  return {
    step,
    tool,
    status,
    detail,
    durationMs,
    startedAt: Date.now(),
  };
}

function statusFromStep(step: string): string {
  if (step.includes("classify")) return "classifying";
  if (step.includes("plan")) return "searching";
  if (step.includes("dispatch")) return "searching";
  if (step.includes("assemble")) return "synthesizing";
  if (step.includes("complete")) return "complete";
  return "searching";
}

function findTool(name: string): McpTool | undefined {
  return SEARCH_TOOLS.find((tool) => tool.name === name);
}

async function linkupSearch(
  query: string,
  maxResults = 5,
): Promise<{ answer: string; sources: Array<{ name: string; url: string; snippet: string }> } | null> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        depth: "standard",
        outputType: "sourcedAnswer",
        includeInlineCitations: true,
        includeSources: true,
        maxResults,
      }),
      signal: AbortSignal.timeout(CONVEX_TOOL_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const sources = (data.results ?? data.sources ?? []).slice(0, maxResults).map((result: any) => ({
      name: result.name ?? result.title ?? "",
      url: result.url ?? "",
      snippet: result.content ?? result.snippet ?? "",
    }));

    return {
      answer: data.answer ?? "",
      sources,
    };
  } catch {
    return null;
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "linkup_search") {
    const query = String(args.query ?? "");
    const maxResults = Number(args.maxResults ?? 5);
    return (await linkupSearch(query, maxResults)) ?? {
      error: true,
      message: "Linkup search unavailable",
    };
  }

  const tool = findTool(name);
  if (!tool) {
    return { error: true, message: `Tool not found: ${name}` };
  }

  try {
    return await tool.handler(args);
  } catch (error: any) {
    return {
      error: true,
      message: error?.message ?? String(error),
    };
  }
}

async function classifyQuery(
  queryText: string,
  lens: string,
): Promise<SearchClassification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return regexClassify(queryText, lens);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Classify this search query for NodeBench founder intelligence.
Return JSON only in this shape:
{"type":"company_search"|"competitor"|"multi_entity"|"weekly_reset"|"pre_delegation"|"important_change"|"plan_proposal"|"general","entity":"primary entity or null","entities":["entity1","entity2"],"lens":"${lens}"}

Query: "${queryText}"`,
            }],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 200,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(7_000),
      },
    );
    if (!response.ok) return regexClassify(queryText, lens);

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return regexClassify(queryText, lens);

    const parsed = JSON.parse(jsonMatch[0]) as SearchClassification;
    return {
      type: parsed.type || "general",
      entity: parsed.entity,
      entities: Array.isArray(parsed.entities) ? parsed.entities.filter(Boolean) : undefined,
      lens: parsed.lens || lens,
    };
  } catch {
    return regexClassify(queryText, lens);
  }
}

function regexClassify(queryText: string, lens: string): SearchClassification {
  const lowered = queryText.toLowerCase();
  if (lowered.includes("weekly") || lowered.includes("reset")) {
    return { type: "weekly_reset", lens };
  }
  if (lowered.includes("delegate") || lowered.includes("pre-delegation")) {
    return { type: "pre_delegation", lens };
  }
  if (lowered.includes("changed") || lowered.includes("what changed")) {
    return { type: "important_change", lens };
  }
  if (/\b(vs\.?|versus|compare)\b/i.test(queryText)) {
    const entities = queryText
      .split(/\b(?:vs\.?|versus|compare)\b/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 3);
    return {
      type: entities.length > 1 ? "multi_entity" : "competitor",
      entity: entities[0],
      entities: entities.length > 1 ? entities : undefined,
      lens,
    };
  }

  const entityMatch = queryText.match(/\b([A-Z][a-zA-Z0-9.&-]+(?:\s+[A-Z][a-zA-Z0-9.&-]+){0,2})\b/);
  return {
    type: entityMatch ? "company_search" : "general",
    entity: entityMatch?.[1],
    lens,
  };
}

function buildResultPacket(args: {
  query: string;
  lens: string;
  classification: SearchClassification;
  execution: Awaited<ReturnType<typeof executeHarness>>;
  synthesis: Awaited<ReturnType<typeof synthesizeResults>>;
}): Record<string, unknown> {
  const entityName =
    args.synthesis.entityName ||
    args.classification.entity ||
    args.classification.entities?.join(" vs ") ||
    "Your Intelligence Brief";

  const sourceRefs = (args.synthesis.sources ?? []).map((source, index) => ({
    id: `source:${index + 1}`,
    label: source.label,
    href: source.href,
    type: source.type as "web" | "local" | "doc" | "trace" | undefined,
    status: "cited" as const,
    title: source.label,
  }));

  const primaryAction = args.synthesis.nextActions?.[0]?.action
    ?? args.synthesis.nextQuestions?.[0]
    ?? "Refresh the packet before delegating the next action.";

  return {
    success: true,
    query: args.query,
    lens: args.lens,
    entityName,
    canonicalEntity: entityName,
    packetType: `${args.classification.type}_packet`,
    answer: args.synthesis.answer,
    confidence: args.synthesis.confidence,
    keyMetrics: args.synthesis.keyMetrics,
    signals: args.synthesis.signals,
    changes: args.synthesis.changes,
    risks: args.synthesis.risks,
    comparables: args.synthesis.comparables,
    whyThisTeam: args.synthesis.whyThisTeam,
    nextActions: args.synthesis.nextActions,
    nextQuestions: args.synthesis.nextQuestions,
    sourceRefs,
    sourceCount: sourceRefs.length,
    recommendedNextAction: primaryAction,
    traceStepCount: args.execution.stepResults.length,
    latencyMs: args.execution.totalDurationMs,
  };
}

function buildRealtimeTrace(
  execution: Awaited<ReturnType<typeof executeHarness>>,
): SearchTraceEntry[] {
  return execution.stepResults.map((stepResult) => ({
    step: "tool_call",
    tool: stepResult.toolName,
    status: stepResult.success ? "ok" : "error",
    detail: stepResult.success
      ? `${stepResult.toolName} completed`
      : stepResult.error ?? `${stepResult.toolName} failed`,
    durationMs: stepResult.durationMs,
    startedAt: Date.now(),
  }));
}

export const executeSearch = internalAction({
  args: {
    sessionId: v.id("searchSessions"),
    query: v.string(),
    lens: v.string(),
  },
  handler: async (ctx, args) => {
    const trace: SearchTraceEntry[] = [];

    const pushTrace = async (entry: SearchTraceEntry) => {
      trace.push(entry);
      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: statusFromStep(entry.step),
        trace,
      });
    };

    // ── Create Founder Episode (before span) ─────────────────────────
    let episodeId: string | null = null;
    try {
      episodeId = await ctx.runMutation(
        internal.domains.search.searchPipeline.createFounderEpisode,
        { episodeType: "entity_search", query: args.query, lens: args.lens, searchSessionId: args.sessionId },
      );
    } catch { /* episode creation is best-effort */ }

    try {
      await pushTrace(buildTraceEntry("classify_query", "ok", "Classifying founder query"));
      const classification = await classifyQuery(args.query, args.lens);
      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "classifying",
        trace,
        classification,
      });
      await pushTrace(
        buildTraceEntry(
          "classify_query",
          "ok",
          `type=${classification.type}, entity=${classification.entity ?? classification.entities?.join(", ") ?? "none"}`,
          "gemini",
        ),
      );

      // Episode: during span for classification
      if (episodeId) {
        await ctx.runMutation(internal.domains.search.searchPipeline.appendEpisodeSpan, {
          episodeId: episodeId as any,
          span: {
            stage: "during", type: "query_classified", status: "ok",
            label: `Classified as ${classification.type}`,
            detail: `Entity: ${classification.entity ?? "none"}, lens: ${classification.lens}`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      await pushTrace(buildTraceEntry("plan_tools", "ok", "Planning search toolchain"));
      const plan = await generatePlan(
        args.query,
        classification.type,
        classification.entities?.length ? classification.entities : (classification.entity ? [classification.entity] : []),
        classification.lens,
        callTool,
      );
      await pushTrace(
        buildTraceEntry(
          "plan_tools",
          "ok",
          `${plan.steps.length} steps selected for ${plan.classification}`,
        ),
      );

      await pushTrace(buildTraceEntry("parallel_dispatch", "ok", "Running background search harness"));
      const execution = await executeHarness(
        plan,
        callTool,
        undefined,
        { toolTimeoutMs: CONVEX_TOOL_TIMEOUT_MS },
      );
      const realtimeTrace = [
        ...trace,
        ...buildRealtimeTrace(execution),
      ];
      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "searching",
        trace: realtimeTrace,
      });

      // Episode: during span for tool execution
      if (episodeId) {
        const toolNames = (execution.stepResults ?? []).map((s: any) => s.tool ?? s.step).filter(Boolean);
        await ctx.runMutation(internal.domains.search.searchPipeline.appendEpisodeSpan, {
          episodeId: episodeId as any,
          span: {
            stage: "during", type: "trace_progress", status: "ok",
            label: "Evidence path assembled",
            detail: `${(execution.stepResults ?? []).length} steps, ${execution.totalDurationMs}ms`,
            timestamp: new Date().toISOString(),
          },
          toolsInvoked: toolNames,
        });
      }

      await pushTrace(buildTraceEntry("assemble_response", "ok", "Synthesizing final packet"));
      const synthesis = await synthesizeResults(
        execution,
        args.query,
        classification.lens,
        callTool,
      );
      const packet = buildResultPacket({
        query: args.query,
        lens: classification.lens,
        classification,
        execution,
        synthesis,
      });
      const recentSessions = await ctx.runQuery(api.domains.search.searchPipeline.listRecentSearches, { limit: 25 });
      const forecastGate = buildSearchForecastGate({
        recentSessions,
        entityName: String(packet.entityName ?? synthesis.entityName ?? classification.entity ?? args.query),
        lens: classification.lens,
        currentConfidence: Number(packet.confidence ?? synthesis.confidence ?? 0),
        currentSessionId: args.sessionId,
        packetId: typeof packet.packetId === "string" ? packet.packetId : undefined,
      });
      const packetWithForecastGate = {
        ...packet,
        forecastGate,
        temporalTrajectory: {
          kind: "search_session_confidence",
          streamKey: forecastGate.streamKey,
          valuesCount: forecastGate.valuesCount,
          modelUsed: forecastGate.modelUsed,
        },
      };

      const completedTrace = [
        ...realtimeTrace,
        buildTraceEntry(
          "complete",
          "ok",
          `${synthesis.entityName} packet ready`,
          undefined,
          execution.totalDurationMs,
        ),
      ];

      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "complete",
        trace: completedTrace,
        classification,
        result: packetWithForecastGate,
        completedAt: Date.now(),
      });
      // ── Episode: after span (packet compiled) ─────────────────────
      if (episodeId) {
        const toolNames = (execution.stepResults ?? []).map((s: any) => s.tool ?? s.step).filter(Boolean);
        await ctx.runMutation(internal.domains.search.searchPipeline.finalizeEpisode, {
          episodeId: episodeId as any,
          status: "completed",
          entityName: synthesis.entityName,
          packetType: classification.type,
          summary: (synthesis.answer ?? "").slice(0, 200),
          artifactsProduced: ["founder_packet"],
          finalSpan: {
            stage: "after", type: "packet_compiled", status: "ok",
            label: "Founder packet ready",
            detail: `${synthesis.entityName}: ${synthesis.confidence}% confidence, ${toolNames.length} tools`,
            timestamp: new Date().toISOString(),
          },
        });
      }

    } catch (error: any) {
      const failedTrace = [
        ...trace,
        buildTraceEntry("complete", "error", error?.message ?? "Search failed"),
      ];
      await ctx.runMutation(internal.domains.search.searchPipeline.updateSearchStatus, {
        sessionId: args.sessionId,
        status: "error",
        trace: failedTrace,
        error: error?.message ?? "Search failed",
        completedAt: Date.now(),
      });

      // Episode: error finalization
      if (episodeId) {
        try {
          await ctx.runMutation(internal.domains.search.searchPipeline.finalizeEpisode, {
            episodeId: episodeId as any,
            status: "error",
            summary: `Search failed: ${error?.message ?? "unknown"}`,
            finalSpan: {
              stage: "after", type: "search_failed", status: "error",
              label: "Search failed",
              detail: error?.message ?? "Search failed",
              timestamp: new Date().toISOString(),
            },
          });
        } catch { /* best-effort */ }
      }
    }
  },
});
