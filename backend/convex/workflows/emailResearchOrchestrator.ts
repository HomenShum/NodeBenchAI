"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import { analyzeEmailIntelligence, type EmailIntelligence } from "../tools/email/emailIntelligenceParser";
import { generateActionItems } from "../lib/actionItemsGenerator";
import { generateDossier, type EmailIntelligenceDossier } from "../lib/dossierGenerator";
import { generateDossierEmail, type DossierEmailData } from "../domains/integrations/email/dossierEmailTemplate";

export const orchestrateEmailResearch = (action as any)({
  args: {
    email: v.any(),
    deliverEmail: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx: any, args: any): Promise<any> => {
    const errors: string[] = [];
    const startedAt = Date.now();
    const intelligence: EmailIntelligence = analyzeEmailIntelligence(args.email, [
      "investment",
      "partnership",
      "demo",
      "meeting",
      "api",
      "integration",
    ]);

    const companyName = intelligence.entities.companies[0];
    let companyResearch: any = null;
    let founderResearch: any = null;
    let investorResearch: any = null;

    if (companyName) {
      try {
        companyResearch = await ctx.runAction(
          (api as any).tools.financial.enhancedFundingTools.enrichCompanyDossier,
          {
            companyName,
            industry: "technology",
            fundingStage: intelligence.entities.keywords.join(", ").slice(0, 120),
            includePatents: false,
          }
        );
      } catch (err: any) {
        errors.push(`companyResearch: ${err?.message ?? String(err)}`);
      }

      try {
        founderResearch = await ctx.runAction(
          (api as any).tools.financial.enhancedFundingTools.enrichFounderInfo,
          {
            companyName,
            industry: "technology",
          }
        );
      } catch (err: any) {
        errors.push(`founderResearch: ${err?.message ?? String(err)}`);
      }

      try {
        investorResearch = await ctx.runAction(
          (api as any).tools.financial.enhancedFundingTools.smartFundingSearch,
          {
            industries: ["technology", "semiconductor", "ai"],
            fundingStages: ["seed", "series-a", "series-b"],
          }
        );
      } catch (err: any) {
        errors.push(`investorResearch: ${err?.message ?? String(err)}`);
      }
    }

    const actionItems = generateActionItems({
      companyName,
      intent: intelligence.intent,
      industry: "semiconductor and AI",
      userProfile: "reasoning models for verification and research",
    });

    const dossier: EmailIntelligenceDossier = generateDossier({
      intelligence,
      companyResearch,
      founderResearch,
      investorResearch,
      actionItems,
      researchDurationMs: Date.now() - startedAt,
    });

    if (args.deliverEmail) {
      await maybeDeliverEmail(ctx, dossier, intelligence, errors);
    }

    return {
      success: true,
      dossier,
      emailIntelligence: intelligence,
      errors: errors.length ? errors : undefined,
    };
  },
});

async function maybeDeliverEmail(
  ctx: any,
  dossier: EmailIntelligenceDossier,
  intelligence: EmailIntelligence,
  errors: string[],
) {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      errors.push("delivery: no authenticated user");
      return;
    }

    const user = await ctx.runQuery(api.domains.auth.auth.loggedInUser, {});
    const to = user?.email;
    if (!to) {
      errors.push("delivery: user email not found");
      return;
    }

    const emailData: DossierEmailData = {
      title: `Email Intelligence: ${dossier.company.name}`,
      companyOverview: {
        name: dossier.company.name,
        description: dossier.company.description,
        headquarters: dossier.company.headquarters,
        website: dossier.company.website,
        founded: dossier.company.founded,
        industry: dossier.company.industry,
        employeeCount: dossier.company.employeeCount,
        stage: typeof dossier.company.stage === "string" ? dossier.company.stage : undefined,
      },
      founders: dossier.team.map((person) => ({
        name: person.name,
        role: person.role,
        bio: person.bio,
        linkedin: person.linkedin,
        twitter: person.twitter,
      })),
      funding: {
        totalRaised: dossier.funding.totalRaised ?? "",
        latestRound: dossier.funding.latestRound && {
          round: dossier.funding.latestRound.round,
          amount: dossier.funding.latestRound.amount,
          date: dossier.funding.latestRound.date ?? "",
          investors: dossier.funding.latestRound.participants ?? [],
        },
        rounds: dossier.funding.rounds.map((round) => ({
          round: round.round,
          amount: round.amount,
          date: round.date ?? "",
          investors: round.participants ?? [],
        })),
        keyInvestors: dossier.funding.investorProfiles.map((inv) => inv.name),
      },
      researchLinks: dossier.sources.map((source) => ({
        title: source.title,
        url: source.url,
        source: source.type,
        date: source.date,
        snippet: source.snippet,
        type: source.type as any,
      })),
      highlightedQuote: intelligence.subject
        ? {
            text: intelligence.subject,
            author: intelligence.from,
          }
        : undefined,
    };

    const html = generateDossierEmail(emailData);
    await ctx.runAction((api as any).domains.integrations.email.sendEmail, {
      to,
      subject: `Email Intelligence: ${dossier.company.name}`,
      body: html,
    });
  } catch (err: any) {
    errors.push(`delivery: ${err?.message ?? String(err)}`);
  }
}
