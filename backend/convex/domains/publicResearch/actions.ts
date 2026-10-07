"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

const entityTypeValidator = v.union(
  v.literal("company"),
  v.literal("person"),
  v.literal("role"),
  v.literal("product"),
  v.literal("investor"),
  v.literal("school"),
  v.literal("source"),
);

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

type ExtractedClaim = {
  claim: string;
  claimType: string;
  source: { url: string; title?: string; snippet?: string };
  confidence?: number;
  freshnessTtlMs?: number;
};

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max = 900): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

function firstPublicSource(insights: any): { url: string; title?: string; snippet?: string } | null {
  const candidates = [
    ...asArray(insights?.sources),
    ...asArray(insights?.sourceMatrix),
    ...asArray(insights?.recentNewsItems),
    ...asArray(insights?.linkupData?.sources),
  ];
  for (const source of candidates) {
    const url = asString(source?.url);
    if (!/^https?:\/\//i.test(url)) continue;
    return {
      url,
      title: asString(source?.name) || asString(source?.title) || undefined,
      snippet: asString(source?.snippet) || asString(source?.summary) || undefined,
    };
  }
  return null;
}

function publicSourcesFromSearch(result: any): Array<{ url: string; title?: string; snippet?: string }> {
  const results = asArray(result?.payload?.results).length
    ? asArray(result?.payload?.results)
    : asArray(result?.results);
  return results
    .map((item) => ({
      url: asString(item?.url),
      title: asString(item?.title) || undefined,
      snippet: asString(item?.snippet) || asString(item?.highlights?.[0]) || undefined,
    }))
    .filter((source) => /^https?:\/\//i.test(source.url))
    .slice(0, 8);
}

function sourceForClaim(insights: any, fallback: { url: string; title?: string; snippet?: string } | null, fact: string) {
  const source = firstPublicSource(insights) ?? fallback;
  if (source) {
    return {
      url: source.url,
      title: source.title,
      snippet: source.snippet || fact,
    };
  }
  return null;
}

function extractClaimsFromInsights(entityName: string, kind: string, insights: any): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const fallbackSource = firstPublicSource(insights);
  const summary = asString(insights?.summary);
  if (summary) {
    const source = sourceForClaim(insights, fallbackSource, summary);
    if (source) {
      claims.push({
        claim: clip(summary),
        claimType: "summary",
        source,
        confidence: 0.72,
      });
    }
  }

  for (const fact of asArray(insights?.keyFacts).map(asString).filter(Boolean).slice(0, 10)) {
    const source = sourceForClaim(insights, fallbackSource, fact);
    if (!source) continue;
    claims.push({
      claim: clip(fact),
      claimType: "key_fact",
      source,
      confidence: 0.7,
    });
  }

  const website = asString(insights?.crmFields?.website) || asString(insights?.website);
  if (website && /^https?:\/\//i.test(website)) {
    claims.push({
      claim: `${entityName} has a public website at ${website}.`,
      claimType: "site",
      source: { url: website, title: `${entityName} website`, snippet: `${entityName} public website` },
      confidence: 0.82,
    });
  }

  const product = asString(insights?.crmFields?.product);
  if (product && fallbackSource) {
    claims.push({
      claim: `${entityName} product focus: ${clip(product, 240)}`,
      claimType: kind === "role" ? "role_context" : "product",
      source: { ...fallbackSource, snippet: fallbackSource.snippet || product },
      confidence: 0.68,
    });
  }

  const industry = asString(insights?.crmFields?.industry) || asString(insights?.industry);
  if (industry && fallbackSource) {
    claims.push({
      claim: `${entityName} is associated with ${industry}.`,
      claimType: "market",
      source: { ...fallbackSource, snippet: fallbackSource.snippet || industry },
      confidence: 0.66,
    });
  }

  return claims;
}

function parseRoleEntityName(entityName: string): { roleTitle: string; companyName?: string } {
  const match = entityName.match(/^(.+?)\s+at\s+(.+)$/i);
  if (!match) return { roleTitle: entityName.trim() };
  return {
    roleTitle: match[1].trim(),
    companyName: match[2].trim(),
  };
}

async function runRolePublicResearch(ctx: any, args: {
  entityName: string;
  forceRefresh?: boolean;
}) {
  const { roleTitle, companyName } = parseRoleEntityName(args.entityName);
  const roleQuery = companyName
    ? `${companyName} ${roleTitle} careers job requirements`
    : `${roleTitle} role responsibilities market hiring requirements`;

  let roleSources: Array<{ url: string; title?: string; snippet?: string }> = [];
  try {
    const searchResult = await ctx.runAction(api.domains.search.fusion.actions.quickSearch, {
      query: roleQuery,
      maxResults: 8,
      skipRateLimit: true,
      allowPaidSearch: true,
    });
    roleSources = publicSourcesFromSearch(searchResult);
  } catch (err: any) {
    console.warn("[publicResearch] Role source search failed:", err?.message || err);
  }

  let companyInsights: any = null;
  if (companyName) {
    try {
      companyInsights = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
        entityName: companyName,
        entityType: "company",
        forceRefresh: args.forceRefresh ?? false,
      });
    } catch (err: any) {
      console.warn("[publicResearch] Company fallback for role failed:", err?.message || err);
    }
  }

  const sources = roleSources.length
    ? roleSources
    : asArray(companyInsights?.sources).map((source) => ({
        url: asString(source?.url),
        title: asString(source?.name) || asString(source?.title) || undefined,
        snippet: asString(source?.snippet) || asString(source?.summary) || undefined,
      })).filter((source) => /^https?:\/\//i.test(source.url)).slice(0, 8);

  const companySummary = asString(companyInsights?.summary);
  const sourceSummary = sources
    .map((source) => source.snippet || source.title || source.url)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const summary = companyName
    ? `${roleTitle} at ${companyName}: public role context is grounded in ${sources.length} public source${sources.length === 1 ? "" : "s"}.${companySummary ? ` Company context: ${companySummary}` : ""}`
    : `${roleTitle}: public role context is grounded in ${sources.length} public source${sources.length === 1 ? "" : "s"}.`;

  const keyFacts = [
    companyName
      ? `${companyName} is the company context for the ${roleTitle} role.`
      : `${roleTitle} is the role target for this public research run.`,
    sourceSummary
      ? `Relevant public role/source signal: ${clip(sourceSummary, 260)}`
      : "",
    companySummary
      ? `Company background relevant to the role: ${clip(companySummary, 260)}`
      : "",
  ].filter(Boolean);

  return {
    summary,
    keyFacts,
    sources,
    crmFields: {
      roleTitle,
      companyName: companyName || "",
      product: asString(companyInsights?.crmFields?.product),
      industry: asString(companyInsights?.crmFields?.industry),
      website: asString(companyInsights?.crmFields?.website),
    },
  };
}

