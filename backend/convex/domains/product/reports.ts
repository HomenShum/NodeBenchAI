import { action, mutation, query, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  resolveProductIdentitySafely,
  resolveProductReadOwnerKeys,
  requireProductIdentity,
  resolveProductThumbnailUrl,
  resolveProductThumbnailUrls,
} from "./helpers";
import { insertProductActivity } from "./activity";
import { upsertOpenProductNudge } from "./nudgeHelpers";
import { productReportExportFormatValidator } from "./schema";
import { recomputeReportSearchableText } from "../search/searchableTextRecompute";
import {
  buildEntityAliasKey,
  chooseEntityDisplayName,
  isLegacyPromptArtifact,
  isPlaceholderPrepEntity,
  isPrepBriefType,
} from "../../../../shared/reportArtifacts";

function buildReportRefreshPrompt(report: {
  title: string;
  query?: string;
  entitySlug?: string;
}): string {
  const subject = report.entitySlug
    ? report.entitySlug.replace(/[-_]+/g, " ")
    : report.title;
  const base = `Update ${subject} and show me what changed from the saved report.`;
  if (!report.query?.trim()) return base;
  return `${base} Keep the original focus on: ${report.query.trim()}`;
}

function isPlaceholderPrepReport(report: {
  type?: string;
  entitySlug?: string;
  primaryEntity?: string;
  title?: string;
}) {
  if (!isPrepBriefType(report.type)) return false;
  return (
    isPlaceholderPrepEntity(report.entitySlug) ||
    isPlaceholderPrepEntity(report.primaryEntity) ||
    isPlaceholderPrepEntity(report.title?.replace(/^Prep brief\s+[—-]\s+/i, ""))
  );
}

function isLegacyFilteredReport(report: {
  type?: string;
  entitySlug?: string;
  primaryEntity?: string;
  title?: string;
  query?: string;
}) {
  return isPlaceholderPrepReport(report) || isLegacyPromptArtifact(report);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractMetaContent(html: string, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${selector}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    );
    const match = html.match(pattern) ?? html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${selector}["'][^>]*>`,
        "i",
      ),
    );
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }
  return undefined;
}

function extractLinkHref(html: string, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const pattern = new RegExp(
      `<link[^>]+(?:rel)=["'][^"']*${selector}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`,
      "i",
    );
    const match = html.match(pattern) ?? html.match(
      new RegExp(
        `<link[^>]+href=["']([^"']+)["'][^>]+(?:rel)=["'][^"']*${selector}[^"']*["'][^>]*>`,
        "i",
      ),
    );
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  const title = decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
  return title || undefined;
}

function resolveAbsoluteUrl(baseUrl: string, candidate?: string): string | undefined {
  if (!candidate) return undefined;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function fetchSourceMediaFromUrl(href: string): Promise<{
  siteName?: string;
  faviconUrl?: string;
  thumbnailUrl?: string;
  imageCandidates?: string[];
}> {
  try {
    const response = await fetch(href, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "NodeBenchThumbnailBackfill/1.0",
      },
    });
    if (!response.ok) return {};
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) {
      return {
        thumbnailUrl: href,
        imageCandidates: [href],
      };
    }
    if (!contentType.includes("text/html")) {
      return {};
    }
    const html = await response.text();
    const imageCandidates = [
      extractMetaContent(html, ["og:image"]),
      extractMetaContent(html, ["twitter:image", "twitter:image:src"]),
      extractMetaContent(html, ["og:image:url"]),
      extractMetaContent(html, ["og:image:secure_url"]),
    ]
      .map((candidate) => resolveAbsoluteUrl(response.url || href, candidate))
      .filter((candidate, index, values): candidate is string => Boolean(candidate) && values.indexOf(candidate) === index)
      .slice(0, 4);
    const faviconUrl = resolveAbsoluteUrl(
      response.url || href,
      extractLinkHref(html, ["apple-touch-icon", "icon", "shortcut icon"]),
    ) ?? resolveAbsoluteUrl(response.url || href, "/favicon.ico");
    const siteName =
      extractMetaContent(html, ["og:site_name", "application-name"]) ??
      extractTitle(html);

    return {
      siteName,
      faviconUrl,
      thumbnailUrl: imageCandidates[0],
      imageCandidates,
    };
  } catch {
    return {};
  }
}

type SourceMediaBackfillItem = {
  href: string;
  thumbnailUrl?: string;
  siteName?: string;
  faviconUrl?: string;
  imageCandidates?: string[];
};

type HomeReportListItem = Doc<"productReports"> & {
  thumbnailUrl?: string;
  thumbnailUrls?: string[];
  sourceUrls?: string[];
  sourceLabels?: string[];
  canonicalAliasKey?: string;
  canonicalDisplayName?: string;
};

