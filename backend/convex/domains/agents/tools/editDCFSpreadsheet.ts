/**
 * Agent Tool: Edit DCF Spreadsheet
 *
 * Applies a natural-language instruction to the DCF session linked to a spreadsheet
 * and syncs calculated outputs back into the sheet.
 */

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../_generated/api";

export const editDCFSpreadsheet = createTool({
  description: `Edit a DCF spreadsheet using natural language.

Use when the user says things like:
- "Make it more conservative"
- "Increase Year 1 growth to 15%"
- "Set beta to 1.3"

This updates the linked DCF session, triggers recalculation, and writes updated outputs back to the spreadsheet.`,

  args: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    instruction: z.string().min(1).describe("Natural language instruction"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const res = await ctx.runAction(
        internal.domains.financial.dcfSpreadsheetAdapter.applyDCFSpreadsheetInstruction,
        {
          spreadsheetId: args.spreadsheetId as any,
          instruction: args.instruction,
        },
      );

      const lines: string[] = [];
      lines.push(`✅ Updated DCF assumptions`);
      lines.push(`**Spreadsheet ID:** ${args.spreadsheetId}`);
      lines.push(`**New Fair Value:** $${res.newFairValue.toFixed(2)}`);
      if (res.edits.length) {
        lines.push(`\n**Edits:**`);
        for (const e of res.edits) {
          lines.push(`- ${e.field}: ${String(e.oldValue)} → ${String(e.newValue)} (${e.reasoning})`);
        }
      }
      lines.push(`\nOpen it here: #spreadsheets/${args.spreadsheetId}`);
      return lines.join("\n");
    } catch (error: any) {
      return `❌ Failed to update DCF spreadsheet

**Spreadsheet ID:** ${args.spreadsheetId}
**Error:** ${error?.message ?? String(error)}`;
    }
  },
});