async function runExistingEntityResearch(ctx: any, args: {
  entityName: string;
  kind: string;
  forceRefresh?: boolean;
}) {
  if (args.kind === "role") {
    return await runRolePublicResearch(ctx, args);
  }
  if (args.kind !== "company" && args.kind !== "person") {
    const result = await ctx.runAction(api.domains.search.fusion.actions.quickSearch, {
      query: `${args.entityName} public sources overview`,
      maxResults: 8,
      skipRateLimit: true,
      allowPaidSearch: true,
    });
    const sources = publicSourcesFromSearch(result);
    return {
      summary: `${args.entityName} public research is grounded in ${sources.length} public source${sources.length === 1 ? "" : "s"}.`,
      keyFacts: sources
        .map((source) => source.snippet || source.title || source.url)
        .filter(Boolean)
        .slice(0, 5),
      sources,
    };
  }
  return await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
    entityName: args.entityName,
    entityType: args.kind,
    forceRefresh: args.forceRefresh ?? false,
  });
}

export const executeResearchRun = internalAction({
  args: {
    researchRunId: v.string(),
    entityKey: v.string(),
    entityName: v.string(),
    kind: entityTypeValidator,
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.domains.publicResearch.core.setRunStatus, {
        researchRunId: args.researchRunId,
        status: "searching",
        stepName: "plan search",
        note: "Resolving public-source research plan",
      });
      const insights = await runExistingEntityResearch(ctx, {
        entityName: args.entityName,
        kind: args.kind,
        forceRefresh: false,
      });

      await ctx.runMutation(internal.domains.publicResearch.core.setRunStatus, {
        researchRunId: args.researchRunId,
        status: "extracting",
        stepName: "extract claims",
        note: "Converting sourced public research into claim-level facts",
      });
      const claims = extractClaimsFromInsights(args.entityName, args.kind, insights);

      await ctx.runMutation(internal.domains.publicResearch.core.setRunStatus, {
        researchRunId: args.researchRunId,
        status: "verifying",
        stepName: "verify",
        note: "Applying public-source and private-boundary checks",
      });
      const result = await ctx.runMutation(internal.domains.publicResearch.core.publishExtractedClaims, {
        researchRunId: args.researchRunId,
        entityKey: args.entityKey,
        claims,
      });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown public research error";
      await ctx.runMutation(internal.domains.publicResearch.core.setRunStatus, {
        researchRunId: args.researchRunId,
        status: "failed",
        stepName: "failed",
        error: message,
      });
      return { ok: false, error: message };
    }
  },
});