export function mergeReportCardsForHome(reports: HomeReportListItem[]) {
  const grouped = new Map<string, HomeReportListItem[]>();
  for (const report of reports) {
    const groupKey = `${report.ownerKey}:${report.canonicalAliasKey ?? report.entitySlug ?? report._id}`;
    const existing = grouped.get(groupKey) ?? [];
    existing.push(report);
    grouped.set(groupKey, existing);
  }

  return [...grouped.values()]
    .map((group) => {
      if (group.length === 1) {
        const item = group[0]!;
        return {
          ...item,
          title: item.canonicalDisplayName ?? item.title,
        };
      }

      const displayName =
        chooseEntityDisplayName(
          group.flatMap((report) => [
            report.canonicalDisplayName,
            report.primaryEntity,
            report.title,
          ]),
          "company",
        ) ?? group[0]!.title;
      const displaySlug = displayName
        .toLowerCase()
        .trim()
        .replace(/['".,()[\]{}]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const preferred = [...group].sort((left, right) => {
        const leftMatchesDisplaySlug = Number(left.entitySlug === displaySlug);
        const rightMatchesDisplaySlug = Number(right.entitySlug === displaySlug);
        if (leftMatchesDisplaySlug !== rightMatchesDisplaySlug) {
          return rightMatchesDisplaySlug - leftMatchesDisplaySlug;
        }
        return right.updatedAt - left.updatedAt;
      })[0]!;

      return {
        ...preferred,
        title: displayName,
        primaryEntity: displayName,
        entitySlug:
          group.find((report) => report.entitySlug === displaySlug)?.entitySlug ??
          preferred.entitySlug,
        thumbnailUrl: preferred.thumbnailUrl,
        thumbnailUrls: [...new Set(group.flatMap((report) => report.thumbnailUrls ?? []))].slice(0, 4),
        sourceUrls: [...new Set(group.flatMap((report) => report.sourceUrls ?? []))].slice(0, 4),
        sourceLabels: [...new Set(group.flatMap((report) => report.sourceLabels ?? []))].slice(0, 4),
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

async function buildReportReadModel(
  ctx: any,
  report: Doc<"productReports">,
) {
  const thumbnailUrls = await resolveProductThumbnailUrls(ctx, {
    evidenceItemIds: report.evidenceItemIds,
    sources: report.sources,
  });
  const sourceUrls = (report.sources ?? [])
    .map((source) => (typeof source?.href === "string" ? source.href : null))
    .filter((href): href is string => Boolean(href))
    .slice(0, 8);
  const sourceLabels = (report.sources ?? [])
    .map((source) => source?.siteName || source?.label || source?.title || source?.domain || null)
    .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
    .slice(0, 8);
  return {
    ...report,
    thumbnailUrl: thumbnailUrls[0],
    thumbnailUrls,
    sourceUrls,
    sourceLabels,
  };
}

export const listReports = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    search: v.optional(v.string()),
    filter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) {
      return [];
    }

    let reports;
    try {
      const reportGroups = await Promise.all(
        ownerKeys.map((ownerKey) =>
          ctx.db
            .query("productReports")
            .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
            .order("desc")
            .take(60),
        ),
      );
      reports = reportGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof reportGroups)[number][number]>>((acc, report) => {
          if (acc.some((existing) => existing._id === report._id)) {
            return acc;
          }
          acc.push(report);
          return acc;
        }, []);
    } catch (error) {
      console.error("[product] listReports failed", {
        ownerKeys,
        error,
      });
      return [];
    }

    const search = args.search?.trim().toLowerCase() ?? "";
    const filter = args.filter ?? "All";

    const filteredReports = reports.filter((report) => {
      if (isLegacyFilteredReport(report)) return false;
      const matchesSearch =
        !search ||
        report.title.toLowerCase().includes(search) ||
        report.summary.toLowerCase().includes(search);

      if (!matchesSearch) return false;

      if (filter === "Pinned") return report.pinned;
      if (filter === "Recent" || filter === "All") return true;

      const type = report.type.toLowerCase();
      const title = report.title.toLowerCase();
      if (filter === "Companies") return type.includes("company") || title.includes("company");
      if (filter === "People") return type.includes("person") || title.includes("person");
      if (filter === "Jobs") return type.includes("job") || title.includes("role");
      if (filter === "Markets") return type.includes("market") || title.includes("market");
      if (filter === "Notes") return type.includes("note") || type.includes("document");
      return true;
    });

    const cards = await Promise.all(
      filteredReports.map(async (report) => {
        const thumbnailUrls = await resolveProductThumbnailUrls(ctx, {
          evidenceItemIds: report.evidenceItemIds,
          sources: report.sources,
        });
        const sourceUrls = (report.sources ?? [])
          .map((source) => (typeof source?.href === "string" ? source.href : null))
          .filter((href): href is string => Boolean(href))
          .slice(0, 4);
        const sourceLabels = (report.sources ?? [])
          .map((source) => source?.siteName || source?.label || source?.title || source?.domain || null)
          .filter((label): label is string => typeof label === "string" && label.trim().length > 0)
          .slice(0, 4);
        const canonicalDisplayName =
          chooseEntityDisplayName(
            [report.primaryEntity, report.title, report.entitySlug?.replace(/[-_]+/g, " ")],
            report.type,
          ) ?? report.title;
        return {
          ...report,
          thumbnailUrl: thumbnailUrls[0],
          thumbnailUrls,
          sourceUrls,
          sourceLabels,
          canonicalAliasKey: buildEntityAliasKey({
            primaryEntity: report.primaryEntity ?? report.title,
            title: report.title,
            query: report.query,
            type: report.type,
            entityType: report.type,
            slug: report.entitySlug,
          }),
          canonicalDisplayName,
        };
      }),
    );

    return mergeReportCardsForHome(cards).map(
      ({ canonicalAliasKey: _canonicalAliasKey, canonicalDisplayName: _canonicalDisplayName, ...card }) => card,
    );
  },
});

