/**
 * Daily Brief Detector
 * Generates morning digest of the day's activities and priorities
 *
 * Detection Logic:
 * - Run once daily at 7 AM (user's timezone)
 * - Collect today's calendar events
 * - Identify urgent emails from last 24 hours
 * - Surface overdue follow-ups
 * - Highlight important contacts/meetings
 *
 * Trigger: Once daily at 7 AM
 */

import { BatchDetector } from "./BaseDetector";
import {
  DetectorMetadata,
  DetectorContext,
  DetectedOpportunity,
} from "./types";
import { Id } from "../../../_generated/dataModel";

interface BriefSection {
  type: "meetings" | "emails" | "followUps" | "priorities";
  title: string;
  items: Array<{
    title: string;
    description: string;
    time?: string;
    priority?: "high" | "medium" | "low";
    artifactId?: Id<"sourceArtifacts">;
  }>;
}

export class DailyBriefDetector extends BatchDetector {
  readonly metadata: DetectorMetadata = {
    detectorId: "daily_brief_v1",
    name: "Daily Brief",
    description: "Morning digest of today's meetings, emails, and priorities",
    version: "1.0.0",
    mode: "batch",
    schedule: {
      cron: "0 7 * * *", // 7 AM daily
    },
    eventTypes: ["calendar_event_created", "email_received", "email_sent"],
    tier: "free",
    enabled: true,
  };

  async processBatch(
    events: NonNullable<DetectorContext["event"]>[],
    ctx: DetectorContext
  ): Promise<DetectedOpportunity[]> {
    const opportunities: DetectedOpportunity[] = [];

    // Get today's boundaries (in user's timezone)
    const now = Date.now();
    const todayStart = this.getStartOfDay(now);
    const todayEnd = this.getEndOfDay(now);

    console.log(
      `[DailyBriefDetector] Generating brief for ${new Date(todayStart).toISOString()} to ${new Date(todayEnd).toISOString()}`
    );

    // Build brief sections
    const sections: BriefSection[] = [];

    // 1. Today's meetings
    const meetingsSection = await this.buildMeetingsSection(
      events,
      todayStart,
      todayEnd,
      ctx
    );
    if (meetingsSection.items.length > 0) {
      sections.push(meetingsSection);
    }

    // 2. Urgent emails (last 24 hours)
    const emailsSection = await this.buildEmailsSection(
      events,
      now - 24 * 60 * 60 * 1000,
      now,
      ctx
    );
    if (emailsSection.items.length > 0) {
      sections.push(emailsSection);
    }

    // 3. Overdue follow-ups
    const followUpsSection = await this.buildFollowUpsSection(events, now, ctx);
    if (followUpsSection.items.length > 0) {
      sections.push(followUpsSection);
    }

    // 4. Priorities/action items
    const prioritiesSection = await this.buildPrioritiesSection(
      events,
      todayStart,
      todayEnd,
      ctx
    );
    if (prioritiesSection.items.length > 0) {
      sections.push(prioritiesSection);
    }

    // Only create brief if there's something to report
    if (sections.length === 0) {
      console.log("[DailyBriefDetector] No content for daily brief");
      return opportunities;
    }

    // Create opportunity
    const briefSummary = this.generateBriefSummary(sections);
    const eventIds = this.collectEventIds(events, todayStart, todayEnd);

    const opportunity = this.createOpportunity({
      type: "daily_brief",
      trigger: {
        eventIds: eventIds.slice(0, 10), // Limit to 10 events
        whyNow: `Good morning! Here's your daily brief for ${this.formatDate(todayStart)}`,
      },
      evidencePointers: this.collectEvidencePointers(sections),
      impactEstimate: {
        timeSavedMinutes: 15,
        confidenceLevel: 0.9,
      },
      riskLevel: "low",
      suggestedActions: [
        {
          actionType: "suggest",
          description: "Review your daily brief",
          config: {
            sections,
            summary: briefSummary,
            date: todayStart,
          },
        },
      ],
      metadata: {
        priority: "high",
        sectionsCount: sections.length,
        meetingsCount: meetingsSection.items.length,
        emailsCount: emailsSection.items.length,
        followUpsCount: followUpsSection.items.length,
      },
    });

    opportunities.push(opportunity);
    console.log("[DailyBriefDetector] Created daily brief opportunity");

    return opportunities;
  }