export const researchCompany = action({
  args: {
    companyName: v.string(),
    domain: v.optional(v.string()),
    goal: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private_guided"))),
  },
  handler: async (ctx, args) => {
    const run = await ctx.runMutation(internal.domains.publicResearch.core.startResearchRunInternal, {
      entity: {
        entityType: "company",
        name: args.companyName,
        domain: args.domain,
      },
      kind: "company",
      goal: args.goal ?? `Build public company dossier for ${args.companyName}`,
      visibility: args.visibility ?? "public",
    });
    await ctx.runAction(internal.domains.publicResearch.actions.executeResearchRun, {
      researchRunId: run.researchRunId,
      entityKey: run.entityKey,
      entityName: run.entityName,
      kind: "company",
    });
    return await ctx.runQuery(api.domains.publicResearch.core.getEntityDossier, {
      entityKey: run.entityKey,
    });
  },
});

export const researchPerson = action({
  args: {
    personName: v.string(),
    goal: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private_guided"))),
  },
  handler: async (ctx, args) => {
    const run = await ctx.runMutation(internal.domains.publicResearch.core.startResearchRunInternal, {
      entity: {
        entityType: "person",
        name: args.personName,
      },
      kind: "person",
      goal: args.goal ?? `Build public person dossier for ${args.personName}`,
      visibility: args.visibility ?? "public",
    });
    await ctx.runAction(internal.domains.publicResearch.actions.executeResearchRun, {
      researchRunId: run.researchRunId,
      entityKey: run.entityKey,
      entityName: run.entityName,
      kind: "person",
    });
    return await ctx.runQuery(api.domains.publicResearch.core.getEntityDossier, {
      entityKey: run.entityKey,
    });
  },
});

export const researchRole = action({
  args: {
    roleTitle: v.string(),
    companyName: v.optional(v.string()),
    goal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.companyName ? `${args.roleTitle} at ${args.companyName}` : args.roleTitle;
    const run = await ctx.runMutation(internal.domains.publicResearch.core.startResearchRunInternal, {
      entity: {
        entityType: "role",
        name,
        aliases: args.companyName ? [args.roleTitle, args.companyName] : [args.roleTitle],
      },
      kind: "role",
      goal: args.goal ?? `Build public role context for ${name}`,
      visibility: "private_guided",
    });
    await ctx.runAction(internal.domains.publicResearch.actions.executeResearchRun, {
      researchRunId: run.researchRunId,
      entityKey: run.entityKey,
      entityName: run.entityName,
      kind: "role",
    });
    return await ctx.runQuery(api.domains.publicResearch.core.getContextPack, {
      entityKey: run.entityKey,
      useCase: "job_match",
    });
  },
});

export const searchPublicSources = action({
  args: {
    query: v.string(),
    entity: v.optional(entitySignalValidator),
    maxResults: v.optional(v.number()),
    allowPaidSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runAction(api.domains.search.fusion.actions.quickSearch, {
      query: args.query,
      maxResults: args.maxResults ?? 8,
      skipRateLimit: true,
      allowPaidSearch: args.allowPaidSearch ?? false,
    });
    if (args.entity) {
      await ctx.runMutation(internal.domains.publicResearch.core.startResearchRunInternal, {
        entity: args.entity,
        kind: args.entity.entityType ?? "company",
        goal: `Public source search: ${args.query}`,
        visibility: "public",
      });
    }
    return result;
  },
});