export const getReport = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;
    let report: any = null;
    try {
      report = await ctx.db.get(args.reportId);
    } catch (error) {
      console.error("[product] getReport failed", {
        ownerKeys,
        reportId: args.reportId,
        error,
      });
      return null;
    }
    if (!report || !ownerKeys.includes(report.ownerKey)) {
      return null;
    }
    return buildReportReadModel(ctx, report);
  },
});

export const getPublicReport = query({
  args: {
    reportId: v.string(),
  },
  handler: async (ctx, args) => {
    let report: Doc<"productReports"> | null = null;
    try {
      report = await ctx.db.get(args.reportId as any);
    } catch {
      return null;
    }
    if (!report || report.visibility !== "public") {
      return null;
    }
    return buildReportReadModel(ctx, report);
  },
});

export const setPinned = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerKey !== ownerKey) {
      throw new Error("Report not found");
    }
    await ctx.db.patch(args.reportId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * createDraftReport — creates an empty owner-scoped productReport so the
 * dedicated web notebook surface has somewhere to write. Used by:
 *   - the "New report" UX entry on Home
 *   - multi-tab realtime-sync verification (two tabs sharing one anon session)
 *
 * Bounded title length and locked to status="draft", visibility="private",
 * pinned=false. The created report is immediately readable by the same
 * anonymous session via getReport.
 */
const REPORT_DRAFT_TITLE_MAX = 200;
export const createDraftReport = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    title: v.string(),
    summary: v.optional(v.string()),
    query: v.optional(v.string()),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const title = args.title.trim().slice(0, REPORT_DRAFT_TITLE_MAX);
    if (!title) throw new Error("Title is required");
    const now = Date.now();
    const draftSummary = (args.summary ?? "").slice(0, 1000);
    const draftQuery = (args.query ?? title).slice(0, 1000);
    const id = await ctx.db.insert("productReports", {
      ownerKey,
      title,
      summary: draftSummary,
      query: draftQuery,
      type: (args.type ?? "report").slice(0, 64),
      lens: "founder",
      status: "draft",
      visibility: "private",
      pinned: false,
      sections: [],
      sources: [],
      evidenceItemIds: [],
      // PR D: populate searchableText so the federated `search_reports` index
      // sees this draft immediately. Schema docs the shape; this insert was
      // missing it at PR #310 ship time.
      searchableText: recomputeReportSearchableText({
        title,
        summary: draftSummary,
        query: draftQuery,
        primaryEntity: undefined,
        entitySlug: undefined,
      }),
      createdAt: now,
      updatedAt: now,
    });
    // PR E: schedule per-row embedding for the new draft report.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedReportRow,
      { reportId: id },
    );
    return { ok: true, reportId: id, createdAt: now };
  },
});

/**
 * saveReportNotebookHtml — persists the free-form web-notebook HTML for a
 * single owner-scoped report. Backs the dedicated web report surface
 * (ReportNotebookDetail). Bounded so a runaway client can't inflate the row.
 *
 * BOUND_READ: caps payload at 200 KB so a hostile/buggy client can't bloat
 * the report doc. HONEST_STATUS: throws on auth or ownership mismatch instead
 * of silently no-op'ing.
 */
const REPORT_NOTEBOOK_MAX_BYTES = 200 * 1024;
export const saveReportNotebookHtml = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    notebookHtml: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerKey !== ownerKey) {
      throw new Error("Report not found");
    }
    const bytes = new TextEncoder().encode(args.notebookHtml).byteLength;
    if (bytes > REPORT_NOTEBOOK_MAX_BYTES) {
      throw new Error(
        `Notebook payload too large (${bytes} bytes; max ${REPORT_NOTEBOOK_MAX_BYTES})`,
      );
    }
    const now = Date.now();
    await ctx.db.patch(args.reportId, {
      notebookHtml: args.notebookHtml,
      updatedAt: now,
    });
    await insertProductActivity(ctx, {
      ownerKey,
      reportId: args.reportId,
      workspaceId: String(args.reportId),
      entitySlug: report.entitySlug,
      activityType: "notebook_edited",
      actorType: "user",
      visibility: "private",
      privacyScope: "private",
      entityKeys: report.entitySlug ? [report.entitySlug] : [],
      claimKeys: (report.claimIds ?? []).map((id: any) => String(id)),
      sourceKeys: (report.sources ?? []).map((source: any) => source.id).filter(Boolean),
      sessionId: report.sessionId ? String(report.sessionId) : undefined,
      payloadPreview: {
        label: "Notebook edited",
        detail: `Saved ${bytes} bytes from the web report notebook.`,
        status: "synced to Convex",
      },
      createdAt: now,
    });
    return { ok: true, savedAt: now, bytes };
  },
});

