/**
 * PDF Generator
 *
 * Main PDF generation utility using pdfme.
 * Generates JPMorgan-style professional reports from template data.
 */

// Dynamic import of @pdfme/generator for code splitting
// This reduces initial bundle size by ~1MB
let generateFn: typeof import("@pdfme/generator").generate | null = null;

async function getGenerator() {
  if (!generateFn) {
    const mod = await import("@pdfme/generator");
    generateFn = mod.generate;
  }
  return generateFn;
}

import type { Template } from "@pdfme/common";

import type {
  ReportType,
  QuarterlyFundingSummaryData,
  CompanyDossierData,
  WeeklyDigestData,
  PDFReportResult,
  GeneratePDFOptions,
  FundingDealRow,
  SectorBreakdownItem,
  RoundTypeBreakdownItem,
} from "./types";

import {
  quarterlyFundingBaseTemplate,
  transformQuarterlyDataToInputs,
} from "./templates/quarterlyFundingTemplate";

import {
  companyDossierBaseTemplate,
  transformDossierDataToInputs,
} from "./templates/companyDossierTemplate";

import {
  weeklyDigestBaseTemplate,
  transformDigestDataToInputs,
} from "./templates/weeklyDigestTemplate";

// ═══════════════════════════════════════════════════════════════════════════
// Main Generator Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a Quarterly Funding Summary PDF.
 */
export async function generateQuarterlySummaryPDF(
  data: QuarterlyFundingSummaryData,
  options?: GeneratePDFOptions
): Promise<PDFReportResult> {
  const inputs = transformQuarterlyDataToInputs(data);
  const template = quarterlyFundingBaseTemplate;

  const generate = await getGenerator();
  const pdfBuffer = await generate({
    template,
    inputs: [inputs],
  });

  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const fileName = options?.fileName || `quarterly-funding-summary-${data.quarterLabel.replace(/\s+/g, "-")}.pdf`;

  if (options?.download) {
    downloadBlob(blob, fileName);
  }

  return {
    blob,
    fileName,
    reportType: "quarterly-funding-summary",
    generatedAt: new Date(),
  };
}

/**
 * Generate a Company Dossier PDF.
 */
export async function generateCompanyDossierPDF(
  data: CompanyDossierData,
  options?: GeneratePDFOptions
): Promise<PDFReportResult> {
  const inputs = transformDossierDataToInputs(data);
  const template = companyDossierBaseTemplate;

  const generate = await getGenerator();
  const pdfBuffer = await generate({
    template,
    inputs: [inputs],
  });

  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const fileName = options?.fileName || `dossier-${data.companyName.toLowerCase().replace(/\s+/g, "-")}.pdf`;

  if (options?.download) {
    downloadBlob(blob, fileName);
  }

  return {
    blob,
    fileName,
    reportType: "company-dossier",
    generatedAt: new Date(),
  };
}

/**
 * Generate a Weekly Digest PDF.
 */
export async function generateWeeklyDigestPDF(
  data: WeeklyDigestData,
  options?: GeneratePDFOptions
): Promise<PDFReportResult> {
  const inputs = transformDigestDataToInputs(data);
  const template = weeklyDigestBaseTemplate;

  const generate = await getGenerator();
  const pdfBuffer = await generate({
    template,
    inputs: [inputs],
  });

  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const fileName = options?.fileName || `weekly-digest-${data.weekLabel.replace(/\s+/g, "-")}.pdf`;

  if (options?.download) {
    downloadBlob(blob, fileName);
  }

  return {
    blob,
    fileName,
    reportType: "weekly-digest",
    generatedAt: new Date(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Data Aggregation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate funding events into quarterly summary data.
 */
export function aggregateFundingToQuarterly(
  events: FundingDealRow[],
  quarterLabel: string,
  insights?: string
): QuarterlyFundingSummaryData {
  const totalAmountUsd = events.reduce((sum, e) => sum + (e.amountUsd || 0), 0);

  // Calculate sector breakdown
  const sectorMap = new Map<string, { count: number; amount: number }>();
  for (const event of events) {
    const sector = event.sector || "Unknown";
    const existing = sectorMap.get(sector) || { count: 0, amount: 0 };
    sectorMap.set(sector, {
      count: existing.count + 1,
      amount: existing.amount + (event.amountUsd || 0),
    });
  }

  const sectorBreakdown: SectorBreakdownItem[] = Array.from(sectorMap.entries())
    .map(([sector, data]) => ({
      sector,
      dealCount: data.count,
      totalAmountUsd: data.amount,
      percentageOfTotal: totalAmountUsd > 0 ? (data.amount / totalAmountUsd) * 100 : 0,
    }))
    .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

  // Calculate round type breakdown
  const roundMap = new Map<string, { count: number; amount: number }>();
  for (const event of events) {
    const round = event.roundType;
    const existing = roundMap.get(round) || { count: 0, amount: 0 };
    roundMap.set(round, {
      count: existing.count + 1,
      amount: existing.amount + (event.amountUsd || 0),
    });
  }

  const roundTypeBreakdown: RoundTypeBreakdownItem[] = Array.from(roundMap.entries())
    .map(([roundType, data]) => ({
      roundType,
      dealCount: data.count,
      totalAmountUsd: data.amount,
      averageDealSize: data.count > 0 ? data.amount / data.count : 0,
    }))
    .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

  return {
    quarterLabel,
    generatedAt: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    totalDeals: events.length,
    totalAmountUsd,
    deals: events.sort((a, b) => (b.amountUsd || 0) - (a.amountUsd || 0)),
    sectorBreakdown,
    roundTypeBreakdown,
    topInvestors: [], // Can be populated by agent analysis
    insights,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Download a Blob as a file in the browser.
 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convert a PDF blob to base64 for storage/transmission.
 */
export async function pdfBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix
      const base64Data = base64.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert base64 to Blob for PDF.
 */
export function base64ToPdfBlob(base64: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: "application/pdf" });
}

/**
 * Get current quarter label.
 */
export function getCurrentQuarterLabel(): string {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `Q${quarter} ${now.getFullYear()}`;
}

/**
 * Get current week label.
 */
export function getCurrentWeekLabel(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Export all templates and types
// ═══════════════════════════════════════════════════════════════════════════

export {
  quarterlyFundingBaseTemplate,
  companyDossierBaseTemplate,
  weeklyDigestBaseTemplate,
  transformQuarterlyDataToInputs,
  transformDossierDataToInputs,
  transformDigestDataToInputs,
};

export type {
  ReportType,
  QuarterlyFundingSummaryData,
  CompanyDossierData,
  WeeklyDigestData,
  PDFReportResult,
  GeneratePDFOptions,
  FundingDealRow,
  SectorBreakdownItem,
  RoundTypeBreakdownItem,
};
