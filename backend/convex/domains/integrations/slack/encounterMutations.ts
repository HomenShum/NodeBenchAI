/**
 * Encounter Mutations
 *
 * Database operations for creating and managing encounters.
 * Extends userEvents table with encounter-specific data.
 *
 * @module integrations/slack/encounterMutations
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Validator for internal use (with existingResearch for resolver)
const participantValidatorInternal = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  company: v.optional(v.string()),
  email: v.optional(v.string()),
  linkedEntityId: v.optional(v.id("entityContexts")),
  existingResearch: v.optional(v.boolean()),
});

// Validator matching schema (without existingResearch)
const participantValidator = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  company: v.optional(v.string()),
  email: v.optional(v.string()),
  linkedEntityId: v.optional(v.id("entityContexts")),
});

// Validator for internal use (with existingResearch for resolver)
const companyValidatorInternal = v.object({
  name: v.string(),
  linkedEntityId: v.optional(v.id("entityContexts")),
  existingResearch: v.optional(v.boolean()),
});

// Validator matching schema (without existingResearch)
const companyValidator = v.object({
  name: v.string(),
  linkedEntityId: v.optional(v.id("entityContexts")),
});

// Input validator (accepts data from resolver with existingResearch)
const encounterInputValidator = v.object({
  participants: v.array(participantValidatorInternal),
  companies: v.array(companyValidatorInternal),
  context: v.optional(v.string()),
  followUpRequested: v.optional(v.boolean()),
  rawText: v.optional(v.string()),
  researchStatus: v.optional(v.union(
    v.literal("none"),
    v.literal("fast_pass"),
    v.literal("deep_dive"),
    v.literal("complete"),
  )),
});

// Output validator (matches schema without existingResearch)
const encounterValidator = v.object({
  participants: v.array(participantValidator),
  companies: v.array(companyValidator),
  context: v.optional(v.string()),
  followUpRequested: v.optional(v.boolean()),
  rawText: v.optional(v.string()),
  researchStatus: v.optional(v.union(
    v.literal("none"),
    v.literal("fast_pass"),
    v.literal("deep_dive"),
    v.literal("complete"),
  )),
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE ENCOUNTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new encounter as a userEvent.
 */
