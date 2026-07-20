import { mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import {
  listActiveEntityWorkspaceInvites,
  listActiveEntityWorkspaceMembers,
  listActiveEntityWorkspaceShares,
  resolveEntityWorkspaceAccess,
  requireProductIdentity,
  resolveProductIdentitySafely,
  resolveProductReadOwnerKeys,
  resolveProductThumbnailUrls,
  summarizeText,
} from "./helpers";
import { productNoteBlockValidator } from "./schema";
import { composeSearchableText } from "../search/federatedHelpers";
import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
} from "../search/searchableTextRecompute";
import { getEntityMemoryDocumentWorkspace } from "./documents";
import {
  buildEntityAliasKey,
  chooseEntityDisplayName,
  deriveCanonicalEntityName,
  isLegacyPromptArtifact,
  isPlaceholderPrepEntity,
  isPrepBriefType,
} from "../../../../shared/reportArtifacts";

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "what",
  "why",
  "how",
  "into",
  "over",
  "your",
  "about",
  "does",
  "recently",
  "changed",
  "company",
  "person",
  "market",
  "report",
  "entity",
]);

const COMPANY_NAME_MARKERS = [
  "ai",
  "capital",
  "cliffside",
  "company",
  "corp",
  "corporation",
  "crypto",
  "fund",
  "foundation",
  "group",
  "holdings",
  "inc",
  "labs",
  "lab",
  "llc",
  "l.p",
  "lp",
  "partners",
  "platform",
  "protocol",
  "software",
  "studio",
  "systems",
  "technologies",
  "technology",
  "ventures",
];

const PERSON_RELATION_WORDS = ["founder", "co-founder", "cofounder", "partner", "advisor", "recruiter", "hiring manager"];

function slugifySegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['".,()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function slugifyProductEntityName(value: string) {
  const slug = slugifySegment(value);
  return slug || "untitled-entity";
}

function normalizeNameToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function looksLikeCompanyName(value?: string | null) {
  const normalized = normalizeNameToken(value ?? "");
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  return tokens.some((token) => COMPANY_NAME_MARKERS.includes(token));
}

