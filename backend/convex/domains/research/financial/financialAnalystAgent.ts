/**
 * Financial Analyst Agent - LLM-Powered Interface Layer
 *
 * This agent provides conversational access to the deterministic DCF engine.
 *
 * Architecture:
 * - User Input → LLM (understands intent)
 * - LLM → DCF Engine (deterministic calculations)
 * - DCF Results → LLM (natural language explanation)
 *
 * Why this design?
 * - Core calculations remain auditable (no LLM in the math)
 * - User experience is conversational (LLM interface)
 * - Best of both worlds: reliability + usability
 */

import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../agents/mcp_tools/models";

/**
 * Conversational DCF Analysis
 *
 * User can ask in natural language:
 * - "What's Apple worth?"
 * - "Run a DCF on NVDA"
 * - "Is Microsoft overvalued?"
 * - "Compare TSLA vs traditional automakers"
 */
export const analyzeWithConversation = action({
  args: {
    userMessage: v.string(),
    conversationHistory: v.optional(v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }))),
  },
  returns: v.object({
    response: v.string(),
    dcfResults: v.optional(v.any()),
    toolCalls: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const toolCalls: string[] = [];

    // Step 1: LLM understands user intent and decides what tools to call
    const { text: planText } = await generateText({
      model: getLanguageModelSafe("claude-sonnet-4.6"),
      prompt: `You are a financial analyst AI assistant. The user wants financial analysis.

User message: "${args.userMessage}"

Available tools:
1. runDCFAnalysis(ticker, scenario) - Run DCF valuation (deterministic formulas)
2. fetchFinancials(ticker) - Get SEC EDGAR data
3. compareCompanies(tickers[]) - Compare multiple companies
4. explainValuation(ticker) - Explain existing valuation

Based on the user's message, what should you do? Respond with JSON:
{
  "intent": "dcf_analysis" | "fetch_data" | "comparison" | "explanation",
  "ticker": "TICKER" | null,
  "scenario": "base" | "bull" | "bear",
  "explanation": "brief explanation of what you'll do"
}`,
      maxOutputTokens: 300,
    });

    let plan: any;
    try {
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    } catch (e) {
      // Fallback: try to extract ticker from message
      const tickerMatch = args.userMessage.match(/\b([A-Z]{1,5})\b/);
      plan = {
        intent: "dcf_analysis",
        ticker: tickerMatch ? tickerMatch[1] : null,
        scenario: "base",
        explanation: "Running DCF analysis"
      };
    }

    console.log("[Financial Analyst] Intent:", JSON.stringify(plan));

    // Step 2: Execute deterministic calculations (NO LLM)
    let dcfResults: any = null;
    if (plan.intent === "dcf_analysis" && plan.ticker) {
      toolCalls.push(`runDCFAnalysis(${plan.ticker}, ${plan.scenario})`);

      console.log(`[Financial Analyst] Running DCF for ${plan.ticker}...`);
      dcfResults = await ctx.runAction(
        internal.domains.financial.dcfOrchestrator.runDCFEvaluation,
        {
          ticker: plan.ticker,
          scenario: plan.scenario as "base" | "bull" | "bear",
          enableCheckpoints: false,
          forceRefresh: false,
        }
      );
    }

    // Step 3: LLM generates natural language response
    const conversationContext = args.conversationHistory
      ? args.conversationHistory.map(m => `${m.role}: ${m.content}`).join("\n")
      : "";

    const { text: responseText } = await generateText({
      model: getLanguageModelSafe("claude-sonnet-4.6"),
      prompt: `You are a professional financial analyst. Explain DCF results in clear, actionable language.

${conversationContext ? `Previous conversation:\n${conversationContext}\n\n` : ""}User: ${args.userMessage}

${dcfResults ? `
DCF Analysis Results for ${plan.ticker}:
- Fair Value: $${dcfResults.state.calculations?.fairValuePerShare?.toFixed(2)}
- Current Price: $${dcfResults.state.marketData?.currentPrice?.toFixed(2)}
- WACC: ${(dcfResults.state.calculations?.wacc * 100).toFixed(2)}%
- Evaluation Score: ${dcfResults.evaluation.overallScore}/100 (Grade ${dcfResults.evaluation.grade})
- Verdict: ${dcfResults.evaluation.verdict}

Financial Data (FY2024):
- Revenue: $${(dcfResults.state.financialData?.revenue / 1000).toFixed(1)}B
- Free Cash Flow: $${(dcfResults.state.financialData?.freeCashFlow / 1000).toFixed(1)}B
- Gross Margin: ${(dcfResults.state.financialData?.grossMargin * 100).toFixed(1)}%
- Operating Margin: ${(dcfResults.state.financialData?.operatingMargin * 100).toFixed(1)}%
` : "No DCF results available."}

Provide a professional analysis:
1. Summary of findings (2-3 sentences)
2. Key metrics explained
3. Investment recommendation (if applicable)
4. Any caveats or risks

Keep it conversational but professional. Use markdown formatting.`,
      maxOutputTokens: 1000,
    });

    return {
      response: responseText,
      dcfResults: dcfResults ? {
        ticker: plan.ticker,
        fairValue: dcfResults.state.calculations?.fairValuePerShare,
        currentPrice: dcfResults.state.marketData?.currentPrice,
        score: dcfResults.evaluation.overallScore,
        grade: dcfResults.evaluation.grade,
        recommendation: dcfResults.report.executive.recommendation,
      } : undefined,
      toolCalls,
    };
  },
});

