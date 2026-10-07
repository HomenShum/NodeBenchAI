/**
 * My Wiki — Dreaming Pipeline (Convex Action with Real Data)
 *
 * OBSERVE → CONSOLIDATE → REFLECT
 * Light     → Deep       → REM
 *
 * A sequential pipeline for background wiki maintenance.
 * Each phase fetches real Convex data and produces structured outputs.
 *
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md §6
 */

"use node";

import { v } from "convex/values";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../agents/mcp_tools/models";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// ====================================================================
// Types
// ====================================================================

export interface WikiCandidate {
  id: string;
  candidateType: "entity" | "topic" | "relation";
  sourceId: string;
  sourceType: string;
  title: string;
  summary: string;
  confidence: number;
  entityRefs: string[];
}

export interface WikiCluster {
  id: string;
  label: string;
  candidateIds: string[];
  centroidConfidence: number;
}

export interface WikiRevisionDraft {
  summary: string;
  whatItIs: string;
  whyItMatters: string;
  whatChanged: string;
  openQuestions: string;
  sourceSnapshotHash: string;
  sourceSnapshotIds: string[];
  modelUsed: string;
}

export interface WikiEdgeDraft {
  fromSlug: string;
  toSlug: string;
  relationType: string;
  confidence: number;
  provenanceSourceKey?: string;
}

export interface WikiThemeDraft {
  themeId: string;
  label: string;
  description: string;
  relatedPageSlugs: string[];
  confidence: number;
}

export interface WikiQuestionDraft {
  questionId: string;
  questionText: string;
  relatedPageSlug: string;
}

export interface DreamingResult {
  // OBSERVE outputs
  candidates: WikiCandidate[];
  clusters: WikiCluster[];
  
  // CONSOLIDATE outputs
  revisionDraft: WikiRevisionDraft | null;
  edges: WikiEdgeDraft[];
  contradictionCount: number;
  
  // REFLECT outputs
  themes: WikiThemeDraft[];
  openQuestions: WikiQuestionDraft[];
  
  // Meta
  error?: string;
  tokenUsage: { input: number; output: number };
  completedAt: number;
}

// ════════════════════════════════════════════════════════════════════
// OBSERVE Phase Data Sources — Complete Customer Lifecycle Coverage
// ════════════════════════════════════════════════════════════════════

type ObserveSources = {
  // Research artifacts (core knowledge base)
  reports: Array<{
    id: Id<"productReports">;
    type: "productReports";
    title: string;
    summary: string;
    updatedAt: number;
  }>;
  claims: Array<{
    id: Id<"productClaims">;
    type: "productClaims";
    text: string;
    confidence: number;
    updatedAt: number;
  }>;
  evidence: Array<{
    id: Id<"productEvidenceItems">;
    type: "productEvidenceItems";
    description: string;
    sourceUrl?: string;
    createdAt: number;
  }>;
  // Chat history (questions asked, answers received)
  chatSessions: Array<{
    id: Id<"productChatSessions">;
    type: "productChatSessions";
    query: string;
    title: string;
    latestSummary?: string;
    status: string;
    updatedAt: number;
  }>;
  chatEvents: Array<{
    id: Id<"productChatEvents">;
    type: "productChatEvents";
    sessionId: Id<"productChatSessions">;
    label: string;
    body: string;
    createdAt: number;
  }>;
  // Daily brief context (morning routine, tasks)
  dailyBriefMemories: Array<{
    id: Id<"dailyBriefMemories">;
    type: "dailyBriefMemories";
    dateString: string;
    goal: string;
    features: Array<{ id: string; name: string; status: string; priority?: number }>;
    updatedAt: number;
  }>;
  dailyBriefResults: Array<{
    id: Id<"dailyBriefTaskResults">;
    type: "dailyBriefTaskResults";
    taskId: string;
    resultMarkdown: string;
    createdAt: number;
  }>;
  // User notes (Zone 3 human-owned content)
  userNotes: Array<{
    id: Id<"userWikiNotes">;
    type: "userWikiNotes";
    body: string;
    updatedAt: number;
  }>;
  // Agent interactions (Fast Agent conversations)
  agentMessages: Array<{
    id: Id<"agentMessages">;
    type: "agentMessages";
    role: "user" | "assistant" | "system";
    body: string;
    createdAt: number;
  }>;
  // User events/tasks (personal task management)
  userEvents: Array<{
    id: Id<"userEvents">;
    type: "userEvents";
    title: string;
    description?: string;
    status: string;
    priority?: string;
    dueDate?: number;
    updatedAt: number;
  }>;
};

