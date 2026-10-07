// convex/tools/recentEventSearch.ts
// Recent event search and disambiguation with LLM validation

import { internalAction, internalQuery, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";
import { v } from "convex/values";
import { generateText } from "ai";

// Import centralized model resolver (2025 consolidated - 7 models only)
import { getLanguageModelSafe, DEFAULT_MODEL } from "../../domains/agents/mcp_tools/models";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS - Extracted to avoid "Type instantiation is excessively deep"
// ═══════════════════════════════════════════════════════════════════════════

const eventBaseValidator = {
  id: v.string(),
  name: v.string(),
  date: v.optional(v.string()),
  location: v.optional(v.string()),
  description: v.string(),
  source: v.optional(v.string()),
};

const eventObjectValidator = v.object(eventBaseValidator);
const eventArrayValidator = v.array(eventObjectValidator);

const validatedEventValidator = v.object({
  ...eventBaseValidator,
  validationResult: v.union(v.literal("PASS"), v.literal("FAIL")),
  reasoning: v.string(),
});

const validatedEventArrayValidator = v.array(validatedEventValidator);

const confirmedEventValidator = v.object({
  id: v.string(),
  name: v.string(),
  date: v.optional(v.string()),
  location: v.optional(v.string()),
  description: v.optional(v.string()),
});

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface EventBase {
  id: string;
  name: string;
  date?: string;
  location?: string;
  description: string;
  source?: string;
}

interface ValidatedEvent extends EventBase {
  validationResult: "PASS" | "FAIL";
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search for recent events by name/topic
 * This is a placeholder - in production, integrate with real event APIs
 * (e.g., Eventbrite API, Google Calendar API, news APIs, or custom database)
 */
export const searchEvents = internalAction({
  args: {
    eventQuery: v.string(),
    conversationContext: v.optional(v.string()),
  },
  returns: eventArrayValidator,
  handler: async (ctx, args) => {
    console.log(`[searchEvents] Searching for: ${args.eventQuery}`);

    try {
      // PLACEHOLDER: In production, integrate with real event search API
      // For now, return mock data for common event queries
      const searchTerm = args.eventQuery.toLowerCase();
      const mockResults: Array<{
        id: string;
        name: string;
        date?: string;
        location?: string;
        description: string;
        source?: string;
      }> = [];

      // Example: Apple Event
      if (searchTerm.includes("apple event")) {
        mockResults.push(
          {
            id: "apple-event-2024-09",
            name: "Apple iPhone 16 Launch Event",
            date: "September 12, 2024",
            location: "Apple Park, Cupertino, CA",
            description: "Apple unveiled the iPhone 16 lineup with new AI features, improved cameras, and A18 chip",
            source: "Apple Newsroom",
          },
          {
            id: "apple-event-2024-06",
            name: "Apple WWDC 2024",
            date: "June 10, 2024",
            location: "Apple Park, Cupertino, CA (Virtual)",
            description: "Apple's Worldwide Developers Conference featuring iOS 18, macOS 15, and Apple Intelligence announcements",
            source: "Apple Developer",
          },
          {
            id: "apple-store-opening-2024",
            name: "Apple Store Grand Opening - Miami",
            date: "August 15, 2024",
            location: "Miami, FL",
            description: "New Apple retail store opening in downtown Miami with special promotions",
            source: "Apple Retail",
          }
        );
      }
      // Example: World Cup
      else if (searchTerm.includes("world cup")) {
        mockResults.push(
          {
            id: "fifa-world-cup-2026",
            name: "FIFA World Cup 2026",
            date: "June-July 2026",
            location: "USA, Canada, Mexico",
            description: "The 23rd FIFA World Cup, first to feature 48 teams and three host countries",
            source: "FIFA",
          },
          {
            id: "cricket-world-cup-2023",
            name: "ICC Cricket World Cup 2023",
            date: "October-November 2023",
            location: "India",
            description: "The 13th Cricket World Cup won by Australia, held across 10 Indian cities",
            source: "ICC",
          }
        );
      }
      // Example: Olympics
      else if (searchTerm.includes("olympics")) {
        mockResults.push(
          {
            id: "paris-olympics-2024",
            name: "Paris 2024 Summer Olympics",
            date: "July 26 - August 11, 2024",
            location: "Paris, France",
            description: "The 33rd Summer Olympic Games featuring 10,500 athletes from 206 nations",
            source: "Olympic.org",
          },
          {
            id: "milan-olympics-2026",
            name: "Milan-Cortina 2026 Winter Olympics",
            date: "February 6-22, 2026",
            location: "Milan and Cortina d'Ampezzo, Italy",
            description: "The 25th Winter Olympic Games returning to Italy for the first time since 2006",
            source: "Olympic.org",
          }
        );
      }
      // Generic fallback
      else {
        mockResults.push({
          id: `event-${Date.now()}-001`,
          name: args.eventQuery,
          date: "Recent",
          location: "Various",
          description: `Event related to ${args.eventQuery}`,
          source: "Various sources",
        });
      }

      console.log(`[searchEvents] Found ${mockResults.length} potential events`);
      return mockResults;

    } catch (error) {
      console.error("[searchEvents] Error:", error);
      return [];
    }
  },
});

/**
 * Validate event matches using LLM judge with conversation context
 * Returns PASS/FAIL based on usefulness and relevance
 */
export const validateEventMatches = internalAction({
  args: {
    userQuery: v.string(),
    conversationContext: v.optional(v.string()),
    events: eventArrayValidator,
  },
  returns: validatedEventArrayValidator,
  handler: async (ctx, args) => {
    const events = args.events as EventBase[];
    console.log(`[validateEventMatches] Validating ${events.length} events for query: "${args.userQuery}"`);

    try {
      // Build context-aware validation prompt
      const contextSection = args.conversationContext
        ? `\n\nConversation Context:\n${args.conversationContext}\n\nUse this context to determine which event is most relevant to the user's intent.`
        : '';

      const prompt = `You are an event matching validator. Given a user's query and a list of potential event matches, determine which events are relevant and useful.

User Query: "${args.userQuery}"${contextSection}

Events to validate:
${events.map((e: EventBase, i: number) => `${i + 1}. ${e.name}
   Date: ${e.date || 'Unknown'}
   Location: ${e.location || 'Unknown'}
   Description: ${e.description}
   Source: ${e.source || 'Unknown'}`).join('\n\n')}

For each event, determine if it is a PASS or FAIL based on:
1. **Usefulness**: Does the event provide valuable information for the user's query?
2. **Relevance**: Does the event timeframe and topic match the conversation context?

PASS criteria:
- Event is recent or upcoming and matches the user's query
- Event provides substantive information relevant to the conversation
- Event timeframe is appropriate for the user's needs
- Event topic aligns with conversation context

FAIL criteria:
- Event is too old or not relevant to current context
- Event doesn't provide useful information for the query
- Event topic doesn't match the conversation context
- Event is tangentially related but not what user is looking for

Return a JSON array with this exact structure:
[
  {
    "id": "event-id-123",
    "validationResult": "PASS",
    "reasoning": "This event is recent, relevant to the query, and provides useful information"
  },
  {
    "id": "event-id-456",
    "validationResult": "FAIL",
    "reasoning": "This event is too old and not relevant to the current conversation context"
  }
]

IMPORTANT: Return ONLY the JSON array, no other text.`;

      const result = await generateText({
        model: getLanguageModelSafe(DEFAULT_MODEL),
        prompt,
      });

      // Parse the LLM response
      const validationResults = JSON.parse(result.text);

      // Merge validation results with event data
      const validatedEvents: ValidatedEvent[] = events.map((event: EventBase) => {
        const validation = validationResults.find((v: { id: string }) => v.id === event.id);
        return {
          ...event,
          validationResult: (validation?.validationResult || "FAIL") as "PASS" | "FAIL",
          reasoning: validation?.reasoning || "No validation result",
        };
      });

      const passCount = validatedEvents.filter((e: ValidatedEvent) => e.validationResult === "PASS").length;
      console.log(`[validateEventMatches] Validation complete: ${passCount} PASS, ${validatedEvents.length - passCount} FAIL`);

      return validatedEvents;

    } catch (error) {
      console.error("[validateEventMatches] Error:", error);
      // If validation fails, mark all as FAIL
      return events.map((event: EventBase): ValidatedEvent => ({
        ...event,
        validationResult: "FAIL",
        reasoning: "Validation error occurred",
      }));
    }
  },
});

/**
 * Check if an event has been confirmed for this thread
 */
export const getConfirmedEvent = internalQuery({
  args: {
    threadId: v.string(),
    eventQuery: v.string(),
  },
  returns: v.union(confirmedEventValidator, v.null()),
  handler: async (ctx, args) => {
    const confirmed = await ctx.db
      .query("confirmedEvents")
      .withIndex("by_thread_and_query", (q: any) =>
        q.eq("threadId", args.threadId).eq("eventQuery", args.eventQuery.toLowerCase())
      )
      .first() as Doc<"confirmedEvents"> | null;

    if (!confirmed) return null;

    return {
      id: confirmed.confirmedId,
      name: confirmed.confirmedName,
      date: confirmed.confirmedDate,
      location: confirmed.confirmedLocation,
      description: confirmed.confirmedDescription,
    };
  },
});

/**
 * Store a confirmed event selection
 */
export const confirmEvent = internalMutation({
  args: {
    threadId: v.string(),
    eventQuery: v.string(),
    id: v.string(),
    name: v.string(),
    date: v.optional(v.string()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`[confirmEvent] Storing confirmation: ${args.name} for thread ${args.threadId}`);

    // Check if already confirmed
    const existing = await ctx.db
      .query("confirmedEvents")
      .withIndex("by_thread_and_query", (q: any) =>
        q.eq("threadId", args.threadId).eq("eventQuery", args.eventQuery.toLowerCase())
      )
      .first() as Doc<"confirmedEvents"> | null;

    if (existing) {
      // Update existing confirmation
      await ctx.db.patch(existing._id, {
        confirmedId: args.id,
        confirmedName: args.name,
        confirmedDate: args.date,
        confirmedLocation: args.location,
        confirmedDescription: args.description,
        createdAt: Date.now(),
      });
    } else {
      // Create new confirmation
      await ctx.db.insert("confirmedEvents", {
        threadId: args.threadId,
        eventQuery: args.eventQuery.toLowerCase(),
        confirmedId: args.id,
        confirmedName: args.name,
        confirmedDate: args.date,
        confirmedLocation: args.location,
        confirmedDescription: args.description,
        createdAt: Date.now(),
      });
    }

    return null;
  },
});
