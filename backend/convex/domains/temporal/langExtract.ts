/**
 * LangExtract Ingestion Pipeline
 * Vacuums up unstructured data dumps (Slack logs, GitHub PRs, News feeds,
 * legal dockets) and maps every entity to its exact source location.
 *
 * Uses local LLM (Ollama) or Gemini for entity extraction with
 * source-line-level attribution.
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface ExtractedEntity {
  name: string;
  type: "company" | "person" | "technology" | "product" | "event" | "metric" | "regulation" | "location";
  confidence: number;
  mentions: Array<{
    lineStart: number;
    lineEnd: number;
    excerpt: string;
    context: string;
  }>;
}

export interface ExtractedClaim {
  claimText: string;
  claimType: "factual" | "predictive" | "evaluative" | "causal";
  entities: string[];
  confidence: number;
  sourceSpan: {
    lineStart: number;
    lineEnd: number;
    excerpt: string;
  };
  temporalMarker?: string; // "Q3 2025", "next quarter", "by end of year"
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  claims: ExtractedClaim[];
  temporalMarkers: Array<{
    text: string;
    resolvedDate?: number;
    lineNumber: number;
  }>;
  numericFacts: Array<{
    metric: string;
    value: number;
    units?: string;
    context: string;
    lineNumber: number;
  }>;
  sourceMetadata: {
    totalLines: number;
    totalChars: number;
    extractionDurationMs: number;
  };
}

interface ServiceExtractionResponse {
  entities: Array<{
    name: string;
    type: ExtractedEntity["type"];
    confidence: number;
    mentions: Array<{
      line_start: number;
      line_end: number;
      excerpt: string;
      context: string;
    }>;
  }>;
  claims: Array<{
    claim_text: string;
    claim_type: ExtractedClaim["claimType"];
    entities_mentioned: string[];
    confidence: number;
    source_span: {
      line_start: number;
      line_end: number;
      excerpt: string;
    };
    temporal_marker?: string | null;
  }>;
  temporalMarkers?: Array<{
    text: string;
    resolved_date?: string | null;
    line_number: number;
  }>;
  temporal_markers?: Array<{
    text: string;
    resolved_date?: string | null;
    line_number: number;
  }>;
  numericFacts?: Array<{
    metric: string;
    value: number;
    units?: string;
    context: string;
    line_number: number;
  }>;
  numeric_facts?: Array<{
    metric: string;
    value: number;
    units?: string;
    context: string;
    line_number: number;
  }>;
  processingMs?: number;
  processing_ms?: number;
  sourceMetadata?: {
    totalLines: number;
    totalChars: number;
    extractionDurationMs: number;
  };
  lineCount?: number;
  textLength?: number;
}

type ExtractionArgs = {
  text: string;
  sourceType: "slack" | "github" | "jira" | "web" | "document" | "manual" | "system";
  streamKey?: string;
  entityKey?: string;
  ingestResults?: boolean;
  sourceLabel?: string;
};

const INGESTION_EXTRACT_BASE_URL = process.env.INGESTION_BASE_URL ?? "http://localhost:8011";

function parseResolvedDate(value: string | null | undefined) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizeServiceExtraction(payload: ServiceExtractionResponse): ExtractionResult {
  const temporalMarkersRaw = payload.temporalMarkers ?? payload.temporal_markers ?? [];
  const numericFactsRaw = payload.numericFacts ?? payload.numeric_facts ?? [];
  const processingMs =
    payload.processingMs ??
    payload.processing_ms ??
    payload.sourceMetadata?.extractionDurationMs ??
    0;
  const totalLines = payload.sourceMetadata?.totalLines ?? payload.lineCount ?? 0;
  const totalChars = payload.sourceMetadata?.totalChars ?? payload.textLength ?? 0;

  return {
    entities: payload.entities.map((entity) => ({
      name: entity.name,
      type: entity.type,
      confidence: entity.confidence,
      mentions: entity.mentions.map((mention) => ({
        lineStart: mention.line_start,
        lineEnd: mention.line_end,
        excerpt: mention.excerpt,
        context: mention.context,
      })),
    })),
    claims: payload.claims.map((claim) => ({
      claimText: claim.claim_text,
      claimType: claim.claim_type,
      entities: claim.entities_mentioned ?? [],
      confidence: claim.confidence,
      sourceSpan: {
        lineStart: claim.source_span.line_start,
        lineEnd: claim.source_span.line_end,
        excerpt: claim.source_span.excerpt,
      },
      temporalMarker: claim.temporal_marker ?? undefined,
    })),
    temporalMarkers: temporalMarkersRaw.map((marker) => ({
      text: marker.text,
      resolvedDate: parseResolvedDate(marker.resolved_date),
      lineNumber: marker.line_number,
    })),
    numericFacts: numericFactsRaw.map((fact) => ({
      metric: fact.metric,
      value: fact.value,
      units: fact.units,
      context: fact.context,
      lineNumber: fact.line_number,
    })),
    sourceMetadata: {
      totalLines,
      totalChars,
      extractionDurationMs: processingMs,
    },
  };
}

async function callExtractionService(args: ExtractionArgs): Promise<ExtractionResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${INGESTION_EXTRACT_BASE_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: args.text,
        sourceLabel: args.sourceLabel ?? `${args.sourceType}-extract`,
        lineOffset: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return null;
    }
    return normalizeServiceExtraction((await response.json()) as ServiceExtractionResponse);
  } catch {
    return null;
  }
}

/* ================================================================== */
/* DETERMINISTIC EXTRACTION (no LLM — pattern-based)                   */
/* ================================================================== */

