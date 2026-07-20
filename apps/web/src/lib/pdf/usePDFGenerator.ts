/**
 * usePDFGenerator Hook
 *
 * React hook for generating JPMorgan-style PDF reports.
 * Handles loading states, error handling, and saving to Documents Hub.
 */

import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  generateQuarterlySummaryPDF,
  generateCompanyDossierPDF,
  generateWeeklyDigestPDF,
  aggregateFundingToQuarterly,
  getCurrentQuarterLabel,
} from "./pdfGenerator";
import type {
  QuarterlyFundingSummaryData,
  CompanyDossierData,
  WeeklyDigestData,
  PDFReportResult,
  FundingDealRow,
  ReportType,
} from "./types";

interface PDFGeneratorState {
  isGenerating: boolean;
  isSaving: boolean;
  error: Error | null;
  lastResult: PDFReportResult | null;
  lastSavedDocumentId: string | null;
}

interface SaveToDocumentsOptions {
  title?: string;
  description?: string;
  tags?: string[];
}

interface UsePDFGeneratorReturn extends PDFGeneratorState {
  generateQuarterlySummary: (
    data: QuarterlyFundingSummaryData,
    download?: boolean
  ) => Promise<PDFReportResult>;
  generateCompanyDossier: (
    data: CompanyDossierData,
    download?: boolean
  ) => Promise<PDFReportResult>;
  generateWeeklyDigest: (
    data: WeeklyDigestData,
    download?: boolean
  ) => Promise<PDFReportResult>;
  generateFromFundingEvents: (
    events: FundingDealRow[],
    quarterLabel?: string,
    insights?: string,
    download?: boolean
  ) => Promise<PDFReportResult>;
  saveToDocuments: (
    result: PDFReportResult,
    options?: SaveToDocumentsOptions,
    metadata?: Record<string, any>
  ) => Promise<{ documentId: string; fileId: string }>;
  generateAndSave: (
    events: FundingDealRow[],
    quarterLabel?: string,
    insights?: string,
    options?: SaveToDocumentsOptions
  ) => Promise<{ result: PDFReportResult; documentId: string }>;
  clearError: () => void;
}

/**
 * Hook for PDF generation with loading states, error handling, and Documents Hub integration.
 */
