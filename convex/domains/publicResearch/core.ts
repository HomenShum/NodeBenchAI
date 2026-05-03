import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { hashSync } from "../../../shared/artifacts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FRESHNESS_TTL_MS = 30 * DAY_MS;

const entityTypeValidator = v.union(
  v.literal("company"),
  v.literal("person"),
  v.literal("role"),
  v.literal("product"),
  v.literal("investor"),
  v.literal("school"),
  v.literal("source"),
);

const researchStatusValidator = v.union(
  v.literal("queued"),
  v.literal("searching"),
  v.literal("extracting"),
  v.literal("verifying"),
  v.literal("ready"),
  v.literal("needs_review"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const sourceInputValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  snippet: v.optional(v.string()),
});

const entitySignalValidator = v.object({
  entityId: v.optional(v.id("publicResearchEntities")),
  entityType: v.optional(entityTypeValidator),
  name: v.optional(v.string()),
  domain: v.optional(v.string()),
  url: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  linkedinUrl: v.optional(v.string()),
  githubUrl: v.optional(v.string()),
});

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeName(value: string): string {
  return normalizeText(value).toLowerCase();
}

function extractDomain(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .trim() || null;
  }
}

function canonicalKey(args: {
  entityType?: string;
  name?: string;
  domain?: string;
  url?: string;
}): string {
  const type = args.entityType ?? "company";
  const domain = extractDomain(args.domain) ?? extractDomain(args.url);
  const base = domain && (type === "company" || type === "source")
    ? domain
    : normalizeName(args.name ?? domain ?? "unknown").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${type}:${base || "unknown"}`;
}

function canonicalNameFromSignal(args: { name?: string; domain?: string; url?: string }): string {
  const name = args.name ? normalizeText(args.name) : "";
  if (name) return name;
  const domain = extractDomain(args.domain) ?? extractDomain(args.url);
  if (!domain) return "Unknown entity";
  return domain
    .split(".")[0]
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("127.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function privateBoundaryStatus(claim: string, evidence: string): "clean" | "private_signal_stripped" | "blocked" {
  const text = `${claim}\n${evidence}`.toLowerCase();
  if (
    text.includes("gmail") ||
    text.includes("email thread") ||
    text.includes("recruiter email") ||
    text.includes("my resume") ||
    text.includes("pinned resume") ||
    text.includes("private artifact") ||
    text.includes("inbox")
  ) {
    return "blocked";
  }
  return "clean";
}

function isPublicLatestSafeEntity(entityKey: string, entityName: string): boolean {
  const normalizedName = normalizeName(entityName).replace(/\u2019/g, "'");
  const normalizedKey = entityKey.toLowerCase();
  const wordCount = normalizedName.split(/\s+/).filter(Boolean).length;
  if (!normalizedName || normalizedName === "unknown entity") return false;
  if (/^(re|fw|fwd):\s/.test(normalizedName)) return false;
  if (/^(ver|voir|view|apply)\s/.test(normalizedName)) return false;
  if (normalizedKey.startsWith("role:re-") || normalizedKey.startsWith("role:ver-")) return false;
  if (
    /\b(gmail|inbox|email thread|recruiter email|pinned resume|private artifact|no-reply|noreply|homen)\b/.test(normalizedName)
  ) {
    return false;
  }
  if (/\b(great opportunity|the posting here|a fantastic|happy monday|apply to|with no fee|from march|master of financial)\b/.test(normalizedName)) return false;
  if (/\bfrom [a-z0-9 ._-]{2,80}'s\b/.test(normalizedName)) return false;
  if (normalizedName.length > 72 && /\b(role|opportunity|engineer|recruiter|hiring|founder|cto|apply)\b/.test(normalizedName)) {
    return false;
  }
  if (wordCount > 8 && /\b(at|from|for|with)\b/.test(normalizedName)) {
    return false;
  }
  if (normalizedKey.startsWith("role:") && /\$|salary|\bbase\b|\bopportunity\b/.test(normalizedName)) {
    return false;
  }
  if (normalizedKey.startsWith("company:") && normalizedName.includes("+")) return false;
  return true;
}

function isPublicLatestSafeRow(args: {
  entityType: string;
  entityName: string;
  claims: Array<{ claim: string; sourceTitle?: string; sourceUrl?: string }>;
}): boolean {
  const normalizedName = normalizeName(args.entityName);
  const combinedClaims = args.claims.map((claim) => normalizeName(claim.claim)).join("\n");
  if (/\b(could not be found|not identify a specific company|search did not return|does not identify a specific company)\b/.test(combinedClaims)) {
    return false;
  }
  if (args.entityType === "company") {
    const words = normalizedName.split(/\s+/).filter(Boolean);
    const hasCompanySignal = /\b(ai|labs?|group|inc|llc|corp|corporation|company|ventures?|capital|systems?|technolog(?:y|ies)|software|health|bank|university|school)\b/.test(normalizedName);
    if (words.length === 2 && !hasCompanySignal) return false;
  }
  return true;
}

function evaluateClaim(args: {
  claim: string;
  evidenceSnippet: string;
  sourceUrl: string;
  confidence?: number;
}): {
  sourceIsPublic: boolean;
  verifierStatus: "verified" | "needs_review" | "rejected";
  privateBoundaryStatus: "clean" | "private_signal_stripped" | "blocked";
  confidence: number;
} {
  const sourceIsPublic = isPublicHttpUrl(args.sourceUrl);
  const boundary = privateBoundaryStatus(args.claim, args.evidenceSnippet);
  const confidence = Math.max(0, Math.min(1, args.confidence ?? (sourceIsPublic ? 0.72 : 0.2)));
  if (!sourceIsPublic || boundary === "blocked") {
    return {
      sourceIsPublic,
      privateBoundaryStatus: boundary,
      verifierStatus: "rejected",
      confidence: Math.min(confidence, 0.2),
    };
  }
  if (!args.claim.trim() || !args.evidenceSnippet.trim()) {
    return {
      sourceIsPublic,
      privateBoundaryStatus: boundary,
      verifierStatus: "needs_review",
      confidence: Math.min(confidence, 0.45),
    };
  }
  return {
    sourceIsPublic,
    privateBoundaryStatus: boundary,
    verifierStatus: confidence >= 0.6 ? "verified" : "needs_review",
    confidence,
  };
}

async function upsertEntity(ctx: any, signal: {
  entityId?: string;
  entityType?: "company" | "person" | "role" | "product" | "investor" | "school" | "source";
  name?: string;
  domain?: string;
  url?: string;
  aliases?: string[];
  linkedinUrl?: string;
  githubUrl?: string;
}) {
  if (signal.entityId) {
    const existing = await ctx.db.get(signal.entityId);
    if (existing) return existing;
  }

  const entityType = signal.entityType ?? "company";
  const entityKey = canonicalKey({ entityType, name: signal.name, domain: signal.domain, url: signal.url });
  const canonicalName = canonicalNameFromSignal(signal);
  const normalizedName = normalizeName(canonicalName);
  const domain = extractDomain(signal.domain) ?? extractDomain(signal.url);
  const now = Date.now();

  const existing = await ctx.db
    .query("publicResearchEntities")
    .withIndex("by_entityKey", (q: any) => q.eq("entityKey", entityKey))
    .first();

  const aliases = uniqueStrings([canonicalName, ...(signal.aliases ?? []), existing?.aliases ?? []].flat());
  const domains = uniqueStrings([domain, ...(existing?.domains ?? [])]);
  const siteUrls = uniqueStrings([signal.url, ...(existing?.siteUrls ?? [])]);
  const linkedinUrls = uniqueStrings([signal.linkedinUrl, ...(existing?.linkedinUrls ?? [])]);
  const githubUrls = uniqueStrings([signal.githubUrl, ...(existing?.githubUrls ?? [])]);

  if (existing) {
    await ctx.db.patch(existing._id, {
      canonicalName: existing.canonicalName || canonicalName,
      normalizedName,
      aliases,
      domains,
      siteUrls,
      linkedinUrls,
      githubUrls,
      confidence: Math.max(existing.confidence ?? 0, domain ? 0.86 : 0.68),
      updatedAt: now,
    });
    return { ...existing, aliases, domains, siteUrls, linkedinUrls, githubUrls, updatedAt: now };
  }

  const id = await ctx.db.insert("publicResearchEntities", {
    entityKey,
    entityType,
    canonicalName,
    normalizedName,
    aliases,
    domains,
    siteUrls,
    linkedinUrls,
    githubUrls,
    confidence: domain ? 0.86 : 0.68,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return await ctx.db.get(id);
}

async function insertRun(ctx: any, args: {
  entity: any;
  kind?: "company" | "person" | "role" | "product" | "investor" | "school" | "source";
  goal?: string;
  visibility?: "public" | "private_guided";
}) {
  const entity = await upsertEntity(ctx, {
    ...args.entity,
    entityType: args.kind ?? args.entity.entityType ?? "company",
  });
  const now = Date.now();
  const researchRunId = `prr_${hashSync(`${entity.entityKey}|${args.goal ?? ""}|${now}`).slice(0, 20)}`;
  await ctx.db.insert("publicResearchRuns", {
    researchRunId,
    entityId: entity._id,
    entityKey: entity.entityKey,
    entityName: entity.canonicalName,
    kind: args.kind ?? entity.entityType,
    goal: args.goal ?? `Build public dossier for ${entity.canonicalName}`,
    visibility: args.visibility ?? "public",
    status: "queued",
    steps: [{ name: "queued", status: "done", at: now }],
    createdAt: now,
    updatedAt: now,
    claimCount: 0,
    sourceCount: 0,
  });
  await ctx.db.patch(entity._id, { latestRunId: researchRunId, updatedAt: now });
  return {
    researchRunId,
    entityId: entity._id,
    entityKey: entity.entityKey,
    entityName: entity.canonicalName,
    status: "queued" as const,
  };
}

export const resolveEntity = mutation({
  args: entitySignalValidator,
  handler: async (ctx, args) => {
    const entity = await upsertEntity(ctx, args);
    const candidates = await ctx.db
      .query("publicResearchEntities")
      .withIndex("by_type_name", (q) => q.eq("entityType", entity.entityType).eq("normalizedName", entity.normalizedName))
      .take(5);
    return {
      entityId: entity._id,
      entityKey: entity.entityKey,
      entityType: entity.entityType,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
      domains: entity.domains,
      confidence: entity.confidence,
      candidates: candidates.map((candidate: any) => ({
        entityId: candidate._id,
        entityKey: candidate.entityKey,
        canonicalName: candidate.canonicalName,
        confidence: candidate.confidence,
      })),
    };
  },
});

export const startResearchRun = mutation({
  args: {
    entity: entitySignalValidator,
    kind: v.optional(entityTypeValidator),
    goal: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private_guided"))),
  },
  handler: async (ctx, args) => {
    const run = await insertRun(ctx, args);
    await ctx.scheduler.runAfter(0, internal.domains.publicResearch.actions.executeResearchRun, {
      researchRunId: run.researchRunId,
      entityKey: run.entityKey,
      entityName: run.entityName,
      kind: args.kind ?? args.entity.entityType ?? "company",
    });
    return run;
  },
});

export const startResearchRunInternal = internalMutation({
  args: {
    entity: entitySignalValidator,
    kind: v.optional(entityTypeValidator),
    goal: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private_guided"))),
  },
  handler: async (ctx, args) => insertRun(ctx, args),
});

export const setRunStatus = internalMutation({
  args: {
    researchRunId: v.string(),
    status: researchStatusValidator,
    stepName: v.string(),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("publicResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", args.researchRunId))
      .first();
    if (!run) return { ok: false, reason: "run_not_found" };
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: args.status,
      steps: [...(run.steps ?? []), { name: args.stepName, status: args.error ? "failed" : "done", at: now, note: args.note }],
      updatedAt: now,
      ...(args.error ? { error: args.error, finishedAt: now } : {}),
    });
    return { ok: true };
  },
});

export const publishExtractedClaims = internalMutation({
  args: {
    researchRunId: v.string(),
    entityKey: v.string(),
    claims: v.array(v.object({
      claim: v.string(),
      claimType: v.string(),
      source: sourceInputValidator,
      confidence: v.optional(v.number()),
      freshnessTtlMs: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db
      .query("publicResearchEntities")
      .withIndex("by_entityKey", (q) => q.eq("entityKey", args.entityKey))
      .first();
    if (!entity) return { inserted: 0, updated: 0, rejected: args.claims.length, sourceCount: 0 };

    let inserted = 0;
    let updated = 0;
    let rejected = 0;
    const seenSources = new Set<string>();
    const now = Date.now();

    for (const item of args.claims) {
      const sourceUrl = item.source.url.trim();
      const evidenceSnippet = normalizeText(item.source.snippet ?? item.claim).slice(0, 1200);
      const verification = evaluateClaim({
        claim: item.claim,
        evidenceSnippet,
        sourceUrl,
        confidence: item.confidence,
      });
      if (verification.verifierStatus === "rejected") {
        rejected += 1;
        continue;
      }
      seenSources.add(sourceUrl);
      const contentHash = hashSync([
        entity.entityKey,
        normalizeName(item.claim),
        sourceUrl.toLowerCase(),
        normalizeName(evidenceSnippet),
      ].join("|"));
      const existing = await ctx.db
        .query("publicResearchClaims")
        .withIndex("by_entity_claim_hash", (q) => q.eq("entityKey", entity.entityKey).eq("contentHash", contentHash))
        .first();
      const payload = {
        entityId: entity._id,
        entityKey: entity.entityKey,
        claim: normalizeText(item.claim).slice(0, 1000),
        claimType: normalizeText(item.claimType || "general").slice(0, 80),
        sourceUrl,
        sourceTitle: normalizeText(item.source.title ?? extractDomain(sourceUrl) ?? sourceUrl).slice(0, 240),
        evidenceSnippet,
        retrievedAt: now,
        contentHash,
        confidence: verification.confidence,
        verifierStatus: verification.verifierStatus,
        freshnessTtlMs: item.freshnessTtlMs ?? DEFAULT_FRESHNESS_TTL_MS,
        contradictions: [] as string[],
        sourceIsPublic: verification.sourceIsPublic,
        privateBoundaryStatus: verification.privateBoundaryStatus,
        submittedBySurface: "research_run",
        researchRunId: args.researchRunId,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        updated += 1;
      } else {
        await ctx.db.insert("publicResearchClaims", { ...payload, createdAt: now });
        inserted += 1;
      }
    }

    const run = await ctx.db
      .query("publicResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", args.researchRunId))
      .first();
    if (run) {
      const claimCount = inserted + updated;
      await ctx.db.patch(run._id, {
        status: claimCount > 0 ? "ready" : "needs_review",
        claimCount,
        sourceCount: seenSources.size,
        updatedAt: now,
        finishedAt: now,
        steps: [...(run.steps ?? []), { name: "publish/cache", status: "done", at: now, note: `${claimCount} public claims accepted` }],
      });
    }
    await ctx.db.patch(entity._id, { lastResearchedAt: now, updatedAt: now, latestRunId: args.researchRunId });
    return { inserted, updated, rejected, sourceCount: seenSources.size };
  },
});

export const submitPublicClaim = mutation({
  args: {
    entity: entitySignalValidator,
    claim: v.string(),
    claimType: v.string(),
    sourceUrl: v.string(),
    sourceTitle: v.optional(v.string()),
    evidenceSnippet: v.string(),
    confidence: v.optional(v.number()),
    submittedBySurface: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await upsertEntity(ctx, args.entity);
    const verification = evaluateClaim({
      claim: args.claim,
      evidenceSnippet: args.evidenceSnippet,
      sourceUrl: args.sourceUrl,
      confidence: args.confidence,
    });
    if (verification.verifierStatus === "rejected") {
      return {
        accepted: false,
        reason: verification.sourceIsPublic ? "private_boundary_blocked" : "source_not_public",
      };
    }
    const now = Date.now();
    const contentHash = hashSync([
      entity.entityKey,
      normalizeName(args.claim),
      args.sourceUrl.toLowerCase(),
      normalizeName(args.evidenceSnippet),
    ].join("|"));
    const existing = await ctx.db
      .query("publicResearchClaims")
      .withIndex("by_entity_claim_hash", (q) => q.eq("entityKey", entity.entityKey).eq("contentHash", contentHash))
      .first();
    const payload = {
      entityId: entity._id,
      entityKey: entity.entityKey,
      claim: normalizeText(args.claim).slice(0, 1000),
      claimType: normalizeText(args.claimType).slice(0, 80),
      sourceUrl: args.sourceUrl.trim(),
      sourceTitle: normalizeText(args.sourceTitle ?? extractDomain(args.sourceUrl) ?? args.sourceUrl).slice(0, 240),
      evidenceSnippet: normalizeText(args.evidenceSnippet).slice(0, 1200),
      retrievedAt: now,
      contentHash,
      confidence: verification.confidence,
      verifierStatus: verification.verifierStatus,
      freshnessTtlMs: DEFAULT_FRESHNESS_TTL_MS,
      contradictions: [] as string[],
      sourceIsPublic: verification.sourceIsPublic,
      privateBoundaryStatus: verification.privateBoundaryStatus,
      submittedBySurface: args.submittedBySurface,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { accepted: true, claimId: existing._id, updated: true, verifierStatus: verification.verifierStatus };
    }
    const claimId = await ctx.db.insert("publicResearchClaims", { ...payload, createdAt: now });
    return { accepted: true, claimId, updated: false, verifierStatus: verification.verifierStatus };
  },
});

export const getResearchStatus = query({
  args: { researchRunId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("publicResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", args.researchRunId))
      .first();
  },
});

export const verifyClaim = mutation({
  args: {
    claimId: v.id("publicResearchClaims"),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) return { ok: false, reason: "claim_not_found" };
    const verification = evaluateClaim({
      claim: claim.claim,
      evidenceSnippet: claim.evidenceSnippet,
      sourceUrl: claim.sourceUrl,
      confidence: claim.confidence,
    });
    const isExpired = Date.now() > claim.retrievedAt + claim.freshnessTtlMs;
    const verifierStatus = isExpired && verification.verifierStatus === "verified"
      ? "stale"
      : verification.verifierStatus;
    await ctx.db.patch(args.claimId, {
      sourceIsPublic: verification.sourceIsPublic,
      privateBoundaryStatus: verification.privateBoundaryStatus,
      verifierStatus,
      confidence: verification.confidence,
      updatedAt: Date.now(),
    });
    return {
      ok: true,
      claimId: args.claimId,
      verifierStatus,
      sourceIsPublic: verification.sourceIsPublic,
      privateBoundaryStatus: verification.privateBoundaryStatus,
      isExpired,
    };
  },
});

export const getEntityDossier = query({
  args: {
    entityId: v.optional(v.id("publicResearchEntities")),
    entityKey: v.optional(v.string()),
    entityType: v.optional(entityTypeValidator),
    name: v.optional(v.string()),
    domain: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entityKey = args.entityKey ?? canonicalKey({ entityType: args.entityType, name: args.name, domain: args.domain });
    const entity = args.entityId
      ? await ctx.db.get(args.entityId)
      : await ctx.db
        .query("publicResearchEntities")
        .withIndex("by_entityKey", (q) => q.eq("entityKey", entityKey))
        .first();
    if (!entity) return null;
    const limit = Math.min(args.limit ?? 20, 50);
    const claims = await ctx.db
      .query("publicResearchClaims")
      .withIndex("by_entity_updated", (q) => q.eq("entityKey", entity.entityKey))
      .order("desc")
      .take(limit);
    const runs = await ctx.db
      .query("publicResearchRuns")
      .withIndex("by_entity_updated", (q) => q.eq("entityKey", entity.entityKey))
      .order("desc")
      .take(8);
    const verifiedClaims = claims.filter((claim: any) => claim.verifierStatus === "verified");
    const sources = Array.from(new Map(claims.map((claim: any) => [claim.sourceUrl, {
      url: claim.sourceUrl,
      title: claim.sourceTitle,
      retrievedAt: claim.retrievedAt,
    }])).values());
    return {
      entity,
      summary: verifiedClaims.slice(0, 3).map((claim: any) => claim.claim).join(" "),
      claims,
      sources,
      runs,
      freshness: {
        lastResearchedAt: entity.lastResearchedAt ?? null,
        label: entity.lastResearchedAt && Date.now() - entity.lastResearchedAt < DEFAULT_FRESHNESS_TTL_MS ? "fresh" : "stale_or_missing",
      },
      confidence: verifiedClaims.length > 0
        ? verifiedClaims.reduce((sum: number, claim: any) => sum + claim.confidence, 0) / verifiedClaims.length
        : entity.confidence,
    };
  },
});

export const getContextPack = query({
  args: {
    entityId: v.optional(v.id("publicResearchEntities")),
    entityKey: v.optional(v.string()),
    entityType: v.optional(entityTypeValidator),
    name: v.optional(v.string()),
    domain: v.optional(v.string()),
    useCase: v.optional(v.union(
      v.literal("job_match"),
      v.literal("interview_prep"),
      v.literal("sales_research"),
      v.literal("product_intel"),
      v.literal("general"),
    )),
  },
  handler: async (ctx, args) => {
    const entityKey = args.entityKey ?? canonicalKey({ entityType: args.entityType, name: args.name, domain: args.domain });
    const entity = args.entityId
      ? await ctx.db.get(args.entityId)
      : await ctx.db
        .query("publicResearchEntities")
        .withIndex("by_entityKey", (q) => q.eq("entityKey", entityKey))
        .first();
    if (!entity) return null;
    const claims = await ctx.db
      .query("publicResearchClaims")
      .withIndex("by_entity_updated", (q) => q.eq("entityKey", entity.entityKey))
      .order("desc")
      .take(12);
    const verifiedClaims = claims.filter((claim: any) => claim.verifierStatus === "verified");
    const sourceRefs = Array.from(new Map(verifiedClaims.map((claim: any) => [claim.sourceUrl, {
      title: claim.sourceTitle,
      url: claim.sourceUrl,
      evidence: claim.evidenceSnippet,
      retrievedAt: claim.retrievedAt,
    }])).values()).slice(0, 8);
    return {
      entity_id: entity._id,
      entity_key: entity.entityKey,
      entity_name: entity.canonicalName,
      use_case: args.useCase ?? "general",
      summary: verifiedClaims.slice(0, 3).map((claim: any) => claim.claim).join(" ") || "No verified public dossier yet.",
      signals: verifiedClaims.slice(0, 8).map((claim: any) => ({
        type: claim.claimType,
        text: claim.claim,
        confidence: claim.confidence,
      })),
      risks: claims.some((claim: any) => claim.verifierStatus === "needs_review")
        ? ["Some public claims still need review."]
        : [],
      missing_info: verifiedClaims.length === 0 ? ["No verified public claims stored yet."] : [],
      freshness: {
        last_researched_at: entity.lastResearchedAt ?? null,
        ttl_ms: DEFAULT_FRESHNESS_TTL_MS,
      },
      sources: sourceRefs,
      private_boundary: "Public pack only. Private fit scoring must remain in the calling app.",
    };
  },
});

export const listLatestPublicEntityResearch = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 8, 20);
    const runs = await ctx.db
      .query("publicResearchRuns")
      .withIndex("by_updated")
      .order("desc")
      .take(limit * 8);
    const rows: any[] = [];
    const seen = new Set<string>();
    for (const run of runs) {
      if (seen.has(run.entityKey)) continue;
      if (run.status !== "ready" && run.status !== "needs_review") continue;
      seen.add(run.entityKey);
      const entity = run.entityId ? await ctx.db.get(run.entityId) : null;
      const entityName = entity?.canonicalName ?? run.entityName;
      const entityType = entity?.entityType ?? run.kind;
      if (!isPublicLatestSafeEntity(run.entityKey, entityName)) continue;
      const claims = await ctx.db
        .query("publicResearchClaims")
        .withIndex("by_entity_updated", (q) => q.eq("entityKey", run.entityKey))
        .order("desc")
        .take(8);
      const publicClaims = claims
        .filter((claim: any) =>
          claim.sourceIsPublic &&
          claim.privateBoundaryStatus === "clean" &&
          (claim.verifierStatus === "verified" || claim.verifierStatus === "needs_review")
        )
        .slice(0, 3);
      if (publicClaims.length === 0) continue;
      if (!isPublicLatestSafeRow({ entityType, entityName, claims: publicClaims })) continue;
      rows.push({
        researchRunId: run.researchRunId,
        status: run.status,
        entityKey: run.entityKey,
        entityName,
        entityType,
        updatedAt: run.updatedAt,
        claimCount: publicClaims.length,
        sourceCount: new Set(publicClaims.map((claim: any) => claim.sourceUrl)).size,
        confidence: publicClaims.length
          ? publicClaims.reduce((sum: number, claim: any) => sum + claim.confidence, 0) / publicClaims.length
          : entity?.confidence ?? 0,
        summary: publicClaims.map((claim: any) => claim.claim).join(" "),
        sources: Array.from(new Map(publicClaims.map((claim: any) => [claim.sourceUrl, {
          title: claim.sourceTitle,
          url: claim.sourceUrl,
        }])).values()),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
});

export const linkPrivateSignalToPublicEntity = mutation({
  args: {
    ownerKey: v.string(),
    entity: entitySignalValidator,
    privateSignalKind: v.string(),
    privateSignalSummary: v.string(),
    publicPurpose: v.string(),
  },
  handler: async (ctx, args) => {
    const entity = await upsertEntity(ctx, args.entity);
    const now = Date.now();
    const privateSignalHash = hashSync(`${args.ownerKey}|${args.privateSignalKind}|${args.privateSignalSummary}`);
    const id = await ctx.db.insert("publicResearchPrivateLinks", {
      entityId: entity._id,
      entityKey: entity.entityKey,
      ownerKey: args.ownerKey,
      privateSignalKind: args.privateSignalKind,
      privateSignalHash,
      publicPurpose: normalizeText(args.publicPurpose).slice(0, 240),
      createdAt: now,
    });
    return {
      linkId: id,
      entityKey: entity.entityKey,
      storedPrivateText: false,
      privateSignalHash,
    };
  },
});
