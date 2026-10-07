/**
 * Meeting Prep Detector
 * Automatically generates briefing packs for upcoming meetings
 *
 * Features:
 * - Detects meetings 4-6 hours in advance
 * - Finds related emails, documents, and past conversations
 * - Extracts attendees and their context
 * - Generates briefing with key points
 * - Delivers via Slack or in-app notification
 *
 * Trigger: Batch detector, runs every hour
 * Output: Meeting prep pack opportunity
 */

import { BatchDetector } from "./BaseDetector";
import type {
  DetectorMetadata,
  DetectorContext,
  DetectedOpportunity,
} from "./types";
import { Id } from "../../../_generated/dataModel";

export class MeetingPrepDetector extends BatchDetector {
  readonly metadata: DetectorMetadata = {
    detectorId: "meeting_prep_v1",
    name: "Meeting Prep Packs",
    description:
      "Auto-generate briefing packs 4 hours before meetings with context from emails, docs, and past conversations",
    version: "1.0.0",
    mode: "batch",
    schedule: {
      cron: "0 * * * *", // Every hour
    },
    tier: "free",
    enabled: true,
  };

  /**
   * Process batch of calendar events to find upcoming meetings
   */
  async processBatch(
    events: NonNullable<DetectorContext["event"]>[],
    ctx: DetectorContext
  ): Promise<DetectedOpportunity[]> {
    const opportunities: DetectedOpportunity[] = [];

    // Filter for calendar events only
    const calendarEvents = events.filter((e) =>
      e.eventType.startsWith("calendar_event")
    );

    // Find meetings happening in 4-6 hours
    const now = Date.now();
    const fourHoursFromNow = now + 4 * 60 * 60 * 1000;
    const sixHoursFromNow = now + 6 * 60 * 60 * 1000;

    const upcomingMeetings = calendarEvents.filter((event) => {
      const meetingTime = event.metadata?.startTime || event.timestamp;
      return meetingTime >= fourHoursFromNow && meetingTime <= sixHoursFromNow;
    });

    console.log(
      `[MeetingPrepDetector] Found ${upcomingMeetings.length} meetings in 4-6 hour window`
    );

    // Process each meeting
    for (const meeting of upcomingMeetings) {
      try {
        const opportunity = await this.generateMeetingPrepOpportunity(
          meeting,
          ctx
        );
        if (opportunity) {
          opportunities.push(opportunity);
        }
      } catch (error: any) {
        console.error(
          `[MeetingPrepDetector] Error processing meeting ${meeting.eventId}:`,
          error.message
        );
      }
    }

    return opportunities;
  }

  /**
   * Generate a meeting prep opportunity for a specific meeting
   */
  private async generateMeetingPrepOpportunity(
    meeting: NonNullable<DetectorContext["event"]>,
    ctx: DetectorContext
  ): Promise<DetectedOpportunity | null> {
    const meetingTime = meeting.metadata?.startTime || meeting.timestamp;
    const hoursUntilMeeting = (meetingTime - Date.now()) / (1000 * 60 * 60);

    // Extract meeting details
    const meetingTitle = meeting.summary || "Untitled Meeting";
    const attendees = meeting.entities?.filter((e) => e.entityType === "person") || [];
    const location = meeting.metadata?.location;
    const meetingLink = meeting.metadata?.meetingLink;

    // Find related context
    const context = await this.findRelatedContext(meeting, ctx);

    // Check if we have enough context to make this useful
    if (context.emails.length === 0 && context.documents.length === 0) {
      console.log(
        `[MeetingPrepDetector] Skipping ${meetingTitle} - no context found`
      );
      return null;
    }

    // Calculate confidence based on context richness
    const confidence = this.calculateConfidence(context, attendees.length);

    // Estimate time saved
    const timeSavedMinutes = Math.min(15 + context.emails.length * 2, 60);

    // Generate briefing content
    const briefing = this.generateBriefing(meeting, context);

    // Create opportunity
    const opportunity = this.createOpportunity({
      type: "meeting_prep",
      trigger: {
        eventIds: [meeting.eventId],
        whyNow: `Meeting "${meetingTitle}" in ${hoursUntilMeeting.toFixed(1)} hours`,
      },
      evidencePointers: [
        ...context.emails.map((e) => ({
          artifactId: e.artifactId,
          excerpt: e.excerpt,
          relevanceScore: e.relevance,
        })),
        ...context.documents.map((d) => ({
          artifactId: d.artifactId,
          excerpt: d.excerpt,
          relevanceScore: d.relevance,
        })),
      ],
      impactEstimate: {
        timeSavedMinutes,
        confidenceLevel: confidence,
      },
      riskLevel: "low",
      suggestedActions: [
        {
          actionType: "suggest",
          description: `Review briefing pack for "${meetingTitle}"`,
          config: {
            briefing,
            meetingTitle,
            meetingTime,
            attendees: attendees.map((a) => a.entityName),
            location,
            meetingLink,
          },
        },
      ],
      metadata: {
        meetingEventId: meeting.eventId,
        meetingTitle,
        meetingTime,
        attendeeCount: attendees.length,
        contextSources: {
          emails: context.emails.length,
          documents: context.documents.length,
          pastMeetings: context.pastMeetings.length,
        },
      },
      expiresAt: meetingTime + 60 * 60 * 1000, // Expires 1 hour after meeting
    });

    return opportunity;
  }