  /**
   * Build meetings section
   */
  private async buildMeetingsSection(
    events: NonNullable<DetectorContext["event"]>[],
    todayStart: number,
    todayEnd: number,
    ctx: DetectorContext
  ): Promise<BriefSection> {
    const meetingEvents = events.filter((e) => {
      const meetingTime = e.metadata?.startTime || e.timestamp;
      return (
        e.eventType === "calendar_event_created" &&
        meetingTime >= todayStart &&
        meetingTime <= todayEnd
      );
    });

    // Sort by time
    meetingEvents.sort((a, b) => {
      const timeA = a.metadata?.startTime || a.timestamp;
      const timeB = b.metadata?.startTime || b.timestamp;
      return timeA - timeB;
    });

    const items = meetingEvents.map((event) => {
      const startTime = event.metadata?.startTime || event.timestamp;
      const title = event.summary || "Untitled Meeting";
      const attendees = event.entities?.filter((e) => e.entityType === "email_address") || [];

      return {
        title,
        description: `${attendees.length} attendee${attendees.length !== 1 ? "s" : ""}`,
        time: this.formatTime(startTime),
        priority: this.assessMeetingPriority(event),
      };
    });

    return {
      type: "meetings",
      title: `Today's Meetings (${items.length})`,
      items,
    };
  }

