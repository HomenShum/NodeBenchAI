/**
 * Entity expansion action — the core of the expandable graph notebook.
 *
 * When a user clicks [⊕ Expand] on a mention chip, this action:
 *   1. Validates idempotency (reject duplicate runs)
 *   2. Searches via Linkup for entity intelligence
 *   3. Extracts SPO triples via Gemini
 *   4. Applies a validated graph patch (new claims, edges, backlinks)
 *   5. Updates the expansion snapshot for instant hover preview
 *
 * Pattern: orchestrator-workers (single expansion run, multiple search queries)
 * Prior art:
 *   - Roam Research: bidirectional backlinks, block-level graph traversal
 *   - Anthropic: Building Effective Agents (2024), orchestrator-workers
 *   - Existing: convex/domains/search/deepDiligence.ts searchWithFallback()
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

// ── Constants ────────────────────────────────────────────────────────────

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent";

/** BOUND: max search queries per expansion run */
const MAX_SEARCH_QUERIES = 5;
/** BOUND: max claims the agent can propose per patch */
const MAX_CLAIMS_PER_PATCH = 50;
/** BOUND: max edges per patch */
const MAX_EDGES_PER_PATCH = 100;
/** BOUND: max backlinks per patch */
const MAX_BACKLINKS_PER_PATCH = 50;
/** TIMEOUT: total action wall-clock budget (ms) */
const ACTION_TIMEOUT_MS = 55_000; // 55s to leave headroom under Convex 60s limit
/** TIMEOUT: per-search timeout (ms) */
const SEARCH_TIMEOUT_MS = 15_000;
/** BOUND_READ: max response bytes from Linkup */
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB
/** Snapshot staleness default */
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
/** BOUND: max key facts in snapshot */
const MAX_KEY_FACTS = 10;
/** BOUND: max recent claims in snapshot */
const MAX_RECENT_CLAIMS = 20;

// ── SSRF blocklist ───────────────────────────────────────────────────────

const SSRF_BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^metadata\.google\.internal$/i,
];

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !SSRF_BLOCKED_PATTERNS.some((p) => p.test(parsed.hostname));
  } catch {
    return false;
  }
}

// ── Public mutation: start an expansion ──────────────────────────────────

/**
 * Client calls this to start an expansion. Returns < 50ms with the runId.
 * The actual work runs in a scheduled action.
 */
export const startExpansion = mutation({
  args: {
    targetEntityId: v.id("entityProfiles"),
    targetBlockId: v.optional(v.string()),
    targetDocumentId: v.optional(v.id("documents")),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotency: check for active run on same entity by same user
    const existing = await ctx.db
      .query("expansionRuns")
      .withIndex("by_entity", (q) => q.eq("targetEntityId", args.targetEntityId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.or(
            q.eq(q.field("status"), "queued"),
            q.eq(q.field("status"), "searching"),
            q.eq(q.field("status"), "extracting"),
            q.eq(q.field("status"), "persisting"),
          ),
        ),
      )
      .first();

    if (existing) {
      return { runId: existing.runId, deduplicated: true };
    }

    const now = Date.now();
    const runId = `exp_${args.targetEntityId}_${args.userId}_${now}`;

    const docId = await ctx.db.insert("expansionRuns", {
      runId,
      userId: args.userId,
      targetEntityId: args.targetEntityId,
      targetBlockId: args.targetBlockId,
      targetDocumentId: args.targetDocumentId,
      status: "queued",
      claimsCreated: 0,
      edgesCreated: 0,
      sourcesFound: 0,
      searchQueries: 0,
      maxSearchQueries: MAX_SEARCH_QUERIES,
      retryCount: 0,
      createdAt: now,
    });

    // Schedule the expansion action to run immediately
    await ctx.scheduler.runAfter(0, internal.domains.graph.expandEntity.executeExpansion, {
      expansionRunId: docId,
    });

    return { runId, deduplicated: false };
  },
});

// ── Query: expansion run status ──────────────────────────────────────────

export const getExpansionStatus = query({
  args: { targetEntityId: v.id("entityProfiles") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("expansionRuns")
      .withIndex("by_entity", (q) => q.eq("targetEntityId", args.targetEntityId))
      .order("desc")
      .first();
  },
});

export const getExpansionSnapshot = query({
  args: { entityId: v.id("entityProfiles") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("expansionSnapshots")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();
  },
});

// ── Internal: the main expansion action ──────────────────────────────────

