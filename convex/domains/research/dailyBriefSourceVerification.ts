import { v } from "convex/values";

import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

const MAX_SOURCES_PER_RUN = 4;
const FETCH_TIMEOUT_MS = 8500;
const MAX_FETCH_CHARS = 180_000;
const MIN_MATCH_TERMS = 3;

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "between",
  "brief",
  "could",
  "daily",
  "does",
  "from",
  "have",
  "into",
  "more",
  "nodebench",
  "over",
  "should",
  "source",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "update",
  "using",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

type SourceInput = {
  title: string;
  url: string;
  host: string;
  relevance?: string;
};

type VerificationResult = {
  title: string;
  url: string;
  host: string;
  ok: boolean;
  status?: number;
  fetchedAt: number;
  contentHash?: string;
  contentBytes?: number;
  contentType?: "html" | "json" | "pdf" | "markdown" | "text";
  cacheAction?: string;
  titleMatched: boolean;
  relevanceMatched: boolean;
  claimTermsMatched: number;
  supportScore: number;
  verdict: "supports" | "partial" | "weak" | "unreachable";
  reason: string;
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function shortStableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripHtml(input: string): string {
  return normalizeWhitespace(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"'),
  );
}

function byteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

function contentTypeForCache(raw: string | null): NonNullable<VerificationResult["contentType"]> {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("application/json")) return "json";
  if (value.includes("application/pdf")) return "pdf";
  if (value.includes("text/markdown")) return "markdown";
  if (value.includes("text/html") || value.includes("application/xhtml")) return "html";
  return "text";
}

function normalizeFetchedBody(raw: string, cacheContentType: VerificationResult["contentType"]): string {
  const sliced = raw.length > MAX_FETCH_CHARS ? raw.slice(0, MAX_FETCH_CHARS) : raw;
  if (cacheContentType === "html") return stripHtml(sliced);
  if (cacheContentType === "json") {
    try {
      return normalizeWhitespace(JSON.stringify(JSON.parse(sliced), null, 2));
    } catch {
      return normalizeWhitespace(sliced);
    }
  }
  return normalizeWhitespace(sliced);
}

function tokenSet(input: string | undefined, minLength = 4): Set<string> {
  if (!input) return new Set();
  const tokens = input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= minLength && !STOPWORDS.has(token));
  return new Set(tokens);
}

function countMatches(needles: Set<string>, haystack: string): number {
  if (needles.size === 0) return 0;
  let count = 0;
  for (const token of needles) {
    if (haystack.includes(token)) count += 1;
  }
  return count;
}

function hostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function publicUrlCheck(rawUrl: string): { ok: true; normalizedUrl: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Malformed URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: `Blocked ${parsed.protocol} URL` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Blocked URL with credentials" };
  }
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /\.local$/,
    /metadata\.google\.internal$/,
    /metadata\.aws\./,
  ];
  if (blockedHosts.some((rx) => rx.test(hostname))) {
    return { ok: false, reason: `Blocked private or metadata host ${hostname}` };
  }
  const suspiciousParams = [
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "auth",
    "session",
    "sessionid",
    "sid",
    "signature",
    "sig",
  ];
  for (const key of suspiciousParams) {
    if (parsed.searchParams.has(key)) {
      return { ok: false, reason: `Blocked auth-like query param ${key}` };
    }
  }
  parsed.hash = "";
  return { ok: true, normalizedUrl: parsed.toString() };
}

type CanonicalUpsert = (
  url: string,
  body: string,
  contentType: NonNullable<VerificationResult["contentType"]>,
) => Promise<{ action: string }>;