export function usePDFGenerator(): UsePDFGeneratorReturn {
  const [state, setState] = useState<PDFGeneratorState>({
    isGenerating: false,
    isSaving: false,
    error: null,
    lastResult: null,
    lastSavedDocumentId: null,
  });

  // Convex mutations
  const generateUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const createReportDocument = useMutation(api.domains.documents.reportDocuments.createReportDocument);

  const generateQuarterlySummary = useCallback(
    async (
      data: QuarterlyFundingSummaryData,
      download = true
    ): Promise<PDFReportResult> => {
      setState((prev) => ({ ...prev, isGenerating: true, error: null }));

      try {
        const result = await generateQuarterlySummaryPDF(data, { download });
        setState((prev) => ({ ...prev, isGenerating: false, lastResult: result }));
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState((prev) => ({ ...prev, isGenerating: false, error: err }));
        throw err;
      }
    },
    []
  );

  const generateCompanyDossier = useCallback(
    async (
      data: CompanyDossierData,
      download = true
    ): Promise<PDFReportResult> => {
      setState((prev) => ({ ...prev, isGenerating: true, error: null }));

      try {
        const result = await generateCompanyDossierPDF(data, { download });
        setState((prev) => ({ ...prev, isGenerating: false, lastResult: result }));
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState((prev) => ({ ...prev, isGenerating: false, error: err }));
        throw err;
      }
    },
    []
  );

  const generateWeeklyDigest = useCallback(
    async (
      data: WeeklyDigestData,
      download = true
    ): Promise<PDFReportResult> => {
      setState((prev) => ({ ...prev, isGenerating: true, error: null }));

      try {
        const result = await generateWeeklyDigestPDF(data, { download });
        setState((prev) => ({ ...prev, isGenerating: false, lastResult: result }));
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState((prev) => ({ ...prev, isGenerating: false, error: err }));
        throw err;
      }
    },
    []
  );

  /**
   * Generate a quarterly summary directly from funding events.
   */
  const generateFromFundingEvents = useCallback(
    async (
      events: FundingDealRow[],
      quarterLabel?: string,
      insights?: string,
      download = true
    ): Promise<PDFReportResult> => {
      const data = aggregateFundingToQuarterly(
        events,
        quarterLabel || getCurrentQuarterLabel(),
        insights
      );
      return generateQuarterlySummary(data, download);
    },
    [generateQuarterlySummary]
  );

  /**
   * Save a generated PDF to the Documents Hub.
   */
  const saveToDocuments = useCallback(
    async (
      result: PDFReportResult,
      options?: SaveToDocumentsOptions,
      metadata?: Record<string, any>
    ): Promise<{ documentId: string; fileId: string }> => {
      setState((prev) => ({ ...prev, isSaving: true, error: null }));

      try {
        // 1. Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // 2. Upload the PDF blob
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: result.blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        const { storageId } = await uploadResponse.json();

        // 3. Create the document record
        const defaultTitle = getDefaultTitle(result.reportType, metadata);
        const defaultDescription = getDefaultDescription(result.reportType, metadata);

        const { documentId, fileId } = await createReportDocument({
          storageId,
          fileName: result.fileName,
          fileSize: result.blob.size,
          reportType: result.reportType as any,
          title: options?.title || defaultTitle,
          description: options?.description || defaultDescription,
          tags: options?.tags,
          metadata: metadata as any,
        });

        setState((prev) => ({
          ...prev,
          isSaving: false,
          lastSavedDocumentId: documentId,
        }));

        return { documentId, fileId };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState((prev) => ({ ...prev, isSaving: false, error: err }));
        throw err;
      }
    },
    [generateUploadUrl, createReportDocument]
  );

  /**
   * Generate a PDF and immediately save it to Documents Hub.
   */
  const generateAndSave = useCallback(
    async (
      events: FundingDealRow[],
      quarterLabel?: string,
      insights?: string,
      options?: SaveToDocumentsOptions
    ): Promise<{ result: PDFReportResult; documentId: string }> => {
      // Generate without download
      const label = quarterLabel || getCurrentQuarterLabel();
      const data = aggregateFundingToQuarterly(events, label, insights);
      const result = await generateQuarterlySummary(data, false);

      // Save to documents
      const metadata = {
        quarterLabel: label,
        totalDeals: data.totalDeals,
        totalAmountUsd: data.totalAmountUsd,
        generatedAt: data.generatedAt,
      };

      const { documentId } = await saveToDocuments(result, options, metadata);

      return { result, documentId };
    },
    [generateQuarterlySummary, saveToDocuments]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    generateQuarterlySummary,
    generateCompanyDossier,
    generateWeeklyDigest,
    generateFromFundingEvents,
    saveToDocuments,
    generateAndSave,
    clearError,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function getDefaultTitle(reportType: ReportType, metadata?: Record<string, any>): string {
  switch (reportType) {
    case "quarterly-funding-summary":
      return `Funding Summary - ${metadata?.quarterLabel || getCurrentQuarterLabel()}`;
    case "company-dossier":
      return `Company Dossier - ${metadata?.companyName || "Unknown"}`;
    case "weekly-digest":
      return `Weekly Digest - ${metadata?.weekLabel || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    default:
      return `Report - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
}

function getDefaultDescription(reportType: ReportType, metadata?: Record<string, any>): string {
  switch (reportType) {
    case "quarterly-funding-summary":
      const deals = metadata?.totalDeals || 0;
      const amount = metadata?.totalAmountUsd || 0;
      return `Quarterly funding summary with ${deals} deals totaling ${formatCurrency(amount)}`;
    case "company-dossier":
      return `Deep-dive analysis of ${metadata?.companyName || "company"}`;
    case "weekly-digest":
      return `Weekly intelligence digest for ${metadata?.persona || "all personas"}`;
    default:
      return "Generated report";
  }
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

export default usePDFGenerator;
