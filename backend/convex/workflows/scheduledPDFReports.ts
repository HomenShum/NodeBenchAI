"use node";

/**
 * NodeBench AI Scheduled PDF Report Generation
 *
 * Automated workflow that generates professional funding reports.
 * Uses NodeBench AI branded design with Z-pattern layout.
 *
 * Design Philosophy:
 * - Editorial headlines that tell the story (not generic labels)
 * - Z-pattern layout for natural eye flow
 * - Distinctive indigo/violet color palette (differentiates from competitors)
 * - AI-powered market analysis with source citations
 *
 * Schedule:
 * - Weekly: Every Monday at 8:00 AM UTC
 * - Monthly: First day of month at 9:00 AM UTC
 * - Quarterly: First of quarter at 10:00 AM UTC
 *
 * Features:
 * - FREE-FIRST model strategy for AI insights
 * - Visual charts via QuickChart.io with NodeBench branding
 * - Automatic storage in Documents Hub
 * - Multi-channel distribution (Discord, LinkedIn, ntfy, email)
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generate } from "@pdfme/generator";
import { text, image } from "@pdfme/schemas";
import type { Template } from "@pdfme/common";

// ═══════════════════════════════════════════════════════════════════════════
// NODEBENCH AI PDF TEMPLATE
// Distinctive professional design with Z-pattern layout
// Can't import from src/ in Convex "use node" actions
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 12;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const CHART_WIDTH = 85;
const CHART_HEIGHT = 55;

// NodeBench AI Brand Colors
// Distinctive deep indigo/purple palette - differentiates from JPMorgan navy
const COLORS = {
  // Primary brand colors
  primary: "#4f46e5",        // Indigo-600 - NodeBench signature
  primaryDark: "#3730a3",    // Indigo-800 - Headers
  primaryLight: "#818cf8",   // Indigo-400 - Accents

  // Semantic colors
  capital: "#2563eb",        // Blue-600 - Capital/funding amounts
  trend: "#059669",          // Emerald-600 - Positive trends
  trendDown: "#dc2626",      // Red-600 - Negative trends
  alert: "#f97316",          // Orange-500 - IPOs/alerts

  // Text hierarchy
  text: "#111827",           // Gray-900 - Primary text
  textSecondary: "#4b5563",  // Gray-600 - Secondary text
  textMuted: "#9ca3af",      // Gray-400 - Muted/footnotes

  // Background
  bgAccent: "#f5f3ff",       // Indigo-50 - Accent backgrounds
  bgMuted: "#f9fafb",        // Gray-50 - Section backgrounds
};

// Typography scale (pt)
const FONTS = {
  hero: 28,          // Main headline
  title: 18,         // Section titles
  subtitle: 14,      // Subtitles
  heading: 11,       // Section headings
  body: 9,           // Body text
  small: 7.5,        // Footnotes/captions
  micro: 6.5,        // Legal/disclaimer
};

// NodeBench AI Chart Color Palette
// Vibrant gradient from indigo through teal - distinctive and modern
const CHART_COLORS = [
  "#4f46e5", // Indigo-600 (Primary)
  "#7c3aed", // Violet-600
  "#2563eb", // Blue-600
  "#0891b2", // Cyan-600
  "#059669", // Emerald-600
  "#f97316", // Orange-500
  "#ec4899", // Pink-500
  "#8b5cf6", // Violet-500
];

// NodeBench AI Z-Pattern Layout Template
// ┌────────────────────────────────────────────────┐
// │  HERO HEADLINE (Editorial takeaway)            │  ← Zone 1: Eye entry
// │  Brand + Period + Source                       │
// ├────────────────────────────┬───────────────────┤
// │  CHARTS (Visual data)      │  KEY METRICS      │  ← Zone 2: Primary info
// │  Pie + Bar side-by-side    │  (Sidebar)        │
// ├────────────────────────────┴───────────────────┤
// │  TOP DEALS TABLE                               │  ← Zone 3: Details
// │  SECTOR ANALYSIS                               │
// ├────────────────────────────────────────────────┤
// │  AI INSIGHTS (Market analysis)                 │  ← Zone 4: Analysis
// ├────────────────────────────────────────────────┤
// │  FOOTER: Legal + Attribution                   │  ← Zone 5: Exit
// └────────────────────────────────────────────────┘

const SIDEBAR_WIDTH = 55;
const MAIN_WIDTH = CONTENT_WIDTH - SIDEBAR_WIDTH - 5;

const scheduledReportTemplate: Template = {
  basePdf: { width: PAGE_WIDTH, height: PAGE_HEIGHT, padding: [MARGIN, MARGIN, MARGIN, MARGIN] },
  schemas: [
    [
      // ═══════════════════════════════════════════════════════════════════════
      // ZONE 1: HEADER - Editorial headline (tells the story, not generic label)
      // ═══════════════════════════════════════════════════════════════════════
      { name: "heroHeadline", type: "text", position: { x: MARGIN, y: MARGIN }, width: CONTENT_WIDTH, height: 14, fontSize: FONTS.hero, fontColor: COLORS.primaryDark, alignment: "left" },
      { name: "brandLine", type: "text", position: { x: MARGIN, y: MARGIN + 15 }, width: CONTENT_WIDTH * 0.6, height: 6, fontSize: FONTS.small, fontColor: COLORS.primary, alignment: "left" },
      { name: "quarterLabel", type: "text", position: { x: MARGIN, y: MARGIN + 22 }, width: CONTENT_WIDTH * 0.5, height: 6, fontSize: FONTS.subtitle, fontColor: COLORS.textSecondary, alignment: "left" },
      { name: "dataSource", type: "text", position: { x: MARGIN + CONTENT_WIDTH * 0.5, y: MARGIN + 22 }, width: CONTENT_WIDTH * 0.5, height: 6, fontSize: FONTS.small, fontColor: COLORS.textMuted, alignment: "right" },

      // ═══════════════════════════════════════════════════════════════════════
      // ZONE 2: VISUAL DATA - Charts (left/center) + Metrics Sidebar (right)
      // ═══════════════════════════════════════════════════════════════════════

      // Charts Section (Left/Center - 2/3 width)
      { name: "chartsTitle", type: "text", position: { x: MARGIN, y: MARGIN + 32 }, width: MAIN_WIDTH, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "sectorPieChart", type: "image", position: { x: MARGIN, y: MARGIN + 40 }, width: CHART_WIDTH, height: CHART_HEIGHT },
      { name: "fundingBarChart", type: "image", position: { x: MARGIN + CHART_WIDTH + 4, y: MARGIN + 40 }, width: MAIN_WIDTH - CHART_WIDTH - 4, height: CHART_HEIGHT },

      // Key Metrics Sidebar (Right - 1/3 width)
      { name: "metricsTitle", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 32 }, width: SIDEBAR_WIDTH, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "totalCapitalLabel", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 42 }, width: SIDEBAR_WIDTH, height: 4, fontSize: FONTS.small, fontColor: COLORS.textMuted },
      { name: "totalCapitalValue", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 47 }, width: SIDEBAR_WIDTH, height: 7, fontSize: FONTS.title, fontColor: COLORS.capital },
      { name: "totalDealsLabel", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 56 }, width: SIDEBAR_WIDTH, height: 4, fontSize: FONTS.small, fontColor: COLORS.textMuted },
      { name: "totalDealsValue", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 61 }, width: SIDEBAR_WIDTH, height: 6, fontSize: FONTS.subtitle, fontColor: COLORS.text },
      { name: "medianDealLabel", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 70 }, width: SIDEBAR_WIDTH, height: 4, fontSize: FONTS.small, fontColor: COLORS.textMuted },
      { name: "medianDealValue", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 75 }, width: SIDEBAR_WIDTH, height: 6, fontSize: FONTS.subtitle, fontColor: COLORS.text },
      { name: "momentumLabel", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 84 }, width: SIDEBAR_WIDTH, height: 4, fontSize: FONTS.small, fontColor: COLORS.textMuted },
      { name: "momentumIndicator", type: "text", position: { x: MARGIN + MAIN_WIDTH + 5, y: MARGIN + 89 }, width: SIDEBAR_WIDTH, height: 5, fontSize: FONTS.body, fontColor: COLORS.trend },

      // ═══════════════════════════════════════════════════════════════════════
      // ZONE 3: DETAILED DATA - Top Deals + Sector Breakdown
      // ═══════════════════════════════════════════════════════════════════════

      // Executive Summary (Narrative)
      { name: "summaryTitle", type: "text", position: { x: MARGIN, y: MARGIN + 100 }, width: CONTENT_WIDTH, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "executiveSummary", type: "text", position: { x: MARGIN, y: MARGIN + 108 }, width: CONTENT_WIDTH, height: 14, fontSize: FONTS.body, fontColor: COLORS.text, lineHeight: 1.35 },

      // Top Deals Table
      { name: "topDealsTitle", type: "text", position: { x: MARGIN, y: MARGIN + 126 }, width: CONTENT_WIDTH, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "topDealsList", type: "text", position: { x: MARGIN, y: MARGIN + 134 }, width: CONTENT_WIDTH, height: 44, fontSize: FONTS.small, fontColor: COLORS.text, lineHeight: 1.2 },

      // Sector Distribution (left column)
      { name: "sectorTitle", type: "text", position: { x: MARGIN, y: MARGIN + 182 }, width: CONTENT_WIDTH * 0.5 - 2, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "sectorBreakdown", type: "text", position: { x: MARGIN, y: MARGIN + 190 }, width: CONTENT_WIDTH * 0.5 - 2, height: 18, fontSize: FONTS.small, fontColor: COLORS.text, lineHeight: 1.25 },

      // Top Investors (right column) - JPMorgan requirement
      { name: "investorsTitle", type: "text", position: { x: MARGIN + CONTENT_WIDTH * 0.5 + 2, y: MARGIN + 182 }, width: CONTENT_WIDTH * 0.5 - 2, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "topInvestorsList", type: "text", position: { x: MARGIN + CONTENT_WIDTH * 0.5 + 2, y: MARGIN + 190 }, width: CONTENT_WIDTH * 0.5 - 2, height: 18, fontSize: FONTS.small, fontColor: COLORS.text, lineHeight: 1.25 },

      // Geographic Distribution (full width below sector/investors) - JPMorgan requirement
      { name: "geoTitle", type: "text", position: { x: MARGIN, y: MARGIN + 210 }, width: CONTENT_WIDTH, height: 5, fontSize: FONTS.heading, fontColor: COLORS.primaryDark },
      { name: "geoBreakdownLine", type: "text", position: { x: MARGIN, y: MARGIN + 216 }, width: CONTENT_WIDTH, height: 6, fontSize: FONTS.small, fontColor: COLORS.textSecondary, lineHeight: 1.2 },

      // ═══════════════════════════════════════════════════════════════════════
      // ZONE 4: AI ANALYSIS - Market insights generated by NodeBench AI
      // ═══════════════════════════════════════════════════════════════════════
      { name: "insightsTitle", type: "text", position: { x: MARGIN, y: MARGIN + 226 }, width: CONTENT_WIDTH, height: 6, fontSize: FONTS.heading, fontColor: COLORS.primary },
      { name: "insightsContent", type: "text", position: { x: MARGIN, y: MARGIN + 234 }, width: CONTENT_WIDTH, height: 42, fontSize: FONTS.small, fontColor: COLORS.textSecondary, lineHeight: 1.2 },

      // ═══════════════════════════════════════════════════════════════════════
      // ZONE 5: FOOTER - Legal disclaimer + NodeBench branding
      // ═══════════════════════════════════════════════════════════════════════
      { name: "disclaimer", type: "text", position: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 5 }, width: CONTENT_WIDTH, height: 5, fontSize: FONTS.micro, fontColor: COLORS.textMuted, alignment: "center" },
    ],
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// QUICKCHART.IO CHART GENERATION
// ═══════════════════════════════════════════════════════════════════════════

interface SectorData {
  sector: string;
  dealCount: number;
  totalAmountUsd: number;
  percentageOfTotal: number;
}

/**
 * Generate a sector pie chart using QuickChart.io
 * NodeBench AI branded styling - vibrant doughnut with gradient colors
 * Returns base64 data URL for embedding in PDF
 */