/**
 * Extract entities using regex patterns.
 * Fast, deterministic, no API calls. Used as first pass before LLM refinement.
 */
function extractEntitiesRegex(text: string): ExtractedEntity[] {
  const lines = text.split("\n");
  const entityMap = new Map<string, ExtractedEntity>();

  // Company patterns: capitalized multi-word or known suffixes
  const companyPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Inc|Corp|Ltd|LLC|AG|GmbH|SA|PLC|Co)\.?))\b/g;
  // Monetary values
  const moneyPattern = /\$[\d,.]+\s*(?:million|billion|M|B|K|mn|bn)?/gi;
  // Percentage values
  const percentPattern = /[\d.]+%/g;
  // Technology names (camelCase or known patterns)
  const techPattern = /\b(?:AI|ML|LLM|GPT|BERT|Transformer|Kubernetes|Docker|React|Node\.js|Python|TypeScript|Rust|Go|Java|PostgreSQL|Redis|MongoDB|GraphQL|REST|gRPC|WebSocket|OAuth|JWT|SAML|SSO|MCP|API|SDK|CLI|CI\/CD|DevOps|MLOps|SRE)\b/gi;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Extract companies
    let match: RegExpExecArray | null;
    companyPattern.lastIndex = 0;
    while ((match = companyPattern.exec(line)) !== null) {
      const name = match[1].trim();
      if (name.length < 3) continue;
      const existing = entityMap.get(name);
      if (existing) {
        existing.mentions.push({
          lineStart: lineNum,
          lineEnd: lineNum,
          excerpt: match[0],
          context: line.trim().slice(0, 200),
        });
        existing.confidence = Math.min(0.95, existing.confidence + 0.1);
      } else {
        entityMap.set(name, {
          name,
          type: "company",
          confidence: 0.6,
          mentions: [{
            lineStart: lineNum,
            lineEnd: lineNum,
            excerpt: match[0],
            context: line.trim().slice(0, 200),
          }],
        });
      }
    }

    // Extract technology mentions
    techPattern.lastIndex = 0;
    while ((match = techPattern.exec(line)) !== null) {
      const name = match[0];
      const existing = entityMap.get(name);
      if (existing) {
        existing.mentions.push({
          lineStart: lineNum,
          lineEnd: lineNum,
          excerpt: name,
          context: line.trim().slice(0, 200),
        });
      } else {
        entityMap.set(name, {
          name,
          type: "technology",
          confidence: 0.8,
          mentions: [{
            lineStart: lineNum,
            lineEnd: lineNum,
            excerpt: name,
            context: line.trim().slice(0, 200),
          }],
        });
      }
    }
  }

  return Array.from(entityMap.values());
}

