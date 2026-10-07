/**
 * Detector Framework Types
 * Core types and interfaces for the proactive detector system
 */

import { Id } from "../../../_generated/dataModel";

/**
 * Detector execution mode
 */
export type DetectorMode = "streaming" | "batch";

/**
 * Detector metadata
 */
export interface DetectorMetadata {
  detectorId: string; // Unique identifier (e.g., "meeting_prep_v1")
  name: string; // Human-readable name
  description: string; // What this detector does
  version: string; // Version string (e.g., "1.0.0")
  mode: DetectorMode; // Streaming (per-event) or Batch (scheduled)

  // Scheduling (for batch detectors)
  schedule?: {
    cron?: string; // Cron expression (e.g., "0 8 * * *" for 8 AM daily)
    interval?: number; // Or interval in milliseconds
  };

  // Event filtering (for streaming detectors)
  eventTypes?: string[]; // Which event types to process

  // Resource constraints
  maxExecutionTime?: number; // Max execution time in ms
  rateLimit?: {
    maxPerDay?: number;
    maxPerWeek?: number;
    deduplicateWindow?: number; // Time window in ms for deduplication
  };

  // Tier availability
  tier: "free" | "paid" | "enterprise";

  // Feature flags
  enabled: boolean;
  experimental?: boolean;
}

/**
 * Detector execution context
 * Passed to detector run() method
 */
export interface DetectorContext {
  userId: Id<"users">;

  // Database access
  db: {
    get: (id: any) => Promise<any | null>;
    query: (tableName: string) => any;
  };

  // For streaming detectors: single event
  event?: {
    eventId: string;
    eventType: string;
    timestamp: number;
    source: string;
    summary?: string;
    contentPointer?: Id<"sourceArtifacts">; // Link to email/calendar event
    entities?: Array<{
      entityId: string;
      entityType: string;
      entityName: string;
      confidence: number;
    }>;
    metadata?: any;
  };

  // For batch detectors: time window
  timeWindow?: {
    startTime: number;
    endTime: number;
  };

  // User settings
  userSettings?: {
    enabledDetectors: string[];
    quietHoursStart?: number;
    quietHoursEnd?: number;
    timezone: string;
    minimumConfidence: number;
  };

  // Helper methods
  queryEvents?: (filter: any) => Promise<any[]>;
  queryArtifacts?: (filter: any) => Promise<any[]>;
  getEntity?: (entityId: string) => Promise<any | null>;
}

/**
 * Opportunity output from detector
 */
export interface DetectedOpportunity {
  opportunityId?: string; // Auto-generated if not provided
  type: string; // Opportunity type (e.g., "meeting_prep", "follow_up")

  // Trigger information
  trigger: {
    eventIds: string[]; // Which events triggered this
    whyNow: string; // Explanation: "Meeting in 4 hours"
    detectorName: string;
    detectorVersion: string;
  };

  // Evidence
  evidencePointers?: Array<{
    artifactId: Id<"sourceArtifacts">;
    excerpt?: string;
    relevanceScore?: number;
  }>;

  // Impact estimate
  impactEstimate?: {
    timeSavedMinutes?: number;
    riskReduced?: "low" | "medium" | "high" | "critical";
    confidenceLevel: number; // 0-1
  };

  // Risk assessment
  riskLevel: "low" | "medium" | "high";

  // Suggested actions
  suggestedActions: Array<{
    actionType: string; // "suggest" | "draft" | "execute"
    description: string;
    config: any; // Action-specific configuration
    template?: string; // Template for drafts
  }>;

  // Metadata
  metadata?: any;
  expiresAt?: number; // When this opportunity becomes stale
}

/**
 * Detector execution result
 */
export interface DetectorResult {
  success: boolean;
  opportunities: DetectedOpportunity[];

  // Execution stats
  executionTime: number; // ms
  eventsProcessed?: number;
  artifactsAccessed?: number;

  // Errors
  error?: string;
  warnings?: string[];

  // Metadata
  metadata?: any;
}

/**
 * Base detector interface
 * All detectors must implement this
 */
export interface IDetector {
  readonly metadata: DetectorMetadata;

  /**
   * Execute detector logic
   * @param ctx Execution context
   * @returns Detected opportunities
   */
  run(ctx: DetectorContext): Promise<DetectorResult>;

  /**
   * Optional: Validate if detector can run
   * @param ctx Execution context
   * @returns true if can run, false otherwise
   */
  canRun?(ctx: DetectorContext): Promise<boolean>;

  /**
   * Optional: Cleanup/teardown logic
   */
  cleanup?(): Promise<void>;
}

/**
 * Detector run record (for observability)
 */
export interface DetectorRunRecord {
  detectorId: string;
  detectorVersion: string;
  userId: Id<"users">;
  status: "running" | "completed" | "failed";

  // Input
  inputEventId?: string;
  inputTimeWindow?: {
    startTime: number;
    endTime: number;
  };

  // Output
  opportunitiesDetected: number;
  opportunities: string[]; // Array of opportunity IDs

  // Performance
  startedAt: number;
  completedAt?: number;
  executionTime?: number; // ms

  // Errors
  error?: string;
  warnings?: string[];

  // Metadata
  metadata?: any;
}
