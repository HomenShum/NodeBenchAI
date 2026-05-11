import { mutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { requireProductIdentity } from "./helpers";
import { ensureEntityForReport, upsertEntityContextItem } from "./entities";
import { upsertOpenProductNudge } from "./nudgeHelpers";
import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
} from "../search/searchableTextRecompute";

const PRODUCT_SCHEMA_VERSION = "2026-04-12-entity-v3";

const PRODUCT_OWNED_TABLES = [
  { table: "productMigrationState", ownerIndex: "by_owner" },
  { table: "productInputBundles", ownerIndex: "by_owner_updated" },
  { table: "productEvidenceItems", ownerIndex: "by_owner_updated" },
  { table: "productChatSessions", ownerIndex: "by_owner_updated" },
  { table: "productChatEvents", ownerIndex: "by_owner_created" },
  { table: "productToolEvents", ownerIndex: "by_owner_updated" },
  { table: "productRunEvents", ownerIndex: "by_owner_created" },
  { table: "productResolutionCandidates", ownerIndex: "by_owner_updated" },
  { table: "productSourceEvents", ownerIndex: "by_owner_created" },
  { table: "productReportDrafts", ownerIndex: "by_owner_updated" },
  { table: "productClaims", ownerIndex: "by_owner_created" },
  { table: "productClaimSupports", ownerIndex: "by_owner_created" },
  { table: "productClaimReviews", ownerIndex: "by_owner_created" },
  { table: "productEntities", ownerIndex: "by_owner_updated" },
  { table: "productEntityNotes", ownerIndex: "by_owner_updated" },
  { table: "productDocuments", ownerIndex: "by_owner_updated" },
  { table: "productDocumentBlocks", ownerIndex: "by_owner_document" },
  { table: "productDocumentEntityLinks", ownerIndex: null },
  { table: "productDocumentSourceLinks", ownerIndex: null },
  { table: "productDocumentEvents", ownerIndex: "by_owner_created" },
  { table: "productDocumentSnapshots", ownerIndex: "by_owner_created" },
  { table: "productReports", ownerIndex: "by_owner_updated" },
  { table: "productReportRefreshes", ownerIndex: "by_owner_created" },
  { table: "productNudges", ownerIndex: "by_owner_status_updated" },
  { table: "productProfileSummaries", ownerIndex: "by_owner" },
  { table: "productContextItems", ownerIndex: "by_owner_updated" },
  { table: "productWorkspaceShares", ownerIndex: "by_owner_updated" },
  { table: "productEntityWorkspaceMembers", ownerIndex: "by_owner_entity_updated" },
  { table: "productEntityWorkspaceInvites", ownerIndex: "by_owner_entity_updated" },
  { table: "productEntityRelations", ownerIndex: null },
  { table: "productBlocks", ownerIndex: "by_owner_entity_position" },
  { table: "productBlockRelations", ownerIndex: null },
  { table: "productBlockWriteWindows", ownerIndex: "by_owner_session_bucket" },
] as const;

const DEFAULT_PUBLIC_CARDS = [
  {
    key: "company_report",
    title: "Company report",
    summary: "Start with a company and get a clean summary, the main risks, and what to do next.",
    prompt: "What is this company and what matters most right now?",
    lens: "founder" as const,
    sourceLabel: "NodeBench public card",
    rank: 10,
  },
  {
    key: "market_report",
    title: "Market report",
    summary: "Turn a market, category, or trend into a report with useful sources and clear watch items.",
    prompt: "What are the biggest risks in this market?",
    lens: "investor" as const,
    sourceLabel: "NodeBench public card",
    rank: 20,
  },
  {
    key: "role_fit",
    title: "Role fit",
    summary: "Compare a role, resume, or recruiter message against your background and surface the gaps fast.",
    prompt: "Compare this role to my experience and resume.",
    lens: "student" as const,
    sourceLabel: "NodeBench public card",
    rank: 30,
  },
];

function extractSnippet(document: Doc<"documents">) {
  if (typeof document.summary === "string" && document.summary.trim()) {
    return document.summary.trim().slice(0, 320);
  }

  if (typeof document.content === "string" && document.content.trim()) {
    return document.content
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320);
  }

  return "Saved work migrated into the new report model.";
}

