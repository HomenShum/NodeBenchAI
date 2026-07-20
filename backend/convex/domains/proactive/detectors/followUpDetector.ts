/**
 * Follow-Up Nudge Detector
 * Identifies emails/messages that need responses and creates follow-up reminders
 *
 * Detection Logic:
 * - Inbound emails from the last 3-7 days
 * - No reply sent from the user
 * - Contains question marks or action items
 * - From important contacts (frequent communication, in calendar events)
 * - Not automated/newsletter emails
 *
 * Trigger: Runs twice daily (9 AM and 2 PM)
 */

import { BatchDetector } from "./BaseDetector";
import {
  DetectorMetadata,
  DetectorContext,
  DetectedOpportunity,
} from "./types";
import { Id } from "../../../_generated/dataModel";

export class FollowUpDetector extends BatchDetector {
  readonly metadata: DetectorMetadata = {
    detectorId: "follow_up_nudge_v1",
    name: "Follow-Up Reminders",
    description: "Detects emails that need responses and creates follow-up reminders",
    version: "1.0.0",
    mode: "batch",
    schedule: {
      cron: "0 9,14 * * *", // 9 AM and 2 PM daily
    },
    eventTypes: ["email_received", "email_sent"],
    tier: "free",
    enabled: true,
  };

  async processBatch(
    events: NonNullable<DetectorContext["event"]>[],
    ctx: DetectorContext
  ): Promise<DetectedOpportunity[]> {
    const opportunities: DetectedOpportunity[] = [];

    // Get time windows
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Separate received and sent emails
    const receivedEmails = events.filter(
      (e) =>
        e.eventType === "email_received" &&
        e.timestamp >= sevenDaysAgo &&
        e.timestamp <= threeDaysAgo
    );

    const sentEmails = events.filter(
      (e) => e.eventType === "email_sent" && e.timestamp >= sevenDaysAgo
    );

    console.log(
      `[FollowUpDetector] Analyzing ${receivedEmails.length} received emails, ${sentEmails.length} sent emails`
    );

    // For each received email, check if it needs a follow-up
    for (const email of receivedEmails) {
      const needsFollowUp = await this.checkNeedsFollowUp(
        email,
        sentEmails,
        ctx
      );

      if (needsFollowUp) {
        const opportunity = await this.createFollowUpOpportunity(email, ctx);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }

    console.log(
      `[FollowUpDetector] Found ${opportunities.length} follow-up opportunities`
    );

    return opportunities;
  }

  /**
   * Check if an email needs a follow-up
   */
  private async checkNeedsFollowUp(
    email: NonNullable<DetectorContext["event"]>,
    sentEmails: NonNullable<DetectorContext["event"]>[],
    ctx: DetectorContext
  ): Promise<boolean> {
    // 1. Check if user already replied
    const threadId = email.metadata?.threadId;
    if (threadId) {
      const hasReply = sentEmails.some(
        (sent) =>
          sent.metadata?.threadId === threadId &&
          sent.timestamp > email.timestamp
      );
      if (hasReply) {
        return false; // Already replied
      }
    }

    // 2. Get email content from artifact
    const artifact = email.contentPointer
      ? await ctx.db.get(email.contentPointer)
      : null;

    if (!artifact) {
      return false; // No content to analyze
    }

    const emailBody =
      artifact.textContent || artifact.metadata?.preview || "";
    const subject = artifact.metadata?.subject || "";

    // 3. Check if it's automated/newsletter (exclude these)
    if (this.isAutomatedEmail(emailBody, subject, artifact.metadata)) {
      return false;
    }

    // 4. Check if it needs a response (questions, requests, etc.)
    const needsResponse = this.detectNeedsResponse(emailBody, subject);
    if (!needsResponse) {
      return false;
    }

    // 5. Check sender importance
    const isImportant = await this.checkSenderImportance(email, ctx);
    if (!isImportant) {
      return false;
    }

    return true;
  }

  /**
   * Check if email is automated/newsletter
   */
  private isAutomatedEmail(
    body: string,
    subject: string,
    metadata: any
  ): boolean {
    const automatedIndicators = [
      /unsubscribe/i,
      /do not reply/i,
      /noreply@/i,
      /newsletter/i,
      /marketing@/i,
      /notification@/i,
      /automated message/i,
      /this is an automated/i,
    ];

    const text = `${subject} ${body}`.toLowerCase();
    return automatedIndicators.some((pattern) => pattern.test(text));
  }

  /**
   * Detect if email needs a response
   */
  private detectNeedsResponse(body: string, subject: string): boolean {
    const text = `${subject} ${body}`;

    // Check for questions
    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount >= 1) {
      return true;
    }

    // Check for action words
    const actionWords = [
      /can you/i,
      /could you/i,
      /would you/i,
      /please/i,
      /need you to/i,
      /waiting for/i,
      /let me know/i,
      /get back to me/i,
      /respond/i,
      /reply/i,
      /thoughts\?/i,
      /feedback/i,
      /your input/i,
      /your thoughts/i,
      /what do you think/i,
      /looking forward/i,
    ];

    return actionWords.some((pattern) => pattern.test(text));
  }