export function looksLikePersonName(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw || looksLikeCompanyName(raw)) return false;
  const tokens = raw
    .split(/\s+/g)
    .map((token) => token.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every((token) => /^[A-Z][a-z'’-]+$/.test(token));
}

function toSentenceCase(value: string) {
  return value
    .split(/[\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function trimLinkedInLabel(value?: string | null) {
  const label = String(value ?? "").trim();
  if (!label) return "";
  return label
    .replace(/\s+\|\s+LinkedIn$/i, "")
    .replace(/\s+LinkedIn Profile$/i, "")
    .replace(/\s+-\s+[A-Z][^|]+$/u, "")
    .trim();
}

function extractUrlsFromText(value?: string | null) {
  return [...String(value ?? "").matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
}

function normalizeComparableUrl(url: string) {
  return url.replace(/\/+$/, "").trim();
}

function inferRelationFromText(value?: string | null) {
  const normalized = String(value ?? "").toLowerCase();
  if (/(co-founder|cofounder)/.test(normalized)) return "cofounder";
  if (/founder/.test(normalized)) return "founder";
  if (/advisor/.test(normalized)) return "advisor";
  if (/recruiter|hiring/.test(normalized)) return "hiring";
  return "mentioned";
}

function extractLinkedInPublicIdentifier(url?: string | null) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : null;
}

function extractDomainSlug(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host) return null;
    const pieces = host.split(".");
    return pieces.length >= 2 ? pieces[0] : host;
  } catch {
    return null;
  }
}

export function pickProductEntityName({
  primaryEntity,
  title,
  query,
  type,
}: {
  primaryEntity?: string | null;
  title: string;
  query: string;
  type?: string | null;
}) {
  const candidate =
    deriveCanonicalEntityName({
      primaryEntity,
      title,
      query,
      type,
    }) ||
    primaryEntity?.trim() ||
    title.trim() ||
    query.trim();
  return summarizeText(candidate, "Untitled entity");
}

function isLinkedInPersonUrl(url: string) {
  return /linkedin\.com\/(?:in|pub)\//i.test(url);
}

function normalizeSourceUrls(urls: Array<string | null | undefined> | undefined) {
  return (urls ?? []).filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

export function inferProductEntityType(args: {
  type?: string | null;
  entityName?: string | null;
  title?: string | null;
  query?: string | null;
  sourceUrls?: Array<string | null | undefined>;
}) {
  const normalized = `${args.type ?? ""} ${args.title ?? ""} ${args.query ?? ""}`.toLowerCase();
  const sourceUrls = normalizeSourceUrls(args.sourceUrls);
  if (looksLikeCompanyName(args.entityName)) return "company";
  if (looksLikePersonName(args.entityName) && sourceUrls.some((url) => isLinkedInPersonUrl(url))) return "person";
  if (looksLikePersonName(args.entityName)) return "person";
  if (looksLikeCompanyName(args.title)) return "company";
  if (normalized.includes("person") || normalized.includes("founder")) return "person";
  if (/(profile|co-founder|cofounder|candidate|recruiter|hiring team|linkedin profile|founder linkedin|speaker)/.test(normalized)) return "person";
  if (normalized.includes("job") || normalized.includes("role")) return "job";
  if (/(job description|job post|interview process|compensation package|candidate profile|offer package|role fit)/.test(normalized)) return "job";
  if (normalized.includes("market")) return "market";
  if (normalized.includes("note")) return "note";
  if (sourceUrls.some((url) => isLinkedInPersonUrl(url))) return "person";
  return "company";
}

export function inferProductSavedBecause(args: {
  entityType: string;
  lens?: string | null;
  query?: string | null;
  title?: string | null;
}) {
  const haystack = `${args.query ?? ""} ${args.title ?? ""}`.toLowerCase();
  if (/(conference|event|booth|business card|met at|met with|lead)/.test(haystack)) {
    return "conference lead";
  }
  if (/(job|role|resume|recruiter|interview|hiring|offer)/.test(haystack)) {
    return "job target";
  }
  if (/(competitor|compare|vs\\.?|versus|peer)/.test(haystack)) {
    return "competitor watch";
  }
  if (/(portfolio|thesis|market|trend|watch)/.test(haystack) || args.lens === "investor") {
    return "market watch";
  }

  const normalizedType = args.entityType.toLowerCase();
  if (normalizedType === "job") return "job target";
  if (normalizedType === "market") return "market watch";
  if (normalizedType === "person") return "people research";
  if (normalizedType === "note") return "working note";
  return "company briefing";
}

function toContextType(entityType: string): "company" | "person" | "role" | "note" {
  if (entityType === "person") return "person";
  if (entityType === "job") return "role";
  if (entityType === "note") return "note";
  return "company";
}

function tokenizeText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !TOKEN_STOPWORDS.has(token));
}

function collectReportDomains(report: Doc<"productReports"> | null | undefined) {
  const domains = new Set<string>();
  for (const source of report?.sources ?? []) {
    if (typeof source?.domain === "string" && source.domain.trim()) {
      domains.add(source.domain.trim().toLowerCase());
    }
  }
  return domains;
}

function collectReportTokens(report: Doc<"productReports"> | null | undefined) {
  const tokens = new Set<string>();
  for (const token of tokenizeText(`${report?.title ?? ""} ${report?.summary ?? ""} ${report?.query ?? ""}`)) {
    tokens.add(token);
  }
  return tokens;
}

export async function upsertEntityContextItem(
  ctx: any,
  args: {
    ownerKey: string;
    entitySlug: string;
    entityName: string;
    entityType: string;
    summary: string;
    linkedReportId?: Id<"productReports">;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("productContextItems")
    .withIndex("by_owner_entity", (q: any) => q.eq("ownerKey", args.ownerKey).eq("entity", args.entitySlug))
    .collect();

  const match =
    existing.find((item: Doc<"productContextItems">) => item.type === toContextType(args.entityType)) ??
    existing[0] ??
    null;

  const patch = {
    type: toContextType(args.entityType),
    title: args.entityName,
    summary: summarizeText(args.summary, `${args.entityName} memory workspace`),
    tags: [args.entityType, "entity-memory"],
    entity: args.entitySlug,
    linkedReportId: args.linkedReportId,
    permissions: {
      chat: true,
      reports: true,
      nudges: true,
    },
    updatedAt: args.now,
  };

  if (match) {
    await ctx.db.patch(match._id, patch);
    return match._id;
  }

  return await ctx.db.insert("productContextItems", {
    ownerKey: args.ownerKey,
    createdAt: args.now,
    ...patch,
  });
}

export async function ensureEntityForReport(
  ctx: any,
  args: {
    ownerKey: string;
    primaryEntity?: string | null;
    entitySlugHint?: string | null;
    title: string;
    query: string;
    type?: string | null;
    sourceUrls?: Array<string | null | undefined>;
    lens?: string | null;
    summary: string;
    now: number;
  },
): Promise<{
  entityId: Id<"productEntities">;
  entitySlug: string;
  entityName: string;
  entityType: string;
  revision: number;
  previousReportId: Id<"productReports"> | null;
  previousReport: Doc<"productReports"> | null;
  reportCount: number;
}> {
  const derivedEntityName = pickProductEntityName({
    primaryEntity: args.primaryEntity,
    title: args.title,
    query: args.query,
    type: args.type,
  });
  const entitySlugHint = args.entitySlugHint?.trim() || null;
  const lookupSlug = entitySlugHint || slugifyProductEntityName(derivedEntityName);

  let entity = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_slug", (q: any) => q.eq("ownerKey", args.ownerKey).eq("slug", lookupSlug))
    .first();

  const entityName = entity?.name || derivedEntityName;
  const entitySlug = entity?.slug || lookupSlug;
  const entityType = inferProductEntityType({
    type: args.type,
    entityName,
    title: entityName,
    query: args.query,
    sourceUrls: args.sourceUrls,
  });

  if (!entity) {
    const entitySummary = summarizeText(
      args.summary,
      `${entityName} memory workspace`,
    );
    const savedBecause = inferProductSavedBecause({
      entityType,
      title: args.title,
      query: args.query,
      lens: args.lens,
    });
    const entityId = await ctx.db.insert("productEntities", {
      ownerKey: args.ownerKey,
      slug: entitySlug,
      name: entityName,
      entityType,
      summary: entitySummary,
      savedBecause,
      latestRevision: 0,
      reportCount: 0,
      // Denormalized for federated search index `search_entities`. Same
      // fields concatenated as `composeSearchableText` so search hits
      // immediately on insert without a backfill round-trip.
      searchableText: composeSearchableText([
        entityName,
        entitySlug,
        entitySummary,
        savedBecause,
      ]),
      createdAt: args.now,
      updatedAt: args.now,
    });
    // PR E: schedule per-row OpenAI embedding so the vector index sees this
    // entity without waiting for the daily backfill. Idempotent on
    // searchableTextHash — re-schedule is safe.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedEntityRow,
      { entityId },
    );
    entity = await ctx.db.get(entityId);
  }

  if (!entity) {
    throw new Error("Could not create entity");
  }

  const previousReport =
    entity.latestReportId ? await ctx.db.get(entity.latestReportId) : null;
  const revision = (entity.latestRevision ?? 0) + 1;

  return {
    entityId: entity._id,
    entitySlug,
    entityName,
    entityType,
    revision,
    previousReportId: previousReport?._id ?? null,
    previousReport,
    reportCount: Math.max(entity.reportCount ?? 0, revision),
  };
}

type RelatedEntityCandidate = {
  name: string;
  slug: string;
  entityType: string;
  relation: string;
  summary: string;
};

type EntityBrowseCard = {
  _id: Id<"productEntities">;
  ownerKey: string;
  slug: string;
  name: string;
  entityType: string;
  summary: string;
  savedBecause?: string;
  latestRevision: number;
  reportCount: number;
  createdAt: number;
  updatedAt: number;
  latestReportId?: Id<"productReports">;
  latestReportType?: string;
  latestReportRouting?: Doc<"productReports">["routing"];
  latestReportOperatorContext?: Doc<"productReports">["operatorContext"];
  latestReportUpdatedAt?: number;
  thumbnailUrl?: string;
  thumbnailUrls?: string[];
  sourceUrls?: string[];
  sourceLabels?: string[];
  canonicalAliasKey: string;
  canonicalDisplayName: string;
};

function choosePreferredEntityBrowseCard(
  cards: EntityBrowseCard[],
  displayName: string,
): EntityBrowseCard {
  const displaySlug = slugifyProductEntityName(displayName);
  return [...cards].sort((left, right) => {
    const leftMatchesDisplaySlug = Number(left.slug === displaySlug);
    const rightMatchesDisplaySlug = Number(right.slug === displaySlug);
    if (leftMatchesDisplaySlug !== rightMatchesDisplaySlug) {
      return rightMatchesDisplaySlug - leftMatchesDisplaySlug;
    }
    if ((left.latestReportUpdatedAt ?? 0) !== (right.latestReportUpdatedAt ?? 0)) {
      return (right.latestReportUpdatedAt ?? 0) - (left.latestReportUpdatedAt ?? 0);
    }
    if ((left.reportCount ?? 0) !== (right.reportCount ?? 0)) {
      return (right.reportCount ?? 0) - (left.reportCount ?? 0);
    }
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  })[0]!;
}

export function mergeEntityBrowseCards(cards: EntityBrowseCard[]): EntityBrowseCard[] {
  const grouped = new Map<string, EntityBrowseCard[]>();
  for (const card of cards) {
    const groupKey = `${card.ownerKey}:${card.entityType}:${card.canonicalAliasKey}`;
    const existing = grouped.get(groupKey) ?? [];
    existing.push(card);
    grouped.set(groupKey, existing);
  }

  return [...grouped.values()]
    .map((group) => {
      if (group.length === 1) {
        return group[0]!;
      }

      const displayName =
        chooseEntityDisplayName(
          group.flatMap((card) => [card.canonicalDisplayName, card.name]),
          group[0]?.entityType,
        ) ?? group[0]!.name;
      const preferred = choosePreferredEntityBrowseCard(group, displayName);

      const thumbnailUrls = [...new Set(group.flatMap((card) => card.thumbnailUrls ?? []))].slice(0, 4);
      const sourceUrls = [...new Set(group.flatMap((card) => card.sourceUrls ?? []))].slice(0, 4);
      const sourceLabels = [...new Set(group.flatMap((card) => card.sourceLabels ?? []))].slice(0, 4);

      return {
        ...preferred,
        name: displayName,
        summary: preferred.summary,
        latestRevision: Math.max(...group.map((card) => card.latestRevision ?? 0)),
        reportCount: group.reduce((sum, card) => sum + Math.max(card.reportCount ?? 0, 0), 0),
        updatedAt: Math.max(...group.map((card) => card.updatedAt ?? 0)),
        latestReportUpdatedAt: Math.max(...group.map((card) => card.latestReportUpdatedAt ?? 0)),
        thumbnailUrl: thumbnailUrls[0] ?? preferred.thumbnailUrl,
        thumbnailUrls,
        sourceUrls,
        sourceLabels,
        canonicalDisplayName: displayName,
      };
    })
    .sort((left, right) => (right.latestReportUpdatedAt ?? right.updatedAt) - (left.latestReportUpdatedAt ?? left.updatedAt));
}

function inferEntityNameFromUrl(url: string, sourceLabel?: string | null) {
  const linkedInId = extractLinkedInPublicIdentifier(url);
  if (linkedInId) {
    const fromLabel = trimLinkedInLabel(sourceLabel);
    if (fromLabel && fromLabel.toLowerCase() !== "linkedin") {
      return fromLabel;
    }
    return toSentenceCase(linkedInId.replace(/[-_]+/g, " "));
  }

  const domainSlug = extractDomainSlug(url);
  if (!domainSlug) return null;
  const fromLabel = trimLinkedInLabel(sourceLabel);
  if (fromLabel && fromLabel.toLowerCase() !== "linkedin") return fromLabel;
  return toSentenceCase(domainSlug.replace(/[-_]+/g, " "));
}

function buildRelatedEntityCandidates(args: {
  primaryEntitySlug: string;
  query: string;
  sources?: Array<{ href?: string; label?: string; title?: string; siteName?: string; domain?: string }>;
}) {
  const queryLines = String(args.query ?? "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const lineByUrl = new Map<string, string>();
  for (const line of queryLines) {
    for (const url of extractUrlsFromText(line)) {
      lineByUrl.set(normalizeComparableUrl(url), line);
    }
  }
  const explicitUrls = new Set(lineByUrl.keys());

  const candidates = new Map<string, RelatedEntityCandidate>();
  for (const source of args.sources ?? []) {
    const href = typeof source.href === "string" ? source.href : undefined;
    if (!href) continue;
    const comparableHref = normalizeComparableUrl(href);
    if (explicitUrls.size > 0 && !explicitUrls.has(comparableHref)) continue;
    const sourceLabel = source.siteName || source.title || source.label || null;
    const name = inferEntityNameFromUrl(href, sourceLabel);
    if (!name) continue;
    const slug = slugifyProductEntityName(name);
    if (!slug || slug === args.primaryEntitySlug) continue;

    const lineHint = lineByUrl.get(comparableHref);
    const explicitRelation = inferRelationFromText(lineHint ?? sourceLabel);
    const entityType =
      isLinkedInPersonUrl(href) || looksLikePersonName(name)
        ? "person"
        : looksLikeCompanyName(name)
          ? "company"
          : source.domain && !/linkedin\.com$/i.test(source.domain)
            ? "company"
            : "person";
    const summary =
      lineHint?.replace(href, "").replace(/\s+/g, " ").trim() ||
      sourceLabel ||
      `Linked from ${args.primaryEntitySlug.replace(/[-_]+/g, " ")}`;

    if (!candidates.has(slug)) {
      candidates.set(slug, {
        name,
        slug,
        entityType,
        relation: explicitRelation,
        summary,
      });
    }
  }

  return [...candidates.values()];
}

async function upsertStandaloneEntity(
  ctx: any,
  args: {
    ownerKey: string;
    name: string;
    slug: string;
    entityType: string;
    summary: string;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_slug", (q: any) => q.eq("ownerKey", args.ownerKey).eq("slug", args.slug))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: args.name,
      entityType: args.entityType,
      summary: summarizeText(args.summary, existing.summary || `${args.name} related entity`),
      updatedAt: args.now,
    });
    return existing;
  }

  const relatedSummary = summarizeText(args.summary, `${args.name} related entity`);
  const relatedSavedBecause =
    args.entityType === "person" ? "people research" : "company briefing";
  const entityId = await ctx.db.insert("productEntities", {
    ownerKey: args.ownerKey,
    slug: args.slug,
    name: args.name,
    entityType: args.entityType,
    summary: relatedSummary,
    savedBecause: relatedSavedBecause,
    searchableText: composeSearchableText([
      args.name,
      args.slug,
      relatedSummary,
      relatedSavedBecause,
    ]),
    latestRevision: 0,
    reportCount: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
  // PR E: schedule per-row embedding for the new related entity.
  await ctx.scheduler.runAfter(
    0,
    internal.domains.search.embedRowOnUpdate.embedEntityRow,
    { entityId },
  );

  return await ctx.db.get(entityId);
}

async function upsertEntityRelation(
  ctx: any,
  args: {
    ownerKey: string;
    fromEntitySlug: string;
    toEntitySlug: string;
    relation: string;
    summary?: string;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("productEntityRelations")
    .withIndex("by_owner_pair", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("fromEntitySlug", args.fromEntitySlug).eq("toEntitySlug", args.toEntitySlug),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      relation: args.relation,
      summary: args.summary,
      updatedAt: args.now,
    });
    return existing._id;
  }

  return await ctx.db.insert("productEntityRelations", {
    ownerKey: args.ownerKey,
    fromEntitySlug: args.fromEntitySlug,
    toEntitySlug: args.toEntitySlug,
    relation: args.relation,
    summary: args.summary,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

function reverseRelation(relation: string, entityType: string) {
  if (relation === "founder" || relation === "cofounder") return "company";
  if (relation === "advisor") return "advisor_to";
  if (relation === "hiring") return "hiring_team";
  return entityType === "person" ? "mentioned_in_packet" : "related_company";
}

export async function upsertExplicitRelatedEntitiesForReport(
  ctx: any,
  args: {
    ownerKey: string;
    primaryEntitySlug: string;
    query: string;
    sources?: Array<{ href?: string; label?: string; title?: string; siteName?: string; domain?: string }>;
    now: number;
  },
) {
  const candidates = buildRelatedEntityCandidates(args);
  for (const candidate of candidates) {
    await upsertStandaloneEntity(ctx, {
      ownerKey: args.ownerKey,
      name: candidate.name,
      slug: candidate.slug,
      entityType: candidate.entityType,
      summary: candidate.summary,
      now: args.now,
    });

    await upsertEntityRelation(ctx, {
      ownerKey: args.ownerKey,
      fromEntitySlug: args.primaryEntitySlug,
      toEntitySlug: candidate.slug,
      relation: candidate.relation,
      summary: candidate.summary,
      now: args.now,
    });

    await upsertEntityRelation(ctx, {
      ownerKey: args.ownerKey,
      fromEntitySlug: candidate.slug,
      toEntitySlug: args.primaryEntitySlug,
      relation: reverseRelation(candidate.relation, candidate.entityType),
      summary: `Linked from ${args.primaryEntitySlug.replace(/[-_]+/g, " ")}`,
      now: args.now,
    });
  }
}

function matchesFilter(entity: {
  entityType?: string;
  name: string;
  latestReportType?: string;
  reportCount?: number;
}, filter?: string) {
  const active = filter ?? "All";
  if (active === "All" || active === "Recent") return true;
  if (active === "Pinned") return false;

  const haystack = `${entity.entityType ?? ""} ${entity.latestReportType ?? ""} ${entity.name}`.toLowerCase();
  if (active === "Companies") return haystack.includes("company");
  if (active === "People") return haystack.includes("person") || haystack.includes("founder");
  if (active === "Jobs") return haystack.includes("job") || haystack.includes("role");
  if (active === "Markets") return haystack.includes("market");
  if (active === "Notes") return haystack.includes("note");
  return true;
}

function buildSectionDiffs(
  currentSections: Array<{ id: string; title: string; body: string }>,
  previousSections: Array<{ id: string; title: string; body: string }> = [],
) {
  const previousMap = new Map(
    previousSections.map((section) => [section.id || section.title.toLowerCase(), section]),
  );

  return currentSections
    .map((section) => {
      const key = section.id || section.title.toLowerCase();
      const previous = previousMap.get(key);
      if (!previous) {
        return {
          id: section.id,
          title: section.title,
          status: "new" as const,
          previousBody: "",
          currentBody: section.body,
        };
      }
      if (previous.body === section.body) return null;
      return {
        id: section.id,
        title: section.title,
        status: "changed" as const,
        previousBody: previous.body,
        currentBody: section.body,
      };
    })
    .filter(Boolean);
}

function normalizeNoteBlocks(
  note:
    | {
        content?: string | null;
        blocks?: Array<{
          id: string;
          kind: "observation" | "insight" | "question" | "action";
          title: string;
          body: string;
        }> | null;
      }
    | null
    | undefined,
) {
  const normalizedBlocks = Array.isArray(note?.blocks)
    ? note!.blocks
        .map((block) => ({
          id: String(block.id || "").trim(),
          kind: block.kind,
          title: String(block.title || "").trim(),
          body: String(block.body || "").trim(),
        }))
        .filter((block) => block.title || block.body)
    : [];

  if (normalizedBlocks.length > 0) {
    return normalizedBlocks;
  }

  const legacyContent = String(note?.content || "").trim();
  if (!legacyContent) return [];

  return [
    {
      id: "legacy-note",
      kind: "observation" as const,
      title: "Working note",
      body: legacyContent,
    },
  ];
}

function stringifyNoteBlocks(
  blocks: Array<{
    id: string;
    kind: "observation" | "insight" | "question" | "action";
    title: string;
    body: string;
  }>,
) {
  return blocks
    .map((block) => {
      const title = block.title?.trim();
      const body = block.body?.trim();
      if (title && body) return `${title}: ${body}`;
      return title || body || "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function buildRelatedEntities(
  ctx: any,
  args: {
    ownerKey: string;
    entity: Doc<"productEntities">;
    latestReport: Doc<"productReports"> | null;
  },
) {
  const explicitRelations = await Promise.all([
    ctx.db
      .query("productEntityRelations")
      .withIndex("by_owner_from", (q: any) => q.eq("ownerKey", args.ownerKey).eq("fromEntitySlug", args.entity.slug))
      .collect(),
    ctx.db
      .query("productEntityRelations")
      .withIndex("by_owner_to", (q: any) => q.eq("ownerKey", args.ownerKey).eq("toEntitySlug", args.entity.slug))
      .collect(),
  ]).then(([fromRelations, toRelations]) => [...fromRelations, ...toRelations]);

  const candidates = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
    .order("desc")
    .take(40);

  const currentDomains = collectReportDomains(args.latestReport);
  const currentTokens = collectReportTokens(args.latestReport);
  const explicitRelationMap = new Map<string, { relation: string; summary?: string }>();
  for (const relation of explicitRelations) {
    const otherSlug =
      relation.fromEntitySlug === args.entity.slug ? relation.toEntitySlug : relation.fromEntitySlug;
    if (!otherSlug || otherSlug === args.entity.slug) continue;
    explicitRelationMap.set(otherSlug, {
      relation: relation.relation,
      summary: relation.summary,
    });
  }

  const related = await Promise.all(
    candidates
      .filter((candidate: Doc<"productEntities">) => candidate._id !== args.entity._id)
      .map(async (candidate: Doc<"productEntities">) => {
        const latestReport = candidate.latestReportId ? await ctx.db.get(candidate.latestReportId) : null;
        const candidateDomains = collectReportDomains(latestReport);
        const candidateTokens = collectReportTokens(latestReport);
        const currentText = `${args.latestReport?.title ?? ""} ${args.latestReport?.summary ?? ""} ${args.latestReport?.query ?? ""}`.toLowerCase();
        const candidateText = `${latestReport?.title ?? ""} ${latestReport?.summary ?? ""} ${latestReport?.query ?? ""}`.toLowerCase();

        let score = 0;
        const reasons: string[] = [];
        const explicitRelation = explicitRelationMap.get(candidate.slug);
        if (explicitRelation) {
          score += 12;
          reasons.push(explicitRelation.summary || explicitRelation.relation.replace(/_/g, " "));
        }

        const sharedDomains = [...candidateDomains].filter((domain) => currentDomains.has(domain));
        if (sharedDomains.length > 0) {
          score += sharedDomains.length * 5;
          reasons.push(`shared sources: ${sharedDomains.slice(0, 2).join(", ")}`);
        }

        const sharedTokens = [...candidateTokens].filter((token) => currentTokens.has(token));
        if (sharedTokens.length > 0) {
          score += Math.min(sharedTokens.length, 4);
          reasons.push(`overlapping themes: ${sharedTokens.slice(0, 3).join(", ")}`);
        }

        if (
          currentText.includes(candidate.name.toLowerCase()) ||
          candidateText.includes(args.entity.name.toLowerCase())
        ) {
          score += 6;
          reasons.push("mentioned together");
        }

        if (candidate.entityType === args.entity.entityType) {
          score += 1;
        }

        if (score <= 0) return null;

        return {
          slug: candidate.slug,
          name: candidate.name,
          entityType: candidate.entityType,
          summary: candidate.summary,
          latestRevision: candidate.latestRevision,
          reportCount: candidate.reportCount,
          reason: reasons.join(" • "),
          score,
        };
      }),
  );

  return related
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

export const listEntities = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    search: v.optional(v.string()),
    filter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];

    const entityGroups = await Promise.all(
      ownerKeys.map((ownerKey) =>
        ctx.db
          .query("productEntities")
          .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
          .order("desc")
          .take(80),
      ),
    );
    const entities = entityGroups
      .flat()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .reduce<Array<(typeof entityGroups)[number][number]>>((acc, entity) => {
        if (acc.some((existing) => existing.slug === entity.slug)) {
          return acc;
        }
        acc.push(entity);
        return acc;
      }, []);

    const search = args.search?.trim().toLowerCase() ?? "";

    const filteredEntities = entities.filter((entity) => {
        if (!entity.latestReportId && (entity.reportCount ?? 0) <= 0) return false;
        const matchesSearch =
          !search ||
          entity.name.toLowerCase().includes(search) ||
          entity.summary.toLowerCase().includes(search);
        return matchesSearch && matchesFilter(entity, args.filter);
      });

    const cards = await Promise.all(
      filteredEntities.map(async (entity) => {
        const recentReports = await ctx.db
          .query("productReports")
          .withIndex("by_owner_entity_updated", (q) =>
            q.eq("ownerKey", entity.ownerKey).eq("entitySlug", entity.slug),
          )
          .order("desc")
          .take(4);

        const latestReport = recentReports[0] ?? null;
        const thumbnailSeen = new Set<string>();
        const thumbnailUrls: string[] = [];
        const sourceUrlSeen = new Set<string>();
        const sourceUrls: string[] = [];
        const sourceLabelSeen = new Set<string>();
        const sourceLabels: string[] = [];

        for (const report of recentReports) {
          const reportThumbnailUrls = await resolveProductThumbnailUrls(ctx, {
            evidenceItemIds: report.evidenceItemIds,
            sources: report.sources,
          });
          for (const url of reportThumbnailUrls) {
            if (thumbnailSeen.has(url) || thumbnailUrls.length >= 4) continue;
            thumbnailSeen.add(url);
            thumbnailUrls.push(url);
          }

          for (const source of report.sources ?? []) {
            const href = typeof source?.href === "string" ? source.href : null;
            if (href && !sourceUrlSeen.has(href) && sourceUrls.length < 4) {
              sourceUrlSeen.add(href);
              sourceUrls.push(href);
            }

            const label = source?.siteName || source?.label || source?.title || source?.domain || null;
            if (
              typeof label === "string" &&
              label.trim() &&
              !sourceLabelSeen.has(label) &&
              sourceLabels.length < 4
            ) {
              sourceLabelSeen.add(label);
              sourceLabels.push(label);
            }
          }
        }

        const latestReportType = latestReport?.type;
        if (
          isPrepBriefType(latestReportType) &&
          isPlaceholderPrepEntity(entity.name)
        ) {
          return null;
        }
        if (
          isLegacyPromptArtifact({
            type: latestReportType,
            entitySlug: entity.slug,
            primaryEntity: entity.name,
            title: latestReport?.title,
            query: latestReport?.query,
          })
        ) {
          return null;
        }

        const canonicalDisplayName =
          chooseEntityDisplayName(
            [
              latestReport?.primaryEntity,
              deriveCanonicalEntityName({
                primaryEntity: latestReport?.primaryEntity ?? entity.name,
                title: latestReport?.title,
                query: latestReport?.query,
                type: latestReportType,
              }),
              entity.name,
            ],
            entity.entityType,
          ) ?? entity.name;
        const canonicalAliasKey =
          buildEntityAliasKey({
            primaryEntity: latestReport?.primaryEntity ?? entity.name,
            title: latestReport?.title,
            query: latestReport?.query,
            type: latestReportType,
            entityType: entity.entityType,
            slug: entity.slug,
          }) ?? entity.slug;

        return {
          ...entity,
          latestReportType,
          latestReportRouting: latestReport?.routing,
          latestReportOperatorContext: latestReport?.operatorContext,
          latestReportUpdatedAt: latestReport?.updatedAt,
          thumbnailUrl: thumbnailUrls[0],
          thumbnailUrls,
          sourceUrls,
          sourceLabels,
          canonicalAliasKey,
          canonicalDisplayName,
        };
      }),
    ).then((items) => items.filter((item): item is NonNullable<typeof items[number]> => Boolean(item)));

    return mergeEntityBrowseCards(cards as EntityBrowseCard[]).map(
      ({ canonicalAliasKey: _canonicalAliasKey, canonicalDisplayName: _canonicalDisplayName, ...card }) => card,
    );
  },
});

export const getEntityWorkspace = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    if (!workspaceAccess) return null;

    const { entity } = workspaceAccess;
    const dataOwnerKey = entity.ownerKey;

    const timeline = await ctx.db
      .query("productReports")
      .withIndex("by_owner_entity_updated", (q) =>
        q.eq("ownerKey", dataOwnerKey).eq("entitySlug", args.entitySlug),
      )
      .order("desc")
      .take(12);

    const note = await ctx.db
      .query("productEntityNotes")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .first();
    const noteDocument = await getEntityMemoryDocumentWorkspace(ctx, dataOwnerKey, args.entitySlug);

    const entityEvidence = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_entity", (q: any) => q.eq("ownerKey", dataOwnerKey).eq("entityId", entity._id))
      .collect();

    const reportEvidenceLists = await Promise.all(
      timeline.slice(0, 5).map((report) =>
        ctx.db
          .query("productEvidenceItems")
          .withIndex("by_owner_report", (q: any) => q.eq("ownerKey", dataOwnerKey).eq("reportId", report._id))
          .collect(),
      ),
    );

    const evidence = [...entityEvidence, ...reportEvidenceLists.flat()]
      .filter((item, index, list) => list.findIndex((candidate) => candidate.label === item.label) === index)
      .slice(0, 10);

    const timelineWithDiffs = timeline.map((report, index) => {
      const previous = timeline[index + 1] ?? null;
      return {
        ...report,
        diffs: buildSectionDiffs(report.sections ?? [], previous?.sections ?? []),
        isLatest: index === 0,
      };
    });

    const latest = timelineWithDiffs[0] ?? null;
    const relatedEntities = await buildRelatedEntities(ctx, {
      ownerKey: dataOwnerKey,
      entity,
      latestReport: latest,
    });
    const contextItems = await ctx.db
      .query("productContextItems")
      .withIndex("by_owner_entity", (q) => q.eq("ownerKey", dataOwnerKey).eq("entity", args.entitySlug))
      .collect();
    const normalizedNoteBlocks = normalizeNoteBlocks(note);
    const activeShares = workspaceAccess.canManageShare
      ? await listActiveEntityWorkspaceShares(ctx, dataOwnerKey, entity._id)
      : [];
    const activeMembers = workspaceAccess.canManageMembers
      ? await listActiveEntityWorkspaceMembers(ctx, dataOwnerKey, entity._id)
      : [];
    const activeInvites = workspaceAccess.canManageMembers
      ? await listActiveEntityWorkspaceInvites(ctx, dataOwnerKey, entity._id)
      : [];
    const ownerUserId = entity.ownerKey.startsWith("user:")
      ? (entity.ownerKey.slice("user:".length) as Id<"users">)
      : null;
    const ownerUser = ownerUserId ? await ctx.db.get(ownerUserId) : null;
    const viewShare = activeShares.find((share) => share.access === "view") ?? null;
    const editShare = activeShares.find((share) => share.access === "edit") ?? null;

    return {
      entity,
      note: note
        ? {
            ...note,
            blocks: normalizedNoteBlocks,
          }
        : noteDocument
          ? {
              _id: noteDocument._id,
              content: noteDocument.plainText,
              createdAt: noteDocument.createdAt,
              updatedAt: noteDocument.updatedAt,
            }
          : null,
      noteDocument,
      latest,
      timeline: timelineWithDiffs,
      evidence,
      contextItems,
      relatedEntities,
      viewerAccess: {
        mode: workspaceAccess.mode,
        access: workspaceAccess.access,
        canEditNotes: workspaceAccess.canEditNotes,
        canEditNotebook: workspaceAccess.canEditNotebook,
        canManageShare: workspaceAccess.canManageShare,
        canManageMembers: workspaceAccess.canManageMembers,
      },
      viewerIdentity: {
        ownerKey: workspaceAccess.identity.ownerKey ?? null,
      },
      ownerProfile: ownerUser
        ? {
            ownerKey: entity.ownerKey,
            userId: ownerUser._id,
            email: typeof ownerUser.email === "string" ? ownerUser.email : undefined,
            name: typeof ownerUser.name === "string" ? ownerUser.name : undefined,
            image: typeof ownerUser.image === "string" ? ownerUser.image : undefined,
          }
        : {
            ownerKey: entity.ownerKey,
            userId: undefined,
            email: undefined,
            name: undefined,
            image: undefined,
          },
      shareLinks: workspaceAccess.canManageShare
        ? {
            view: viewShare
              ? {
                  token: viewShare.token,
                  access: viewShare.access,
                }
              : null,
            edit: editShare
              ? {
                  token: editShare.token,
                  access: editShare.access,
                }
              : null,
          }
        : null,
      collaborators: workspaceAccess.canManageShare || workspaceAccess.canManageMembers
        ? {
            members: activeMembers.map((member) => ({
              _id: member._id,
              userId: member.userId,
              email: member.userEmail,
              name: member.userName,
              image: member.userImage,
              access: member.access,
              token: member.token,
              notificationStatus: member.notificationStatus,
              notificationUpdatedAt: member.notificationUpdatedAt,
              notificationError: member.notificationError,
              updatedAt: member.updatedAt,
            })),
            invites: activeInvites.map((invite) => ({
              _id: invite._id,
              email: invite.email,
              access: invite.access,
              token: invite.token,
              notificationStatus: invite.notificationStatus,
              notificationUpdatedAt: invite.notificationUpdatedAt,
              notificationError: invite.notificationError,
              updatedAt: invite.updatedAt,
            })),
          }
        : null,
    };
  },
});

export const recallEntityMemory = query({
  args: {
    ownerKey: v.string(),
    entityTargets: v.array(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedTargets = [...new Set<string>(
      args.entityTargets
        .map((target) => target.trim().toLowerCase())
        .filter((target) => target.length > 0),
    )].slice(0, 8);

    if (normalizedTargets.length === 0) return [];

    const candidateEntities = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", args.ownerKey))
      .order("desc")
      .take(48);

    const matched = candidateEntities.filter((entity) => {
      const normalizedName = entity.name.trim().toLowerCase();
      const normalizedSlug = entity.slug.trim().toLowerCase();
      return normalizedTargets.some((target) =>
        target === normalizedName
        || target === normalizedSlug
        || normalizedName.includes(target)
        || target.includes(normalizedName),
      );
    });

    const limited = matched.slice(0, Math.max(1, Math.min(args.limit ?? 3, 6)));

    return await Promise.all(
      limited.map(async (entity) => {
        const latestReport = entity.latestReportId ? await ctx.db.get(entity.latestReportId) : null;
        const note = await ctx.db
          .query("productEntityNotes")
          .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
          .first();

        return {
          entitySlug: entity.slug,
          entityName: entity.name,
          entityType: entity.entityType,
          summary: entity.summary,
          savedBecause: entity.savedBecause ?? null,
          latestRevision: entity.latestRevision,
          updatedAt: entity.updatedAt,
          latestReportTitle: latestReport?.title ?? null,
          latestReportSummary: latestReport?.summary ?? null,
          noteSnippet: note?.content?.slice(0, 280) ?? null,
        };
      }),
    );
  },
});

export const saveEntityNotes = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entityId: v.id("productEntities"),
    content: v.optional(v.string()),
    blocks: v.optional(v.array(productNoteBlockValidator)),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await ctx.db.get(args.entityId);
    if (!entity || entity.ownerKey !== identity.ownerKey) {
      throw new Error("Entity not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("productEntityNotes")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();

    const normalizedBlocks = normalizeNoteBlocks({
      content: args.content,
      blocks: args.blocks as any,
    });
    const normalizedContent = String(args.content || "").trim() || stringifyNoteBlocks(normalizedBlocks);

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: normalizedContent,
        blocks: normalizedBlocks,
        updatedAt: now,
      });
      await upsertEntityContextItem(ctx, {
        ownerKey: entity.ownerKey,
        entitySlug: entity.slug,
        entityName: entity.name,
        entityType: entity.entityType,
        summary: normalizedContent || `${entity.name} working notes`,
        now,
      });
      return existing._id;
    }

    const noteId = await ctx.db.insert("productEntityNotes", {
      ownerKey: entity.ownerKey,
      entityId: args.entityId,
      content: normalizedContent,
      blocks: normalizedBlocks,
      createdAt: now,
      updatedAt: now,
    });
    await upsertEntityContextItem(ctx, {
      ownerKey: entity.ownerKey,
      entitySlug: entity.slug,
      entityName: entity.name,
      entityType: entity.entityType,
      summary: normalizedContent || `${entity.name} working notes`,
      now,
    });
    return noteId;
  },
});