function exportSlug(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/['".,()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "row";
}

function exportRowCounts(rows: Array<{ rowType: string }>) {
  return {
    contacts: rows.filter((row) => row.rowType === "contact").length,
    companies: rows.filter((row) => row.rowType === "company").length,
    interactions: rows.filter((row) => row.rowType === "interaction").length,
    followups: rows.filter((row) => row.rowType === "followup").length,
    claims: rows.filter((row) => row.rowType === "claim").length,
    sources: rows.filter((row) => row.rowType === "source").length,
  };
}

async function buildReportExportRows(ctx: any, args: {
  ownerKey: string;
  report: Doc<"productReports">;
  workspaceId: string;
}) {
  const [workspaceEntities, workspaceClaims, workspaceEvidence, followUps, captures] = await Promise.all([
    ctx.db
      .query("productEventWorkspaceEntities")
      .withIndex("by_owner_workspace", (q: any) =>
        q.eq("ownerKey", args.ownerKey).eq("workspaceId", args.workspaceId),
      )
      .collect(),
    ctx.db
      .query("productEventWorkspaceClaims")
      .withIndex("by_owner_workspace", (q: any) =>
        q.eq("ownerKey", args.ownerKey).eq("workspaceId", args.workspaceId),
      )
      .collect(),
    ctx.db
      .query("productEventWorkspaceEvidence")
      .withIndex("by_owner_workspace", (q: any) =>
        q.eq("ownerKey", args.ownerKey).eq("workspaceId", args.workspaceId),
      )
      .collect(),
    ctx.db
      .query("productEventWorkspaceFollowUps")
      .withIndex("by_owner_workspace", (q: any) =>
        q.eq("ownerKey", args.ownerKey).eq("workspaceId", args.workspaceId),
      )
      .collect(),
    ctx.db
      .query("productEventCaptures")
      .withIndex("by_owner_workspace", (q: any) =>
        q.eq("ownerKey", args.ownerKey).eq("workspaceId", args.workspaceId),
      )
      .collect(),
  ]);

  const entityByKey = new Map<string, any>(
    workspaceEntities.map((entity: any) => [entity.entityKey, entity]),
  );
  const rows: Array<{
    rowType: "contact" | "company" | "interaction" | "followup" | "claim" | "source";
    rowKey: string;
    label: string;
    nodebenchUri?: string;
    confidence: number;
    source: string;
    privacyScope: "private" | "team" | "tenant" | "public_cache" | "aggregate_anonymized";
    verificationStatus: "field_note" | "needs_evidence" | "provisional" | "verified" | "stale" | "contradicted";
    data: any;
  }> = [];

  for (const entity of workspaceEntities) {
    if (entity.entityType === "person") {
      rows.push({
        rowType: "contact",
        rowKey: `contact.${entity.entityKey}`,
        label: entity.name,
        nodebenchUri: entity.uri,
        confidence: entity.confidence,
        source: entity.layer,
        privacyScope: entity.layer === "source_cache" ? "public_cache" : "private",
        verificationStatus: entity.layer === "source_cache" ? "verified" : "field_note",
        data: {
          person_name: entity.name,
          company_name: "",
          title: "",
          email: "",
          linkedin: "",
          nodebench_entity_uri: entity.uri,
          status: "captured",
        },
      });
    }
    if (entity.entityType === "company") {
      rows.push({
        rowType: "company",
        rowKey: `company.${entity.entityKey}`,
        label: entity.name,
        nodebenchUri: entity.uri,
        confidence: entity.confidence,
        source: entity.layer,
        privacyScope: entity.layer === "source_cache" ? "public_cache" : "private",
        verificationStatus: entity.layer === "source_cache" ? "verified" : "field_note",
        data: {
          company_name: entity.name,
          category: "event intelligence",
          description: args.report.summary,
          nodebench_entity_uri: entity.uri,
          priority: entity.confidence >= 0.8 ? "high" : "medium",
          status: "follow_up_review",
        },
      });
    }
  }

  for (const capture of captures) {
    rows.push({
      rowType: "interaction",
      rowKey: `interaction.${capture.captureKey}`,
      label: capture.rawText?.slice(0, 80) || capture.transcript?.slice(0, 80) || "Event capture",
      nodebenchUri: `nodebench://capture/${capture.captureKey}`,
      confidence: capture.confidence,
      source: capture.kind,
      privacyScope: "private",
      verificationStatus: "field_note",
      data: {
        event_name: args.report.title,
        interaction_type: capture.kind === "text" ? "field_note" : capture.kind,
        notes: capture.rawText ?? capture.transcript ?? "",
        created_at: new Date(capture.createdAt).toISOString(),
        nodebench_capture_uri: `nodebench://capture/${capture.captureKey}`,
      },
    });
  }

  for (const followUp of followUps) {
    const firstEntity = followUp.linkedEntityKeys.map((key: string) => entityByKey.get(key)).find(Boolean);
    rows.push({
      rowType: "followup",
      rowKey: `followup.${followUp.followUpKey}`,
      label: followUp.action,
      nodebenchUri: `nodebench://followup/${followUp.followUpKey}`,
      confidence: followUp.priority === "high" ? 0.85 : 0.7,
      source: "workspace_memory",
      privacyScope: "private",
      verificationStatus: "field_note",
      data: {
        company_name: firstEntity?.entityType === "company" ? firstEntity.name : "",
        person_name: firstEntity?.entityType === "person" ? firstEntity.name : "",
        priority: followUp.priority,
        due_date: followUp.due,
        status: followUp.status,
        next_action: followUp.action,
        nodebench_entity_uri: firstEntity?.uri ?? "",
      },
    });
  }

  for (const claim of workspaceClaims) {
    const subject = entityByKey.get(claim.subjectEntityKey);
    rows.push({
      rowType: "claim",
      rowKey: `claim.${claim.claimKey}`,
      label: claim.claim,
      nodebenchUri: `nodebench://claim/${claim.claimKey}`,
      confidence: claim.status === "verified" ? 0.95 : 0.55,
      source: claim.visibility,
      privacyScope: claim.visibility === "team" ? "team" : claim.visibility === "tenant" ? "tenant" : "private",
      verificationStatus: claim.status,
      data: {
        entity: subject?.name ?? claim.subjectEntityKey,
        claim: claim.claim,
        claim_type: "event_workspace",
        verification_status: claim.status,
        evidence: claim.evidenceKeys.join("; "),
        nodebench_entity_uri: subject?.uri ?? "",
      },
    });
  }

  for (const evidence of workspaceEvidence) {
    rows.push({
      rowType: "source",
      rowKey: `source.${evidence.evidenceKey}`,
      label: evidence.title,
      nodebenchUri: `nodebench://source/${evidence.evidenceKey}`,
      confidence: evidence.reusable ? 0.9 : 0.65,
      source: evidence.layer,
      privacyScope: evidence.visibility === "team" ? "team" : evidence.visibility === "tenant" ? "tenant" : evidence.layer === "source_cache" ? "public_cache" : "private",
      verificationStatus: evidence.reusable ? "verified" : "field_note",
      data: {
        source_id: evidence.evidenceKey,
        source_type: evidence.layer,
        title: evidence.title,
        uri: `nodebench://source/${evidence.evidenceKey}`,
        attached_to: args.report.title,
      },
    });
  }

  for (const source of args.report.sources ?? []) {
    rows.push({
      rowType: "source",
      rowKey: `report-source.${exportSlug(source.id || source.href || source.label)}`,
      label: source.label || source.title || source.href || "Report source",
      nodebenchUri: source.href,
      confidence: source.confidence ?? 0.75,
      source: source.type || "report_source",
      privacyScope: "public_cache",
      verificationStatus: source.status === "stale" ? "stale" : "verified",
      data: {
        source_id: source.id,
        source_type: source.type,
        title: source.title || source.label,
        uri: source.href,
        attached_to: args.report.title,
      },
    });
  }

  if (rows.length === 0) {
    rows.push({
      rowType: "company",
      rowKey: `company.${exportSlug(args.report.primaryEntity || args.report.title)}`,
      label: args.report.primaryEntity || args.report.title,
      nodebenchUri: args.report.entitySlug ? `nodebench://org/${args.report.entitySlug}` : undefined,
      confidence: 0.5,
      source: "report_summary",
      privacyScope: "private",
      verificationStatus: "needs_evidence",
      data: {
        company_name: args.report.primaryEntity || args.report.title,
        description: args.report.summary,
        nodebench_report_url: `/reports/${String(args.report._id)}/notebook`,
      },
    });
  }

  return rows;
}

export const previewReportExport = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    format: productReportExportFormatValidator,
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerKey !== ownerKey) {
      throw new Error("Report not found");
    }
    const now = Date.now();
    const workspaceId = args.workspaceId ?? String(args.reportId);
    const exportKey = `export.${String(args.reportId)}.${now}`;
    const rows = await buildReportExportRows(ctx, { ownerKey, report, workspaceId });
    const rowCounts = exportRowCounts(rows);
    await ctx.db.insert("productReportExports", {
      ownerKey,
      reportId: args.reportId,
      workspaceId,
      exportKey,
      format: args.format,
      status: "previewed",
      rowCounts,
      privacyScope: "private",
      createdAt: now,
      updatedAt: now,
    });
    for (const row of rows) {
      await ctx.db.insert("productReportExportRows", {
        ownerKey,
        exportKey,
        reportId: args.reportId,
        rowType: row.rowType,
        rowKey: row.rowKey,
        label: row.label,
        nodebenchUri: row.nodebenchUri,
        confidence: row.confidence,
        source: row.source,
        privacyScope: row.privacyScope,
        verificationStatus: row.verificationStatus,
        data: row.data,
        createdAt: now,
      });
    }
    await insertProductActivity(ctx, {
      ownerKey,
      reportId: args.reportId,
      workspaceId,
      entitySlug: report.entitySlug,
      activityType: "export_previewed",
      actorType: "user",
      visibility: "private",
      privacyScope: "private",
      entityKeys: rows.map((row) => row.rowKey),
      claimKeys: rows.filter((row) => row.rowType === "claim").map((row) => row.rowKey),
      sourceKeys: rows.filter((row) => row.rowType === "source").map((row) => row.rowKey),
      payloadPreview: {
        label: "Export review prepared",
        detail: `${rows.length} rows mapped for ${args.format}.`,
        status: "review_required",
      },
      createdAt: now,
    });
    return { ok: true, exportKey, format: args.format, rowCounts, rows };
  },
});

