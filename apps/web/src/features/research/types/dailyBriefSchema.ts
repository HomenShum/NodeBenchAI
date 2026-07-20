/**
 * Canonical Daily Brief Schema (Structured Outputs)
 *
 * This schema creates a "pit of success" where the model *cannot* easily emit log-files.
 * We use strict typing to separate **Synthesis** (Prose) from **Evidence** (Data).
 *
 * Key Constraints Enforced:
 * - actII.signals: Must be an array of objects (no raw strings)
 * - actIII.actions: Includes a status enum to handle failures gracefully
 * - dashboard.viz: Enforces a vizArtifact structure with specific intents
 */

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE TYPES - Data layer (what backs up claims)
// ═══════════════════════════════════════════════════════════════════════════

export type EvidenceSource =
  | "HackerNews"
  | "ArXiv"
  | "GitHub"
  | "TechCrunch"
  | "Reddit"
  | "Twitter"
  | "AWS"
  | "ProductHunt"
  | "DevTo"
  | "YCombinator"
  | "Other";

export interface Evidence {
  /** Unique evidence ID (e.g., "ev-aws-blog-001") */
  id: string;
  /** Optional retrieval run ID that produced this evidence */
  runId?: string;
  /** Optional rank within the retrieval run (1 = highest) */
  rank?: number;
  /** Source provider */
  source: string;
  /** Article/repo/paper title */
  title: string;
  /** Canonical URL to the source */
  url: string;
  /** Optional derived domain (e.g., "news.ycombinator.com") */
  sourceDomain?: string;
  /** ISO 8601 timestamp */
  publishedAt: string;
  /** Why this evidence supports the claim (1-2 sentences) */
  relevance: string;
  /** Optional engagement score (HN points, GitHub stars, etc.) */
  score?: number;
  /** Optional favicon URL */
  favicon?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL TYPES - Act II individual signals
// ═══════════════════════════════════════════════════════════════════════════

export interface Signal {
  /** Unique signal ID (e.g., "sig-aws-inference") */
  id: string;
  /** Clean signal label (e.g., "Infra reliability", "Agent IDE churn") */
  label?: string;
  /** Short headline (5-10 words) */
  headline: string;
  /**
   * Analysis of this specific signal (2-4 sentences)
   * CONSTRAINT: No bullets, no URLs, no timestamps in text
   */
  synthesis: string;
  /** What's new vs baseline (Δ metric or delta summary) */
  deltaSummary?: string;
  /** Evidence backing this signal (min 1, max 6) */
  evidence: Evidence[];
  /** Optional: IDs of related signals for cross-referencing */
  relatedSignalIds?: string[];
  /** Optional: Viz artifact ID for signal-specific chart */
  vizArtifactId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION TYPES - Act III deep dives and recommended moves
// ═══════════════════════════════════════════════════════════════════════════

export type ActionStatus = "proposed" | "insufficient_data" | "skipped" | "in_progress" | "completed";

export interface Action {
  /** Unique action ID (e.g., "act-audit-reserved") */
  id: string;
  /** Recommended move (imperative title, 3-8 words) */
  label: string;
  /** Status determines how to render */
  status: ActionStatus;
  /**
   * The deep dive content or reason for skipping
   * If status is "insufficient_data" or "skipped", explains why
   * CONSTRAINT: No bullets, no URLs, no log-style text
   */
  content: string;
  /** Why now (1-2 sentences) */
  whyNow?: string;
  /** Deliverable type (e.g., "1-page memo", "experiment design", "risk checklist") */
  deliverable?: string;
  /** Expected outcome (measurable) */
  expectedOutcome?: string;
  /** Risks / dependencies (short) */
  risks?: string;
  /** IDs from Act II signals that justify this action */
  linkedSignalIds: string[];
  /** Evidence refs (IDs from the evidence library) */
  linkedEvidenceIds?: string[];
  /** Optional: Priority level (1 = highest) */
  priority?: number;
  /** Optional: Result markdown from worker task */
  resultMarkdown?: string;
  /** Whether deep dive content is available */
  hasDeepDive?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZATION TYPES - Dashboard chart artifacts
// ═══════════════════════════════════════════════════════════════════════════

export type VizIntent =
  | "time_series"      // Line/area chart for temporal data
  | "category_compare" // Bar chart for comparing categories
  | "distribution"     // Histogram/boxplot for distributions
  | "correlation"      // Scatter plot for relationships
  | "part_to_whole";   // Stacked bar (avoid pies unless 3-5 categories)

export interface VizArtifact {
  /** The type of visualization selected */
  intent: VizIntent;
  /** Brief explanation of why this viz was chosen (1-2 sentences) */
  rationale: string;
  /**
   * Inline data array - NO external URLs allowed
   * SECURITY: data.url is explicitly forbidden
   */
  data: Array<Record<string, unknown>>;
  /**
   * Vega-Lite JSON spec
   * SECURITY: Must not contain "url" property for data loading
   */
  spec: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY METRICS - KPI tiles for above-the-fold
// ═══════════════════════════════════════════════════════════════════════════

export interface QualityMetrics {
  /** Coverage: how much was scanned */
  coverage: {
    /** Total items in scope */
    itemsScanned: number;
    /** Number of unique sources */
    sourcesCount: number;
    /** Percentage of watchlist topics covered */
    topicsCoveredPercent?: number;
  };
  /** Freshness: how recent the evidence is */
  freshness: {
    /** Median age of top evidence in hours */
    medianAgeHours: number;
    /** Time window label (e.g., "24h", "3d") */
    windowLabel: string;
    /** ISO timestamp of newest item */
    newestAt?: string;
    /** ISO timestamp of oldest item in window */
    oldestAt?: string;
  };
  /** Confidence: evidence sufficiency */
  confidence: {
    /** Overall score 0-100 */
    score: number;
    /** Whether sources agree or disagree */
    hasDisagreement: boolean;
    /** Label: "High", "Medium", "Low" */
    level: "high" | "medium" | "low";
    /** Optional explanation */
    rationale?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE - For agentic reproducibility
// ═══════════════════════════════════════════════════════════════════════════

export interface RetrievalLogEntry {
  /** Query or topic searched */
  query: string;
  /** Connector/source used */
  connector: string;
  /** When retrieved */
  retrievedAt: string;
  /** Number of results */
  resultCount: number;
}

export interface GenerationLog {
  /** Model used */
  model: string;
  /** When generated */
  generatedAt: string;
  /** Validation status */
  validationStatus: "passed" | "retried" | "failed";
  /** Number of retries */
  retryCount?: number;
  /** Token usage */
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface Provenance {
  /** Retrieval log entries */
  retrievalLog: RetrievalLogEntry[];
  /** Generation metadata */
  generation: GenerationLog;
  /** Snapshot ID for reproducibility */
  snapshotId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY BRIEF PAYLOAD - The canonical 3-Act structure
// ═══════════════════════════════════════════════════════════════════════════

export interface DailyBriefMeta {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Editorial headline (e.g., "The Edge Latency Shift") */
  headline: string;
  /** 1-sentence executive summary (the "day thesis") */
  summary: string;
  /** Whether the record includes a resolved evidence bundle */
  hasEvidence?: boolean;
  /** Optional: Overall confidence score (0-100) */
  confidence?: number;
  /** Optional: Brief version for same-day updates */
  version?: number;
}

export interface ActII {
  /** Section title (e.g., "Act II: Rising Action") */
  title: string;
  /**
   * 2-4 sentences of narrative analysis
   * CONSTRAINT: No bullets, no URLs, no timestamps, no log formatting
   */
  synthesis: string;
  /** Array of signal objects (no raw strings) */
  signals: Signal[];
}

export interface ActIII {
  /** Section title (e.g., "Act III: Actions") */
  title: string;
  /**
   * 1-3 sentences describing recommended moves and why
   * CONSTRAINT: No bullets, no URLs, no log formatting
   */
  synthesis: string;
  /** Array of action/deep-dive objects */
  actions: Action[];
}

export interface DailyBriefDashboard {
  /** Optional visualization artifact for the dashboard */
  vizArtifact?: VizArtifact;
  /** Optional source breakdown */
  sourceBreakdown?: Record<string, number>;
  /** Optional trending tags */
  trendingTags?: string[];
}

/**
 * The canonical Daily Brief payload
 *
 * This is the "golden JSON" structure that drives:
 * - ScrollytellingLayout sections
 * - LiveDashboard controlled mode
 * - Evidence/tooltip drilldowns
 */
export interface DailyBriefPayload {
  meta: DailyBriefMeta;
  /** Quality metrics for above-the-fold KPI tiles */
  quality?: QualityMetrics;
  /** Optional "Did you know" update (LLM-generated, judge-verified) */
  didYouKnow?: {
    messageText: string;
    artifactId: string;
    passed: boolean;
    sourcesUsed: Array<{ url: string; citationId: string; title?: string; publishedAtIso?: string }>;
    checks: {
      noEmDash: boolean;
      allSourcesHavePublishedAtIso: boolean;
      hasFactPerSource: boolean;
      allFactsHaveCitations: boolean;
      nonGenericFacts: boolean;
      hasPrediction: boolean;
      predictionsHaveCitations: boolean;
      performanceClaimsAttributed: boolean;
    };
    llmJudge: {
      passed: boolean;
      modelUsed: string;
      artifactId: string;
    };
    judgeExplanation?: string;
    judgeReasons?: string[];
  };
  actI: {
    title: string;
    /** Coverage summary - items, sources, freshness */
    synthesis: string;
    /** Top sources with item counts */
    topSources: Array<{ source: string; count: number }>;
    /** Total items in scope */
    totalItems: number;
    /** Number of unique sources */
    sourcesCount: number;
    /** ISO timestamp of most recent item */
    latestItemAt?: string;
    /** What we filtered out (for transparency) */
    filteredOutNote?: string;
  };
  actII: ActII;
  actIII: ActIII;
  dashboard?: DailyBriefDashboard;
  /** Provenance for agentic reproducibility */
  provenance?: Provenance;
}

/** Minimal provenance for retrieval-backed briefs (PROV-inspired). */
export interface RetrievalRun {
  runId: string;
  tool: string;
  query: string;
  executedAt: string;
  topK: number;
  datasetHash: string;
}

export interface ExecutiveBriefRecord {
  status: "valid" | "invalid";
  brief: DailyBriefPayload;
  evidence: Evidence[];
  provenance: { retrievalRuns: RetrievalRun[] };
  errors?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON SCHEMA FOR STRUCTURED OUTPUTS (OpenAI/Anthropic compatible)
// ═══════════════════════════════════════════════════════════════════════════

export const DailyBriefJSONSchema = {
  name: "generate_daily_brief",
  // NOTE: OpenAI "strict" JSON schema mode requires every property to be listed in `required` at every object level.
  // This schema intentionally allows optional fields, so strict mode must remain off.
  strict: false,
  schema: {
    type: "object" as const,
    required: ["meta", "actI", "actII", "actIII"],
    additionalProperties: false,
    properties: {
      meta: {
        type: "object" as const,
        required: ["date", "headline", "summary"],
        additionalProperties: false,
        properties: {
          date: { type: "string" as const, description: "YYYY-MM-DD format" },
          headline: { type: "string" as const, description: "Editorial headline (e.g. 'The Edge Latency Shift')" },
          summary: { type: "string" as const, description: "1-sentence executive summary." },
          confidence: { type: "number" as const, description: "Overall confidence 0-100" },
          version: { type: "number" as const, description: "Brief version for same-day updates" }
        }
      },
      actI: {
        type: "object" as const,
        required: ["title", "synthesis", "topSources", "totalItems", "sourcesCount"],
        additionalProperties: false,
        properties: {
          title: { type: "string" as const },
          synthesis: { type: "string" as const, description: "Coverage summary. NO BULLETS. NO URLS." },
          topSources: {
            type: "array" as const,
            maxItems: 6,
            items: {
              type: "object" as const,
              required: ["source", "count"],
              properties: {
                source: { type: "string" as const },
                count: { type: "number" as const }
              }
            }
          },
          totalItems: { type: "number" as const },
          sourcesCount: { type: "number" as const },
          latestItemAt: { type: "string" as const }
        }
      },
      actII: {
        type: "object" as const,
        required: ["title", "synthesis", "signals"],
        additionalProperties: false,
        properties: {
          title: { type: "string" as const },
          synthesis: {
            type: "string" as const,
            description: "2-4 sentences of narrative analysis. NO BULLETS. NO URLS."
          },
          signals: {
            type: "array" as const,
            maxItems: 6,
            items: {
              type: "object" as const,
              required: ["id", "headline", "synthesis", "evidence"],
              additionalProperties: false,
              properties: {
                id: { type: "string" as const },
                headline: { type: "string" as const },
                synthesis: { type: "string" as const, description: "Analysis of this signal." },
                evidence: {
                  type: "array" as const,
                  maxItems: 5,
                  items: {
                    type: "object" as const,
                    required: ["id", "source", "title", "url", "publishedAt", "relevance"],
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" as const },
                      source: { type: "string" as const },
                      title: { type: "string" as const },
                      url: { type: "string" as const },
                      publishedAt: { type: "string" as const },
                      relevance: { type: "string" as const, description: "Why this supports the claim." },
                      score: { type: "number" as const },
                      favicon: { type: "string" as const }
                    }
                  }
                },
                relatedSignalIds: {
                  type: "array" as const,
                  maxItems: 8,
                  items: { type: "string" as const }
                }
              }
            }
          }
        }
      },
      actIII: {
        type: "object" as const,
        required: ["title", "synthesis", "actions"],
        additionalProperties: false,
        properties: {
          title: { type: "string" as const },
          synthesis: { type: "string" as const },
          actions: {
            type: "array" as const,
            maxItems: 6,
            items: {
              type: "object" as const,
              required: ["id", "label", "status", "content", "linkedSignalIds"],
              additionalProperties: false,
              properties: {
                id: { type: "string" as const },
                label: { type: "string" as const },
                status: {
                  type: "string" as const,
                  enum: ["proposed", "insufficient_data", "skipped", "in_progress", "completed"]
                },
                content: { type: "string" as const, description: "Deep dive content or skip reason." },
                linkedSignalIds: {
                  type: "array" as const,
                  maxItems: 8,
                  items: { type: "string" as const },
                  description: "IDs from Act II that justify this action."
                },
                priority: { type: "number" as const },
                resultMarkdown: { type: "string" as const }
              }
            }
          }
        }
      },
      dashboard: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          vizArtifact: {
            type: "object" as const,
            required: ["intent", "rationale", "data", "spec"],
            additionalProperties: false,
            properties: {
              intent: {
                type: "string" as const,
                enum: ["time_series", "category_compare", "distribution", "correlation", "part_to_whole"]
              },
              rationale: { type: "string" as const },
              data: {
                type: "array" as const,
                description: "Inline data array. No external URLs.",
                maxItems: 200,
                items: { type: "object" as const, additionalProperties: true }
              },
              spec: {
                type: "object" as const,
                description: "Vega-Lite JSON spec. Prohibit 'data.url'.",
                additionalProperties: true
              }
            }
          },
          sourceBreakdown: {
            type: "object" as const,
            additionalProperties: { type: "number" as const }
          },
          trendingTags: {
            type: "array" as const,
            maxItems: 12,
            items: { type: "string" as const }
          }
        }
      }
    }
  }
} as const;