/**
 * Multi-turn conversation with memory
 */
export const chatWithAnalyst = action({
  args: {
    message: v.string(),
    sessionId: v.string(),
  },
  returns: v.object({
    response: v.string(),
    suggestedActions: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    // TODO: Fetch conversation history from database using sessionId

    const result = await ctx.runAction(
      internal.domains.financial.financialAnalystAgent.analyzeWithConversation,
      {
        userMessage: args.message,
        conversationHistory: [], // Would fetch from DB
      }
    );

    // TODO: Store conversation in database

    return {
      response: result.response,
      suggestedActions: result.dcfResults ? [
        "View full report",
        "Run sensitivity analysis",
        "Compare with peers",
        `Analyze in ${result.dcfResults.recommendation === "STRONG BUY" ? "bear" : "bull"} case`,
      ] : undefined,
    };
  },
});

/**
 * Agentic workflow: Multi-company comparison
 */
export const compareCompaniesAgentically = action({
  args: {
    tickers: v.array(v.string()),
    userQuestion: v.string(),
  },
  returns: v.object({
    analysis: v.string(),
    rankings: v.array(v.object({
      ticker: v.string(),
      fairValue: v.number(),
      score: v.number(),
      recommendation: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    console.log(`[Agentic Comparison] Analyzing ${args.tickers.join(", ")}...`);

    // Step 1: Run deterministic DCF for each company (parallel)
    const dcfPromises = args.tickers.map(ticker =>
      ctx.runAction(
        internal.domains.financial.dcfOrchestrator.runDCFEvaluation,
        { ticker, scenario: "base", enableCheckpoints: false, forceRefresh: false }
      ).catch(err => {
        console.error(`[Agentic Comparison] Failed for ${ticker}:`, err.message);
        return null;
      })
    );

    const results = await Promise.all(dcfPromises);

    // Step 2: Extract key metrics
    const rankings = results
      .filter(r => r !== null)
      .map((r: any) => ({
        ticker: r.state.ticker,
        fairValue: r.state.calculations?.fairValuePerShare || 0,
        currentPrice: r.state.marketData?.currentPrice || 0,
        score: r.evaluation.overallScore,
        recommendation: r.report.executive.recommendation,
        upside: parseFloat(r.report.executive.upside.replace("%", "")),
      }))
      .sort((a, b) => b.upside - a.upside); // Sort by upside potential

    // Step 3: LLM synthesizes comparative analysis
    const { text: analysisText } = await generateText({
      model: getLanguageModelSafe("claude-sonnet-4.6"),
      prompt: `You are comparing ${args.tickers.length} companies based on DCF analysis.

User question: "${args.userQuestion}"

DCF Results:
${rankings.map((r, i) => `
${i + 1}. ${r.ticker}
   - Fair Value: $${r.fairValue.toFixed(2)}
   - Current Price: $${r.currentPrice.toFixed(2)}
   - Upside/Downside: ${r.upside.toFixed(1)}%
   - DCF Score: ${r.score}/100
   - Recommendation: ${r.recommendation}
`).join("\n")}

Provide a comparative analysis:
1. Which company offers the best value? Why?
2. Key differentiators in fundamentals
3. Risk considerations for each
4. Final recommendation for portfolio allocation

Use markdown formatting. Be specific and cite the numbers.`,
      maxOutputTokens: 1500,
    });

    return {
      analysis: analysisText,
      rankings: rankings.map(r => ({
        ticker: r.ticker,
        fairValue: r.fairValue,
        score: r.score,
        recommendation: r.recommendation,
      })),
    };
  },
});

/**
 * Export for testing
 */
export const testFinancialAnalystAgent = action({
  args: {
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("\n========================================");
    console.log("FINANCIAL ANALYST AGENT TEST");
    console.log("========================================\n");

    const testMessage = args.message || "What's NVDA worth? Is it overvalued?";

    const result = await ctx.runAction(
      internal.domains.financial.financialAnalystAgent.analyzeWithConversation,
      {
        userMessage: testMessage,
        conversationHistory: [],
      }
    );

    console.log("\n✅ AGENT RESPONSE:\n");
    console.log(result.response);
    console.log("\n\nTool Calls:", result.toolCalls);

    if (result.dcfResults) {
      console.log("\n\nQuick Stats:");
      console.log(`- Fair Value: $${result.dcfResults.fairValue?.toFixed(2)}`);
      console.log(`- Current Price: $${result.dcfResults.currentPrice?.toFixed(2)}`);
      console.log(`- Score: ${result.dcfResults.score}/100 (${result.dcfResults.grade})`);
      console.log(`- Recommendation: ${result.dcfResults.recommendation}`);
    }

    return result;
  },
});