export const completeReportExport = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    exportKey: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const exportRecord = await ctx.db
      .query("productReportExports")
      .withIndex("by_owner_export", (q) =>
        q.eq("ownerKey", ownerKey).eq("exportKey", args.exportKey),
      )
      .first();
    if (!exportRecord) {
      throw new Error("Export not found");
    }
    const now = Date.now();
    await ctx.db.patch(exportRecord._id, {
      status: "completed",
      updatedAt: now,
    });
    const rows = await ctx.db
      .query("productReportExportRows")
      .withIndex("by_owner_export", (q) =>
        q.eq("ownerKey", ownerKey).eq("exportKey", args.exportKey),
      )
      .collect();
    await insertProductActivity(ctx, {
      ownerKey,
      reportId: exportRecord.reportId,
      workspaceId: exportRecord.workspaceId,
      activityType: "export_completed",
      actorType: "user",
      visibility: "private",
      privacyScope: exportRecord.privacyScope,
      entityKeys: rows.map((row: any) => row.rowKey),
      claimKeys: rows.filter((row: any) => row.rowType === "claim").map((row: any) => row.rowKey),
      sourceKeys: rows.filter((row: any) => row.rowType === "source").map((row: any) => row.rowKey),
      payloadPreview: {
        label: "Export completed",
        detail: `${rows.length} reviewed rows exported as ${exportRecord.format}.`,
        status: "completed",
      },
      createdAt: now,
    });
    return { ok: true, exportKey: args.exportKey, format: exportRecord.format, rows };
  },
});

