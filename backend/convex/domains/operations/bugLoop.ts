import { v } from "convex/values";
import { mutation, query, internalAction, internalQuery, internalMutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { recomputeSourceSearchableText } from "../search/searchableTextRecompute";

type BugColumn =
  | "inbox"
  | "ralph_investigate"
  | "human_approve"
  | "ralph_fix"
  | "human_review"
  | "done"
  | "wont_fix";

type BugCardMeta = {
  kind: "bug_card";
  version: 1;
  signature: string;
  signatureDerivation: {
    messageHead: string;
    stackHead: string;
    route: string;
    section: string;
  };
  column: BugColumn;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  occurrenceArtifacts: Array<{
    artifactId: Id<"sourceArtifacts">;
    at: number;
    message: string;
    route?: string;
    section?: string;
  }>;
  sample: {
    message: string;
    stack?: string;
    route?: string;
    section?: string;
  };
  env?: {
    userAgent?: string;
    url?: string;
  };
  investigation?: {
    artifactId: Id<"sourceArtifacts">;
    modelUsed: string;
    ranAt: number;
  };
};

function safeString(value: unknown, max = 2000): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function signatureDerivation(input: {
  message: string;
  stack?: string;
  route?: string;
  section?: string;
}): { messageHead: string; stackHead: string; route: string; section: string } {
  const stackHead = safeString(input.stack ?? "", 400)
    .split("\n")
    .slice(0, 6)
    .join("\n");
  const messageHead = safeString(input.message, 300);
  const route = safeString(input.route ?? "", 200);
  const section = safeString(input.section ?? "", 80);
  return { messageHead, stackHead, route, section };
}

function stableSignature(input: {
  message: string;
  stack?: string;
  route?: string;
  section?: string;
}): { signature: string; derivation: BugCardMeta["signatureDerivation"] } {
  const derivation = signatureDerivation(input);
  const raw = JSON.stringify(derivation);
  // lightweight deterministic hash
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return { signature: `bug_${(hash >>> 0).toString(16).padStart(8, "0")}`, derivation };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function findExistingCard(
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

  for (const s of sessions as Doc<"agentTaskSessions">[]) {
    const meta: any = s.metadata;
    if (meta?.kind !== "bug_card") continue;
    if (meta?.signature === signature) return s;
  }
  return null;
}

export const reportClientError = mutation({
  args: {
    message: v.string(),
    stack: v.optional(v.string()),
    route: v.optional(v.string()),
    section: v.optional(v.string()),
    url: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    created: v.boolean(),
    sessionId: v.id("agentTaskSessions"),
    signature: v.string(),
    column: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const sig = stableSignature({
      message: args.message,
      stack: args.stack,
      route: args.route,
      section: args.section,
    });
    const signature = sig.signature;

    const occurrencePayload = {
      kind: "bug_occurrence",
      signature,
      at: now,
      message: safeString(args.message, 4000),
      stack: safeString(args.stack, 16000) || undefined,
      route: safeString(args.route, 300) || undefined,
      section: safeString(args.section, 120) || undefined,
      url: safeString(args.url, 1200) || undefined,
      userAgent: safeString(args.userAgent, 800) || undefined,
    };
    const occurrenceRaw = JSON.stringify(occurrencePayload, null, 2);
    const occurrenceHash = await sha256Hex(occurrenceRaw);
    const sourceUrl = `bug://client_error/${signature}`;
    const existingArtifact = await ctx.db
      .query("sourceArtifacts")
      .withIndex("by_sourceUrl_hash", (q: any) => q.eq("sourceUrl", sourceUrl).eq("contentHash", occurrenceHash))
      .first() as Doc<"sourceArtifacts"> | null;
    const occurrenceArtifactId =
      existingArtifact?._id ??
      (await ctx.db.insert("sourceArtifacts", {
        runId: undefined,
        sourceType: "extracted_text",
        sourceUrl,
        contentHash: occurrenceHash,
        rawContent: occurrenceRaw,
        rawStorageId: undefined,
        mimeType: "application/json",
        sizeBytes: occurrenceRaw.length,
        title: `Bug occurrence ${signature}`,
        extractedData: occurrencePayload,
        // PR D: populate searchableText for the federated `search_sources`.
        searchableText: recomputeSourceSearchableText({
          title: `Bug occurrence ${signature}`,
          sourceUrl,
          mimeType: "application/json",
        }),
        fetchedAt: now,
        expiresAt: undefined,
      }));

    const existing = await findExistingCard(ctx, signature, 7);
    if (existing) {
      const prevMeta: any = existing.metadata;
      const meta: BugCardMeta = {
        kind: "bug_card",
        version: 1,
        signature,
        signatureDerivation: sig.derivation,
        column: (prevMeta?.column as BugColumn) ?? "inbox",
        firstSeenAt: (prevMeta?.firstSeenAt as number) ?? existing.startedAt,
        lastSeenAt: now,
        occurrenceCount: ((prevMeta?.occurrenceCount as number) ?? 1) + 1,
        occurrenceArtifacts: [
          ...(Array.isArray(prevMeta?.occurrenceArtifacts) ? (prevMeta.occurrenceArtifacts as any[]) : []),
          {
            artifactId: occurrenceArtifactId as Id<"sourceArtifacts">,
            at: now,
            message: safeString(args.message, 1200),
            route: safeString(args.route, 300) || undefined,
            section: safeString(args.section, 120) || undefined,
          },
        ].slice(-25),
        sample: {
          message: safeString(args.message, 1200),
          stack: safeString(args.stack, 4000) || undefined,
          route: safeString(args.route, 300) || undefined,
          section: safeString(args.section, 120) || undefined,
        },
        env: {
          userAgent: safeString(args.userAgent, 400) || undefined,
          url: safeString(args.url, 800) || undefined,
        },
        investigation: prevMeta?.investigation,
      };

      await ctx.db.patch(existing._id, {
        status: "pending",
        errorMessage: safeString(args.message, 800) || undefined,
        errorStack: safeString(args.stack, 4000) || undefined,
        metadata: meta,
      });

      return {
        ok: true,
        created: false,
        sessionId: existing._id,
        signature,
        column: meta.column,
      };
    }

    const meta: BugCardMeta = {
      kind: "bug_card",
      version: 1,
      signature,
      signatureDerivation: sig.derivation,
      column: "inbox",
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1,
      occurrenceArtifacts: [
        {
          artifactId: occurrenceArtifactId as Id<"sourceArtifacts">,
          at: now,
          message: safeString(args.message, 1200),
          route: safeString(args.route, 300) || undefined,
          section: safeString(args.section, 120) || undefined,
        },
      ],
      sample: {
        message: safeString(args.message, 1200),
        stack: safeString(args.stack, 4000) || undefined,
        route: safeString(args.route, 300) || undefined,
        section: safeString(args.section, 120) || undefined,
      },
      env: {
        userAgent: safeString(args.userAgent, 400) || undefined,
        url: safeString(args.url, 800) || undefined,
      },
    };

    const title = `Bug card ${signature}`;
    const description = `Auto-captured client error.\n\nMessage: ${safeString(args.message, 800)}\nRoute: ${safeString(args.route, 200)}\nSection: ${safeString(args.section, 80)}`;

    const sessionId = await ctx.db.insert("agentTaskSessions", {
      title,
      description,
      type: "manual",
      visibility: "private",
      status: "pending",
      startedAt: now,
      errorMessage: safeString(args.message, 800) || undefined,
      errorStack: safeString(args.stack, 4000) || undefined,
      metadata: meta,
    } as any);

    return {
      ok: true,
      created: true,
      sessionId: sessionId as Id<"agentTaskSessions">,
      signature,
      column: meta.column,
    };
  },
});

export const listBugCards = query({
  args: {
    column: v.optional(v.string()),
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
      occurrenceCount: v.number(),
      lastSeenAt: v.number(),
      sampleMessage: v.string(),
      route: v.optional(v.string()),
      section: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date", (q: any) => q.eq("type", "manual"))
      .order("desc")
      .take(2000);

    const out: any[] = [];
    for (const s of sessions as Doc<"agentTaskSessions">[]) {
      const meta: any = s.metadata;
      if (meta?.kind !== "bug_card") continue;
      const col = String(meta?.column ?? "inbox");
      if (args.column && col !== args.column) continue;
      out.push({
        id: s._id,
        title: s.title,
        status: s.status,
        startedAt: s.startedAt,
        updatedAt: s.completedAt,
        signature: String(meta.signature ?? ""),
        column: col,
        occurrenceCount: Number(meta.occurrenceCount ?? 1),
        lastSeenAt: Number(meta.lastSeenAt ?? s.startedAt),
        sampleMessage: String(meta.sample?.message ?? s.errorMessage ?? ""),
        route: meta.sample?.route ? String(meta.sample.route) : undefined,
        section: meta.sample?.section ? String(meta.sample.section) : undefined,
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});

export const moveBugCard = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    toColumn: v.string(),
  },
  returns: v.object({ ok: v.boolean(), column: v.string() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    const meta: any = session.metadata;
    if (meta?.kind !== "bug_card") throw new Error("Not a bug card");
    const to = String(args.toColumn) as BugColumn;
    const nextMeta = { ...meta, column: to } as BugCardMeta;
    await ctx.db.patch(args.sessionId, { metadata: nextMeta });

    // Kick off investigation when a human moves into Ralph's column.
    if (to === "ralph_investigate") {
      await ctx.scheduler.runAfter(0, internal.domains.operations.bugLoop.investigateBugCard, {
        sessionId: args.sessionId,
      });
    }

    return { ok: true, column: to };
  },
});

export const investigateBugCard = internalAction({
  args: { sessionId: v.id("agentTaskSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(internal.domains.operations.bugLoop.getBugCardSessionInternal, {
      sessionId: args.sessionId,
    });
    if (!session) throw new Error("Session not found");

    const meta: any = (session as any).metadata;
    if (meta?.kind !== "bug_card") throw new Error("Not a bug card");

    const context = {
      signature: meta.signature,
      occurrenceCount: meta.occurrenceCount,
      firstSeenAt: meta.firstSeenAt,
      lastSeenAt: meta.lastSeenAt,
      sample: meta.sample,
      env: meta.env,
      signatureDerivation: meta.signatureDerivation ?? null,
    };

    const response = await ctx.runAction(internal.domains.models.autonomousModelResolver.executeWithFallback, {
      taskType: "analysis",
      messages: [
        {
          role: "system",
          content:
            "You are an engineering triage agent. Given a client error report, produce a short investigation plan. " +
            "Do not claim to have fixed anything. Do not speculate about root cause beyond likely hypotheses. " +
            "Output format: JSON with keys: summary, likelyCauses (array), reproSteps (array), filesToInspect (array), testsToAdd (array). " +
            "Hard rules: no em dash, no en dash, no emojis.",
        },
        { role: "user", content: `Error context JSON:\n${JSON.stringify(context, null, 2)}` },
      ],
      maxTokens: 650,
      temperature: 0.2,
    });

    const stored = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
      sourceType: "extracted_text",
      sourceUrl: `ops://bug_investigation/${meta.signature}`,
      title: `Bug investigation ${meta.signature}`,
      rawContent: response.content,
      extractedData: {
        kind: "bug_investigation",
        signature: meta.signature,
        sessionId: String(args.sessionId),
        modelUsed: response.modelUsed,
        context,
      },
      fetchedAt: Date.now(),
    });

    const nextMeta: BugCardMeta = {
      ...(meta as BugCardMeta),
      investigation: {
        artifactId: stored.id as Id<"sourceArtifacts">,
        modelUsed: String(response.modelUsed),
        ranAt: Date.now(),
      },
      column: "human_approve",
    };
    await ctx.runMutation(internal.domains.operations.bugLoop.patchBugCardMetadataInternal, {
      sessionId: args.sessionId,
      metadata: nextMeta,
    });

    return { ok: true, investigationArtifactId: String(stored.id) };
  },
});

export const getBugCardSessionInternal = internalQuery({
  args: { sessionId: v.id("agentTaskSessions") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const patchBugCardMetadataInternal = internalMutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    metadata: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { metadata: args.metadata });
    return null;
  },
});