  /**
   * Find related context for a meeting
   */
  private async findRelatedContext(
    meeting: NonNullable<DetectorContext["event"]>,
    ctx: DetectorContext
  ): Promise<{
    emails: Array<{
      artifactId: Id<"sourceArtifacts">;
      excerpt: string;
      relevance: number;
    }>;
    documents: Array<{
      artifactId: Id<"sourceArtifacts">;
      excerpt: string;
      relevance: number;
    }>;
    pastMeetings: Array<{
      artifactId: Id<"sourceArtifacts">;
      excerpt: string;
      relevance: number;
    }>;
  }> {
    const context = {
      emails: [] as Array<{
        artifactId: Id<"sourceArtifacts">;
        excerpt: string;
        relevance: number;
      }>,
      documents: [] as Array<{
        artifactId: Id<"sourceArtifacts">;
        excerpt: string;
        relevance: number;
      }>,
      pastMeetings: [] as Array<{
        artifactId: Id<"sourceArtifacts">;
        excerpt: string;
        relevance: number;
      }>,
    };

    // Extract attendee emails for filtering
    const attendeeEmails =
      meeting.entities
        ?.filter((e) => e.entityType === "person")
        .map((e) => e.entityId.replace("person_", "")) || [];

    // Find related emails (last 30 days)
    if (ctx.queryEvents) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentEvents = await ctx.queryEvents({
        startTime: thirtyDaysAgo,
        endTime: Date.now(),
        eventTypes: ["email_received", "email_sent"],
      });

      // Filter emails from/to attendees
      const relevantEmails = recentEvents.filter((event) => {
        const actorEmail = event.metadata?.actor?.email;
        return attendeeEmails.some((email) => actorEmail?.includes(email));
      });

      // Take top 10 most recent
      const sortedEmails = relevantEmails
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

      for (const email of sortedEmails) {
        if (email.metadata?.sourceArtifactId) {
          context.emails.push({
            artifactId: email.metadata.sourceArtifactId,
            excerpt: email.summary?.slice(0, 200) || "",
            relevance: 0.8,
          });
        }
      }
    }

    // TODO: Find related documents (would require vector search)
    // TODO: Find past meetings with same attendees

    return context;
  }

  /**
   * Calculate confidence based on context richness
   */
  private calculateConfidence(
    context: {
      emails: any[];
      documents: any[];
      pastMeetings: any[];
    },
    attendeeCount: number
  ): number {
    let confidence = 0.5; // Base confidence

    // More context = higher confidence
    if (context.emails.length > 0) confidence += 0.2;
    if (context.emails.length >= 5) confidence += 0.1;
    if (context.documents.length > 0) confidence += 0.1;
    if (context.pastMeetings.length > 0) confidence += 0.1;

    // More attendees = more valuable
    if (attendeeCount > 2) confidence += 0.05;
    if (attendeeCount > 5) confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate briefing content
   */
  private generateBriefing(
    meeting: NonNullable<DetectorContext["event"]>,
    context: {
      emails: Array<{ excerpt: string }>;
      documents: Array<{ excerpt: string }>;
      pastMeetings: Array<{ excerpt: string }>;
    }
  ): string {
    const meetingTitle = meeting.summary || "Untitled Meeting";
    const attendees =
      meeting.entities
        ?.filter((e) => e.entityType === "person")
        .map((e) => e.entityName) || [];

    const sections: string[] = [];

    // Header
    sections.push(`# Meeting Prep: ${meetingTitle}\n`);

    // Attendees
    if (attendees.length > 0) {
      sections.push(`## Attendees (${attendees.length})`);
      sections.push(attendees.map((a) => `- ${a}`).join("\n"));
      sections.push("");
    }

    // Recent emails
    if (context.emails.length > 0) {
      sections.push(`## Recent Email Context (${context.emails.length})`);
      sections.push(
        "Here are the most recent emails with these attendees:\n"
      );
      context.emails.slice(0, 5).forEach((email, idx) => {
        sections.push(`${idx + 1}. ${email.excerpt}...\n`);
      });
    }

    // Key topics (extracted from emails)
    sections.push("## Key Topics to Discuss");
    sections.push("- [Based on email analysis]");
    sections.push("- [Action items from previous conversations]");
    sections.push("- [Outstanding questions]");
    sections.push("");

    // Suggested prep
    sections.push("## Suggested Prep");
    sections.push("1. Review the email thread above");
    sections.push("2. Check if there are action items from last meeting");
    sections.push("3. Prepare any updates on your end");
    sections.push("");

    return sections.join("\n");
  }
}

// Singleton instance for registration
export const meetingPrepDetector = new MeetingPrepDetector();