export const attachFileToReport = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    evidenceId: v.id("productEvidenceItems"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const [report, evidence] = await Promise.all([
      ctx.db.get(args.reportId),
      ctx.db.get(args.evidenceId),
    ]);
    if (!report || report.ownerKey !== ownerKey) {
      throw new Error("Report not found");
    }
    if (!evidence || evidence.ownerKey !== ownerKey) {
      throw new Error("File not found");
    }

    const nextEvidenceIds = [args.evidenceId, ...(report.evidenceItemIds ?? []).filter((id) => id !== args.evidenceId)].slice(0, 50);
    const now = Date.now();
    await ctx.db.patch(args.reportId, {
      evidenceItemIds: nextEvidenceIds,
      updatedAt: now,
    });
    await ctx.db.patch(args.evidenceId, {
      reportId: args.reportId,
      entityId: report.entityId,
      status: "linked",
      updatedAt: now,
    });

    return {
      ok: true,
      reportId: args.reportId,
      evidenceId: args.evidenceId,
    };
  },
});

export const requestRefresh = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    triggeredBy: v.optional(v.union(v.literal("user"), v.literal("nudge"), v.literal("system"))),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerKey !== ownerKey) {
      throw new Error("Report not found");
    }

    const now = Date.now();
    const refreshId = await ctx.db.insert("productReportRefreshes", {
      ownerKey,
      reportId: args.reportId,
      status: "queued",
      triggeredBy: args.triggeredBy ?? "user",
      summary: "Refresh queued from Reports.",
      createdAt: now,
      updatedAt: now,
    });

    await upsertOpenProductNudge(ctx, {
      ownerKey,
      type: "report_changed",
      title: `${report.title} needs a refresh`,
      summary: "A refresh was queued from Reports. Open Chat to run it live.",
      linkedReportId: report._id,
      priority: "medium",
      actionLabel: "Open in Chat",
      actionTargetSurface: "chat",
      actionTargetId: report.entitySlug ?? String(report._id),
      createdAt: now,
      updatedAt: now,
    });

    return {
      refreshId,
      reportId: report._id,
      entitySlug: report.entitySlug,
      query: report.query,
      lens: report.lens,
      refreshPrompt: buildReportRefreshPrompt(report),
    };
  },
});

