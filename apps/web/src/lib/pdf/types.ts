/**
 * PDF Generation Types
 *
 * Type definitions for JPMorgan-style PDF report generation using pdfme.
 */

import type { Template, Font, Schema } from "@pdfme/common";

// ═══════════════════════════════════════════════════════════════════════════
// Report Types
// ═══════════════════════════════════════════════════════════════════════════

export type ReportType =
  | "quarterly-funding-summary"
  | "company-dossier"
  | "weekly-digest";

// ═══════════════════════════════════════════════════════════════════════════
// Quarterly Funding Summary
// ═══════════════════════════════════════════════════════════════════════════

export interface QuarterlyFundingSummaryData {
  quarterLabel: string; // e.g., "Q4 2025"
  generatedAt: string;
  totalDeals: number;
  totalAmountUsd: number;
  deals: FundingDealRow[];
  sectorBreakdown: SectorBreakdownItem[];
  roundTypeBreakdown: RoundTypeBreakdownItem[];
  topInvestors: InvestorActivity[];
  insights?: string; // AI-generated insights
}

export interface FundingDealRow {
  companyName: string;
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  leadInvestors: string[];
  sector?: string;
  location?: string;
  announcedAt: number;
  confidence: number;
  verificationStatus: string;
}

export interface SectorBreakdownItem {
  sector: string;
  dealCount: number;
  totalAmountUsd: number;
  percentageOfTotal: number;
}

export interface RoundTypeBreakdownItem {
  roundType: string;
  dealCount: number;
  totalAmountUsd: number;
  averageDealSize: number;
}

export interface InvestorActivity {
  investorName: string;
  dealCount: number;
  totalInvested: number;
  sectors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Company Dossier
// ═══════════════════════════════════════════════════════════════════════════

export interface CompanyDossierData {
  companyName: string;
  generatedAt: string;

  // Company Overview
  overview: {
    sector?: string;
    location?: string;
    founded?: string;
    description?: string;
    website?: string;
  };

  // Funding History
  fundingHistory: FundingRoundDetail[];
  totalFundingRaised: number;

  // Key People
  keyPeople?: PersonInfo[];

  // Recent News & Signals
  recentNews?: NewsItem[];

  // Competitive Landscape
  competitors?: CompetitorInfo[];

  // AI Analysis
  aiAnalysis?: {
    strengths: string[];
    risks: string[];
    opportunities: string[];
    recommendation?: string;
  };
}

export interface FundingRoundDetail {
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  date: string;
  leadInvestors: string[];
  coInvestors?: string[];
  valuation?: string;
  useOfProceeds?: string;
}

export interface PersonInfo {
  name: string;
  role: string;
  linkedin?: string;
  background?: string;
}

export interface NewsItem {
  title: string;
  source: string;
  date: string;
  url?: string;
  sentiment?: "positive" | "neutral" | "negative";
}

export interface CompetitorInfo {
  name: string;
  description?: string;
  fundingStage?: string;
  differentiator?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Weekly Digest
// ═══════════════════════════════════════════════════════════════════════════

export interface WeeklyDigestData {
  weekLabel: string; // e.g., "Week of January 13, 2025"
  generatedAt: string;
  persona: string;

  // Executive Summary
  executiveSummary: string;

  // Top Stories
  topStories: DigestStory[];

  // Funding Highlights
  fundingHighlights: {
    totalDeals: number;
    totalAmountUsd: number;
    topDeals: FundingDealRow[];
  };

  // Sector Trends
  sectorTrends: SectorTrend[];

  // Action Items
  actionItems: ActionItem[];

  // What? / So What? / Now What?
  reflection?: {
    what: string;
    soWhat: string;
    nowWhat: string;
  };
}

export interface DigestStory {
  headline: string;
  summary: string;
  source: string;
  relevanceScore: number;
  tags: string[];
}

export interface SectorTrend {
  sector: string;
  trend: "up" | "down" | "stable";
  description: string;
  signalCount: number;
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  action: string;
  rationale: string;
  deadline?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PDF Generation Config
// ═══════════════════════════════════════════════════════════════════════════

export interface PDFGeneratorConfig {
  fonts?: Font;
  template: Template;
  reportType: ReportType;
}

export interface GeneratePDFOptions {
  fileName?: string;
  download?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Template Field Mappings
// ═══════════════════════════════════════════════════════════════════════════

export type TemplateInputs = Record<string, string>;

export interface PDFReportResult {
  blob: Blob;
  fileName: string;
  reportType: ReportType;
  generatedAt: Date;
}