  /**
   * Build urgent emails section
   */
  private async buildEmailsSection(
    events: NonNullable<DetectorContext["event"]>[],
    startTime: number,
    endTime: number,
    ctx: DetectorContext
  ): Promise<BriefSection> {
    const emailEvents = events.filter(
      (e) =>
        e.eventType === "email_received" &&
        e.timestamp >= startTime &&
        e.timestamp <= endTime
    );

    // Filter for "important" emails
    const importantEmails: Array<{
      title: string;
      description: string;
      time: string;
      priority: "high" | "medium" | "low";
      artifactId: Id<"sourceArtifacts">;
    }> = [];

    for (const email of emailEvents) {
      const artifact = email.contentPointer
        ? await ctx.db.get(email.contentPointer)
        : null;

      if (artifact && this.isImportantEmail(artifact, email)) {
        const subject = artifact.metadata?.subject || "No subject";
        const sender = email.entities?.find((e) => e.entityType === "email_address");

        importantEmails.push({
          title: subject,
          description: `From: ${sender?.entityName || sender?.entityId || "Unknown"}`,
          time: this.formatTime(email.timestamp),
          priority: this.assessEmailPriority(artifact, email),
          artifactId: artifact._id,
        });
      }
    }

    // Sort by priority and limit to top 5
    importantEmails.sort((a, b) => {
      const priorityOrder: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return {
      type: "emails",
      title: `Important Emails (${importantEmails.length})`,
      items: importantEmails.slice(0, 5),
    };
  }

  /**
   * Build follow-ups section
   */
  private async buildFollowUpsSection(
    events: NonNullable<DetectorContext["event"]>[],
    now: number,
    ctx: DetectorContext
  ): Promise<BriefSection> {
    // Get emails from 3-7 days ago that might need follow-up
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const oldEmails = events.filter(
      (e) =>
        e.eventType === "email_received" &&
        e.timestamp >= sevenDaysAgo &&
        e.timestamp <= threeDaysAgo
    );

    const recentSent = events.filter(
      (e) => e.eventType === "email_sent" && e.timestamp >= sevenDaysAgo
    );

    // Find emails without replies
    const needsFollowUp: Array<{
      title: string;
      description: string;
      priority: "high" | "medium" | "low";
      artifactId: Id<"sourceArtifacts">;
    }> = [];

    for (const email of oldEmails) {
      const threadId = email.metadata?.threadId;
      if (threadId) {
        const hasReply = recentSent.some(
          (sent) =>
            sent.metadata?.threadId === threadId &&
            sent.timestamp > email.timestamp
        );
        if (!hasReply) {
          const artifact = email.contentPointer
            ? await ctx.db.get(email.contentPointer)
            : null;
          if (artifact) {
            const subject = artifact.metadata?.subject || "No subject";
            const sender = email.entities?.find((e) => e.entityType === "email_address");
            const daysAgo = Math.floor((now - email.timestamp) / (24 * 60 * 60 * 1000));

            needsFollowUp.push({
              title: subject,
              description: `From: ${sender?.entityName || "Unknown"} (${daysAgo} days ago)`,
              priority: (daysAgo >= 5 ? "high" : "medium") as "high" | "medium" | "low",
              artifactId: artifact._id,
            });
          }
        }
      }
    }

    return {
      type: "followUps",
      title: `Pending Follow-Ups (${needsFollowUp.length})`,
      items: needsFollowUp.slice(0, 5),
    };
  }

  /**
   * Build priorities section
   */
  private async buildPrioritiesSection(
    events: NonNullable<DetectorContext["event"]>[],
    todayStart: number,
    todayEnd: number,
    ctx: DetectorContext
  ): Promise<BriefSection> {
    const items: Array<{
      title: string;
      description: string;
      priority: "high" | "medium" | "low";
    }> = [];

    // Count today's meetings
    const meetingsCount = events.filter((e) => {
      const time = e.metadata?.startTime || e.timestamp;
      return (
        e.eventType === "calendar_event_created" &&
        time >= todayStart &&
        time <= todayEnd
      );
    }).length;

    if (meetingsCount > 0) {
      items.push({
        title: `${meetingsCount} meeting${meetingsCount !== 1 ? "s" : ""} scheduled`,
        description: "Review meeting prep packs before each meeting",
        priority: "medium" as const,
      });
    }

    // Count urgent emails
    const urgentEmails = events.filter(
      (e) =>
        e.eventType === "email_received" &&
        e.timestamp >= todayStart - 24 * 60 * 60 * 1000
    ).length;

    if (urgentEmails > 5) {
      items.push({
        title: `${urgentEmails} new emails`,
        description: "Prioritize responses to important contacts",
        priority: "medium" as const,
      });
    }

    return {
      type: "priorities",
      title: `Action Items`,
      items,
    };
  }

  /**
   * Helper: Get start of day (midnight)
   */
  private getStartOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Helper: Get end of day (11:59:59 PM)
   */
  private getEndOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  /**
   * Helper: Format time (e.g., "9:00 AM")
   */
  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  /**
   * Helper: Format date (e.g., "Monday, Jan 22")
   */
  private formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  /**
   * Helper: Assess meeting priority
   */
  private assessMeetingPriority(
    event: NonNullable<DetectorContext["event"]>
  ): "high" | "medium" | "low" {
    const attendeesCount = event.entities?.length || 0;
    if (attendeesCount >= 5) return "high";
    if (attendeesCount >= 2) return "medium";
    return "low";
  }

  /**
   * Helper: Check if email is important
   */
  private isImportantEmail(artifact: any, event: any): boolean {
    const subject = artifact.metadata?.subject || "";
    const body = artifact.textContent || "";
    const text = `${subject} ${body}`.toLowerCase();

    // Urgent indicators
    const urgentPatterns = [
      /urgent/i,
      /asap/i,
      /important/i,
      /critical/i,
      /time sensitive/i,
      /action required/i,
      /immediate/i,
    ];

    return urgentPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Helper: Assess email priority
   */
  private assessEmailPriority(artifact: any, event: any): "high" | "medium" | "low" {
    const subject = artifact.metadata?.subject || "";
    const body = artifact.textContent || "";
    const text = `${subject} ${body}`.toLowerCase();

    if (/urgent|asap|critical/.test(text)) return "high";
    if (/important|time sensitive/.test(text)) return "medium";
    return "low";
  }

  /**
   * Helper: Generate brief summary
   */
  private generateBriefSummary(sections: BriefSection[]): string {
    const parts: string[] = [];

    for (const section of sections) {
      if (section.items.length > 0) {
        parts.push(`${section.items.length} ${section.type}`);
      }
    }

    return `Today: ${parts.join(", ")}`;
  }

  /**
   * Helper: Collect event IDs from time window
   */
  private collectEventIds(
    events: NonNullable<DetectorContext["event"]>[],
    startTime: number,
    endTime: number
  ): string[] {
    return events
      .filter((e) => e.timestamp >= startTime && e.timestamp <= endTime)
      .map((e) => e.eventId);
  }

  /**
   * Helper: Collect evidence pointers from sections
   */
  private collectEvidencePointers(
    sections: BriefSection[]
  ): Array<{
    artifactId: Id<"sourceArtifacts">;
    excerpt?: string;
    relevanceScore?: number;
  }> {
    const pointers: Array<{
      artifactId: Id<"sourceArtifacts">;
      excerpt?: string;
      relevanceScore?: number;
    }> = [];

    for (const section of sections) {
      for (const item of section.items) {
        if (item.artifactId) {
          pointers.push({
            artifactId: item.artifactId,
            excerpt: item.title,
            relevanceScore: item.priority === "high" ? 0.9 : 0.7,
          });
        }
      }
    }

    return pointers.slice(0, 10); // Limit to 10
  }
}

// Export singleton instance
export const dailyBriefDetector = new DailyBriefDetector();
