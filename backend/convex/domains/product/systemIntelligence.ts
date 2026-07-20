import { query } from "../../_generated/server";
import { v } from "convex/values";
import { buildSystemEntityNodes, getSystemEntityNodeBySlug } from "../../../shared/systemIntelligence";

const SYSTEM_POST_LIMIT = 240;
const GENERIC_SYSTEM_NAME_PATTERNS = [
  /^product$/i,
  /^sources?$/i,
  /^today'?s signals:?$/i,
  /^founder lens/i,
  /^what(?:'s|\s)/i,
  /^how\s/i,
  /^why\s/i,
  /^this\s/i,
  /^these\s/i,
  /^if\s/i,
  /^actions?:?$/i,
  /^date:?/i,
  /^industry:?/i,
  /^how to challenge/i,
  /watch out/i,
  /source code/i,
];
const GENERIC_PERSON_TOKENS = new Set([
  "open",
  "multi",
  "agent",
  "world",
  "north",
  "korea",
  "signals",
  "actions",
  "sources",
  "source",
  "layoffs",
]);
const GENERIC_COMPANY_TOKENS = new Set([
  "layoffs",
  "sourced",
  "signals",
  "actions",
  "source",
  "sources",
  "question",
  "questions",
]);
const SUSPICIOUS_TRAILING_NAME_TOKENS = new Set([
  "approves",
  "bans",
  "confirms",
  "demands",
  "fails",
  "falls",
  "fires",
  "gets",
  "has",
  "have",
  "introduces",
  "is",
  "just",
  "launches",
  "lets",
  "plummets",
  "publishes",
  "quits",
  "raises",
  "raised",
  "returns",
  "says",
  "seeks",
  "targets",
  "targeted",
  "tries",
  "unveils",
  "will",
]);
const COMPANY_SUFFIX_TOKENS = new Set([
  "ai",
  "capital",
  "corp",
  "corporation",
  "fund",
  "group",
  "holdings",
  "inc",
  "labs",
  "llc",
  "ltd",
  "lp",
  "partners",
  "pte",
  "ventures",
]);
const ALLOWED_LOWERCASE_NAME_TOKENS = new Set([
  "and",
  "for",
  "of",
  "the",
]);

function extractDomain(href?: string) {
  if (!href) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

function matchesFilter(entityType: string, filter?: string) {
  const active = filter ?? "All";
  if (active === "All" || active === "Recent") return true;
  if (active === "Companies") return entityType === "company";
  if (active === "People") return entityType === "person";
  if (active === "Jobs") return entityType === "job";
  if (active === "Markets") return entityType === "market";
  if (active === "Notes") return entityType === "note";
  return true;
}

function isPublishableName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 64) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  if (/[#|]/.test(trimmed)) return false;
  if (/\[\d+\/\d+\]/.test(trimmed)) return false;
  if (/industry:|founder background not captured|product details are limited/i.test(trimmed)) {
    return false;
  }
  if (GENERIC_SYSTEM_NAME_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return true;
}

function tokenizeName(name: string) {
  return name
    .toLowerCase()
    .split(/[\s-]+/g)
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

function splitRawNameTokens(name: string) {
  return name
    .trim()
    .split(/\s+/g)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
}

function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEntityReferenceNeedles(node: ReturnType<typeof buildSystemEntityNodes>[number]) {
  const normalizedName = normalizeComparableText(node.name);
  const tokens = tokenizeName(node.name);
  const candidates = new Set<string>();

  if (normalizedName) {
    candidates.add(normalizedName);
  }

  const withoutSuffix = tokens.filter((token) => !COMPANY_SUFFIX_TOKENS.has(token));
  if (withoutSuffix.length > 0) {
    candidates.add(withoutSuffix.join(" "));
  }

  if (node.entityType === "person" && tokens.length > 1) {
    candidates.add(tokens[tokens.length - 1] ?? "");
  } else if (withoutSuffix.length === 1) {
    candidates.add(withoutSuffix[0] ?? "");
  } else if (tokens.length === 1) {
    candidates.add(tokens[0] ?? "");
  }

  return [...candidates]
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length >= 4)
    .sort((left, right) => right.length - left.length);
}

function summaryCentersEntity(node: ReturnType<typeof buildSystemEntityNodes>[number]) {
  const haystack = normalizeComparableText(node.summary);
  if (!haystack) return false;
  return buildEntityReferenceNeedles(node).some((needle) => haystack.includes(needle));
}

function hasDescriptiveLowercaseNameToken(name: string) {
  return splitRawNameTokens(name).some((token, index) => {
    if (!token || index === 0) return false;
    if (!/^[a-z]/.test(token)) return false;
    return !ALLOWED_LOWERCASE_NAME_TOKENS.has(token.toLowerCase());
  });
}

function isPublishableSystemNode(node: ReturnType<typeof buildSystemEntityNodes>[number]) {
  if (!["company", "person", "market"].includes(node.entityType)) return false;
  if (!isPublishableName(node.name)) return false;

  const primaryPostType = node.timeline[0]?.postType ?? "";
  const wordCount = node.name.split(/\s+/g).filter(Boolean).length;
  const normalized = node.name.trim();
  const normalizedTokens = tokenizeName(normalized);
  const trailingToken = normalizedTokens[normalizedTokens.length - 1];

  if (trailingToken && SUSPICIOUS_TRAILING_NAME_TOKENS.has(trailingToken)) {
    return false;
  }

  if (node.entityType === "person") {
    const hasPersonShape =
      /linkedin\.com\/(?:in|pub)\//i.test(node.sourceUrls.join(" ")) ||
      (/^[A-Z][A-Za-z'â€™-]+(?:\s+[A-Z][A-Za-z'â€™-]+){1,3}$/.test(normalized) &&
        !normalizedTokens.some((token) => GENERIC_PERSON_TOKENS.has(token)));
    return hasPersonShape && summaryCentersEntity(node);
  }

  if (node.entityType === "market") {
    if (/^[A-Z]{2,5}$/.test(normalized)) return false;
    return wordCount <= 4;
  }

  if (primaryPostType === "funding_tracker" || primaryPostType === "funding_brief") {
    if (normalized.includes("'")) return false;
    if (wordCount > 4) return false;
    if (hasDescriptiveLowercaseNameToken(normalized)) return false;
    if (normalizedTokens.some((token) => GENERIC_COMPANY_TOKENS.has(token))) return false;
    return summaryCentersEntity(node);
  }

  if (/^[A-Z]{2,5}$/.test(normalized)) return false;
  if (normalized.includes("-") || normalized.includes("'")) return false;
  if (wordCount > 4) return false;
  if (hasDescriptiveLowercaseNameToken(normalized)) return false;
  if (normalizedTokens.some((token) => GENERIC_COMPANY_TOKENS.has(token))) return false;
  if (wordCount > 2 && !/(inc|corp|capital|labs|ventures|holdings|group|partners|ai)\b/i.test(normalized)) {
    return false;
  }
  return summaryCentersEntity(node);
}

function isPublishableRelatedEntity(related: {
  name: string;
  entityType: string;
}) {
  if (!["company", "person", "market"].includes(related.entityType)) return false;
  if (!isPublishableName(related.name)) return false;
  const tokens = tokenizeName(related.name);
  const trailingToken = tokens[tokens.length - 1];
  if (trailingToken && SUSPICIOUS_TRAILING_NAME_TOKENS.has(trailingToken)) {
    return false;
  }
  if (
    related.entityType === "company" &&
    tokens.some((token) => GENERIC_COMPANY_TOKENS.has(token))
  ) {
    return false;
  }
  if (
    related.entityType === "person" &&
    tokens.some((token) => GENERIC_PERSON_TOKENS.has(token))
  ) {
    return false;
  }
  return true;
}

function buildSystemSections(args: {
  name: string;
  summary: string;
  relatedCount: number;
  sourceCount: number;
  systemGroup: string;
  latestTitle: string;
}) {
  return [
    {
      id: "what-it-is",
      title: "What it is",
      body: args.summary,
      status: "complete" as const,
    },
    {
      id: "why-it-matters",
      title: "Why it matters",
      body: `This system brief was projected from archived ${args.systemGroup.toLowerCase()} intelligence and stitched into a reusable entity page.`,
      status: "complete" as const,
    },
    {
      id: "source-trace",
      title: "Source trace",
      body: `Latest signal: ${args.latestTitle}. ${args.sourceCount} source${args.sourceCount === 1 ? "" : "s"} linked to this entity so far.`,
      status: "complete" as const,
    },
    {
      id: "what-to-do-next",
      title: "What to do next",
      body:
        args.relatedCount > 0
          ? `Walk the linked entities next. There are ${args.relatedCount} connected entities already visible from archived intelligence.`
          : `Open this in Chat and ask what changed, what is missing, or which sources deserve a deeper read.`,
      status: "complete" as const,
    },
  ];
}

async function listArchivePosts(ctx: any) {
  const rows = await ctx.db
    .query("linkedinPostArchive")
    .withIndex("by_postedAt")
    .order("desc")
    .take(SYSTEM_POST_LIMIT);

  return rows.filter((row: any) => row.target !== "personal");
}

export const listSystemReportCards = query({
  args: {
    search: v.optional(v.string()),
    filter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const posts = await listArchivePosts(ctx);
    const search = args.search?.trim().toLowerCase() ?? "";
    const nodes = buildSystemEntityNodes(posts).filter(isPublishableSystemNode);

    return nodes
      .filter((node) => {
        if (!matchesFilter(node.entityType, args.filter)) return false;
        if (!search) return true;
        return (
          node.name.toLowerCase().includes(search) ||
          node.summary.toLowerCase().includes(search) ||
          node.systemGroup.toLowerCase().includes(search)
        );
      })
      .map((node) => ({
        slug: node.slug,
        name: node.name,
        summary: node.summary,
        entityType: node.entityType,
        latestReportType: "system_intelligence",
        latestRevision: node.latestRevision,
        reportCount: node.reportCount,
        latestReportUpdatedAt: node.updatedAt,
        thumbnailUrl: undefined,
        thumbnailUrls: [] as string[],
        sourceUrls: node.sourceUrls.slice(0, 4),
        sourceLabels: node.sourceLabels.slice(0, 4),
        origin: "system" as const,
        originLabel: node.originLabel,
        systemGroup: node.systemGroup,
        relatedEntities: node.relatedEntities.filter(isPublishableRelatedEntity).slice(0, 4).map((related) => ({
          slug: related.slug,
          name: related.name,
          entityType: related.entityType,
          summary: related.reason,
          reason: related.reason,
        })),
      }));
  },
});

export const getSystemEntityWorkspace = query({
  args: {
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const posts = await listArchivePosts(ctx);
    const node = getSystemEntityNodeBySlug(posts, args.entitySlug);
    if (!node || !isPublishableSystemNode(node)) return null;
    const publishableRelatedEntities = node.relatedEntities.filter(isPublishableRelatedEntity).slice(0, 6);

    const sourceUrls = node.sourceUrls.slice(0, 6);
    const sourceLabels = node.sourceLabels.slice(0, 6);
    const latestTimeline = node.timeline[0];
    const sections = buildSystemSections({
      name: node.name,
      summary: node.summary,
      relatedCount: publishableRelatedEntities.length,
      sourceCount: sourceUrls.length,
      systemGroup: node.systemGroup,
      latestTitle: latestTimeline?.title ?? node.name,
    });

    const buildSources = (timelineItem: (typeof node.timeline)[number]) =>
      sourceUrls.map((href, index) => ({
        id: `${timelineItem.key}-source-${index}`,
        label: sourceLabels[index] ?? extractDomain(href) ?? `Source ${index + 1}`,
        href,
        type: "link",
        domain: extractDomain(href),
      }));

    const timeline = node.timeline.map((item, index) => ({
      _id: `system-${node.slug}-${index}`,
      title: item.title,
      type: "system_intelligence",
      summary: item.summary,
      query: `What matters most about ${node.name} right now?`,
      lens: item.postType === "funding_tracker" || item.postType === "funding_brief" ? "investor" : "founder",
      sections:
        index === 0
          ? sections
          : buildSystemSections({
              name: node.name,
              summary: item.summary,
              relatedCount: publishableRelatedEntities.length,
              sourceCount: item.sourceUrls.length,
              systemGroup: node.systemGroup,
              latestTitle: item.title,
            }),
      sources: buildSources(item),
      diffs: [] as Array<{
        id: string;
        title: string;
        status: "new" | "changed";
        previousBody: string;
        currentBody: string;
      }>,
      isLatest: index === 0,
      createdAt: item.postedAt,
      updatedAt: item.postedAt,
      revision: Math.max(1, node.timeline.length - index),
      routing: {
        routingMode: "advisor" as const,
        routingReason: "Projected from archived system intelligence.",
        routingSource: "automatic" as const,
        plannerModel: "system-archive",
        executionModel: "system-archive",
        reasoningEffort: "medium" as const,
      },
      operatorContext: {
        label: "System intelligence",
        hint: node.systemGroup,
      },
    }));

    return {
      entity: {
        _id: `system-${node.slug}`,
        slug: node.slug,
        name: node.name,
        entityType: node.entityType,
        summary: node.summary,
        savedBecause: "system intelligence",
        reportCount: node.reportCount,
        createdAt: node.timeline[node.timeline.length - 1]?.postedAt ?? node.updatedAt,
        updatedAt: node.updatedAt,
      },
      note: null,
      noteDocument: null,
      latest: timeline[0] ?? null,
      timeline,
      evidence: sourceUrls.map((href, index) => ({
        _id: `system-evidence-${node.slug}-${index}`,
        label: sourceLabels[index] ?? extractDomain(href) ?? `Source ${index + 1}`,
        type: "link",
        sourceUrl: href,
        entityId: undefined,
      })),
      contextItems: [],
      relatedEntities: publishableRelatedEntities.map((related) => ({
        slug: related.slug,
        name: related.name,
        entityType: related.entityType,
        summary: related.reason,
        reason: related.reason,
      })),
    };
  },
});
