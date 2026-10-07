import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../../_generated/server";

type IntentSource = "voice" | "text" | "navigation" | "system" | "search";
type IntentStatus = "handled" | "fallback" | "failed";
type IntentHotspotColumn = "inbox" | "ralph_investigate" | "human_review" | "done";

type IntentHotspotMeta = {
  kind: "intent_hotspot";
  version: 1;
  signature: string;
  signatureDerivation: {
    intentKey: string;
    action: string;
    route: string;
    targetView: string;
  };
  column: IntentHotspotColumn;
  intentKey: string;
  action: string;
  label: string;
  firstSeenAt: number;
  lastSeenAt: number;
  attempts: number;
  handled: number;
  fallback: number;
  failed: number;
  hotnessScore: number;
  frictionScore: number;
  sampleInput?: string;
  sampleRoute?: string;
  sources: string[];
  targetViews: string[];
  investigation?: {
    artifactId: Id<"sourceArtifacts">;
    modelUsed: string;
    ranAt: number;
  };
};

function safeString(value: unknown, max = 2000): string {
  const normalized = typeof value === "string" ? value : value == null ? "" : String(value);
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function titleizeIntentKey(intentKey: string): string {
  const normalized = safeString(intentKey, 120)
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Unknown intent";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function signatureDerivation(input: {
  intentKey: string;
  action: string;
  route?: string;
  targetView?: string;
}) {
  return {
    intentKey: safeString(input.intentKey, 120),
    action: safeString(input.action, 120),
    route: safeString(input.route ?? "", 200),
    targetView: safeString(input.targetView ?? "", 120),
  };
}

function stableSignature(input: {
  intentKey: string;
  action: string;
  route?: string;
  targetView?: string;
}) {
  const derivation = signatureDerivation(input);
  const raw = JSON.stringify(derivation);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return { signature: `intent_${(hash >>> 0).toString(16).padStart(8, "0")}`, derivation };
}

function ratePercent(count: number, total: number): number {
  if (total <= 0) return 0;
  return (count / total) * 100;
}

function computeHotnessScore(input: { attempts: number; fallback: number; failed: number }): number {
  return input.attempts + input.fallback * 1.2 + input.failed * 1.8;
}

function computeFrictionScore(input: { attempts: number; fallback: number; failed: number }): number {
  const fallbackRate = ratePercent(input.fallback, input.attempts);
  const failureRate = ratePercent(input.failed, input.attempts);
  return fallbackRate * 0.7 + failureRate * 1.3 + Math.min(input.attempts, 25);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => safeString(value, 120).trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function trimPreview(value: unknown, max = 560): string | undefined {
  const trimmed = safeString(value, max).trim();
  return trimmed || undefined;
}

async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const sanitized = rawUserId.split("|")[0];
    return sanitized && sanitized.length >= 10 ? (sanitized as Id<"users">) : null;
  }
  return rawUserId;
}

function buildIntentSignalQuery(ctx: any, startMs?: number, endMs?: number) {
  if (startMs !== undefined && endMs !== undefined) {
    return ctx.db.query("intentSignals").withIndex("by_occurredAt", (q: any) => q.gte("occurredAt", startMs).lte("occurredAt", endMs));
  }
  if (startMs !== undefined) {
    return ctx.db.query("intentSignals").withIndex("by_occurredAt", (q: any) => q.gte("occurredAt", startMs));
  }
  if (endMs !== undefined) {
    return ctx.db.query("intentSignals").withIndex("by_occurredAt", (q: any) => q.lte("occurredAt", endMs));
  }
  return ctx.db.query("intentSignals").withIndex("by_occurredAt");
}

async function findExistingHotspotCard(
  ctx: any,
  signature: string,
  lookbackDays: number
): Promise<Doc<"agentTaskSessions"> | null> {
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const sessions = await ctx.db
    .query("agentTaskSessions")
    .withIndex("by_type_date", (q: any) => q.eq("type", "manual").gte("startedAt", cutoff))
    .order("desc")
    .take(500);

  for (const session of sessions as Doc<"agentTaskSessions">[]) {
    const meta = session.metadata as IntentHotspotMeta | undefined;
    if (meta?.kind !== "intent_hotspot") continue;
    if (meta.signature === signature) return session;
  }
  return null;
}

