"use node";

import { api } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../agents/mcp_tools/models/modelResolver";
export type FusionSearchSource = "linkup" | "sec" | "rag" | "documents" | "news" | "youtube" | "arxiv";

const ALLOWED_FUSION_SOURCES = new Set<FusionSearchSource>([
  "linkup",
  "sec",
  "rag",
  "documents",
  "news",
  "youtube",
  "arxiv",
]);

function normalizeFusionMode(input: string): FusionSearchMode {
  if (input === "fast" || input === "balanced" || input === "comprehensive") return input;
  return "balanced";
}

function normalizeFusionSources(input: unknown): FusionSearchSource[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const filtered = input
    .map((s) => String(s))
    .filter((s): s is FusionSearchSource => ALLOWED_FUSION_SOURCES.has(s as FusionSearchSource));
  return filtered.length ? filtered : undefined;
}

export type FusionSearchMode = "fast" | "balanced" | "comprehensive";
export type EvidenceTask =
  | {
      kind: "linkup";
      query: string;
      depth: "standard" | "deep";
    }
  | {
      kind: "fusionSearch";
      query: string;
      mode: FusionSearchMode;
      sources?: Array<"linkup" | "sec" | "rag" | "documents" | "news" | "youtube" | "arxiv">;
      maxPerSource?: number;
      maxTotal?: number;
      enableReranking?: boolean;
      contentTypes?: Array<"text" | "pdf" | "video" | "image" | "filing" | "news">;
      dateRange?: {
        start?: string;
        end?: string;
      };
    };

export type EvidenceResult =
  | {
      kind: "linkup";
      task: Extract<EvidenceTask, { kind: "linkup" }>;
      ok: boolean;
      elapsedMs: number;
      answer: string;
      sources: Array<{ name: string; domain: string }>;
      error?: string;
    }
  | {
      kind: "fusionSearch";
      task: Extract<EvidenceTask, { kind: "fusionSearch" }>;
      ok: boolean;
      elapsedMs: number;
      results: Array<{
        source: string;
        title: string;
        snippet: string;
        url?: string;
        publishedAt?: string;
        score?: number;
      }>;
      totalBeforeFusion?: number;
      totalTimeMs?: number;
      reranked?: boolean;
      error?: string;
    };

export async function callLinkupForEval(args: { query: string; depth: "standard" | "deep" }) {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "LINKUP_API_KEY not configured",
      answer: "",
      sources: [] as Array<{ name: string; domain: string }>,
    };
  }

  const response = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: args.query,
      depth: args.depth,
      outputType: "sourcedAnswer",
      includeInlineCitations: true,
      includeSources: true,
      includeImages: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      error: `Linkup error (${response.status}): ${errorText}`,
      answer: "",
      sources: [] as Array<{ name: string; domain: string }>,
    };
  }

  const data: any = await response.json();

  const sources = Array.isArray(data?.sources)
    ? data.sources.slice(0, 8).map((s: any) => {
        const url = typeof s?.url === "string" ? s.url : "";
        let domain = "";
        try {
          domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
        } catch {
          domain = "";
        }
        return {
          name: String(s?.name ?? ""),
          domain,
        };
      })
    : [];

  return {
    ok: true,
    answer: String(data?.answer ?? ""),
    sources,
  };
}

