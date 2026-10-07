/**
 * Interactive DCF Session - Real-time Collaborative Editing
 *
 * Enables:
 * 1. Agent can propose edits to DCF parameters
 * 2. User can edit spreadsheet cells
 * 3. Instant recalculation on any change
 * 4. Real-time UI updates
 * 5. Undo/redo history
 * 6. Conversational parameter tweaking
 *
 * Example workflows:
 * - "Change NVDA's growth rate to 15% for next year"
 * - "Make terminal growth more conservative"
 * - "What if WACC was 12% instead?"
 * - User clicks cell, types new value → instant recalc
 */

import { action, internalMutation, mutation, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../agents/mcp_tools/models";
import {
  getParameterAtPath,
  normalizeDCFParameterValue,
  setParameterAtPath,
} from "./dcfSpreadsheetMapping";

/**
 * DCF Session State (stored in database)
 */
const sessionSchema = {
  sessionId: v.string(),
  userId: v.string(),
  ticker: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),

  // Editable parameters
  parameters: v.object({
    // Revenue assumptions
    baseRevenue: v.number(),
    revenueGrowthRates: v.array(v.number()), // [Y1, Y2, Y3, Y4, Y5]
    terminalGrowth: v.number(),

    // Operating assumptions
    grossMargin: v.array(v.number()),
    operatingMargin: v.array(v.number()),

    // WACC components
    riskFreeRate: v.number(),
    beta: v.number(),
    marketRiskPremium: v.number(),
    costOfDebt: v.number(),
    taxRate: v.number(),
    debtWeight: v.number(),

    // Other
    baseFCF: v.number(),
    sharesOutstanding: v.number(),
    netDebt: v.number(),
  }),

  // Calculated results (auto-updates on parameter change)
  results: v.object({
    wacc: v.number(),
    fcfProjections: v.array(v.object({
      year: v.number(),
      fcf: v.number(),
      growthRate: v.number(),
    })),
    terminalValue: v.number(),
    enterpriseValue: v.number(),
    equityValue: v.number(),
    fairValuePerShare: v.number(),
    evaluationScore: v.number(),
  }),

  // Edit history for undo/redo
  history: v.array(v.object({
    timestamp: v.number(),
    field: v.string(),
    oldValue: v.any(),
    newValue: v.any(),
    triggeredBy: v.union(v.literal("user"), v.literal("agent")),
  })),
};

/**
 * Internal mutation to update session results
 */