async function fetchPublicSource(
  source: SourceInput,
  claimText: string,
  runCanonicalUpsert: CanonicalUpsert,
): Promise<VerificationResult> {
  const fetchedAt = Date.now();
  const checked = publicUrlCheck(source.url);
  if (!checked.ok) {
    return {
      title: source.title,
      url: source.url,
      host: source.host || hostFromUrl(source.url),
      ok: false,
      fetchedAt,
      titleMatched: false,
      relevanceMatched: false,
      claimTermsMatched: 0,
      supportScore: 0,
      verdict: "unreachable",
      reason: checked.reason,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(checked.normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent": "NodeBenchSourceVerifier/1.0 (+https://nodebenchai.com)",
      },
    });
    const raw = await response.text();
    const cacheContentType = contentTypeForCache(response.headers.get("content-type"));
    const normalizedBody = normalizeFetchedBody(raw, cacheContentType);
    const normalizedLower = normalizedBody.toLowerCase();
    const contentHash = await sha256Hex(normalizedBody);
    const titleMatches = countMatches(tokenSet(source.title), normalizedLower);
    const relevanceMatches = countMatches(tokenSet(source.relevance), normalizedLower);
    const claimMatches = countMatches(tokenSet(claimText), normalizedLower);
    const titleMatched = titleMatches >= 2 || (source.title.length > 10 && normalizedLower.includes(source.title.toLowerCase().slice(0, 40)));
    const relevanceMatched = relevanceMatches >= MIN_MATCH_TERMS;
    const statusScore = response.ok ? 30 : response.status >= 300 && response.status < 400 ? 24 : response.status === 403 || response.status === 429 ? 12 : 6;
    const supportScore = Math.min(
      100,
      statusScore +
        Math.min(claimMatches, 8) * 6 +
        (titleMatched ? 14 : 0) +
        (relevanceMatched ? 20 : 0),
    );
    const verdict: VerificationResult["verdict"] =
      !response.ok && supportScore < 45
        ? "unreachable"
        : supportScore >= 72
          ? "supports"
          : supportScore >= 50
            ? "partial"
            : "weak";

    let cacheAction: string | undefined;
    if (response.ok && normalizedBody.length > 0) {
      try {
        const upsert = await runCanonicalUpsert(checked.normalizedUrl, normalizedBody, cacheContentType);
        cacheAction = upsert.action;
      } catch (error) {
        cacheAction = `cache rejected: ${error instanceof Error ? error.message.slice(0, 90) : "unknown"}`;
      }
    }

    return {
      title: source.title,
      url: checked.normalizedUrl,
      host: source.host || hostFromUrl(checked.normalizedUrl),
      ok: response.ok,
      status: response.status,
      fetchedAt,
      contentHash,
      contentBytes: byteLength(normalizedBody),
      contentType: cacheContentType,
      cacheAction,
      titleMatched,
      relevanceMatched,
      claimTermsMatched: claimMatches,
      supportScore,
      verdict,
      reason: buildReason(verdict, response.status, claimMatches, titleMatched, relevanceMatched),
    };
  } catch (error) {
    return {
      title: source.title,
      url: checked.normalizedUrl,
      host: source.host || hostFromUrl(checked.normalizedUrl),
      ok: false,
      fetchedAt,
      titleMatched: false,
      relevanceMatched: false,
      claimTermsMatched: 0,
      supportScore: 0,
      verdict: "unreachable",
      reason: error instanceof Error && error.name === "AbortError"
        ? `Timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Fetch failed: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildReason(
  verdict: VerificationResult["verdict"],
  status: number | undefined,
  claimMatches: number,
  titleMatched: boolean,
  relevanceMatched: boolean,
) {
  if (verdict === "unreachable") {
    return status ? `HTTP ${status}; not enough fetched support to verify this claim.` : "Source could not be fetched.";
  }
  const pieces = [`HTTP ${status ?? "ok"}`, `${claimMatches} claim terms matched`];
  if (titleMatched) pieces.push("title matched");
  if (relevanceMatched) pieces.push("evidence snippet matched");
  return pieces.join(" - ");
}

export const verifyDailyBriefSourceSupport = action({
  args: {
    claimText: v.string(),
    sources: v.array(v.object({
      title: v.string(),
      url: v.string(),
      host: v.string(),
      relevance: v.optional(v.string()),
    })),
    maxSources: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const runId = `db-src-${shortStableHash(`${args.claimText}:${Date.now()}`)}`;
    try {
      const maxSources = Math.max(1, Math.min(args.maxSources ?? MAX_SOURCES_PER_RUN, MAX_SOURCES_PER_RUN));
      const sources = args.sources
        .filter((source) => source.url && source.url.length < 2_000)
        .slice(0, maxSources);

      const runCanonicalUpsert: CanonicalUpsert = (url, body, contentType) =>
        ctx.runMutation(api.domains.search.sharedCache.upsertCanonicalSource, {
          url,
          body,
          contentType,
        }) as Promise<{ action: string }>;

      const results: VerificationResult[] = [];
      for (const source of sources) {
        results.push(await fetchPublicSource(source, args.claimText, runCanonicalUpsert));
      }
      const passed = results.filter((result) => result.verdict === "supports" || result.verdict === "partial").length;
      const strongest = results.reduce((best, result) => Math.max(best, result.supportScore), 0);
      const verdict =
        results.some((result) => result.verdict === "supports")
          ? "supported"
          : results.some((result) => result.verdict === "partial" || result.verdict === "weak")
            ? "needs_review"
            : "unreachable";
      return {
        runId,
        generatedAt: Date.now(),
        verdict,
        score: strongest,
        checked: results.length,
        passed,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown verification failure";
      return {
        runId,
        generatedAt: Date.now(),
        verdict: "unreachable",
        score: 0,
        checked: 0,
        passed: 0,
        results: [{
          title: "Verification runtime",
          url: "",
          host: "nodebench",
          ok: false,
          fetchedAt: Date.now(),
          titleMatched: false,
          relevanceMatched: false,
          claimTermsMatched: 0,
          supportScore: 0,
          verdict: "unreachable",
          reason: `Verifier failed closed: ${message.slice(0, 160)}`,
        }],
      };
    }
  },
});