type OtherWikiPages = Array<{
  slug: string;
  title: string;
  summary?: string;
  revision: null | {
    summary?: string;
    whatItIs?: string;
    whyItMatters?: string;
    openQuestions?: string;
  };
}>;

// ====================================================================
// Helper Functions
// ====================================================================

async function callModel(
  model: string,
  prompt: string,
  temperature = 0.3,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const llm = await getLanguageModelSafe(model);
  const result = await generateText({
    model: llm,
    prompt,
    temperature,
  });

  return {
    text: result.text,
    usage: {
      input: result.usage?.inputTokens ?? 0,
      output: result.usage?.outputTokens ?? 0,
    },
  };
}

// ====================================================================
// OBSERVE Phase (Light) — Fetches Real Convex Data
// ====================================================================

const OBSERVE_PROMPT = `You are the OBSERVE agent in NodeBench's wiki dreaming pipeline.

Your job: Ingest recent material from across the user's entire NodeBench lifecycle and stage candidates for later consolidation.

DATA SOURCE CATEGORIES:
1. RESEARCH ARTIFACTS — Formal investigations (reports, claims, evidence)
2. CHAT HISTORY — Questions asked and answers received
3. DAILY BRIEFS — Morning routine tasks and progress
4. USER NOTES — Human-written wiki annotations (Zone 3)
5. AGENT INTERACTIONS — Fast Agent conversations
6. USER EVENTS — Tasks, reminders, encounter captures

Source Material:
{{SOURCES}}

Extract candidates from ALL source types:
1. Entity candidates (companies, people, products, organizations)
2. Topic candidates (themes, concepts, technologies, markets)
3. Relation candidates (connections, dependencies, workflows)
4. Intent candidates (what the user is trying to accomplish)
5. Question candidates (what the user is asking/seeking)

For each candidate:
- Assign confidence (0-1) based on evidence strength
- Note the source type (research/chat/brief/note/agent/task)
- Consider recency (recent > older)
- Consider authority (user-written > AI-generated > inferred)

Output JSON:
{
  "candidates": [
    {
      "candidateType": "entity|topic|relation|intent|question",
      "title": "Short name",
      "summary": "1-2 sentence description",
      "confidence": 0.85,
      "entityRefs": ["related-slugs"],
      "sourceTypes": ["reports|chat|briefs|notes|agent|tasks"]
    }
  ],
  "clusters": [
    {
      "label": "Cluster theme",
      "candidateIndices": [0, 1]
    }
  ]
}

Rules:
- Set confidence >= 0.7 for strong candidates from multiple sources
- Set confidence 0.5-0.6 for single-source or inferred candidates
- Cluster by semantic overlap across all source types
- Never invent facts not present in source material
- Prioritize user-written content (notes, tasks) over AI-generated`;