async function generateSectorPieChart(sectorBreakdown: SectorData[]): Promise<string> {
  const topSectors = sectorBreakdown.slice(0, 6);

  const chartConfig = {
    type: "doughnut",
    data: {
      labels: topSectors.map(s => truncateLabel(s.sector, 14)),
      datasets: [{
        data: topSectors.map(s => s.totalAmountUsd),
        backgroundColor: CHART_COLORS.slice(0, topSectors.length),
        borderWidth: 2,
        borderColor: "#ffffff",
        hoverOffset: 4,
      }],
    },
    options: {
      cutout: "55%", // Modern doughnut style
      plugins: {
        legend: {
          position: "right",
          labels: {
            font: { size: 10, family: "Inter, system-ui, sans-serif" },
            boxWidth: 12,
            padding: 8,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        title: {
          display: true,
          text: "SECTOR ALLOCATION",
          font: { size: 11, weight: "bold", family: "Inter, system-ui, sans-serif" },
          color: COLORS.primaryDark,
          padding: { bottom: 10 },
        },
        datalabels: {
          display: false, // Clean look without in-chart labels
        },
      },
    },
  };

  return await fetchQuickChart(chartConfig);
}

/**
 * Generate a funding bar chart showing deal counts and amounts by round type
 * NodeBench AI branded styling - horizontal bar with gradient fill
 * Returns base64 data URL for embedding in PDF
 */
async function generateFundingBarChart(
  roundTypeBreakdown: Array<{ roundType: string; dealCount: number; totalAmountUsd: number }>
): Promise<string> {
  const topRounds = roundTypeBreakdown.slice(0, 5);

  // Format round types for display
  const formatRoundType = (rt: string): string => {
    const mapping: Record<string, string> = {
      "pre-seed": "Pre-Seed",
      "seed": "Seed",
      "series-a": "Series A",
      "series-b": "Series B",
      "series-c": "Series C",
      "series-d": "Series D+",
      "growth": "Growth",
      "ipo": "IPO",
    };
    return mapping[rt.toLowerCase()] || rt;
  };

  const chartConfig = {
    type: "bar",
    data: {
      labels: topRounds.map(r => formatRoundType(r.roundType)),
      datasets: [
        {
          label: "Capital ($M)",
          data: topRounds.map(r => r.totalAmountUsd / 1_000_000), // Convert to millions
          backgroundColor: COLORS.capital,
          borderWidth: 0,
          barThickness: 14,
          borderRadius: 2,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "CAPITAL BY ROUND TYPE ($M)",
          font: { size: 11, weight: "bold", family: "Inter, system-ui, sans-serif" },
          color: COLORS.primaryDark,
          padding: { bottom: 10 },
        },
        datalabels: {
          anchor: "end",
          align: "end",
          color: COLORS.textSecondary,
          font: { size: 9 },
          formatter: (value: number) => `$${value.toFixed(0)}M`,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 9, family: "Inter, system-ui, sans-serif" },
            color: COLORS.textSecondary,
            callback: (value: number) => `$${value}M`,
          },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { size: 10, family: "Inter, system-ui, sans-serif" },
            color: COLORS.text,
          },
          border: { display: false },
        },
      },
    },
  };

  return await fetchQuickChart(chartConfig);
}