export const executeExpansion = internalAction({
  args: {
    expansionRunId: v.id("expansionRuns"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    const geminiKey = process.env.GEMINI_API_KEY;
    const linkupKey = process.env.LINKUP_API_KEY;

    // Load the run record
    const run = await ctx.runQuery(internal.domains.graph.expandEntity.internalGetRun, {
      runId: args.expansionRunId,
    });
    if (!run || run.status !== "queued") return;

    // Load entity profile
    const entity = await ctx.runQuery(internal.domains.graph.expandEntity.internalGetEntity, {
      entityId: run.targetEntityId,
    });
    if (!entity) {
      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
        runId: args.expansionRunId,
        status: "failed",
        errorMessage: "Entity not found",
        completedAt: Date.now(),
      });
      return;
    }

    const entityName = entity.canonicalName;
    const entityType = entity.entityType ?? "company";

    try {
      // ── Phase 1: Search ──────────────────────────────────────────
      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
        runId: args.expansionRunId,
        status: "searching",
      });

      const searchQueries = buildSearchQueries(entityName, entityType);
      const allSnippets: string[] = [];
      const allSources: Array<{ url: string; title: string }> = [];
      let searchCount = 0;

      for (const query of searchQueries.slice(0, MAX_SEARCH_QUERIES)) {
        if (Date.now() - startTime > ACTION_TIMEOUT_MS) break;

        const result = await searchWithFallback(query, linkupKey, geminiKey);
        searchCount++;
        allSnippets.push(...result.snippets);
        allSources.push(...result.sources);
      }

      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunSearchCount, {
        runId: args.expansionRunId,
        searchQueries: searchCount,
        sourcesFound: allSources.length,
      });

      if (allSnippets.length === 0) {
        await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
          runId: args.expansionRunId,
          status: "completed",
          completedAt: Date.now(),
        });
        return;
      }

      // ── Phase 2: Extract ─────────────────────────────────────────
      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
        runId: args.expansionRunId,
        status: "extracting",
      });

      const claims = await extractClaims(entityName, allSnippets, allSources, geminiKey);

      // ── Phase 3: Persist ─────────────────────────────────────────
      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
        runId: args.expansionRunId,
        status: "persisting",
      });

      const patchResult = await ctx.runMutation(
        internal.domains.graph.applyGraphPatch.applyPatch,
        {
          targetEntityId: run.targetEntityId,
          agentRunId: run.runId,
          userId: run.userId,
          claims: claims.slice(0, MAX_CLAIMS_PER_PATCH).map((c) => ({
            subject: c.subject,
            predicate: c.predicate,
            object: c.object,
            claimText: c.claimText,
            sourceUrls: c.sourceUrls.filter(isUrlSafe),
            isHighConfidence: c.isHighConfidence,
          })),
          backlinks: claims
            .filter((c) => c.relatedEntities?.length)
            .flatMap((c) =>
              (c.relatedEntities ?? []).map((re) => ({
                targetEntityName: re,
                backlinkType: "derived" as const,
                confidence: c.isHighConfidence ? 0.8 : 0.5,
                sourceContext: c.claimText.slice(0, 200),
              })),
            )
            .slice(0, MAX_BACKLINKS_PER_PATCH),
        },
      );

      // ── Phase 4: Update snapshot ─────────────────────────────────
      const summary = await generateSummary(entityName, claims, geminiKey);

      await ctx.runMutation(internal.domains.graph.expandEntity.upsertSnapshot, {
        entityId: run.targetEntityId,
        summary,
        keyFacts: claims
          .filter((c) => c.isHighConfidence)
          .slice(0, MAX_KEY_FACTS)
          .map((c) => c.claimText),
        recentClaims: claims.slice(0, MAX_RECENT_CLAIMS).map((c) => ({
          claimText: c.claimText,
          predicate: c.predicate,
          confidence: c.isHighConfidence,
          sourceUrl: c.sourceUrls[0],
        })),
      });

      // ── Final status ─────────────────────────────────────────────
      const wallClockMs = Date.now() - startTime;
      const finalStatus =
        patchResult.claimsCreated > 0 || patchResult.backlinksCreated > 0
          ? "completed"
          : "partial";

      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunFinal, {
        runId: args.expansionRunId,
        status: finalStatus as "completed" | "partial",
        claimsCreated: patchResult.claimsCreated,
        edgesCreated: patchResult.edgesCreated,
        wallClockMs,
        completedAt: Date.now(),
      });
    } catch (error: any) {
      await ctx.runMutation(internal.domains.graph.expandEntity.updateRunStatus, {
        runId: args.expansionRunId,
        status: "failed",
        errorMessage: error?.message?.slice(0, 500) ?? "Unknown error",
        completedAt: Date.now(),
      });
    }
  },
});

