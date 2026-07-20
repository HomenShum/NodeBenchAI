/**
 * Agent Tool: Create DCF Spreadsheet
 *
 * Creates an interactive DCF valuation model as a spreadsheet.
 *
 * Flow:
 * 1. User: "Build a DCF model for NVIDIA"
 * 2. Agent calls this tool
 * 3. Creates DCF session + generates spreadsheet
 * 4. Returns link to open spreadsheet
 */

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../_generated/api";

export const createDCFSpreadsheet = createTool({
  description: `Create an interactive DCF (Discounted Cash Flow) valuation model for a company.

The model will:
- Fetch latest financial data from SEC EDGAR
- Initialize with default assumptions (growth rates, WACC, terminal value)
- Create an editable spreadsheet with inputs and calculated outputs
- Support real-time recalculation when parameters change
- Allow natural language editing ("make it more conservative")

Use this when the user wants to:
- Value a company
- Build a financial model
- Analyze fair value vs market price
- Run scenario analysis (bull/base/bear)`,

  args: z.object({
    ticker: z
      .string()
      .min(1)
      .max(10)
      .describe("Stock ticker symbol (e.g., NVDA, TSLA, AAPL)"),

    scenario: z
      .enum(["bull", "base", "bear"])
      .default("base")
      .describe("Scenario type: bull (optimistic), base (neutral), bear (pessimistic)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // 1. Create DCF session (works for both authenticated and guest users)
      const { sessionId } = await ctx.runAction(
        internal.domains.financial.interactiveDCFSession.createSession,
        {
          ticker: args.ticker.toUpperCase(),
          userId: ctx.userId ? (ctx.userId as any) : undefined,
        },
      );

      // 2. Generate spreadsheet from session
      const { spreadsheetId, cellsCreated } = await ctx.runAction(
        internal.domains.financial.dcfSpreadsheetAdapter.generateSpreadsheetFromDCF,
        { sessionId },
      );

      // 3. Return success message with link
      return `✅ Created DCF model for ${args.ticker.toUpperCase()}

**DCF Session ID:** ${sessionId}
**Spreadsheet ID:** ${spreadsheetId}
**Cells:** ${cellsCreated} populated
**Scenario:** ${args.scenario}

**What's inside:**
- Revenue projections (5-year forecast)
- WACC calculation (risk-free rate, beta, market premium)
- Terminal value (perpetuity growth)
- Enterprise value and fair value per share
- Evaluation score (vs ground truth)

**You can:**
- Edit growth rates, Beta, or other inputs → instant recalculation
- Ask me to "make it more conservative" or "increase Year 1 growth to 15%"
- Export to Excel/PDF

Open it here: #spreadsheets/${spreadsheetId}`;
    } catch (error: any) {
      return `❌ Failed to create DCF model for ${args.ticker}

**Error:** ${error.message}

**Possible causes:**
- Ticker not found (try a different symbol)
- SEC data not available
- Network error

Try again with a valid US public company ticker.`;
    }
  },
});

