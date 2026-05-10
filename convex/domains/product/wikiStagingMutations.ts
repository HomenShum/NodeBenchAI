/**
 * My Wiki — Staging & Notes Mutations
 *
 * OBSERVE phase writes to staging.
 * User writes to notes (Zone 3).
 * CONSOLIDATE/REFLECT phases read from staging, write to wiki tables.
 *
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md §6
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { recomputeReportSearchableText } from "../search/searchableTextRecompute";

// ====================================================================
// Constants
// ====================================================================

/** Max bytes for user notes (64KB) */
export const MAX_USER_WIKI_NOTE_BYTES = 65_536;

/** Max staging rows per owner (cleanup prunes old) */
export const MAX_STAGING_ROWS_PER_OWNER = 1_000;

/** Staging retention: 7 days */
export const STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// ====================================================================
// Queries
// ====================================================================

/**
 * List staged candidates for an owner, optionally filtered by cluster.
 */
export const listStagedCandidates = query({
  args: {
    ownerKey: v.string(),
    clusterId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, clusterId, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 50), 200);
    
    if (clusterId) {
      return await ctx.db
        .query("userWikiStaging")
        .withIndex("by_owner_cluster", (q) =>
          q.eq("ownerKey", ownerKey).eq("clusterId", clusterId),
        )
        .order("desc")
        .take(cap);
    }
    
    return await ctx.db
      .query("userWikiStaging")
      .withIndex("by_owner_extracted", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(cap);
  },
});

/**
 * Get candidates ready for promotion (promoteToDeep=true).
 */
export const listPromotableCandidates = query({
  args: {
    ownerKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 50), 200);
    return await ctx.db
      .query("userWikiStaging")
      .withIndex("by_owner_promote", (q) =>
        q.eq("ownerKey", ownerKey).eq("promoteToDeep", true),
      )
      .order("desc")
      .take(cap);
  },
});

/**
 * Get user notes for a wiki page.
 */
export const getUserWikiNotes = query({
  args: {
    ownerKey: v.string(),
    pageId: v.id("userWikiPages"),
  },
  handler: async (ctx, { ownerKey, pageId }) => {
    return await ctx.db
      .query("userWikiNotes")
      .withIndex("by_owner_page", (q) => q.eq("ownerKey", ownerKey).eq("pageId", pageId))
      .first();
  },
});

/**
 * List themes for an owner.
 */
export const listWikiThemes = query({
  args: {
    ownerKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 20), 100);
    return await ctx.db
      .query("userWikiThemes")
      .withIndex("by_owner_generated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(cap);
  },
});

/**
 * List open questions for a page.
 */
export const listOpenQuestionsForPage = query({
  args: {
    ownerKey: v.string(),
    pageSlug: v.string(),
    status: v.optional(v.union(v.literal("open"), v.literal("answered"), v.literal("stale"))),
  },
  handler: async (ctx, { ownerKey, pageSlug, status }) => {
    let q = ctx.db
      .query("userWikiOpenQuestions")
      .withIndex("by_owner_page", (q) => q.eq("ownerKey", ownerKey).eq("relatedPageSlug", pageSlug));
    
    if (status) {
      // Filter in memory since status is not in the index
      const rows = await q.order("desc").take(50);
      return rows.filter((r) => r.status === status);
    }
    
    return await q.order("desc").take(50);
  },
});

// ====================================================================
// Public Mutations
// ====================================================================

/**
 * Upsert user notes for a wiki page (Zone 3).
 * Only the owner can write; AI never writes here.
 */
