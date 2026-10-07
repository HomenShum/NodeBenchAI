/**
 * Weekly Digest Template
 *
 * JPMorgan-style weekly intelligence digest PDF template.
 * Includes What/So What/Now What reflection framework.
 */

import type { Template } from "@pdfme/common";
import type { WeeklyDigestData } from "../types";
import { COLORS, FONTS } from "./quarterlyFundingTemplate";

// Page dimensions (A4 in mm)
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

/**
 * Base template schema for weekly digest.
 */
export const weeklyDigestBaseTemplate: Template = {
  basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
  schemas: [
    [
      // Header
      {
        name: "reportTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN },
        width: CONTENT_WIDTH,
        height: 12,
        fontSize: 24,
        fontColor: COLORS.primary,
        alignment: "left",
        fontName: "Helvetica-Bold",
      },
      {
        name: "weekLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 14 },
        width: CONTENT_WIDTH / 2,
        height: 6,
        fontSize: 12,
        fontColor: COLORS.secondary,
      },
      {
        name: "personaLabel",
        type: "text",
        position: { x: PAGE_WIDTH / 2, y: MARGIN + 14 },
        width: CONTENT_WIDTH / 2 - MARGIN,
        height: 6,
        fontSize: 10,
        fontColor: COLORS.accent,
        alignment: "right",
      },
      {
        name: "generatedAt",
        type: "text",
        position: { x: PAGE_WIDTH / 2, y: MARGIN + 22 },
        width: CONTENT_WIDTH / 2 - MARGIN,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.textLight,
        alignment: "right",
      },
      // Divider
      {
        name: "headerDivider",
        type: "line",
        position: { x: MARGIN, y: MARGIN + 30 },
        width: CONTENT_WIDTH,
        height: 2,
        color: COLORS.primary,
      },

      // ═══════════════════════════════════════════════════════════════════
      // EXECUTIVE SUMMARY
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "summaryTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 38 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "executiveSummary",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 47 },
        width: CONTENT_WIDTH,
        height: 25,
        fontSize: 10,
        fontColor: COLORS.text,
        lineHeight: 1.5,
      },

      // ═══════════════════════════════════════════════════════════════════
      // TOP STORIES
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "topStoriesTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 76 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      // Story 1
      {
        name: "story1_headline",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 86 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 10,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      {
        name: "story1_summary",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 92 },
        width: CONTENT_WIDTH,
        height: 10,
        fontSize: 8,
        fontColor: COLORS.textLight,
        lineHeight: 1.3,
      },
      // Story 2
      {
        name: "story2_headline",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 105 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 10,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      {
        name: "story2_summary",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 111 },
        width: CONTENT_WIDTH,
        height: 10,
        fontSize: 8,
        fontColor: COLORS.textLight,
        lineHeight: 1.3,
      },
      // Story 3
      {
        name: "story3_headline",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 124 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 10,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      {
        name: "story3_summary",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 130 },
        width: CONTENT_WIDTH,
        height: 10,
        fontSize: 8,
        fontColor: COLORS.textLight,
        lineHeight: 1.3,
      },

      // ═══════════════════════════════════════════════════════════════════
      // FUNDING HIGHLIGHTS
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "fundingTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 145 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "fundingStats",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 154 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 10,
        fontColor: COLORS.text,
      },
      // Top deals mini-table
      {
        name: "topDealsHeader",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 162 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      ...generateTopDealRows(5, MARGIN + 168),

      // ═══════════════════════════════════════════════════════════════════
      // SECTOR TRENDS
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "sectorTrendsTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 210 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "sectorTrends",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 219 },
        width: CONTENT_WIDTH,
        height: 22,
        fontSize: 9,
        fontColor: COLORS.text,
        lineHeight: 1.4,
      },

      // ═══════════════════════════════════════════════════════════════════
      // WHAT? / SO WHAT? / NOW WHAT?
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "reflectionTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 245 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 12,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "whatLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 254 },
        width: 25,
        height: 4,
        fontSize: 9,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "whatValue",
        type: "text",
        position: { x: MARGIN + 27, y: MARGIN + 254 },
        width: CONTENT_WIDTH - 27,
        height: 8,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.2,
      },
      {
        name: "soWhatLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 263 },
        width: 30,
        height: 4,
        fontSize: 9,
        fontColor: COLORS.accent,
        fontName: "Helvetica-Bold",
      },
      {
        name: "soWhatValue",
        type: "text",
        position: { x: MARGIN + 32, y: MARGIN + 263 },
        width: CONTENT_WIDTH - 32,
        height: 8,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.2,
      },
      {
        name: "nowWhatLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 272 },
        width: 35,
        height: 4,
        fontSize: 9,
        fontColor: COLORS.positive,
        fontName: "Helvetica-Bold",
      },
      {
        name: "nowWhatValue",
        type: "text",
        position: { x: MARGIN + 37, y: MARGIN + 272 },
        width: CONTENT_WIDTH - 37,
        height: 8,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.2,
      },

      // Footer
      {
        name: "footerText",
        type: "text",
        position: { x: MARGIN, y: PAGE_HEIGHT - 10 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: 7,
        fontColor: COLORS.textLight,
        alignment: "center",
      },
    ],
  ],
};

