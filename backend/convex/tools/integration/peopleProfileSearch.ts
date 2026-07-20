// convex/tools/peopleProfileSearch.ts
// People profile search and disambiguation with LLM validation

import { internalAction, internalQuery, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Helper to get the appropriate language model based on model name
function getLanguageModel(modelName: string) {
  if (modelName.startsWith("claude-")) return anthropic(modelName);
  if (modelName.startsWith("gemini-")) return google(modelName);
  return openai.chat(modelName);
}

/**
 * Search for people profiles by name
 * This is a placeholder - in production, integrate with real people search APIs
 * (e.g., LinkedIn API, Clearbit, Hunter.io, or custom database)
 */
export const searchPeople = internalAction({
  args: {
    personName: v.string(),
    conversationContext: v.optional(v.string()),
  },
  returns: v.array(v.object({
    id: v.string(),
    name: v.string(),
    profession: v.optional(v.string()),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
    description: v.string(),
  })),
  handler: async (ctx, args) => {
    console.log(`[searchPeople] Searching for: ${args.personName}`);

    try {
      // PLACEHOLDER: In production, integrate with real people search API
      // For now, return mock data for common names
      const searchTerm = args.personName.toLowerCase();
      const mockResults: Array<{
        id: string;
        name: string;
        profession?: string;
        organization?: string;
        location?: string;
        description: string;
      }> = [];

      // Example: Michael Jordan
      if (searchTerm.includes("michael jordan")) {
        mockResults.push(
          {
            id: "mj-basketball-001",
            name: "Michael Jordan",
            profession: "Professional Basketball Player (Retired)",
            organization: "Charlotte Hornets (Owner)",
            location: "Charlotte, NC",
            description: "NBA legend, 6-time NBA champion, widely regarded as the greatest basketball player of all time",
          },
          {
            id: "mj-professor-002",
            name: "Michael Jordan",
            profession: "Professor of Statistics",
            organization: "UC Berkeley",
            location: "Berkeley, CA",
            description: "Distinguished professor in statistics and machine learning, known for work in Bayesian nonparametrics",
          },
          {
            id: "mj-actor-003",
            name: "Michael B. Jordan",
            profession: "Actor",
            organization: "Hollywood",
            location: "Los Angeles, CA",
            description: "Actor known for roles in Creed, Black Panther, and Fruitvale Station",
          }
        );
      }
      // Example: John Smith
      else if (searchTerm.includes("john smith")) {
        mockResults.push(
          {
            id: "js-ceo-001",
            name: "John Smith",
            profession: "CEO",
            organization: "Tech Innovations Inc.",
            location: "San Francisco, CA",
            description: "Technology executive and entrepreneur, founded multiple successful startups",
          },
          {
            id: "js-doctor-002",
            name: "Dr. John Smith",
            profession: "Cardiologist",
            organization: "Mayo Clinic",
            location: "Rochester, MN",
            description: "Leading cardiologist specializing in heart disease prevention and treatment",
          },
          {
            id: "js-author-003",
            name: "John Smith",
            profession: "Author",
            organization: "Independent",
            location: "New York, NY",
            description: "Best-selling author of historical fiction novels",
          }
        );
      }
      // Generic fallback
      else {
        mockResults.push({
          id: `person-${Date.now()}-001`,
          name: args.personName,
          profession: "Professional",
          organization: "Various",
          location: "Unknown",
          description: `Profile for ${args.personName}`,
        });
      }

      console.log(`[searchPeople] Found ${mockResults.length} potential matches`);
      return mockResults;

    } catch (error) {
      console.error("[searchPeople] Error:", error);
      return [];
    }
  },
});

/**
 * Validate person matches using LLM judge with conversation context
 * Returns PASS/FAIL based on correctness and contextual relevance
 */
export const validatePersonMatches = internalAction({
  args: {
    userQuery: v.string(),
    conversationContext: v.optional(v.string()),
    people: v.array(v.object({
      id: v.string(),
      name: v.string(),
      profession: v.optional(v.string()),
      organization: v.optional(v.string()),
      location: v.optional(v.string()),
      description: v.string(),
    })),
  },
  returns: v.array(v.object({
    id: v.string(),
    name: v.string(),
    profession: v.optional(v.string()),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
    description: v.string(),
    validationResult: v.union(v.literal("PASS"), v.literal("FAIL")),
    reasoning: v.string(),
  })),
  handler: async (ctx, args) => {
    console.log(`[validatePersonMatches] Validating ${args.people.length} people for query: "${args.userQuery}"`);

    try {
      // Build context-aware validation prompt
      const contextSection = args.conversationContext 
        ? `\n\nConversation Context:\n${args.conversationContext}\n\nUse this context to determine which person is most relevant to the user's intent.`
        : '';

      const prompt = `You are a person matching validator. Given a user's query and a list of potential person matches, determine which people are relevant matches.

User Query: "${args.userQuery}"${contextSection}

People to validate:
${args.people.map((p: any, i: any) => `${i + 1}. ${p.name}${p.profession ? ` - ${p.profession}` : ''}${p.organization ? ` at ${p.organization}` : ''}${p.location ? ` (${p.location})` : ''}
   Description: ${p.description}`).join('\n\n')}

For each person, determine if it is a PASS or FAIL based on:
1. **Correctness**: Does the person's identity match the user's intent? (profession, organization, location)
2. **Contextual Relevance**: Is this person relevant to the conversation context?

PASS criteria:
- Person's profession/role matches the user's likely intent
- Person is contextually relevant to the conversation topic
- Person is a plausible match given available information

FAIL criteria:
- Person's profession/role doesn't match the user's intent
- Person is not relevant to the conversation context
- Person is clearly not what the user is looking for

Return a JSON array with this exact structure:
[
  {
    "id": "person-id-123",
    "validationResult": "PASS",
    "reasoning": "This person matches the user's intent and is highly relevant to the conversation context"
  },
  {
    "id": "person-id-456",
    "validationResult": "FAIL",
    "reasoning": "This person's profession doesn't match the conversation context"
  }
]

IMPORTANT: Return ONLY the JSON array, no other text.`;

      const result = await generateText({
        model: getLanguageModel(getLlmModel("router", "openai")),
        prompt,
      });

      // Parse the LLM response
      const validationResults = JSON.parse(result.text);

      // Merge validation results with person data
      const validatedPeople = args.people.map((person: any) => {
        const validation = validationResults.find((v: any) => v.id === person.id);
        return {
          ...person,
          validationResult: validation?.validationResult || "FAIL" as "PASS" | "FAIL",
          reasoning: validation?.reasoning || "No validation result",
        };
      });

      const passCount = validatedPeople.filter((p: any) => p.validationResult === "PASS").length;
      console.log(`[validatePersonMatches] Validation complete: ${passCount} PASS, ${validatedPeople.length - passCount} FAIL`);

      return validatedPeople;

    } catch (error) {
      console.error("[validatePersonMatches] Error:", error);
      // If validation fails, mark all as FAIL
      return args.people.map((person: any) => ({
        ...person,
        validationResult: "FAIL" as "PASS" | "FAIL",
        reasoning: "Validation error occurred",
      }));
    }
  },
});

/**
 * Check if a person has been confirmed for this thread
 */
export const getConfirmedPerson = internalQuery({
  args: {
    threadId: v.string(),
    personName: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      name: v.string(),
      profession: v.optional(v.string()),
      organization: v.optional(v.string()),
      location: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const confirmed = await ctx.db
      .query("confirmedPeople")
      .withIndex("by_thread_and_name", (q) =>
        q.eq("threadId", args.threadId).eq("personName", args.personName.toLowerCase())
      )
      .first() as Doc<"confirmedPeople"> | null;

    if (!confirmed) return null;

    return {
      id: confirmed.confirmedId,
      name: confirmed.confirmedName,
      profession: confirmed.confirmedProfession,
      organization: confirmed.confirmedOrganization,
      location: confirmed.confirmedLocation,
    };
  },
});

/**
 * Store a confirmed person selection
 */
export const confirmPerson = internalMutation({
  args: {
    threadId: v.string(),
    personName: v.string(),
    id: v.string(),
    name: v.string(),
    profession: v.optional(v.string()),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`[confirmPerson] Storing confirmation: ${args.name} for thread ${args.threadId}`);

    // Check if already confirmed
    const existing = await ctx.db
      .query("confirmedPeople")
      .withIndex("by_thread_and_name", (q) =>
        q.eq("threadId", args.threadId).eq("personName", args.personName.toLowerCase())
      )
      .first() as Doc<"confirmedPeople"> | null;

    if (existing) {
      // Update existing confirmation
      await ctx.db.patch(existing._id, {
        confirmedId: args.id,
        confirmedName: args.name,
        confirmedProfession: args.profession,
        confirmedOrganization: args.organization,
        confirmedLocation: args.location,
        createdAt: Date.now(),
      });
    } else {
      // Create new confirmation
      await ctx.db.insert("confirmedPeople", {
        threadId: args.threadId,
        personName: args.personName.toLowerCase(),
        confirmedId: args.id,
        confirmedName: args.name,
        confirmedProfession: args.profession,
        confirmedOrganization: args.organization,
        confirmedLocation: args.location,
        createdAt: Date.now(),
      });
    }

    return null;
  },
});
