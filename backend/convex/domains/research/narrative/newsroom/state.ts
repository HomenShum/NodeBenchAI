/**
 * NewsroomState - LangGraph state for the Newsroom agent pipeline
 *
 * The Newsroom pipeline consists of 4 agents:
 * 1. Scout Agent - Ingests this week's news
 * 2. Historian Agent - Retrieves historical context from Knowledge Graph
 * 3. Analyst Agent - Detects narrative shifts and plot twists
 * 4. Publisher Agent - Generates narrative updates with citations
 */

import type { Id } from "../../../../_generated/dataModel";
import type { NarrativeEventInput } from "../adapters/types";
import type { HypothesisCandidate } from "../validators";

/**
 * Raw news item discovered by Scout Agent
 */
export interface NewsItem {
  headline: string;
  url: string;
  publishedAt: string;
  snippet: string;
  source: string;
  relevanceScore: number;
}

/**
 * Historical claim from Knowledge Graph
 */
export interface HistoricalClaim {
  claimId: string;
  claimText: string;
  subject: string;
  predicate: string;
  object: string;
  timestamp: string;
  sourceDocIds: string[];
}

/**
 * Existing narrative thread summary
 */
export interface ExistingThread {
  threadId: string;
  name: string;
  thesis: string;
  latestEventAt: number;
  currentPhase: string;
}

/**
 * Detected narrative shift from Analyst Agent
 */
export interface NarrativeShift {
  type: "new_thread" | "thread_update" | "plot_twist" | "sentiment_shift";
  description: string;
  confidence: number;
  affectedThreadId?: string;
  newThreadProposal?: {
    name: string;
    thesis: string;
    entityKeys: string[];
    topicTags: string[];
  };
}

/**
 * Generated event for a narrative thread
 */
export interface GeneratedEvent {
  headline: string;
  summary: string;
  significance: "minor" | "moderate" | "major" | "plot_twist";
  sourceUrls: string[];
  citationIds: string[];
  occurredAt: number;
}

/**
 * Generated narrative update from Publisher Agent
 */
export interface GeneratedNarrative {
  threadId: string;
  isNewThread: boolean;
  newEvents: GeneratedEvent[];
  updatedThesis?: string;
  updatedPhase?: "emerging" | "escalating" | "climax" | "resolution" | "dormant";
}

/**
 * Citation metadata
 */
export interface CitationMetadata {
  id: string;
  url: string;
  title: string;
  publishedAt?: string;
  domain: string;
}

/**
 * Search log entry for audit trail
 */
export interface SearchLogEntry {
  query: string;
  searchType: "web_news" | "historical" | "entity_context" | "verification";
  resultCount: number;
  resultUrls: string[];
  resultSnippets?: string[];
}

/**
 * Complete Newsroom workflow state
 */
export interface NewsroomState {
  // Input parameters
  targetEntityKeys: string[];
  weekNumber: string;
  focusTopics?: string[];
  userId: Id<"users">;
  /**
   * Correlation ID for end-to-end audit/replay.
   * Plumbed into narrativeSearchLog.workflowId and returned by the workflow.
   */
  workflowId?: string;
  /** Deterministic fixture key when running with injected inputs. */
  fixtureId?: string;
  /**
   * Deterministic time anchor for evaluation/replay.
   * When present, agents must prefer this value over `Date.now()` for any logic
   * that influences persisted outputs (e.g., lookback windows, time parsing fallbacks).
   */
  deterministicNowMs?: number;

  // Scout Agent outputs
  weeklyNews: NewsItem[];

  // Adapter Events (from existing pipelines: briefs, LinkedIn, ForYouFeed)
  adapterEvents?: NarrativeEventInput[];

  // Historian Agent outputs
  historicalContext: HistoricalClaim[];
  existingThreads: ExistingThread[];

  // Analyst Agent outputs
  narrativeShifts: NarrativeShift[];
  /** Phase 7: Hypothesis candidates from Analyst for Publisher to link claims to */
  hypothesisCandidates?: HypothesisCandidate[];

  // Publisher Agent outputs
  generatedNarratives: GeneratedNarrative[];

  // Accumulated citations
  citations: Map<string, CitationMetadata>;

  // Audit trail
  searchLogs: SearchLogEntry[];
  /** IDs of persisted narrativeSearchLog rows created for this run (best-effort). */
  persistedSearchLogIds?: string[];
  /** IDs of threads/events created during publish (best-effort). */
  publishedThreadIds?: string[];
  publishedEventIds?: string[];
  /** IDs of posts created during publish (best-effort). */
  publishedPostIds?: string[];
  /** Stable `eventId` strings from narrativeEvents (best-effort). */
  publishedEventStableIds?: string[];
  /** Post-process metrics from verification/contradiction/temporal facts (best-effort). */
  postProcessStats?: {
    verifiedEvents: number;
    temporalFactsCreated: number;
    contradictionsFound: number;
    disputesCreated: number;
  };
  /** Comment harvest metrics (best-effort). */
  commentHarvestStats?: {
    comments: number;
    notableQuotes: number;
    repliesCreated: number;
  };
  /** Correlation detection metrics (best-effort). */
  correlationStats?: {
    detected: number;
    created: number;
  };
  /**
   * Dedup decisions captured during publish (best-effort).
   * Used to make replay/audit packs self-contained without re-running the ladder.
   */
  dedupDecisions?: Array<{
    threadId: string;
    created: boolean;
    eventDocId?: string;
    stableEventId?: string;
    dedupResult: {
      action: "skip" | "create_new" | "create_update";
      reason: string;
      matchedEventId?: string;
      matchStage?: number;
      similarity?: number;
      supersedesEventId?: string;
      changeSummary?: string;
      contentHash?: string;
    };
  }>;

  // Workflow metadata
  errors: string[];
  currentStep: "scout" | "historian" | "analyst" | "publisher" | "complete";
  startedAt: number;
  completedAt?: number;
}

/**
 * Initial state factory
 */
export function createInitialNewsroomState(
  targetEntityKeys: string[],
  weekNumber: string,
  userId: Id<"users">,
  focusTopics?: string[],
  workflowId?: string,
  startedAtOverride?: number,
  deterministicNowMs?: number
): NewsroomState {
  return {
    targetEntityKeys,
    weekNumber,
    focusTopics,
    userId,
    workflowId,
    deterministicNowMs,
    weeklyNews: [],
    historicalContext: [],
    existingThreads: [],
    narrativeShifts: [],
    generatedNarratives: [],
    citations: new Map(),
    searchLogs: [],
    dedupDecisions: [],
    errors: [],
    currentStep: "scout",
    startedAt: startedAtOverride ?? Date.now(),
  };
}

/**
 * Get ISO week number from date
 */
export function getWeekNumber(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

/**
 * Get current week number
 */
export function getCurrentWeekNumber(): string {
  return getWeekNumber(new Date());
}
