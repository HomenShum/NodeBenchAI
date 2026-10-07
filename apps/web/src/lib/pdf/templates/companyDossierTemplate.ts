/**
 * Company Dossier Template
 *
 * JPMorgan-style single company deep-dive PDF template.
 * Professional layout for comprehensive company analysis.
 */

import type { Template } from "@pdfme/common";
import type { CompanyDossierData } from "../types";
import { COLORS, FONTS } from "./quarterlyFundingTemplate";

// Page dimensions (A4 in mm)
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

/**
 * Base template schema for company dossier.
 */
export const companyDossierBaseTemplate: Template = {
  basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
  schemas: [
    [
      // Company Header
      {
        name: "companyName",
        type: "text",
        position: { x: MARGIN, y: MARGIN },
        width: CONTENT_WIDTH,
        height: 14,
        fontSize: 28,
        fontColor: COLORS.primary,
        alignment: "left",
        fontName: "Helvetica-Bold",
      },
      {
        name: "dossierLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 16 },
        width: CONTENT_WIDTH / 2,
        height: 6,
        fontSize: 11,
        fontColor: COLORS.secondary,
      },
      {
        name: "generatedAt",
        type: "text",
        position: { x: PAGE_WIDTH / 2, y: MARGIN + 16 },
        width: CONTENT_WIDTH / 2 - MARGIN,
        height: 6,
        fontSize: 9,
        fontColor: COLORS.textLight,
        alignment: "right",
      },
      // Divider
      {
        name: "headerDivider",
        type: "line",
        position: { x: MARGIN, y: MARGIN + 26 },
        width: CONTENT_WIDTH,
        height: 2,
        color: COLORS.primary,
      },

      // ═══════════════════════════════════════════════════════════════════
      // COMPANY OVERVIEW SECTION
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "overviewTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 34 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "sectorLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 44 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.textLight,
      },
      {
        name: "sectorValue",
        type: "text",
        position: { x: MARGIN + 32, y: MARGIN + 44 },
        width: 50,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      {
        name: "locationLabel",
        type: "text",
        position: { x: MARGIN + 90, y: MARGIN + 44 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.textLight,
      },
      {
        name: "locationValue",
        type: "text",
        position: { x: MARGIN + 122, y: MARGIN + 44 },
        width: 60,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
      },
      {
        name: "foundedLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 52 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.textLight,
      },
      {
        name: "foundedValue",
        type: "text",
        position: { x: MARGIN + 32, y: MARGIN + 52 },
        width: 50,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.text,
      },
      {
        name: "websiteLabel",
        type: "text",
        position: { x: MARGIN + 90, y: MARGIN + 52 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.textLight,
      },
      {
        name: "websiteValue",
        type: "text",
        position: { x: MARGIN + 122, y: MARGIN + 52 },
        width: 60,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.accent,
      },
      {
        name: "description",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 62 },
        width: CONTENT_WIDTH,
        height: 20,
        fontSize: 10,
        fontColor: COLORS.text,
        lineHeight: 1.4,
      },

      // ═══════════════════════════════════════════════════════════════════
      // FUNDING HISTORY SECTION
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "fundingTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 88 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "totalFundingLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 98 },
        width: 50,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.textLight,
      },
      {
        name: "totalFundingValue",
        type: "text",
        position: { x: MARGIN + 52, y: MARGIN + 98 },
        width: 60,
        height: 5,
        fontSize: 11,
        fontColor: COLORS.positive,
        fontName: "Helvetica-Bold",
      },

      // Funding rounds table header
      {
        name: "fundingColDate",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 108 },
        width: 28,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "fundingColRound",
        type: "text",
        position: { x: MARGIN + 29, y: MARGIN + 108 },
        width: 25,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "fundingColAmount",
        type: "text",
        position: { x: MARGIN + 55, y: MARGIN + 108 },
        width: 28,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "fundingColLeadInvestors",
        type: "text",
        position: { x: MARGIN + 84, y: MARGIN + 108 },
        width: 55,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },
      {
        name: "fundingColValuation",
        type: "text",
        position: { x: MARGIN + 140, y: MARGIN + 108 },
        width: 40,
        height: 5,
        fontSize: 8,
        fontColor: COLORS.secondary,
        fontName: "Helvetica-Bold",
        backgroundColor: COLORS.headerBg,
      },

      // Funding rows (up to 6 rounds)
      ...generateFundingRowSchemas(6, MARGIN + 114),

      // ═══════════════════════════════════════════════════════════════════
      // KEY PEOPLE SECTION
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "keyPeopleTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 170 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "keyPeople",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 180 },
        width: CONTENT_WIDTH,
        height: 25,
        fontSize: 9,
        fontColor: COLORS.text,
        lineHeight: 1.4,
      },

      // ═══════════════════════════════════════════════════════════════════
      // AI ANALYSIS SECTION
      // ═══════════════════════════════════════════════════════════════════
      {
        name: "analysisTitle",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 210 },
        width: CONTENT_WIDTH,
        height: 7,
        fontSize: 14,
        fontColor: COLORS.primary,
        fontName: "Helvetica-Bold",
      },
      {
        name: "strengthsLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 220 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.positive,
        fontName: "Helvetica-Bold",
      },
      {
        name: "strengthsValue",
        type: "text",
        position: { x: MARGIN + 32, y: MARGIN + 220 },
        width: CONTENT_WIDTH - 32,
        height: 15,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.3,
      },
      {
        name: "risksLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 238 },
        width: 30,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.negative,
        fontName: "Helvetica-Bold",
      },
      {
        name: "risksValue",
        type: "text",
        position: { x: MARGIN + 32, y: MARGIN + 238 },
        width: CONTENT_WIDTH - 32,
        height: 15,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.3,
      },
      {
        name: "opportunitiesLabel",
        type: "text",
        position: { x: MARGIN, y: MARGIN + 256 },
        width: 40,
        height: 5,
        fontSize: 9,
        fontColor: COLORS.accent,
        fontName: "Helvetica-Bold",
      },
      {
        name: "opportunitiesValue",
        type: "text",
        position: { x: MARGIN + 42, y: MARGIN + 256 },
        width: CONTENT_WIDTH - 42,
        height: 15,
        fontSize: 8,
        fontColor: COLORS.text,
        lineHeight: 1.3,
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
 * Generate schema definitions for funding history rows.
 */
function generateFundingRowSchemas(rowCount: number, startY: number): any[] {
  const schemas: any[] = [];
  const ROW_HEIGHT = 9;

  for (let i = 0; i < rowCount; i++) {
    const y = startY + i * ROW_HEIGHT;
    const bgColor = i % 2 === 0 ? "#ffffff" : "#f7fafc";

    schemas.push(
      {
        name: `funding${i}_date`,
        type: "text",
        position: { x: MARGIN, y },
        width: 28,
        height: ROW_HEIGHT - 1,
        fontSize: 8,
        fontColor: COLORS.text,
        backgroundColor: bgColor,
      },
      {
        name: `funding${i}_round`,
        type: "text",
        position: { x: MARGIN + 29, y },
        width: 25,
        height: ROW_HEIGHT - 1,
        fontSize: 8,
        fontColor: COLORS.text,
        backgroundColor: bgColor,
      },
      {
        name: `funding${i}_amount`,
        type: "text",
        position: { x: MARGIN + 55, y },
        width: 28,
        height: ROW_HEIGHT - 1,
        fontSize: 8,
        fontColor: COLORS.text,
        fontName: "Helvetica-Bold",
        backgroundColor: bgColor,
      },
      {
        name: `funding${i}_investors`,
        type: "text",
        position: { x: MARGIN + 84, y },
        width: 55,
        height: ROW_HEIGHT - 1,
        fontSize: 7,
        fontColor: COLORS.textLight,
        backgroundColor: bgColor,
      },
      {
        name: `funding${i}_valuation`,
        type: "text",
        position: { x: MARGIN + 140, y },
        width: 40,
        height: ROW_HEIGHT - 1,
        fontSize: 8,
        fontColor: COLORS.text,
        backgroundColor: bgColor,
      }
    );
  }

  return schemas;
}

/**
 * Transform company dossier data into template inputs.
 */
export function transformDossierDataToInputs(
  data: CompanyDossierData
): Record<string, string> {
  const inputs: Record<string, string> = {
    companyName: data.companyName.toUpperCase(),
    dossierLabel: "COMPANY DOSSIER",
    generatedAt: `Generated: ${data.generatedAt}`,

    // Overview section
    overviewTitle: "COMPANY OVERVIEW",
    sectorLabel: "Sector:",
    sectorValue: data.overview.sector || "—",
    locationLabel: "Location:",
    locationValue: data.overview.location || "—",
    foundedLabel: "Founded:",
    foundedValue: data.overview.founded || "—",
    websiteLabel: "Website:",
    websiteValue: data.overview.website || "—",
    description: data.overview.description || "No description available.",

    // Funding section
    fundingTitle: "FUNDING HISTORY",
    totalFundingLabel: "Total Raised:",
    totalFundingValue: formatCurrency(data.totalFundingRaised),
    fundingColDate: "Date",
    fundingColRound: "Round",
    fundingColAmount: "Amount",
    fundingColLeadInvestors: "Lead Investors",
    fundingColValuation: "Valuation",

    // Key people section
    keyPeopleTitle: "KEY PEOPLE",
    keyPeople: formatKeyPeople(data.keyPeople || []),

    // AI Analysis section
    analysisTitle: "AI ANALYSIS",
    strengthsLabel: "Strengths:",
    strengthsValue: formatBulletList(data.aiAnalysis?.strengths || []),
    risksLabel: "Risks:",
    risksValue: formatBulletList(data.aiAnalysis?.risks || []),
    opportunitiesLabel: "Opportunities:",
    opportunitiesValue: formatBulletList(data.aiAnalysis?.opportunities || []),

    footerText: "Confidential - NodeBench Intelligence Report | For Internal Use Only",
  };

  // Add funding rows
  data.fundingHistory.slice(0, 6).forEach((round, i) => {
    inputs[`funding${i}_date`] = round.date;
    inputs[`funding${i}_round`] = formatRoundType(round.roundType);
    inputs[`funding${i}_amount`] = round.amountRaw;
    inputs[`funding${i}_investors`] = truncate(round.leadInvestors.join(", "), 35);
    inputs[`funding${i}_valuation`] = round.valuation || "—";
  });

  // Fill empty funding rows
  for (let i = data.fundingHistory.length; i < 6; i++) {
    inputs[`funding${i}_date`] = "";
    inputs[`funding${i}_round`] = "";
    inputs[`funding${i}_amount`] = "";
    inputs[`funding${i}_investors`] = "";
    inputs[`funding${i}_valuation`] = "";
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

function formatKeyPeople(people: { name: string; role: string; background?: string }[]): string {
  if (people.length === 0) return "No key people information available.";
  return people
    .slice(0, 4)
    .map((p) => `• ${p.name} (${p.role})${p.background ? ` — ${p.background}` : ""}`)
    .join("\n");
}

function formatBulletList(items: string[]): string {
  if (items.length === 0) return "Analysis pending...";
  return items.slice(0, 3).map((item) => `• ${item}`).join("\n");
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}