/**
 * Fetch chart from QuickChart.io and return as base64 data URL
 */
async function fetchQuickChart(chartConfig: object): Promise<string> {
  const url = "https://quickchart.io/chart";
  const params = new URLSearchParams({
    c: JSON.stringify(chartConfig),
    w: "400",
    h: "250",
    format: "png",
    backgroundColor: "white",
  });

  try {
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      console.warn(`[scheduledPDFReports] QuickChart API error: ${response.status}`);
      return getPlaceholderChartImage();
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.warn(`[scheduledPDFReports] Failed to fetch chart:`, error);
    return getPlaceholderChartImage();
  }
}

/**
 * Return a simple placeholder image when chart generation fails
 */
function getPlaceholderChartImage(): string {
  // 1x1 transparent PNG as fallback
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

/**
 * Truncate label for chart display
 */
function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 2) + "..";
}

interface RoundTypeData {
  roundType: string;
  dealCount: number;
  totalAmountUsd: number;
  averageDealSize: number;
}

interface TopInvestor {
  name: string;
  dealCount: number;
  totalAmount: number;
  sectors: string[];
}

interface GeoBreakdown {
  region: string;
  dealCount: number;
  totalAmount: number;
  percentage: number;
}

interface ReportData {
  quarterLabel: string;
  generatedAt: string;
  dataCutoffDate: string; // JPM requirement: "Data through [date]"
  totalDeals: number;
  totalAmountUsd: number;
  medianDealSize: number; // JPM requirement: median calculations
  deals: FundingDeal[];
  sectorBreakdown: SectorData[];
  roundTypeBreakdown: RoundTypeData[];
  topInvestors: TopInvestor[]; // JPM requirement: most active investors
  geoBreakdown: GeoBreakdown[]; // JPM requirement: geographic distribution
  insights?: string;
  // Chart images (base64 data URLs)
  sectorPieChart?: string;
  fundingBarChart?: string;
  // Stage groupings (JPM style: Seed/A vs B+)
  earlyStageDeals: number; // Seed + Series A
  earlyStageAmount: number;
  lateStageDeals: number;  // Series B+
  lateStageAmount: number;
}

