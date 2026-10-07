/**
 * Email Event Adapter
 * Converts Gmail events to unified proactive events
 *
 * Features:
 * - Ingests email_received and email_sent events
 * - Extracts entities (people, companies, topics)
 * - Applies sensitivity classification
 * - Deduplicates via content hash
 * - Links to sourceArtifacts for full content
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../../_generated/dataModel";

/**
 * Create proactive event from email
 */
export const createEmailEvent = internalMutation({
  args: {
    // Email metadata
    emailMessageId: v.id("emailMessages"),
    emailThreadId: v.string(),
    userId: v.id("users"),
    eventType: v.union(v.literal("email_received"), v.literal("email_sent")),

    // Event metadata
    timestamp: v.number(), // When email was sent/received

    // Actor (sender or recipient)
    actor: v.object({
      email: v.string(),
      name: v.optional(v.string()),
    }),

    // Content summary
    subject: v.string(),
    preview: v.optional(v.string()), // First 500 chars

    // Source artifact
    sourceArtifactId: v.optional(v.id("sourceArtifacts")),

    // Extracted entities
    entities: v.optional(
      v.array(
        v.object({
          entityId: v.string(),
          entityType: v.string(),
          entityName: v.string(),
          confidence: v.number(),
          mentionContext: v.optional(v.string()),
        })
      )
    ),

    // Sensitivity flags
    hasPII: v.optional(v.boolean()),
    hasFinancial: v.optional(v.boolean()),
    hasConfidential: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Generate event ID and content hash
    const eventId = `email_${args.emailThreadId}_${args.timestamp}`;
    const contentHash = await generateContentHash({
      subject: args.subject,
      preview: args.preview || "",
      timestamp: args.timestamp,
    });

    // Check for duplicate
    const existing = await ctx.db
      .query("proactiveEvents")
      .withIndex("by_contentHash", (q) => q.eq("contentHash", contentHash))
      .first();

    if (existing) {
      console.log(`[emailEventAdapter] Skipping duplicate event: ${eventId}`);
      return { eventId: existing.eventId, skipped: true };
    }

    // Determine retention class based on sensitivity
    const hasSensitiveContent =
      args.hasPII || args.hasFinancial || args.hasConfidential;
    const retentionClass = hasSensitiveContent ? "standard" : "extended";

    // Calculate expiry date
    const retentionDays = retentionClass === "standard" ? 90 : 365;
    const expiresAt = args.timestamp + retentionDays * 24 * 60 * 60 * 1000;

    // Create proactive event
    const proactiveEventId = await ctx.db.insert("proactiveEvents", {
      eventId,
      timestamp: args.timestamp,
      eventType: args.eventType,
      source: "gmail",
      sourceId: args.emailThreadId,
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${args.emailThreadId}`,

      actor: {
        email: args.actor.email,
        name: args.actor.name,
      },

      contentPointer: args.sourceArtifactId,
      contentHash,
      summary: `${args.subject}${args.preview ? ` - ${args.preview.slice(0, 200)}` : ""}`,

      entities: args.entities,

      sensitivity: {
        hasPII: args.hasPII ?? false,
        hasFinancial: args.hasFinancial ?? false,
        hasConfidential: args.hasConfidential ?? false,
        retentionClass,
      },

      processingStatus: "pending",
      extractionConfidence: args.entities ? 0.8 : 0.5,
      sourceQuality: "high", // Gmail is a verified source

      expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`[emailEventAdapter] Created proactive event: ${eventId}`);

    return {
      eventId,
      proactiveEventId,
      skipped: false,
    };
  },
});

/**
 * Bulk ingest emails (for batch processing)
 */
export const batchIngestEmails = internalMutation({
  args: {
    userId: v.id("users"),
    since: v.optional(v.number()), // Timestamp to start from
    limit: v.optional(v.number()), // Max emails to process
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const since = args.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // Default: last 7 days

    // Fetch recent emails
    const emails = await ctx.db
      .query("emailMessages")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.gte(q.field("receivedAt"), since)
        )
      )
      .order("desc")
      .take(limit);

    console.log(`[emailEventAdapter] Batch ingesting ${emails.length} emails for user ${args.userId}`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const email of emails) {
      try {
        // Extract entities from email (simplified - in production, use NER)
        const entities = extractEntitiesFromEmail(email);

        // Classify sensitivity
        const { hasPII, hasFinancial, hasConfidential } = classifySensitivity(email);

        // Determine event type
        const eventType = email.from === args.userId ? "email_sent" : "email_received";

        // Find or create source artifact
        const sourceArtifactId = await findOrCreateSourceArtifact(ctx, email);

        // Create proactive event
        const result = await createEmailEvent(ctx, {
          emailMessageId: email._id,
          emailThreadId: email.threadId,
          userId: args.userId,
          eventType,
          timestamp: email.receivedAt,
          actor: {
            email: email.from,
            name: email.fromName,
          },
          subject: email.subject,
          preview: email.snippet,
          sourceArtifactId,
          entities,
          hasPII,
          hasFinancial,
          hasConfidential,
        });

        if (result.skipped) {
          skipped++;
        } else {
          created++;
        }
      } catch (error: any) {
        console.error(`[emailEventAdapter] Error processing email ${email._id}:`, error.message);
        errors++;
      }
    }

    return {
      success: true,
      processed: emails.length,
      created,
      skipped,
      errors,
    };
  },
});

// Helper functions

function extractEntitiesFromEmail(email: any): Array<{
  entityId: string;
  entityType: string;
  entityName: string;
  confidence: number;
  mentionContext?: string;
}> {
  const entities: any[] = [];

  // Extract people from sender/recipients
  if (email.from) {
    entities.push({
      entityId: `person_${email.from}`,
      entityType: "person",
      entityName: email.fromName || email.from,
      confidence: 1.0,
      mentionContext: "Email sender",
    });
  }

  // TODO: Extract companies, topics using NER
  // For now, return basic entities
  return entities;
}

function classifySensitivity(email: any): {
  hasPII: boolean;
  hasFinancial: boolean;
  hasConfidential: boolean;
} {
  const content = `${email.subject} ${email.snippet || ""}`.toLowerCase();

  // Simple keyword-based classification (in production, use ML)
  const hasPII =
    content.includes("ssn") ||
    content.includes("social security") ||
    content.includes("passport") ||
    content.includes("driver license");

  const hasFinancial =
    content.includes("$") ||
    content.includes("payment") ||
    content.includes("invoice") ||
    content.includes("bank account") ||
    content.includes("wire transfer");

  const hasConfidential =
    content.includes("confidential") ||
    content.includes("nda") ||
    content.includes("proprietary") ||
    content.includes("internal only");

  return { hasPII, hasFinancial, hasConfidential };
}

async function findOrCreateSourceArtifact(
  ctx: any,
  email: any
): Promise<Id<"sourceArtifacts"> | undefined> {
  // Check if artifact already exists
  const existing = await ctx.db
    .query("sourceArtifacts")
    .filter((q) =>
      q.and(
        q.eq(q.field("source"), "gmail"),
        q.eq(q.field("externalId"), email.messageId)
      )
    )
    .first();

  if (existing) {
    return existing._id;
  }

  // Create new artifact (simplified - in production, store full email content)
  try {
    const artifactId = await ctx.db.insert("sourceArtifacts", {
      userId: email.userId,
      source: "gmail",
      sourceType: "email",
      externalId: email.messageId,
      url: `https://mail.google.com/mail/u/0/#inbox/${email.threadId}`,
      title: email.subject,
      content: email.textContent || email.snippet || "",
      metadata: {
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        date: email.receivedAt,
        threadId: email.threadId,
      },
      createdAt: email.receivedAt,
      lastSyncedAt: Date.now(),
    });

    return artifactId;
  } catch (error) {
    console.error("[emailEventAdapter] Error creating source artifact:", error);
    return undefined;
  }
}

async function generateContentHash(data: {
  subject: string;
  preview: string;
  timestamp: number;
}): Promise<string> {
  // Simple hash function (in production, use SHA-256)
  const content = `${data.subject}${data.preview}${Math.floor(data.timestamp / 60000)}`; // Round to minute
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `email_${Math.abs(hash).toString(36)}`;
}
