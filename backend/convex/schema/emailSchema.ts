/**
 * Email Schema - Tables for comprehensive email management
 *
 * Features:
 * - Email threads with full conversation history
 * - AI-powered categorization and grouping
 * - Daily email reports with nested structure
 * - Email labels and status tracking
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ------------------------------------------------------------------
// Email Labels - User-defined or AI-generated labels
// ------------------------------------------------------------------
export const emailLabels = defineTable({
  userId: v.id("users"),
  name: v.string(),                                    // "Work", "Personal", "Finance", etc.
  color: v.optional(v.string()),                       // Hex color for UI
  isSystem: v.boolean(),                               // System labels (Inbox, Sent, etc.)
  isAiGenerated: v.boolean(),                          // Created by AI categorization
  emailCount: v.number(),                              // Count of emails with this label
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_name", ["userId", "name"]);

// ------------------------------------------------------------------
// Email Threads - Conversation threads
// ------------------------------------------------------------------
export const emailThreads = defineTable({
  userId: v.id("users"),
  gmailThreadId: v.string(),                           // Gmail thread ID
  subject: v.string(),
  snippet: v.optional(v.string()),                     // Preview text
  participants: v.array(v.string()),                   // All email addresses involved
  messageCount: v.number(),
  unreadCount: v.number(),
  hasAttachments: v.boolean(),

  // Labels and categorization
  labelIds: v.array(v.id("emailLabels")),
  aiCategory: v.optional(v.string()),                  // AI-assigned category
  aiPriority: v.optional(v.union(                      // AI-assigned priority
    v.literal("urgent"),
    v.literal("high"),
    v.literal("normal"),
    v.literal("low")
  )),
  aiSummary: v.optional(v.string()),                   // AI-generated thread summary
  aiActionRequired: v.optional(v.boolean()),           // Does this need action?
  aiActionSuggestion: v.optional(v.string()),          // Suggested action

  // Status
  status: v.union(
    v.literal("inbox"),
    v.literal("archived"),
    v.literal("trash"),
    v.literal("spam")
  ),
  isStarred: v.boolean(),
  isImportant: v.boolean(),

  // Timestamps
  lastMessageAt: v.number(),                           // Most recent message timestamp
  firstMessageAt: v.number(),                          // Thread start timestamp
  lastSyncedAt: v.number(),                            // Last Gmail sync
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_user_last_message", ["userId", "lastMessageAt"])
  .index("by_gmail_thread", ["userId", "gmailThreadId"])
  .index("by_user_category", ["userId", "aiCategory"])
  .index("by_user_priority", ["userId", "aiPriority"]);

// ------------------------------------------------------------------
// Email Messages - Individual messages within threads
// ------------------------------------------------------------------
export const emailMessages = defineTable({
  userId: v.id("users"),
  threadId: v.id("emailThreads"),
  gmailMessageId: v.string(),                          // Gmail message ID

  // Headers
  from: v.string(),                                    // Sender email
  fromName: v.optional(v.string()),                    // Sender display name
  to: v.array(v.string()),                             // Recipients
  cc: v.optional(v.array(v.string())),
  bcc: v.optional(v.array(v.string())),
  replyTo: v.optional(v.string()),

  // Content
  subject: v.string(),
  snippet: v.optional(v.string()),
  bodyPlain: v.optional(v.string()),                   // Plain text body
  bodyHtml: v.optional(v.string()),                    // HTML body

  // Attachments
  hasAttachments: v.boolean(),
  attachments: v.optional(v.array(v.object({
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    attachmentId: v.string(),
  }))),

  // Status
  isRead: v.boolean(),
  isStarred: v.boolean(),

  // Timestamps
  internalDate: v.number(),                            // Gmail internal date
  receivedAt: v.number(),                              // When we received it
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_thread", ["threadId"])
  .index("by_user", ["userId"])
  .index("by_gmail_message", ["userId", "gmailMessageId"])
  .index("by_user_date", ["userId", "internalDate"]);

// ------------------------------------------------------------------
// Email Daily Reports - End of day summaries
// ------------------------------------------------------------------
export const emailDailyReports = defineTable({
  userId: v.id("users"),
  date: v.string(),                                    // "2024-01-15" format

  // Statistics
  totalReceived: v.number(),
  totalSent: v.number(),
  totalUnread: v.number(),
  totalActionRequired: v.number(),

  // Groupings with nested structure
  groupings: v.array(v.object({
    category: v.string(),                              // "Work", "Finance", "Personal", etc.
    count: v.number(),
    threads: v.array(v.object({
      threadId: v.id("emailThreads"),
      subject: v.string(),
      from: v.string(),
      status: v.string(),                              // "unread", "read", "replied", "action_needed"
      priority: v.optional(v.string()),
      summary: v.optional(v.string()),
      lastMessageAt: v.number(),
    })),
    subCategories: v.optional(v.array(v.object({       // Nested sub-categories
      name: v.string(),
      count: v.number(),
      threads: v.array(v.object({
        threadId: v.id("emailThreads"),
        subject: v.string(),
        from: v.string(),
        status: v.string(),
      })),
    }))),
  })),

  // AI-generated insights
  executiveSummary: v.optional(v.string()),
  keyHighlights: v.optional(v.array(v.string())),
  suggestedActions: v.optional(v.array(v.object({
    action: v.string(),
    threadId: v.optional(v.id("emailThreads")),
    priority: v.string(),
  }))),

  // Delivery status
  deliveredVia: v.optional(v.array(v.string())),       // ["email", "ntfy"]
  deliveredAt: v.optional(v.number()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_date", ["userId", "date"]);

// ------------------------------------------------------------------
// Email Processing Queue - For async email processing
// ------------------------------------------------------------------
export const emailProcessingQueue = defineTable({
  userId: v.id("users"),
  gmailMessageId: v.string(),
  gmailThreadId: v.string(),

  // Processing status
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed")
  ),

  // Processing type
  processType: v.union(
    v.literal("categorize"),
    v.literal("summarize"),
    v.literal("extract_action"),
    v.literal("full_analysis")
  ),

  // Results
  result: v.optional(v.any()),
  error: v.optional(v.string()),

  // Retry tracking
  attempts: v.number(),
  lastAttemptAt: v.optional(v.number()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status", ["status"])
  .index("by_user", ["userId"])
  .index("by_gmail_message", ["gmailMessageId"]);

// ------------------------------------------------------------------
// Email Sync State - Track Gmail sync progress
// ------------------------------------------------------------------
export const emailSyncState = defineTable({
  userId: v.id("users"),
  lastHistoryId: v.optional(v.string()),               // Gmail history ID
  lastFullSyncAt: v.optional(v.number()),              // Last full sync timestamp
  lastIncrementalSyncAt: v.optional(v.number()),       // Last incremental sync
  syncStatus: v.union(
    v.literal("idle"),
    v.literal("syncing"),
    v.literal("error")
  ),
  lastError: v.optional(v.string()),
  totalThreadsSynced: v.number(),
  totalMessagesSynced: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]);