export const cleanupLegacyPlaceholderPrepArtifacts = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const dryRun = args.dryRun ?? true;

    const reports = await ctx.db
      .query("productReports")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .collect();
    const targetReports = reports.filter((report) => isLegacyFilteredReport(report));
    const targetReportIds = new Set(targetReports.map((report) => String(report._id)));
    const targetEntitySlugs = Array.from(
      new Set(
        targetReports
          .map((report) => report.entitySlug)
          .filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0),
      ),
    );

    const entities = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .collect();
    const targetEntities = entities.filter(
      (entity) =>
        targetEntitySlugs.includes(entity.slug) ||
        isPlaceholderPrepEntity(entity.slug) ||
        isPlaceholderPrepEntity(entity.name),
    );

    const nudges = await ctx.db
      .query("productNudges")
      .withIndex("by_owner_status_updated", (q) => q.eq("ownerKey", ownerKey).eq("status", "open"))
      .collect();
    const targetNudges = nudges.filter(
      (nudge) =>
        (nudge.linkedReportId && targetReportIds.has(String(nudge.linkedReportId))) ||
        (typeof nudge.actionTargetId === "string" && targetEntitySlugs.includes(nudge.actionTargetId)),
    );

    const contextItems = await ctx.db
      .query("productContextItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .collect();
    const targetContextItems = contextItems.filter(
      (item) =>
        (typeof item.entity === "string" && targetEntitySlugs.includes(item.entity)) ||
        (item.linkedReportId && targetReportIds.has(String(item.linkedReportId))),
    );

    if (!dryRun) {
      for (const nudge of targetNudges) {
        await ctx.db.delete(nudge._id);
      }
      for (const contextItem of targetContextItems) {
        await ctx.db.delete(contextItem._id);
      }
      for (const report of targetReports) {
        await ctx.db.delete(report._id);
      }
      for (const entity of targetEntities) {
        await ctx.db.delete(entity._id);
      }
    }

    return {
      dryRun,
      deletedReportIds: targetReports.map((report) => String(report._id)),
      deletedEntitySlugs: targetEntities.map((entity) => entity.slug),
      deletedNudgeIds: targetNudges.map((nudge) => String(nudge._id)),
      deletedContextItemIds: targetContextItems.map((item) => String(item._id)),
      reportCount: targetReports.length,
      entityCount: targetEntities.length,
      nudgeCount: targetNudges.length,
      contextItemCount: targetContextItems.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal: list all saved reports across all owners (for cron nudge scan)
// Bounded to 100 to avoid unbounded reads in cron context.
// ---------------------------------------------------------------------------
export const listAllReportsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const reports = await ctx.db
      .query("productReports")
      .filter((q) => q.eq(q.field("status"), "saved"))
      .order("desc")
      .take(100);

    return reports.map((r) => ({
      _id: r._id,
      ownerKey: r.ownerKey,
      title: r.title,
      query: r.query,
      lens: r.lens,
      entitySlug: r.entitySlug,
      updatedAt: r.updatedAt,
    })).filter((report) => !isLegacyFilteredReport(report));
  },
});

export const listReportsMissingSourceMediaInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    reportId: v.optional(v.id("productReports")),
  },
  handler: async (ctx, args) => {
    let reports = await ctx.db
      .query("productReports")
      .filter((q) => q.eq(q.field("status"), "saved"))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));

    if (args.reportId) {
      reports = reports.filter((report) => report._id === args.reportId);
    }

    return reports
      .filter((report) =>
        (report.sources ?? []).some(
          (source) =>
            source.href &&
            (!source.thumbnailUrl ||
              !source.siteName ||
              !source.faviconUrl ||
              !Array.isArray(source.imageCandidates) ||
              source.imageCandidates.length === 0),
        ),
      )
      .map((report) => ({
        reportId: report._id,
        sessionId: report.sessionId,
        title: report.title,
        sources: report.sources,
      }));
  },
});