const intentSummaryValidator = v.object({
  totalSignals: v.number(),
  handledRate: v.number(),
  handled: v.number(),
  fallbackRate: v.number(),
  fallback: v.number(),
  uniqueIntents: v.number(),
  daysCovered: v.number(),
  lastSignalAgeHours: v.union(v.number(), v.null()),
});

export const trackIntentEvent = mutation({
  args: {
    source: v.union(
      v.literal("voice"),
      v.literal("text"),
      v.literal("navigation"),
      v.literal("system"),
      v.literal("search")
    ),
    intentKey: v.string(),
    action: v.string(),
    status: v.union(v.literal("handled"), v.literal("fallback"), v.literal("failed")),
    inputText: v.optional(v.string()),
    route: v.optional(v.string()),
    targetView: v.optional(v.string()),
    metadata: v.optional(v.any()),
    occurredAt: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    hotspotSessionId: v.optional(v.id("agentTaskSessions")),
    signature: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const occurredAt = args.occurredAt ?? Date.now();
    const day = new Date(occurredAt).toISOString().slice(0, 10);
    const userId = await getSafeUserId(ctx);

    await ctx.db.insert("intentSignals", {
      userId: userId ?? undefined,
      source: args.source,
      intentKey: safeString(args.intentKey, 120),
      action: safeString(args.action, 120),
      status: args.status,
      inputText: safeString(args.inputText, 2000) || undefined,
      route: safeString(args.route, 300) || undefined,
      targetView: safeString(args.targetView, 120) || undefined,
      metadata: args.metadata,
      day,
      occurredAt,
    } as any);

    const { signature, derivation } = stableSignature({
      intentKey: args.intentKey,
      action: args.action,
      route: args.route,
      targetView: args.targetView,
    });
    const existing = await findExistingHotspotCard(ctx, signature, 30);

    if (!existing && args.status === "handled") {
      return { ok: true };
    }

    const prevMeta = (existing?.metadata ?? null) as IntentHotspotMeta | null;
    const attempts = (prevMeta?.attempts ?? 0) + 1;
    const handled = (prevMeta?.handled ?? 0) + (args.status === "handled" ? 1 : 0);
    const fallback = (prevMeta?.fallback ?? 0) + (args.status === "fallback" ? 1 : 0);
    const failed = (prevMeta?.failed ?? 0) + (args.status === "failed" ? 1 : 0);
    const nextColumn: IntentHotspotColumn =
      prevMeta?.column === "done" && args.status !== "handled"
        ? "inbox"
        : (prevMeta?.column ?? "inbox");

    const meta: IntentHotspotMeta = {
      kind: "intent_hotspot",
      version: 1,
      signature,
      signatureDerivation: derivation,
      column: nextColumn,
      intentKey: safeString(args.intentKey, 120),
      action: safeString(args.action, 120),
      label: prevMeta?.label ?? titleizeIntentKey(args.intentKey),
      firstSeenAt: prevMeta?.firstSeenAt ?? occurredAt,
      lastSeenAt: occurredAt,
      attempts,
      handled,
      fallback,
      failed,
      hotnessScore: computeHotnessScore({ attempts, fallback, failed }),
      frictionScore: computeFrictionScore({ attempts, fallback, failed }),
      sampleInput: trimPreview(args.inputText, 320) ?? prevMeta?.sampleInput,
      sampleRoute: safeString(args.route, 200) || prevMeta?.sampleRoute,
      sources: uniqueStrings([...(prevMeta?.sources ?? []), args.source]),
      targetViews: uniqueStrings([...(prevMeta?.targetViews ?? []), args.targetView, args.route]),
      investigation: prevMeta?.investigation,
    };

    const title = `${meta.label} hotspot`;
    const description =
      `Telemetry hotspot derived from repeated intent friction.\n\n` +
      `Intent: ${meta.label}\n` +
      `Action: ${meta.action}\n` +
      `Attempts: ${meta.attempts}\n` +
      `Fallback: ${ratePercent(meta.fallback, meta.attempts).toFixed(1)}%\n` +
      `Failed: ${ratePercent(meta.failed, meta.attempts).toFixed(1)}%`;
    const sessionStatus = nextColumn === "done" ? "completed" : nextColumn === "ralph_investigate" ? "running" : "pending";

    if (existing) {
      await ctx.db.patch(existing._id, {
        title,
        description,
        status: sessionStatus,
        completedAt: nextColumn === "done" ? existing.completedAt ?? occurredAt : undefined,
        metadata: meta,
      } as any);
      return { ok: true, hotspotSessionId: existing._id, signature };
    }

    const sessionId = await ctx.db.insert("agentTaskSessions", {
      title,
      description,
      type: "manual",
      visibility: "private",
      userId: userId ?? undefined,
      status: sessionStatus,
      startedAt: occurredAt,
      metadata: meta,
    } as any);

    return { ok: true, hotspotSessionId: sessionId as Id<"agentTaskSessions">, signature };
  },
});