export const updateEntitySavedBecause = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entityId: v.id("productEntities"),
    savedBecause: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await ctx.db.get(args.entityId);
    if (!entity || entity.ownerKey !== identity.ownerKey) {
      throw new Error("Entity not found");
    }

    const nextValue = args.savedBecause.trim().slice(0, 120);
    // Refresh searchableText so the federated `search_entities` index sees the
    // updated savedBecause value (PR D — patch-site hook).
    const nextSearchableText = recomputeEntitySearchableText({
      ...entity,
      savedBecause: nextValue,
    });
    await ctx.db.patch(entity._id, {
      savedBecause: nextValue,
      searchableText: nextSearchableText,
      updatedAt: Date.now(),
    });
    // PR E: searchableText changed — refresh the embedding.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedEntityRow,
      { entityId: entity._id },
    );

    return { ok: true, savedBecause: nextValue };
  },
});

export const listAttachableEvidence = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];

    let entity: Doc<"productEntities"> | null = null;
    for (const ownerKey of ownerKeys) {
      entity = await ctx.db
        .query("productEntities")
        .withIndex("by_owner_slug", (q) => q.eq("ownerKey", ownerKey).eq("slug", args.entitySlug))
        .first();
      if (entity) break;
    }
    if (!entity) return [];

    const evidence = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", entity.ownerKey))
      .order("desc")
      .take(30);

    return evidence
      .filter((item) => !item.entityId || item.entityId === entity._id)
      .map((item) => ({
        _id: item._id,
        label: item.label,
        type: item.type,
        entityId: item.entityId ?? null,
        updatedAt: item.updatedAt,
      }));
  },
});