export const applySourceMediaBackfillInternal = internalMutation({
  args: {
    reportId: v.id("productReports"),
    mediaBySource: v.array(
      v.object({
        href: v.string(),
        thumbnailUrl: v.optional(v.string()),
        siteName: v.optional(v.string()),
        faviconUrl: v.optional(v.string()),
        imageCandidates: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return { updated: false, count: 0 };

    const mediaMap = new Map<string, SourceMediaBackfillItem>(
      args.mediaBySource.map((item) => [item.href, item]),
    );

    let count = 0;
    const nextSources = (report.sources ?? []).map((source) => {
      const media = source.href ? mediaMap.get(source.href) : undefined;
      if (!media) {
        return source;
      }

      const nextThumbnailUrl = media.thumbnailUrl ?? source.thumbnailUrl;
      const nextSiteName = media.siteName ?? source.siteName;
      const nextFaviconUrl = media.faviconUrl ?? source.faviconUrl;
      const nextImageCandidates =
        Array.isArray(media.imageCandidates) && media.imageCandidates.length > 0
          ? media.imageCandidates
          : source.imageCandidates;

      const didChange =
        nextThumbnailUrl !== source.thumbnailUrl ||
        nextSiteName !== source.siteName ||
        nextFaviconUrl !== source.faviconUrl ||
        JSON.stringify(nextImageCandidates ?? []) !== JSON.stringify(source.imageCandidates ?? []);

      if (!didChange) return source;

      count += 1;
      return {
        ...source,
        thumbnailUrl: nextThumbnailUrl,
        siteName: nextSiteName,
        faviconUrl: nextFaviconUrl,
        imageCandidates: nextImageCandidates,
      };
    });

    if (count === 0) {
      return { updated: false, count: 0 };
    }

    await ctx.db.patch(args.reportId, {
      sources: nextSources,
      updatedAt: Date.now(),
    });

    if (report.sessionId) {
      const sourceEvents = await ctx.db
        .query("productSourceEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", report.sessionId!))
        .collect();

      for (const event of sourceEvents) {
        const media = event.href ? mediaMap.get(event.href) : undefined;
        if (!media) continue;
        const nextThumbnailUrl = media.thumbnailUrl ?? event.thumbnailUrl;
        const nextSiteName = media.siteName ?? event.siteName;
        const nextFaviconUrl = media.faviconUrl ?? event.faviconUrl;
        const nextImageCandidates =
          Array.isArray(media.imageCandidates) && media.imageCandidates.length > 0
            ? media.imageCandidates
            : event.imageCandidates;
        const didChange =
          nextThumbnailUrl !== event.thumbnailUrl ||
          nextSiteName !== event.siteName ||
          nextFaviconUrl !== event.faviconUrl ||
          JSON.stringify(nextImageCandidates ?? []) !== JSON.stringify(event.imageCandidates ?? []);
        if (!didChange) continue;
        await ctx.db.patch(event._id, {
          thumbnailUrl: nextThumbnailUrl,
          siteName: nextSiteName,
          faviconUrl: nextFaviconUrl,
          imageCandidates: nextImageCandidates,
        });
      }
    }

    return { updated: true, count };
  },
});

export const hydrateReportSourceMediaInternal = internalAction({
  args: {
    reportId: v.id("productReports"),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.runQuery(
      internal.domains.product.reports.listReportsMissingSourceMediaInternal,
      { limit: 1, reportId: args.reportId },
    );

    const report = candidates[0];
    if (!report) {
      return { scanned: 0, updatedReports: 0, patchedSources: 0 };
    }

    const discovered: Array<{
      href: string;
      thumbnailUrl?: string;
      siteName?: string;
      faviconUrl?: string;
      imageCandidates?: string[];
    }> = [];
    for (const source of report.sources ?? []) {
      if (
        !source.href ||
        (source.thumbnailUrl &&
          source.siteName &&
          source.faviconUrl &&
          Array.isArray(source.imageCandidates) &&
          source.imageCandidates.length > 0)
      ) {
        continue;
      }
      const media = await fetchSourceMediaFromUrl(source.href);
      if (!media.thumbnailUrl && !media.siteName && !media.faviconUrl && !(media.imageCandidates?.length)) {
        continue;
      }
      discovered.push({
        href: source.href,
        thumbnailUrl: media.thumbnailUrl,
        siteName: media.siteName,
        faviconUrl: media.faviconUrl,
        imageCandidates: media.imageCandidates,
      });
    }

    if (discovered.length === 0) {
      return { scanned: 1, updatedReports: 0, patchedSources: 0 };
    }

    const result = await ctx.runMutation(
      internal.domains.product.reports.applySourceMediaBackfillInternal,
      {
        reportId: report.reportId,
        mediaBySource: discovered,
      },
    );

    return {
      scanned: 1,
      updatedReports: result.updated ? 1 : 0,
      patchedSources: result.count,
    };
  },
});

export const backfillMissingReportThumbnails = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.runQuery(
      internal.domains.product.reports.listReportsMissingSourceMediaInternal,
      { limit: args.limit ?? 50 },
    );

    let scanned = 0;
    let updatedReports = 0;
    let patchedSources = 0;

    for (const report of candidates) {
      scanned += 1;
      const discovered: Array<{
        href: string;
        thumbnailUrl?: string;
        siteName?: string;
        faviconUrl?: string;
        imageCandidates?: string[];
      }> = [];
      for (const source of report.sources ?? []) {
        if (
          !source.href ||
          (source.thumbnailUrl &&
            source.siteName &&
            source.faviconUrl &&
            Array.isArray(source.imageCandidates) &&
            source.imageCandidates.length > 0)
        ) {
          continue;
        }
        const media = await fetchSourceMediaFromUrl(source.href);
        if (!media.thumbnailUrl && !media.siteName && !media.faviconUrl && !(media.imageCandidates?.length)) continue;
        discovered.push({
          href: source.href,
          thumbnailUrl: media.thumbnailUrl,
          siteName: media.siteName,
          faviconUrl: media.faviconUrl,
          imageCandidates: media.imageCandidates,
        });
      }

      if (discovered.length === 0) continue;

      const result = await ctx.runMutation(
        internal.domains.product.reports.applySourceMediaBackfillInternal,
        {
          reportId: report.reportId,
          mediaBySource: discovered,
        },
      );

      if (result.updated) {
        updatedReports += 1;
        patchedSources += result.count;
      }
    }

    return {
      scanned,
      updatedReports,
      patchedSources,
    };
  },
});

export const runSourceMediaBackfillMaintenance = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(
      internal.domains.product.reports.backfillMissingReportThumbnails,
      { limit: args.limit ?? 50 },
    );
  },
});

export const runThumbnailBackfillMaintenance = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(
      internal.domains.product.reports.backfillMissingReportThumbnails,
      { limit: args.limit ?? 50 },
    );
  },
});
