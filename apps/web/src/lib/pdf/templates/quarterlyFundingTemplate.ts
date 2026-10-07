/**
 * Quarterly Funding Summary Template
 *
 * JPMorgan-style professional template for quarterly funding report PDFs.
 * Uses pdfme template format with dynamic table generation.
 */

import type { Template } from "@pdfme/common";
import type { QuarterlyFundingSummaryData, FundingDealRow } from "../types";

// Page dimensions (A4 in mm)
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// Colors (JPMorgan-inspired professional palette)
const COLORS = {
  primary: "#1a365d", // Dark navy blue
  secondary: "#2c5282",
  accent: "#4299e1",
  text: "#1a202c",
  textLight: "#4a5568",
  border: "#e2e8f0",
  headerBg: "#edf2f7",
  positive: "#38a169",
  negative: "#e53e3e",
};

// Font sizes
const FONTS = {
  title: 24,
  subtitle: 14,
  heading: 12,
  body: 10,
  small: 8,
  tableHeader: 9,
  tableBody: 8,
};

/**
 * Base template schema for the quarterly funding summary.
 * This defines the static layout elements.
 */
export const quarterlyFundingBaseTemplate: Template = {
  basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
  schemas: [
    [
      // Header - Report Title
      {
        name: "reportTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN },
        width: CONTENT_WIDTH,
        height: 12,
        fontSize: FONTS.title,
        fontColor: COLORS.primary,
        alignment: "left",
        fontName: "Helvetica-Bold",
      },
      // Quarter Label
      {
        name: "quarterLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 14 },
        width: CONTENT_WIDTH / 2,
        height: 8,
        fontSize: FONTS.subtitle,
        fontColor: COLORS.secondary,
        alignment: "left",
      },
      // Generated Date
      {
        name: "generatedAt",
        type: "text",
        position: { x: PAGE_WIDTH / 2, y: MARGIN + 14 },
        width: CONTENT_WIDTH / 2 - MARGIN,
        height: 8,
        fontSize: FONTS.small,
        fontColor: COLORS.textLight,
        alignment: "right",
      },
      // Divider line
      {
        name: "headerDivider",
        type: "line",
        position: { x: MARGIN, y: MARGIN + 26 },
        width: CONTENT_WIDTH,
        height: 1,
        color: COLORS.primary,
      },

      // Summary Stats Section
      {
        name: "summaryTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 32 },
        width: CONTENT_WIDTH,
        height: 8,
        fontSize: FONTS.heading,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      // Total Deals
      {
        name: "totalDealsLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 44 },
        width: 50,
        height: 6,
        fontSize: FONTS.body,
        fontColor: COLORS.textLight,
      },
      {
        name: "totalDealsValue",
        type: "text",
        position: { x: MARGIN + 52, y: MARGIN + 44 },
        width: 40,
        height: 6,
        fontSize: FONTS.body,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      // Total Amount
      {
        name: "totalAmountLabel",
        type: "text",
        position: { x: MARGIN + 100, y: MARGIN + 44 },
        width: 50,
        height: 6,
        fontSize: FONTS.body,
        fontColor: COLORS.textLight,
      },
      {
        name: "totalAmountValue",
        type: "text",
        position: { x: MARGIN + 155, y: MARGIN + 44 },
        width: 40,
        height: 6,
        fontSize: FONTS.body,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },

      // Deal Table Header
      {
        name: "dealTableTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 58 },
        width: CONTENT_WIDTH,
        height: 8,
        fontSize: FONTS.heading,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },

      // Table Headers
      {
        name: "colCompany",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 70 },
        width: 45,
        height: 5,
        fontSize: FONTS.tableHeader,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "colRound",
        type: "text",
        position: { x: MARGIN + 46, y: MARGIN + 70 },
        width: 25,
        height: 5,
        fontSize: FONTS.tableHeader,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "colAmount",
        type: "text",
        position: { x: MARGIN + 72, y: MARGIN + 70 },
        width: 30,
        height: 5,
        fontSize: FONTS.tableHeader,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "colInvestors",
        type: "text",
        position: { x: MARGIN + 103, y: MARGIN + 70 },
        width: 45,
        height: 5,
        fontSize: FONTS.tableHeader,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "colSector",
        type: "text",
        position: { x: MARGIN + 149, y: MARGIN + 70 },
        width: 35,
        height: 5,
        fontSize: FONTS.tableHeader,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },

      // Deal Rows (up to 15 rows per page)
      ...generateDealRowSchemas(15, MARGIN + 76),

      // Sector Breakdown Section (on second page area)
      {
        name: "sectorTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 200 },
        width: CONTENT_WIDTH,
        height: 8,
        fontSize: FONTS.heading,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "sectorBreakdown",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 210 },
        width: CONTENT_WIDTH,
        height: 50,
        fontSize: FONTS.body,
        fontColor: COLORS.text,
        lineHeight: 1.4,
      },

      // AI Insights Section
      {
        name: "insightsTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 262 },
        width: CONTENT_WIDTH,
        height: 8,
        fontSize: FONTS.heading,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "insights",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 272 },
        width: CONTENT_WIDTH,
        height: 20,
        fontSize: FONTS.body,
        fontColor: COLORS.text,
        lineHeight: 1.4,
      },

      // Footer
      {
        name: "footerText",
        type: "text",
        position: { x: MARGIN, y: PAGE_HEIGHT - 10 },
        width: CONTENT_WIDTH,
        height: 5,
        fontSize: FONTS.small,
        fontColor: COLORS.textLight,
        alignment: "center",
      },
    ],
  ],
};