/**
 * Generate schema definitions for top deals rows.
 */
function generateTopDealRows(rowCount: number, startY: number): any[] {
  const schemas: any[] = [];
  const ROW_HEIGHT = 8;

  for (let i = 0; i < rowCount; i++) {
    const y = startY + i * ROW_HEIGHT;
    const bgColor = i % 2 === 0 ? "#ffffff" : "#f7fafc";

    schemas.push({
      name: `topDeal${i}`,
      type: "text",
      position: { x: MARGIN, y },
      width: CONTENT_WIDTH,
      height: ROW_HEIGHT - 1,
      fontSize: 8,
      fontColor: COLORS.text,
      backgroundColor: bgColor,
    });
  }

  return schemas;
}

/**
 * Transform weekly digest data into template inputs.
 */
export function transformDigestDataToInputs(
  data: WeeklyDigestData
): Record<string, string> {
  const inputs: Record<string, string> = {
    reportTitle: "WEEKLY INTELLIGENCE DIGEST",
    weekLabel: data.weekLabel,
    personaLabel: `Persona: ${formatPersona(data.persona)}`,
    generatedAt: `Generated: ${data.generatedAt}`,

    // Executive Summary
    summaryTitle: "EXECUTIVE SUMMARY",
    executiveSummary: data.executiveSummary,

    // Top Stories
    topStoriesTitle: "TOP STORIES",
    story1_headline: data.topStories[0]?.headline || "",
    story1_summary: data.topStories[0]?.summary || "",
    story2_headline: data.topStories[1]?.headline || "",
    story2_summary: data.topStories[1]?.summary || "",
    story3_headline: data.topStories[2]?.headline || "",
    story3_summary: data.topStories[2]?.summary || "",

    // Funding Highlights
    fundingTitle: "FUNDING HIGHLIGHTS",
    fundingStats: `${data.fundingHighlights.totalDeals} deals totaling ${formatCurrency(data.fundingHighlights.totalAmountUsd)}`,
    topDealsHeader: "Company | Round | Amount | Lead Investors",

    // Sector Trends
    sectorTrendsTitle: "SECTOR TRENDS",
    sectorTrends: formatSectorTrends(data.sectorTrends),

    // Reflection Framework
    reflectionTitle: "WHAT? / SO WHAT? / NOW WHAT?",
    whatLabel: "WHAT?",
    whatValue: data.reflection?.what || "Analysis pending...",
    soWhatLabel: "SO WHAT?",
    soWhatValue: data.reflection?.soWhat || "Implications pending...",
    nowWhatLabel: "NOW WHAT?",
    nowWhatValue: data.reflection?.nowWhat || "Action items pending...",

    footerText: "Confidential - NodeBench Weekly Intelligence Report",
  };

  // Top deals rows
  data.fundingHighlights.topDeals.slice(0, 5).forEach((deal, i) => {
    inputs[`topDeal${i}`] = `${truncate(deal.companyName, 20)} | ${formatRoundType(deal.roundType)} | ${deal.amountRaw} | ${truncate(deal.leadInvestors.join(", "), 30)}`;
  });

  // Fill empty deal rows
  for (let i = data.fundingHighlights.topDeals.length; i < 5; i++) {
    inputs[`topDeal${i}`] = "";
  }

  return inputs;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

function formatRoundType(roundType: string): string {
  const mapping: Record<string, string> = {
    "pre-seed": "Pre-Seed",
    seed: "Seed",
    "series-a": "Series A",
    "series-b": "Series B",
    "series-c": "Series C",
    "series-d-plus": "Series D+",
    growth: "Growth",
    debt: "Debt",
    unknown: "Unknown",
  };
  return mapping[roundType] || roundType;
}

function formatPersona(persona: string): string {
  return persona
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatSectorTrends(trends: { sector: string; trend: string; description: string; signalCount: number }[]): string {
  if (trends.length === 0) return "No sector trends available.";
  return trends
    .slice(0, 4)
    .map((t) => {
      const arrow = t.trend === "up" ? "▲" : t.trend === "down" ? "▼" : "→";
      return `${arrow} ${t.sector}: ${t.description} (${t.signalCount} signals)`;
    })
    .join("\n");
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}
