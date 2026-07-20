"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { createHash } from "crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";

type ReaderContentResult = {
  ok?: boolean;
  cached?: boolean;
  url?: string;
  content?: string;
  excerpt?: string;
  contentBytes?: number;
  isTruncated?: boolean;
  sourceMatrix?: Array<{ title?: string; url?: string; domain?: string; snippet?: string }>;
  analyzedAt?: number;
} | null;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 500,
): Promise<string> {
  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(modelInput),
  );

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  if (provider === "gemini") {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content || "";
}

function tryParseJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

type ImpactNode = {
  id: string;
  label: string;
  type?: string;
  importance?: number;
  tier?: number;
};

type ImpactEdge = {
  source: string;
  target: string;
  relationship?: string;
  context?: string;
  impact?: string;
  order?: "primary" | "secondary";
};

type ImpactGraph = {
  focusNodeId?: string;
  nodes: ImpactNode[];
  edges: ImpactEdge[];
};

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function inferRiskLevel(title: string, summary?: string) {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (/cve|critical|rce|remote code|exploit|breach|zero-day|0day/.test(text)) return "high";
  if (/vulnerability|security|outage|incident/.test(text)) return "medium";
  return "low";
}

function normalizeRiskLevel(input: unknown, fallback: "low" | "medium" | "high") {
  if (input === "high" || input === "medium" || input === "low") return input;
  return fallback;
}

function buildFallbackSummary(title: string, techStack: string[]) {
  const stack = techStack.length ? techStack.join(", ") : "your stack";
  return `Potential exposure from "${title}" across ${stack}. Validate vendor advisories, apply patches, and monitor second-order impacts.`;
}

function buildFallbackGraph(title: string, techStack: string[], summary?: string): ImpactGraph {
  const focusNodeId = "signal";
  const nodes: ImpactNode[] = [
    { id: focusNodeId, label: title, type: "signal", importance: 0.95, tier: 1 },
  ];
  const edges: ImpactEdge[] = [];

  techStack.forEach((stackItem, idx) => {
    const id = `stack-${idx}`;
    nodes.push({ id, label: stackItem, type: "stack", importance: 0.8, tier: 1 });
    edges.push({
      source: focusNodeId,
      target: id,
      relationship: "exposes",
      context: "Direct dependency surface",
      order: "primary",
    });
  });

  const secondaryId = "security-vendors";
  nodes.push({
    id: secondaryId,
    label: "Managed security vendors",
    type: "beneficiary",
    importance: 0.4,
    tier: 2,
  });
  edges.push({
    source: focusNodeId,
    target: secondaryId,
    relationship: "drives demand",
    context: "Second-order risk response",
    order: "secondary",
  });

  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (/vpn|geo-block|ban/.test(text)) {
    nodes.push({
      id: "residential-proxies",
      label: "Residential Proxy Networks",
      type: "beneficiary",
      importance: 0.45,
      tier: 2,
    });
    edges.push({
      source: focusNodeId,
      target: "residential-proxies",
      relationship: "demand spikes",
      context: "Second-order market shift",
      order: "secondary",
    });
  }

  return { focusNodeId, nodes, edges };
}

function normalizeGraph(input: unknown, fallback: ImpactGraph): ImpactGraph {
  if (!input || typeof input !== "object") return fallback;
  const raw = input as any;
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .map((node: any) => ({
          id: asString(node?.id),
          label: asString(node?.label),
          type: asString(node?.type) || undefined,
          importance: typeof node?.importance === "number" ? node.importance : undefined,
          tier: typeof node?.tier === "number" ? node.tier : undefined,
        }))
        .filter((node: ImpactNode) => node.id && node.label)
    : [];
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map((edge: any) => ({
          source: asString(edge?.source),
          target: asString(edge?.target),
          relationship: asString(edge?.relationship) || undefined,
          context: asString(edge?.context) || undefined,
          impact: asString(edge?.impact) || undefined,
          order: edge?.order === "primary" || edge?.order === "secondary" ? edge.order : undefined,
        }))
        .filter((edge: ImpactEdge) => edge.source && edge.target)
    : [];
  if (!nodes.length) return fallback;
  return {
    focusNodeId: asString(raw.focusNodeId) || fallback.focusNodeId,
    nodes,
    edges,
  };
}