export async function planEvidenceTasks(args: {
  question: string;
  persona: string;
  linkupDepth: "standard" | "deep";
  maxTasks: number;
}): Promise<{ tasks: EvidenceTask[]; raw?: string }> {
  const maxTasks = Math.max(1, Math.min(8, args.maxTasks));

  const prompt = `You are an evidence planning agent. Given a question and persona, propose up to ${maxTasks} evidence-gathering tasks to run IN PARALLEL.

You can schedule the following task kinds:

1) linkup
- fields: {"kind":"linkup","query":string,"depth":"standard"|"deep"}
- Use this to get a WEB ANSWER with inline citations.

2) fusionSearch
- fields: {"kind":"fusionSearch","query":string,"mode":"fast"|"balanced"|"comprehensive","sources"?:[...],"maxTotal"?:number}
- Use this to gather multiple sources. Prefer diverse queries (rephrases, narrower time window, alternate framing).

Rules:
- Include exactly ONE linkup task (for citations).
- The remaining tasks should be fusionSearch variants.
- Prefer using mode="balanced" or mode="comprehensive".
- Keep queries short.
- Output ONLY a JSON array of tasks. No markdown.

Persona: ${args.persona}
Question: ${args.question}`;

  try {
    const { text } = await generateText({
      model: getLanguageModelSafe("claude-haiku-4.5"),
      prompt,
      maxOutputTokens: 600,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const raw = jsonMatch ? jsonMatch[0] : text;
    const parsed = JSON.parse(raw) as EvidenceTask[];

    const normalized: EvidenceTask[] = [];
    let sawLinkup = false;

    for (const t of parsed) {
      if (!t || typeof t !== "object") continue;

      if ((t as any).kind === "linkup") {
        if (sawLinkup) continue;
        sawLinkup = true;
        normalized.push({
          kind: "linkup",
          query: String((t as any).query ?? args.question).slice(0, 500),
          depth: (String((t as any).depth ?? args.linkupDepth) === "deep" ? "deep" : "standard"),
        });
        continue;
      }

      if ((t as any).kind === "fusionSearch") {
        normalized.push({
          kind: "fusionSearch",
          query: String((t as any).query ?? args.question).slice(0, 500),
          mode: normalizeFusionMode(String((t as any).mode ?? "balanced")),
          sources: normalizeFusionSources((t as any).sources),
          maxTotal: typeof (t as any).maxTotal === "number" ? (t as any).maxTotal : 20,
          maxPerSource: typeof (t as any).maxPerSource === "number" ? (t as any).maxPerSource : undefined,
          enableReranking: typeof (t as any).enableReranking === "boolean" ? (t as any).enableReranking : undefined,
          contentTypes: Array.isArray((t as any).contentTypes) ? (t as any).contentTypes : undefined,
          dateRange: (t as any).dateRange && typeof (t as any).dateRange === "object" ? (t as any).dateRange : undefined,
        });
      }
    }

    if (!sawLinkup) {
      normalized.unshift({ kind: "linkup", query: args.question, depth: args.linkupDepth });
    }

    const limited = normalized.slice(0, maxTasks);

    return {
      tasks: limited,
      raw: text,
    };
  } catch {
    const fallbackTasks: EvidenceTask[] = [
      { kind: "linkup", query: args.question, depth: args.linkupDepth },
      { kind: "fusionSearch", query: args.question, mode: "balanced", maxTotal: 20 },
    ];

    return {
      tasks: fallbackTasks.slice(0, maxTasks),
    };
  }
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runOne());
  await Promise.all(runners);
  return results;
}

export async function runEvidenceTasksInParallel(
  ctx: any,
  tasks: EvidenceTask[],
  opts: {
    maxConcurrency: number;
    skipRateLimit?: boolean;
    skipCache?: boolean;
  }
): Promise<EvidenceResult[]> {
  const maxConcurrency = Math.max(1, Math.min(8, opts.maxConcurrency));

  return await runWithConcurrencyLimit(tasks, maxConcurrency, async (task) => {
    const startedAt = Date.now();

    if (task.kind === "linkup") {
      try {
        const linkup = await callLinkupForEval({ query: task.query, depth: task.depth });
        return {
          kind: "linkup",
          task,
          ok: linkup.ok,
          elapsedMs: Date.now() - startedAt,
          answer: linkup.answer ?? "",
          sources: linkup.sources ?? [],
          error: linkup.ok ? undefined : linkup.error,
        };
      } catch (e: any) {
        return {
          kind: "linkup",
          task,
          ok: false,
          elapsedMs: Date.now() - startedAt,
          answer: "",
          sources: [],
          error: e?.message ?? String(e),
        };
      }
    }

    try {
      const payload = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
        query: task.query,
        mode: task.mode,
        sources: task.sources,
        maxPerSource: task.maxPerSource,
        maxTotal: task.maxTotal,
        enableReranking: task.enableReranking,
        contentTypes: task.contentTypes,
        dateRange: task.dateRange,
        skipRateLimit: opts.skipRateLimit ?? true,
        skipCache: opts.skipCache ?? false,
      });

      const response = payload?.payload;
      const rawResults = Array.isArray(response?.results) ? response.results : [];

      const mapped = rawResults.slice(0, 25).map((r: any) => ({
        source: String(r?.source ?? ""),
        title: String(r?.title ?? ""),
        snippet: String(r?.snippet ?? ""),
        url: typeof r?.url === "string" ? r.url : undefined,
        publishedAt: typeof r?.publishedAt === "string" ? r.publishedAt : undefined,
        score: typeof r?.score === "number" ? r.score : undefined,
      }));

      return {
        kind: "fusionSearch",
        task,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        results: mapped,
        totalBeforeFusion: typeof response?.totalBeforeFusion === "number" ? response.totalBeforeFusion : undefined,
        totalTimeMs: typeof response?.totalTimeMs === "number" ? response.totalTimeMs : undefined,
        reranked: typeof response?.reranked === "boolean" ? response.reranked : undefined,
      };
    } catch (e: any) {
      return {
        kind: "fusionSearch",
        task,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        results: [],
        error: e?.message ?? String(e),
      };
    }
  });
}