export const attachEvidenceToEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entityId: v.id("productEntities"),
    evidenceId: v.id("productEvidenceItems"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const [entity, evidence] = await Promise.all([ctx.db.get(args.entityId), ctx.db.get(args.evidenceId)]);
    if (!entity || entity.ownerKey !== identity.ownerKey) {
      throw new Error("Entity not found");
    }
    if (!evidence || evidence.ownerKey !== identity.ownerKey) {
      throw new Error("Evidence not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.evidenceId, {
      entityId: entity._id,
      status: "linked",
      updatedAt: now,
    });

    const existingContext = await ctx.db
      .query("productContextItems")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(30);
    const matchingFileContext =
      existingContext.find(
        (item: Doc<"productContextItems">) =>
          item.type === "file" &&
          item.title === evidence.label,
      ) ?? null;

    if (matchingFileContext) {
      await ctx.db.patch(matchingFileContext._id, {
        entity: entity.slug,
        summary: evidence.description ?? matchingFileContext.summary,
        updatedAt: now,
      });
    }

    return { ok: true };
  },
});

export const ensureEntityBackfill = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const reports = await ctx.db
      .query("productReports")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .collect();

    const ordered = [...reports].sort((left, right) => (left.createdAt ?? left.updatedAt) - (right.createdAt ?? right.updatedAt));
    let linked = 0;

    for (const report of ordered) {
      if (report.entityId && report.entitySlug && report.revision) continue;
      const entityMeta = await ensureEntityForReport(ctx, {
        ownerKey,
        primaryEntity: report.primaryEntity,
        title: report.title,
        query: report.query,
        type: report.type,
        lens: report.lens,
        summary: report.summary,
        now: report.updatedAt,
      });

      // PR D: refresh searchableText for the federated `search_reports`
      // index — entitySlug is part of the composed string.
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

      const existingEntity = await ctx.db.get(entityMeta.entityId);
      const nextEntitySummary = summarizeText(
        report.summary,
        entityMeta.entityName,
      );
      const nextEntitySavedBecause =
        existingEntity?.savedBecause ??
        inferProductSavedBecause({
          entityType: entityMeta.entityType,
          title: report.title,
          query: report.query,
          lens: report.lens,
        });
      // Refresh searchableText so the federated `search_entities` index sees
      // the renamed/retyped entity (PR D — patch-site hook).
      const nextEntitySearchableText = recomputeEntitySearchableText({
        name: entityMeta.entityName,
        slug: existingEntity?.slug ?? entityMeta.entitySlug,
        summary: nextEntitySummary,
        savedBecause: nextEntitySavedBecause,
      });
      await ctx.db.patch(entityMeta.entityId, {
        name: entityMeta.entityName,
        entityType: entityMeta.entityType,
        summary: nextEntitySummary,
        savedBecause: nextEntitySavedBecause,
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
      await upsertExplicitRelatedEntitiesForReport(ctx, {
        ownerKey,
        primaryEntitySlug: entityMeta.entitySlug,
        query: report.query,
        sources: report.sources,
        now: report.updatedAt,
      });
      for (const evidenceId of report.evidenceItemIds ?? []) {
        await ctx.db.patch(evidenceId, {
          entityId: entityMeta.entityId,
          status: "linked",
          updatedAt: report.updatedAt,
        });
      }
      linked += 1;
    }

    return { linked };
  },
});

