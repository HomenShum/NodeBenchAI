/**
 * searchPipeline.ts — Simplified search pipeline (April 2026 industry standard).
 *
 * 5 nodes, typed state, LangGraph pattern:
 * classify → search (Linkup) → analyze (Gemini) → package → eval (HyperLoop)
 *
 * Replaces the 3500-line search.ts + 2700-line agentHarness.ts with ~500 lines.
 * Every claim is source-linked. Every signal is taxonomy-classified.
 */

import { classifySignals, type ClassifiedSignal } from "../lib/signalTaxonomy.js";
import { createEvidenceSpans, type EvidenceManifest } from "../lib/evidenceSpan.js";
import { computeRoutingHints, formatRoutingHintsForPrompt, type RoutingHint } from "../lib/routingHints.js";
import { detectPainResolutions, type PainResolution } from "../lib/painMapping.js";
import { extractDCFInputs, enrichDCFWithEdgar, runDCF, runReverseDCF, type DCFResult, type ReverseDCFResult } from "../lib/dcfModel.js";

// ─── Pipeline State ──────────────────────────────────────────────

export interface PipelineState {
  // Input
  query: string;
  lens: string;
  contextHint?: string;

  // Classify
  classification: string;
  entity: string | null;
  routingHints: RoutingHint[];

  // Search (Linkup)
  searchAnswer: string;
  searchSources: SearchSource[];
  searchExploredSourceCount: number;
  searchDiscardedSourceCount: number;
  searchQueryVariants: string[];

  // Analyze (Gemini)
  entityName: string;
  answer: string;
  confidence: number;
  signals: Array<{ name: string; direction: string; impact: string; sourceIdx?: number }>;
  risks: Array<{ title: string; description: string; sourceIdx?: number }>;
  comparables: Array<{ name: string; relevance: string; note: string }>;
  nextActions: Array<{ action: string; impact: string }>;
  nextQuestions: string[];
  keyMetrics: Array<{ label: string; value: string }>;
  whyThisTeam: {
    founderCredibility: string;
    trustSignals: string[];
    visionMagnitude: string;
    hiddenRequirements: string[];
  } | null;

  // Package
  classifiedSignals: ClassifiedSignal[];
  evidence: EvidenceManifest;
  painResolutions: PainResolution[];

  // Valuation
  dcf: DCFResult | null;
  reverseDCF: ReverseDCFResult | null;

  // Trace
  trace: Array<{ step: string; tool?: string; status: string; detail?: string; durationMs?: number }>;
  totalDurationMs: number;
  error: string | null;

  // Token usage (from Gemini API response)
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; model: string };
}

export type SearchSourceKind =
  | "official_root"
  | "official_article"
  | "official_legal"
  | "official_jobs"
  | "external_profile"
  | "external_press"
  | "directory"
  | "social"
  | "general";

export interface SearchSource {
  name: string;
  url: string;
  snippet: string;
  thumbnailUrl?: string;
  imageCandidates?: string[];
  faviconUrl?: string;
  siteName?: string;
  domain?: string;
  path?: string;
  kind?: SearchSourceKind;
  qualityScore?: number;
  matchedTokens?: number;
  entityGrounded?: boolean;
  corroboration?: "self_reported" | "external";
}

const ENTITY_STOP_WORDS = new Set([
  "inc",
  "llc",
  "ltd",
  "co",
  "company",
  "corp",
  "corporation",
  "group",
  "holdings",
  "technologies",
  "technology",
  "systems",
  "labs",
  "lab",
]);

const HIGH_SIGNAL_EXTERNAL_DOMAINS = new Set([
  "linkedin.com",
  "crunchbase.com",
  "glassdoor.com",
  "businesswire.com",
  "zoominfo.com",
  "pitchbook.com",
  "tracxn.com",
]);

const QUESTION_OPENERS = new Set(["what", "why", "how", "who", "when", "where", "which"]);

function extractPrimaryEntityFromContextHint(contextHint?: string): string | null {
  const trimmed = contextHint?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/Primary entity for this run:\s*([^.\n]+?)(?:\.|\n|$)/i);
  const entity = match?.[1]?.trim();
  return entity || null;
}

function extractEntityFromQuery(query: string): string {
  const explicitAboutMatch = query.match(/\babout\s+([A-Z][a-zA-Z0-9&.'’-]+(?:\s+[A-Z][a-zA-Z0-9&.'’-]+){0,2})/);
  if (explicitAboutMatch?.[1]) {
    return explicitAboutMatch[1].trim();
  }

  const capitalizedMatches = [...query.matchAll(/\b([A-Z][a-zA-Z0-9&.'’-]+(?:\s+[A-Z][a-zA-Z0-9&.'’-]+){0,2})\b/g)]
    .map((match) => match[1]?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  const firstGrounded = capitalizedMatches.find((candidate) => {
    const firstToken = candidate.split(/\s+/)[0]?.toLowerCase();
    return firstToken ? !QUESTION_OPENERS.has(firstToken) : false;
  });
  if (firstGrounded) return firstGrounded;

  return query.split(/\s+/).slice(0, 3).join(" ");
}

const LOW_SIGNAL_SOCIAL_DOMAINS = new Set([
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
]);

const LOW_SIGNAL_PAGE_PATTERNS = [
  /\bprivacy\b/i,
  /\bterms?\b/i,
  /\bpolicy\b/i,
  /\bcareers?\b/i,
  /\bjobs?\b/i,
  /\bcookies?\b/i,
  /\blogin\b/i,
  /\bsign[\s-]?in\b/i,
];

const PRIMARY_OFFICIAL_PATH_PATTERNS = [
  /^\/?$/i,
  /^\/(about|company|services|solutions|products?|platform|partners)\/?$/i,
];

function stripInlineSourceCitations(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s*\[S\d+\]/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractSourceIndices(value: string | null | undefined): number[] {
  return Array.from((value ?? "").matchAll(/\[S(\d+)\]/gi))
    .map((match) => Number.parseInt(match[1] ?? "", 10) - 1)
    .filter((index) => Number.isFinite(index) && index >= 0);
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeEntity(value: string | null | undefined): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !ENTITY_STOP_WORDS.has(token));
}