function buildReportSections(title: string, summary: string) {
  return [
    {
      id: "what-it-is",
      title: "What it is",
      body: summary,
      status: "complete" as const,
    },
    {
      id: "why-it-matters",
      title: "Why it matters",
      body: `${title} is part of your saved work and can now be reopened through the unified Reports and Chat flow.`,
      status: "complete" as const,
    },
    {
      id: "what-is-missing",
      title: "What is missing",
      body: "This migrated report has not been refreshed through the new chat pipeline yet, so newer sources may still need to be pulled.",
      status: "complete" as const,
    },
    {
      id: "what-to-do-next",
      title: "What to do next",
      body: "Open this report in Chat to rerun the live agent, update the sources, and save a fresh version.",
      status: "complete" as const,
    },
  ];
}

async function claimAnonymousProductWorkspace(
  ctx: MutationCtx,
  args: {
    anonymousSessionId?: string | null;
    ownerKey: string;
  },
) {
  const anonymousSessionId = args.anonymousSessionId?.trim();
  if (!anonymousSessionId) return 0;

  const anonymousOwnerKey = `anon:${anonymousSessionId}`;
  if (anonymousOwnerKey === args.ownerKey) return 0;

  let claimedRows = 0;

  for (const tableConfig of PRODUCT_OWNED_TABLES) {
    const records = tableConfig.ownerIndex
      ? await ctx.db
          .query(tableConfig.table)
          .withIndex(tableConfig.ownerIndex, (q: any) => q.eq("ownerKey", anonymousOwnerKey))
          .collect()
      : (await ctx.db.query(tableConfig.table).collect()).filter(
          (record: { ownerKey?: string }) => record.ownerKey === anonymousOwnerKey,
        );

    for (const record of records) {
      await ctx.db.patch(record._id, { ownerKey: args.ownerKey });
      claimedRows += 1;
    }
  }

  return claimedRows;
}

