/**
 * Temporal Facts Mutations
 *
 * CRUD operations for time-bounded facts.
 * Supports fact supersession chains for tracking evolution.
 *
 * @module domains/narrative/mutations/temporalFacts
 */

import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "../../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// CREATE TEMPORAL FACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new temporal fact with bi-temporal tracking.
 *
 * Bi-temporal fields:
 * - validFrom/validTo: When the fact was true in the real world
 * - observedAt: When the agent retrieved the evidence
 * - recordedAt: When we committed to the database
 */
export const createTemporalFact = internalMutation({
  args: {
    factId: v.string(),
    threadId: v.id("narrativeThreads"),
    claimText: v.string(),
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    validFrom: v.number(),
    confidence: v.number(),
    sourceEventIds: v.array(v.id("narrativeEvents")),
    weekNumber: v.string(),
    // Bi-temporal: when agent observed the evidence (optional, defaults to now)
    observedAt: v.optional(v.number()),
  },
  returns: v.id("temporalFacts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("temporalFacts", {
      factId: args.factId,
      threadId: args.threadId,
      claimText: args.claimText,
      subject: args.subject,
      predicate: args.predicate,
      object: args.object,
      validFrom: args.validFrom,
      confidence: args.confidence,
      sourceEventIds: args.sourceEventIds,
      weekNumber: args.weekNumber,
      // Bi-temporal fields
      observedAt: args.observedAt ?? now,
      recordedAt: now,
      createdAt: now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPERSEDE TEMPORAL FACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new fact that supersedes an existing one.
 * Marks the old fact with validTo and links the chain.
 * Includes bi-temporal tracking for audit.
 */
export const supersedeTemporalFact = internalMutation({
  args: {
    oldFactId: v.id("temporalFacts"),
    newFact: v.object({
      factId: v.string(),
      claimText: v.string(),
      object: v.string(),
      validFrom: v.number(),
      confidence: v.number(),
      sourceEventIds: v.array(v.id("narrativeEvents")),
      weekNumber: v.string(),
      observedAt: v.optional(v.number()),
    }),
  },
  returns: v.id("temporalFacts"),
  handler: async (ctx, args) => {
    const oldFact = await ctx.db.get(args.oldFactId);
    if (!oldFact) {
      throw new Error(`Temporal fact not found: ${args.oldFactId}`);
    }

    const now = Date.now();

    // Mark old fact as superseded
    await ctx.db.patch(args.oldFactId, {
      validTo: args.newFact.validFrom,
      supersededBy: args.newFact.factId,
    });

    // Create new fact linked to old one with bi-temporal fields
    const newFactDbId = await ctx.db.insert("temporalFacts", {
      factId: args.newFact.factId,
      threadId: oldFact.threadId,
      claimText: args.newFact.claimText,
      subject: oldFact.subject,
      predicate: oldFact.predicate,
      object: args.newFact.object,
      validFrom: args.newFact.validFrom,
      confidence: args.newFact.confidence,
      sourceEventIds: args.newFact.sourceEventIds,
      weekNumber: args.newFact.weekNumber,
      supersedes: oldFact.factId,
      // Bi-temporal fields
      observedAt: args.newFact.observedAt ?? now,
      recordedAt: now,
      createdAt: now,
    });

    return newFactDbId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH CREATE TEMPORAL FACTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create multiple temporal facts in a batch.
 * Automatically handles supersession for existing facts.
 * Includes bi-temporal tracking for audit.
 */
export const batchCreateTemporalFacts = internalMutation({
  args: {
    facts: v.array(
      v.object({
        factId: v.string(),
        threadId: v.id("narrativeThreads"),
        claimText: v.string(),
        subject: v.string(),
        predicate: v.string(),
        object: v.string(),
        validFrom: v.number(),
        confidence: v.number(),
        sourceEventIds: v.array(v.id("narrativeEvents")),
        weekNumber: v.string(),
        observedAt: v.optional(v.number()),
      })
    ),
  },
  returns: v.array(v.id("temporalFacts")),
  handler: async (ctx, args) => {
    const createdIds: any[] = [];
    const now = Date.now();

    for (const fact of args.facts) {
      // Check for existing current fact to supersede
      const existingFacts = await ctx.db
        .query("temporalFacts")
        .withIndex("by_subject", (q) =>
          q.eq("subject", fact.subject).eq("predicate", fact.predicate)
        )
        .filter((q) => q.eq(q.field("validTo"), undefined))
        .collect();

      // Find the most recent current fact
      const currentFact = existingFacts
        .sort((a, b) => b.validFrom - a.validFrom)[0];

      if (currentFact && currentFact.object !== fact.object) {
        // Supersede existing fact
        await ctx.db.patch(currentFact._id, {
          validTo: fact.validFrom,
          supersededBy: fact.factId,
        });

        const newId = await ctx.db.insert("temporalFacts", {
          ...fact,
          supersedes: currentFact.factId,
          // Bi-temporal fields
          observedAt: fact.observedAt ?? now,
          recordedAt: now,
          createdAt: now,
        });
        createdIds.push(newId);
      } else if (!currentFact) {
        // Create new fact (no existing to supersede)
        const newId = await ctx.db.insert("temporalFacts", {
          ...fact,
          // Bi-temporal fields
          observedAt: fact.observedAt ?? now,
          recordedAt: now,
          createdAt: now,
        });
        createdIds.push(newId);
      }
      // If object is same, skip (no change)
    }

    return createdIds;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY TEMPORAL FACTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current facts for a subject.
 * Returns only facts where validTo is undefined (still current).
 */
export const getCurrentFactsForSubject = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("temporalFacts"),
      factId: v.string(),
      threadId: v.id("narrativeThreads"),
      claimText: v.string(),
      subject: v.string(),
      predicate: v.string(),
      object: v.string(),
      validFrom: v.number(),
      confidence: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const facts = await ctx.db
      .query("temporalFacts")
      .withIndex("by_subject", (q) => q.eq("subject", args.subject))
      .filter((q) => q.eq(q.field("validTo"), undefined))
      .collect();

    return facts.map((f) => ({
      _id: f._id,
      factId: f.factId,
      threadId: f.threadId,
      claimText: f.claimText,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      validFrom: f.validFrom,
      confidence: f.confidence,
    }));
  },
});

/**
 * Get fact history for a subject-predicate pair.
 * Returns all facts (current and superseded) in chronological order.
 */
export const getFactHistory = internalQuery({
  args: {
    subject: v.string(),
    predicate: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("temporalFacts"),
      factId: v.string(),
      claimText: v.string(),
      object: v.string(),
      validFrom: v.number(),
      validTo: v.optional(v.number()),
      isCurrent: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    const facts = await ctx.db
      .query("temporalFacts")
      .withIndex("by_subject", (q) =>
        q.eq("subject", args.subject).eq("predicate", args.predicate)
      )
      .collect();

    return facts
      .sort((a, b) => a.validFrom - b.validFrom)
      .map((f) => ({
        _id: f._id,
        factId: f.factId,
        claimText: f.claimText,
        object: f.object,
        validFrom: f.validFrom,
        validTo: f.validTo,
        isCurrent: f.validTo === undefined,
      }));
  },
});

/**
 * Get facts for a thread by week.
 */
export const getFactsByThreadWeek = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    weekNumber: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("temporalFacts"),
      factId: v.string(),
      claimText: v.string(),
      subject: v.string(),
      predicate: v.string(),
      object: v.string(),
      validFrom: v.number(),
      validTo: v.optional(v.number()),
      confidence: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const facts = await ctx.db
      .query("temporalFacts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .filter((q) => q.eq(q.field("weekNumber"), args.weekNumber))
      .collect();

    return facts.map((f) => ({
      _id: f._id,
      factId: f.factId,
      claimText: f.claimText,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      validFrom: f.validFrom,
      validTo: f.validTo,
      confidence: f.confidence,
    }));
  },
});