/**
 * Calculate market momentum based on deal characteristics
 * Used for JPMorgan-style trend indicators
 */
function calculateMomentum(data: ReportData): { label: string; icon: string } {
  const hasMegaRound = data.deals.some(d => (d.amountUsd || 0) >= 100_000_000);
  const avgDealSize = data.totalDeals > 0 ? data.totalAmountUsd / data.totalDeals : 0;
  const hasHighVolume = data.totalDeals >= 15;
  const hasLargeCapital = data.totalAmountUsd >= 300_000_000;

  // Score-based momentum calculation
  let score = 0;
  if (hasMegaRound) score += 3;
  if (hasHighVolume) score += 2;
  if (hasLargeCapital) score += 2;
  if (avgDealSize >= 10_000_000) score += 1;
  if (data.earlyStageDeals > data.lateStageDeals) score += 1; // Active pipeline

  if (score >= 6) return { label: "Strong Momentum", icon: "▲▲" };
  if (score >= 4) return { label: "Moderate Activity", icon: "▲" };
  if (score >= 2) return { label: "Steady", icon: "►" };
  return { label: "Quiet Period", icon: "▼" };
}

/**
 * Generate an editorial headline based on the data
 * NodeBench AI style: Headlines tell the story, not just label content
 */
function generateEditorialHeadline(data: ReportData): string {
  const topSector = data.sectorBreakdown[0];
  const avgDeal = data.totalDeals > 0 ? data.totalAmountUsd / data.totalDeals : 0;

  // Determine market momentum
  const isMegaRound = data.deals.some(d => (d.amountUsd || 0) >= 100_000_000);
  const isHighVolume = data.totalDeals >= 20;
  const isLargeCapital = data.totalAmountUsd >= 500_000_000;

  // Generate editorial headline based on key insight
  if (topSector && topSector.percentageOfTotal >= 30) {
    return `${topSector.sector} Dominates with ${topSector.percentageOfTotal.toFixed(0)}% of Funding`;
  } else if (isMegaRound) {
    const megaDeal = data.deals.find(d => (d.amountUsd || 0) >= 100_000_000);
    return `Mega-Round Alert: ${megaDeal?.companyName} Leads ${data.quarterLabel}`;
  } else if (isLargeCapital) {
    return `${formatCurrency(data.totalAmountUsd)} Deployed in ${data.quarterLabel}`;
  } else if (isHighVolume) {
    return `Deal Activity Surges: ${data.totalDeals} Rounds This Period`;
  } else {
    return `Venture Funding Overview: ${data.quarterLabel}`;
  }
}

/**
 * Transform report data to PDF template inputs
 * NodeBench AI Z-Pattern Layout with Editorial Headlines
 *
 * Design Philosophy:
 * - Zone 1: Hero headline tells the story (not "Funding Report")
 * - Zone 2: Visual data + metrics sidebar for quick scanning
 * - Zone 3: Detailed deal data with source citations
 * - Zone 4: AI-generated market analysis
 * - Zone 5: Legal footer with attribution
 */
