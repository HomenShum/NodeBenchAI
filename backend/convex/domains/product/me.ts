import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveProductReadOwnerKeys, resolveProductIdentitySafely, requireProductIdentity } from "./helpers";
import { slugifyProductEntityName } from "./entities";

const PLACEHOLDER_PROFILE_SUMMARIES = new Set([
  "Private account context migrated into the new Me surface.",
  "Private context saved in Me.",
]);

function normalizeBackgroundSummary(summary?: string | null) {
  if (!summary) return "";
  const trimmed = summary.trim();
  if (!trimmed) return "";
  if (PLACEHOLDER_PROFILE_SUMMARIES.has(trimmed)) return "";
  return trimmed;
}

export const getMeSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) {
      return {
        profile: null,
        files: [],
        savedContext: [],
        settings: [],
      };
    }

    let profile: Record<string, any> | null = null;
    let files: any[] = [];
    let contextItems: any[] = [];
    try {
      const [profileCandidates, fileGroups, contextGroups] = await Promise.all([
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productProfileSummaries")
              .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
              .first(),
          ),
        ),
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productEvidenceItems")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(8),
          ),
        ),
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productContextItems")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(24),
          ),
        ),
      ]);

      profile = profileCandidates.find(Boolean) ?? null;
      files = fileGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof fileGroups)[number][number]>>((acc, file) => {
          if (acc.some((existing) => existing._id === file._id)) return acc;
          acc.push(file);
          return acc;
        }, [])
        .slice(0, 8);
      contextItems = contextGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof contextGroups)[number][number]>>((acc, item) => {
          if (acc.some((existing) => existing._id === item._id)) return acc;
          acc.push(item);
          return acc;
        }, [])
        .slice(0, 24);
    } catch (error) {
      console.error("[product] getMeSnapshot failed", {
        ownerKeys,
        error,
      });
      return {
        profile: null,
        files: [],
        savedContext: [],
        settings: [],
      };
    }

    const countByType = (type: string) =>
      contextItems.filter((item) => item.type === type).length;

    return {
      profile: profile
        ? {
            ...profile,
            backgroundSummary: normalizeBackgroundSummary(profile.backgroundSummary),
          }
        : null,
      files,
      savedContext: [
        { label: "Companies", value: String(countByType("company")) },
        { label: "People", value: String(countByType("person")) },
        { label: "Reports", value: String(countByType("report")) },
        { label: "Notes", value: String(countByType("note")) },
        { label: "Tasks", value: String(countByType("action")) },
      ],
      settings: [
        {
          label: "Privacy",
          value: profile ? "Saved to profile" : "Local only",
        },
        {
          label: "Permissions",
          value: contextItems.some((item) => item.permissions.chat) ? "Chat can use context" : "No context enabled",
        },
        {
          label: "Uploads",
          value: files.length > 0 ? "Saved to context" : "No uploads yet",
        },
        {
          label: "Export",
          value: "Report-first",
        },
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// File upload — uses productEvidenceItems as the canonical file store
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveFile = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    storageId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    entitySlug: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("file"),
        v.literal("document"),
        v.literal("image"),
        v.literal("voice"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const now = Date.now();
    const requestedEntitySlug = args.entitySlug?.trim() ? slugifyProductEntityName(args.entitySlug) : null;
    const entity =
      requestedEntitySlug
        ? await ctx.db
            .query("productEntities")
            .withIndex("by_owner_slug", (q) => q.eq("ownerKey", identity.ownerKey).eq("slug", requestedEntitySlug))
            .first()
        : null;

    // Derive evidence type from mime or explicit category
    let evidenceType: "file" | "document" | "image" | "voice" = args.category ?? "file";
    if (!args.category) {
      if (args.mimeType.startsWith("image/")) evidenceType = "image";
      else if (args.mimeType.startsWith("audio/")) evidenceType = "voice";
      else if (
        args.mimeType === "application/pdf" ||
        args.mimeType.startsWith("text/") ||
        args.mimeType.includes("document") ||
        args.mimeType.includes("spreadsheet")
      )
        evidenceType = "document";
    }

    const evidenceId = await ctx.db.insert("productEvidenceItems", {
      ownerKey: identity.ownerKey,
      entityId: entity?._id,
      type: evidenceType,
      label: args.name,
      description: `Uploaded file (${formatBytes(args.size)})`,
      status: entity ? "linked" : "ready",
      mimeType: args.mimeType,
      metadata: { storageId: args.storageId, originalSize: args.size },
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("productContextItems", {
      ownerKey: identity.ownerKey,
      type: "file",
      title: args.name,
      summary: entity
        ? `Attached to ${entity.name} so Chat and Reports can reuse it automatically.`
        : "Saved file available to Chat, Reports, and future entity memory.",
      tags: [evidenceType],
      entity: entity?.slug,
      permissions: {
        chat: true,
        reports: true,
        nudges: true,
      },
      createdAt: now,
      updatedAt: now,
    });

    return {
      evidenceId,
      entitySlug: entity?.slug ?? null,
      type: evidenceType,
      label: args.name,
    };
  },
});

export const saveContextCapture = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    type: v.union(v.literal("note"), v.literal("task")),
    content: v.string(),
    entitySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const now = Date.now();
    const trimmed = args.content.trim();
    if (!trimmed) {
      throw new Error("Capture content is required");
    }

    const requestedEntitySlug = args.entitySlug?.trim() ? slugifyProductEntityName(args.entitySlug) : null;
    const entity =
      requestedEntitySlug
        ? await ctx.db
            .query("productEntities")
            .withIndex("by_owner_slug", (q) => q.eq("ownerKey", identity.ownerKey).eq("slug", requestedEntitySlug))
            .first()
        : null;

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const headline = lines[0] ?? trimmed;
    const title = headline.length > 88 ? `${headline.slice(0, 87).trimEnd()}…` : headline;
    const summary = trimmed.length > 280 ? `${trimmed.slice(0, 279).trimEnd()}…` : trimmed;

    const contextItemId = await ctx.db.insert("productContextItems", {
      ownerKey: identity.ownerKey,
      type: args.type === "note" ? "note" : "action",
      title: args.type === "note" ? title : `Task: ${title}`,
      summary,
      tags: [args.type, "capture", entity?.slug ? "entity-linked" : "inbox"],
      entity: entity?.slug,
      permissions: {
        chat: true,
        reports: false,
        nudges: true,
      },
      createdAt: now,
      updatedAt: now,
    });

    return {
      contextItemId,
      type: args.type === "note" ? "note" : "action",
      entitySlug: entity?.slug ?? null,
      title,
    };
  },
});