export const createEncounter = internalMutation({
  args: {
    userId: v.id("users"),
    sourceType: v.union(v.literal("slack"), v.literal("email_forward")),
    sourceId: v.string(),
    sourceChannelId: v.optional(v.string()),
    encounter: encounterInputValidator,
  },
  returns: v.id("userEvents"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Generate title from context or participants
    const title = generateEncounterTitle(args.encounter);

    // Create the userEvent with encounter data
    const encounterId = await ctx.db.insert("userEvents", {
      userId: args.userId,
      title,
      description: args.encounter.rawText,
      status: "todo",
      priority: args.encounter.followUpRequested ? "medium" : "low",
      tags: generateEncounterTags(args.encounter, args.sourceType),
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      sourceChannelId: args.sourceChannelId,
      encounter: {
        participants: args.encounter.participants.map((p: { name: string; role?: string; company?: string; email?: string; linkedEntityId?: Id<"entityContexts">; existingResearch?: boolean }) => ({
          name: p.name,
          role: p.role,
          company: p.company,
          email: p.email,
          linkedEntityId: p.linkedEntityId,
        })),
        companies: args.encounter.companies.map((c: { name: string; linkedEntityId?: Id<"entityContexts">; existingResearch?: boolean }) => ({
          name: c.name,
          linkedEntityId: c.linkedEntityId,
        })),
        context: args.encounter.context,
        followUpRequested: args.encounter.followUpRequested,
        rawText: args.encounter.rawText,
        researchStatus: args.encounter.researchStatus || "none",
      },
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[EncounterMutations] Created encounter ${encounterId} with ${args.encounter.participants.length} participants`);

    return encounterId;
  },
});

/**
 * Update encounter research status.
 */
export const updateEncounterResearchStatus = internalMutation({
  args: {
    encounterId: v.id("userEvents"),
    researchStatus: v.union(
      v.literal("none"),
      v.literal("fast_pass"),
      v.literal("deep_dive"),
      v.literal("complete"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const encounter = await ctx.db.get(args.encounterId) as Doc<"userEvents"> | null;
    if (!encounter || !encounter.encounter) {
      console.error(`[EncounterMutations] Encounter not found: ${args.encounterId}`);
      return null;
    }

    await ctx.db.patch(args.encounterId, {
      encounter: {
        ...encounter.encounter,
        researchStatus: args.researchStatus,
      },
      updatedAt: Date.now(),
    });

    console.log(`[EncounterMutations] Updated research status to ${args.researchStatus} for ${args.encounterId}`);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-UP TASKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate follow-up tasks from an encounter.
 */
export const generateFollowUpTasks = internalMutation({
  args: {
    userId: v.id("users"),
    encounterId: v.id("userEvents"),
    encounter: v.object({
      participants: v.array(participantValidatorInternal),
      companies: v.array(companyValidatorInternal),
      newEntities: v.optional(v.array(v.string())),
    }),
  },
  returns: v.array(v.id("userEvents")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskIds: Id<"userEvents">[] = [];

    // Get the original encounter
    const originalEncounter = await ctx.db.get(args.encounterId) as Doc<"userEvents"> | null;
    if (!originalEncounter) {
      return taskIds;
    }

    // Create follow-up task for the main contact
    if (args.encounter.participants.length > 0) {
      const mainContact = args.encounter.participants[0];
      const followUpTaskId = await ctx.db.insert("userEvents", {
        userId: args.userId,
        title: `Follow up with ${mainContact.name}`,
        description: `Follow up from encounter: ${originalEncounter.encounter?.context || originalEncounter.title}`,
        status: "todo",
        priority: "medium",
        tags: ["follow-up", "encounter"],
        refs: [{ kind: "userEvent", id: args.encounterId }],
        createdAt: now,
        updatedAt: now,
      });
      taskIds.push(followUpTaskId);
      console.log(`[EncounterMutations] Created follow-up task for ${mainContact.name}`);
    }

    // Create research tasks for new entities
    const newEntities = args.encounter.newEntities || [];
    for (const entity of newEntities.slice(0, 3)) { // Limit to 3 research tasks
      const [type, name] = entity.split(":");
      const researchTaskId = await ctx.db.insert("userEvents", {
        userId: args.userId,
        title: `Research: ${name}`,
        description: `New ${type} from encounter - needs research`,
        status: "todo",
        priority: "low",
        tags: ["research", type, "encounter"],
        refs: [{ kind: "userEvent", id: args.encounterId }],
        createdAt: now,
        updatedAt: now,
      });
      taskIds.push(researchTaskId);
      console.log(`[EncounterMutations] Created research task for ${name}`);
    }

    return taskIds;
  },
});

/**
 * Create a single follow-up task for an encounter.
 */
export const createFollowUpTask = internalMutation({
  args: {
    userId: v.id("users"),
    encounterId: v.id("userEvents"),
  },
  returns: v.id("userEvents"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const encounter = await ctx.db.get(args.encounterId) as Doc<"userEvents"> | null;
    if (!encounter) {
      throw new Error("Encounter not found");
    }

    const mainContact = encounter.encounter?.participants[0];
    const contactName = mainContact?.name || "contact";

    const taskId = await ctx.db.insert("userEvents", {
      userId: args.userId,
      title: `Follow up with ${contactName}`,
      description: `Follow up from: ${encounter.encounter?.context || encounter.title}`,
      status: "todo",
      priority: "medium",
      tags: ["follow-up", "encounter"],
      refs: [{ kind: "userEvent", id: args.encounterId }],
      createdAt: now,
      updatedAt: now,
    });

    // Update original encounter to mark follow-up requested
    if (encounter.encounter) {
      await ctx.db.patch(args.encounterId, {
        encounter: {
          ...encounter.encounter,
          followUpRequested: true,
        },
        updatedAt: now,
      });
    }

    console.log(`[EncounterMutations] Created follow-up task ${taskId} for encounter ${args.encounterId}`);
    return taskId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent encounters for a user.
 */
export const getRecentEncounters = internalQuery({
  args: {
    userId: v.id("users"),
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("userEvents"),
    title: v.string(),
    encounter: v.optional(encounterValidator),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours || 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const limit = args.limit || 50;

    // Get Slack encounters
    const slackEncounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "slack")
      )
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(limit) as Doc<"userEvents">[];

    // Get email forward encounters
    const emailEncounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "email_forward")
      )
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(limit) as Doc<"userEvents">[];

    // Combine and sort
    const allEncounters = [...slackEncounters, ...emailEncounters]
      .sort((a: Doc<"userEvents">, b: Doc<"userEvents">) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return allEncounters.map((e: Doc<"userEvents">) => ({
      _id: e._id,
      title: e.title,
      encounter: e.encounter as any,
      createdAt: e.createdAt,
    }));
  },
});

/**
 * Get encounter by source ID (for deduplication).
 */
export const getEncounterBySourceId = internalQuery({
  args: {
    userId: v.id("users"),
    sourceId: v.string(),
  },
  returns: v.union(v.null(), v.id("userEvents")),
  handler: async (ctx, args) => {
    // Check Slack encounters
    const slackEncounter = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "slack")
      )
      .filter((q) => q.eq(q.field("sourceId"), args.sourceId))
      .first() as Doc<"userEvents"> | null;

    if (slackEncounter) {
      return slackEncounter._id;
    }

    // Check email encounters
    const emailEncounter = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", args.userId).eq("sourceType", "email_forward")
      )
      .filter((q) => q.eq(q.field("sourceId"), args.sourceId))
      .first() as Doc<"userEvents"> | null;

    return emailEncounter?._id || null;
  },
});

/**
 * Get encounters with pending follow-ups.
 */
export const getEncountersWithPendingFollowUps = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("userEvents"),
    title: v.string(),
    encounter: v.optional(encounterValidator),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    const encounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.and(
          q.neq(q.field("encounter"), undefined),
          q.eq(q.field("status"), "todo")
        )
      )
      .order("desc")
      .take(limit) as Doc<"userEvents">[];

    return encounters
      .filter((e: Doc<"userEvents">) => e.encounter?.followUpRequested)
      .map((e: Doc<"userEvents">) => ({
        _id: e._id,
        title: e.title,
        encounter: e.encounter as any,
        createdAt: e.createdAt,
      }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a title for the encounter.
 */
function generateEncounterTitle(encounter: {
  participants: Array<{ name: string; company?: string }>;
  companies: Array<{ name: string }>;
  context?: string;
}): string {
  if (encounter.context) {
    return encounter.context;
  }

  if (encounter.participants.length > 0) {
    const first = encounter.participants[0];
    const company = first.company || encounter.companies[0]?.name;
    return company
      ? `Meeting with ${first.name} (${company})`
      : `Meeting with ${first.name}`;
  }

  if (encounter.companies.length > 0) {
    return `Meeting with ${encounter.companies[0].name}`;
  }

  return `Encounter on ${new Date().toLocaleDateString()}`;
}

/**
 * Generate tags for the encounter.
 */
function generateEncounterTags(
  encounter: {
    participants: Array<{ name: string; company?: string }>;
    companies: Array<{ name: string }>;
    followUpRequested?: boolean;
  },
  sourceType: "slack" | "email_forward"
): string[] {
  const tags = ["encounter", sourceType];

  // Add company tags
  for (const company of encounter.companies.slice(0, 3)) {
    tags.push(company.name.toLowerCase().replace(/\s+/g, "-"));
  }

  // Add follow-up tag if requested
  if (encounter.followUpRequested) {
    tags.push("follow-up-needed");
  }

  return tags;
}