export const repairEntityModelBackfill = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const reports = await ctx.db
      .query("productReports")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .collect();

    let repairedEntities = 0;
    let relationUpdates = 0;
    for (const report of reports) {
      if (!report.entityId || !report.entitySlug) continue;
      const entity = await ctx.db.get(report.entityId);
      if (!entity || entity.ownerKey !== ownerKey) continue;

      const nextName = pickProductEntityName({
        primaryEntity: report.primaryEntity,
        title: report.title,
        query: report.query,
        type: report.type,
      });
      const nextType = inferProductEntityType({
        type: report.type,
        entityName: nextName,
        title: report.title,
        query: report.query,
        sourceUrls: report.sources?.map((source: any) => source?.href),
      });

      if (entity.name !== nextName || entity.entityType !== nextType) {
        const nextSummary = entity.summary || report.summary;
        // Refresh searchableText so the federated `search_entities` index sees
        // the renamed entity (PR D — patch-site hook).
        const nextSearchableText = recomputeEntitySearchableText({
          name: nextName,
          slug: entity.slug,
          summary: nextSummary,
          savedBecause: entity.savedBecause,
        });
        await ctx.db.patch(entity._id, {
          name: nextName,
          entityType: nextType,
          summary: nextSummary,
          searchableText: nextSearchableText,
          updatedAt: Date.now(),
        });
        // PR E: schedule per-row embedding for the repaired entity.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedEntityRow,
          { entityId: entity._id },
        );
        repairedEntities += 1;
      }

      await upsertEntityContextItem(ctx, {
        ownerKey,
        entitySlug: report.entitySlug,
        entityName: nextName,
        entityType: nextType,
        summary: report.summary,
        linkedReportId: report._id,
        now: report.updatedAt,
      });

      const beforeRelations = await ctx.db
        .query("productEntityRelations")
        .withIndex("by_owner_from", (q: any) => q.eq("ownerKey", ownerKey).eq("fromEntitySlug", report.entitySlug!))
        .collect();
      await upsertExplicitRelatedEntitiesForReport(ctx, {
        ownerKey,
        primaryEntitySlug: report.entitySlug,
        query: report.query,
        sources: report.sources,
        now: report.updatedAt,
      });
      const afterRelations = await ctx.db
        .query("productEntityRelations")
        .withIndex("by_owner_from", (q: any) => q.eq("ownerKey", ownerKey).eq("fromEntitySlug", report.entitySlug!))
        .collect();
      relationUpdates += Math.max(0, afterRelations.length - beforeRelations.length);
    }

    return {
      repairedEntities,
      relationUpdates,
    };
  },
});