/**
 * Extract numeric facts from text using regex.
 */
function extractNumericFacts(text: string): Array<{
  metric: string;
  value: number;
  units?: string;
  context: string;
  lineNumber: number;
}> {
  const lines = text.split("\n");
  const facts: Array<{
    metric: string;
    value: number;
    units?: string;
    context: string;
    lineNumber: number;
  }> = [];

  const patterns = [
    // $X million/billion
    { regex: /\$(\d+(?:[.,]\d+)?)\s*(million|billion|M|B|K|mn|bn)/gi, type: "monetary" },
    // X% increase/decrease/growth
    { regex: /(\d+(?:\.\d+)?)\s*%\s*(increase|decrease|growth|decline|drop|rise|up|down)?/gi, type: "percentage" },
    // revenue/cost/profit of $X
    { regex: /(revenue|cost|profit|loss|funding|valuation|ARR|MRR|burn rate|runway)\s+(?:of\s+)?\$(\d+(?:[.,]\d+)?)\s*(million|billion|M|B|K|mn|bn)?/gi, type: "financial" },
  ];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    for (const { regex, type } of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        let value: number;
        let units: string | undefined;

        if (type === "monetary") {
          value = parseFloat(match[1].replace(/,/g, ""));
          const multiplier = match[2];
          if (/billion|B|bn/i.test(multiplier)) { value *= 1e9; units = "USD"; }
          else if (/million|M|mn/i.test(multiplier)) { value *= 1e6; units = "USD"; }
          else if (/K/i.test(multiplier)) { value *= 1e3; units = "USD"; }
        } else if (type === "percentage") {
          value = parseFloat(match[1]);
          units = "percent";
        } else {
          value = parseFloat(match[2]?.replace(/,/g, "") ?? "0");
          const multiplier = match[3] ?? "";
          if (/billion|B|bn/i.test(multiplier)) value *= 1e9;
          else if (/million|M|mn/i.test(multiplier)) value *= 1e6;
          units = "USD";
        }

        facts.push({
          metric: type === "monetary" ? "funding_amount" : type === "percentage" ? "growth_rate" : match[1],
          value,
          units,
          context: line.trim().slice(0, 200),
          lineNumber: lineNum,
        });
      }
    }
  }

  return facts;
}

/**
 * Extract temporal markers from text.
 */
function extractTemporalMarkers(text: string): Array<{
  text: string;
  resolvedDate?: number;
  lineNumber: number;
}> {
  const lines = text.split("\n");
  const markers: Array<{ text: string; resolvedDate?: number; lineNumber: number }> = [];

  const temporalPatterns = [
    /\b(Q[1-4]\s+\d{4})\b/gi,
    /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi,
    /\b(\d{4}-\d{2}-\d{2})\b/g,
    /\b(next\s+(?:week|month|quarter|year))\b/gi,
    /\b(last\s+(?:week|month|quarter|year))\b/gi,
    /\b(by\s+(?:end\s+of\s+)?(?:Q[1-4]|year|month)(?:\s+\d{4})?)\b/gi,
    /\b(FY\s*\d{2,4})\b/gi,
    /\b(H[12]\s+\d{4})\b/gi,
  ];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    for (const pattern of temporalPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        let resolvedDate: number | undefined;

        // Try to resolve ISO dates
        if (/^\d{4}-\d{2}-\d{2}$/.test(match[1])) {
          resolvedDate = new Date(match[1]).getTime();
        }

        // Try to resolve "Month Year"
        const monthYear = match[1].match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
        if (monthYear) {
          resolvedDate = new Date(`${monthYear[1]} 1, ${monthYear[2]}`).getTime();
        }

        markers.push({
          text: match[1],
          resolvedDate: resolvedDate && !isNaN(resolvedDate) ? resolvedDate : undefined,
          lineNumber: lineNum,
        });
      }
    }
  }

  return markers;
}