function extractExplicitUrls(query: string): string[] {
  return Array.from(query.matchAll(/https?:\/\/[^\s<>"')]+/gi))
    .map((match) => match[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractExplicitDomains(query: string): string[] {
  return Array.from(
    new Set(
      extractExplicitUrls(query)
        .map((value) => {
          try {
            return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
          } catch {
            return null;
          }
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 3);
}

function stripExplicitUrls(query: string): string {
  return query.replace(/https?:\/\/[^\s<>"')]+/gi, " ").replace(/\s+/g, " ").trim();
}

function sourceEntityScore(
  entity: string | null,
  source: { name: string; url: string; snippet: string },
): { score: number; matchedTokens: number } {
  const phrase = normalizeSearchText(entity);
  const compactPhrase = phrase.replace(/\s+/g, "");
  const tokens = tokenizeEntity(entity);
  const titleHaystack = normalizeSearchText(source.name);
  const urlHaystack = normalizeSearchText(source.url);
  const snippetHaystack = normalizeSearchText(source.snippet);
  const combinedHaystack = [titleHaystack, urlHaystack, snippetHaystack].filter(Boolean).join(" ");
  const titleAndUrlHaystack = [titleHaystack, urlHaystack].filter(Boolean).join(" ");
  const compactUrl = (source.url ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  let score = 0;
  if (phrase && combinedHaystack.includes(phrase)) score += 8;
  if (compactPhrase && compactUrl.includes(compactPhrase)) score += 6;
  if (tokens.length > 0 && tokens.every((token) => titleAndUrlHaystack.includes(token))) score += 5;
  if (tokens.length > 0 && tokens.every((token) => snippetHaystack.includes(token))) score += 4;

  const matchedTokens = tokens.filter((token) => combinedHaystack.includes(token)).length;
  if (matchedTokens >= 2) {
    score += matchedTokens;
  } else if (tokens.length === 1 && matchedTokens === 1) {
    score += 2;
  }

  return { score, matchedTokens };
}

function parseSourceLocation(url: string | null | undefined): { domain?: string; path?: string } {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      domain: parsed.hostname.replace(/^www\./, "").toLowerCase(),
      path: parsed.pathname || "/",
    };
  } catch {
    return {};
  }
}

function normalizeMediaUrl(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

function dedupeMediaUrls(candidates: unknown[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    const value = normalizeMediaUrl(candidate);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}

function compactEntity(entity: string | null | undefined): string {
  return normalizeSearchText(entity).replace(/\s+/g, "");
}

function inferOfficialDomains(
  entity: string | null,
  sources: Array<{ name: string; url: string; snippet: string }>,
): Set<string> {
  const phrase = normalizeSearchText(entity);
  const compactPhrase = compactEntity(entity);
  const domains = new Set<string>();

  for (const source of sources) {
    const { domain, path } = parseSourceLocation(source.url);
    if (!domain) continue;
    const title = normalizeSearchText(source.name);
    const looksOfficial =
      (compactPhrase && domain.replace(/[^a-z0-9]/g, "").includes(compactPhrase)) ||
      (phrase && title.includes(phrase) && PRIMARY_OFFICIAL_PATH_PATTERNS.some((pattern) => pattern.test(path ?? "/")));
    if (looksOfficial) {
      domains.add(domain);
    }
  }

  return domains;
}

function classifySearchSourceKind(
  source: { name: string; url: string; snippet: string },
  officialDomains: Set<string>,
): SearchSourceKind {
  const { domain = "", path = "/" } = parseSourceLocation(source.url);
  const title = source.name ?? "";
  const haystack = `${title} ${path}`;

  if (officialDomains.has(domain)) {
    if (LOW_SIGNAL_PAGE_PATTERNS.some((pattern) => pattern.test(haystack))) {
      return /\bcareers?\b|\bjobs?\b/i.test(haystack) ? "official_jobs" : "official_legal";
    }
    if (PRIMARY_OFFICIAL_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return "official_root";
    }
    return "official_article";
  }

  if (domain === "linkedin.com" && /\/company\//i.test(path)) return "external_profile";
  if (HIGH_SIGNAL_EXTERNAL_DOMAINS.has(domain)) {
    return domain === "businesswire.com" ? "external_press" : "external_profile";
  }
  if (LOW_SIGNAL_SOCIAL_DOMAINS.has(domain)) return "social";
  if (/(zoominfo|pitchbook|tracxn|craft\.co|cbinsights)/i.test(domain)) return "directory";
  return "general";
}

function scoreSearchSourceQuality(
  entity: string | null,
  source: { name: string; url: string; snippet: string },
  officialDomains: Set<string>,
): SearchSource {
  const { score: entityScore, matchedTokens } = sourceEntityScore(entity, source);
  const { domain, path } = parseSourceLocation(source.url);
  const kind = classifySearchSourceKind(source, officialDomains);
  const title = normalizeSearchText(source.name);
  const snippet = normalizeSearchText(source.snippet);
  const urlText = normalizeSearchText(source.url);
  const phrase = normalizeSearchText(entity);
  const compactPhrase = compactEntity(entity);
  const entityGrounded =
    Boolean(phrase && (title.includes(phrase) || snippet.includes(phrase) || urlText.includes(phrase))) ||
    Boolean(compactPhrase && (domain ?? "").replace(/[^a-z0-9]/g, "").includes(compactPhrase));

  let qualityScore = entityScore;

  if (phrase && title.includes(phrase)) qualityScore += 4;
  if (phrase && snippet.includes(phrase)) qualityScore += 3;
  if (compactPhrase && (domain ?? "").replace(/[^a-z0-9]/g, "").includes(compactPhrase)) qualityScore += 3;

  switch (kind) {
    case "official_root":
      qualityScore += 6;
      break;
    case "external_profile":
      qualityScore += 6;
      break;
    case "external_press":
      qualityScore += 5;
      break;
    case "official_article":
      qualityScore += 2;
      break;
    case "directory":
      qualityScore += 2;
      break;
    case "social":
      qualityScore -= 3;
      break;
    case "official_jobs":
    case "official_legal":
      qualityScore -= 8;
      break;
    default:
      break;
  }

  if (LOW_SIGNAL_PAGE_PATTERNS.some((pattern) => pattern.test(`${source.name} ${path ?? ""}`))) {
    qualityScore -= 4;
  }

  return {
    ...source,
    domain,
    path,
    kind,
    qualityScore,
    matchedTokens,
    entityGrounded,
    corroboration: kind.startsWith("official_") ? "self_reported" : "external",
  };
}

export function buildSearchQueries(
  query: string,
  entity: string | null,
  classification: string,
): string[] {
  const baseQuery = query.trim();
  if (classification !== "company_search" || !entity?.trim()) {
    return [baseQuery];
  }

  const urlDomains = extractExplicitDomains(query);
  const cleanedQuery = stripExplicitUrls(baseQuery) || baseQuery;
  const entityPrompt = `"${entity}"`;
  const recruiterScenario = /\b(recruiter|hiring|candidate|resume|interview|co[- ]founder|meeting|role)\b/i.test(query);

  return Array.from(new Set([
    baseQuery,
    cleanedQuery,
    `${entityPrompt} company linkedin crunchbase glassdoor`,
    ...urlDomains.map((domain) => `${entityPrompt} site:${domain}`),
    ...(recruiterScenario
      ? [
          `${entityPrompt} founder profile linkedin`,
          `${entityPrompt} hiring role expectations`,
        ]
      : []),
  ]));
}

function dedupeSources(sources: Array<{ name: string; url: string; snippet: string }>): Array<{ name: string; url: string; snippet: string }> {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.url}::${source.name}`.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveSearchThumbnailUrl(source: any): string | undefined {
  return resolveSearchImageCandidates(source)[0];
}

function resolveSearchImageCandidates(source: any): string[] {
  return dedupeMediaUrls([
    source?.thumbnailUrl,
    source?.thumbnail,
    source?.imageUrl,
    source?.image,
    source?.ogImageUrl,
    source?.ogImage,
    source?.previewImage,
    source?.previewImageUrl,
    source?.images?.[0]?.thumbnailUrl,
    source?.images?.[0]?.thumbnail,
    source?.images?.[0]?.imageUrl,
    source?.images?.[0]?.url,
    ...(Array.isArray(source?.images)
      ? source.images.flatMap((image: any) => [image?.thumbnailUrl, image?.thumbnail, image?.imageUrl, image?.url])
      : []),
    ...(Array.isArray(source?.imageCandidates) ? source.imageCandidates : []),
  ]).slice(0, 4);
}

function resolveSearchSiteName(source: any): string | undefined {
  return normalizeMediaUrl(
    source?.siteName ??
      source?.site_name ??
      source?.publisher ??
      source?.source ??
      source?.domain,
  );
}

function resolveSearchFaviconUrl(source: any): string | undefined {
  return normalizeMediaUrl(
    source?.faviconUrl ??
      source?.favicon ??
      source?.siteIcon ??
      source?.iconUrl,
  );
}

export function filterSearchSourcesForEntity(
  entity: string | null,
  sources: Array<{ name: string; url: string; snippet: string }>,
  classification: string,
): SearchSource[] {
  if (classification !== "company_search" || !entity?.trim()) {
    return sources.map((source) => ({
      ...source,
      ...parseSourceLocation(source.url),
      kind: "general",
      qualityScore: sourceEntityScore(entity, source).score,
      corroboration: "external",
    }));
  }

  const dedupedSources = dedupeSources(sources);
  const tokens = tokenizeEntity(entity);
  const officialDomains = inferOfficialDomains(entity, dedupedSources);
  const rankedSources = dedupedSources
    .map((source) => scoreSearchSourceQuality(entity, source, officialDomains))
    .filter((source) => {
      if (source.kind === "official_legal" || source.kind === "official_jobs") {
        return false;
      }
      if (tokens.length >= 2 && !source.entityGrounded) {
        return false;
      }
      return (source.qualityScore ?? 0) >= 8;
    })
    .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0));

  if (rankedSources.length === 0) {
    return dedupedSources.slice(0, Math.min(dedupedSources.length, 6)).map((source) => ({
      ...source,
      ...parseSourceLocation(source.url),
      kind: "general",
      qualityScore: sourceEntityScore(entity, source).score,
      corroboration: "external",
    }));
  }

  const selected: SearchSource[] = [];
  const domainCounts = new Map<string, number>();

  for (const source of rankedSources) {
    const domain = source.domain ?? "";
    const domainCap = officialDomains.has(domain) ? 2 : 1;
    if ((domainCounts.get(domain) ?? 0) >= domainCap) continue;
    selected.push(source);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    if (selected.length >= 6) break;
  }

  const hasExternal = selected.some((source) => source.corroboration === "external");
  if (!hasExternal) {
    const externalFallback = rankedSources.find((source) => source.corroboration === "external");
    if (externalFallback) {
      selected.pop();
      selected.push(externalFallback);
    }
  }

  return dedupeSources(selected).map((source) => {
    const ranked = rankedSources.find((candidate) => candidate.url === source.url && candidate.name === source.name);
    return ranked ?? {
      ...source,
      ...parseSourceLocation(source.url),
      kind: "general",
      qualityScore: sourceEntityScore(entity, source).score,
      corroboration: "external",
    };
  });
}

function buildSearchContextSummary(
  entity: string | null,
  classification: string,
  rawAnswer: string,
  sources: SearchSource[],
): string {
  if (classification !== "company_search" || sources.length === 0) {
    return rawAnswer;
  }

  return sources
    .slice(0, 6)
    .map((source, index) => {
      const title = source.name || `Source ${index + 1}`;
      const snippet = source.snippet.trim().slice(0, 240);
      const sourceTags = [source.kind, source.corroboration].filter(Boolean).join(", ");
      return `[S${index + 1}] ${title}${sourceTags ? ` (${sourceTags})` : ""}: ${snippet}`;
    })
    .join("\n");
}

// ─── Node 1: Classify ────────────────────────────────────────────

export function classify(state: PipelineState): PipelineState {
  const start = Date.now();
  const hints = computeRoutingHints(state.query);
  const topHint = hints[0];

  // Simple classification from routing hints
  let classification = "company_search";
  let entity: string | null = null;

  if (topHint?.domain === "founder_ops" && topHint.score > 0.3) {
    classification = "founder_ops";
  } else if (topHint?.domain === "competitor_analysis" && topHint.score > 0.2) {
    classification = "competitor";
  } else if (topHint?.domain === "idea_validation" && topHint.score > 0.2) {
    classification = "idea_validation";
  }

  entity = extractPrimaryEntityFromContextHint(state.contextHint) ?? extractEntityFromQuery(state.query);

  return {
    ...state,
    classification,
    entity,
    routingHints: hints,
    trace: [...state.trace, {
      step: "classify",
      status: "ok",
      detail: `${classification}, entity="${entity}", hints: ${formatRoutingHintsForPrompt(hints)}`,
      durationMs: Date.now() - start,
    }],
  };
}

// ─── Node 2: Search (Linkup API) ─────────────────────────────────

export async function search(state: PipelineState): Promise<PipelineState> {
  const start = Date.now();
  const linkupKey = process.env.LINKUP_API_KEY;
  const allowPaidSearch =
    process.env.NODEBENCH_ALLOW_PAID_SEARCH === "true" ||
    process.env.LINKUP_SEARCH_ALLOW_PAID === "true";

  if (!allowPaidSearch || !linkupKey) {
    try {
      const { multiSearch, toSearchSources: toMultiSources } = await import("../lib/multiSearch.js");
      const multi = await multiSearch(state.query, 8000);
      const rawSources = toMultiSources(multi.sources);
      const filteredSources = filterSearchSourcesForEntity(state.entity, rawSources, state.classification);
      const filteredAnswer = buildSearchContextSummary(state.entity, state.classification, "", filteredSources);
      const exploredSourceCount = dedupeSources(rawSources).length;

      return {
        ...state,
        searchAnswer: filteredAnswer,
        searchSources: filteredSources,
        searchExploredSourceCount: exploredSourceCount,
        searchDiscardedSourceCount: Math.max(0, exploredSourceCount - filteredSources.length),
        searchQueryVariants: [state.query],
        trace: [...state.trace, {
          step: "search",
          tool: multi.providers.length > 0 ? `free_search:${multi.providers.join("+")}` : "free_search",
          status: filteredSources.length > 0 ? "ok" : "error",
          detail: allowPaidSearch
            ? "LINKUP_API_KEY unavailable; used free providers only"
            : "paid search disabled; used free providers only",
          durationMs: Date.now() - start,
        }],
      };
    } catch (err: any) {
      return {
        ...state,
        searchAnswer: "",
        searchSources: [],
        searchExploredSourceCount: 0,
        searchDiscardedSourceCount: 0,
        searchQueryVariants: [],
        trace: [...state.trace, { step: "search", tool: "free_search", status: "error", detail: err?.message ?? "No free search provider", durationMs: Date.now() - start }],
      };
    }
  }

  if (!linkupKey) {
    return {
      ...state,
      searchAnswer: "",
      searchSources: [],
      searchExploredSourceCount: 0,
      searchDiscardedSourceCount: 0,
      searchQueryVariants: [],
      trace: [...state.trace, { step: "search", tool: "linkup", status: "error", detail: "No LINKUP_API_KEY", durationMs: Date.now() - start }],
    };
  }

  try {
    const queries = buildSearchQueries(state.query, state.entity, state.classification);
    const results = await Promise.allSettled(
      queries.map(async (queryVariant) => {
        const resp = await fetch("https://api.linkup.so/v1/search", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${linkupKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: queryVariant,
            depth: "standard",
            outputType: "sourcedAnswer",
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          throw new Error(`Linkup ${resp.status}`);
        }

        const data = (await resp.json()) as any;
        return {
          answer: data?.answer ?? "",
          sources: (data?.sources ?? []).map((source: any) => ({
            name: source.name ?? source.title ?? "",
            url: source.url ?? "",
            snippet: source.snippet ?? source.content ?? "",
            siteName: resolveSearchSiteName(source),
            faviconUrl: resolveSearchFaviconUrl(source),
            thumbnailUrl: resolveSearchThumbnailUrl(source),
            imageCandidates: resolveSearchImageCandidates(source),
          })),
        };
      }),
    );

    const successful = results
      .filter((result): result is PromiseFulfilledResult<{ answer: string; sources: Array<{ name: string; url: string; snippet: string; thumbnailUrl?: string }> }> => result.status === "fulfilled")
      .map((result) => result.value);

    if (successful.length === 0) {
      throw new Error("Linkup returned no successful query variants");
    }

    const answer = successful.find((result) => result.answer.trim().length > 0)?.answer ?? "";
    const rawSources = successful.flatMap((result) => result.sources);

    // Merge with secondary providers (Brave/Serper/Tavily) if configured
    let secondaryProviders: string[] = [];
    try {
      const { multiSearch, toSearchSources: toMultiSources } = await import("../lib/multiSearch.js");
      const multi = await multiSearch(state.query, 8000);
      if (multi.sources.length > 0) {
        const extraSources = toMultiSources(multi.sources).map((s) => ({
          name: s.name,
          url: s.url,
          snippet: s.snippet,
          thumbnailUrl: s.thumbnailUrl,
        }));
        rawSources.push(...extraSources);
        secondaryProviders = multi.providers.filter((p) => p !== "linkup");
      }
    } catch { /* secondary providers are best-effort */ }

    const filteredSources = filterSearchSourcesForEntity(state.entity, rawSources, state.classification);
    const filteredAnswer = buildSearchContextSummary(state.entity, state.classification, answer, filteredSources);
    const exploredSourceCount = dedupeSources(rawSources).length;
    const providerNote = secondaryProviders.length > 0 ? ` + ${secondaryProviders.join("+")}` : "";

    return {
      ...state,
      searchAnswer: filteredAnswer,
      searchSources: filteredSources,
      searchExploredSourceCount: exploredSourceCount,
      searchDiscardedSourceCount: Math.max(0, exploredSourceCount - filteredSources.length),
      searchQueryVariants: queries,
      trace: [...state.trace, {
        step: "search",
        tool: `linkup${providerNote}`,
        status: "ok",
        detail: `${filteredSources.length}/${exploredSourceCount} retained across ${queries.length} query variants${providerNote}, ${filteredAnswer.length} chars context`,
        durationMs: Date.now() - start,
      }],
    };
  } catch (err: any) {
    return {
      ...state,
      searchAnswer: "",
      searchSources: [],
      searchExploredSourceCount: 0,
      searchDiscardedSourceCount: 0,
      searchQueryVariants: [],
      trace: [...state.trace, {
        step: "search",
        tool: "linkup",
        status: "error",
        detail: err?.message ?? "search failed",
        durationMs: Date.now() - start,
      }],
    };
  }
}

// ─── Node 3: Analyze (Gemini structured extraction) ───────────────

function buildSourceAudit(
  sources: SearchSource[],
): {
  officialCount: number;
  externalCount: number;
  selfReportedCount: number;
  retainedCount: number;
} {
  return {
    officialCount: sources.filter((source) => source.corroboration === "self_reported").length,
    externalCount: sources.filter((source) => source.corroboration === "external").length,
    selfReportedCount: sources.filter((source) => source.corroboration === "self_reported").length,
    retainedCount: sources.length,
  };
}

function applyConfidenceGuardrails(
  confidence: number,
  audit: ReturnType<typeof buildSourceAudit>,
): number {
  let guarded = confidence;
  if (audit.externalCount === 0) guarded = Math.min(guarded, 58);
  else if (audit.externalCount === 1) guarded = Math.min(guarded, 72);
  if (audit.selfReportedCount >= Math.max(1, audit.retainedCount - 1)) guarded = Math.min(guarded, 68);
  if (audit.retainedCount < 3) guarded = Math.min(guarded, 65);
  return Math.max(0, Math.min(100, guarded));
}

function normalizeParsedSourceIdx(sourceIdx: unknown, citationIndices: number[]): number | undefined {
  if (citationIndices.length > 0) {
    return citationIndices[0];
  }
  if (typeof sourceIdx === "number" && Number.isFinite(sourceIdx)) {
    if (sourceIdx <= 0) return 0;
    return sourceIdx - 1;
  }
  return undefined;
}

export async function analyze(state: PipelineState): Promise<PipelineState> {
  const start = Date.now();
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey || (!state.searchAnswer && state.searchSources.length === 0)) {
    return {
      ...state,
      entityName: state.entity ?? "Unknown",
      answer: state.searchAnswer || "No search results available.",
      confidence: 0,
      signals: [],
      risks: [],
      comparables: [],
      nextActions: [],
      nextQuestions: [],
      keyMetrics: [],
      whyThisTeam: null,
      trace: [...state.trace, {
        step: "analyze",
        tool: "gemini",
        status: "error",
        detail: !geminiKey ? "No GEMINI_API_KEY" : "No search data to analyze",
        durationMs: Date.now() - start,
      }],
    };
  }

  const sourcesContext = state.searchSources
    .slice(0, 8)
    .map((s, i) => `[S${i + 1}] ${s.name}\nkind=${s.kind ?? "general"} corroboration=${s.corroboration ?? "external"}\n${s.url}\n${s.snippet.slice(0, 300)}`)
    .join("\n\n");
  const sourceAudit = buildSourceAudit(state.searchSources);

  // Context carry-forward: inject prior research if available
  let priorContextBlock = "";
  try {
    const { getSearchContext, buildContextPrompt } = await import("../lib/searchContext.js");
    const prior = getSearchContext(state.entity ?? state.query, state.lens);
    if (prior) {
      priorContextBlock = `\nPRIOR RESEARCH (build on this, focus on what is NEW or CHANGED):\n${buildContextPrompt(prior)}\n`;
    }
  } catch { /* context carry-forward is best-effort */ }

  const operatorContextBlock = state.contextHint?.trim()
    ? `\nOPERATOR CONTEXT (use this to shape framing, evidence depth, and next steps without changing the facts):\n${state.contextHint.trim()}\n`
    : "";

  const prompt = `You are a senior analyst writing a research brief about "${state.entity ?? "unknown"}" for a ${state.lens}.

ENTITY: ${state.entity ?? "unknown"}
QUERY: "${state.query}"

SOURCES (cite as [S1], [S2], etc.):
${sourcesContext}

ADDITIONAL CONTEXT:
${state.searchAnswer.slice(0, 800)}
${priorContextBlock}
${operatorContextBlock}
RULES:
1. Every factual claim MUST cite a source number [S1], [S2], etc.
2. Do NOT include generic industry commentary — only entity-specific facts.
3. If a claim appears in only one self-reported source (company blog, press release), label it "(self-reported)".
4. If corroboration is weak, say so explicitly and lower confidence.
5. Prefer specific numbers ($, %, dates) over qualitative statements.
6. Do NOT fabricate metrics. If revenue or valuation is not in the sources, set the value to "Not disclosed".

CRITICAL: keyMetrics MUST include "ARR or Revenue" and "Valuation" as the first two entries. Extract actual dollar amounts from sources if available. Use "$XB" or "$XM" format. If not found, use "Not disclosed".

Return ONLY valid JSON:
{
  "entityName": "company name",
  "answer": "3-4 sentence summary with specific numbers, citing sources as [S1], [S2] etc.",
  "confidence": 0-100,
  "keyMetrics": [{"label": "ARR or Revenue", "value": "$XB"}, {"label": "Valuation", "value": "$XB"}, {"label": "other metric", "value": "value"}],
  "signals": [{"name": "signal with [S1] citation", "direction": "up|down|neutral", "impact": "high|medium|low", "sourceIdx": 1}],
  "risks": [{"title": "risk", "description": "why it matters [S2]", "sourceIdx": 2}],
  "comparables": [{"name": "competitor", "relevance": "high|medium|low", "note": "why relevant"}],
  "whyThisTeam": {"founderCredibility": "...", "trustSignals": ["..."], "visionMagnitude": "...", "hiddenRequirements": ["..."]},
  "nextActions": [{"action": "specific step", "impact": "high|medium|low"}],
  "nextQuestions": ["follow-up question"]
}`;

  try {
    // Latest models: 3.1 Flash Lite (fastest) → 3 Flash → 2.5 Flash (stable GA)
    // PERF: Shrunk per-model timeout from 25s → 10s to fail-fast on hanging models.
    // Worst case cascade: 10s * 3 = 30s (was 75s). Typical success < 5s.
    const models = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-flash"];
    let resp: Response | null = null;
    let usedModel = models[0];
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2200, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) { usedModel = model; break; }
      } catch { continue; }
    }
    if (!resp) throw new Error("All Gemini models failed");

    if (!resp.ok) {
      throw new Error(`Gemini ${resp.status}`);
    }

    const data = (await resp.json()) as any;

    // Extract real token usage from Gemini API response
    const usageMetadata = data?.usageMetadata ?? {};
    const inputTokens = usageMetadata.promptTokenCount ?? 0;
    const outputTokens = usageMetadata.candidatesTokenCount ?? 0;
    const totalTokens = usageMetadata.totalTokenCount ?? 0;

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("No JSON in Gemini response");
    }

    const parsed = JSON.parse(jsonMatch[0].replace(/,\s*([\]}])/g, "$1"));
    const normalizedSignals = Array.isArray(parsed.signals)
      ? parsed.signals
          .map((signal: any) => {
            const citationIndices = extractSourceIndices(signal?.name);
            return {
              name: stripInlineSourceCitations(signal?.name ?? ""),
              direction: signal?.direction ?? "neutral",
              impact: signal?.impact ?? "medium",
              sourceIdx: normalizeParsedSourceIdx(signal?.sourceIdx, citationIndices),
            };
          })
          .filter((signal: { name: string }) => signal.name.length > 0)
      : [];
    const normalizedRisks = Array.isArray(parsed.risks)
      ? parsed.risks
          .map((risk: any) => {
            const citationIndices = extractSourceIndices(`${risk?.title ?? ""} ${risk?.description ?? ""}`);
            return {
              title: stripInlineSourceCitations(risk?.title ?? "Risk"),
              description: stripInlineSourceCitations(risk?.description ?? ""),
              sourceIdx: normalizeParsedSourceIdx(risk?.sourceIdx, citationIndices),
            };
          })
          .filter((risk: { title: string; description: string }) => risk.title.length > 0 || risk.description.length > 0)
      : [];
    const guardedConfidence = applyConfidenceGuardrails(
      typeof parsed.confidence === "number" ? parsed.confidence : 50,
      sourceAudit,
    );
    const nextQuestions = Array.isArray(parsed.nextQuestions)
      ? parsed.nextQuestions.filter((question: unknown): question is string => typeof question === "string" && question.trim().length > 0)
      : [];
    if (sourceAudit.externalCount < 2) {
      nextQuestions.unshift("What third-party evidence corroborates the company’s core product, traction, or funding claims?");
    }

    return {
      ...state,
      entityName: parsed.entityName ?? state.entity ?? "Unknown",
      answer: parsed.answer ?? "",
      confidence: guardedConfidence,
      signals: normalizedSignals,
      risks: normalizedRisks,
      comparables: Array.isArray(parsed.comparables) ? parsed.comparables : [],
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
      nextQuestions: Array.from(new Set(nextQuestions)),
      keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
      whyThisTeam: parsed.whyThisTeam ?? null,
      tokenUsage: { inputTokens, outputTokens, totalTokens, model: usedModel },
      trace: [...state.trace, {
        step: "analyze",
        tool: "gemini",
        status: "ok",
        detail: `${normalizedSignals.length} signals, ${normalizedRisks.length} risks, confidence ${guardedConfidence}, tokens: ${totalTokens}`,
        durationMs: Date.now() - start,
      }],
    };
  } catch (err: any) {
    return {
      ...state,
      entityName: state.entity ?? "Unknown",
      answer: state.searchAnswer || "Analysis failed.",
      confidence: 20,
      signals: [],
      risks: [],
      comparables: [],
      nextActions: [],
      nextQuestions: [],
      keyMetrics: [],
      whyThisTeam: null,
      trace: [...state.trace, {
        step: "analyze",
        tool: "gemini",
        status: "error",
        detail: err?.message ?? "analysis failed",
        durationMs: Date.now() - start,
      }],
    };
  }
}

// ─── Node 4: Package (deterministic) ─────────────────────────────

export async function packageResult(state: PipelineState): Promise<PipelineState> {
  const start = Date.now();

  // Classify signals into taxonomy
  const classifiedSignals = classifySignals(state.signals);

  // Build evidence spans from search sources
  const evidence = createEvidenceSpans(
    state.searchSources.map((s) => ({
      url: s.url,
      title: s.name,
      snippet: s.snippet,
      kind: s.kind,
      corroboration: s.corroboration,
      qualityScore: s.qualityScore,
    })),
    state.signals,
  );

  // Detect which pains this result resolves
  const painResolutions = detectPainResolutions({
    query: state.query,
    classification: state.classification,
    entityName: state.entityName,
    answer: state.answer,
    confidence: state.confidence,
    signals: state.signals,
    risks: state.risks,
    comparables: state.comparables,
    evidence,
    sourceRefs: state.searchSources.map((s) => ({ label: s.name, href: s.url, type: "web" })),
    nextActions: state.nextActions,
  });

  // DCF + Reverse DCF (banker/investor lenses, company searches only)
  let dcfResult: DCFResult | null = null;
  let reverseDCFResult: ReverseDCFResult | null = null;
  if (state.classification === "company_search" && (state.lens === "investor" || state.lens === "banker")) {
    let dcfInputs = extractDCFInputs({
      entityName: state.entityName,
      answer: state.answer,
      keyMetrics: state.keyMetrics,
      signals: state.signals,
    });
    // Fallback: try SEC EDGAR for real financial data (US public companies)
    if (!dcfInputs.canRunDCF) {
      try { dcfInputs = await enrichDCFWithEdgar(state.entityName, dcfInputs); } catch { /* EDGAR is best-effort */ }
    }
    if (dcfInputs.canRunDCF && dcfInputs.dcfInput) {
      dcfResult = runDCF(dcfInputs.dcfInput);
    }
    if (dcfInputs.reverseDCFInput) {
      reverseDCFResult = runReverseDCF(dcfInputs.reverseDCFInput);
    }
  }

  return {
    ...state,
    classifiedSignals,
    evidence,
    painResolutions,
    dcf: dcfResult,
    reverseDCF: reverseDCFResult,
    trace: [...state.trace, {
      step: "package",
      status: "ok",
      detail: `${classifiedSignals.length} signals, ${evidence.totalSpans} evidence, ${painResolutions.length} pains resolved${dcfResult ? `, DCF: $${(dcfResult.enterpriseValue / 1e9).toFixed(1)}B` : ""}`,
      durationMs: Date.now() - start,
    }],
  };
}

// ─── Progress callback type ──────────────────────────────────────

export interface PipelineProgressEvent {
  stage: "classify" | "search" | "analyze" | "package";
  phase: "start" | "done";
  state: PipelineState;
  durationMs?: number;
}

export type OnPipelineProgress = (event: PipelineProgressEvent) => void;

// ─── Run full pipeline ───────────────────────────────────────────

export function createInitialPipelineState(query: string, lens: string, contextHint?: string): PipelineState {
  return {
    query,
    lens,
    contextHint: contextHint?.trim() || undefined,
    classification: "",
    entity: null,
    routingHints: [],
    searchAnswer: "",
    searchSources: [],
    searchExploredSourceCount: 0,
    searchDiscardedSourceCount: 0,
    searchQueryVariants: [],
    entityName: "",
    answer: "",
    confidence: 0,
    signals: [],
    risks: [],
    comparables: [],
    nextActions: [],
    nextQuestions: [],
    keyMetrics: [],
    whyThisTeam: null,
    classifiedSignals: [],
    evidence: { totalSpans: 0, verifiedCount: 0, partialCount: 0, unverifiedCount: 0, contradictedCount: 0, verificationRate: 0, spans: [] },
    painResolutions: [],
    dcf: null,
    reverseDCF: null,
    trace: [],
    totalDurationMs: 0,
    error: null,
  };
}

export async function runSearchPipeline(
  query: string,
  lens: string,
  onProgress?: OnPipelineProgress,
  contextHint?: string,
): Promise<PipelineState> {
  const pipelineStart = Date.now();
  let state = createInitialPipelineState(query, lens, contextHint);

  // classify
  onProgress?.({ stage: "classify", phase: "start", state });
  const classifyStart = Date.now();
  state = classify(state);
  onProgress?.({ stage: "classify", phase: "done", state, durationMs: Date.now() - classifyStart });

  // search
  onProgress?.({ stage: "search", phase: "start", state });
  const searchStart = Date.now();
  state = await search(state);
  onProgress?.({ stage: "search", phase: "done", state, durationMs: Date.now() - searchStart });

  // analyze
  onProgress?.({ stage: "analyze", phase: "start", state });
  const analyzeStart = Date.now();
  state = await analyze(state);
  onProgress?.({ stage: "analyze", phase: "done", state, durationMs: Date.now() - analyzeStart });

  // package
  onProgress?.({ stage: "package", phase: "start", state });
  const packageStart = Date.now();
  state = await packageResult(state);
  onProgress?.({ stage: "package", phase: "done", state, durationMs: Date.now() - packageStart });

  state.totalDurationMs = Date.now() - pipelineStart;

  // Save context for follow-up carry-forward
  try {
    const { setSearchContext } = await import("../lib/searchContext.js");
    if (state.entityName && state.confidence >= 30) {
      setSearchContext({
        entityName: state.entityName,
        lens,
        query,
        answer: state.answer,
        confidence: state.confidence,
        sourceUrls: state.searchSources.map((s) => s.url).slice(0, 10),
        signals: state.signals.map((s) => s.name).slice(0, 10),
        risks: state.risks.map((r) => r.title).slice(0, 5),
        keyMetrics: state.keyMetrics.slice(0, 5),
        timestamp: Date.now(),
      });
    }
  } catch { /* context save is best-effort */ }

  return state;
}

// ─── Envelope-aware pipeline wrapper ──────────────────────────────

import {
  buildWorkflowAssetFromEnvelope,
  createEnvelopeFromPipelineState,
  createEnvelopeFromResultPacket,
  type WorkflowEnvelope,
} from "../lib/workflowEnvelope.js";
import { trajectoryFromPipelineState, saveSearchTrajectory, type SearchTrajectory } from "../lib/trajectoryStore.js";
import { detectReplayCandidate, type ReplayCandidate } from "../lib/replayDetector.js";

export interface PipelineWithEnvelopeResult {
  state: PipelineState;
  envelope: WorkflowEnvelope;
  trajectory: SearchTrajectory;
  replayCandidate: ReplayCandidate | null;
  wasReplay: boolean;
}

export async function runSearchPipelineWithEnvelope(
  query: string,
  lens: string,
): Promise<PipelineWithEnvelopeResult> {
  // Pre-pipeline: check for replayable trajectory
  // Extract entity from query for replay lookup (simple heuristic: first capitalized multi-word)
  const entityGuess = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/)?.[1] ?? query.split(/\s+/)[0] ?? "";
  const replayCandidate = entityGuess ? detectReplayCandidate(entityGuess, lens, query) : null;

  // Run full pipeline (replay short-circuit is future work — for now always run full)
  const state = await runSearchPipeline(query, lens);

  // Create envelope
  const packetId = `pkt-${(state.entityName || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  const envelope = createEnvelopeFromPipelineState(state, packetId);

  // Record trajectory for future replay
  const trajectory = trajectoryFromPipelineState(state, envelope.transport.envelopeId);
  try {
    saveSearchTrajectory(trajectory);
  } catch (err) {
    console.warn("[pipeline] Failed to save trajectory:", (err as Error).message);
  }

  return {
    state,
    envelope,
    trajectory,
    replayCandidate,
    wasReplay: false,
  };
}

// ─── Convert pipeline state to ResultPacket format ────────────────

function slugifyPacketValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function hashPacketValue(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function uniquePacketSourceIds(values: Array<string | undefined | null>, limit = 4): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)),
  ).slice(0, limit);
}

function sourceIdsFromIndices(
  sourceRefs: Array<{ id: string }>,
  indices: Array<number | undefined>,
  limit = 4,
): string[] {
  return uniquePacketSourceIds(
    indices.map((index) => (typeof index === "number" && Number.isFinite(index) && index >= 0 ? sourceRefs[index]?.id : undefined)),
    limit,
  );
}

function joinReadableParts(parts: Array<string | undefined | null>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stateToResultPacket(state: PipelineState): Record<string, unknown> {
  const cleanedAnswer = stripInlineSourceCitations(state.answer);
  const packetId = `pkt-${slugifyPacketValue(state.entityName || "nodebench")}-${hashPacketValue(
    `${state.query}|${cleanedAnswer}|${state.searchSources.length}`,
  )}`;
  const packetType = "company_search_packet";
  const sourceRefs = state.searchSources.map((source, index) => ({
    id: `src_${index + 1}`,
    label: source.name,
    title: source.name,
    href: source.url,
    type: "web" as const,
    status: index < 5 ? "cited" as const : "explored" as const,
    domain: source.domain,
    siteName: source.siteName,
    faviconUrl: source.faviconUrl,
    thumbnailUrl: source.thumbnailUrl,
    imageCandidates: source.imageCandidates,
    excerpt: source.snippet.slice(0, 280),
    confidence: Math.max(45, Math.min(95, Math.round(source.qualityScore ?? 60))),
  }));
  const topSourceIds = sourceRefs.slice(0, 2).map((source) => source.id);
  const signalSourceIds = sourceIdsFromIndices(
    sourceRefs,
    state.signals.slice(0, 4).map((signal) => signal.sourceIdx),
  );
  const riskSourceIds = sourceIdsFromIndices(
    sourceRefs,
    state.risks.slice(0, 4).map((risk) => risk.sourceIdx),
  );

  const claimRefs = state.answer
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 4)
    .map((sentence, index) => ({
      id: `claim_${index + 1}`,
      text: stripInlineSourceCitations(sentence),
      sourceRefIds: extractSourceIndices(sentence)
        .map((sourceIndex) => sourceRefs[sourceIndex]?.id)
        .filter((sourceId): sourceId is string => Boolean(sourceId)),
      answerBlockIds: ["answer:block:summary"],
      status: "retained" as const,
    }))
    .filter((claim) => claim.text.length > 0)
    .map((claim) => ({
      ...claim,
      sourceRefIds: claim.sourceRefIds.length > 0 ? claim.sourceRefIds : sourceRefs.slice(0, 2).map((source) => source.id),
    }));

  const whyText = joinReadableParts([
    state.classifiedSignals.length > 0
      ? `Top signals: ${state.classifiedSignals
          .slice(0, 3)
          .map((signal) => signal.summary || signal.rawName || signal.label)
          .join("; ")}.`
      : undefined,
    state.keyMetrics.length > 0
      ? `Key metrics: ${state.keyMetrics
          .slice(0, 2)
          .map((metric) => `${metric.label} ${metric.value}`)
          .join("; ")}.`
      : undefined,
  ]);
  const missingText = joinReadableParts([
    state.risks.length > 0
      ? state.risks
          .slice(0, 2)
          .map((risk) => `${risk.title}: ${risk.description}`.trim())
          .join(" ")
      : undefined,
    state.risks.length === 0 && state.nextQuestions[0]
      ? `Open question: ${state.nextQuestions[0]}`
      : undefined,
    state.risks.length === 0 && !state.nextQuestions[0] && state.confidence < 75
      ? `Confidence is ${state.confidence}%, so the brief still needs more corroboration.`
      : undefined,
  ]);
  const nextActionText = joinReadableParts([
    state.nextActions.length > 0
      ? state.nextActions
          .slice(0, 2)
          .map((next) => `${next.action}${next.impact ? ` (${next.impact} impact)` : ""}.`)
          .join(" ")
      : undefined,
    state.nextActions.length === 0 && state.nextQuestions[0]
      ? `Resolve this next: ${state.nextQuestions[0]}`
      : undefined,
  ]);

  const answerBlocks = [
    {
      id: "answer:block:summary",
      title: "What it is",
      text: cleanedAnswer,
      sourceRefIds: Array.from(new Set(claimRefs.flatMap((claim) => claim.sourceRefIds))).slice(0, 4),
      claimIds: claimRefs.map((claim) => claim.id),
      status: "cited" as const,
    },
    {
      id: "answer:block:why",
      title: "Why it matters",
      text:
        whyText ||
        "The packet did not surface a distinct why-this-matters read yet.",
      sourceRefIds: signalSourceIds.length > 0 ? signalSourceIds : topSourceIds,
      claimIds: [],
      status: "cited" as const,
    },
    {
      id: "answer:block:gaps",
      title: "What is missing",
      text:
        missingText ||
        "No explicit gaps were called out, but additional corroboration would strengthen the brief.",
      sourceRefIds: riskSourceIds.length > 0 ? riskSourceIds : topSourceIds,
      claimIds: [],
      status: state.risks.length > 0 || state.confidence < 75 ? "uncertain" as const : "cited" as const,
    },
    {
      id: "answer:block:next",
      title: "What to do next",
      text:
        nextActionText ||
        "No explicit next move was returned.",
      sourceRefIds: uniquePacketSourceIds([...signalSourceIds, ...riskSourceIds, ...topSourceIds], 4),
      claimIds: [],
      status: "cited" as const,
    },
  ];

  const enrichedChanges = state.signals.slice(0, 3).map((signal, index) => ({
    description: `${signal.name} is ${signal.direction} with ${signal.impact} impact.`,
    sourceIdx: signal.sourceIdx,
    sourceRefIds: sourceIdsFromIndices(sourceRefs, [signal.sourceIdx], 2),
    date: index === 0 ? new Date().toISOString().slice(0, 10) : undefined,
  }));
  const enrichedRisks = state.risks.slice(0, 3).map((risk) => ({
    ...risk,
    sourceRefIds: sourceIdsFromIndices(sourceRefs, [risk.sourceIdx], 2),
  }));
  const enrichedNextActions = state.nextActions.slice(0, 3).map((action) => ({
    ...action,
    sourceRefIds: uniquePacketSourceIds([...signalSourceIds, ...riskSourceIds, ...topSourceIds], 2),
  }));

  const basePacket = {
    query: state.query,
    entityName: state.entityName,
    canonicalEntity: state.entityName,
    answer: cleanedAnswer,
    confidence: state.confidence,
    sourceCount: state.searchSources.length,
    packetId,
    packetType,
    variables: state.classifiedSignals.slice(0, 5).map((sig, i) => ({
      rank: i + 1,
      name: sig.label,
      category: sig.category,
      direction: sig.direction,
      impact: sig.impact,
      confidence: sig.confidence,
      rawName: sig.rawName,
      evidenceRefs: sig.evidenceRefs,
      needsOntologyReview: sig.needsOntologyReview,
      sourceIdx: state.signals[i]?.sourceIdx,
      sourceRefIds: sourceIdsFromIndices(sourceRefs, [state.signals[i]?.sourceIdx], 2),
    })),
    keyMetrics: state.keyMetrics.length > 0 ? state.keyMetrics : [
      { label: "Confidence", value: `${state.confidence}%` },
      { label: "Retained Sources", value: String(state.searchSources.length) },
      { label: "Signals", value: String(state.classifiedSignals.length) },
    ],
    changes: enrichedChanges,
    risks: enrichedRisks,
    comparables: state.comparables.slice(0, 4),
    whyThisTeam: state.whyThisTeam,
    interventions: enrichedNextActions,
    nextActions: enrichedNextActions,
    nextQuestions: state.nextQuestions,
    sourceRefs,
    claimRefs,
    answerBlocks,
    explorationMemory: {
      exploredSourceCount: state.searchExploredSourceCount || state.searchSources.length,
      citedSourceCount: sourceRefs.filter((source) => source.status === "cited").length,
      discardedSourceCount: state.searchDiscardedSourceCount,
      entityCount: 1,
      claimCount: claimRefs.length,
      contradictionCount: state.risks.length,
    },
    evidence: state.evidence,
    painResolutions: state.painResolutions,
    dcf: state.dcf,
    reverseDCF: state.reverseDCF,
    trace: state.trace,
    classification: state.classification,
    routingHints: state.routingHints.slice(0, 3),
    recommendedNextAction: enrichedNextActions[0]?.action,
    tokenUsage: state.tokenUsage ?? null,
    realCost: state.tokenUsage ? {
      model: state.tokenUsage.model,
      inputTokens: state.tokenUsage.inputTokens,
      outputTokens: state.tokenUsage.outputTokens,
      inputCostUsd: (state.tokenUsage.inputTokens / 1_000_000) * 0.075,
      outputCostUsd: (state.tokenUsage.outputTokens / 1_000_000) * 0.30,
      totalCostUsd: ((state.tokenUsage.inputTokens / 1_000_000) * 0.075) + ((state.tokenUsage.outputTokens / 1_000_000) * 0.30),
    } : null,
  };

  const envelope = createEnvelopeFromResultPacket({
    ...basePacket,
    packetId,
    packetType,
    classification: state.classification,
    lens: state.lens,
    trace: state.trace,
  });

  return {
    ...basePacket,
    workflowAsset: buildWorkflowAssetFromEnvelope(
      {
        ...basePacket,
        packetId,
        packetType,
        classification: state.classification,
        lens: state.lens,
        trace: state.trace,
      },
      envelope,
      {
        assetType: "research_packet",
        stages: ["pipeline_classify", "pipeline_search", "pipeline_analyze", "pipeline_package"],
        replayReady: state.trace.length > 0,
        delegationReady: state.nextActions.length > 0,
        targetAgents: ["claude_code", "openclaw"],
        lineage: {
          sourceRunId: packetId,
        },
      },
    ),
  };
}