async function observePhase(
  ownerKey: string,
  triggerSlug: string,
  triggerSignal: string,
  sources: ObserveSources,
): Promise<{ candidates: WikiCandidate[]; clusters: WikiCluster[]; usage: { input: number; output: number } }> {
  // Build comprehensive source context from all lifecycle data
  const sections: string[] = [];
  
  // 1. Research Artifacts
  if (sources.reports.length > 0) {
    sections.push("=== RESEARCH REPORTS ===");
    sections.push(...sources.reports.map(r => `[${r.id}] ${r.title}\n${r.summary}`));
  }
  
  if (sources.claims.length > 0) {
    sections.push("\n=== FACTUAL CLAIMS ===");
    sections.push(...sources.claims.map(c => `[${c.id}] ${c.text} (confidence: ${c.confidence})`));
  }
  
  if (sources.evidence.length > 0) {
    sections.push("\n=== EVIDENCE ITEMS ===");
    sections.push(...sources.evidence.map(e => `[${e.id}] ${e.description}${e.sourceUrl ? ` (${e.sourceUrl})` : ""}`));
  }
  
  // 2. Chat History
  if (sources.chatSessions.length > 0) {
    sections.push("\n=== CHAT SESSIONS (Questions Asked) ===");
    sections.push(...sources.chatSessions.map(s => 
      `[${s.id}] ${s.title}\nQuery: ${s.query}${s.latestSummary ? `\nResult: ${s.latestSummary.slice(0, 200)}` : ""}`
    ));
  }
  
  if (sources.chatEvents.length > 0) {
    sections.push("\n=== CHAT EVENTS ===");
    sections.push(...sources.chatEvents.map(e => `[${e.id}] ${e.label}: ${e.body.slice(0, 200)}`));
  }
  
  // 3. Daily Brief Context
  if (sources.dailyBriefMemories.length > 0) {
    sections.push("\n=== DAILY BRIEF GOALS ===");
    sections.push(...sources.dailyBriefMemories.map(m => 
      `[${m.dateString}] Goal: ${m.goal}\nTasks: ${m.features.map(f => f.name).join(", ")}`
    ));
  }
  
  if (sources.dailyBriefResults.length > 0) {
    sections.push("\n=== DAILY BRIEF RESULTS ===");
    sections.push(...sources.dailyBriefResults.map(r => 
      `[${r.taskId}] ${r.resultMarkdown.slice(0, 300)}`
    ));
  }
  
  // 4. User Notes (Zone 3 - highest authority)
  if (sources.userNotes.length > 0) {
    sections.push("\n=== USER NOTES (Human-Written) ===");
    sections.push(...sources.userNotes.map(n => `[NOTE] ${n.body.slice(0, 500)}`));
  }
  
  // 5. Agent Interactions
  if (sources.agentMessages.length > 0) {
    sections.push("\n=== AGENT CONVERSATIONS ===");
    sections.push(...sources.agentMessages.map(m => 
      `[${m.role.toUpperCase()}] ${m.body.slice(0, 300)}`
    ));
  }
  
  // 6. User Events/Tasks
  if (sources.userEvents.length > 0) {
    sections.push("\n=== USER TASKS/EVENTS ===");
    sections.push(...sources.userEvents.map(e => 
      `[${e.status.toUpperCase()}] ${e.title}${e.priority ? ` (priority: ${e.priority})` : ""}${e.description ? `\n${e.description.slice(0, 200)}` : ""}`
    ));
  }
  
  const sourceContext = sections.join("\n\n").slice(0, 12000); // Increased bound for comprehensive context

  const prompt = OBSERVE_PROMPT.replace("{{SOURCES}}", sourceContext);

  const { text, usage } = await callModel(
    "google:models/gemini-3-flash-preview", // Cutting-edge fast/cheap for OBSERVE
    prompt,
  );

  // Parse JSON response (handle markdown code blocks and "json" prefix)
  let parsed: { 
    candidates: Array<Omit<WikiCandidate, "id" | "sourceId" | "sourceType">>; 
    clusters: Array<{ label: string; candidateIndices: number[] }> 
  };
  try {
    // Extract JSON from markdown code blocks or clean up "json" prefix
    let cleaned = text.trim();
    // Remove markdown code block markers
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    // Remove leading "json" if present (common model artifact)
    cleaned = cleaned.replace(/^json\s*/i, "");
    cleaned = cleaned.trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("OBSERVE parse failed. Raw text:", text.slice(0, 200));
    return { candidates: [], clusters: [], usage };
  }

  // Assign IDs to candidates
  const startedAt = Date.now();
  const candidates: WikiCandidate[] = parsed.candidates.map((c, i) => ({
    ...c,
    id: `cand-${startedAt}-${i}`,
    sourceId: triggerSlug,
    sourceType: triggerSignal,
  }));

  // Build clusters
  const clusters: WikiCluster[] = parsed.clusters.map((cl, i) => ({
    id: `cluster-${startedAt}-${i}`,
    label: cl.label,
    candidateIds: cl.candidateIndices.map(idx => candidates[idx]?.id).filter(Boolean),
    centroidConfidence: Math.max(...cl.candidateIndices.map(idx => candidates[idx]?.confidence ?? 0)),
  }));

  return { candidates, clusters, usage };
}

// ====================================================================
// CONSOLIDATE Phase (Deep)
// ====================================================================

