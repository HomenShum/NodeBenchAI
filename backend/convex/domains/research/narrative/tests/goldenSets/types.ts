export interface GoldenSuiteGovernance {
  owners: string[];
  adjudicationPolicyVersion: string;
  targetKappaOverall?: number;
  targetKappaHighRisk?: number;
  refreshCadenceDays?: number;
}

export interface GoldenSuiteMeta {
  suiteId: string;
  version: string;
  createdAt?: string;
  description?: string;
  governance?: GoldenSuiteGovernance;
  caseCount: number;
}

export type GoldenPipelineMode = "deterministic" | "record_replay" | "live";
export type GoldenToolReplayMode = "off" | "record" | "replay";

export interface InjectedNewsItem {
  headline: string;
  url: string;
  publishedAt: number; // unix ms
  snippet?: string;
  sourceName?: string;
  relevanceScore?: number;
  entityKeys?: string[];
  topicTags?: string[];
}

export interface GoldenRunConfig {
  weekNumber: string; // ISO week, e.g. 2026-W04
  pipelineMode: GoldenPipelineMode;
  toolReplayMode?: GoldenToolReplayMode;
  codeVersion?: string;
  userId?: string;
  scout: {
    targetEntityKeys?: string[];
    injectedNewsItems: InjectedNewsItem[];
    recencyDays?: number;
    maxItemsPerEntity?: number;
    searchMode?: "fast" | "balanced" | "comprehensive";
  };
  analyst: {
    useHeuristicOnly: boolean;
    heuristicProfile?: string;
  };
  publisher: {
    enableDedup?: boolean;
    dedupPolicyId?: string;
    minCitationCoverage?: number;
  };
}

export interface CountExpectation {
  eq?: number;
  gte?: number;
  lte?: number;
}

export type Predicate =
  | { type: "byIndex"; index: number }
  | {
      type: "byField";
      field: string;
      op: "eq" | "in" | "contains" | "regex";
      value?: unknown;
      values?: unknown[];
    }
  | { type: "byTextContains"; textContains: string; textFields?: string[] }
  | { type: "byComputedId"; computedId: unknown };

export type Matcher =
  | { eq: unknown }
  | { in: unknown[] }
  | { contains: string }
  | { regex: string }
  | { gte: number }
  | { lte: number }
  | { between: [number, number] }
  | { exists: boolean }
  | { len: CountExpectation }
  | { allOf: Matcher[] }
  | { anyOf: Matcher[] };

export interface ExpectedItem {
  where: Predicate;
  expect: Record<string, Matcher>;
}

export interface ExpectedCollection {
  count?: CountExpectation;
  items?: ExpectedItem[];
}

export interface ExpectedPersistedOutputs {
  threads?: ExpectedCollection;
  events?: ExpectedCollection;
  posts?: ExpectedCollection;
  evidenceArtifacts?: ExpectedCollection;
  searchLogs?: ExpectedCollection;
  workflowTrace?: {
    requireWorkflowId?: boolean;
    requireConfigHash?: boolean;
    requireCodeVersion?: boolean;
    requireReplayDigest?: boolean;
    expectReplayMode?: GoldenPipelineMode;
  };
}

export interface DedupDecisionExpectation {
  where: Predicate;
  decision: {
    action:
      | "create"
      | "skip"
      | "link_update"
      | "revise_thesis"
      | "spawn_thread"
      | "needs_review";
    stage:
      | "no_match"
      | "canonical_url"
      | "content_hash"
      | "near_duplicate"
      | "materiality_check"
      | "manual_override";
    linkedToEventId?: string;
  };
}

export interface CaseAssertions {
  metrics?: {
    citationCoverageMin?: number;
    claimCoverageMin?: number;
    unsupportedClaimRateMax?: number;
    hasSearchLogs?: boolean;
  };
  dedup?: {
    requireStableEventIds?: boolean;
    requireDeterministicDedupDecisions?: boolean;
    expectedDecisions?: DedupDecisionExpectation[];
  };
  claims?: {
    requireEvidenceBinding?: boolean;
    minEvidenceArtifactsPerClaim?: number;
    maxUnsupportedClaims?: number;
  };
}

export interface SeedSpec {
  existingThread?: {
    threadId: string;
    name: string;
    thesis: string;
    entityKeys: string[];
    createdAt: number;
  };
  knowledgeGraph?: {
    sourceType: "entity" | "theme" | "artifact" | "session";
    sourceId: string;
    name: string;
    createdAt: number;
    claims: Array<{
      subject: string;
      predicate: string;
      object: string;
      claimText: string;
      isHighConfidence: boolean;
      sourceDocIds: string[];
    }>;
    edges?: Array<{
      fromIndex: number;
      toIndex: number;
      edgeType:
        | "supports"
        | "contradicts"
        | "mentions"
        | "causes"
        | "relatedTo"
        | "partOf"
        | "precedes";
      isStrong: boolean;
    }>;
  };
}

export interface GoldenCase {
  suiteId: string;
  suiteVersion: string;
  governance?: GoldenSuiteGovernance;
  caseId: string;
  name: string;
  tags: string[];
  notes?: string;
  run: GoldenRunConfig;
  expected: ExpectedPersistedOutputs;
  assertions: CaseAssertions;
  seed?: SeedSpec;
}