/**
 * ensureEntity — minimal entity creation for load testing and direct API use.
 *
 * Creates a bare productEntities row under the caller's ownerKey if one with
 * the given slug doesn't already exist. Idempotent: if the entity exists,
 * returns it unchanged.
 *
 * Used by scripts/loadtest/notebook-load.mjs to seed the target entity before
 * running block-append scenarios (without going through a full chat session).
 */
export const ensureEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    slug: v.string(),
    name: v.optional(v.string()),
    entityType: v.optional(v.string()),
    summary: v.optional(v.string()),
    savedBecause: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;

    const existing = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) => q.eq("ownerKey", ownerKey).eq("slug", args.slug))
      .first();
    if (existing) {
      return { entityId: existing._id, slug: existing.slug, created: false };
    }

    const now = Date.now();
    const seedName = args.name ?? args.slug;
    const seedSummary = summarizeText(
      args.summary ?? `${seedName} workspace`,
      `${args.slug} workspace`,
    );
    const seedSavedBecause = args.savedBecause?.trim() || "load-test-seed";
    const entityId = await ctx.db.insert("productEntities", {
      ownerKey,
      slug: args.slug,
      name: seedName,
      entityType: args.entityType ?? "company",
      summary: seedSummary,
      savedBecause: seedSavedBecause,
      searchableText: composeSearchableText([
        seedName,
        args.slug,
        seedSummary,
        seedSavedBecause,
      ]),
      latestRevision: 0,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    // PR E: schedule per-row embedding for the seeded entity.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedEntityRow,
      { entityId },
    );
    return { entityId, slug: args.slug, created: true };
  },
});


/**
 * resolveOrCreateEntityForChat — Tier 0 synchronous stub for the chat entry.
 *
 * Given a free-form query or a hint slug/name, resolves to an existing entity
 * under the caller's ownerKey or creates a minimal shell on the spot. Returns
 * a small `shellSummary` the client can render immediately while the
 * background fast-lane run is still warming up.
 *
 * Contract: <200ms. No external tool calls, no projection materialization,
 * no report creation. This is the "anchor the thread to an artifact" step.
 */