function buildSignalKey(title: string, url: string | null, stack: string[]) {
  const payload = `${title}|${url ?? ""}|${stack.join(",")}`;
  return `stack-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function extractCveId(title: string, summary?: string, context?: string) {
  const text = `${title} ${summary ?? ""} ${context ?? ""}`;
  const match = text.match(/CVE-\\d{4}-\\d{4,7}/i);
  return match ? match[0].toUpperCase() : null;
}

function augmentGraph(graph: ImpactGraph, title: string, summary: string | undefined, techStack: string[]) {
  const focusNodeId = graph.focusNodeId || graph.nodes[0]?.id || "signal";
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];

  techStack.forEach((stackItem, idx) => {
    const exists = nodes.some((node) => node.label.toLowerCase() === stackItem.toLowerCase());
    if (!exists) {
      const id = `stack-${idx}`;
      nodes.push({ id, label: stackItem, type: "stack", tier: 1, importance: 0.7 });
      edges.push({
        source: focusNodeId,
        target: id,
        relationship: "exposes",
        context: "Direct dependency surface",
        order: "primary",
      });
    }
  });

  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (/vpn|geo-block|ban/.test(text)) {
    const exists = nodes.some((node) => node.label.toLowerCase().includes("proxy"));
    if (!exists) {
      nodes.push({
        id: "residential-proxies",
        label: "Residential Proxy Networks",
        type: "beneficiary",
        importance: 0.45,
        tier: 2,
      });
      edges.push({
        source: focusNodeId,
        target: "residential-proxies",
        relationship: "demand spikes",
        context: "Second-order market shift",
        order: "secondary",
      });
    }
  }

  return { ...graph, focusNodeId, nodes, edges };
}

export const refreshStackImpact = action({
  args: {
    title: v.string(),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    techStack: v.array(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const signalKey = buildSignalKey(args.title, args.url ?? null, args.techStack);

    const existing = await ctx.runQuery(api.domains.research.stackImpactQueries.getStackImpact, {
      signalKey,
    });

    if (existing && !args.forceRefresh) {
      const age = Date.now() - (existing.fetchedAt ?? 0);
      if (age < CACHE_TTL_MS) {
        return { cached: true, impact: existing };
      }
    }

    const reader = (args.url
      ? await ctx.runAction(api.domains.research.readerContent.getReaderContent, {
          url: args.url,
          title: args.title,
        })
      : null) as ReaderContentResult;
    const context = [
      args.summary,
      reader?.excerpt,
      reader?.content,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000);

    const systemPrompt =
      "You are a security architect. Map dependency impacts to the user's stack. Output JSON only.";
    const userPrompt =
      `Signal: ${args.title}\n` +
      `User tech stack: ${args.techStack.join(", ")}\n\n` +
      `Context:\n${context}\n\n` +
      `Return JSON with keys: summary, riskLevel (low|medium|high), graph.\n` +
      `graph must include focusNodeId, nodes, edges.\n` +
      `Nodes: { id, label, type, importance, tier } where tier 1 = direct impact, tier 2 = second-order.\n` +
      `Edges: { source, target, relationship, context, order } where order is primary or secondary.\n` +
      `Include second-order beneficiaries when relevant. Limit to 10 nodes.`;

    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      systemPrompt,
      userPrompt,
      520,
    );

    const parsed = (tryParseJson(raw) ?? {}) as Record<string, unknown>;
    const fallbackGraph = buildFallbackGraph(args.title, args.techStack, args.summary);
    const summary = asString(parsed.summary) || buildFallbackSummary(args.title, args.techStack);
    const riskLevel = normalizeRiskLevel(parsed.riskLevel, inferRiskLevel(args.title, args.summary));
    const graph = augmentGraph(normalizeGraph(parsed.graph, fallbackGraph), args.title, args.summary, args.techStack);
    const cveId = extractCveId(args.title, args.summary, context);
    const cveUrl = cveId ? `https://nvd.nist.gov/vuln/detail/${cveId}` : undefined;
    const sourceUrls = Array.isArray(reader?.sourceMatrix)
      ? reader.sourceMatrix
          .map((item: { url?: string }) => item.url)
          .filter((url): url is string => Boolean(url))
          .slice(0, 6)
      : [];
    const record = {
      signalKey,
      signalTitle: args.title,
      signalUrl: args.url ?? "",
      techStack: args.techStack,
      summary,
      riskLevel,
      cveId: cveId ?? undefined,
      cveUrl,
      sourceUrls,
      graph,
      fetchedAt: Date.now(),
    };

    if (existing?._id) {
      await ctx.runMutation(internal.domains.research.stackImpactQueries.patchStackImpact, {
        id: existing._id,
        updates: record,
      });
      return { cached: false, impact: { ...existing, ...record } };
    }

    const id = await ctx.runMutation(internal.domains.research.stackImpactQueries.insertStackImpact, {
      record,
    });
    return { cached: false, impact: { _id: id, ...record } };
  },
});