/**
 * Generate schema definitions for deal table rows.
 */
function generateDealRowSchemas(rowCount: number, startY: number): any[] {
  const schemas: any[] = [];
  const ROW_HEIGHT = 8;

  for (let i = 0; i < rowCount; i++) {
    const y = startY + i * ROW_HEIGHT;
    const bgColor = i % 2 === 0 ? "#ffffff" : "#f7fafc";

    schemas.push(
      {
        name: `deal${i}_company`,
        type: "text",
        position: { x: MARGIN, y },
        width: 45,
        height: ROW_HEIGHT - 1,
        fontSize: FONTS.tableBody,
        fontColor: COLORS.text,
        backgroundColor: bgColor,
      },
      {
        name: `deal${i}_round`,
        type: "text",
        position: { x: MARGIN + 46, y },
        width: 25,
        height: ROW_HEIGHT - 1,
        fontSize: FONTS.tableBody,
        fontColor: COLORS.text,
        backgroundColor: bgColor,
      },
      {
        name: `deal${i}_amount`,
        type: "text",
        position: { x: MARGIN + 72, y },
        width: 30,
        height: ROW_HEIGHT - 1,
        fontSize: FONTS.tableBody,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
        backgroundColor: bgColor,
      },
      {
        name: `deal${i}_investors`,
        type: "text",
        position: { x: MARGIN + 103, y },
        width: 45,
        height: ROW_HEIGHT - 1,
        fontSize: FONTS.tableBody,
        fontColor: COLORS.textLight,
        backgroundColor: bgColor,
      },
      {
        name: `deal${i}_sector`,
        type: "text",
        position: { x: MARGIN + 149, y },
        width: 35,
        height: ROW_HEIGHT - 1,
        fontSize: FONTS.tableBody,
        fontColor: COLORS.textLight,
        backgroundColor: bgColor,
      }
    );
  }

  return schemas;
}

/**
 * Transform funding data into template inputs.
 */
export function transformQuarterlyDataToInputs(
  data: QuarterlyFundingSummaryData
): Record<string, string> {
  const inputs: Record<string, string> = {
    reportTitle: "QUARTERLY FUNDING SUMMARY",
    quarterLabel: data.quarterLabel,
    generatedAt: `Generated: ${data.generatedAt}`,
    summaryTitle: "EXECUTIVE SUMMARY",
    totalDealsLabel: "Total Deals:",
    totalDealsValue: data.totalDeals.toString(),
    totalAmountLabel: "Total Raised:",
    totalAmountValue: formatCurrency(data.totalAmountUsd),

    dealTableTitle: "DEAL ACTIVITY",
    colCompany: "Company",
    colRound: "Round",
    colAmount: "Amount",
    colInvestors: "Lead Investors",
    colSector: "Sector",

    sectorTitle: "SECTOR BREAKDOWN",
    sectorBreakdown: formatSectorBreakdown(data.sectorBreakdown),

    insightsTitle: "AI INSIGHTS",
    insights: data.insights || "Analysis pending...",

    footerText: "Confidential - NodeBench Intelligence Report",
  };

  // Add deal rows
  data.deals.slice(0, 15).forEach((deal, i) => {
    inputs[`deal${i}_company`] = truncate(deal.companyName, 25);
    inputs[`deal${i}_round`] = formatRoundType(deal.roundType);
    inputs[`deal${i}_amount`] = deal.amountRaw;
    inputs[`deal${i}_investors`] = truncate(deal.leadInvestors.join(", "), 28);
    inputs[`deal${i}_sector`] = truncate(deal.sector || "—", 20);
  });

  // Fill empty rows
  for (let i = data.deals.length; i < 15; i++) {
    inputs[`deal${i}_company`] = "";
    inputs[`deal${i}_round`] = "";
    inputs[`deal${i}_amount`] = "";
    inputs[`deal${i}_investors`] = "";
    inputs[`deal${i}_sector`] = "";
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

function formatSectorBreakdown(sectors: { sector: string; dealCount: number; totalAmountUsd: number; percentageOfTotal: number }[]): string {
  return sectors
    .slice(0, 6)
    .map(
      (s) =>
        `• ${s.sector}: ${s.dealCount} deals (${formatCurrency(s.totalAmountUsd)}) - ${s.percentageOfTotal.toFixed(1)}%`
    )
    .join("\n");
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

export { COLORS, FONTS };