  /**
   * Check sender importance based on past interactions
   */
  private async checkSenderImportance(
    email: NonNullable<DetectorContext["event"]>,
    ctx: DetectorContext
  ): Promise<boolean> {
    const senderEntity = email.entities?.find(
      (e) => e.entityType === "email_address"
    );
    if (!senderEntity) {
      return false;
    }

    const senderEmail = senderEntity.entityId;

    // Count past interactions with this sender (last 90 days)
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const pastInteractions = await ctx.db
      .query("proactiveEvents")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("eventType"), "email_received"),
            q.eq(q.field("eventType"), "email_sent")
          ),
          q.gte(q.field("timestamp"), ninetyDaysAgo)
        )
      )
      .collect();

    const interactionsWithSender = pastInteractions.filter((event) =>
      event.entities?.some(
        (e) => e.entityType === "email_address" && e.entityId === senderEmail
      )
    );

    // Consider important if 3+ interactions in last 90 days
    if (interactionsWithSender.length >= 3) {
      return true;
    }

    // Check if sender appears in calendar events
    const calendarEvents = await ctx.db
      .query("proactiveEvents")
      .filter((q) =>
        q.and(
          q.eq(q.field("eventType"), "calendar_event_created"),
          q.gte(q.field("timestamp"), ninetyDaysAgo)
        )
      )
      .collect();

    const inCalendar = calendarEvents.some((event) =>
      event.entities?.some(
        (e) => e.entityType === "email_address" && e.entityId === senderEmail
      )
    );

    return inCalendar;
  }

  /**
   * Create follow-up opportunity
   */
  private async createFollowUpOpportunity(
    email: NonNullable<DetectorContext["event"]>,
    ctx: DetectorContext
  ): Promise<DetectedOpportunity | null> {
    const artifact = email.contentPointer
      ? await ctx.db.get(email.contentPointer)
      : null;

    if (!artifact) {
      return null;
    }

    const subject = artifact.metadata?.subject || "Untitled";
    const preview = artifact.metadata?.preview || "";
    const senderEntity = email.entities?.find(
      (e) => e.entityType === "email_address"
    );
    const senderEmail = senderEntity?.entityId || "Unknown";
    const senderName = senderEntity?.entityName || senderEmail;

    // Calculate days since received
    const daysSince = Math.floor(
      (Date.now() - email.timestamp) / (24 * 60 * 60 * 1000)
    );

    return this.createOpportunity({
      type: "follow_up",
      trigger: {
        eventIds: [email.eventId],
        whyNow: `"${subject}" from ${senderName} needs a response (${daysSince} days ago)`,
      },
      evidencePointers: [
        {
          artifactId: email.contentPointer as Id<"sourceArtifacts">,
          excerpt: preview.slice(0, 200),
          relevanceScore: 0.9,
        },
      ],
      impactEstimate: {
        timeSavedMinutes: 5,
        confidenceLevel: 0.85,
      },
      riskLevel: "low",
      suggestedActions: [
        {
          actionType: "suggest",
          description: `Reply to "${subject}" from ${senderName}`,
          config: {
            emailMessageId: artifact._id,
            subject,
            senderEmail,
            senderName,
            receivedAt: email.timestamp,
            threadId: email.metadata?.threadId,
          },
        },
      ],
      metadata: {
        priority: daysSince >= 5 ? "high" : "medium",
        daysSinceReceived: daysSince,
        senderEmail,
        senderName,
      },
    });
  }
}

// Export singleton instance
export const followUpDetector = new FollowUpDetector();
