/**
 * Proactive System Schema
 * Database tables for proactive intelligence features
 *
 * Tables:
 * - proactiveEvents: Unified event bus for all activity signals
 * - opportunities: Detected opportunities from detectors
 * - proactiveActions: Actions taken (suggest/draft/execute)
 * - detectorRuns: Observability for detector executions
 * - userProactiveSettings: Per-user configuration
 * - proactiveFeedbackLabels: User feedback for learning
 * - customDetectors: User-created detectors (premium)
 * - adminUsers: Admin access control (invite-only)
 * - proactiveSubscriptions: Stripe billing (free vs paid)
 * - usageTracking: Monthly quota tracking
 * - userConsents: Blanket consent tracking
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* PROACTIVE EVENTS - Unified event bus                               */
/* ------------------------------------------------------------------ */
export const proactiveEvents = defineTable({
  // Event metadata
  eventId: v.string(),                    // UUID for idempotency
  timestamp: v.number(),                  // When event occurred (ms)
  eventType: v.union(
    v.literal("slack_message"),
    v.literal("slack_mention"),
    v.literal("slack_reaction"),
    v.literal("email_received"),
    v.literal("email_sent"),
    v.literal("calendar_event_created"),
    v.literal("calendar_event_updated"),
    v.literal("meeting_started"),
    v.literal("meeting_ended"),
    v.literal("web_article_discovered"),
    v.literal("voice_capture"),
    v.literal("text_capture"),
    v.literal("photo_capture"),
  ),

  // Source information
  source: v.string(),                     // "slack" | "gmail" | "calendar" | "web" | "capture"
  sourceId: v.string(),                   // External ID (Slack msg ID, Gmail thread ID, etc.)
  sourceUrl: v.optional(v.string()),      // Deep link if available

  // Actor
  actor: v.optional(v.object({
    userId: v.optional(v.id("users")),    // Internal user ID if known
    email: v.optional(v.string()),        // Email address
    name: v.optional(v.string()),         // Display name
    externalId: v.optional(v.string()),   // External ID (Slack user ID, etc.)
  })),

  // Content (stored as pointer to artifact)
  contentPointer: v.optional(v.id("sourceArtifacts")),  // Points to full content
  contentHash: v.string(),                // SHA-256 for deduplication
  summary: v.optional(v.string()),        // Brief preview (max 500 chars)

  // Extracted entities
  entities: v.optional(v.array(v.object({
    entityId: v.string(),                 // Canonical entity ID
    entityType: v.string(),               // "person" | "company" | "topic" | "product"
    entityName: v.string(),               // Display name
    confidence: v.number(),               // 0-1 extraction confidence
    mentionContext: v.optional(v.string()), // Surrounding text snippet
  }))),

  // Sensitivity & compliance
  sensitivity: v.object({
    hasPII: v.boolean(),                  // Contains personal identifiable info
    hasFinancial: v.boolean(),            // Contains financial data
    hasConfidential: v.boolean(),         // Marked confidential
    retentionClass: v.union(
      v.literal("transient"),             // 7 days
      v.literal("standard"),              // 90 days
      v.literal("extended"),              // 365 days
      v.literal("permanent"),             // No expiry
    ),
  }),

  // Processing status
  processingStatus: v.union(
    v.literal("pending"),                 // Not yet processed
    v.literal("processing"),              // Being processed by detectors
    v.literal("processed"),               // All detectors ran
    v.literal("failed"),                  // Processing error
    v.literal("skipped"),                 // Filtered/deduplicated
  ),
  processedAt: v.optional(v.number()),

  // Confidence & quality
  extractionConfidence: v.optional(v.number()), // 0-1 overall confidence
  sourceQuality: v.optional(v.union(
    v.literal("high"),                    // Verified source
    v.literal("medium"),                  // Known source
    v.literal("low"),                     // Unverified source
  )),

  // Metadata
  metadata: v.optional(v.any()),          // Source-specific metadata
  expiresAt: v.optional(v.number()),      // Deletion timestamp

  // Agent dispatch routing — connects proactiveEvents → agent heartbeat system
  dispatchedToAgentId: v.optional(v.string()),  // Agent identity that will process this event
  dispatchedAt: v.optional(v.number()),         // When event was routed to agent

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_timestamp", ["timestamp"])
  .index("by_eventType", ["eventType", "timestamp"])
  .index("by_source", ["source", "timestamp"])
  .index("by_contentHash", ["contentHash"])
  .index("by_status", ["processingStatus", "createdAt"])
  .index("by_actor", ["actor.email", "timestamp"])
  .index("by_expires", ["expiresAt"])
  .index("by_dispatched", ["dispatchedToAgentId", "dispatchedAt"]);

/* ------------------------------------------------------------------ */
/* OPPORTUNITIES - Detector output                                    */
/* ------------------------------------------------------------------ */
export const opportunities = defineTable({
  // Opportunity identity
  opportunityId: v.string(),              // UUID
  type: v.union(
    v.literal("meeting_prep"),            // Prepare for upcoming meeting
    v.literal("follow_up"),               // Send follow-up message
    v.literal("risk_alert"),              // Risk detected, needs escalation
    v.literal("duplicate_update"),        // Duplicate entities found
    v.literal("research_gap"),            // Missing information detected
    v.literal("crm_update"),              // Update CRM record
    v.literal("relationship_nudge"),      // Haven't talked in X days
    v.literal("task_reminder"),           // Overdue task detected
  ),

  // Trigger explanation
  trigger: v.object({
    eventIds: v.array(v.id("events")),    // Events that triggered this
    triggerType: v.string(),              // "calendar_proximity" | "time_based" | "threshold_breach"
    whyNow: v.string(),                   // Human-readable explanation (max 200 chars)
    detectorName: v.string(),             // Which detector created this
    detectorVersion: v.string(),          // Detector version for A/B testing
    userId: v.id("users"),                // User this opportunity is for
  }),

  // Evidence
  evidencePointers: v.array(v.object({
    artifactId: v.id("sourceArtifacts"),  // Source artifact
    excerpt: v.optional(v.string()),      // Relevant excerpt (max 500 chars)
    excerptHash: v.optional(v.string()),  // Hash for dedup
    relevanceScore: v.optional(v.number()), // 0-1 how relevant this evidence is
  })),

  // Impact assessment
  impactEstimate: v.object({
    timeSavedMinutes: v.optional(v.number()),  // Est. time saved
    riskReduced: v.optional(v.union(           // Risk mitigation
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    )),
    revenueUpside: v.optional(v.number()),     // Est. revenue impact (USD)
    confidenceLevel: v.number(),               // 0-1 how confident we are
  }),

  // Recommended actions
  recommendedActions: v.array(v.object({
    actionType: v.string(),               // "send_email" | "create_task" | "update_crm"
    description: v.string(),              // What to do
    priority: v.number(),                 // 1-5 (1=highest)
    estimatedEffort: v.optional(v.string()), // "2 min" | "5 min" | "10 min"
  })),

  // Risk assessment
  riskLevel: v.union(
    v.literal("low"),                     // Safe to auto-execute
    v.literal("medium"),                  // Draft only
    v.literal("high"),                    // Suggest only
  ),
  riskRationale: v.string(),              // Why this risk level (max 300 chars)

  // Entities involved
  primaryEntity: v.optional(v.object({
    entityId: v.string(),
    entityType: v.string(),
    entityName: v.string(),
  })),
  relatedEntities: v.optional(v.array(v.object({
    entityId: v.string(),
    entityType: v.string(),
    entityName: v.string(),
  }))),

  // Status tracking
  status: v.union(
    v.literal("detected"),                // Just created
    v.literal("evaluating"),              // Policy gateway checking
    v.literal("approved"),                // Ready for action
    v.literal("rejected"),                // Policy/user rejected
    v.literal("actioned"),                // Action created
    v.literal("completed"),               // User completed action
    v.literal("dismissed"),               // User dismissed
    v.literal("expired"),                 // Window passed
  ),

  // Policy evaluation
  policyResult: v.optional(v.object({
    allowed: v.boolean(),
    requiresApproval: v.boolean(),
    blockedReasons: v.optional(v.array(v.string())),
    evaluatedAt: v.number(),
  })),

  // User interaction
  userFeedback: v.optional(v.object({
    reaction: v.union(
      v.literal("accepted"),              // User took action
      v.literal("rejected"),              // User dismissed with reason
      v.literal("ignored"),               // User didn't respond
      v.literal("useful"),                // Marked as helpful
      v.literal("not_useful"),            // Marked as not helpful
    ),
    reason: v.optional(v.string()),       // Why rejected/not useful
    feedbackAt: v.number(),
  })),

  // Delivery tracking
  deliveredVia: v.optional(v.array(v.object({
    channel: v.string(),                  // "slack" | "email" | "ntfy" | "ui"
    messageId: v.optional(v.string()),    // External message ID
    deliveredAt: v.number(),
  }))),

  // Expiration
  expiresAt: v.optional(v.number()),      // When opportunity is no longer valid

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
  actionedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})
  .index("by_type", ["type", "createdAt"])
  .index("by_status", ["status", "createdAt"])
  .index("by_risk", ["riskLevel", "status"])
  .index("by_entity", ["primaryEntity.entityId"])
  .index("by_detector", ["trigger.detectorName", "createdAt"])
  .index("by_user", ["trigger.userId", "createdAt"])
  .index("by_expires", ["expiresAt"])
  .index("by_status_expires", ["status", "expiresAt"]);

/* ------------------------------------------------------------------ */
/* PROACTIVE ACTIONS - Execution tracking                             */
/* ------------------------------------------------------------------ */
export const proactiveActions = defineTable({
  // Action identity
  actionId: v.string(),                   // UUID
  opportunityId: v.id("opportunities"),   // Source opportunity

  // Action type
  actionType: v.union(
    v.literal("send_email"),
    v.literal("draft_email"),
    v.literal("create_task"),
    v.literal("update_crm"),
    v.literal("schedule_meeting"),
    v.literal("send_slack_message"),
    v.literal("create_document"),
    v.literal("add_calendar_block"),
  ),

  // Action mode
  mode: v.union(
    v.literal("suggest"),                 // Read-only suggestion
    v.literal("draft"),                   // Write to staging
    v.literal("execute"),                 // Actually do it
  ),

  // Action payload
  payload: v.any(),                       // Action-specific data

  // Target
  target: v.optional(v.object({
    userId: v.optional(v.id("users")),    // Internal user
    email: v.optional(v.string()),        // Email address
    slackUserId: v.optional(v.string()),  // Slack user
    crmRecordId: v.optional(v.string()),  // CRM record
  })),

  // Status
  status: v.union(
    v.literal("pending"),                 // Waiting for approval
    v.literal("approved"),                // User approved
    v.literal("executing"),               // In progress
    v.literal("completed"),               // Done
    v.literal("failed"),                  // Error
    v.literal("rejected"),                // User rejected
    v.literal("cancelled"),               // System cancelled
  ),

  // Execution result
  result: v.optional(v.object({
    success: v.boolean(),
    externalId: v.optional(v.string()),   // ID from external system
    error: v.optional(v.string()),
    executedAt: v.number(),
  })),

  // Approval tracking
  approval: v.optional(v.object({
    required: v.boolean(),
    approver: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    method: v.optional(v.string()),       // "slack_button" | "email_link" | "ui_click"
  })),

  // Audit trail
  auditLog: v.array(v.object({
    timestamp: v.number(),
    event: v.string(),                    // "created" | "approved" | "executed" | "failed"
    actor: v.optional(v.string()),        // Who/what caused this
    details: v.optional(v.string()),
  })),

  // Rollback capability
  rollbackData: v.optional(v.any()),      // Data needed to undo this action
  rolledBack: v.optional(v.boolean()),
  rolledBackAt: v.optional(v.number()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_opportunity", ["opportunityId"])
  .index("by_status", ["status", "createdAt"])
  .index("by_type", ["actionType", "status"])
  .index("by_mode", ["mode", "createdAt"]);

/* ------------------------------------------------------------------ */
/* DETECTOR RUNS - Observability                                      */
/* ------------------------------------------------------------------ */
export const detectorRuns = defineTable({
  // Run identity
  runId: v.string(),                      // UUID
  detectorName: v.string(),               // "meeting_prep_detector"
  detectorVersion: v.string(),            // For A/B testing

  // Input
  triggerType: v.union(
    v.literal("event"),                   // Triggered by single event
    v.literal("batch"),                   // Batch processing (cron)
    v.literal("manual"),                  // Manual trigger
  ),
  eventIds: v.optional(v.array(v.id("events"))), // Events processed
  batchSize: v.optional(v.number()),      // For batch runs

  // Output
  opportunitiesCreated: v.number(),       // Count of opportunities created
  opportunityIds: v.array(v.id("opportunities")),

  // Performance
  durationMs: v.number(),
  tokensUsed: v.optional(v.number()),     // If LLM was used
  costUsd: v.optional(v.number()),

  // Status
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  error: v.optional(v.string()),

  // Timestamps
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_detector", ["detectorName", "startedAt"])
  .index("by_status", ["status", "startedAt"]);

/* ------------------------------------------------------------------ */
/* USER PROACTIVE SETTINGS                                            */
/* ------------------------------------------------------------------ */
export const userProactiveSettings = defineTable({
  userId: v.id("users"),

  // Global toggle
  proactiveEnabled: v.boolean(),          // Master on/off switch

  // Feature-level toggles
  features: v.object({
    meetingPrep: v.boolean(),
    followUpNudges: v.boolean(),
    riskAlerts: v.boolean(),
    crmUpdates: v.boolean(),
    emailDrafts: v.boolean(),
    taskReminders: v.boolean(),
    dailyBrief: v.boolean(),
  }),

  // Execution policies
  policies: v.object({
    // What modes are allowed per action type
    allowedModes: v.object({
      send_email: v.array(v.string()),    // e.g., ["suggest", "draft"]
      create_task: v.array(v.string()),   // e.g., ["execute"]
      update_crm: v.array(v.string()),
      schedule_meeting: v.array(v.string()),
      send_slack_message: v.array(v.string()),
      create_document: v.array(v.string()),
      add_calendar_block: v.array(v.string()),
    }),

    // Auto-approve thresholds
    autoApproveRiskLevel: v.union(
      v.literal("low"),                   // Auto-approve low risk only
      v.literal("medium"),                // Auto-approve low + medium
      v.literal("never"),                 // Never auto-approve
    ),
  }),

  // Delivery preferences
  delivery: v.object({
    preferredChannels: v.array(v.string()), // ["slack", "ntfy"]
    quietHours: v.optional(v.object({
      enabled: v.boolean(),
      start: v.string(),                  // "22:00"
      end: v.string(),                    // "07:00"
      timezone: v.string(),               // "America/New_York"
    })),
    maxDailyNotifications: v.number(),    // Rate limit
  }),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]);

/* ------------------------------------------------------------------ */
/* PROACTIVE FEEDBACK LABELS                                          */
/* ------------------------------------------------------------------ */
export const proactiveFeedbackLabels = defineTable({
  // Label identity
  labelId: v.string(),                    // UUID
  opportunityId: v.id("opportunities"),
  userId: v.id("users"),

  // Feedback type
  feedbackType: v.union(
    v.literal("useful"),
    v.literal("not_useful"),
    v.literal("wrong"),
    v.literal("timing_bad"),              // Right idea, wrong time
    v.literal("too_frequent"),            // Too many similar
    v.literal("missing_context"),         // Needed more info
  ),

  // Detailed feedback
  reason: v.optional(v.string()),         // Free text explanation
  specificIssues: v.optional(v.array(v.string())), // Checkboxes

  // Context at time of feedback
  contextSnapshot: v.optional(v.object({
    opportunityType: v.string(),
    riskLevel: v.string(),
    detectorName: v.string(),
    detectorVersion: v.string(),
  })),

  // Labeling status
  reviewed: v.boolean(),                  // Has ML team reviewed?
  reviewedAt: v.optional(v.number()),
  reviewNotes: v.optional(v.string()),

  // Timestamps
  createdAt: v.number(),
})
  .index("by_opportunity", ["opportunityId"])
  .index("by_user", ["userId", "createdAt"])
  .index("by_type", ["feedbackType", "createdAt"])
  .index("by_detector", ["contextSnapshot.detectorName", "feedbackType"])
  .index("by_reviewed", ["reviewed", "createdAt"]);

/* ------------------------------------------------------------------ */
/* CUSTOM DETECTORS (Premium Feature)                                 */
/* ------------------------------------------------------------------ */
export const customDetectors = defineTable({
  // Identity
  detectorId: v.string(),                 // UUID
  userId: v.id("users"),                  // Owner
  name: v.string(),                       // User-defined name
  description: v.optional(v.string()),    // Optional description
  icon: v.optional(v.string()),           // Emoji icon

  // Trigger configuration
  triggerType: v.union(
    v.literal("event"),                   // Event-based trigger
    v.literal("schedule"),                // Time-based (cron)
    v.literal("threshold"),               // Metric threshold
  ),

  // Event trigger config
  eventTrigger: v.optional(v.object({
    eventType: v.string(),                // Which event type to monitor
    keywords: v.optional(v.array(v.string())),
    entityFilter: v.optional(v.object({
      entityType: v.string(),
      scope: v.union(
        v.literal("watchlist"),
        v.literal("all"),
        v.literal("specific_ids"),
      ),
      entityIds: v.optional(v.array(v.string())),
    })),
    sourcesFilter: v.optional(v.array(v.string())),
  })),

  // Schedule trigger config
  scheduleTrigger: v.optional(v.object({
    cronExpression: v.string(),           // e.g., "0 9 * * 1" (every Monday 9am)
    timezone: v.string(),                 // e.g., "America/New_York"
  })),

  // Threshold trigger config
  thresholdTrigger: v.optional(v.object({
    metric: v.string(),                   // e.g., "entity_freshness"
    operator: v.union(
      v.literal("gt"),                    // Greater than
      v.literal("lt"),                    // Less than
      v.literal("eq"),                    // Equals
    ),
    value: v.number(),
    checkInterval: v.string(),            // Cron expression for checking
  })),

  // Additional conditions (AND logic)
  conditions: v.optional(v.array(v.object({
    field: v.string(),                    // e.g., "funding_amount"
    operator: v.string(),                 // "gt", "lt", "eq", "contains"
    value: v.any(),                       // Comparison value
  }))),

  // Actions to take when triggered
  actions: v.array(v.object({
    actionType: v.string(),               // "send_notification", "create_task", etc.
    config: v.any(),                      // Action-specific configuration
    template: v.optional(v.string()),     // Message template with variables
  })),

  // Rate limiting
  rateLimit: v.optional(v.object({
    maxPerDay: v.optional(v.number()),
    maxPerWeek: v.optional(v.number()),
    deduplicateWindow: v.optional(v.number()), // ms
  })),

  // Settings
  priority: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
  respectQuietHours: v.boolean(),
  deduplicate: v.boolean(),

  // Status
  status: v.union(
    v.literal("draft"),                   // Not yet enabled
    v.literal("active"),                  // Running
    v.literal("paused"),                  // Temporarily disabled
    v.literal("error"),                   // Configuration error
  ),
  errorMessage: v.optional(v.string()),

  // Stats
  triggerCount: v.number(),               // Total times triggered
  lastTriggeredAt: v.optional(v.number()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_triggerType", ["triggerType"]);

/* ------------------------------------------------------------------ */
/* ADMIN USERS (Invite-Only)                                          */
/* ------------------------------------------------------------------ */
export const adminUsers = defineTable({
  userId: v.id("users"),
  email: v.string(),
  role: v.union(
    v.literal("owner"),                   // hshum2018@gmail.com
    v.literal("admin"),                   // Full access
    v.literal("viewer"),                  // Read-only
  ),
  permissions: v.array(v.string()),       // ["view_feedback", "view_analytics", etc.]
  invitedBy: v.optional(v.id("users")),
  createdAt: v.number(),
})
  .index("by_email", ["email"])
  .index("by_userId", ["userId"]);

/* ------------------------------------------------------------------ */
/* PROACTIVE SUBSCRIPTIONS (Stripe Billing)                           */
/* ------------------------------------------------------------------ */
export const proactiveSubscriptions = defineTable({
  userId: v.id("users"),
  tier: v.union(
    v.literal("free"),
    v.literal("paid"),
    v.literal("enterprise"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("cancelled"),
    v.literal("past_due"),
    v.literal("trialing"),
  ),
  stripeSubscriptionId: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),
  currentPeriodStart: v.number(),
  currentPeriodEnd: v.number(),
  cancelAtPeriodEnd: v.boolean(),
  trialEndsAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_stripe_customer", ["stripeCustomerId"])
  .index("by_status", ["status"]);

/* ------------------------------------------------------------------ */
/* USAGE TRACKING (Quota Enforcement)                                 */
/* ------------------------------------------------------------------ */
export const usageTracking = defineTable({
  userId: v.id("users"),
  month: v.string(),                      // "2026-01" format
  proactiveNotifications: v.number(),     // Count for the month
  customDetectorsUsed: v.number(),
  apiCallsMade: v.number(),
  lastResetAt: v.number(),
})
  .index("by_user_month", ["userId", "month"]);

/* ------------------------------------------------------------------ */
/* USER CONSENTS (Blanket Consent)                                    */
/* ------------------------------------------------------------------ */
export const userConsents = defineTable({
  userId: v.id("users"),
  consentType: v.literal("proactive_features"),
  granted: v.boolean(),
  grantedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  ipAddress: v.optional(v.string()),      // For audit
  userAgent: v.optional(v.string()),      // For audit
  version: v.string(),                    // Terms version accepted
})
  .index("by_user", ["userId"])
  .index("by_user_type", ["userId", "consentType"]);