export const ensureCanonicalProductBootstrap = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const now = Date.now();
    const claimedAnonymousRows = await claimAnonymousProductWorkspace(ctx, {
      anonymousSessionId: args.anonymousSessionId,
      ownerKey,
    });

    const existingCards = await ctx.db
      .query("productPublicCards")
      .withIndex("by_visibility_rank", (q) => q.eq("visibility", "public"))
      .take(1);
    if (existingCards.length === 0) {
      for (const card of DEFAULT_PUBLIC_CARDS) {
        await ctx.db.insert("productPublicCards", {
          ...card,
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const existingState = await ctx.db
      .query("productMigrationState")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .first();

    if (existingState?.schemaVersion === PRODUCT_SCHEMA_VERSION) {
      if (claimedAnonymousRows > 0) {
        await ctx.db.patch(existingState._id, {
          claimedAnonymousRows: (existingState.claimedAnonymousRows ?? 0) + claimedAnonymousRows,
          updatedAt: now,
        });
        return await ctx.db.get(existingState._id);
      }
      return existingState;
    }

    let migratedFiles = 0;
    let migratedDocuments = 0;
    let migratedReports = 0;

    if (identity.rawUserId) {
      const userId = identity.rawUserId as any;

      const preferences = await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();

      const existingProfile = await ctx.db
        .query("productProfileSummaries")
        .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
        .first();

      if (!existingProfile) {
        await ctx.db.insert("productProfileSummaries", {
          ownerKey: identity.ownerKey,
          backgroundSummary: "",
          preferredLens: "founder",
          rolesOfInterest: [],
          location: undefined,
          preferences: preferences
            ? {
                themeMode: preferences.themeMode,
                timeZone: preferences.timeZone,
                plannerMode: preferences.plannerMode,
              }
            : undefined,
          createdAt: now,
          updatedAt: now,
        });
      }

      const files = await ctx.db
        .query("files")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(12);

      for (const file of files) {
        const existingEvidence = await ctx.db
          .query("productEvidenceItems")
          .withIndex("by_owner_legacy_file", (q) =>
            q.eq("ownerKey", ownerKey).eq("legacyFileId", file._id),
          )
          .first();

        if (!existingEvidence) {
          await ctx.db.insert("productEvidenceItems", {
            ownerKey: identity.ownerKey,
            type: "file",
            label: file.fileName,
            description: file.contentSummary ?? file.analysis ?? undefined,
            status: "ready",
            mimeType: file.mimeType,
            textPreview: file.textPreview ?? file.analysis ?? undefined,
            legacyFileId: file._id,
            metadata: {
              fileType: file.fileType,
              fileSize: file.fileSize,
            },
            createdAt: now,
            updatedAt: now,
          });
          migratedFiles += 1;
        }

        const existingContext = await ctx.db
            .query("productContextItems")
            .withIndex("by_owner_legacy_file", (q) =>
              q.eq("ownerKey", ownerKey).eq("legacyFileId", file._id),
            )
          .first();

        if (!existingContext) {
          await ctx.db.insert("productContextItems", {
            ownerKey: identity.ownerKey,
            type: "file",
            title: file.fileName,
            summary: file.contentSummary ?? file.analysis ?? "Saved file available to Chat and Reports.",
            tags: [file.fileType].filter(Boolean),
            legacyFileId: file._id,
            permissions: {
              chat: true,
              reports: true,
              nudges: true,
            },
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const documents = await ctx.db
        .query("documents")
        .withIndex("by_user", (q) => q.eq("createdBy", userId))
        .order("desc")
        .take(24);

      for (const document of documents) {
        if (document.isArchived) continue;

        const existingReport = await ctx.db
          .query("productReports")
          .withIndex("by_owner_legacy_document", (q) =>
            q.eq("ownerKey", ownerKey).eq("legacyDocumentId", document._id),
          )
          .first();

        if (existingReport) {
          continue;
        }

        const summary = extractSnippet(document);
        const sections = buildReportSections(document.title, summary);
        const evidenceItemIds: any[] = [];
        const sources: Array<{
          id: string;
          label: string;
          href?: string;
          type?: string;
          status?: string;
          title?: string;
          domain?: string;
          publishedAt?: string;
          excerpt?: string;
          confidence?: number;
        }> = [];

        if (document.fileId) {
          const evidence = await ctx.db
            .query("productEvidenceItems")
            .withIndex("by_owner_legacy_file", (q) =>
              q.eq("ownerKey", ownerKey).eq("legacyFileId", document.fileId!),
            )
            .first();
          if (evidence) {
            evidenceItemIds.push(evidence._id);
            sources.push({
              id: `file:${String(document.fileId)}`,
              label: evidence.label,
              type: "doc",
              status: "cited",
              excerpt: evidence.textPreview ?? undefined,
            });
          }
        }

        const reportId = await ctx.db.insert("productReports", {
          ownerKey: identity.ownerKey,
          legacyDocumentId: document._id,
          title: document.title,
          type: document.documentType ?? "report",
          summary,
          status: "saved",
          primaryEntity: document.title,
          lens: "founder",
          query: document.title,
          sections,
          sources,
          evidenceItemIds,
          pinned: !!document.isFavorite,
          visibility: document.isPublic ? "public" : "private",
          // PR D: populate searchableText for the federated `search_reports`
          // index. Bootstrap migrates legacy documents into reports, so this
          // makes those rows searchable from day one.
          searchableText: recomputeReportSearchableText({
            title: document.title,
            summary,
            query: document.title,
            primaryEntity: document.title,
            entitySlug: undefined,
          }),
          createdAt: document._creationTime ?? now,
          updatedAt: document.lastModified ?? now,
          lastRefreshAt: document.lastModified ?? now,
        });
        // PR E: schedule per-row embedding for the bootstrap-migrated report.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedReportRow,
          { reportId },
        );
        migratedDocuments += 1;
        migratedReports += 1;

        const existingContext = await ctx.db
          .query("productContextItems")
          .withIndex("by_owner_legacy_document", (q) =>
            q.eq("ownerKey", ownerKey).eq("legacyDocumentId", document._id),
          )
          .first();

        if (!existingContext) {
          await ctx.db.insert("productContextItems", {
            ownerKey: identity.ownerKey,
            type: "report",
            title: document.title,
            summary,
            tags: [document.documentType ?? "report"],
            linkedReportId: reportId,
            legacyDocumentId: document._id,
            permissions: {
              chat: true,
              reports: true,
              nudges: true,
            },
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const latestReports = await ctx.db
        .query("productReports")
        .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(3);

      for (const report of latestReports) {
        await upsertOpenProductNudge(ctx, {
          ownerKey,
          type: "refresh_recommended",
          title: `${report.title} is worth revisiting`,
          summary: "A migrated report is ready to be refreshed through the new Chat flow.",
          linkedReportId: report._id,
          priority: "medium",
          dueAt: now + 24 * 60 * 60 * 1000,
          actionLabel: "Refresh report",
          actionTargetSurface: "reports",
          actionTargetId: report.entitySlug ?? String(report._id),
          createdAt: now,
          updatedAt: now,
        });
      }

      const allReports = await ctx.db
        .query("productReports")
        .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
        .collect();

      const orderedReports = [...allReports].sort(
        (left, right) => (left.createdAt ?? left.updatedAt) - (right.createdAt ?? right.updatedAt),
      );

      for (const report of orderedReports) {
        if (report.entityId && report.entitySlug && report.revision) {
          continue;
        }

        const entityMeta = await ensureEntityForReport(ctx, {
          ownerKey,
          primaryEntity: report.primaryEntity,
          title: report.title,
          query: report.query,
          type: report.type,
          summary: report.summary,
          now: report.updatedAt,
        });

        // PR D: refresh searchableText since entitySlug is part of the
        // composed search field for the federated `search_reports` index.
        const nextReportSearchableText = recomputeReportSearchableText({
          title: report.title,
          summary: report.summary,
          query: report.query,
          primaryEntity: report.primaryEntity,
          entitySlug: entityMeta.entitySlug,
        });
        await ctx.db.patch(report._id, {
          entityId: entityMeta.entityId,
          entitySlug: entityMeta.entitySlug,
          revision: entityMeta.revision,
          previousReportId: entityMeta.previousReportId ?? undefined,
          searchableText: nextReportSearchableText,
        });
        // PR E: schedule per-row embedding for the patched report.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedReportRow,
          { reportId: report._id },
        );

        // PR D: refresh searchableText for the federated `search_entities`
        // index when the entity name/summary changes via legacy bootstrap.
        const existingEntityForBootstrap = await ctx.db.get(entityMeta.entityId);
        const nextEntitySearchableText = recomputeEntitySearchableText({
          name: entityMeta.entityName,
          slug: existingEntityForBootstrap?.slug ?? entityMeta.entitySlug,
          summary: report.summary,
          savedBecause: existingEntityForBootstrap?.savedBecause,
        });
        await ctx.db.patch(entityMeta.entityId, {
          name: entityMeta.entityName,
          entityType: entityMeta.entityType,
          summary: report.summary,
          latestReportId: report._id,
          latestReportUpdatedAt: report.updatedAt,
          latestRevision: entityMeta.revision,
          reportCount: entityMeta.revision,
          searchableText: nextEntitySearchableText,
          updatedAt: report.updatedAt,
        });
        // PR E: schedule per-row embedding for the patched entity.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedEntityRow,
          { entityId: entityMeta.entityId },
        );

        await upsertEntityContextItem(ctx, {
          ownerKey,
          entitySlug: entityMeta.entitySlug,
          entityName: entityMeta.entityName,
          entityType: entityMeta.entityType,
          summary: report.summary,
          linkedReportId: report._id,
          now: report.updatedAt,
        });

        for (const evidenceId of report.evidenceItemIds ?? []) {
          await ctx.db.patch(evidenceId, {
            entityId: entityMeta.entityId,
            status: "linked",
            updatedAt: report.updatedAt,
          });
        }
      }
    }

    if (existingState) {
      await ctx.db.patch(existingState._id, {
        schemaVersion: PRODUCT_SCHEMA_VERSION,
        bootstrappedAt: now,
        claimedAnonymousRows: (existingState.claimedAnonymousRows ?? 0) + claimedAnonymousRows,
        migratedFiles,
        migratedDocuments,
        migratedReports,
        updatedAt: now,
      });
      return await ctx.db.get(existingState._id);
    }

    const stateId = await ctx.db.insert("productMigrationState", {
      ownerKey,
      schemaVersion: PRODUCT_SCHEMA_VERSION,
      bootstrappedAt: now,
      claimedAnonymousRows,
      migratedFiles,
      migratedDocuments,
      migratedReports,
      updatedAt: now,
    });

    return await ctx.db.get(stateId);
  },
});