export const getIntentRadar = query({
  args: {
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    summary: intentSummaryValidator,
    intentSummary: intentSummaryValidator,
    hottest: v.array(
      v.object({
        intentKey: v.string(),
        label: v.string(),
        attempts: v.number(),
        hotnessScore: v.number(),
        sampleInput: v.optional(v.string()),
      })
    ),
    friction: v.array(
      v.object({
        intentKey: v.string(),
        label: v.string(),
        attempts: v.number(),
        fallbackRate: v.number(),
        failureRate: v.number(),
        frictionScore: v.number(),
        failed: v.number(),
        sources: v.array(v.string()),
      })
    ),
    opportunities: v.array(
      v.object({
        title: v.string(),
        detail: v.string(),
      })
    ),
    sourceBreakdown: v.array(
      v.object({
        source: v.string(),
        attempts: v.number(),
        handledRate: v.number(),
        fallbackRate: v.number(),
        failureRate: v.number(),
      })
    ),
    recentSignals: v.array(
      v.object({
        intentKey: v.string(),
        occurredAt: v.number(),
        label: v.string(),
        source: v.string(),
        status: v.string(),
        route: v.optional(v.string()),
        inputText: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 6, 1), 25);
    const startMs = args.startMs !== undefined && args.endMs !== undefined && args.endMs < args.startMs ? args.endMs : args.startMs;
    const endMs = args.startMs !== undefined && args.endMs !== undefined && args.endMs < args.startMs ? args.startMs : args.endMs;
    const events = await buildIntentSignalQuery(ctx, startMs, endMs).order("desc").take(2500);

    const byIntent = new Map<string, {
      intentKey: string;
      label: string;
      attempts: number;
      handled: number;
      fallback: number;
      failed: number;
      sources: Set<string>;
      targetViews: Set<string>;
      sampleInput?: string;
    }>();
    const bySource = new Map<IntentSource, { attempts: number; handled: number; fallback: number; failed: number }>();
    const coveredDays = new Set<string>();

    for (const event of events as Doc<"intentSignals">[]) {
      coveredDays.add(event.day);
      const bucket = byIntent.get(event.intentKey) ?? {
        intentKey: event.intentKey,
        label: titleizeIntentKey(event.intentKey),
        attempts: 0,
        handled: 0,
        fallback: 0,
        failed: 0,
        sources: new Set<string>(),
        targetViews: new Set<string>(),
        sampleInput: undefined,
      };
      bucket.attempts += 1;
      if (event.status === "handled") bucket.handled += 1;
      if (event.status === "fallback") bucket.fallback += 1;
      if (event.status === "failed") bucket.failed += 1;
      bucket.sources.add(event.source);
      if (event.targetView) bucket.targetViews.add(event.targetView);
      if (event.route) bucket.targetViews.add(event.route);
      if (!bucket.sampleInput && event.inputText) bucket.sampleInput = trimPreview(event.inputText, 180);
      byIntent.set(event.intentKey, bucket);

      const sourceBucket = bySource.get(event.source) ?? { attempts: 0, handled: 0, fallback: 0, failed: 0 };
      sourceBucket.attempts += 1;
      if (event.status === "handled") sourceBucket.handled += 1;
      if (event.status === "fallback") sourceBucket.fallback += 1;
      if (event.status === "failed") sourceBucket.failed += 1;
      bySource.set(event.source, sourceBucket);
    }

    const totalSignals = events.length;
    const handled = events.filter((event: Doc<"intentSignals">) => event.status === "handled").length;
    const fallback = events.filter((event: Doc<"intentSignals">) => event.status === "fallback").length;
    const summary = {
      totalSignals,
      handledRate: ratePercent(handled, totalSignals),
      handled,
      fallbackRate: ratePercent(fallback, totalSignals),
      fallback,
      uniqueIntents: byIntent.size,
      daysCovered: coveredDays.size,
      lastSignalAgeHours: events[0] ? Math.max(0, (Date.now() - events[0].occurredAt) / (60 * 60 * 1000)) : null,
    };

    const hottest = Array.from(byIntent.values())
      .map((bucket) => ({
        intentKey: bucket.intentKey,
        label: bucket.label,
        attempts: bucket.attempts,
        hotnessScore: computeHotnessScore(bucket),
        sampleInput: bucket.sampleInput,
      }))
      .sort((a, b) => b.hotnessScore - a.hotnessScore || b.attempts - a.attempts)
      .slice(0, limit);

    const friction = Array.from(byIntent.values())
      .map((bucket) => ({
        intentKey: bucket.intentKey,
        label: bucket.label,
        attempts: bucket.attempts,
        fallbackRate: ratePercent(bucket.fallback, bucket.attempts),
        failureRate: ratePercent(bucket.failed, bucket.attempts),
        frictionScore: computeFrictionScore(bucket),
        failed: bucket.failed,
        sources: Array.from(bucket.sources),
      }))
      .filter((bucket) => bucket.fallbackRate > 0 || bucket.failureRate > 0)
      .sort((a, b) => b.frictionScore - a.frictionScore || b.attempts - a.attempts)
      .slice(0, limit);

    const opportunities = friction.slice(0, 3).map((bucket) => {
      const failureHeavy = bucket.failureRate >= bucket.fallbackRate;
      return {
        title: failureHeavy ? `Reduce hard failures for ${bucket.label}` : `Shorten the fallback path for ${bucket.label}`,
        detail:
          `${bucket.attempts} attempts with ${bucket.fallbackRate.toFixed(1)}% fallback and ` +
          `${bucket.failureRate.toFixed(1)}% failure. Prioritize ${bucket.sources.length ? bucket.sources.join(", ") : "mixed sources"}.`,
      };
    });

    const sourceBreakdown = Array.from(bySource.entries())
      .map(([source, bucket]) => ({
        source,
        attempts: bucket.attempts,
        handledRate: ratePercent(bucket.handled, bucket.attempts),
        fallbackRate: ratePercent(bucket.fallback, bucket.attempts),
        failureRate: ratePercent(bucket.failed, bucket.attempts),
      }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, limit);

    const recentSignals = (events as Doc<"intentSignals">[]).slice(0, Math.max(limit * 2, 8)).map((event) => ({
      intentKey: event.intentKey,
      occurredAt: event.occurredAt,
      label: titleizeIntentKey(event.intentKey),
      source: event.source,
      status: event.status,
      route: event.route,
      inputText: trimPreview(event.inputText, 220),
    }));

    return {
      summary,
      intentSummary: summary,
      hottest,
      friction,
      opportunities,
      sourceBreakdown,
      recentSignals,
    };
  },
});

export const listIntentHotspotCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.id("agentTaskSessions"),
      title: v.string(),
      status: v.string(),
      startedAt: v.number(),
      updatedAt: v.optional(v.number()),
      signature: v.string(),
      column: v.string(),
      intentKey: v.string(),
      action: v.string(),
      attempts: v.number(),
      handledRate: v.number(),
      fallbackRate: v.number(),
      failureRate: v.number(),
      hotnessScore: v.number(),
      frictionScore: v.number(),
      lastSeenAt: v.number(),
      sampleInput: v.optional(v.string()),
      sources: v.array(v.string()),
      targetViews: v.array(v.string()),
      investigationArtifactId: v.optional(v.id("sourceArtifacts")),
      investigationTitle: v.optional(v.string()),
      investigationPreview: v.optional(v.string()),
      investigationModelUsed: v.optional(v.string()),
      investigationRanAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date", (q: any) => q.eq("type", "manual"))
      .order("desc")
      .take(2000);

    const columnRank: Record<string, number> = {
      inbox: 0,
      ralph_investigate: 1,
      human_review: 2,
      done: 3,
    };

    const candidates = (sessions as Doc<"agentTaskSessions">[])
      .map((session) => ({ session, meta: session.metadata as IntentHotspotMeta | undefined }))
      .filter((entry) => entry.meta?.kind === "intent_hotspot")
      .sort((a, b) => {
        const rankDiff = (columnRank[a.meta?.column ?? "done"] ?? 9) - (columnRank[b.meta?.column ?? "done"] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        return (b.meta?.lastSeenAt ?? b.session.startedAt) - (a.meta?.lastSeenAt ?? a.session.startedAt);
      })
      .slice(0, limit);

    return await Promise.all(
      candidates.map(async ({ session, meta }) => {
        const artifactId = meta?.investigation?.artifactId;
        const artifact = artifactId ? await ctx.db.get(artifactId) : null;
        return {
          id: session._id,
          title: session.title,
          status: session.status,
          startedAt: session.startedAt,
          updatedAt: session.completedAt,
          signature: meta!.signature,
          column: meta!.column,
          intentKey: meta!.intentKey,
          action: meta!.action,
          attempts: meta!.attempts,
          handledRate: ratePercent(meta!.handled, meta!.attempts),
          fallbackRate: ratePercent(meta!.fallback, meta!.attempts),
          failureRate: ratePercent(meta!.failed, meta!.attempts),
          hotnessScore: meta!.hotnessScore,
          frictionScore: meta!.frictionScore,
          lastSeenAt: meta!.lastSeenAt,
          sampleInput: meta!.sampleInput,
          sources: meta!.sources,
          targetViews: meta!.targetViews,
          investigationArtifactId: artifactId,
          investigationTitle: safeString(artifact?.title, 140) || undefined,
          investigationPreview: trimPreview(artifact?.rawContent, 720),
          investigationModelUsed: meta!.investigation?.modelUsed,
          investigationRanAt: meta!.investigation?.ranAt,
        };
      })
    );
  },
});

