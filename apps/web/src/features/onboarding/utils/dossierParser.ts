/**
 * Dossier Parser - Extract structured company dossiers from agent output
 *
 * Parses markdown/JSON output to extract company funding information
 */

import type { CompanyDossier } from '../CompanyDossierCard';

export interface FallbackMetadata {
  applied: boolean;
  originalDate?: string;
  expandedTo?: string;
  reason?: string;
}

/**
 * Parse agent output to extract company dossiers
 * Looks for structured data in tool results or markdown content
 */
export function parseDossiersFromOutput(
  toolParts: any[],
  textContent: string
): CompanyDossier[] {
  const dossiers: CompanyDossier[] = [];

  // First, try to extract from tool results (structured data)
  for (const part of toolParts) {
    if (part.type === 'tool-result' && part.result) {
      const result = typeof part.result === 'string' 
        ? tryParseJSON(part.result) 
        : part.result;

      if (result?.announcements && Array.isArray(result.announcements)) {
        // LinkUp/funding tool structured output
        for (const announcement of result.announcements) {
          dossiers.push({
            company: announcement.companyName || announcement.company || 'Undisclosed',
            round: announcement.fundingStage || announcement.round || 'Unknown',
            amount_usd: parseAmount(announcement.amountRaised || announcement.amount_usd),
            date: announcement.announcementDate || announcement.date,
            sector: announcement.sector || announcement.industry,
            lead_investors: announcement.leadInvestors || announcement.lead_investors || [],
            why_funded: announcement.keyHighlights || announcement.why_funded || [],
            founders: announcement.founders || [],
            notable_risks: announcement.notable_risks || [],
            source_url: announcement.newsUrl || announcement.source_url,
            description: announcement.description,
            location: announcement.location,
          });
        }
      }
    }
  }

  // If no structured data found, try to parse from markdown
  if (dossiers.length === 0 && textContent) {
    const markdownDossiers = parseMarkdownDossiers(textContent);
    dossiers.push(...markdownDossiers);
  }

  return dossiers;
}

/**
 * Extract fallback metadata from tool results
 * Looks for auto-fallback information from smartFundingSearch
 */
export function extractFallbackMetadata(toolParts: any[]): FallbackMetadata | undefined {
  for (const part of toolParts) {
    if (part.type === 'tool-result' && part.result) {
      const result = typeof part.result === 'string'
        ? tryParseJSON(part.result)
        : part.result;

      if (result?.fallback) {
        return {
          applied: result.fallback.applied || false,
          originalDate: result.fallback.originalDate,
          expandedTo: result.fallback.expandedTo,
          reason: result.fallback.reason,
        };
      }
    }
  }
  return undefined;
}

/**
 * Try to parse JSON from string, return null if fails
 */
function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Parse amount string to number (handles $40M, $2.5M, etc.)
 */
function parseAmount(amountStr?: string | number): number | undefined {
  if (typeof amountStr === 'number') return amountStr;
  if (!amountStr) return undefined;

  const cleaned = amountStr.replace(/[$,]/g, '').trim().toUpperCase();
  
  if (cleaned.includes('M')) {
    const num = parseFloat(cleaned.replace('M', ''));
    return num * 1000000;
  }
  
  if (cleaned.includes('K')) {
    const num = parseFloat(cleaned.replace('K', ''));
    return num * 1000;
  }
  
  if (cleaned.includes('B')) {
    const num = parseFloat(cleaned.replace('B', ''));
    return num * 1000000000;
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Parse markdown content to extract company dossiers
 * Looks for patterns like company names, funding amounts, etc.
 */
function parseMarkdownDossiers(markdown: string): CompanyDossier[] {
  const dossiers: CompanyDossier[] = [];
  
  // Look for company sections (e.g., "## Company Name" or "### Company Name")
  const companyPattern = /(?:^|\n)#{2,3}\s+(.+?)(?:\n|$)/g;
  const matches = [...markdown.matchAll(companyPattern)];
  
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const companyName = match[1].trim();
    const startIndex = match.index + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index : markdown.length;
    const section = markdown.slice(startIndex, endIndex);
    
    // Extract funding details from section
    const roundMatch = section.match(/(?:round|stage|series):\s*([^\n]+)/i);
    const amountMatch = section.match(/(?:amount|raised|funding):\s*\$?([0-9.]+\s*[MBK]?)/i);
    const investorsMatch = section.match(/(?:investors?|led by):\s*([^\n]+)/i);
    const sectorMatch = section.match(/(?:sector|industry):\s*([^\n]+)/i);
    
    dossiers.push({
      company: companyName,
      round: roundMatch ? roundMatch[1].trim() : 'Unknown',
      amount_usd: amountMatch ? parseAmount(amountMatch[1]) : undefined,
      sector: sectorMatch ? sectorMatch[1].trim() : undefined,
      lead_investors: investorsMatch 
        ? investorsMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean)
        : [],
      description: section.split('\n')[0]?.trim() || undefined,
    });
  }
  
  return dossiers.filter(d => d.company !== 'Unknown Company');
}

/**
 * Extract search criteria from user query
 */
export function extractSearchCriteria(query: string): {
  stages: string[];
  industries: string[];
  minAmount?: number;
  dateRange?: string;
} {
  const stages: string[] = [];
  const industries: string[] = [];
  let minAmount: number | undefined;
  let dateRange: string | undefined;

  const lowerQuery = query.toLowerCase();

  // Extract stages
  if (lowerQuery.includes('seed')) stages.push('Seed');
  if (lowerQuery.includes('series a')) stages.push('Series A');
  if (lowerQuery.includes('series b')) stages.push('Series B');

  // Extract industries
  if (lowerQuery.includes('healthcare')) industries.push('Healthcare');
  if (lowerQuery.includes('life science')) industries.push('Life Sciences');
  if (lowerQuery.includes('biotech')) industries.push('Biotech');
  if (lowerQuery.includes('tech')) industries.push('Tech');
  if (lowerQuery.includes('ai')) industries.push('AI');
  if (lowerQuery.includes('fintech')) industries.push('Fintech');

  // Extract minimum amount
  const amountMatch = lowerQuery.match(/>\s*\$?([0-9.]+)\s*([mbk])/i);
  if (amountMatch) {
    minAmount = parseAmount(`${amountMatch[1]}${amountMatch[2]}`);
  }

  // Extract date range
  if (lowerQuery.includes('today')) dateRange = 'today';
  else if (lowerQuery.includes('last 7 days') || lowerQuery.includes('past week')) dateRange = 'last 7 days';
  else if (lowerQuery.includes('last 30 days') || lowerQuery.includes('past month')) dateRange = 'last 30 days';

  return { stages, industries, minAmount, dateRange };
}