export function buildEvidencePack(args: {
  planTasks: EvidenceTask[];
  results: EvidenceResult[];
  maxChars: number;
}): string {
  const lines: string[] = [];

  lines.push("EVIDENCE PLAN:");
  for (const t of args.planTasks) {
    if (t.kind === "linkup") {
      lines.push(`- linkup depth=${t.depth} q=${t.query.slice(0, 180)}`);
    } else {
      lines.push(`- fusionSearch mode=${t.mode} maxTotal=${t.maxTotal ?? ""} q=${t.query.slice(0, 180)}`);
    }
  }

  const linkup = args.results.find((r) => r.kind === "linkup");
  if (linkup) {
    lines.push("");
    lines.push("WEB ANSWER (with inline citations):");
    lines.push((linkup.answer || "").slice(0, 6000));

    if (Array.isArray(linkup.sources) && linkup.sources.length > 0) {
      lines.push("");
      lines.push("SOURCES (names/domains only):");
      for (const s of linkup.sources.slice(0, 12)) {
        lines.push(`- ${s.name}${s.domain ? ` (${s.domain})` : ""}`);
      }
    }
  }

  const fusionRuns = args.results.filter((r) => r.kind === "fusionSearch");
  for (const fr of fusionRuns) {
    lines.push("");
    lines.push(`FUSION SEARCH RESULTS (mode=${fr.task.mode}, q=${fr.task.query.slice(0, 120)}):`);
    if (!fr.ok) {
      lines.push(`- ERROR: ${fr.error ?? "unknown"}`);
      continue;
    }
    if (!fr.results.length) {
      lines.push("- (no results)");
      continue;
    }
    for (const r of fr.results.slice(0, 10)) {
      const meta = [r.source, r.publishedAt].filter(Boolean).join(" | ");
      lines.push(`- ${r.title}${meta ? ` (${meta})` : ""}`);
      if (r.url) lines.push(`  ${r.url}`);
      if (r.snippet) lines.push(`  ${r.snippet.slice(0, 280)}`);
    }
  }

  const text = lines.join("\n");
  return text.length > args.maxChars ? text.slice(0, args.maxChars) : text;
}



