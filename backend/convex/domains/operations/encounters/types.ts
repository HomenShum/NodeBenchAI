/**
 * types.ts - Encounter domain type definitions
 *
 * Types for the Event-Driven Encounter Capture system.
 * Supports fast pipeline capture from side-events with optional DD enrichment.
 */

import { Id } from "../../../_generated/dataModel";

// ============================================================================
// Source Types
// ============================================================================

export type EncounterSourceType =
  | "slack"
  | "web_ui"
  | "email_forward"
  | "calendar_sync";

// ============================================================================
// Research Status
// ============================================================================

export type EncounterResearchStatus =
  | "none"              // No research requested
  | "fast_pass_queued"  // <10s enrichment queued
  | "fast_pass_complete" // Basic enrichment done
  | "deep_dive_queued"  // Full DD requested
  | "deep_dive_running" // DD in progress
  | "complete";         // All research done

// ============================================================================
// Participant Types
// ============================================================================

export interface EncounterParticipant {
  name: string;
  role?: string;
  company?: string;
  email?: string;
  linkedEntityId?: Id<"entityContexts">;
  confidence: number;  // NER extraction confidence 0-1
}

export interface EncounterCompany {
  name: string;
  linkedEntityId?: Id<"entityContexts">;
  confidence: number;  // NER extraction confidence 0-1
}

// ============================================================================
// Fast Pass Results (inline <10s enrichment)
// ============================================================================

export interface EntitySummary {
  entityName: string;
  summary: string;          // 1-2 sentences
  keyFacts: string[];       // 3-5 facts
  fundingStage?: string;    // "Series A", "Seed", etc.
  lastFundingAmount?: string;
  sector?: string;
}

export interface FastPassResults {
  entitySummaries: EntitySummary[];
  generatedAt: number;
  elapsedMs: number;
}

// ============================================================================
// NER Extraction Result
// ============================================================================

export interface NERExtractionResult {
  participants: EncounterParticipant[];
  companies: EncounterCompany[];
  title: string;              // Auto-generated title
  context?: string;           // Meeting context/topic
}

// ============================================================================
// Encounter Event (Full Document Shape)
// ============================================================================

export interface EncounterEvent {
  _id: Id<"encounterEvents">;
  _creationTime: number;

  userId: Id<"users">;

  // Source tracking
  sourceType: EncounterSourceType;
  sourceId?: string;
  sourceChannelId?: string;

  // Core data
  rawText: string;
  title: string;
  context?: string;

  // Extracted entities
  participants: EncounterParticipant[];
  companies: EncounterCompany[];

  // Research status
  researchStatus: EncounterResearchStatus;

  // Fast-pass results
  fastPassResults?: FastPassResults;

  // Deep dive links
  ddJobId?: string;
  ddMemoId?: Id<"dueDiligenceMemos">;

  // Follow-up tracking
  followUpRequested: boolean;
  followUpDate?: number;
  followUpTaskId?: Id<"userEvents">;
  suggestedNextAction?: string;

  // Timestamps
  capturedAt: number;
  enrichedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Capture Input Types
// ============================================================================

export interface CaptureFromWebInput {
  rawText: string;
  context?: string;
  requestFastPass?: boolean;
  requestDeepDive?: boolean;
}

export interface CaptureFromSlackInput {
  rawText: string;
  userId: string;             // Slack user ID (will be mapped)
  channelId: string;
  messageTs: string;
  requestFastPass?: boolean;
}

// ============================================================================
// Follow-up Types
// ============================================================================

export type FollowUpAction =
  | "send_intro_email"
  | "schedule_meeting"
  | "request_deck"
  | "add_to_crm"
  | "deep_research"
  | "connect_on_linkedin"
  | "custom";

export interface SuggestedFollowUp {
  action: FollowUpAction;
  description: string;
  priority: "high" | "medium" | "low";
  deadline?: number;  // Suggested deadline timestamp
}

// ============================================================================
// Enrichment Response
// ============================================================================

export interface EnrichmentResponse {
  encounter: EncounterEvent;
  fastPassResults?: FastPassResults;
  suggestedFollowUps: SuggestedFollowUp[];
  deepDiveAvailable: boolean;
  estimatedDeepDiveCost?: string;  // "$0.50" etc.
}
