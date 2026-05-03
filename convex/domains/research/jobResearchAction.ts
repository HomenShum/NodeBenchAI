/**
 * Job Research Action
 *
 * Lightweight research endpoint optimized for job-email pipeline integration.
 * Provides multi-angle intelligence on companies and people from email context.
 *
 * Called by api-headless /v1/job-research or via MCP tool.
 */

"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

const JOB_RESEARCH_TIMEOUT_MS = 25_000;

export const researchJobContext = action({
  args: {
    companyName: v.optional(v.string()),
    senderName: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailSnippet: v.optional(v.string()),
    depth: v.optional(v.union(v.literal("quick"), v.literal("standard"))),
  },
  returns: v.object({
    company: v.optional(v.object({
      name: v.string(),
      founded: v.optional(v.string()),
      stage: v.optional(v.string()),
      valuation: v.optional(v.string()),
      employees: v.optional(v.string()),
      recentNews: v.array(v.string()),
      competitors: v.array(v.string()),
      fundingHistory: v.array(v.string()),
      keyPeople: v.array(v.string()),
      industry: v.optional(v.string()),
      headquarters: v.optional(v.string()),
    })),
    sender: v.optional(v.object({
      name: v.string(),
      role: v.optional(v.string()),
      background: v.optional(v.string()),
      mutualConnections: v.array(v.string()),
    })),
    diligenceAngles: v.object({
      financialHealth: v.optional(v.string()),
      culture: v.optional(v.string()),
      interviewProcess: v.optional(v.string()),
      recentHires: v.optional(v.string()),
      marketPosition: v.optional(v.string()),
      risks: v.array(v.string()),
    }),
    jobContext: v.optional(v.object({
      title: v.optional(v.string()),
      level: v.optional(v.string()),
      salaryRange: v.optional(v.string()),
      skillsRequired: v.array(v.string()),
      teamSize: v.optional(v.string()),
      reportingTo: v.optional(v.string()),
    })),
    sources: v.array(v.object({
      url: v.string(),
      title: v.string(),
      snippet: v.string(),
    })),
    publicContextPack: v.optional(v.any()),
    publicResearchStatus: v.optional(v.string()),
    traceId: v.string(),
  }),
  handler: async (ctx, args): Promise<any> => {
    const traceId = `job-research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const depth = args.depth || "quick";
    const startTime = Date.now();

    console.log(`[JobResearch] Starting ${traceId}`, {
      company: args.companyName,
      sender: args.senderName,
      jobTitle: args.jobTitle,
      depth,
    });

    const senderDomain = args.senderEmail?.split("@")[1]?.trim().toLowerCase();
    let publicDossier: any = null;
    let publicContextPack: any = null;
    let publicResearchStatus: string | undefined;

    if (args.companyName) {
      try {
        publicDossier = await ctx.runAction(api.domains.publicResearch.actions.researchCompany, {
          companyName: args.companyName,
          domain: senderDomain,
          visibility: "private_guided",
          goal: args.jobTitle
            ? `Public job-match context for ${args.jobTitle} at ${args.companyName}`
            : `Public job-match context for ${args.companyName}`,
        });
        publicContextPack = await ctx.runQuery(api.domains.publicResearch.core.getContextPack, {
          entityKey: publicDossier?.entity?.entityKey,
          entityType: "company",
          name: args.companyName,
          useCase: "job_match",
        });
        publicResearchStatus = publicContextPack ? "verified" : "needs_review";
      } catch (err: any) {
        publicResearchStatus = "failed";
        console.warn(`[JobResearch] Public context pack failed for ${args.companyName}:`, err?.message ?? err);
      }
    }

    // Build search queries. These remain public-source only; email snippet and
    // resume/private artifacts are intentionally not used in search text.
    const queries: string[] = [];
    if (args.companyName) {
      queries.push(`${args.companyName} company overview funding valuation`);
      queries.push(`${args.companyName} recent news 2026`);
      queries.push(`${args.companyName} competitors market position`);
    }
    if (args.senderName && args.companyName) {
      queries.push(`${args.senderName} ${args.companyName} linkedin`);
    }
    if (args.jobTitle && args.companyName) {
      queries.push(`${args.companyName} ${args.jobTitle} interview process`);
    }

    // Run parallel searches with timeout
    const searchPromises = queries.map(async (q) => {
      try {
        return await ctx.runAction(api.domains.search.fusionSearch, {
          query: q,
          mode: depth === "quick" ? "fast" : "balanced",
          maxResults: 5,
        });
      } catch (e) {
        console.error(`[JobResearch] Search failed for "${q}":`, e);
        return null;
      }
    });

    // Race with timeout
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), JOB_RESEARCH_TIMEOUT_MS)
    );

    const searchResults = await Promise.race([
      Promise.all(searchPromises).then((results) => ({ type: "results" as const, results })),
      timeoutPromise.then(() => ({ type: "timeout" as const, results: [] as any[] })),
    ]);

    if (searchResults.type === "timeout") {
      console.warn(`[JobResearch] ${traceId} timed out`);
    }

    // Aggregate results
    const allResults = searchResults.results.filter((r) => r !== null).flatMap((r: any) => {
      if (r && typeof r === "object" && "results" in r) {
        return r.results || [];
      }
      return [];
    });

    // Extract unique sources
    const sourcesFromPack = (publicContextPack?.sources ?? [])
      .slice(0, 10)
      .map((source: any) => ({
        url: source.url || "",
        title: source.title || "Public source",
        snippet: source.evidence || "",
      }))
      .filter((source: any) => source.url);

    const sources = (sourcesFromPack.length ? sourcesFromPack : allResults
      .slice(0, 10)
      .map((r: any) => ({
        url: r.url || r.link || "",
        title: r.title || "Untitled",
        snippet: r.snippet || r.summary || "",
      }))
      .filter((s: any) => s.url));

    // Try to find entity data if company name provided
    let entityData: any = null;
    if (args.companyName) {
      try {
        entityData = await ctx.runQuery(api.domains.knowledge.entities.getByName, {
          name: args.companyName,
        });
      } catch (e) {
        console.log(`[JobResearch] No cached entity for ${args.companyName}`);
      }
    }

    // Build response from available data
    const company = args.companyName
      ? {
          name: args.companyName,
          founded: entityData?.founded || undefined,
          stage: entityData?.stage || undefined,
          valuation: entityData?.valuation || undefined,
          employees: entityData?.employees || undefined,
          recentNews: publicContextPack?.signals?.length
            ? publicContextPack.signals.slice(0, 3).map((signal: any) => signal.text)
            : allResults
            .filter((r: any) => r.title && r.title.includes(args.companyName))
            .slice(0, 3)
            .map((r: any) => `${r.title}: ${r.snippet || ""}`),
          competitors: entityData?.competitors || [],
          fundingHistory: entityData?.fundingHistory || [],
          keyPeople: entityData?.keyPeople || [],
          industry: entityData?.industry || undefined,
          headquarters: entityData?.headquarters || undefined,
        }
      : undefined;

    const sender = args.senderName
      ? {
          name: args.senderName,
          role: undefined,
          background: undefined,
          mutualConnections: [],
        }
      : undefined;

    const diligenceAngles = {
      financialHealth: entityData?.financialHealth || undefined,
      culture: entityData?.culture || undefined,
      interviewProcess: undefined,
      recentHires: undefined,
      marketPosition: undefined,
      risks: [],
    };

    const jobContext = args.jobTitle
      ? {
          title: args.jobTitle,
          level: undefined,
          salaryRange: undefined,
          skillsRequired: [],
          teamSize: undefined,
          reportingTo: undefined,
        }
      : undefined;

    const elapsed = Date.now() - startTime;
    console.log(`[JobResearch] ${traceId} completed in ${elapsed}ms`);

    return {
      company,
      sender,
      diligenceAngles,
      jobContext,
      sources,
      publicContextPack,
      publicResearchStatus,
      traceId,
    };
  },
});
