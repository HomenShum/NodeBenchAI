"use node";

/**
 * PDF Analysis with Gemini
 *
 * Analyzes PDF documents using Gemini's vision capabilities.
 * Used for comparing our PDF output against professional benchmarks.
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { GoogleGenAI } from "@google/genai";

// Get Gemini API key from environment
function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || null;
}

/**
 * Analyze a PDF URL using the current Gemini flash lane
 * Extracts visual structure, layout, and design elements
 */
export const analyzePdfStructure = action({
  args: {
    pdfUrl: v.string(),
    analysisPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    analysis?: string;
    error?: string;
  }> => {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      return { success: false, error: "Gemini API key not configured" };
    }

    try {
      // Download PDF
      console.log(`[pdfAnalysis] Downloading PDF from ${args.pdfUrl}`);
      const response = await fetch(args.pdfUrl);
      if (!response.ok) {
        return { success: false, error: `Failed to download PDF: ${response.status}` };
      }

      const pdfBuffer = await response.arrayBuffer();
      const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
      console.log(`[pdfAnalysis] PDF downloaded, size: ${(pdfBuffer.byteLength / 1024).toFixed(1)} KB`);

      // Initialize Gemini
      const genai = new GoogleGenAI({ apiKey });

      const defaultPrompt = `Analyze this PDF report and extract:

1. PAGE LAYOUT: Grid system, columns, visual hierarchy
2. HEADER: Elements, fonts, colors, branding
3. CHARTS: Types used, color palette, annotations
4. DATA TABLES: Column structure, formatting
5. METRICS: How KPIs are highlighted, trend indicators
6. COMPARISONS: YoY/QoQ elements, historical data
7. FOOTER: Legal text, data sources, dates
8. PROFESSIONAL ELEMENTS: What makes it institutional-grade?

Be specific with colors, fonts, and measurements.`;

      const prompt = args.analysisPrompt || defaultPrompt;

      console.log(`[pdfAnalysis] Sending to Gemini 3.1 Flash Lite Preview...`);

      const result = await genai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: pdfBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          maxOutputTokens: 8000,
          temperature: 0.1,
        },
      });

      const analysis = result.text || "No analysis generated";
      console.log(`[pdfAnalysis] Analysis complete, ${analysis.length} characters`);

      return { success: true, analysis };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[pdfAnalysis] Error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },
});

/**
 * Compare two PDFs using Gemini
 * Identifies differences and gaps between NodeBench and reference reports
 */
export const comparePdfReports = action({
  args: {
    referencePdfUrl: v.string(),
    nodebenchPdfBase64: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    comparison?: string;
    gaps?: string[];
    recommendations?: string[];
    error?: string;
  }> => {
    const apiKey = getGeminiKey();
    if (!apiKey) {
      return { success: false, error: "Gemini API key not configured" };
    }

    try {
      // Download reference PDF
      const response = await fetch(args.referencePdfUrl);
      if (!response.ok) {
        return { success: false, error: `Failed to download reference PDF: ${response.status}` };
      }

      const refPdfBuffer = await response.arrayBuffer();
      const refPdfBase64 = Buffer.from(refPdfBuffer).toString("base64");

      const genai = new GoogleGenAI({ apiKey });

      const prompt = `You are comparing two PDF funding reports:

PDF 1: JPMorgan institutional reference report (professional benchmark)
PDF 2: NodeBench AI generated report (our output)

Analyze both and provide:

## VISUAL COMPARISON
What elements does JPMorgan have that NodeBench is missing?

## GAPS IDENTIFIED
List specific features/elements missing from NodeBench:
- Layout gaps
- Chart/visualization gaps
- Data presentation gaps
- Professional polish gaps

## WHAT NODEBENCH DOES WELL
Elements where NodeBench matches or exceeds JPMorgan quality

## PRIORITY RECOMMENDATIONS
Top 5 changes that would most improve NodeBench's professional appearance

Be specific and actionable.`;

      const result = await genai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: "Reference (JPMorgan):" },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: refPdfBase64,
                },
              },
              { text: "NodeBench AI:" },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: args.nodebenchPdfBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          maxOutputTokens: 8000,
          temperature: 0.1,
        },
      });

      const comparison = result.text || "No comparison generated";

      // Extract gaps and recommendations from the response
      const gapMatch = comparison.match(/## GAPS IDENTIFIED[\s\S]*?(?=##|$)/);
      const recMatch = comparison.match(/## PRIORITY RECOMMENDATIONS[\s\S]*?(?=##|$)/);

      const gaps = gapMatch
        ? gapMatch[0].split("\n").filter(l => l.trim().startsWith("-")).map(l => l.replace(/^-\s*/, "").trim())
        : [];

      const recommendations = recMatch
        ? recMatch[0].split("\n").filter(l => /^\d+\./.test(l.trim())).map(l => l.replace(/^\d+\.\s*/, "").trim())
        : [];

      return {
        success: true,
        comparison,
        gaps,
        recommendations,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