// ── Internal queries/mutations for the action ────────────────────────────

export const internalGetRun = query({
  args: { runId: v.id("expansionRuns") },
  handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const internalGetEntity = query({
  args: { entityId: v.id("entityProfiles") },
  handler: async (ctx, args) => ctx.db.get(args.entityId),
});

export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("expansionRuns"),
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("extracting"),
      v.literal("persisting"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    errorMessage: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, any> = { status: args.status };
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;
    await ctx.db.patch(args.runId, patch);
  },
});

export const updateRunSearchCount = internalMutation({
  args: {
    runId: v.id("expansionRuns"),
    searchQueries: v.number(),
    sourcesFound: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      searchQueries: args.searchQueries,
      sourcesFound: args.sourcesFound,
    });
  },
});

export const updateRunFinal = internalMutation({
  args: {
    runId: v.id("expansionRuns"),
    status: v.union(v.literal("completed"), v.literal("partial")),
    claimsCreated: v.number(),
    edgesCreated: v.number(),
    wallClockMs: v.number(),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      claimsCreated: args.claimsCreated,
      edgesCreated: args.edgesCreated,
      wallClockMs: args.wallClockMs,
      completedAt: args.completedAt,
    });
  },
});

export const upsertSnapshot = internalMutation({
  args: {
    entityId: v.id("entityProfiles"),
    summary: v.string(),
    keyFacts: v.array(v.string()),
    recentClaims: v.array(
      v.object({
        claimText: v.string(),
        predicate: v.string(),
        confidence: v.boolean(),
        sourceUrl: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("expansionSnapshots")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();

    // Count backlinks for this entity (BOUND_READ: limit 200 for count)
    const backlinks = await ctx.db
      .query("backlinks")
      .withIndex("by_target", (q) => q.eq("targetEntityId", args.entityId))
      .take(200);

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        summary: args.summary,
        keyFacts: args.keyFacts.slice(0, MAX_KEY_FACTS),
        recentClaims: args.recentClaims.slice(0, MAX_RECENT_CLAIMS),
        backlinkCount: backlinks.length,
        lastExpanded: now,
        version: existing.version + 1,
      });
    } else {
      await ctx.db.insert("expansionSnapshots", {
        entityId: args.entityId,
        summary: args.summary,
        keyFacts: args.keyFacts.slice(0, MAX_KEY_FACTS),
        recentClaims: args.recentClaims.slice(0, MAX_RECENT_CLAIMS),
        backlinkCount: backlinks.length,
        lastExpanded: now,
        version: 1,
        staleAfterMs: DEFAULT_STALE_MS,
      });
    }
  },
});

// ── Pure functions (no Convex context) ───────────────────────────────────

function buildSearchQueries(entityName: string, entityType: string): string[] {
  const queries = [
    `${entityName} latest news 2026`,
    `${entityName} funding valuation revenue`,
    `${entityName} leadership team executives`,
  ];
  if (entityType === "company") {
    queries.push(`${entityName} competitors market position`);
    queries.push(`${entityName} product launches partnerships`);
  } else if (entityType === "person") {
    queries.push(`${entityName} career background biography`);
    queries.push(`${entityName} recent statements opinions`);
  } else {
    queries.push(`${entityName} overview analysis`);
    queries.push(`${entityName} trends developments`);
  }
  return queries;
}

async function searchWithFallback(
  query: string,
  linkupKey: string | undefined,
  geminiKey: string | undefined,
): Promise<{ snippets: string[]; sources: Array<{ url: string; title: string }> }> {
  const snippets: string[] = [];
  const sources: Array<{ url: string; title: string }> = [];

  // Try Linkup first
  if (linkupKey) {
    try {
      const resp = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${linkupKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "standard",
          outputType: "sourcedAnswer",
          includeInlineCitations: true,
          includeSources: true,
          maxResults: 6,
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (resp.ok) {
        // BOUND_READ: limit response size
        const text = await readBoundedResponse(resp, MAX_RESPONSE_BYTES);
        const data = JSON.parse(text);

        if (data.answer) snippets.push(data.answer);
        if (Array.isArray(data.sources)) {
          for (const s of data.sources.slice(0, 10)) {
            if (s.url && isUrlSafe(s.url)) {
              sources.push({ url: s.url, title: s.name ?? s.url });
              if (s.snippet) snippets.push(s.snippet);
            }
          }
        }
      }
    } catch {
      /* Linkup failed — fall through to Gemini grounding */
    }
  }

  // Fallback: Gemini grounding search
  if (snippets.length === 0 && geminiKey) {
    try {
      const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Provide a factual, well-sourced summary about: ${query}\n\nInclude specific facts, numbers, dates, and names. Cite sources where possible.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (resp.ok) {
        const data = (await resp.json()) as any;
        const text =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text) snippets.push(text);
      }
    } catch {
      /* Gemini also failed — return empty */
    }
  }

  return { snippets, sources };
}