export const updateSessionResults = internalMutation({
  args: {
    sessionId: v.string(),
    results: v.any(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) throw new Error("Session not found");

    await ctx.db.patch(session._id, {
      results: args.results,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal mutation to insert DCF session
 */
export const insertSession = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.optional(v.id("users")),
    ticker: v.string(),
    parameters: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("dcfSessions", {
      sessionId: args.sessionId,
      userId: args.userId,
      ticker: args.ticker,
      createdAt: Date.now(),
      updatedAt: Date.now(),

      parameters: args.parameters,

      results: {
        wacc: 0,
        fcfProjections: [],
        terminalValue: 0,
        enterpriseValue: 0,
        equityValue: 0,
        fairValuePerShare: 0,
        evaluationScore: 0,
      },

      history: [],
    });
  },
});

/**
 * Create new interactive DCF session
 */
export const createSession = action({
  args: {
    ticker: v.string(),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    sessionId: v.string(),
  }),
  handler: async (ctx, args) => {
    // Fetch initial data from SEC EDGAR
    const financialData = await ctx.runAction(
      internal.domains.financial.groundTruthFetcher.fetchGroundTruthFinancials,
      { ticker: args.ticker, fiscalYear: 2024, forceRefresh: false }
    );

    // Use default market data if fetcher doesn't exist
    const marketData = { beta: 1.05 };

    const balanceData = await ctx.runAction(
      internal.domains.financial.balanceSheetFetcher.fetchBalanceSheetData,
      { ticker: args.ticker }
    );

    // Initialize with default parameters
    const sessionId = `session-${args.ticker}-${Date.now()}`;

    await ctx.runMutation(
      internal.domains.financial.interactiveDCFSession.insertSession,
      {
        sessionId,
        userId: args.userId,
        ticker: args.ticker,
        parameters: {
          baseRevenue: financialData.revenue,
          revenueGrowthRates: [0.10, 0.08, 0.06, 0.05, 0.04],
          terminalGrowth: 0.03,

          grossMargin: [0.727, 0.727, 0.727, 0.727, 0.727],
          operatingMargin: [0.541, 0.541, 0.541, 0.541, 0.541],

          riskFreeRate: 0.042,
          beta: marketData.beta || 1.0,
          marketRiskPremium: 0.075,
          costOfDebt: 0.062,
          taxRate: 0.21,
          debtWeight: 0.2,

          baseFCF: financialData.freeCashFlow,
          sharesOutstanding: balanceData.sharesOutstanding,
          netDebt: balanceData.netDebt,
        },
      }
    );

    // Trigger initial calculation
    await ctx.runAction(
      internal.domains.financial.interactiveDCFSession.recalculateSession,
      { sessionId }
    );

    return { sessionId };
  },
});

/**
 * Update a parameter (user edit or agent edit)
 */
export const updateParameter = mutation({
  args: {
    sessionId: v.string(),
    field: v.string(), // "revenueGrowthRates[0]", "beta", "terminalGrowth"
    newValue: v.any(),
    triggeredBy: v.union(v.literal("user"), v.literal("agent")),
  },
  returns: v.object({
    success: v.boolean(),
    needsRecalc: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) throw new Error("Session not found");

    // Normalize value (e.g., treat "4.2" as 4.2% for rate fields)
    const normalizedValue = normalizeDCFParameterValue(args.field, args.newValue);

    // Get old value for history (supports array paths)
    const oldValue = getParameterAtPath(session.parameters as any, args.field);

    // Update parameter (supports array paths)
    const updatedParams = setParameterAtPath(session.parameters as any, args.field, normalizedValue);

    // Add to history
    const updatedHistory = [
      ...session.history,
      {
        timestamp: Date.now(),
        field: args.field,
        oldValue,
        newValue: normalizedValue,
        triggeredBy: args.triggeredBy,
      },
    ];

    // Update database
    await ctx.db.patch(session._id, {
      parameters: updatedParams,
      history: updatedHistory,
      updatedAt: Date.now(),
    });

    // Trigger recalculation (and update linked spreadsheet, if any)
    await ctx.scheduler.runAfter(0,
      internal.domains.financial.interactiveDCFSession.recalculateSession,
      { sessionId: args.sessionId }
    );

    if (session.spreadsheetId) {
      await ctx.scheduler.runAfter(100,
        internal.domains.financial.dcfSpreadsheetAdapter.syncDCFToSpreadsheet,
        { sessionId: args.sessionId, spreadsheetId: session.spreadsheetId }
      );
    }

    return {
      success: true,
      needsRecalc: true,
    };
  },
});

/**
 * Recalculate all results based on current parameters
 */
export const recalculateSession = action({
  args: {
    sessionId: v.string(),
  },
  returns: v.object({
    fairValue: v.number(),
    calculationTime: v.number(),
  }),
  handler: async (ctx, args) => {
    const startTime = Date.now();

    const session = await ctx.runQuery(
      internal.domains.financial.interactiveDCFSession.getSession,
      { sessionId: args.sessionId }
    );

    if (!session) throw new Error("Session not found");

    const params = session.parameters;

    // Calculate WACC
    const costOfEquity = params.riskFreeRate + params.beta * params.marketRiskPremium;
    const wacc = (costOfEquity * (1 - params.debtWeight)) +
                 (params.costOfDebt * (1 - params.taxRate) * params.debtWeight);

    // Project FCF for 5 years
    let currentFCF = params.baseFCF;
    const fcfProjections = params.revenueGrowthRates.map((growthRate, i) => {
      currentFCF = currentFCF * (1 + growthRate);
      return {
        year: 2025 + i,
        fcf: currentFCF,
        growthRate,
      };
    });

    // Calculate terminal value
    const finalFCF = fcfProjections[fcfProjections.length - 1].fcf;
    const terminalFCF = finalFCF * (1 + params.terminalGrowth);
    const terminalValue = terminalFCF / (wacc - params.terminalGrowth);

    // Calculate present values
    let pvOfFCF = 0;
    fcfProjections.forEach((proj, i) => {
      pvOfFCF += proj.fcf / Math.pow(1 + wacc, i + 1);
    });

    const pvOfTerminal = terminalValue / Math.pow(1 + wacc, fcfProjections.length);
    const enterpriseValue = pvOfFCF + pvOfTerminal;
    const equityValue = enterpriseValue - params.netDebt;
    const fairValuePerShare = equityValue / (params.sharesOutstanding / 1000000);

    // Run evaluation
    const groundTruth = await ctx.runQuery(
      internal.domains.financial.groundTruthManager.getGroundTruth,
      { ticker: session.ticker }
    );

    let evaluationScore = 85; // Default if no ground truth
    if (groundTruth) {
      const diff = Math.abs(fairValuePerShare - groundTruth.fairValuePerShare);
      const diffPercent = (diff / groundTruth.fairValuePerShare) * 100;
      evaluationScore = diffPercent <= 2 ? 100 :
                       diffPercent <= 5 ? 95 :
                       diffPercent <= 10 ? 85 : 70;
    }

    // Update results in database
    await ctx.runMutation(
      internal.domains.financial.interactiveDCFSession.updateSessionResults,
      {
        sessionId: args.sessionId,
        results: {
          wacc,
          fcfProjections,
          terminalValue,
          enterpriseValue,
          equityValue,
          fairValuePerShare,
          evaluationScore,
        },
      }
    );

    return {
      fairValue: fairValuePerShare,
      calculationTime: Date.now() - startTime,
    };
  },
});

/**
 * Agent-driven parameter editing via natural language
 */
export const agentEditParameters = action({
  args: {
    sessionId: v.string(),
    userInstruction: v.string(), // "Make it more conservative" or "Increase Y1 growth to 15%"
  },
  returns: v.object({
    edits: v.array(v.object({
      field: v.string(),
      oldValue: v.any(),
      newValue: v.any(),
      reasoning: v.string(),
    })),
    newFairValue: v.number(),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(
      internal.domains.financial.interactiveDCFSession.getSession,
      { sessionId: args.sessionId }
    );

    if (!session) throw new Error("Session not found");

    const proposeEditsFallback = (): Array<{ field: string; newValue: number; reasoning: string }> => {
      const instruction = args.userInstruction.toLowerCase();
      const edits: Array<{ field: string; newValue: number; reasoning: string }> = [];

      const matchYearGrowth = instruction.match(/year\\s*(\\d)\\s*growth[^0-9]*([0-9]+(?:\\.[0-9]+)?)\\s*%?/i);
      if (matchYearGrowth) {
        const year = Number.parseInt(matchYearGrowth[1], 10);
        const pct = Number.parseFloat(matchYearGrowth[2]);
        if (Number.isFinite(year) && year >= 1 && year <= 5 && Number.isFinite(pct)) {
          edits.push({
            field: `revenueGrowthRates[${year - 1}]`,
            newValue: pct / 100,
            reasoning: `Set Year ${year} growth to ${pct}% as requested.`,
          });
        }
      }

      const matchBeta = instruction.match(/\\bbeta\\b[^0-9]*([0-9]+(?:\\.[0-9]+)?)/i);
      if (matchBeta) {
        const beta = Number.parseFloat(matchBeta[1]);
        if (Number.isFinite(beta)) {
          edits.push({ field: "beta", newValue: beta, reasoning: `Set beta to ${beta}.` });
        }
      }

      const matchTerminal = instruction.match(/terminal\\s*growth[^0-9]*([0-9]+(?:\\.[0-9]+)?)\\s*%?/i);
      if (matchTerminal) {
        const pct = Number.parseFloat(matchTerminal[1]);
        if (Number.isFinite(pct)) {
          edits.push({ field: "terminalGrowth", newValue: pct / 100, reasoning: `Set terminal growth to ${pct}%.` });
        }
      }

      const matchRf = instruction.match(/risk[-\\s]?free[^0-9]*([0-9]+(?:\\.[0-9]+)?)\\s*%?/i);
      if (matchRf) {
        const pct = Number.parseFloat(matchRf[1]);
        if (Number.isFinite(pct)) {
          edits.push({ field: "riskFreeRate", newValue: pct / 100, reasoning: `Set risk-free rate to ${pct}%.` });
        }
      }

      const matchMrp = instruction.match(/market\\s*risk\\s*premium[^0-9]*([0-9]+(?:\\.[0-9]+)?)\\s*%?/i);
      if (matchMrp) {
        const pct = Number.parseFloat(matchMrp[1]);
        if (Number.isFinite(pct)) {
          edits.push({ field: "marketRiskPremium", newValue: pct / 100, reasoning: `Set market risk premium to ${pct}%.` });
        }
      }

      if (edits.length > 0) return edits.slice(0, 3);

      const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
      const isConservative = instruction.includes("conservative") || instruction.includes("more conservative");
      const isAggressive = instruction.includes("aggressive") || instruction.includes("optimistic") || instruction.includes("bull");

      if (isConservative) {
        edits.push({
          field: "terminalGrowth",
          newValue: clamp(session.parameters.terminalGrowth - 0.005, 0.01, 0.05),
          reasoning: "Lower terminal growth to be more conservative.",
        });
        edits.push({
          field: "beta",
          newValue: clamp(session.parameters.beta + 0.1, 0.6, 3.0),
          reasoning: "Increase beta slightly to reflect higher risk (more conservative discount rate).",
        });
        edits.push({
          field: "revenueGrowthRates[0]",
          newValue: clamp(session.parameters.revenueGrowthRates[0] - 0.02, 0.0, 0.5),
          reasoning: "Reduce Year 1 growth to be more conservative.",
        });
        return edits.slice(0, 3);
      }

      if (isAggressive) {
        edits.push({
          field: "terminalGrowth",
          newValue: clamp(session.parameters.terminalGrowth + 0.005, 0.01, 0.06),
          reasoning: "Increase terminal growth to be more optimistic.",
        });
        edits.push({
          field: "beta",
          newValue: clamp(session.parameters.beta - 0.1, 0.6, 3.0),
          reasoning: "Reduce beta slightly to reflect lower perceived risk.",
        });
        edits.push({
          field: "revenueGrowthRates[0]",
          newValue: clamp(session.parameters.revenueGrowthRates[0] + 0.02, 0.0, 0.5),
          reasoning: "Increase Year 1 growth to be more optimistic.",
        });
        return edits.slice(0, 3);
      }

      return [];
    };

    // LLM understands instruction and proposes edits (fallback to deterministic parsing)
    let proposalText: string | null = null;
    try {
      const res = await generateText({
      model: getLanguageModelSafe("claude-sonnet-4.6"),
        prompt: `You are a financial analyst helping edit a DCF model for ${session.ticker}.

Current Parameters:
- Revenue Growth Rates (5yr): ${session.parameters.revenueGrowthRates.map(r => `${(r*100).toFixed(1)}%`).join(", ")}
- Terminal Growth: ${(session.parameters.terminalGrowth * 100).toFixed(1)}%
- Beta: ${session.parameters.beta.toFixed(2)}
- WACC: ${(session.results.wacc * 100).toFixed(2)}%

Current Fair Value: $${session.results.fairValuePerShare.toFixed(2)}

User instruction: "${args.userInstruction}"

Propose specific edits. Respond with JSON array:
[
  {
    "field": "revenueGrowthRates[0]" | "beta" | "terminalGrowth" | etc,
    "newValue": number,
    "reasoning": "brief explanation"
  }
]

Guidelines:
- "Conservative" means: lower growth rates, higher WACC, lower terminal growth
- "Aggressive" means: higher growth rates, lower WACC, higher terminal growth
- Make realistic changes (don't 10x anything)
- Only propose 1-3 edits per instruction`,
        maxOutputTokens: 500,
      });
      proposalText = res.text;
    } catch (e) {
      proposalText = null;
    }

    let edits: any[];
    try {
      if (!proposalText) throw new Error("No proposal text");
      const jsonMatch = proposalText.match(/\[[\s\S]*\]/);
      edits = JSON.parse(jsonMatch ? jsonMatch[0] : "[]");
    } catch (e) {
      edits = proposeEditsFallback();
    }

    // Apply edits
    const appliedEdits: Array<{field: any; oldValue: any; newValue: any; reasoning: any}> = [];
    for (const edit of edits) {
      const oldValue = getParameterAtPath(session.parameters as any, edit.field);
      const normalizedValue = normalizeDCFParameterValue(edit.field, edit.newValue);

      await ctx.runMutation(
        internal.domains.financial.interactiveDCFSession.updateParameter,
        {
          sessionId: args.sessionId,
          field: edit.field,
          newValue: normalizedValue,
          triggeredBy: "agent",
        }
      );

      appliedEdits.push({
        field: edit.field,
        oldValue,
        newValue: normalizedValue,
        reasoning: edit.reasoning,
      });
    }

    // Get new results
    const updatedSession = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    return {
      edits: appliedEdits,
      newFairValue: updatedSession!.results.fairValuePerShare,
    };
  },
});

/**
 * Undo last edit
 */
export const undoEdit = mutation({
  args: {
    sessionId: v.string(),
  },
  returns: v.object({
    undone: v.object({
      field: v.string(),
      restoredValue: v.any(),
    }),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session || session.history.length === 0) {
      throw new Error("Nothing to undo");
    }

    // Get last edit
    const lastEdit = session.history[session.history.length - 1];

    // Restore old value
    const updatedParams = { ...session.parameters };
    const fieldParts = lastEdit.field.match(/^([a-zA-Z]+)(?:\[(\d+)\])?$/);
    if (!fieldParts) throw new Error("Invalid field path");

    const baseField = fieldParts[1];
    const arrayIndex = fieldParts[2] ? parseInt(fieldParts[2]) : null;

    if (arrayIndex !== null) {
      const array = [...(updatedParams as any)[baseField]];
      array[arrayIndex] = lastEdit.oldValue;
      (updatedParams as any)[baseField] = array;
    } else {
      (updatedParams as any)[baseField] = lastEdit.oldValue;
    }

    // Remove from history
    const updatedHistory = session.history.slice(0, -1);

    await ctx.db.patch(session._id, {
      parameters: updatedParams,
      history: updatedHistory,
      updatedAt: Date.now(),
    });

    // Trigger recalc
    await ctx.runAction(
      internal.domains.financial.interactiveDCFSession.recalculateSession,
      { sessionId: args.sessionId }
    );

    return {
      undone: {
        field: lastEdit.field,
        restoredValue: lastEdit.oldValue,
      },
    };
  },
});

/**
 * Get session for UI rendering
 */
export const getSession = query({
  args: {
    sessionId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    return session;
  },
});

/**
 * Export session as spreadsheet (Excel/Google Sheets compatible)
 */
export const exportToSpreadsheet = action({
  args: {
    sessionId: v.string(),
    format: v.union(v.literal("xlsx"), v.literal("csv")),
  },
  returns: v.object({
    downloadUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    // TODO: Generate Excel/CSV file
    // For now, return structured data
    const session = await ctx.runQuery(
      internal.domains.financial.interactiveDCFSession.getSession,
      { sessionId: args.sessionId }
    );

    if (!session) throw new Error("Session not found");

    // Would generate actual file here
    return {
      downloadUrl: `/api/download/${args.sessionId}.${args.format}`,
    };
  },
});