function transformToTemplateInputs(data: ReportData): Record<string, string> {
  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 1: Editorial headline + brand attribution
  // ═══════════════════════════════════════════════════════════════════════════
  const heroHeadline = generateEditorialHeadline(data);

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 2: Key metrics sidebar with momentum indicator
  // ═══════════════════════════════════════════════════════════════════════════
  const momentum = calculateMomentum(data);

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 3: Detailed data
  // ═══════════════════════════════════════════════════════════════════════════

  // Top deals with source citations
  const topDeals = data.deals.slice(0, 8).map((d, i) => {
    const date = new Date(d.announcedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const investors = d.leadInvestors?.slice(0, 2).join(", ") || "Undisclosed";
    const amount = d.amountRaw || "Undisclosed";
    return `${i + 1}. ${d.companyName} — ${d.roundType} — ${amount}\n   Lead: ${investors} [Announced ${date}]`;
  }).join("\n");

  // Executive summary narrative
  const executiveSummary = `Venture funding totaled ${formatCurrency(data.totalAmountUsd)} across ${data.totalDeals} transactions in ${data.quarterLabel}. ` +
    `Early-stage rounds (Seed/Series A) represented ${data.earlyStageDeals} deals totaling ${formatCurrency(data.earlyStageAmount)}, ` +
    `while growth-stage rounds (Series B+) accounted for ${data.lateStageDeals} deals totaling ${formatCurrency(data.lateStageAmount)}. ` +
    `Median deal size: ${formatCurrency(data.medianDealSize)}.`;

  // Sector breakdown with visual indicators (left column)
  const sectorLines = data.sectorBreakdown.slice(0, 4).map((s) => {
    const bar = "█".repeat(Math.min(8, Math.round(s.percentageOfTotal / 12)));
    return `${s.sector}: ${bar} ${s.percentageOfTotal.toFixed(0)}%`;
  }).join("\n");

  // Top investors (right column) - JPMorgan requirement
  const topInvestorsLines = data.topInvestors.slice(0, 4).map((inv) => {
    return `${inv.name}: ${inv.dealCount} deals`;
  }).join("\n");

  // Geographic breakdown (full width compact line) - JPMorgan requirement
  const geoBreakdownLine = data.geoBreakdown.slice(0, 4).map((geo) => {
    return `${geo.region}: ${geo.percentage.toFixed(0)}%`;
  }).join("  •  ");

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 4: AI Analysis title based on content
  // ═══════════════════════════════════════════════════════════════════════════
  const insightsTitle = data.insights
    ? "🤖 AI Market Analysis — Powered by NodeBench"
    : "🤖 AI Analysis — Generating...";

  return {
    // ZONE 1: Header
    heroHeadline,
    brandLine: "NODEBENCH AI • VENTURE INTELLIGENCE",
    quarterLabel: data.quarterLabel,
    dataSource: `Data through ${data.dataCutoffDate}`,

    // ZONE 2: Charts + Metrics Sidebar
    chartsTitle: "Capital Allocation by Sector & Round Type",
    sectorPieChart: data.sectorPieChart || getPlaceholderChartImage(),
    fundingBarChart: data.fundingBarChart || getPlaceholderChartImage(),
    metricsTitle: "KEY METRICS",
    totalCapitalLabel: "TOTAL CAPITAL",
    totalCapitalValue: formatCurrency(data.totalAmountUsd),
    totalDealsLabel: "DEAL COUNT",
    totalDealsValue: `${data.totalDeals} Deals`,
    medianDealLabel: "MEDIAN SIZE",
    medianDealValue: formatCurrency(data.medianDealSize),
    momentumLabel: "MARKET MOMENTUM",
    momentumIndicator: `${momentum.icon} ${momentum.label}`,

    // ZONE 3: Detailed Data
    summaryTitle: "EXECUTIVE SUMMARY",
    executiveSummary,
    topDealsTitle: "TOP FUNDING ROUNDS",
    topDealsList: topDeals || "No deals recorded in this period",
    sectorTitle: "SECTOR BREAKDOWN",
    sectorBreakdown: sectorLines || "No sector data",
    investorsTitle: "MOST ACTIVE INVESTORS",
    topInvestorsList: topInvestorsLines || "No investor data",
    geoTitle: "GEOGRAPHIC DISTRIBUTION",
    geoBreakdownLine: geoBreakdownLine || "No geographic data",

    // ZONE 4: AI Analysis
    insightsTitle,
    insightsContent: data.insights?.slice(0, 1200) || "AI market analysis will be generated when the report is processed...",

    // ZONE 5: Footer
    disclaimer: "© NodeBench AI • Automated Market Intelligence • For informational purposes only. Data compiled from publicly available sources. This report does not constitute investment advice.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface FundingDeal {
  companyName: string;
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  leadInvestors: string[];
  sector?: string;
  location?: string;
  announcedAt: number;
  confidence?: number;
  verificationStatus?: string;
}

interface GeneratedReportResult {
  success: boolean;
  documentId?: string;
  fileName?: string;
  insightsGenerated: boolean;
  dealCount: number;
  totalAmountUsd: number;
  modelUsed?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a scheduled PDF report.
 * This is the main entry point for the cron job.
 */
export const generateScheduledReport = internalAction({
  args: {
    reportType: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly")),
    lookbackDays: v.optional(v.number()),
    distributeToChannels: v.optional(v.array(v.string())), // ["discord", "linkedin", "email"]
  },
  handler: async (ctx, args): Promise<GeneratedReportResult> => {
    const startTime = Date.now();
    const reportType = args.reportType;

    // Determine lookback period
    const lookbackDays = args.lookbackDays ?? (
      reportType === "weekly" ? 7 :
        reportType === "monthly" ? 30 :
          90 // quarterly
    );

    console.log(`[scheduledPDFReports] Starting ${reportType} report generation, lookback=${lookbackDays} days`);

    // Step 1: Fetch funding data
    let fundingData;
    try {
      fundingData = await ctx.runQuery(
        internal.domains.enrichment.fundingQueries.getFundingForScheduledReport,
        { lookbackDays, limit: 100 }
      );
    } catch (e) {
      console.error(`[scheduledPDFReports] Failed to fetch funding data:`, e);
      return {
        success: false,
        error: `Failed to fetch funding data: ${e instanceof Error ? e.message : String(e)}`,
        insightsGenerated: false,
        dealCount: 0,
        totalAmountUsd: 0,
      };
    }

    if (!fundingData || fundingData.length === 0) {
      console.log(`[scheduledPDFReports] No funding data found for period`);
      return {
        success: false,
        error: "No funding data available for the specified period",
        insightsGenerated: false,
        dealCount: 0,
        totalAmountUsd: 0,
      };
    }

    console.log(`[scheduledPDFReports] Found ${fundingData.length} deals`);

    // Step 2: Generate label
    const now = new Date();
    const quarterLabel = reportType === "weekly"
      ? `Week of ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
      : reportType === "monthly"
        ? now.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`;

    // Step 3: Generate AI insights
    let insights: string | undefined;
    let modelUsed: string | undefined;
    let insightsGenerated = false;

    try {
      const insightsResult = await ctx.runAction(
        internal.domains.documents.pdfInsights.generatePDFInsightsInternal,
        {
          deals: fundingData.map((d: FundingDeal) => ({
            companyName: d.companyName,
            roundType: d.roundType,
            amountRaw: d.amountRaw || "",
            amountUsd: d.amountUsd,
            leadInvestors: d.leadInvestors || [],
            sector: d.sector,
            location: d.location,
            announcedAt: d.announcedAt,
          })),
          quarterLabel,
        }
      );

      if (insightsResult.success && insightsResult.insights) {
        insights = insightsResult.insights;
        modelUsed = insightsResult.modelUsed;
        insightsGenerated = true;
        console.log(`[scheduledPDFReports] AI insights generated using ${modelUsed}`);
      }
    } catch (e) {
      console.warn(`[scheduledPDFReports] Failed to generate insights, continuing without:`, e);
    }

    // Step 4: Calculate statistics
    const totalAmountUsd = fundingData.reduce((sum: number, d: FundingDeal) => sum + (d.amountUsd || 0), 0);

    // Calculate sector breakdown
    const sectorMap = new Map<string, { count: number; amount: number }>();
    for (const deal of fundingData) {
      const sector = deal.sector || "Unknown";
      const existing = sectorMap.get(sector) || { count: 0, amount: 0 };
      sectorMap.set(sector, {
        count: existing.count + 1,
        amount: existing.amount + (deal.amountUsd || 0),
      });
    }

    const sectorBreakdown = Array.from(sectorMap.entries())
      .map(([sector, data]) => ({
        sector,
        dealCount: data.count,
        totalAmountUsd: data.amount,
        percentageOfTotal: totalAmountUsd > 0 ? (data.amount / totalAmountUsd) * 100 : 0,
      }))
      .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

    // Calculate round type breakdown
    const roundMap = new Map<string, { count: number; amount: number }>();
    for (const deal of fundingData) {
      const round = deal.roundType;
      const existing = roundMap.get(round) || { count: 0, amount: 0 };
      roundMap.set(round, {
        count: existing.count + 1,
        amount: existing.amount + (deal.amountUsd || 0),
      });
    }

    const roundTypeBreakdown = Array.from(roundMap.entries())
      .map(([roundType, data]) => ({
        roundType,
        dealCount: data.count,
        totalAmountUsd: data.amount,
        averageDealSize: data.count > 0 ? data.amount / data.count : 0,
      }))
      .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

    // Step 4b: Calculate JPMorgan-required metrics
    // Median deal size calculation
    const dealAmounts = fundingData
      .map((d: FundingDeal) => d.amountUsd || 0)
      .filter((a: number) => a > 0)
      .sort((a: number, b: number) => a - b);
    const medianDealSize = dealAmounts.length > 0
      ? dealAmounts.length % 2 === 0
        ? (dealAmounts[dealAmounts.length / 2 - 1] + dealAmounts[dealAmounts.length / 2]) / 2
        : dealAmounts[Math.floor(dealAmounts.length / 2)]
      : 0;

    // Stage groupings (JPM style: Seed/Series A vs Series B+)
    const earlyStageTypes = ["pre-seed", "seed", "series-a"];
    const earlyStageDeals = fundingData.filter((d: FundingDeal) => earlyStageTypes.includes(d.roundType)).length;
    const earlyStageAmount = fundingData
      .filter((d: FundingDeal) => earlyStageTypes.includes(d.roundType))
      .reduce((sum: number, d: FundingDeal) => sum + (d.amountUsd || 0), 0);
    const lateStageDeals = fundingData.filter((d: FundingDeal) => !earlyStageTypes.includes(d.roundType)).length;
    const lateStageAmount = fundingData
      .filter((d: FundingDeal) => !earlyStageTypes.includes(d.roundType))
      .reduce((sum: number, d: FundingDeal) => sum + (d.amountUsd || 0), 0);

    // Data cutoff date (JPM requirement: "Data through [date]")
    const dataCutoffDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Top investors calculation (JPM requirement: "Most Active Investors")
    const investorMap = new Map<string, { count: number; amount: number; sectors: Set<string> }>();
    for (const deal of fundingData) {
      for (const investor of deal.leadInvestors || []) {
        if (!investor || investor === "Undisclosed") continue;
        const existing = investorMap.get(investor) || { count: 0, amount: 0, sectors: new Set() };
        if (deal.sector) existing.sectors.add(deal.sector);
        investorMap.set(investor, {
          count: existing.count + 1,
          amount: existing.amount + (deal.amountUsd || 0),
          sectors: existing.sectors,
        });
      }
    }

    const topInvestors: TopInvestor[] = Array.from(investorMap.entries())
      .map(([name, data]) => ({
        name,
        dealCount: data.count,
        totalAmount: data.amount,
        sectors: Array.from(data.sectors),
      }))
      .sort((a, b) => b.dealCount - a.dealCount)
      .slice(0, 10);

    // Geographic breakdown calculation (JPM requirement)
    const geoMap = new Map<string, { count: number; amount: number }>();
    for (const deal of fundingData) {
      // Normalize location to region
      const location = deal.location || "Unknown";
      let region = "Unknown";
      if (location.includes("US") || location.includes("United States") || location.includes("California") || location.includes("New York") || location.includes("San Francisco")) {
        region = "United States";
      } else if (location.includes("UK") || location.includes("United Kingdom") || location.includes("London")) {
        region = "United Kingdom";
      } else if (location.includes("Europe") || location.includes("Germany") || location.includes("France") || location.includes("Netherlands")) {
        region = "Europe";
      } else if (location.includes("Asia") || location.includes("China") || location.includes("Japan") || location.includes("Singapore") || location.includes("India")) {
        region = "Asia";
      } else if (location.includes("Israel") || location.includes("Tel Aviv")) {
        region = "Israel";
      } else if (location !== "Unknown") {
        region = "Other";
      }

      const existing = geoMap.get(region) || { count: 0, amount: 0 };
      geoMap.set(region, {
        count: existing.count + 1,
        amount: existing.amount + (deal.amountUsd || 0),
      });
    }

    const geoBreakdown: GeoBreakdown[] = Array.from(geoMap.entries())
      .map(([region, data]) => ({
        region,
        dealCount: data.count,
        totalAmount: data.amount,
        percentage: totalAmountUsd > 0 ? (data.amount / totalAmountUsd) * 100 : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    // Step 5: Generate visual charts
    let sectorPieChart: string | undefined;
    let fundingBarChart: string | undefined;

    try {
      console.log(`[scheduledPDFReports] Generating visual charts...`);
      const [pieChart, barChart] = await Promise.all([
        generateSectorPieChart(sectorBreakdown),
        generateFundingBarChart(roundTypeBreakdown),
      ]);
      sectorPieChart = pieChart;
      fundingBarChart = barChart;
      console.log(`[scheduledPDFReports] Charts generated successfully`);
    } catch (e) {
      console.warn(`[scheduledPDFReports] Chart generation failed, continuing without:`, e);
    }

    // Step 6: Prepare data for PDF (JPMorgan-compliant structure)
    const pdfData: ReportData = {
      quarterLabel,
      generatedAt: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      dataCutoffDate,
      totalDeals: fundingData.length,
      totalAmountUsd,
      medianDealSize,
      deals: fundingData.map((d: FundingDeal) => ({
        companyName: d.companyName,
        roundType: d.roundType,
        amountRaw: d.amountRaw || "",
        amountUsd: d.amountUsd,
        leadInvestors: d.leadInvestors || [],
        sector: d.sector,
        location: d.location,
        announcedAt: d.announcedAt,
        confidence: d.confidence || 0.5,
        verificationStatus: d.verificationStatus || "unverified",
      })).sort((a: FundingDeal, b: FundingDeal) => (b.amountUsd || 0) - (a.amountUsd || 0)),
      sectorBreakdown,
      roundTypeBreakdown,
      topInvestors,
      geoBreakdown,
      insights,
      sectorPieChart,
      fundingBarChart,
      // JPMorgan-style stage groupings
      earlyStageDeals,
      earlyStageAmount,
      lateStageDeals,
      lateStageAmount,
    };

    // Step 7: Generate PDF using inline template with plugins
    let pdfBuffer: Uint8Array;
    try {
      const inputs = transformToTemplateInputs(pdfData);
      pdfBuffer = await generate({
        template: scheduledReportTemplate,
        inputs: [inputs],
        plugins: { text, image }, // Include image plugin for charts
      });
      console.log(`[scheduledPDFReports] PDF generated, size=${pdfBuffer.length} bytes`);
    } catch (e) {
      console.error(`[scheduledPDFReports] PDF generation failed:`, e);
      return {
        success: false,
        error: `PDF generation failed: ${e instanceof Error ? e.message : String(e)}`,
        insightsGenerated,
        dealCount: fundingData.length,
        totalAmountUsd,
        modelUsed,
      };
    }

    // Step 8: Upload to storage and create document
    const fileName = `${reportType}-funding-report-${quarterLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`;

    let documentId: string | undefined;
    try {
      // Upload PDF to storage - convert Uint8Array to ArrayBuffer for Blob constructor
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(pdfBuffer).buffer], { type: "application/pdf" }));

      // Create document record
      const result = await ctx.runMutation(
        internal.workflows.scheduledPDFReportsMutations.createScheduledReportDocument,
        {
          storageId,
          fileName,
          fileSize: pdfBuffer.length,
          reportType: reportType === "weekly" ? "weekly-digest" : "quarterly-funding-summary",
          title: `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Funding Report - ${quarterLabel}`,
          description: `Automated ${reportType} funding report with ${fundingData.length} deals totaling ${formatCurrency(totalAmountUsd)}`,
          metadata: {
            quarterLabel,
            totalDeals: fundingData.length,
            totalAmountUsd,
            generatedAt: new Date().toISOString(),
          },
        }
      );

      documentId = result.documentId;
      console.log(`[scheduledPDFReports] Report saved to Documents Hub: ${documentId}`);
    } catch (e) {
      console.error(`[scheduledPDFReports] Failed to save document:`, e);
      return {
        success: false,
        error: `Failed to save document: ${e instanceof Error ? e.message : String(e)}`,
        insightsGenerated,
        dealCount: fundingData.length,
        totalAmountUsd,
        modelUsed,
      };
    }

    // Step 9: Distribute to channels if requested
    if (args.distributeToChannels && args.distributeToChannels.length > 0) {
      await ctx.runAction(
        internal.workflows.scheduledPDFReports.distributeReport,
        {
          documentId: documentId!,
          channels: args.distributeToChannels,
          reportType,
          quarterLabel,
          dealCount: fundingData.length,
          totalAmountUsd,
          insights,
        }
      );
    }

    // Step 10: Record component analytics (mirrors dailyBriefInitializer pattern)
    try {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const componentMetrics: Array<{
        date: string;
        reportType: "funding_report";
        componentType: string;
        sourceName: string;
        category?: string;
        itemCount: number;
        freshnessHours?: number;
      }> = [];

      // Track deals by sector
      for (const sector of sectorBreakdown.slice(0, 8)) {
        componentMetrics.push({
          date: today,
          reportType: "funding_report",
          componentType: "funding_events",
          sourceName: sector.sector,
          category: "sector",
          itemCount: sector.dealCount,
          freshnessHours: lookbackDays * 24,
        });
      }

      // Track deals by round type
      for (const round of roundTypeBreakdown.slice(0, 6)) {
        componentMetrics.push({
          date: today,
          reportType: "funding_report",
          componentType: "funding_rounds",
          sourceName: round.roundType,
          category: "round_type",
          itemCount: round.dealCount,
          freshnessHours: lookbackDays * 24,
        });
      }

      // Track top investors activity
      for (const investor of topInvestors.slice(0, 5)) {
        componentMetrics.push({
          date: today,
          reportType: "funding_report",
          componentType: "investor_activity",
          sourceName: investor.name,
          category: "investors",
          itemCount: investor.dealCount,
          freshnessHours: lookbackDays * 24,
        });
      }

      if (componentMetrics.length > 0) {
        await ctx.runMutation(
          internal.domains.analytics.componentMetrics.batchRecordComponentMetrics,
          { metrics: componentMetrics }
        );
        console.log(`[scheduledPDFReports] Recorded ${componentMetrics.length} component metrics for ${today}`);
      }
    } catch (analyticsErr) {
      console.warn("[scheduledPDFReports] Analytics tracking failed (non-fatal):", analyticsErr);
    }

    const processingTimeMs = Date.now() - startTime;
    console.log(`[scheduledPDFReports] ${reportType} report completed in ${processingTimeMs}ms`);

    return {
      success: true,
      documentId,
      fileName,
      insightsGenerated,
      dealCount: fundingData.length,
      totalAmountUsd,
      modelUsed,
    };
  },
});

// Note: createScheduledReportDocument mutation is in scheduledPDFReportsMutations.ts
// (mutations cannot be defined in "use node" files)

/**
 * Distribute report to configured channels
 */
export const distributeReport = internalAction({
  args: {
    documentId: v.string(),
    channels: v.array(v.string()),
    reportType: v.string(),
    quarterLabel: v.string(),
    dealCount: v.number(),
    totalAmountUsd: v.number(),
    insights: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[scheduledPDFReports] Distributing report to channels: ${args.channels.join(", ")}`);

    const summary = `${args.reportType.charAt(0).toUpperCase() + args.reportType.slice(1)} Funding Report - ${args.quarterLabel}\n\n` +
      `Deals: ${args.dealCount}\n` +
      `Total Raised: ${formatCurrency(args.totalAmountUsd)}\n\n` +
      `View full report in Documents Hub.`;

    for (const channel of args.channels) {
      try {
        switch (channel) {
          case "discord": {
            // Get the default Discord channel from env
            const discordChannelId = process.env.DISCORD_REPORTS_CHANNEL_ID;
            if (discordChannelId) {
              await ctx.runAction(internal.domains.integrations.discord.sendMessage, {
                channelId: discordChannelId,
                content: summary,
                embeds: [{
                  title: `${args.reportType.charAt(0).toUpperCase() + args.reportType.slice(1)} Funding Report`,
                  description: `New automated report generated for ${args.quarterLabel}`,
                  color: 0x57f287, // Green
                  fields: [
                    { name: "Deals", value: String(args.dealCount), inline: true },
                    { name: "Total Raised", value: formatCurrency(args.totalAmountUsd), inline: true },
                  ],
                  footer: { text: "NodeBench AI - Automated Reports" },
                }],
              });
              console.log(`[scheduledPDFReports] Report notification sent to Discord`);
            }
            break;
          }
          case "linkedin": {
            // Post summary to LinkedIn
            await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, {
              text: `New ${args.reportType} funding report available!\n\n` +
                `${args.quarterLabel}\n` +
                `${args.dealCount} deals | ${formatCurrency(args.totalAmountUsd)} raised\n\n` +
                (args.insights ? `Key Insight:\n${args.insights.slice(0, 500)}...\n\n` : "") +
                `#VentureCapital #StartupFunding #FundingReport #NodeBenchAI`,
              target: "organization" as const,
            });
            console.log(`[scheduledPDFReports] Report summary posted to LinkedIn`);
            break;
          }
          case "ntfy": {
            // Send push notification via ntfy
            await ctx.runAction(internal.domains.integrations.ntfy.sendNotification, {
              title: `${args.reportType} Funding Report Ready`,
              message: `${args.dealCount} deals | ${formatCurrency(args.totalAmountUsd)} | ${args.quarterLabel}`,
              priority: "default",
              tags: ["chart_with_upwards_trend", "page_facing_up"],
            });
            console.log(`[scheduledPDFReports] Report notification sent to ntfy`);
            break;
          }
        }
      } catch (e) {
        console.error(`[scheduledPDFReports] Failed to distribute to ${channel}:`, e);
      }
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CRON ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Weekly report cron entry point (Monday 8:00 AM UTC)
 */
export const runWeeklyReportCron = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.workflows.scheduledPDFReports.generateScheduledReport, {
      reportType: "weekly",
      lookbackDays: 7,
      distributeToChannels: ["discord", "ntfy"], // Don't spam LinkedIn with weekly
    });
  },
});