const CONSOLIDATE_PROMPT = `You are the CONSOLIDATE agent in NodeBench's wiki dreaming pipeline.

Your job: Rank candidates, resolve contradictions, and build durable wiki content.

Candidates from OBSERVE phase:
{{CANDIDATES}}

Output JSON:
{
  "revision": {
    "summary": "One-sentence lead",
    "whatItIs": "2-3 sentences",
    "whyItMatters": "1-2 sentences on significance",
    "whatChanged": "Recent developments",
    "openQuestions": "What we are less sure about"
  },
  "edges": [
    {
      "fromSlug": "entity-a",
      "toSlug": "entity-b", 
      "relationType": "related|competitor|works_at|invested_in|acquired_by|based_in|mentioned_in|contradicts|supersedes",
      "confidence": 0.8
    }
  ],
  "contradictionCount": 0
}

Rules:
- Skip candidates with confidence < 0.5
- Never invent numbers or dates
- Keep each field under 1200 characters`;

async function consolidatePhase(
  candidates: WikiCandidate[],
  ownerSlug: string,
): Promise<{ 
  revisionDraft: WikiRevisionDraft; 
  edges: WikiEdgeDraft[]; 
  contradictionCount: number;
  usage: { input: number; output: number } 
}> {
  const candidatesJson = JSON.stringify(candidates.slice(0, 20), null, 2); // Bound candidates
  
  const prompt = CONSOLIDATE_PROMPT.replace("{{CANDIDATES}}", candidatesJson);

  const { text, usage } = await callModel(
    "google:models/gemini-3.1-pro-preview", // Cutting-edge for CONSOLIDATE
    prompt,
    0.2, // Lower temperature for factual consistency
  );

  // Parse JSON response
  let parsed: {
    revision: Omit<WikiRevisionDraft, "sourceSnapshotHash" | "sourceSnapshotIds" | "modelUsed">;
    edges: WikiEdgeDraft[];
    contradictionCount: number;
  };
  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    cleaned = cleaned.replace(/^json\s*/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`CONSOLIDATE parse failed: ${e instanceof Error ? e.message : String(e)}. Raw: ${text.slice(0, 200)}`);
  }

  // Compute source snapshot hash
  const sourceIds = candidates.map((c) => c.sourceId).sort();
  const hashInput = JSON.stringify({ sourceIds, model: "gemini-3.1-pro-preview" });
  const sourceSnapshotHash = Buffer.from(hashInput).toString("base64").slice(0, 32);
  const modelUsed = "google:models/gemini-3.1-pro-preview";

  // Build edges with owner slug
  const edges: WikiEdgeDraft[] = (parsed.edges || [])
    .slice(0, 20) // Bound edges
    .map(e => ({
      ...e,
      fromSlug: e.fromSlug === "self" ? ownerSlug : e.fromSlug,
      toSlug: e.toSlug === "self" ? ownerSlug : e.toSlug,
    }));

  const revisionDraft: WikiRevisionDraft = {
    ...parsed.revision,
    sourceSnapshotHash,
    sourceSnapshotIds: sourceIds,
    modelUsed,
  };

  return {
    revisionDraft,
    edges,
    contradictionCount: parsed.contradictionCount ?? 0,
    usage,
  };
}

// ====================================================================
// REFLECT Phase (REM)
// ====================================================================

const REFLECT_PROMPT = `You are the REFLECT agent in NodeBench's wiki dreaming pipeline.

Your job: Generate themes and open questions from accumulated wiki state.

Current page revision:
{{REVISION}}

Other wiki pages for this owner:
{{OTHER_PAGES}}

Output JSON:
{
  "themes": [
    {
      "themeId": "stable-id",
      "label": "Theme name",
      "description": "What connects these pages",
      "relatedPageSlugs": ["page-1", "page-2"],
      "confidence": 0.85
    }
  ],
  "openQuestions": [
    {
      "questionId": "q-1",
      "questionText": "What is the relationship between X and Y?",
      "relatedPageSlug": "primary-page"
    }
  ]
}

Rules:
- Themes are observations, not facts
- Questions should be answerable through research
- Never write facts back to source of truth`;

