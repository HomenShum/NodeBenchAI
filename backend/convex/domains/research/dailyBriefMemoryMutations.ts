/**
 * Daily Brief Domain Memory Mutations
 *
 * Kept out of Node.js runtime modules so we can write to the DB.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";

function stripReservedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripReservedKeys);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const next: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      if (key.startsWith("$")) continue;
      next[key] = stripReservedKeys(val);
    }
    return next;
  }
  return value;
}

export const createMemory = internalMutation({
  args: {
    snapshotId: v.id("dailyBriefSnapshots"),
    dateString: v.string(),
    generatedAt: v.number(),
    version: v.number(),
    goal: v.string(),
    features: v.array(v.any()),
    context: v.any(),
    progressLog: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const memoryId = await ctx.db.insert("dailyBriefMemories", {
      snapshotId: args.snapshotId,
      dateString: args.dateString,
      generatedAt: args.generatedAt,
      version: args.version,
      goal: args.goal,
      features: args.features,
      progressLog: args.progressLog,
      context: args.context,
      createdAt: now,
      updatedAt: now,
    });
    return memoryId;
  },
});

export const insertTaskResult = internalMutation({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    taskId: v.string(),
    resultMarkdown: v.string(),
    citations: v.optional(v.any()),
    artifacts: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const resultId = await ctx.db.insert("dailyBriefTaskResults", {
      memoryId: args.memoryId,
      taskId: args.taskId,
      resultMarkdown: args.resultMarkdown,
      citations: args.citations,
      artifacts: args.artifacts,
      createdAt: Date.now(),
    });
    return resultId;
  },
});

export const updateTaskStatus = internalMutation({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    taskId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("failing"),
      v.literal("passing"),
    ),
    notes: v.optional(v.string()),
    resultId: v.optional(v.id("dailyBriefTaskResults")),
    logMessage: v.string(),
    logStatus: v.optional(v.union(
      v.literal("info"),
      v.literal("pending"),
      v.literal("working"),
      v.literal("passing"),
      v.literal("failing"),
      v.literal("error"),
    )),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId) as Doc<"dailyBriefMemories"> | null;
    if (!memory) throw new Error("Memory not found");

    const now = Date.now();

    const features = (memory.features as any[]).map((f: any) =>
      f.id === args.taskId
        ? {
            ...f,
            status: args.status,
            notes: args.notes ?? f.notes,
            resultId: args.resultId ?? f.resultId,
            updatedAt: now,
          }
        : f,
    );

    const progressLog = [
      ...(memory.progressLog as any[]),
      {
        ts: now,
        status:
          args.logStatus ??
          (args.status === "passing"
            ? "passing"
            : args.status === "failing"
              ? "failing"
              : "info"),
        message: args.logMessage,
        meta: args.meta,
      },
    ];

    await ctx.db.patch(memory._id, {
      features,
      progressLog,
      updatedAt: now,
    });
  },
});

export const setExecutiveBrief = internalMutation({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    payload: v.any(),
    generatedAt: v.number(),
    validation: v.optional(v.any()),
    record: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId) as Doc<"dailyBriefMemories"> | null;
    if (!memory) throw new Error("Memory not found");

    const now = Date.now();
    const context = stripReservedKeys(memory.context ?? {}) as any;
    const sanitizedPayload = stripReservedKeys(args.payload);
    const sanitizedValidation = args.validation ? stripReservedKeys(args.validation) : undefined;
    const sanitizedRecord = args.record ? stripReservedKeys(args.record) : undefined;

    await ctx.db.patch(memory._id, {
      context: {
        ...context,
        executiveBrief: sanitizedPayload,
        executiveBriefGeneratedAt: args.generatedAt,
        executiveBriefValidation: sanitizedValidation,
        ...(sanitizedRecord ? { executiveBriefRecord: sanitizedRecord } : {}),
      },
      updatedAt: now,
    });

    // Trigger narrative integration hook for high-priority brief features
    const features = Array.isArray(memory.features) ? (memory.features as any[]) : [];
    const narrativeFeatures = features
      .filter((f: any) => f && typeof f === "object")
      .map((f: any) => ({
        headline: String(f.headline || f.title || f.id || ""),
        summary: String(f.summary || f.description || ""),
        priority: typeof f.priority === "number" ? f.priority : 5,
        status: String(f.status || "pending"),
        sourceUrls: Array.isArray(f.sourceUrls) ? f.sourceUrls : [],
        type: String(f.type || "research"),
      }));

    if (narrativeFeatures.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.domains.narrative.integrations.hooks.onBriefGenerated,
        {
          briefId: args.memoryId,
          features: narrativeFeatures,
          generatedAt: args.generatedAt,
        }
      );
    }
  },
});

export const updateMemoryContext = internalMutation({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    contextPatch: v.any(),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId) as Doc<"dailyBriefMemories"> | null;
    if (!memory) throw new Error("Memory not found");

    const now = Date.now();
    const context = stripReservedKeys(memory.context ?? {}) as any;
    const patch = stripReservedKeys(args.contextPatch ?? {}) as any;

    await ctx.db.patch(memory._id, {
      context: {
        ...context,
        ...patch,
      },
      updatedAt: now,
    });
  },
});

export const appendFeatures = internalMutation({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    features: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db.get(args.memoryId) as Doc<"dailyBriefMemories"> | null;
    if (!memory) throw new Error("Memory not found");

    const existing = Array.isArray(memory.features) ? (memory.features as any[]) : [];
    const existingIds = new Set(
      existing.map((feature: any) => feature?.id).filter((id: any) => typeof id === "string"),
    );

    let added = 0;
    const next = [...existing];
    for (const rawFeature of args.features ?? []) {
      const feature = stripReservedKeys(rawFeature) as any;
      const id = typeof feature?.id === "string" ? feature.id : null;
      if (!id || existingIds.has(id)) continue;
      existingIds.add(id);
      next.push(feature);
      added += 1;
    }

    if (added > 0) {
      await ctx.db.patch(memory._id, {
        features: next,
        updatedAt: Date.now(),
      });
    }

    return { added };
  },
});