export const resolveOrCreateEntityForChat = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    query: v.optional(v.string()),
    slugHint: v.optional(v.string()),
    nameHint: v.optional(v.string()),
    entityType: v.optional(v.string()),
  },
  returns: v.object({
    slug: v.string(),
    entityId: v.id("productEntities"),
    isNew: v.boolean(),
    shellSummary: v.object({
      title: v.string(),
      entityType: v.string(),
      lastUpdatedAt: v.number(),
      blockCount: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;

    const seed =
      args.slugHint?.trim() ||
      args.nameHint?.trim() ||
      args.query?.trim() ||
      "";
    if (!seed) {
      throw new Error("resolveOrCreateEntityForChat requires slugHint, nameHint, or query");
    }
    const slug = slugifyProductEntityName(seed);
    const displayName = (args.nameHint?.trim() || args.query?.trim() || slug).slice(0, 200);

    let entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) => q.eq("ownerKey", ownerKey).eq("slug", slug))
      .first();

    const now = Date.now();
    let isNew = false;
    if (!entity) {
      const tier0Summary = summarizeText(
        `${displayName} workspace`,
        `${slug} workspace`,
      );
      const entityId = await ctx.db.insert("productEntities", {
        ownerKey,
        slug,
        name: displayName,
        entityType: args.entityType ?? "company",
        summary: tier0Summary,
        savedBecause: "chat-tier0",
        searchableText: composeSearchableText([
          displayName,
          slug,
          tier0Summary,
          "chat-tier0",
        ]),
        latestRevision: 0,
        reportCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      // PR E: schedule per-row embedding for the tier-0 chat entity.
      await ctx.scheduler.runAfter(
        0,
        internal.domains.search.embedRowOnUpdate.embedEntityRow,
        { entityId },
      );
      entity = await ctx.db.get(entityId);
      isNew = true;
    }
    if (!entity) throw new Error("Failed to resolve or create entity");

    const blockRows = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity", (q) => q.eq("ownerKey", ownerKey).eq("entityId", entity!._id))
      .take(500);
    const liveBlocks = blockRows.filter((row) => !row.deletedAt);
    const latestBlockUpdatedAt = liveBlocks.reduce<number>(
      (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
      0,
    );

    return {
      slug: entity.slug,
      entityId: entity._id,
      isNew,
      shellSummary: {
        title: entity.name,
        entityType: entity.entityType,
        lastUpdatedAt: Math.max(entity.updatedAt, latestBlockUpdatedAt),
        blockCount: liveBlocks.length,
      },
    };
  },
});

/**
 * buildKnownEntityStateMarkdown — Tier 0 cache-prime.
 *
 * Assembles a compact markdown block that tells the chat agent "here is what
 * we already know about this entity — do NOT re-fetch; synthesize first."
 * Reads productEntities + productBlocks + diligenceProjections inline. Cheap
 * (all indexed) and safe to call from a mutation or an action via runQuery.
 *
 * Returns null when the entity does not exist under the caller's ownerKey.
 */
export async function buildKnownEntityStateMarkdown(
  ctx: { db: any },
  args: { ownerKey: string; entitySlug: string },
): Promise<string | null> {
  const entity = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_slug", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("slug", args.entitySlug),
    )
    .first();
  if (!entity) return null;

  const blockRows = await ctx.db
    .query("productBlocks")
    .withIndex("by_owner_entity", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("entityId", entity._id),
    )
    .take(500);
  const liveBlocks = blockRows.filter((row: any) => !row.deletedAt);
  const blockCount = liveBlocks.length;
  let latestUpdatedAt: number = entity.updatedAt as number;
  for (const row of liveBlocks) {
    if (row.updatedAt > latestUpdatedAt) latestUpdatedAt = row.updatedAt;
  }

  const projections = await ctx.db
    .query("diligenceProjections")
    .withIndex("by_owner_entity", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("entityId", entity._id),
    )
    .order("desc")
    .take(20);
  const byType = new Map<string, any>();
  for (const row of projections) {
    if (
      row.producerAssurance !== "internal_structuring_v1" &&
      row.producerAssurance !== "internal_canonical_v1"
    ) {
      continue;
    }
    const prior = byType.get(row.blockType);
    if (!prior || row.version > prior.version) byType.set(row.blockType, row);
  }
  const topProjections = Array.from(byType.values()).slice(0, 8);

  const lines: string[] = [];
  lines.push("[KNOWN ENTITY STATE — synthesize from this before calling new tools]");
  lines.push(`- entity: ${entity.name} (slug=${entity.slug}, type=${entity.entityType})`);
  lines.push(`- lastUpdatedAt: ${new Date(latestUpdatedAt).toISOString()}`);
  lines.push(`- notebookBlocks: ${blockCount} live`);
  if (topProjections.length > 0) {
    lines.push(`- projections (${topProjections.length}):`);
    for (const p of topProjections) {
      const header = String(p.headerText ?? p.blockType ?? "").slice(0, 100);
      const body = String(p.bodyProse ?? "").replace(/\s+/g, " ").slice(0, 200);
      const tier = String(p.overallTier ?? "unverified");
      lines.push(`  • [${p.blockType}/${tier}] ${header}${body ? ` — ${body}` : ""}`);
    }
  }
  lines.push("[END KNOWN ENTITY STATE]");
  return lines.join("\n");
}


/**
 * Tier B2 — getProductPulseMetrics
 *
 * Aggregates product owner state plus public/system intelligence corpus tables
 * into the metric tile shape the Home Pulse strip + the avatar status panel's
 * "Today's pulse" section render. Owner-scoped product rows capture private
 * workspace memory; daily brief, LinkedIn archive, entity context, and graph
 * rows capture shared public system memory. Private notes stay excluded.
 *
 * The kit's PulseStrip + Avatar use these slugs.  Where a metric requires
 * data we don't yet ledger (memory-hit ratio, paid-call counts, average
 * sourced-answer latency), the field returns null and the UI falls back to
 * the seed value for that tile.
 */
export const getProductPulseMetrics = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    const lookbackHours = args.lookbackHours ?? 168;  // default 7 days
    const lookbackCutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

    // Entities tracked (lifetime — count rows per ownerKey).
    let entitiesTracked = 0;
    let reportsCreated = 0;
    for (const ownerKey of ownerKeys) {
      const entities = await ctx.db
        .query("productEntities")
        .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
        .take(2000);
      entitiesTracked += entities.length;
      const reports = await ctx.db
        .query("productReports")
        .withIndex("by_owner_entity_updated", (q) => q.eq("ownerKey", ownerKey))
        .take(2000);
      reportsCreated += reports.length;
    }

    // Activity ledger aggregations: pull lifetime + window-bounded counts in
    // one pass per ownerKey, bounded at 5000 rows to keep latency predictable.
    let chatMessagesLifetime = 0;
    let sourcesAttachedLifetime = 0;
    let claimsChangedLifetime = 0;
    let exportsCompletedLifetime = 0;
    let chatMessagesRecent = 0;
    let sourcesAttachedRecent = 0;
    let claimsChangedRecent = 0;
    let relationshipsMapped = 0;
    let followupsCreated = 0;
    let followupsDueToday = 0;
    // Tier D extensions: tool_call rows count as paid_calls; chat_message →
    // next-agent-turn pairing produces avg_sourced_answer_ms;
    // productReports.sources produces sources_fresh_pct (<14d window).
    let toolCallsLifetime = 0;
    let toolCallsRecent = 0;
    const userTurnTimestamps: number[] = [];
    const agentResponseTimestamps: number[] = [];
    for (const ownerKey of ownerKeys) {
      const rows = await ctx.db
        .query("productActivityLedger")
        .withIndex("by_owner_created", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(5000);
      for (const row of rows) {
        const recent = row.createdAt >= lookbackCutoff;
        if (row.activityType === "chat_message") {
          chatMessagesLifetime += 1;
          if (recent) chatMessagesRecent += 1;
        } else if (row.activityType === "source_attached") {
          sourcesAttachedLifetime += 1;
          if (recent) sourcesAttachedRecent += 1;
        } else if (row.activityType === "claim_changed") {
          claimsChangedLifetime += 1;
          if (recent) claimsChangedRecent += 1;
        } else if (row.activityType === "export_completed") {
          exportsCompletedLifetime += 1;
        } else if (row.activityType === "tool_call") {
          toolCallsLifetime += 1;
          if (recent) toolCallsRecent += 1;
        }
        // Track user/agent turn timestamps for avg-sourced-answer derivation.
        if (row.activityType === "chat_message") {
          if (row.actorType === "user") userTurnTimestamps.push(row.createdAt);
          else if (row.actorType === "agent") agentResponseTimestamps.push(row.createdAt);
        }
      }

      // C1: Relationships mapped — productEntityRelations rows per owner.
      const relations = await ctx.db
        .query("productEntityRelations")
        .withIndex("by_owner_from", (q) => q.eq("ownerKey", ownerKey))
        .take(5000);
      relationshipsMapped += relations.length;

      // C1: Follow-ups created — productEventWorkspaceFollowUps per owner.
      // No `by_owner` standalone index, so use filter (cap 2000).
      const followups = await ctx.db
        .query("productEventWorkspaceFollowUps")
        .filter((q) => q.eq(q.field("ownerKey"), ownerKey))
        .take(2000);
      followupsCreated += followups.length;
      followupsDueToday += followups.filter((f) => f.due === "today" && f.status === "open").length;
    }

    // Shared public/system corpus counts: daily brief, LinkedIn archive,
    // entity cache, graph, and search-cache rows should count toward Home
    // memory even when the current visitor has no private workspace rows.
    //
    // Some cache rows contain full source/result payloads. Keep these reads
    // bounded so the pulse query never takes down Home by crossing Convex's
    // per-function byte limit.
    const countTableCapped = async (tableName: any, limit: number): Promise<number> => {
      const rows = await (ctx.db.query(tableName) as any).take(limit);
      return rows.length;
    };
    const safeCountTableCapped = async (tableName: any, limit: number): Promise<number> => {
      try {
        return await countTableCapped(tableName, limit);
      } catch {
        return 0;
      }
    };
    const safeRows = async <T>(rowsPromise: Promise<T[]>): Promise<T[]> => {
      try {
        return await rowsPromise;
      } catch {
        return [];
      }
    };

    const [
      entityContextCount,
      entityProfileCount,
      entityMentionCount,
      archiveRows,
      archiveEntityLinkCount,
      dailyBriefSnapshots,
      dailyBriefMemories,
      dailyBriefTaskResultCount,
      searchCacheCount,
      searchFusionCacheCount,
      graphClaimCount,
      factCount,
      claimVerificationCount,
    ] = await Promise.all([
      safeCountTableCapped("entityContexts", 2000),
      safeCountTableCapped("entityProfiles", 2000),
      safeCountTableCapped("entityMentions", 3000),
      safeRows(
        ctx.db
          .query("linkedinPostArchive")
          .withIndex("by_postedAt")
          .order("desc")
          .take(1000),
      ),
      safeCountTableCapped("linkedinArchiveEntityLinks", 3000),
      safeRows(
        ctx.db
          .query("dailyBriefSnapshots")
          .withIndex("by_generated_at")
          .order("desc")
          .take(14),
      ),
      safeRows(
        ctx.db
          .query("dailyBriefMemories")
          .withIndex("by_generated_at")
          .order("desc")
          .take(14),
      ),
      safeCountTableCapped("dailyBriefTaskResults", 1000),
      safeCountTableCapped("searchCache", 100),
      safeCountTableCapped("searchFusionCache", 25),
      safeCountTableCapped("graphClaims", 2000),
      safeCountTableCapped("facts", 2000),
      safeCountTableCapped("claimVerifications", 2000),
    ]);

    const publicArchiveRows = archiveRows.filter((row) => row.target !== "personal");
    const recentPublicArchiveRows = publicArchiveRows.filter((row) => row.postedAt >= lookbackCutoff);
    const dailyBriefSourceItemsRecent = dailyBriefSnapshots
      .filter((snapshot) => snapshot.generatedAt >= lookbackCutoff)
      .reduce((acc, snapshot) => acc + Number(snapshot.sourceSummary?.totalItems ?? 0), 0);
    const dailyBriefFeatureCountRecent = dailyBriefMemories
      .filter((memory) => memory.generatedAt >= lookbackCutoff)
      .reduce((acc, memory) => acc + (Array.isArray(memory.features) ? memory.features.length : 0), 0);
    const publicEntitiesTracked = entityContextCount + entityProfileCount;
    const publicReportsCreated = publicArchiveRows.length + dailyBriefTaskResultCount + dailyBriefMemories.length;
    const publicRelationshipsMapped = archiveEntityLinkCount + entityMentionCount;
    const publicSourcesRefreshedRecent = dailyBriefSourceItemsRecent + recentPublicArchiveRows.length;
    const publicClaimsTracked = graphClaimCount + factCount + claimVerificationCount;
    const publicSearchesAvoided = searchCacheCount + searchFusionCacheCount + dailyBriefFeatureCountRecent;

    entitiesTracked += publicEntitiesTracked;
    reportsCreated += publicReportsCreated;
    relationshipsMapped += publicRelationshipsMapped;
    sourcesAttachedRecent += publicSourcesRefreshedRecent;
    sourcesAttachedLifetime += dailyBriefSourceItemsRecent + publicArchiveRows.length;
    claimsChangedRecent += publicClaimsTracked;
    claimsChangedLifetime += publicClaimsTracked;
    chatMessagesRecent += publicSearchesAvoided;
    chatMessagesLifetime += publicSearchesAvoided;

    // Pair user turn to the next agent turn for a bounded sourced-answer latency proxy.
    const userAsc = [...userTurnTimestamps].sort((a, b) => a - b);
    const agentAsc = [...agentResponseTimestamps].sort((a, b) => a - b);
    const latencies: number[] = [];
    let agentIdx = 0;
    for (const userAt of userAsc) {
      while (agentIdx < agentAsc.length && agentAsc[agentIdx] < userAt) agentIdx += 1;
      if (agentIdx >= agentAsc.length) break;
      const diff = agentAsc[agentIdx] - userAt;
      // Only count diffs <120s; longer means the user came back later, not a sourced-answer wait.
      if (diff > 0 && diff < 120_000) latencies.push(diff);
      agentIdx += 1;
    }
    const avgSourcedAnswerSec =
      latencies.length > 0
        ? Number(((latencies.reduce((a, b) => a + b, 0) / latencies.length) / 1000).toFixed(2))
        : null;

    // Tier D — sources fresh %: walk productReports.sections.sources arrays
    // and count those <14 days old.  Bounded at 200 reports per ownerKey.
    const freshCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let sourcesTotalCount = 0;
    let sourcesFreshCount = 0;
    for (const ownerKey of ownerKeys) {
      const reports = await ctx.db
        .query("productReports")
        .withIndex("by_owner_entity_updated", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(200);
      for (const report of reports) {
        const sources = (report.sources as Array<any> | undefined) ?? [];
        for (const source of sources) {
          sourcesTotalCount += 1;
          const refreshedAt =
            typeof source?.lastFetchedAt === "number"
              ? source.lastFetchedAt
              : typeof source?.attachedAt === "number"
                ? source.attachedAt
                : (report.updatedAt as number);
          if (refreshedAt >= freshCutoff) sourcesFreshCount += 1;
        }
      }
    }
    const sourcesFreshPct =
      sourcesTotalCount > 0
        ? Math.round((sourcesFreshCount / sourcesTotalCount) * 100)
        : null;

    // Tier D — memory-hit % proxy: ratio of agent turns that did NOT
    // make a tool_call (purely from-memory answers).  Approximate but
    // honest: caller knows it's derived from existing ledger rows, not
    // a per-call paid_call flag.
    const memoryHitPct =
      chatMessagesLifetime > 0
        ? Math.max(
            0,
            Math.min(99, Math.round(((chatMessagesLifetime - toolCallsLifetime) / chatMessagesLifetime) * 100)),
          )
        : null;

    const hasAnyPulseData =
      entitiesTracked > 0 ||
      reportsCreated > 0 ||
      relationshipsMapped > 0 ||
      chatMessagesLifetime > 0 ||
      sourcesAttachedLifetime > 0 ||
      claimsChangedLifetime > 0 ||
      exportsCompletedLifetime > 0 ||
      followupsCreated > 0;

    return {
      live: hasAnyPulseData,
      entitiesTracked,
      reportsCreated,
      relationshipsMapped,
      chatMessagesLifetime,
      sourcesAttachedLifetime,
      claimsChangedLifetime,
      exportsCompletedLifetime,
      chatMessagesRecent,
      sourcesAttachedRecent,
      claimsChangedRecent,
      toolCallsLifetime,
      toolCallsRecent,
      memoryHitPct,
      avgSourcedAnswerSec,
      sourcesFreshPct,
      sourcesTotalCount,
      followupsCreated,
      followupsDueToday,
      publicCorpus: {
        entitiesTracked: publicEntitiesTracked,
        reportsCreated: publicReportsCreated,
        relationshipsMapped: publicRelationshipsMapped,
        sourcesRefreshedRecent: publicSourcesRefreshedRecent,
        claimsTracked: publicClaimsTracked,
        searchesAvoided: publicSearchesAvoided,
        archiveRows: publicArchiveRows.length,
        dailyBriefSourceItemsRecent,
      },
      lookbackHours,
      lastUpdated: Date.now(),
    };
  },
});