export const exportBugCardsForVault = internalQuery({
  args: {
    limit: v.optional(v.number()),
    maxOccurrencesPerCard: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 2000);
    const maxOccurrencesPerCard = Math.min(Math.max(args.maxOccurrencesPerCard ?? 10, 1), 50);

    const sessions = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_type_date", (q: any) => q.eq("type", "manual"))
      .order("desc")
      .take(5000);

    const cards: any[] = [];
    for (const s of sessions as Doc<"agentTaskSessions">[]) {
      const meta: any = s.metadata;
      if (meta?.kind !== "bug_card") continue;
      const occurrences = Array.isArray(meta?.occurrenceArtifacts) ? (meta.occurrenceArtifacts as any[]).slice(-maxOccurrencesPerCard) : [];
      const occurrenceArtifacts = await Promise.all(
        occurrences
          .map((o) => o?.artifactId)
          .filter((id) => typeof id === "string")
          .map(async (id) => {
            const art = await ctx.db.get(id as any);
            if (!art) return null;
            return {
              id: art._id,
              sourceUrl: art.sourceUrl,
              fetchedAt: art.fetchedAt,
              title: art.title,
              mimeType: art.mimeType,
              extractedData: art.extractedData ?? null,
            };
          })
      );

      const invId = meta?.investigation?.artifactId;
      const invArt = invId ? await ctx.db.get(invId as any) : null;
      const investigation = invArt
        ? {
            id: invArt._id,
            fetchedAt: invArt.fetchedAt,
            title: invArt.title,
            rawContent: typeof invArt.rawContent === "string" ? invArt.rawContent.slice(0, 12000) : null,
            extractedData: invArt.extractedData ?? null,
          }
        : null;

      cards.push({
        sessionId: s._id,
        title: s.title,
        description: s.description ?? "",
        startedAt: s.startedAt,
        status: s.status,
        meta: {
          ...meta,
          occurrenceArtifacts: occurrences,
        },
        artifacts: {
          occurrences: occurrenceArtifacts.filter(Boolean),
          investigation,
        },
      });
      if (cards.length >= limit) break;
    }
    return { ok: true, exportedAtIso: new Date().toISOString(), cards };
  },
});
