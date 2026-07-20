/**
 * PDF Generation Module
 *
 * Exports for JPMorgan-style PDF report generation.
 */

// Main generator functions
export {
  generateQuarterlySummaryPDF,
  generateCompanyDossierPDF,
  generateWeeklyDigestPDF,
  aggregateFundingToQuarterly,
  pdfBlobToBase64,
  base64ToPdfBlob,
  getCurrentQuarterLabel,
  getCurrentWeekLabel,
} from "./pdfGenerator";

// Templates
export {
  quarterlyFundingBaseTemplate,
  companyDossierBaseTemplate,
  weeklyDigestBaseTemplate,
  transformQuarterlyDataToInputs,
  transformDossierDataToInputs,
  transformDigestDataToInputs,
} from "./pdfGenerator";

// Types
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
  InvestorActivity,
  FundingRoundDetail,
  PersonInfo,
  NewsItem,
  CompetitorInfo,
  DigestStory,
  SectorTrend,
  ActionItem,
} from "./types";
