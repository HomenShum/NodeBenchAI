/**
 * Research Feature Types
 *
 * Exports all type definitions for the research feature including:
 * - Daily Brief canonical schema (3-Act structure)
 * - Dashboard state types
 * - Validation utilities
 */

// Re-export existing types from types.ts
export type {
  TooltipPayload,
  ChartPoint,
  ChartSeries,
  TrendLineConfig,
  Annotation,
  DeltaValue,
  KeyStat,
  CapabilityEntry,
  MarketShareSegment,
  SkillToggle,
  StatusBanner,
  MilestoneLabel,
  DashboardState,
  AgentDashboardUpdate,
  StorySection
} from "../types";

// Export Daily Brief canonical schema
export type {
  EvidenceSource,
  Evidence,
  Signal,
  ActionStatus,
  Action,
  VizIntent,
  VizArtifact,
  DailyBriefMeta,
  ActII,
  ActIII,
  DailyBriefDashboard,
  DailyBriefPayload,
  RetrievalRun,
  ExecutiveBriefRecord
} from "./dailyBriefSchema";

export { DailyBriefJSONSchema } from "./dailyBriefSchema";

// Export Citation & Provenance schema
export type {
  CitationType,
  Citation,
  CitationOccurrence,
  CitationLibrary,
  ParsedCitation
} from "./citationSchema";

export {
  CITATION_REGEX,
  parseCitations,
  createCitationLibrary,
  addCitation,
  getCitation,
  getOrderedCitations
} from "./citationSchema";

// Export Entity schema
export type {
  EntityType,
  Entity,
  EntityLibrary,
  ParsedEntity
} from "./entitySchema";

export {
  ENTITY_REGEX,
  parseEntities,
  createEntityLibrary,
  addEntity,
  getEntity,
  getEntityByName,
  getAllEntities,
  getEntitiesByType
} from "./entitySchema";

// Export Research Supplement types
export type {
  SupplementType,
  SupplementSection,
  ResearchSupplement
} from "../components/ResearchSupplement";

// Export Email Digest types
export type {
  DigestTopic,
  DigestItem,
  EmailDigest
} from "../components/EmailDigestPreview";