/* ================================================================== */
/* MAIN EXTRACTION ACTION                                              */
/* ================================================================== */

/**
 * Extract entities, claims, temporal markers, and numeric facts from raw text.
 * Deterministic regex-based extraction — no LLM required.
 *
 * For production, chain with LLM refinement:
 * 1. Regex pass (fast, deterministic) → extract candidates
 * 2. LLM pass (Ollama/Gemini) → validate, classify, link
 */
export const extractFromText = action({
  args: {
    text: v.string(),
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    streamKey: v.optional(v.string()),
    entityKey: v.optional(v.string()),
    ingestResults: v.optional(v.boolean()),
    sourceLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExtractionResult> => {
    const startTime = Date.now();
    const serviceResult = await callExtractionService(args);

    const entities = extractEntitiesRegex(args.text);
    const numericFacts = extractNumericFacts(args.text);
    const temporalMarkers = extractTemporalMarkers(args.text);

    // Simplified claim extraction (regex-based — LLM refinement comes in Phase 2)
    const claims: ExtractedClaim[] = [];

    const result: ExtractionResult = serviceResult ?? {
      entities,
      claims,
      temporalMarkers,
      numericFacts,
      sourceMetadata: {
        totalLines: args.text.split("\n").length,
        totalChars: args.text.length,
        extractionDurationMs: Date.now() - startTime,
      },
    };

    // Optionally ingest numeric facts as observations
    if (args.ingestResults && args.streamKey && result.numericFacts.length > 0) {
      const observations = result.numericFacts.map((fact) => ({
        observedAt: Date.now(),
        observationType: "numeric" as const,
        valueNumber: fact.value,
        headline: fact.metric,
        summary: fact.context,
        sourceExcerpt: fact.context,
        tags: [fact.metric, args.sourceType],
      }));

      await ctx.runAction(api.domains.temporal.ingestion.runIngestionPipeline, {
        streamKey: args.streamKey,
        sourceType: args.sourceType,
        entityKey: args.entityKey,
        observations,
        detectSignals: true,
      });
    }

    return result;
  },
});

/**
 * Ingest a large document by chunking and extracting in parallel.
 * Handles 100+ page dumps by splitting into manageable chunks.
 */
export const ingestLargeDocument = action({
  args: {
    text: v.string(),
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    streamKey: v.string(),
    entityKey: v.optional(v.string()),
    chunkSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const chunkSize = args.chunkSize ?? 5000; // lines per chunk
    const lines = args.text.split("\n");
    const totalChunks = Math.ceil(lines.length / chunkSize);
    const ingestionRunId = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const results: ExtractionResult[] = [];

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const start = chunkIdx * chunkSize;
      const end = Math.min(start + chunkSize, lines.length);
      const chunkText = lines.slice(start, end).join("\n");

      const result = await ctx.runAction(api.domains.temporal.langExtract.extractFromText, {
        text: chunkText,
        sourceType: args.sourceType,
        streamKey: `${args.streamKey}_chunk${chunkIdx}`,
        entityKey: args.entityKey,
        ingestResults: true,
      });

      results.push(result);
    }

    // Merge entity mentions across chunks
    const mergedEntities = new Map<string, ExtractedEntity>();
    for (const r of results) {
      for (const entity of r.entities) {
        const existing = mergedEntities.get(entity.name);
        if (existing) {
          existing.mentions.push(...entity.mentions);
          existing.confidence = Math.min(0.99, existing.confidence + 0.05);
        } else {
          mergedEntities.set(entity.name, { ...entity });
        }
      }
    }

    return {
      ingestionRunId,
      totalLines: lines.length,
      totalChunks,
      entities: Array.from(mergedEntities.values())
        .sort((a, b) => b.mentions.length - a.mentions.length),
      totalNumericFacts: results.reduce((sum, r) => sum + r.numericFacts.length, 0),
      totalTemporalMarkers: results.reduce((sum, r) => sum + r.temporalMarkers.length, 0),
      totalExtractionMs: results.reduce((sum, r) => sum + r.sourceMetadata.extractionDurationMs, 0),
    };
  },
});
