/**
 * Run JPMorgan PDF Analysis via Convex
 *
 * Uses the pdfAnalysis Convex action to analyze the JPMorgan report.
 * Run: npx tsx scripts/run-jpm-analysis.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVEX_URL = process.env.CONVEX_URL || "https://focused-weasel-827.convex.cloud";
const JPM_PDF_URL = "https://www.jpmorgan.com/content/dam/jpmorgan/documents/cb/insights/outlook/jpm-biopharma-deck-q4-2025.pdf";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🔍 JPMorgan PDF Analysis via Convex + Gemini 2.0 Flash");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Calling Convex action: analyzePdfStructure...\n");

  try {
    const result = await client.action(api.domains.documents.pdfAnalysis.analyzePdfStructure, {
      pdfUrl: JPM_PDF_URL,
      analysisPrompt: `Analyze this JPMorgan Q4 2025 Biopharma funding report.

Extract the EXACT visual structure that makes this report professional:

## 1. PAGE LAYOUT
- Grid system (columns, rows)
- Visual hierarchy and eye flow
- Section organization

## 2. HEADER DESIGN
- Title fonts and sizes
- Subtitle styling
- Date/source placement
- Brand elements

## 3. CHARTS & VISUALIZATIONS
- List all chart types (bar, line, pie, combo, etc.)
- Color palette used (list hex codes if visible)
- Axis labels and formatting
- Annotations and callouts
- Chart titles styling

## 4. DATA PRESENTATION
- Table column structures
- Amount formatting ($M, $B)
- Deal/transaction listing format
- Metadata shown per entry

## 5. METRICS & KPIs
- How key numbers are highlighted
- Trend indicators (arrows, colors, %)
- Comparison elements (YoY, QoQ)

## 6. UNIQUE PROFESSIONAL ELEMENTS
- What makes this look "institutional grade"?
- Key differentiators from basic reports
- Must-have elements for credibility

Be VERY specific with colors, fonts, spacing, and layout.`,
    });

    if (result.success && result.analysis) {
      console.log(result.analysis);

      // Save to file
      const outputDir = path.join(__dirname, "../output");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputPath = path.join(outputDir, "jpm-analysis.md");
      fs.writeFileSync(outputPath, `# JPMorgan Q4 2025 Biopharma Report Analysis\n\n${result.analysis}`);
      console.log(`\n✅ Analysis saved to ${outputPath}`);
    } else {
      console.error("Analysis failed:", result.error);
    }
  } catch (error) {
    console.error("Error calling Convex:", error);
  }
}

main().catch(console.error);