/** BOUND_READ: read response body with size cap */
async function readBoundedResponse(
  resp: Response,
  maxBytes: number,
): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("");
}

interface ExtractedClaim {
  subject: string;
  predicate: string;
  object: string;
  claimText: string;
  sourceUrls: string[];
  isHighConfidence: boolean;
  relatedEntities?: string[];
}

async function extractClaims(
  entityName: string,
  snippets: string[],
  sources: Array<{ url: string; title: string }>,
  geminiKey: string | undefined,
): Promise<ExtractedClaim[]> {
  // Baseline: extract simple claims from snippets without LLM
  const baselineClaims: ExtractedClaim[] = snippets
    .filter((s) => s.length > 30)
    .slice(0, 8)
    .map((s) => ({
      subject: entityName,
      predicate: "mentioned_in",
      object: s.slice(0, 200),
      claimText: s.slice(0, 300),
      sourceUrls: sources.slice(0, 2).map((src) => src.url),
      isHighConfidence: false,
    }));

  if (!geminiKey || snippets.length === 0) return baselineClaims;

  try {
    const combinedSnippets = snippets.slice(0, 10).join("\n---\n").slice(0, 8000);

    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Extract structured facts about "${entityName}" from the following text. Return a JSON array of objects with these fields:
- subject: the entity or sub-entity
- predicate: the relationship (e.g. "has_revenue", "founded_by", "raised_funding", "competes_with", "headquartered_in", "employs", "launched_product")
- object: the value or target entity
- claimText: a concise natural language sentence stating the fact
- isHighConfidence: boolean (true if the fact includes specific numbers, dates, or named sources)
- relatedEntities: array of other entity names mentioned in this fact

Return ONLY the JSON array, no other text.

Text:
${combinedSnippets}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!resp.ok) return baselineClaims;

    const data = (await resp.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Parse JSON from the response (handle markdown code fences)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return baselineClaims;

    const parsed = JSON.parse(jsonMatch[0]) as any[];
    const sourceUrls = sources.map((s) => s.url);

    return parsed
      .filter(
        (c: any) =>
          typeof c.subject === "string" &&
          typeof c.predicate === "string" &&
          typeof c.object === "string",
      )
      .slice(0, MAX_CLAIMS_PER_PATCH)
      .map((c: any) => ({
        subject: String(c.subject).slice(0, 200),
        predicate: String(c.predicate).slice(0, 100),
        object: String(c.object).slice(0, 500),
        claimText: String(c.claimText ?? `${c.subject} ${c.predicate} ${c.object}`).slice(0, 500),
        sourceUrls: sourceUrls.slice(0, 3),
        isHighConfidence: Boolean(c.isHighConfidence),
        relatedEntities: Array.isArray(c.relatedEntities)
          ? c.relatedEntities.map(String).slice(0, 5)
          : [],
      }));
  } catch {
    return baselineClaims;
  }
}

async function generateSummary(
  entityName: string,
  claims: ExtractedClaim[],
  geminiKey: string | undefined,
): Promise<string> {
  if (!geminiKey || claims.length === 0) {
    return `${entityName} — ${claims.length} facts discovered.`;
  }

  try {
    const factsText = claims
      .slice(0, 15)
      .map((c) => `- ${c.claimText}`)
      .join("\n");

    const resp = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Write a 2-3 sentence summary about "${entityName}" based on these facts:\n${factsText}\n\nBe concise and factual. Do not speculate.`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as any;
      return (
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 500) ??
        `${entityName} — ${claims.length} facts discovered.`
      );
    }
  } catch {
    /* fall through */
  }

  return `${entityName} — ${claims.length} facts discovered.`;
}