/**
 * Tier C2 — getActiveEventSnapshot
 *
 * Powers the Home "Active workspace · Ship Demo Day" section.  Returns the
 * most-recently-updated event workspace for the visitor's owner keys, plus
 * a count of associated entities/evidence/captures and the top 4 captures.
 *
 * Anonymous visitors get a `live=false` shape; the UI falls back to seed
 * arrays on the home page.
 */
export const getActiveEventSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) {
      return {
        live: false,
        workspaceId: null,
        title: null,
        entitiesDiscovered: 0,
        evidenceCount: 0,
        captureCount: 0,
        recentCaptures: [],
        followupCount: 0,
        lastUpdated: null,
      };
    }

    // Find the most-recently-touched event workspace across all visitor owner keys.
    let activeWorkspace: any | null = null;
    for (const ownerKey of ownerKeys) {
      const workspaces = await ctx.db
        .query("productEventWorkspaces")
        .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(1);
      if (workspaces.length > 0) {
        const candidate = workspaces[0];
        if (!activeWorkspace || (candidate?.updatedAt ?? 0) > (activeWorkspace?.updatedAt ?? 0)) {
          activeWorkspace = candidate;
        }
      }
    }

    if (!activeWorkspace) {
      return {
        live: true,
        workspaceId: null,
        title: null,
        entitiesDiscovered: 0,
        evidenceCount: 0,
        captureCount: 0,
        recentCaptures: [],
        followupCount: 0,
        lastUpdated: null,
      };
    }

    const ownerKey = activeWorkspace.ownerKey as string;
    const workspaceId = activeWorkspace.workspaceId as string;

    const [entities, evidence, captures, followUps] = await Promise.all([
      ctx.db
        .query("productEventWorkspaceEntities")
        .withIndex("by_owner_workspace", (q: any) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .take(2000),
      ctx.db
        .query("productEventWorkspaceEvidence")
        .withIndex("by_owner_workspace", (q: any) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .take(2000),
      ctx.db
        .query("productEventCaptures")
        .withIndex("by_owner_workspace", (q: any) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("productEventWorkspaceFollowUps")
        .withIndex("by_owner_workspace", (q: any) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .take(500),
    ]);

    // Top 4 captures, mapped to the kit's RECENT_CAPTURES shape.
    const recentCaptures = captures.slice(0, 4).map((c: any) => ({
      time: c?._creationTime ?? null,
      kind: c?.kind ?? "note",
      who: typeof c?.transcript === "string" && c.transcript.length > 0
        ? c.transcript.split(/\.|·/)[0].slice(0, 60)
        : typeof c?.rawText === "string"
          ? c.rawText.slice(0, 60)
          : "Capture",
      note: typeof c?.transcript === "string" && c.transcript.length > 0
        ? c.transcript.slice(0, 120)
        : typeof c?.rawText === "string"
          ? c.rawText.slice(0, 120)
          : "",
    }));

    return {
      live: true,
      workspaceId,
      title: activeWorkspace.title as string,
      entitiesDiscovered: entities.length,
      evidenceCount: evidence.length,
      captureCount: captures.length,
      recentCaptures,
      followupCount: followUps.length,
      lastUpdated: activeWorkspace.updatedAt ?? null,
    };
  },
});

/**
 * Tier D — recordCurrentSession (mutation)
 *
 * Called from the cockpit shell on mount with a stable browser sessionKey
 * + a derived deviceLabel ("MacBook · Safari · SF" or similar).  Upserts
 * by (ownerKey, sessionKey) so the same tab won't proliferate rows; bumps
 * lastSeenAt + isCurrent on every call.  Marks all OTHER sessions for
 * the same ownerKey as `isCurrent: false` so only one row at a time
 * shows the "THIS" badge in the avatar panel.
 */
export const recordCurrentSession = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionKey: v.string(),
    deviceLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;
    const ownerKey = ownerKeys[0];
    const now = Date.now();
    const existing = await ctx.db
      .query("productUserSessions")
      .withIndex("by_owner_session", (q) =>
        q.eq("ownerKey", ownerKey).eq("sessionKey", args.sessionKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        deviceLabel: args.deviceLabel,
        lastSeenAt: now,
        isCurrent: true,
      });
    } else {
      await ctx.db.insert("productUserSessions", {
        ownerKey,
        sessionKey: args.sessionKey,
        deviceLabel: args.deviceLabel,
        firstSeenAt: now,
        lastSeenAt: now,
        isCurrent: true,
      });
    }
    // Mark all other sessions for this owner as not-current
    const others = await ctx.db
      .query("productUserSessions")
      .withIndex("by_owner_lastseen", (q) => q.eq("ownerKey", ownerKey))
      .take(50);
    for (const row of others) {
      if (row.sessionKey !== args.sessionKey && row.isCurrent) {
        await ctx.db.patch(row._id, { isCurrent: false });
      }
    }
    return { ok: true };
  },
});

/**
 * Tier D — listRecentSessions (query)
 *
 * Returns top 3 sessions for the visitor's ownerKeys, sorted by lastSeenAt
 * desc.  Avatar status panel renders these as "MacBook · Safari · SF [THIS]"
 * rows.  Anonymous returns [] → falls back to seed.
 */
export const listRecentSessions = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];
    const all: any[] = [];
    for (const ownerKey of ownerKeys) {
      const rows = await ctx.db
        .query("productUserSessions")
        .withIndex("by_owner_lastseen", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(10);
      all.push(...rows);
    }
    return all
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 3)
      .map((r) => ({
        sessionKey: r.sessionKey as string,
        deviceLabel: r.deviceLabel as string,
        lastSeenAt: r.lastSeenAt as number,
        isCurrent: r.isCurrent as boolean,
      }));
  },
});

/**
 * Tier D — getMostRecentChatThread (query)
 *
 * Reads productActivityLedger rows where activityType="chat_message" and
 * groups them by sessionId, returning the most-recent session as a
 * ChatStream-shaped thread.  Anonymous or no-history → returns null and
 * the UI falls back to the seed Orbital Labs thread.
 *
 * The shape mirrors what ExactChatSurface's ORBITAL_THREAD_TURNS expects.
 * Bodies + traces stay seed-shaped because the activity ledger doesn't
 * preserve the rich agent-turn structure (run-bar, trace, sources,
 * follow-ups) — that requires the Convex Agent component install.
 */
export const getMostRecentChatThread = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;

    let latestSession: { sessionId: string; rows: any[] } | null = null;
    for (const ownerKey of ownerKeys) {
      const rows = await ctx.db
        .query("productActivityLedger")
        .withIndex("by_owner_activity_created", (q: any) =>
          q.eq("ownerKey", ownerKey).eq("activityType", "chat_message"),
        )
        .order("desc")
        .take(200);
      // Group by sessionId; keep the most-recent group only.
      const bySession = new Map<string, any[]>();
      for (const row of rows) {
        const sid = (row.sessionId as string | undefined) ?? "(no-session)";
        if (!bySession.has(sid)) bySession.set(sid, []);
        bySession.get(sid)!.push(row);
      }
      // The first sessionId we encounter in the desc-ordered iteration is
      // the most recent. Pull its rows + walk them in turnId/createdAt order.
      for (const [sid, groupRows] of bySession.entries()) {
        if (!latestSession || groupRows[0].createdAt > (latestSession.rows[0]?.createdAt ?? 0)) {
          latestSession = { sessionId: sid, rows: groupRows };
        }
      }
    }

    if (!latestSession || latestSession.rows.length === 0) return null;

    // Reverse to oldest-first for sequential turn rendering.
    const ordered = [...latestSession.rows].reverse();

    const turns = ordered.slice(0, 12).map((row, i) => ({
      id: String(row._id),
      role: (row.actorType === "agent" ? "agent" : "user") as "user" | "agent",
      time: new Date(row.createdAt as number).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
      text: typeof row.payloadPreview?.text === "string"
        ? row.payloadPreview.text.slice(0, 600)
        : `Turn ${i + 1}`,
    }));

    const userTurns = turns.filter((t) => t.role === "user").length;
    const agentTurns = turns.filter((t) => t.role === "agent").length;

    return {
      live: true,
      sessionId: latestSession.sessionId,
      title: "Live thread",
      turnsCount: turns.length,
      userTurnsCount: userTurns,
      agentTurnsCount: agentTurns,
      sourcesCount: 0,
      entitiesCount: 0,
      paidCallsCount: 0,
      turns,
      lastUpdated: ordered[ordered.length - 1].createdAt as number,
    };
  },
});