/**
 * Monthly report cron entry point (1st of month, 9:00 AM UTC)
 */
export const runMonthlyReportCron = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.workflows.scheduledPDFReports.generateScheduledReport, {
      reportType: "monthly",
      lookbackDays: 30,
      distributeToChannels: ["discord", "linkedin", "ntfy"],
    });
  },
});

/**
 * Quarterly report cron entry point (1st of quarter, 10:00 AM UTC)
 * Only executes in quarter-start months: January, April, July, October
 */
export const runQuarterlyReportCron = internalAction({
  args: {},
  handler: async (ctx): Promise<GeneratedReportResult> => {
    // Quarter-start months: January (0), April (3), July (6), October (9)
    const currentMonth = new Date().getMonth();
    const quarterStartMonths = [0, 3, 6, 9];

    if (!quarterStartMonths.includes(currentMonth)) {
      console.log(`[scheduledPDFReports] Skipping quarterly report - current month ${currentMonth + 1} is not a quarter start`);
      return {
        success: false,
        error: `Not a quarter start month (current: ${currentMonth + 1}, expected: 1, 4, 7, or 10)`,
        insightsGenerated: false,
        dealCount: 0,
        totalAmountUsd: 0,
      };
    }

    console.log(`[scheduledPDFReports] Running quarterly report for Q${Math.ceil((currentMonth + 1) / 3)}`);
    return await ctx.runAction(internal.workflows.scheduledPDFReports.generateScheduledReport, {
      reportType: "quarterly",
      lookbackDays: 90,
      distributeToChannels: ["discord", "linkedin", "ntfy"],
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}