export const exportIntentHotspotCardsForOps = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 2000);
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date", (q: any) => q.eq("type", "manual"))
      .order("desc")
      .take(5000);

    const cards: any[] = [];
    for (const session of sessions as Doc<"agentTaskSessions">[]) {
      const meta = session.metadata as IntentHotspotMeta | undefined;
      if (meta?.kind !== "intent_hotspot") continue;

      const artifactId = meta.investigation?.artifactId;
      const artifact = artifactId ? await ctx.db.get(artifactId) : null;
      cards.push({
        sessionId: session._id,
        title: session.title,
        description: session.description ?? "",
        startedAt: session.startedAt,
        status: session.status,
        meta,
        artifacts: {
          investigation: artifact
            ? {
                id: artifact._id,
                fetchedAt: artifact.fetchedAt,
                title: artifact.title,
                rawContent: typeof artifact.rawContent === "string" ? artifact.rawContent.slice(0, 12000) : null,
                extractedData: artifact.extractedData ?? null,
              }
            : null,
        },
      });
      if (cards.length >= limit) break;
    }

    return { ok: true, exportedAtIso: new Date().toISOString(), cards };
  },
});

export const moveIntentHotspotCard = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    toColumn: v.union(
      v.literal("inbox"),
      v.literal("ralph_investigate"),
      v.literal("human_review"),
      v.literal("done")
    ),
  },
  returns: v.object({ ok: v.boolean(), column: v.string() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Intent hotspot session not found");
    const meta = session.metadata as IntentHotspotMeta | undefined;
    if (meta?.kind !== "intent_hotspot") throw new Error("Not an intent hotspot card");

    const now = Date.now();
    const nextMeta: IntentHotspotMeta = { ...meta, column: args.toColumn };
    const status = args.toColumn === "done" ? "completed" : args.toColumn === "ralph_investigate" ? "running" : "pending";

    await ctx.db.patch(args.sessionId, {
      status,
      completedAt: args.toColumn === "done" ? now : undefined,
      metadata: nextMeta,
    } as any);

    if (args.toColumn === "ralph_investigate") {
      await ctx.scheduler.runAfter(0, internal.domains.analytics.intentSignals.investigateIntentHotspotCard, {
        sessionId: args.sessionId,
      });
    }

    return { ok: true, column: args.toColumn };
  },
});

