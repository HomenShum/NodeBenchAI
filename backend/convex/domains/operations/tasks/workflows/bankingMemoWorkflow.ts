/**
 * Banking Memo Workflow
 * 
 * Durable workflow for generating investment banking memos with verified citations.
 * Steps: SEC retrieval → Financial analysis → Memo generation → Citation enforcement
 */

import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../../../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../../../_generated/dataModel";

const workflowManager = new WorkflowManager(components.workflow);

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BankingMemoConfig {
    companyName: string;
    ticker?: string;
    analysisType: "equity_research" | "credit_analysis" | "ma_overview" | "ipo_analysis";
    depth: "quick" | "standard" | "deep";
}

export interface MemoSection {
    title: string;
    content: string;
    citations: string[];
}

export interface BankingMemoResult {
    success: boolean;
    documentId?: string;
    sections: MemoSection[];
    citationCount: number;
    validationPassed: boolean;
    error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Workflow Definition
// ═══════════════════════════════════════════════════════════════════════════

export const runBankingMemoWorkflow = workflowManager.define({
    args: {
        userId: v.id("users"),
        companyName: v.string(),
        ticker: v.optional(v.string()),
        analysisType: v.union(
            v.literal("equity_research"),
            v.literal("credit_analysis"),
            v.literal("ma_overview"),
            v.literal("ipo_analysis")
        ),
        depth: v.optional(v.union(
            v.literal("quick"),
            v.literal("standard"),
            v.literal("deep")
        )),
        threadId: v.optional(v.string()),
    },
    handler: async (step, args): Promise<BankingMemoResult> => {
        const depth = args.depth ?? "standard";

        // ═══════════════════════════════════════════════════════════════════════
        // Step 1: SEC Filing Retrieval
        // ═══════════════════════════════════════════════════════════════════════
        const secFilings = await step.runAction(
            internal.domains.tasks.workflows.bankingMemoWorkflow.retrieveSECFilings,
            {
                companyName: args.companyName,
                ticker: args.ticker,
                filingTypes: getFilingTypesForAnalysis(args.analysisType),
                limit: depth === "deep" ? 10 : depth === "standard" ? 5 : 3,
            },
            {
                retry: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 },
            }
        );

        if (!secFilings.success || secFilings.filings.length === 0) {
            return {
                success: false,
                sections: [],
                citationCount: 0,
                validationPassed: false,
                error: `No SEC filings found for ${args.companyName}`,
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Step 2: Financial Data Extraction
        // ═══════════════════════════════════════════════════════════════════════
        const financialData = await step.runAction(
            internal.domains.tasks.workflows.bankingMemoWorkflow.extractFinancialData,
            {
                filings: secFilings.filings,
                analysisType: args.analysisType,
            },
            {
                retry: { maxAttempts: 2, initialBackoffMs: 2000, base: 2 },
            }
        );

        // ═══════════════════════════════════════════════════════════════════════
        // Step 3: Memo Generation with LLM
        // ═══════════════════════════════════════════════════════════════════════
        const memoContent = await step.runAction(
            internal.domains.tasks.workflows.bankingMemoWorkflow.generateMemoContent,
            {
                companyName: args.companyName,
                analysisType: args.analysisType,
                financialData: financialData.data,
                filings: secFilings.filings,
                depth,
            },
            {
                retry: { maxAttempts: 2, initialBackoffMs: 3000, base: 2 },
            }
        );

        // ═══════════════════════════════════════════════════════════════════════
        // Step 4: Create Document and Link Citations
        // ═══════════════════════════════════════════════════════════════════════
        const documentResult = await step.runMutation(
            internal.domains.tasks.workflows.bankingMemoWorkflow.createMemoDocument,
            {
                userId: args.userId,
                companyName: args.companyName,
                analysisType: args.analysisType,
                sections: memoContent.sections,
                artifactIds: secFilings.artifactIds,
            }
        );

        // ═══════════════════════════════════════════════════════════════════════
        // Step 5: Citation Validation
        // ═══════════════════════════════════════════════════════════════════════
        const validation = await step.runQuery(
            internal.domains.documents.citationValidator.validateDocumentCitations,
            { documentId: documentResult.documentId }
        );

        return {
            success: true,
            documentId: documentResult.documentId,
            sections: memoContent.sections,
            citationCount: validation.linkedCitations,
            validationPassed: validation.isValid,
        };
    },
});

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function getFilingTypesForAnalysis(analysisType: string): string[] {
    switch (analysisType) {
        case "equity_research":
            return ["10-K", "10-Q", "8-K"];
        case "credit_analysis":
            return ["10-K", "10-Q", "S-1", "424B"];
        case "ma_overview":
            return ["10-K", "DEF 14A", "8-K", "S-4"];
        case "ipo_analysis":
            return ["S-1", "424B", "10-K"];
        default:
            return ["10-K", "10-Q"];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-Actions (Stubs - to be implemented with actual tool calls)
// ═══════════════════════════════════════════════════════════════════════════

import { internalAction, internalMutation, internalQuery } from "../../../../_generated/server";

export const retrieveSECFilings = internalAction({
    args: {
        companyName: v.string(),
        ticker: v.optional(v.string()),
        filingTypes: v.array(v.string()),
        limit: v.number(),
    },
    returns: v.object({
        success: v.boolean(),
        filings: v.array(v.object({
            accessionNumber: v.string(),
            filingType: v.string(),
            filedAt: v.string(),
            documentUrl: v.string(),
        })),
        artifactIds: v.array(v.id("sourceArtifacts")),
    }),
    handler: async (ctx, args) => {
        console.log(`[BankingMemo] Retrieving SEC filings for ${args.companyName} via toolRouter`);

        // Call SEC EDGAR via health-aware toolRouter
        const routerResult = await ctx.runAction(
            internal.domains.agents.orchestrator.toolRouter.executeWithRouting,
            {
                toolName: "secFilings",
                toolArgs: {
                    ticker: args.ticker,
                    companyName: args.companyName,
                    formType: args.filingTypes[0] as "10-K" | "10-Q" | "8-K" | "DEF 14A" | "S-1" | "ALL" || "ALL",
                    limit: args.limit,
                },
            }
        );

        if (!routerResult.success || routerResult.usedFallback) {
            console.warn(`[BankingMemo] SEC filing retrieval failed or used fallback`);
            return {
                success: false,
                filings: [],
                artifactIds: [],
            };
        }

        // Extract filings from tool result
        const result = routerResult.result as {
            success: boolean;
            filings: Array<{
                accessionNumber: string;
                filingType: string;
                filedAt: string;
                documentUrl: string;
            }>;
            artifactIds: Id<"sourceArtifacts">[];
        };

        return {
            success: result.success,
            filings: result.filings || [],
            artifactIds: result.artifactIds || [],
        };
    },
});

export const extractFinancialData = internalAction({
    args: {
        filings: v.array(v.object({
            accessionNumber: v.string(),
            filingType: v.string(),
            filedAt: v.string(),
            documentUrl: v.string(),
        })),
        analysisType: v.string(),
    },
    returns: v.object({
        success: v.boolean(),
        data: v.any(),
    }),
    handler: async (ctx, args) => {
        // TODO: Parse XBRL data from filings
        console.log(`[BankingMemo] Extracting financial data from ${args.filings.length} filings`);
        return {
            success: true,
            data: {
                revenue: [],
                netIncome: [],
                assets: [],
                liabilities: [],
            },
        };
    },
});

export const generateMemoContent = internalAction({
    args: {
        companyName: v.string(),
        analysisType: v.string(),
        financialData: v.any(),
        filings: v.array(v.any()),
        depth: v.string(),
    },
    returns: v.object({
        sections: v.array(v.object({
            title: v.string(),
            content: v.string(),
            citations: v.array(v.string()),
        })),
    }),
    handler: async (ctx, args) => {
        // TODO: Call LLM to generate memo content with citations
        console.log(`[BankingMemo] Generating ${args.analysisType} memo for ${args.companyName}`);

        // Template sections based on analysis type
        const sections = getMemoTemplate(args.analysisType, args.companyName);

        return { sections };
    },
});

export const createMemoDocument = internalMutation({
    args: {
        userId: v.id("users"),
        companyName: v.string(),
        analysisType: v.string(),
        sections: v.array(v.object({
            title: v.string(),
            content: v.string(),
            citations: v.array(v.string()),
        })),
        artifactIds: v.array(v.id("sourceArtifacts")),
    },
    returns: v.object({ documentId: v.id("documents") }),
    handler: async (ctx, args) => {
        // Create the memo document
        const now = Date.now();
        const content = args.sections
            .map((s: { title: string; content: string }) => `## ${s.title}\n\n${s.content}`)
            .join("\n\n");

        const documentId = await ctx.db.insert("documents", {
            title: `${args.companyName} - ${formatAnalysisType(args.analysisType)}`,
            content,
            isPublic: false,
            createdBy: args.userId,
            lastModified: now,
            documentType: "text",
            linkedArtifacts: args.artifactIds.map((artifactId: Id<"sourceArtifacts">, index: number) => ({
                artifactId,
                citationKey: `[${index + 1}]`,
                addedAt: now,
                addedBy: args.userId,
            })),
        });

        return { documentId };
    },
});

function getMemoTemplate(analysisType: string, companyName: string): MemoSection[] {
    const templates: Record<string, MemoSection[]> = {
        equity_research: [
            { title: "Executive Summary", content: `Investment thesis for ${companyName}.`, citations: [] },
            { title: "Business Overview", content: "Company description and market position.", citations: [] },
            { title: "Financial Analysis", content: "Revenue trends, profitability, and key metrics.", citations: [] },
            { title: "Valuation", content: "DCF and comparable company analysis.", citations: [] },
            { title: "Risks & Catalysts", content: "Key risks and potential upside drivers.", citations: [] },
        ],
        credit_analysis: [
            { title: "Credit Summary", content: `Credit profile overview for ${companyName}.`, citations: [] },
            { title: "Business Risk", content: "Industry dynamics and competitive position.", citations: [] },
            { title: "Financial Risk", content: "Leverage, coverage ratios, and liquidity.", citations: [] },
            { title: "Covenant Analysis", content: "Existing debt structure and covenants.", citations: [] },
            { title: "Rating Outlook", content: "Expected credit trajectory.", citations: [] },
        ],
        ma_overview: [
            { title: "Deal Summary", content: `M&A overview for ${companyName}.`, citations: [] },
            { title: "Strategic Rationale", content: "Synergy potential and strategic fit.", citations: [] },
            { title: "Valuation Analysis", content: "Transaction multiples and premium analysis.", citations: [] },
            { title: "Financing Considerations", content: "Debt capacity and financing structure.", citations: [] },
        ],
        ipo_analysis: [
            { title: "Offering Summary", content: `IPO analysis for ${companyName}.`, citations: [] },
            { title: "Company Overview", content: "Business model and growth drivers.", citations: [] },
            { title: "Use of Proceeds", content: "Planned allocation of IPO proceeds.", citations: [] },
            { title: "Valuation Range", content: "Comparable analysis and pricing.", citations: [] },
        ],
    };

    return templates[analysisType] ?? templates.equity_research;
}

function formatAnalysisType(type: string): string {
    const labels: Record<string, string> = {
        equity_research: "Equity Research",
        credit_analysis: "Credit Analysis",
        ma_overview: "M&A Overview",
        ipo_analysis: "IPO Analysis",
    };
    return labels[type] ?? type;
}