export const upsertUserWikiNotes = mutation({
  args: {
    ownerKey: v.string(),
    pageId: v.id("userWikiPages"),
    body: v.string(),
  },
  handler: async (ctx, { ownerKey, pageId, body }) => {
    const bodyBytes = Buffer.byteLength(body, "utf8");
    if (bodyBytes > MAX_USER_WIKI_NOTE_BYTES) {
      throw new Error(`Notes exceed ${MAX_USER_WIKI_NOTE_BYTES} bytes limit`);
    }

    const existing = await ctx.db
      .query("userWikiNotes")
      .withIndex("by_owner_page", (q) => q.eq("ownerKey", ownerKey).eq("pageId", pageId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { body, bodyBytes, updatedAt: now });
      return existing._id;
    } else {
      return await ctx.db.insert("userWikiNotes", {
        ownerKey,
        pageId,
        body,
        bodyBytes,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Mark an open question as answered.
 */
export const answerOpenQuestion = mutation({
  args: {
    ownerKey: v.string(),
    questionId: v.string(),
    answerSummary: v.string(),
  },
  handler: async (ctx, { ownerKey, questionId, answerSummary }) => {
    const question = await ctx.db
      .query("userWikiOpenQuestions")
      .withIndex("by_owner_status", (q) => q.eq("ownerKey", ownerKey))
      .filter((q) => q.eq(q.field("questionId"), questionId))
      .first();

    if (!question) {
      throw new Error(`Question ${questionId} not found`);
    }

    await ctx.db.patch(question._id, {
      status: "answered",
      answerSummary,
      answeredAt: Date.now(),
    });

    return question._id;
  },
});

// ====================================================================
// Internal Mutations (for dreaming pipeline)
// ====================================================================

/**
 * Insert staged candidates from OBSERVE phase.
 */
export const insertStagedCandidates = internalMutation({
  args: {
    ownerKey: v.string(),
    candidates: v.array(
      v.object({
        candidateType: v.union(v.literal("entity"), v.literal("topic"), v.literal("relation")),
        sourceId: v.string(),
        sourceType: v.string(),
        title: v.string(),
        summary: v.string(),
        confidence: v.number(),
        entityRefs: v.array(v.string()),
        clusterId: v.optional(v.string()),
        promoteToDeep: v.boolean(),
        sourceSnapshotHash: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { ownerKey, candidates }) => {
    const now = Date.now();
    const ids: Id<"userWikiStaging">[] = [];

    for (const candidate of candidates) {
      const id = await ctx.db.insert("userWikiStaging", {
        ownerKey,
        ...candidate,
        extractedAt: now,
      });
      ids.push(id);
    }

    // Prune old staging rows if exceeding limit
    const allRows = await ctx.db
      .query("userWikiStaging")
      .withIndex("by_owner_extracted", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .collect();

    if (allRows.length > MAX_STAGING_ROWS_PER_OWNER) {
      const toDelete = allRows.slice(MAX_STAGING_ROWS_PER_OWNER);
      for (const row of toDelete) {
        await ctx.db.delete(row._id);
      }
    }

    return ids;
  },
});

/**
 * Insert themes from REFLECT phase.
 */
export const insertWikiThemes = internalMutation({
  args: {
    ownerKey: v.string(),
    themes: v.array(
      v.object({
        themeId: v.string(),
        label: v.string(),
        description: v.string(),
        relatedPageSlugs: v.array(v.string()),
        confidence: v.number(),
        extractedFromRevisionIds: v.array(v.id("userWikiRevisions")),
      }),
    ),
  },
  handler: async (ctx, { ownerKey, themes }) => {
    const now = Date.now();
    const ids: Id<"userWikiThemes">[] = [];

    for (const theme of themes) {
      // Check for existing theme with same ID
      const existing = await ctx.db
        .query("userWikiThemes")
        .withIndex("by_owner_theme", (q) =>
          q.eq("ownerKey", ownerKey).eq("themeId", theme.themeId),
        )
        .first();

      if (existing) {
        // Update lastSeenAt
        await ctx.db.patch(existing._id, { lastSeenAt: now });
        ids.push(existing._id);
      } else {
        const id = await ctx.db.insert("userWikiThemes", {
          ownerKey,
          ...theme,
          generatedAt: now,
          lastSeenAt: now,
        });
        ids.push(id);
      }
    }

    return ids;
  },
});

/**
 * Insert open questions from REFLECT phase.
 */
export const insertOpenQuestions = internalMutation({
  args: {
    ownerKey: v.string(),
    questions: v.array(
      v.object({
        questionId: v.string(),
        questionText: v.string(),
        relatedPageSlug: v.string(),
        spawnedFromRevisionId: v.id("userWikiRevisions"),
      }),
    ),
  },
  handler: async (ctx, { ownerKey, questions }) => {
    const now = Date.now();
    const ids: Id<"userWikiOpenQuestions">[] = [];

    for (const question of questions) {
      // Check for existing question with same ID
      const existing = await ctx.db
        .query("userWikiOpenQuestions")
        .withIndex("by_owner_page", (q) =>
          q.eq("ownerKey", ownerKey).eq("relatedPageSlug", question.relatedPageSlug),
        )
        .filter((q) => q.eq(q.field("questionId"), question.questionId))
        .first();

      if (!existing) {
        const id = await ctx.db.insert("userWikiOpenQuestions", {
          ownerKey,
          ...question,
          status: "open",
          createdAt: now,
        });
        ids.push(id);
      } else {
        ids.push(existing._id);
      }
    }

    return ids;
  },
});

/**
 * Insert edges from CONSOLIDATE phase.
 */
export const insertWikiEdges = internalMutation({
  args: {
    ownerKey: v.string(),
    edges: v.array(
      v.object({
        fromPageId: v.id("userWikiPages"),
        toPageId: v.id("userWikiPages"),
        relationType: v.union(
          v.literal("related"),
          v.literal("competitor"),
          v.literal("works_at"),
          v.literal("invested_in"),
          v.literal("acquired_by"),
          v.literal("based_in"),
          v.literal("mentioned_in"),
          v.literal("contradicts"),
          v.literal("supersedes"),
        ),
        confidence: v.number(),
        provenanceClaimId: v.optional(v.id("productClaims")),
        provenanceSourceKey: v.optional(v.string()),
        extractedByRevisionId: v.id("userWikiRevisions"),
        extractionPromptVersion: v.string(),
      }),
    ),
  },
  handler: async (ctx, { ownerKey, edges }) => {
    const now = Date.now();
    const ids: Id<"userWikiEdges">[] = [];

    for (const edge of edges) {
      // Check for existing edge (same from/to/type)
      const existing = await ctx.db
        .query("userWikiEdges")
        .withIndex("by_owner_from", (q) =>
          q.eq("ownerKey", ownerKey).eq("fromPageId", edge.fromPageId),
        )
        .filter((q) =>
          q.eq(q.field("toPageId"), edge.toPageId).eq(q.field("relationType"), edge.relationType),
        )
        .first();

      if (existing) {
        // Update with new info
        await ctx.db.patch(existing._id, {
          confidence: edge.confidence,
          extractedByRevisionId: edge.extractedByRevisionId,
          extractionPromptVersion: edge.extractionPromptVersion,
          updatedAt: now,
        });
        ids.push(existing._id);
      } else {
        const id = await ctx.db.insert("userWikiEdges", {
          ownerKey,
          ...edge,
          mutedByUser: false,
          createdAt: now,
          updatedAt: now,
        });
        ids.push(id);
      }
    }

    return ids;
  },
});

/**
 * Mute an edge (user override without deleting).
 */
export const muteWikiEdge = mutation({
  args: {
    ownerKey: v.string(),
    edgeId: v.id("userWikiEdges"),
  },
  handler: async (ctx, { ownerKey, edgeId }) => {
    const edge = await ctx.db.get(edgeId);
    if (!edge || edge.ownerKey !== ownerKey) {
      throw new Error("Edge not found or access denied");
    }

    await ctx.db.patch(edgeId, { mutedByUser: true, updatedAt: Date.now() });
    return edgeId;
  },
});

/**
 * Prune old staging rows (scheduled cleanup).
 */
export const pruneOldStaging = internalMutation({
  args: {
    ownerKey: v.string(),
    olderThanMs: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, olderThanMs }) => {
    const cutoff = Date.now() - (olderThanMs ?? STAGING_RETENTION_MS);
    
    const oldRows = await ctx.db
      .query("userWikiStaging")
      .withIndex("by_owner_extracted", (q) => q.eq("ownerKey", ownerKey))
      .filter((q) => q.lt(q.field("extractedAt"), cutoff))
      .collect();

    for (const row of oldRows) {
      await ctx.db.delete(row._id);
    }

    return { deleted: oldRows.length };
  },
});

// ====================================================================
// Internal Queries for Dreaming Pipeline (used by wikiDreamingGraph.ts)
// ====================================================================

const MAX_OBSERVE_SOURCES = 20;
const MAX_SNAPSHOT_CHARS = 4000;
const MAX_CHAT_SESSIONS = 10;
const MAX_CHAT_EVENTS = 5;
const MAX_DAILY_BRIEFS = 5;
const MAX_USER_NOTES = 5;
const MAX_AGENT_MESSAGES = 10;
const MAX_USER_EVENTS = 10;

/**
 * Fetch comprehensive source material for OBSERVE phase.
 * Returns research artifacts, chat history, daily briefs, user notes, and agent interactions.
 */
export const _fetchObserveSources = internalQuery({
  args: { 
    ownerKey: v.string(), 
    entitySlug: v.string(),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, { ownerKey, entitySlug, daysBack = 30 }) => {
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    
    // ═════════════════════════════════════════════════════════════════
    // RESEARCH ARTIFACTS (original sources)
    // ═════════════════════════════════════════════════════════════════
    
    // Fetch productReports
    const reports = await ctx.db
      .query("productReports")
      .withIndex("by_owner_entity_updated", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug),
      )
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    // Fetch productClaims by owner + time
    const claims = await ctx.db
      .query("productClaims")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    // Fetch productEvidenceItems by owner + time
    const evidence = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .take(MAX_OBSERVE_SOURCES);

    // ═════════════════════════════════════════════════════════════════
    // CHAT HISTORY (questions asked, answers received)
    // ═════════════════════════════════════════════════════════════════
    
    // Fetch recent chat sessions for this entity
    const chatSessions = await ctx.db
      .query("productChatSessions")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(MAX_CHAT_SESSIONS);

    // Fetch chat events for these sessions
    const sessionIds = chatSessions.map(s => s._id);
    const chatEvents: Doc<"productChatEvents">[] = [];
    for (const sessionId of sessionIds.slice(0, 3)) {
      const events = await ctx.db
        .query("productChatEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(MAX_CHAT_EVENTS);
      chatEvents.push(...events);
    }

    // ═════════════════════════════════════════════════════════════════
    // DAILY BRIEF CONTEXT (morning brief tasks, progress)
    // ═════════════════════════════════════════════════════════════════
    
    // Fetch recent daily brief memories
    const dailyBriefMemories = await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at", (q) => q.gte("generatedAt", cutoff))
      .order("desc")
      .take(MAX_DAILY_BRIEFS);

    // Fetch task results for these memories
    const memoryIds = dailyBriefMemories.map(m => m._id);
    const dailyBriefResults: Doc<"dailyBriefTaskResults">[] = [];
    for (const memoryId of memoryIds) {
      const results = await ctx.db
        .query("dailyBriefTaskResults")
        .withIndex("by_memory", (q) => q.eq("memoryId", memoryId))
        .take(3);
      dailyBriefResults.push(...results);
    }

    // ═════════════════════════════════════════════════════════════════
    // USER NOTES (Zone 3 human-owned content)
    // ═════════════════════════════════════════════════════════════════
    
    // Get wiki page for this entity
    const wikiPage = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_slug", (q) => 
        q.eq("ownerKey", ownerKey).eq("slug", entitySlug)
      )
      .first();

    // Fetch user notes for this page
    let userNotes: Doc<"userWikiNotes">[] = [];
    if (wikiPage) {
      userNotes = await ctx.db
        .query("userWikiNotes")
        .withIndex("by_owner_page", (q) => 
          q.eq("ownerKey", ownerKey).eq("pageId", wikiPage._id)
        )
        .order("desc")
        .take(MAX_USER_NOTES);
    }

    // ═════════════════════════════════════════════════════════════════
    // AGENT INTERACTIONS (Fast Agent conversations)
    // ═════════════════════════════════════════════════════════════════
    
    // Fetch recent agent threads for this owner
    const agentThreads = await ctx.db
      .query("agentThreads")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(5);

    // Fetch agent messages for these threads
    const threadIds = agentThreads.map(t => t._id);
    const agentMessages: Doc<"agentMessages">[] = [];
    for (const threadId of threadIds) {
      const messages = await ctx.db
        .query("agentMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .order("desc")
        .take(MAX_AGENT_MESSAGES);
      agentMessages.push(...messages);
    }

    // ═════════════════════════════════════════════════════════════════
    // USER EVENTS/TASKS (personal task management)
    // ═════════════════════════════════════════════════════════════════
    
    // Fetch user events by ownerKey (now supported via by_owner_updated index)
    const userEvents = await ctx.db
      .query("userEvents")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .filter((q) => q.gte(q.field("updatedAt"), cutoff))
      .take(MAX_USER_EVENTS);

    // Format for OBSERVE phase
    return {
      // Research artifacts
      reports: reports.map((r) => ({
        id: r._id,
        type: "productReports" as const,
        title: typeof r.title === "string" ? r.title.slice(0, 200) : "",
        summary: typeof r.summary === "string" 
          ? r.summary.slice(0, MAX_SNAPSHOT_CHARS / 3) 
          : "",
        updatedAt: r.updatedAt,
      })),
      claims: claims.map((c) => ({
        id: c._id,
        type: "productClaims" as const,
        text: typeof c.claimText === "string" 
          ? c.claimText.slice(0, 500) 
          : "",
        confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
        updatedAt: c.updatedAt,
      })),
      evidence: evidence.map((e) => ({
        id: e._id,
        type: "productEvidenceItems" as const,
        description: typeof e.description === "string" 
          ? e.description.slice(0, 500) 
          : "",
        sourceUrl: typeof e.sourceUrl === "string" ? e.sourceUrl : undefined,
        createdAt: e.createdAt,
      })),
      // Chat history
      chatSessions: chatSessions.map((s) => ({
        id: s._id,
        type: "productChatSessions" as const,
        query: typeof s.query === "string" ? s.query.slice(0, 300) : "",
        title: typeof s.title === "string" ? s.title.slice(0, 200) : "",
        latestSummary: typeof s.latestSummary === "string" 
          ? s.latestSummary.slice(0, 500) 
          : undefined,
        status: s.status,
        updatedAt: s.updatedAt,
      })),
      chatEvents: chatEvents.map((e) => ({
        id: e._id,
        type: "productChatEvents" as const,
        sessionId: e.sessionId,
        label: typeof e.label === "string" ? e.label.slice(0, 200) : "",
        body: typeof e.body === "string" ? e.body.slice(0, 500) : "",
        createdAt: e.createdAt,
      })),
      // Daily brief context
      dailyBriefMemories: dailyBriefMemories.map((m) => ({
        id: m._id,
        type: "dailyBriefMemories" as const,
        dateString: m.dateString,
        goal: typeof m.goal === "string" ? m.goal.slice(0, 300) : "",
        features: Array.isArray(m.features) 
          ? m.features.map((f: any) => ({
              id: f.id,
              name: f.name,
              status: f.status,
              priority: f.priority,
            })).slice(0, 5)
          : [],
        updatedAt: m.updatedAt,
      })),
      dailyBriefResults: dailyBriefResults.map((r) => ({
        id: r._id,
        type: "dailyBriefTaskResults" as const,
        taskId: r.taskId,
        resultMarkdown: typeof r.resultMarkdown === "string" 
          ? r.resultMarkdown.slice(0, 800) 
          : "",
        createdAt: r.createdAt,
      })),
      // User notes
      userNotes: userNotes.map((n) => ({
        id: n._id,
        type: "userWikiNotes" as const,
        body: typeof n.body === "string" ? n.body.slice(0, 2000) : "",
        updatedAt: n.updatedAt,
      })),
      // Agent interactions
      agentMessages: agentMessages.map((m) => ({
        id: m._id,
        type: "agentMessages" as const,
        role: m.role,
        body: typeof m.body === "string" ? m.body.slice(0, 1000) : "",
        createdAt: m.createdAt,
      })),
      // User events/tasks
      userEvents: userEvents.map((e) => ({
        id: e._id,
        type: "userEvents" as const,
        title: typeof e.title === "string" ? e.title.slice(0, 200) : "",
        description: typeof e.description === "string" 
          ? e.description.slice(0, 500) 
          : undefined,
        status: e.status,
        priority: e.priority,
        dueDate: e.dueDate,
        updatedAt: e.updatedAt,
      })),
    };
  },
});

/**
 * Fetch all wiki pages for an owner (for REFLECT phase cross-page analysis).
 */
export const _fetchAllWikiPages = internalQuery({
  args: { ownerKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerKey, limit = 100 }) => {
    const pages = await ctx.db
      .query("userWikiPages")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);

    // Get latest revision for each page
    const pagesWithRevisions = await Promise.all(
      pages.map(async (page) => {
        const rev = await ctx.db
          .query("userWikiRevisions")
          .withIndex("by_owner_page_generatedAt", (q) =>
            q.eq("ownerKey", ownerKey).eq("pageId", page._id),
          )
          .order("desc")
          .first();
        
        return {
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          revision: rev ? {
            summary: rev.summary,
            whatItIs: rev.whatItIs,
            whyItMatters: rev.whyItMatters,
            openQuestions: rev.openQuestions,
          } : null,
        };
      }),
    );

    return pagesWithRevisions;
  },
});

// ====================================================================
// Mock Data Mutations (Testing Only)
// ====================================================================

/** Create a mock product report for dreaming pipeline testing */
export const _createMockReport = internalMutation({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    title: v.string(),
    summary: v.string(),
    type: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, { ownerKey, entitySlug, title, summary, type, updatedAt }) => {
    const createdAt = updatedAt;
    
    const queryStr = `Research on ${entitySlug}`;
    await ctx.db.insert("productReports", {
      ownerKey,
      entitySlug,
      title,
      summary,
      type,
      status: "saved",
      lens: "founder",
      query: queryStr,
      sections: [],
      sources: [],
      evidenceItemIds: [],
      pinned: false,
      visibility: "private",
      // PR D: populate searchableText so the federated `search_reports` index
      // sees this mock report immediately.
      searchableText: recomputeReportSearchableText({
        title,
        summary,
        query: queryStr,
        primaryEntity: undefined,
        entitySlug,
      }),
      createdAt,
      updatedAt,
    });
  },
});

/** Create a mock claim for dreaming pipeline testing */
export const _createMockClaim = internalMutation({
  args: {
    ownerKey: v.string(),
    claimText: v.string(),
    claimType: v.string(),
    supportStrength: v.union(v.literal("verified"), v.literal("corroborated"), v.literal("single_source"), v.literal("weak")),
    confidence: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, { ownerKey, claimText, claimType, supportStrength, confidence, createdAt }) => {
    const claimKey = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const updatedAt = createdAt;
    
    await ctx.db.insert("productClaims", {
      ownerKey,
      claimKey,
      claimText,
      claimType,
      slotKey: "summary",
      sectionId: "summary",
      sourceRefIds: [],
      supportStrength,
      freshnessStatus: "fresh",
      contradictionFlag: false,
      publishable: confidence > 0.7,
      rejectionReasons: [],
      createdAt,
      updatedAt,
    });
  },
});

/** Create mock evidence for dreaming pipeline testing */
export const _createMockEvidence = internalMutation({
  args: {
    ownerKey: v.string(),
    label: v.string(),
    description: v.string(),
    sourceUrl: v.string(),
    sourceDomain: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, { ownerKey, label, description, sourceUrl, sourceDomain, createdAt }) => {
    const updatedAt = createdAt;
    
    await ctx.db.insert("productEvidenceItems", {
      ownerKey,
      type: "link",
      label,
      description,
      status: "linked",
      sourceUrl,
      sourceDomain,
      freshnessStatus: "fresh",
      createdAt,
      updatedAt,
    });
  },
});

/** Batch insert mock data for volume testing — all docs in one mutation */
export const _batchInsertMockData = internalMutation({
  args: {
    ownerKey: v.string(),
    entitySlug: v.string(),
    reports: v.array(v.object({
      title: v.string(),
      summary: v.string(),
      type: v.string(),
      updatedAt: v.number(),
    })),
    claims: v.array(v.object({
      claimText: v.string(),
      claimType: v.string(),
      supportStrength: v.union(v.literal("verified"), v.literal("corroborated"), v.literal("single_source"), v.literal("weak")),
      confidence: v.number(),
      createdAt: v.number(),
    })),
    evidence: v.array(v.object({
      label: v.string(),
      description: v.string(),
      sourceUrl: v.string(),
      sourceDomain: v.string(),
      createdAt: v.number(),
    })),
  },
  handler: async (ctx, { ownerKey, entitySlug, reports, claims, evidence }) => {
    const inserted = { reports: 0, claims: 0, evidence: 0 };

    for (const report of reports) {
      const queryStr = `Research on ${entitySlug}`;
      await ctx.db.insert("productReports", {
        ownerKey,
        entitySlug,
        title: report.title,
        summary: report.summary,
        type: report.type,
        status: "saved",
        lens: "founder",
        query: queryStr,
        sections: [],
        sources: [],
        evidenceItemIds: [],
        pinned: false,
        visibility: "private",
        // PR D: populate searchableText for the federated `search_reports`
        // index. Backfill is also a thing — but new inserts should be live.
        searchableText: recomputeReportSearchableText({
          title: report.title,
          summary: report.summary,
          query: queryStr,
          primaryEntity: undefined,
          entitySlug,
        }),
        createdAt: report.updatedAt,
        updatedAt: report.updatedAt,
      });
      inserted.reports++;
    }

    for (const claim of claims) {
      const claimKey = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await ctx.db.insert("productClaims", {
        ownerKey,
        claimKey,
        claimText: claim.claimText,
        claimType: claim.claimType,
        slotKey: "summary",
        sectionId: "summary",
        sourceRefIds: [],
        supportStrength: claim.supportStrength,
        freshnessStatus: "fresh",
        contradictionFlag: false,
        publishable: claim.confidence > 0.7,
        rejectionReasons: [],
        createdAt: claim.createdAt,
        updatedAt: claim.createdAt,
      });
      inserted.claims++;
    }

    for (const ev of evidence) {
      await ctx.db.insert("productEvidenceItems", {
        ownerKey,
        type: "link",
        label: ev.label,
        description: ev.description,
        status: "linked",
        sourceUrl: ev.sourceUrl,
        sourceDomain: ev.sourceDomain,
        freshnessStatus: "fresh",
        createdAt: ev.createdAt,
        updatedAt: ev.createdAt,
      });
      inserted.evidence++;
    }

    return inserted;
  },
});