async function reflectPhase(
  revisionDraft: WikiRevisionDraft,
  ownerSlug: string,
  otherPages: OtherWikiPages,
): Promise<{ themes: WikiThemeDraft[]; openQuestions: WikiQuestionDraft[]; usage: { input: number; output: number } }> {
  const revisionJson = JSON.stringify({
    summary: revisionDraft.summary,
    whatItIs: revisionDraft.whatItIs,
    whyItMatters: revisionDraft.whyItMatters,
  }, null, 2);

  const otherPagesJson = JSON.stringify(
    otherPages.filter(p => p.slug !== ownerSlug).slice(0, 10),
    null,
    2,
  );

  const prompt = REFLECT_PROMPT
    .replace("{{REVISION}}", revisionJson)
    .replace("{{OTHER_PAGES}}", otherPagesJson);

  const { text, usage } = await callModel(
    "google:models/gemini-3.1-pro-preview", // Cutting-edge for REFLECT
    prompt,
    0.4, // Slightly creative for theme generation
  );

  // Parse JSON response
  let parsed: { themes: WikiThemeDraft[]; openQuestions: WikiQuestionDraft[] };
  try {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    cleaned = cleaned.replace(/^json\s*/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("REFLECT parse failed. Raw text:", text.slice(0, 200));
    return { themes: [], openQuestions: [], usage };
  }

  // Assign IDs to questions
  const startedAt = Date.now();
  const questionsWithIds = parsed.openQuestions.map((q, i) => ({
    ...q,
    questionId: `q-${startedAt}-${i}`,
    relatedPageSlug: q.relatedPageSlug === "self" ? ownerSlug : q.relatedPageSlug,
  }));

  return { themes: parsed.themes, openQuestions: questionsWithIds, usage };
}

// ====================================================================
// Main Pipeline Action (Fetches Real Data)
// ====================================================================

export const runDreamingPipeline = internalAction({
  args: {
    ownerKey: v.string(),
    triggerSlug: v.string(),
    triggerPageType: v.string(),
    triggerSignal: v.string(),
  },
  handler: async (ctx, { ownerKey, triggerSlug, triggerPageType, triggerSignal }): Promise<DreamingResult> => {
    const startedAt = Date.now();
    let totalUsage = { input: 0, output: 0 };

    try {
      // === OBSERVE Phase: Fetch sources and extract candidates ===
      const sources = await ctx.runQuery(
        internal.domains.product.wikiStagingMutations._fetchObserveSources,
        { ownerKey, entitySlug: triggerSlug, daysBack: 30 },
      ) as ObserveSources;

      const observeResult = await observePhase(ownerKey, triggerSlug, triggerSignal, sources);
      totalUsage.input += observeResult.usage.input;
      totalUsage.output += observeResult.usage.output;

      // Skip if no candidates
      if (observeResult.candidates.length === 0) {
        return {
          candidates: [],
          clusters: [],
          revisionDraft: null,
          edges: [],
          contradictionCount: 0,
          themes: [],
          openQuestions: [],
          tokenUsage: totalUsage,
          completedAt: Date.now(),
        };
      }

      // === CONSOLIDATE Phase: Build revision and extract edges ===
      const consolidateResult = await consolidatePhase(observeResult.candidates, triggerSlug);
      totalUsage.input += consolidateResult.usage.input;
      totalUsage.output += consolidateResult.usage.output;

      // === REFLECT Phase: Generate themes from cross-page analysis ===
      const otherPages = await ctx.runQuery(
        internal.domains.product.wikiStagingMutations._fetchAllWikiPages,
        { ownerKey, limit: 50 },
      ) as OtherWikiPages;

      const reflectResult = await reflectPhase(
        consolidateResult.revisionDraft,
        triggerSlug,
        otherPages,
      );
      totalUsage.input += reflectResult.usage.input;
      totalUsage.output += reflectResult.usage.output;

      return {
        candidates: observeResult.candidates,
        clusters: observeResult.clusters,
        revisionDraft: consolidateResult.revisionDraft,
        edges: consolidateResult.edges,
        contradictionCount: consolidateResult.contradictionCount,
        themes: reflectResult.themes,
        openQuestions: reflectResult.openQuestions,
        tokenUsage: totalUsage,
        completedAt: Date.now(),
      };

    } catch (error) {
      return {
        candidates: [],
        clusters: [],
        revisionDraft: null,
        edges: [],
        contradictionCount: 0,
        themes: [],
        openQuestions: [],
        error: error instanceof Error ? error.message : String(error),
        tokenUsage: totalUsage,
        completedAt: Date.now(),
      };
    }
  },
});