export const investigateIntentHotspotCard = internalAction({
  args: { sessionId: v.id("agentTaskSessions") },
  returns: v.object({ ok: v.boolean(), investigationArtifactId: v.id("sourceArtifacts") }),
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(internal.domains.analytics.intentSignals.getIntentHotspotSessionInternal, {
      sessionId: args.sessionId,
    });
    if (!session) throw new Error("Intent hotspot session not found");

    const meta = (session as any).metadata as IntentHotspotMeta | undefined;
    if (meta?.kind !== "intent_hotspot") throw new Error("Not an intent hotspot card");

    const context = {
      signature: meta.signature,
      intentKey: meta.intentKey,
      action: meta.action,
      label: meta.label,
      attempts: meta.attempts,
      handledRate: ratePercent(meta.handled, meta.attempts),
      fallbackRate: ratePercent(meta.fallback, meta.attempts),
      failureRate: ratePercent(meta.failed, meta.attempts),
      sampleInput: meta.sampleInput ?? null,
      targetViews: meta.targetViews,
      sources: meta.sources,
      firstSeenAt: meta.firstSeenAt,
      lastSeenAt: meta.lastSeenAt,
    };

    let content: string;
    let modelUsed: string;
    try {
      const response = await ctx.runAction(internal.domains.models.autonomousModelResolver.executeWithFallback, {
        taskType: "analysis",
        messages: [
          {
            role: "system",
            content:
              "You are an operator triage agent reviewing intent telemetry friction. Produce a concise investigation brief with sections: Summary, Likely causes, UX leaks, Suggested fixes, and Verification plan. Do not claim a fix was applied. No markdown tables. No em dash.",
          },
          {
            role: "user",
            content: `Intent hotspot context JSON:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
        maxTokens: 700,
        temperature: 0.2,
      });
      content = response.content;
      modelUsed = response.modelUsed;
    } catch (error) {
      content =
        "Summary\nAutomation could not generate an investigation brief.\n\n" +
        "Likely causes\n- Autonomous model resolver is unavailable or missing configuration.\n\n" +
        "Suggested fixes\n- Verify autonomous model credentials and retry the investigation action.\n- Review recent intent telemetry in Recommendation Analytics for this hotspot.\n\n" +
        `Failure detail\n${safeString((error as Error)?.message, 400) || "Unknown investigation error."}`;
      modelUsed = "fallback_manual";
    }

    const stored = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
      sourceType: "extracted_text",
      sourceUrl: `ops://intent_hotspot/${meta.signature}`,
      title: `Intent hotspot investigation ${meta.signature}`,
      rawContent: content,
      extractedData: {
        kind: "intent_hotspot_investigation",
        signature: meta.signature,
        sessionId: String(args.sessionId),
        modelUsed,
        context,
      },
      fetchedAt: Date.now(),
    });

    const nextMeta: IntentHotspotMeta = {
      ...meta,
      column: "human_review",
      investigation: {
        artifactId: stored.id as Id<"sourceArtifacts">,
        modelUsed,
        ranAt: Date.now(),
      },
    };

    await ctx.runMutation(internal.domains.analytics.intentSignals.patchIntentHotspotMetadataInternal, {
      sessionId: args.sessionId,
      metadata: nextMeta,
      status: "pending",
      completedAt: undefined,
    });

    return { ok: true, investigationArtifactId: stored.id as Id<"sourceArtifacts"> };
  },
});

export const getIntentHotspotSessionInternal = internalQuery({
  args: { sessionId: v.id("agentTaskSessions") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const patchIntentHotspotMetadataInternal = internalMutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    metadata: v.any(),
    status: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      metadata: args.metadata,
      status: args.status,
      completedAt: args.completedAt,
    } as any);
    return null;
  },
});
