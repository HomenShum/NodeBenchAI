"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import type { EmailIntelligenceDossier } from "../lib/dossierGenerator";
import type { Id } from "../_generated/dataModel";

const REQUIRED_SECTIONS = [
  "executive summary",
  "problem statement",
  "proposed solution",
  "technical specifications",
  "success metrics",
  "implementation timeline",
  "risk assessment",
  "pricing",
];

type ComposeReturn = {
  success: boolean;
  prdMarkdown: string;
  validation: ReturnType<typeof validatePRDStructure>;
  citations: string[];
  confidenceScore: number;
  documentId?: string;
  pdfArtifact?: string;
};

export const composePRDForPartnership = (action as any)({
  args: {
    emailIntelligence: v.any(),
    dossierData: v.optional(v.any()),
    deliverEmail: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx: any, args: any): Promise<ComposeReturn> => {
    const startedAt = Date.now();
    const dossier = (args.dossierData || {}) as EmailIntelligenceDossier;
    const companyName = dossier.company?.name ?? args.emailIntelligence?.entities?.companies?.[0] ?? "Partner";

    const prompt = buildPRDPrompt(companyName, dossier, args.emailIntelligence);
    const run = (await ctx.runAction((api as any).domains.agents.core.coordinatorAgent.runCoordinatorAgent, {
      threadId: `prd-${Date.now()}`,
      prompt,
    })) as { text?: string } | string;

    const prdMarkdown = typeof run === "string" ? run : run?.text || "";
    const validation = validatePRDStructure(prdMarkdown);
    const citations = extractCitations(prdMarkdown);
    const confidenceScore = calculateConfidenceScore({
      citationCount: citations.length,
      sectionsFound: validation.sectionsFound.length,
      totalSections: validation.requiredSections.length,
      researchDuration: Date.now() - startedAt,
    });

    const documentId = await persistPRDDocument(ctx, companyName, prdMarkdown);
    const pdfArtifact = await exportPRDtoPDF(prdMarkdown, companyName);

    if (args.deliverEmail) {
      await maybeEmailPRD(ctx, companyName, prdMarkdown, citations);
    }

    return {
      success: true,
      prdMarkdown,
      validation,
      citations,
      confidenceScore,
      documentId: documentId ? String(documentId) : undefined,
      pdfArtifact,
    };
  },
});

function buildPRDPrompt(companyName: string, dossier: EmailIntelligenceDossier, emailIntelligence: any): string {
  const emailSummary = emailIntelligence?.snippet || emailIntelligence?.subject || "";
  const expertise =
    "Building agents and reasoning models for semiconductor design/verification with Tier 1 fabs and OEMs.";

  const actionItems = [
    `Company: ${companyName}`,
    `Their ask: ${emailSummary}`,
    `Our expertise: ${expertise}`,
    `Known investors: ${(dossier.funding?.investorProfiles ?? [])
      .map((i) => i.name)
      .slice(0, 5)
      .join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `
You are the Deep Agent PRD Composer. Research deeply and write an 8-section PRD for a partnership.

${actionItems}

Required sections (use markdown headings):
1. Executive Summary (1-2 paragraphs)
2. Problem Statement
3. Proposed Solution Architecture
4. Technical Specifications (APIs, data models, integration points)
5. Success Metrics (KPIs, benchmarks)
6. Implementation Timeline (phased rollout)
7. Risk Assessment (technical, business, competitive)
8. Pricing & Business Model

Always cite sources inline when available and ground claims in the dossier context.`;
}

function validatePRDStructure(markdown: string) {
  const lower = markdown.toLowerCase();
  const sectionsFound = REQUIRED_SECTIONS.filter((section) => lower.includes(section));
  const missing = REQUIRED_SECTIONS.filter((s) => !sectionsFound.includes(s));
  return {
    valid: missing.length === 0,
    sectionsFound,
    missing,
    requiredSections: REQUIRED_SECTIONS,
  };
}

function extractCitations(markdown: string): string[] {
  const urls = Array.from(markdown.matchAll(/https?:\/\/\S+/g)).map((m) => m[0]);
  const bracketed = Array.from(markdown.matchAll(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g)).map((m) => m[2]);
  const merged = [...urls, ...bracketed];
  return Array.from(new Set(merged)).slice(0, 25);
}

function calculateConfidenceScore(params: {
  citationCount: number;
  sectionsFound: number;
  totalSections: number;
  researchDuration: number;
}): number {
  const citationScore = Math.min(40, params.citationCount * 3);
  const sectionScore = Math.min(40, (params.sectionsFound / Math.max(1, params.totalSections)) * 40);
  const speedScore = Math.max(0, 20 - Math.min(20, params.researchDuration / 60000));
  return Math.round(Math.min(100, citationScore + sectionScore + speedScore));
}

async function persistPRDDocument(
  ctx: any,
  companyName: string,
  markdown: string,
): Promise<Id<"documents"> | undefined> {
  try {
    const userId = await getAuthUserId(ctx);
    if (!userId) return undefined;
    const docId = (await ctx.runMutation(api.domains.documents.documents.createWithContent, {
      title: `PRD: ${companyName}`,
      content: markdown,
    })) as Id<"documents">;
    return docId;
  } catch (err) {
    console.warn("[prdComposer] persistPRDDocument failed", err);
    return undefined;
  }
}

async function exportPRDtoPDF(markdown: string, companyName: string): Promise<string | undefined> {
  // Placeholder for future PDF export (Puppeteer/Playwright)
  const truncated = markdown.slice(0, 120).replace(/\s+/g, " ");
  return `pdf-placeholder://${companyName}-${truncated}`;
}

async function maybeEmailPRD(ctx: any, companyName: string, markdown: string, citations: string[]) {
  try {
    const user = await ctx.runQuery(api.domains.auth.auth.loggedInUser, {});
    const to = user?.email;
    if (!to) return;

    const summary = extractExecutiveSummary(markdown);
    const body = [
      `Partnership PRD: ${companyName}`,
      summary ? `\nExecutive Summary:\n${summary}\n` : "",
      citations.length ? `\nSources:\n- ${citations.slice(0, 5).join("\n- ")}` : "",
      "\nFull PRD attached in the workspace.",
    ]
      .filter(Boolean)
      .join("\n");

    await ctx.runAction((api as any).domains.integrations.email.sendEmail, {
      to,
      subject: `Partnership PRD: ${companyName}`,
      body,
    });
  } catch (err) {
    console.warn("[prdComposer] email delivery failed", err);
  }
}

function extractExecutiveSummary(markdown: string): string | undefined {
  const match = markdown.match(/##?\s*Executive Summary\s*\n([^#]+)/i);
  if (match && match[1]) {
    return match[1].trim().split("\n").slice(0, 3).join(" ");
  }
  return undefined;
}