/** Human-readable byte size */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const listFiles = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    if (!identity.ownerKey) return [];
    const files = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", identity.ownerKey!))
      .order("desc")
      .take(50);
    return Promise.all(
      files.map(async (file) => {
        const storageId =
          typeof (file.metadata as Record<string, unknown> | undefined)?.storageId === "string"
            ? ((file.metadata as Record<string, unknown>).storageId as string)
            : null;
        const storageUrl = storageId ? await ctx.storage.getUrl(storageId) : null;
        const size =
          typeof (file.metadata as Record<string, unknown> | undefined)?.originalSize === "number"
            ? ((file.metadata as Record<string, unknown>).originalSize as number)
            : typeof (file.metadata as Record<string, unknown> | undefined)?.size === "number"
              ? ((file.metadata as Record<string, unknown>).size as number)
              : null;
        return {
          ...file,
          storageUrl,
          size,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const updateProfile = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    backgroundSummary: v.optional(v.string()),
    preferredLens: v.optional(
      v.union(
        v.literal("founder"),
        v.literal("investor"),
        v.literal("banker"),
        v.literal("ceo"),
        v.literal("legal"),
        v.literal("student"),
      ),
    ),
    rolesOfInterest: v.optional(v.array(v.string())),
    preferences: v.optional(
      v.object({
        communicationStyle: v.optional(
          v.union(v.literal("concise"), v.literal("balanced"), v.literal("detailed")),
        ),
        evidenceStyle: v.optional(
          v.union(v.literal("balanced"), v.literal("citation_heavy"), v.literal("fast")),
        ),
        avoidCorporateTone: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const existing = await ctx.db
      .query("productProfileSummaries")
      .withIndex("by_owner", (q) => q.eq("ownerKey", identity.ownerKey))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        backgroundSummary: args.backgroundSummary ?? existing.backgroundSummary,
        preferredLens: args.preferredLens ?? existing.preferredLens,
        rolesOfInterest: args.rolesOfInterest ?? existing.rolesOfInterest,
        preferences: args.preferences ?? existing.preferences,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }

    const profileId = await ctx.db.insert("productProfileSummaries", {
      ownerKey: identity.ownerKey,
      backgroundSummary: args.backgroundSummary ?? "",
      preferredLens: args.preferredLens ?? "founder",
      rolesOfInterest: args.rolesOfInterest ?? [],
      preferences: args.preferences,
      createdAt: now,
      updatedAt: now,
    });

    return await ctx.db.get(profileId);
  },
});
