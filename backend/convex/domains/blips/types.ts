/**
 * types.ts - Blips domain type definitions
 *
 * Types for the "Undo AI Slop" Meaning Blips Feed system.
 * Universal blips with persona lens at render time.
 */

import { Id } from "../../_generated/dataModel";

// ============================================================================
// News Item Types
// ============================================================================

export type NewsSource =
  | "hacker_news"
  | "arxiv"
  | "reddit"
  | "rss"
  | "github"
  | "product_hunt"
  | "dev_to"
  | "twitter"
  | "manual";

export type NewsCategory =
  | "tech"
  | "ai_ml"
  | "funding"
  | "research"
  | "security"
  | "startup"
  | "product"
  | "regulatory"
  | "markets"
  | "general";

export type ProcessingStatus =
  | "ingested"
  | "claim_extraction"
  | "blips_generated"
  | "verification_queued"
  | "complete";

export interface RawMetrics {
  upvotes?: number;
  comments?: number;
  shares?: number;
  stars?: number;
}

export interface NewsItem {
  _id: Id<"newsItems">;
  _creationTime: number;
  sourceId: string;
  contentHash: string;
  source: NewsSource;
  sourceUrl: string;
  title: string;
  fullContent?: string;
  summary?: string;
  category: NewsCategory;
  tags: string[];
  engagementScore: number;
  rawMetrics?: RawMetrics;
  processingStatus: ProcessingStatus;
  publishedAt: number;
  ingestedAt: number;
  processedAt?: number;
}

// ============================================================================
// Claim Types
// ============================================================================

export type ClaimType =
  | "factual"
  | "quantitative"
  | "attribution"
  | "temporal"
  | "causal"
  | "comparative"
  | "predictive"
  | "opinion";

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "partially_verified"
  | "contradicted"
  | "unverifiable";

export type EntityType =
  | "company"
  | "person"
  | "product"
  | "technology"
  | "organization"
  | "location";

export interface ClaimEntity {
  name: string;
  type: EntityType;
  linkedEntityId?: Id<"entityContexts">;
}

export interface ClaimSpan {
  _id: Id<"claimSpans">;
  _creationTime: number;
  newsItemId: Id<"newsItems">;
  claimText: string;
  originalSpan: string;
  spanStartIdx: number;
  spanEndIdx: number;
  claimType: ClaimType;
  entities: ClaimEntity[];
  verificationStatus: VerificationStatus;
  verificationId?: Id<"blipClaimVerifications">;
  extractionConfidence: number;
  createdAt: number;
}

// ============================================================================
// Blip Types
// ============================================================================

export type SourceReliability =
  | "authoritative"
  | "reliable"
  | "secondary"
  | "inferred";

export interface KeyFact {
  fact: string;
  source?: string;
  date?: string;
  confidence: number;
}

export interface BlipSource {
  name: string;
  url?: string;
  publishedAt?: number;
  reliability: SourceReliability;
}

export interface PrimaryEntity {
  name: string;
  type: string;
  linkedEntityId?: Id<"entityContexts">;
}

export interface VerificationSummary {
  totalClaims: number;
  verifiedClaims: number;
  contradictedClaims: number;
  overallConfidence: number;
}

export interface MeaningBlip {
  _id: Id<"meaningBlips">;
  _creationTime: number;
  newsItemId: Id<"newsItems">;
  claimSpanId?: Id<"claimSpans">;

  // Universal blip content (5/10/20 word versions)
  headline: string;
  summary: string;
  context: string;

  // Key facts for hover popover
  keyFacts: KeyFact[];

  // Entity spotlight
  primaryEntity?: PrimaryEntity;

  // Verification summary
  verificationSummary: VerificationSummary;

  // Source attribution
  sources: BlipSource[];

  // Ranking signals
  relevanceScore: number;
  engagementScore: number;
  freshnessScore: number;

  // Category for filtering
  category: string;
  tags: string[];

  // Timestamps
  publishedAt: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Persona Lens Types
// ============================================================================

export type PersonaId =
  | "JPM_STARTUP_BANKER"
  | "EARLY_STAGE_VC"
  | "CTO_TECH_LEAD"
  | "ACADEMIC_RD"
  | "PHARMA_BD"
  | "MACRO_STRATEGIST"
  | "QUANT_PM"
  | "CORP_DEV"
  | "LP_ALLOCATOR"
  | "JOURNALIST";

export interface PersonaLens {
  _id: Id<"personaLenses">;
  _creationTime: number;
  blipId: Id<"meaningBlips">;
  personaId: string;
  framingHook: string;
  actionPrompt?: string;
  relevanceScore: number;
  whyItMatters?: string;
  createdAt: number;
}

// ============================================================================
// Verification Types
// ============================================================================

export type Verdict =
  | "verified"
  | "partially_verified"
  | "contradicted"
  | "unverifiable"
  | "insufficient_evidence";

export type EvidenceAlignment = "supports" | "contradicts" | "neutral";

export interface SupportingEvidence {
  sourceUrl?: string;
  sourceName: string;
  snippet: string;
  publishedAt?: number;
  alignment: EvidenceAlignment;
}

export interface Contradiction {
  contradictingClaim: string;
  sourceUrl?: string;
  sourceName: string;
}

export interface BlipClaimVerification {
  _id: Id<"blipClaimVerifications">;
  _creationTime: number;
  claimSpanId: Id<"claimSpans">;
  verdict: Verdict;
  confidence: number;
  supportingEvidence: SupportingEvidence[];
  contradictions?: Contradiction[];
  judgeModel: string;
  judgeReasoning: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Feed Response Types
// ============================================================================

export type WordCountTier = 5 | 10 | 20;

export interface BlipFeedItem {
  blip: MeaningBlip;
  newsItem: NewsItem;
  personaLens?: PersonaLens;
  text: string;  // The selected word count version (headline/summary/context)
}

export interface BlipFeedResponse {
  items: BlipFeedItem[];
  hasMore: boolean;
  nextCursor?: number;
}

export interface BlipWithVerification {
  blip: MeaningBlip;
  newsItem: NewsItem;
  claims: ClaimSpan[];
  verifications: BlipClaimVerification[];
  personaLens?: PersonaLens;
}

// ============================================================================
// Pipeline Types
// ============================================================================

export interface IngestionResult {
  newsItemId: Id<"newsItems">;
  source: NewsSource;
  title: string;
  isNew: boolean;
}

export interface ClaimExtractionResult {
  newsItemId: Id<"newsItems">;
  claims: ClaimSpan[];
  extractedCount: number;
}

export interface BlipGenerationResult {
  blipId: Id<"meaningBlips">;
  headline: string;
  summary: string;
  context: string;
}

export interface VerificationResult {
  claimSpanId: Id<"claimSpans">;
  verdict: Verdict;
  confidence: number;
}

export interface PipelineStats {
  ingested: number;
  claimsExtracted: number;
  blipsGenerated: number;
  verified: number;
  personaLensesGenerated: number;
  elapsedMs: number;
}
