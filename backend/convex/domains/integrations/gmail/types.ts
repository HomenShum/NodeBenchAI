import { z } from "zod";

/**
 * EmailIntelligence Schema
 *
 * Structured output for email intelligence extraction.
 * Used by the agent to understand email content and recommend actions.
 */

// Email classification types
export const EmailClassification = z.enum([
  "meeting_invite",      // Calendar event with attendees
  "deadline_reminder",   // Task with due date
  "document_share",      // Attachment or link to review
  "event_notification",  // External event (conference, webinar)
  "action_required",     // Needs response/action
  "fyi_informational",   // No action needed
  "newsletter",          // Periodic digest
  "receipt_confirmation" // Transaction confirmation
]);

export type EmailClassification = z.infer<typeof EmailClassification>;

// Temporal extraction schema
export const TemporalSchema = z.object({
  hasDateTime: z.boolean(),
  startTime: z.number().optional(),      // epoch ms
  endTime: z.number().optional(),
  isAllDay: z.boolean().default(false),
  timezone: z.string().optional(),       // IANA timezone
  recurrence: z.string().optional(),     // RRULE
  deadlineType: z.enum(["hard", "soft", "none"]).default("none")
});

export type Temporal = z.infer<typeof TemporalSchema>;

// Event-specific extraction
export const EventExtractionSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  attendees: z.array(z.object({
    email: z.string(),
    name: z.string().optional(),
    role: z.enum(["organizer", "required", "optional"]).default("required")
  })).optional(),
  conferenceLink: z.string().optional(),  // Zoom, Meet, Teams
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("tentative")
}).optional();

export type EventExtraction = z.infer<typeof EventExtractionSchema>;

// Document-specific extraction
export const DocumentExtractionSchema = z.object({
  hasAttachment: z.boolean(),
  attachmentType: z.enum(["pdf", "doc", "spreadsheet", "image", "ics", "other"]).optional(),
  linkedUrls: z.array(z.string()).optional(),
  requiresReview: z.boolean().default(false),
  suggestedDocTitle: z.string().optional()
}).optional();

export type DocumentExtraction = z.infer<typeof DocumentExtractionSchema>;

// Action recommendation
export const ActionRecommendationSchema = z.object({
  type: z.enum(["create_event", "create_task", "create_document", "link_to_existing", "ignore"]),
  priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

export type ActionRecommendation = z.infer<typeof ActionRecommendationSchema>;

// Source metadata
export const EmailMetaSchema = z.object({
  from: z.string(),
  subject: z.string(),
  receivedAt: z.number(),
  importance: z.enum(["high", "normal", "low"]).default("normal"),
  isReply: z.boolean().default(false),
  extractedAt: z.number()
});

export type EmailMeta = z.infer<typeof EmailMetaSchema>;

// Main EmailIntelligence schema
export const EmailIntelligenceSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  classification: EmailClassification,
  temporal: TemporalSchema,
  event: EventExtractionSchema,
  document: DocumentExtractionSchema,
  actions: z.array(ActionRecommendationSchema),
  meta: EmailMetaSchema
});

export type EmailIntelligence = z.infer<typeof EmailIntelligenceSchema>;

// Minimal schema for MVP extraction (just meetings + deadlines)
export const EmailIntelligenceMVPSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  classification: z.enum(["meeting_invite", "deadline_reminder", "other"]),
  temporal: z.object({
    hasDateTime: z.boolean(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    isAllDay: z.boolean().default(false),
  }),
  event: z.object({
    title: z.string(),
    location: z.string().optional(),
    conferenceLink: z.string().optional(),
  }).optional(),
  confidence: z.number().min(0).max(1),
  meta: z.object({
    from: z.string(),
    subject: z.string(),
    receivedAt: z.number(),
  })
});

export type EmailIntelligenceMVP = z.infer<typeof EmailIntelligenceMVPSchema>;

// Convex-compatible validators (for use in Convex functions)
import { v } from "convex/values";

export const emailIntelligenceValidator = v.object({
  messageId: v.string(),
  threadId: v.string(),
  classification: v.union(
    v.literal("meeting_invite"),
    v.literal("deadline_reminder"),
    v.literal("document_share"),
    v.literal("event_notification"),
    v.literal("action_required"),
    v.literal("fyi_informational"),
    v.literal("newsletter"),
    v.literal("receipt_confirmation")
  ),
  temporal: v.object({
    hasDateTime: v.boolean(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    isAllDay: v.optional(v.boolean()),
    timezone: v.optional(v.string()),
    recurrence: v.optional(v.string()),
    deadlineType: v.optional(v.union(v.literal("hard"), v.literal("soft"), v.literal("none")))
  }),
  event: v.optional(v.object({
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.object({
      email: v.string(),
      name: v.optional(v.string()),
      role: v.optional(v.union(v.literal("organizer"), v.literal("required"), v.literal("optional")))
    }))),
    conferenceLink: v.optional(v.string()),
    status: v.optional(v.union(v.literal("confirmed"), v.literal("tentative"), v.literal("cancelled")))
  })),
  document: v.optional(v.object({
    hasAttachment: v.boolean(),
    attachmentType: v.optional(v.union(
      v.literal("pdf"), v.literal("doc"), v.literal("spreadsheet"),
      v.literal("image"), v.literal("ics"), v.literal("other")
    )),
    linkedUrls: v.optional(v.array(v.string())),
    requiresReview: v.optional(v.boolean()),
    suggestedDocTitle: v.optional(v.string())
  })),
  actions: v.array(v.object({
    type: v.union(
      v.literal("create_event"), v.literal("create_task"),
      v.literal("create_document"), v.literal("link_to_existing"), v.literal("ignore")
    ),
    priority: v.optional(v.union(v.literal("urgent"), v.literal("high"), v.literal("medium"), v.literal("low"))),
    confidence: v.number(),
    reasoning: v.string()
  })),
  meta: v.object({
    from: v.string(),
    subject: v.string(),
    receivedAt: v.number(),
    importance: v.optional(v.union(v.literal("high"), v.literal("normal"), v.literal("low"))),
    isReply: v.optional(v.boolean()),
    extractedAt: v.number()
  })
});
