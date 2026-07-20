"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";
import { runPiOrAiSdkCompletion } from "../pipelines/piRuntime";
import { linkupSearch } from "../../tools/media/linkupSearch";
import { getStockPrice } from "../../domains/agents/core/subagents/openbb_subagent/tools/equityTools";

type SourceMatrixItem = {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  sourceType?: "primary" | "secondary";
  credibility?: "high" | "medium-high" | "medium" | "low";
};

// ═══════════════════════════════════════════════════════════════════════════
// BANKER-GRADE ENRICHMENT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

type FundingAmount = {
  amount: number;
  currency: string;
  unit: "M" | "B" | "K";
};

type FundingRound = {
  roundType: string;
  announcedDate?: string;
  amount?: FundingAmount;
  coLeads?: string[];
  participants?: string[];
  useOfProceeds?: string;
};

type FundingData = {
  stage?: string;
  totalRaised?: FundingAmount | null;
  lastRound?: FundingRound | null;
  valuation?: FundingAmount | null;
  bankerTakeaway?: string;
};

type PersonEntry = {
  name: string;
  role?: string;
  background?: string;
  credentials?: Array<{ type: string; verifiedBy?: string }>;
  backgroundHighlights?: string[];
  linkedinUrl?: string | null;
  email?: string | null;
};

type PeopleData = {
  founders?: PersonEntry[];
  executives?: PersonEntry[];
  board?: string[];
  advisorNotes?: string;
};

type LeadProgram = {
  program: string;
  indications?: string[];
  stage?: string;
  notes?: string;
};

type ProductPipeline = {
  platform?: string;
  modalities?: string[];
  leadPrograms?: LeadProgram[];
  differentiation?: string[];
  leadAsset?: {
    name?: string;
    class?: string;
    originator?: string;
    licensedRights?: string;
    regulatory?: string[];
    indicationFocus?: string[];
  };
};

type NewsItem = {
  title: string;
  publishedDate?: string;
  url?: string;
  type?: string;
  keyClaims?: string[];
};

type ContactPoint = {
  channel: string;
  value: string;
  purpose?: string;
};

type ContactPoints = {
  primary?: ContactPoint;
  media?: ContactPoint;
  other?: ContactPoint[];
  outreachAngles?: string[];
};

type Freshness = {
  newsAgeDays: number | null;
  withinBankerWindow: boolean;
};

type PersonaResult = {
  intent?: string;
  requiresNewsWithinDays?: number;
  passCriteria: string[];
  failTriggers: string[];
};

type PersonaHooks = {
  JPM_STARTUP_BANKER?: PersonaResult;
  EARLY_STAGE_VC?: PersonaResult;
  CTO_TECH_LEAD?: PersonaResult;
  FOUNDER_STRATEGY?: PersonaResult;
  ACADEMIC_RD?: PersonaResult;
  ENTERPRISE_EXEC?: PersonaResult;
  ECOSYSTEM_PARTNER?: PersonaResult;
  QUANT_ANALYST?: PersonaResult;
  PRODUCT_DESIGNER?: PersonaResult;
  SALES_ENGINEER?: PersonaResult;
};

type EnrichedSource = {
  name: string;
  url: string;
  snippet?: string;
  sourceType?: "primary" | "secondary";
  credibility?: "high" | "medium-high" | "medium" | "low";
};

type PerformanceMetrics = {
  failureRate?: number; // percentage
  churn?: number; // percentage
  latency?: number; // ms
  uptime?: number; // percentage (e.g. 99.99)
};

type Financials = {
  burnRate?: number; // monthly burn in USD
  costToServe?: number; // cost per user/unit
  unitEconomics?: string; // description or metric
  revenue?: number; // annual revenue
};

type AcademicData = {
  methodology?: string; // specific approach (e.g. "P7C3-class compounds")
  citations?: number;
  pValue?: number;
  sampleSize?: number;
};

type EcosystemData = {
  dependencies?: string[]; // upstream
  downstreamImpact?: string[]; // who relies on this
  secondOrderEffects?: string[]; // market ripples
};

type TechnicalSpecs = {
  cveIds?: string[];
  repoStats?: {
    stars: number;
    forks: number;
    issues: number;
    contributors: number;
    starVelocity?: number; // stars per week
  };
  stackDependencies?: string[];
};

// Legacy flat payload (kept for backward compatibility)
type EntityInsightPayload = {
  summary?: string | null;
  hqLocation?: string | null;
  foundedYear?: number | null;
  founders?: string[];
  foundersBackground?: string | null;
  website?: string | null;
  industry?: string | null;
  businessModel?: string | null;
  fundingStage?: string | null;
  totalFunding?: string | null;
  lastFundingDate?: string | null;
  investors?: string[];
  competitors?: string[];
  keyPeople?: Array<{ name: string; title: string }>;
  ticker?: string | null;
  keyFacts?: string[];
  dataQuality?: "verified" | "partial" | "incomplete";
};

// Full banker-grade enriched entity
export type EnrichedEntityPayload = {
  entityId?: string;
  entityType?: "private_company" | "public_company" | "oss_project" | "research_signal" | "model_platform" | "person";
  canonicalName?: string;
  asOf?: string;
  summary?: string;
  crmFields?: Record<string, any>;
  funding?: FundingData;
  people?: PeopleData;
  productPipeline?: ProductPipeline;
  // Banker-Grade Additions
  performanceMetrics?: PerformanceMetrics;
  financials?: Financials;
  academicData?: AcademicData;
  ecosystem?: EcosystemData;
  technicalSpecs?: TechnicalSpecs;
  recentNews?: { items: NewsItem[] };
  contactPoints?: ContactPoints;
  sources?: EnrichedSource[];
  freshness?: Freshness;
  personaHooks?: PersonaHooks;
  // Legacy fields for backward compatibility
  keyFacts?: string[];
  stockPrice?: { price: number; asOf?: string } | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// FRESHNESS & PERSONA HOOKS
// ═══════════════════════════════════════════════════════════════════════════

function calculateFreshness(recentNews: NewsItem[]): Freshness {
  if (!recentNews || recentNews.length === 0) {
    return { newsAgeDays: null, withinBankerWindow: false };
  }
  const latestDateStr = recentNews[0]?.publishedDate;
  if (!latestDateStr) {
    return { newsAgeDays: null, withinBankerWindow: false };
  }
  const latestDate = new Date(latestDateStr);
  if (isNaN(latestDate.getTime())) {
    return { newsAgeDays: null, withinBankerWindow: false };
  }
  const ageDays = Math.floor((Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
  return {
    newsAgeDays: ageDays,
    withinBankerWindow: ageDays <= 30,
  };
}

export function evaluateBankerPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  // Funding validation
  if (entity.funding?.lastRound?.roundType) {
    passCriteria.push(`funding.lastRound.roundType === '${entity.funding.lastRound.roundType}'`);
  } else {
    failTriggers.push("funding.lastRound.roundType missing");
  }

  // Location validation
  if (entity.crmFields?.hqLocation) {
    passCriteria.push("crmFields.hqLocation != null");
  } else {
    failTriggers.push("crmFields.hqLocation missing");
  }

  // Contact validation
  if (entity.contactPoints?.primary?.value) {
    const hasEmail = entity.contactPoints.primary.value.includes("@");
    passCriteria.push(hasEmail ? "contactPoints.primary.value includes '@'" : "contactPoints.primary present");
  } else {
    failTriggers.push("contactPoints.primary missing");
  }

  // News validation
  if (entity.recentNews?.items && entity.recentNews.items.length > 0) {
    passCriteria.push(`recentNews.items.length >= ${entity.recentNews.items.length}`);
  } else {
    failTriggers.push("recentNews.items empty");
  }

  // Source validation
  const primarySources = entity.sources?.filter(s => s.sourceType === "primary") ?? [];
  if (primarySources.length > 0) {
    passCriteria.push(`sources contains >= ${primarySources.length} primary source(s)`);
  } else {
    failTriggers.push("no primary source");
  }

  // Product pipeline validation (AUDIT_MOCKS requirement)
  if (entity.productPipeline?.leadPrograms && entity.productPipeline.leadPrograms.length > 0) {
    passCriteria.push(`productPipeline.leadPrograms.length >= ${entity.productPipeline.leadPrograms.length}`);
  } else {
    failTriggers.push("productPipeline.leadPrograms missing (resolve via runtime enrichment)");
  }

  // Freshness validation
  if (entity.freshness?.withinBankerWindow) {
    passCriteria.push("news within 30 days");
  } else {
    failTriggers.push("news stale (>30 days)");
  }

  return {
    intent: "Weekly outbound target with verified funding and direct contact channels.",
    requiresNewsWithinDays: 30,
    passCriteria,
    failTriggers,
  };
}

export function evaluateVCPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  // Investor validation
  if (entity.funding?.lastRound?.participants && entity.funding.lastRound.participants.length > 0) {
    passCriteria.push(`funding.participants includes ${entity.funding.lastRound.participants.length} investor(s)`);
  } else {
    failTriggers.push("funding.participants missing");
  }

  // Product thesis validation
  if (entity.productPipeline?.platform) {
    passCriteria.push("clear thesis hook in productPipeline.platform");
  }
  if (entity.productPipeline?.modalities && entity.productPipeline.modalities.length > 0) {
    passCriteria.push(`productPipeline.modalities includes ${entity.productPipeline.modalities.join(", ")}`);
  }
  if (!entity.productPipeline?.platform && !entity.productPipeline?.leadPrograms?.length) {
    failTriggers.push("no clear product thesis");
  }

  // Differentiation / competitive mapping
  if (entity.productPipeline?.differentiation && entity.productPipeline.differentiation.length > 0) {
    passCriteria.push(`productPipeline.differentiation has ${entity.productPipeline.differentiation.length} point(s)`);
  } else {
    failTriggers.push("no competitive landscape mapping attached");
  }

  // Freshness for VC (more lenient than banker)
  if (entity.freshness?.newsAgeDays != null && entity.freshness.newsAgeDays <= 60) {
    passCriteria.push("news within 60 days");
  } else {
    failTriggers.push("news stale (>60 days)");
  }

  return {
    intent: "Thesis generation & competitive mapping.",
    requiresNewsWithinDays: 60,
    passCriteria,
    failTriggers,
  };
}

export function evaluateCTOPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.productPipeline?.platform) {
    passCriteria.push("productPipeline.platform defined");
  }

  if (entity.technicalSpecs?.cveIds && entity.technicalSpecs.cveIds.length > 0) {
    passCriteria.push(`technicalSpecs.cveIds found: ${entity.technicalSpecs.cveIds.join(", ")}`);
  } else if (entity.entityType === "oss_project" || entity.entityType === "model_platform") {
    // Only strict fail if it's technical
    passCriteria.push("no CVEs listed (safe or missing)");
  }

  if (entity.technicalSpecs?.repoStats) {
    passCriteria.push("repoStats valid");
  } else if (entity.entityType === "oss_project") {
    failTriggers.push("missing repoStats for OSS project");
  }

  if (entity.ecosystem?.dependencies && entity.ecosystem.dependencies.length > 0) {
    passCriteria.push("upstream dependencies mapped");
  } else {
    failTriggers.push("no technical dependency map");
  }

  return {
    intent: "Technical due diligence and integration assessment.",
    requiresNewsWithinDays: 90,
    passCriteria,
    failTriggers,
  };
}

export function evaluateFounderStrategyPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.funding?.bankerTakeaway) {
    passCriteria.push("bankerTakeaway strategic insight exists");
  }

  // Pivot/Strategy validation
  if (entity.performanceMetrics?.churn !== undefined || entity.performanceMetrics?.failureRate !== undefined) {
    passCriteria.push("pivot justification metrics (churn/failure) present");
  } else {
    failTriggers.push("no churn or failure metrics to justify strategy");
  }

  if (entity.productPipeline?.differentiation && entity.productPipeline.differentiation.length > 0) {
    passCriteria.push("differentiation points defined");
  }

  return {
    intent: "Strategic pivot analysis backed by filings/data.",
    requiresNewsWithinDays: 90,
    passCriteria,
    failTriggers,
  };
}

export function evaluateAcademicRDPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  const hasPrimarySource = entity.sources?.some(s => s.sourceType === "primary");
  if (hasPrimarySource) {
    passCriteria.push("primary source/literature anchor exists");
  } else {
    failTriggers.push("no primary literature source");
  }

  if (entity.academicData?.methodology) {
    passCriteria.push(`methodology defined: ${entity.academicData.methodology.substring(0, 20)}...`);
  } else {
    failTriggers.push("missing methodology (mechanism of action)");
  }

  if (entity.academicData?.citations !== undefined) {
    passCriteria.push("citation impact available");
  }

  return {
    intent: "Literature anchor with methodology verification.",
    requiresNewsWithinDays: 365,
    passCriteria,
    failTriggers,
  };
}

export function evaluateEnterpriseExecPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.funding?.stage) {
    passCriteria.push("funding stage clarity for risk assessment");
  }

  if (entity.financials?.costToServe !== undefined || entity.financials?.burnRate !== undefined) {
    passCriteria.push("financial/cost impact metrics present");
  } else {
    failTriggers.push("broken unit economics / no cost impact data");
  }

  if (entity.performanceMetrics?.uptime !== undefined || entity.performanceMetrics?.latency !== undefined) {
    passCriteria.push("reliability/SLA metrics present");
  } else {
    failTriggers.push("no reliability/SLA verification");
  }

  return {
    intent: "P&L risk management and vendor assessment.",
    requiresNewsWithinDays: 180,
    passCriteria,
    failTriggers,
  };
}

export function evaluateEcosystemPartnerPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.ecosystem?.downstreamImpact && entity.ecosystem.downstreamImpact.length > 0) {
    passCriteria.push("downstream ecosystem impact mapped");
  } else {
    failTriggers.push("missing ecosystem impact map");
  }

  if (entity.ecosystem?.secondOrderEffects && entity.ecosystem.secondOrderEffects.length > 0) {
    passCriteria.push("second-order effects identified");
  }

  return {
    intent: "Second-order market effects mapping.",
    requiresNewsWithinDays: 30,
    passCriteria,
    failTriggers,
  };
}

export function evaluateQuantAnalystPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.performanceMetrics?.latency !== undefined || entity.financials?.revenue !== undefined) {
    passCriteria.push("quantitative time-series points available");
  } else {
    failTriggers.push("no raw quantitative metrics for regression");
  }

  if (entity.freshness?.newsAgeDays !== null) {
    passCriteria.push("freshness metrics calculable");
  }

  return {
    intent: "Quantitative signal extraction and time-series.",
    requiresNewsWithinDays: 60,
    passCriteria,
    failTriggers,
  };
}

export function evaluateProductDesignerPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.summary && entity.summary.length > 50) {
    passCriteria.push("summary dense enough for display");
  } else {
    failTriggers.push("summary too thin");
  }

  if (entity.crmFields && Object.keys(entity.crmFields).length >= 5) {
    passCriteria.push("schema is dense + expandable");
  }

  if (entity.sources && entity.sources.length > 0) {
    passCriteria.push("sources available for citations");
  }

  return {
    intent: "Schema density for UI/UX rendering.",
    passCriteria,
    failTriggers,
  };
}

export function evaluateSalesEngineerPersona(entity: EnrichedEntityPayload): PersonaResult {
  const passCriteria: string[] = [];
  const failTriggers: string[] = [];

  if (entity.summary && entity.summary.length > 20) {
    passCriteria.push("share-friendly summary exists");
  } else {
    failTriggers.push("no shareable summary");
  }

  if (entity.contactPoints?.primary) {
    passCriteria.push("primary contact for outreach");
  }

  if (entity.sources && entity.sources.length > 0) {
    passCriteria.push("sources for credibility");
  }

  return {
    intent: "Share-ready single-screen summary.",
    passCriteria,
    failTriggers,
  };
}

function generatePersonaHooks(entity: EnrichedEntityPayload): PersonaHooks {
  return {
    JPM_STARTUP_BANKER: evaluateBankerPersona(entity),
    EARLY_STAGE_VC: evaluateVCPersona(entity),
    CTO_TECH_LEAD: evaluateCTOPersona(entity),
    FOUNDER_STRATEGY: evaluateFounderStrategyPersona(entity),
    ACADEMIC_RD: evaluateAcademicRDPersona(entity),
    ENTERPRISE_EXEC: evaluateEnterpriseExecPersona(entity),
    ECOSYSTEM_PARTNER: evaluateEcosystemPartnerPersona(entity),
    QUANT_ANALYST: evaluateQuantAnalystPersona(entity),
    PRODUCT_DESIGNER: evaluateProductDesignerPersona(entity),
    SALES_ENGINEER: evaluateSalesEngineerPersona(entity),
  };
}

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 500,
): Promise<string> {
  const route =
    process.env.NODEBENCH_PUBLIC_RESEARCH_MODEL_ROUTE ||
    process.env.NODEBENCH_PUBLIC_RESEARCH_MODEL ||
    "kilo-auto/public-research";
  try {
    const result = await runPiOrAiSdkCompletion({
      model: route,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
      timeoutMs: 60_000,
      temperature: 0.2,
    });
    if (result.text.trim()) {
      return result.text;
    }
  } catch (err: any) {
    console.warn(
      `[entityInsights] pi-ai autorouter failed for ${route}; falling back to legacy provider path:`,
      err?.message || err,
    );
  }

  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(modelInput),
  );

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }

  if (provider === "gemini") {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }

  if (provider === "openrouter") {
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: {
        ...(process.env.OPENROUTER_HTTP_REFERER
          ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER }
          : {}),
        ...(process.env.OPENROUTER_X_TITLE
          ? { "X-Title": process.env.OPENROUTER_X_TITLE }
          : {}),
      },
    });
    const response = await openrouter.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
    });
    return response.choices[0]?.message?.content || "";
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content || "";
}

function normalizeWhitespace(input: string): string {
  return (input || "").replace(/\s+/g, " ").trim();
}

function clipText(input: string, maxLen: number): string {
  const cleaned = normalizeWhitespace(input);
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim();
}

function tryParseJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = unfenced.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
  }
  return null;
}

type DataQuality = "verified" | "partial" | "incomplete";

function asString(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  return "";
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function asKeyPeople(input: unknown): Array<{ name: string; title: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const name = typeof (entry).name === "string" ? (entry).name.trim() : "";
      const title = typeof (entry).title === "string" ? (entry).title.trim() : "";
      if (!name && !title) return null;
      return { name, title };
    })
    .filter((entry): entry is { name: string; title: string } => !!entry);
}

function asYear(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const year = Number.parseInt(input.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(year)) return year;
  }
  return undefined;
}

function normalizeDataQuality(input: unknown): DataQuality {
  if (input === "verified" || input === "partial" || input === "incomplete") {
    return input;
  }
  if (input && typeof input === "object") {
    const confidence = asString((input as any).confidence).toLowerCase();
    if (confidence === "high" || confidence === "verified") return "verified";
    if (confidence === "low" || confidence === "incomplete") return "incomplete";
  }
  return "partial";
}

function extractFoundersFromText(text: string): string[] {
  if (!text) return [];
  const patterns = [
    /founded(?: in \d{4})? by ([^.]+)/i,
    /co-founded by ([^.]+)/i,
    /founders? (?:of [^\\n]+ )?are ([^.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1]
        .split(/,|and/)
        .map((name) => name.replace(/who is.*$/i, "").trim())
        .filter(Boolean);
    }
  }
  return [];
}

function extractFoundedYear(text: string): number | undefined {
  const match = text.match(/founded(?: in)?\s*(\d{4})/i);
  if (match?.[1]) {
    const year = Number.parseInt(match[1], 10);
    if (Number.isFinite(year)) return year;
  }
  return undefined;
}

function extractHqLocation(text: string): string {
  const patterns = [
    /headquartered in ([^.]+)/i,
    /based in ([^.]+)/i,
    /headquarters(?: is| are)? located in ([^.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function extractSourceGalleryData(raw: string): SourceMatrixItem[] {
  const match = raw.match(/<!--\s*SOURCE_GALLERY_DATA\s*\n([\s\S]*?)\n\s*-->/);
  if (!match || !match[1]) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.url)
      .map((item) => ({
        title: item.title || item.name || "Source",
        url: item.url,
        domain: item.domain,
        snippet: item.description || item.snippet,
      }));
  } catch {
    return [];
  }
}

function toSourceList(items: SourceMatrixItem[]) {
  return items.slice(0, 6).map((item) => ({
    name: item.title || item.domain || "Source",
    url: item.url,
    snippet: item.snippet,
  }));
}

function ensureFundingSources(sources: Array<{ name: string; url: string; snippet?: string }>, entityName: string) {
  const hasPitchbook = sources.some((source) => /pitchbook/i.test(source.name) || /pitchbook/i.test(source.url));
  const hasCrunchbase = sources.some((source) => /crunchbase/i.test(source.name) || /crunchbase/i.test(source.url));
  const additions: Array<{ name: string; url: string }> = [];
  if (!hasPitchbook) {
    additions.push({
      name: "PitchBook",
      url: `https://pitchbook.com/search?q=${encodeURIComponent(entityName)}`,
    });
  }
  if (!hasCrunchbase) {
    additions.push({
      name: "Crunchbase",
      url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(entityName)}`,
    });
  }
  return [...sources, ...additions].slice(0, 6);
}


// ═══════════════════════════════════════════════════════════════════════════
// SOURCE CREDIBILITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const PRIMARY_SOURCE_PATTERNS = [
  // Company/official sites
  /\.(com|io|ai|co|org)\/?$/i, // root domain (likely company site)
  /about|press|news|investor|ir\./i, // investor relations / press pages
  // Wire services (original press releases)
  /prnewswire|businesswire|globenewswire|accesswire/i,
  // Regulatory / government
  /sec\.gov|fda\.gov|nih\.gov|clinicaltrials\.gov|nvd\.nist\.gov/i,
  // Academic / research
  /arxiv\.org|pubmed|ncbi\.nlm\.nih|nature\.com|science\.org/i,
  // GitHub (for OSS projects)
  /github\.com\/[^/]+\/[^/]+$/i,
];

const HIGH_CREDIBILITY_PATTERNS = [
  /prnewswire|businesswire|globenewswire/i, // wire services
  /sec\.gov|fda\.gov|nih\.gov|clinicaltrials\.gov/i, // government
  /arxiv\.org|pubmed|nature\.com|science\.org/i, // academic
  /github\.com/i, // OSS ground truth
  /crunchbase\.com|pitchbook\.com/i, // funding databases
];

const MEDIUM_HIGH_CREDIBILITY_PATTERNS = [
  /techcrunch|fiercebiotech|fiercepharma|statnews|reuters|bloomberg/i,
  /wsj\.com|nytimes\.com|ft\.com|economist\.com/i,
  /venturebeat|wired\.com|arstechnica/i,
];

function classifySourceCredibility(
  url: string,
  entityName: string
): { sourceType: "primary" | "secondary"; credibility: "high" | "medium-high" | "medium" | "low" } {
  const urlLower = url.toLowerCase();
  const entityTokens = entityName.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  // Check if URL contains entity name tokens (likely company's own site)
  const isEntitySite = entityTokens.some(token => urlLower.includes(token));

  // Determine source type
  let sourceType: "primary" | "secondary" = "secondary";
  if (isEntitySite || PRIMARY_SOURCE_PATTERNS.some(p => p.test(url))) {
    sourceType = "primary";
  }

  // Determine credibility
  let credibility: "high" | "medium-high" | "medium" | "low" = "medium";
  if (HIGH_CREDIBILITY_PATTERNS.some(p => p.test(url))) {
    credibility = "high";
  } else if (MEDIUM_HIGH_CREDIBILITY_PATTERNS.some(p => p.test(url))) {
    credibility = "medium-high";
  } else if (isEntitySite) {
    credibility = "high"; // Company's own site is high credibility for company facts
  }

  return { sourceType, credibility };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2.5: BANKER-GRADE DEEP ENRICHMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

type BankerGradeEnrichment = {
  productPipeline?: {
    platform?: string;
    modalities?: string[];
    leadAsset?: {
      name?: string;
      class?: string;
      originator?: string;
      licensedRights?: string;
      regulatory?: string[];
      indicationFocus?: string[];
    };
    leadPrograms?: Array<{
      program: string;
      indications?: string[];
      stage?: string;
      notes?: string;
    }>;
    differentiation?: string[];
    rationale?: string[];
  };
  contactPoints?: {
    primary?: { channel: string; value: string; purpose?: string };
    media?: { channel: string; value: string; purpose?: string };
    other?: Array<{ channel: string; value: string; purpose?: string }>;
    outreachAngles?: string[];
  };
  newsClassification?: Array<{
    title: string;
    type: string;
    keyClaims?: string[];
  }>;
  executiveDetails?: Array<{
    name: string;
    role: string;
    backgroundHighlights?: string[];
    credentials?: Array<{ type: string; verifiedBy?: string }>;
  }>;
  founderDetails?: Array<{
    name: string;
    role?: string;
    background?: string;
    credentials?: Array<{ type: string; verifiedBy?: string }>;
  }>;
  board?: string[];
};

async function extractBankerGradeEnrichment(
  entityName: string,
  entityType: string,
  searchAnswer: string,
  recentNews: Array<{ headline: string; source: string; url: string; date: string }>,
  sources: Array<{ name: string; url: string; snippet?: string }>,
  generateFn: typeof generateWithProvider
): Promise<BankerGradeEnrichment | null> {
  const prompt = `You are a senior investment banker preparing a target company profile. Extract banker-grade structured data for: ${entityName}

Web research summary:
${clipText(searchAnswer, 3500)}

Recent news headlines:
${recentNews.map(n => `- ${n.headline} (${n.source}, ${n.date})`).join("\n")}

Sources found:
${sources.slice(0, 5).map(s => `- ${s.name}: ${s.url}`).join("\n")}

Return JSON with this EXACT structure:
{
  "productPipeline": {
    "platform": "Core technology/platform description (1 sentence)" or null,
    "modalities": ["Technology modalities, e.g., ADC, T-cell engager, SaaS, API"] or [],
    "leadAsset": {
      "name": "Lead product/drug name" or null,
      "class": "Product class (e.g., Bisphosphonate, LLM, DevTool)" or null,
      "originator": "If licensed, original developer" or null,
      "licensedRights": "Licensing scope" or null,
      "regulatory": ["FDA designations, certifications"] or [],
      "indicationFocus": ["Target indications/markets"] or []
    } or null,
    "leadPrograms": [
      {
        "program": "Program name",
        "indications": ["Target indications"],
        "stage": "Development stage (e.g., Phase 3, Beta, GA)",
        "notes": "Key milestone or timeline"
      }
    ] or [],
    "differentiation": ["Competitive differentiators"] or [],
    "rationale": ["Investment thesis points"] or []
  },
  "contactPoints": {
    "primary": { "channel": "email|web|phone", "value": "contact value", "purpose": "e.g., Company contact" } or null,
    "media": { "channel": "email", "value": "media contact email", "purpose": "Media/PR" } or null,
    "other": [{ "channel": "type", "value": "value", "purpose": "purpose" }] or [],
    "outreachAngles": ["3-5 specific hooks for banker outreach email"] or []
  },
  "newsClassification": [
    {
      "title": "Exact headline",
      "type": "Company press release|Trade press|Wire service|Blog|Regulatory filing",
      "keyClaims": ["Key verifiable claims from this news item"]
    }
  ],
  "executiveDetails": [
    {
      "name": "Full name",
      "role": "Title",
      "backgroundHighlights": ["Prior roles, achievements"],
      "credentials": [{ "type": "PhD|MD|MBA|etc", "verifiedBy": "Source of verification" }]
    }
  ],
  "founderDetails": [
    {
      "name": "Full name",
      "role": "Founder role",
      "background": "Brief background",
      "credentials": [{ "type": "credential type", "verifiedBy": "verification source" }]
    }
  ],
  "board": ["Board member names with affiliation"] or null,
  "performanceMetrics": {
    "failureRate": number (percentage 0-100) or null,
    "churn": number (percentage 0-100) or null,
    "latency": number (ms) or null,
    "uptime": number (percentage e.g. 99.9) or null
  } or null,
  "financials": {
    "burnRate": number (monthly USD) or null,
    "costToServe": number (USD unit cost) or null,
    "unitEconomics": "Description of LTV/CAC or margin" or null,
    "revenue": number (annual USD) or null
  } or null,
  "academicData": {
    "methodology": "Specific mechanism/approach description" or null,
    "citations": number (approx count) or null,
    "pValue": number or null,
    "sampleSize": number or null
  } or null,
  "ecosystem": {
    "dependencies": ["Upstream tech/vendors"] or [],
    "downstreamImpact": ["Who is affected/relies on this"] or [],
    "secondOrderEffects": ["Indirect market ripples"] or []
  } or null,
  "technicalSpecs": {
    "cveIds": ["CVE-XXXX-YYYY"] or [],
    "repoStats": { "stars": number, "forks": number, "issues": number, "contributors": number, "starVelocity": number } or null,
    "stackDependencies": ["Core tech stack"] or []
  } or null
}


IMPORTANT:
- Only include data you can verify from the provided text
- Use null for unknown fields, [] for empty arrays
- For outreachAngles, write specific, actionable hooks (e.g., "Recently closed $X round; likely building out team")
- For newsClassification.type, distinguish between company press releases (primary) vs trade coverage (secondary)
- For credentials, only include if explicitly stated with source`;

  try {
    const raw = await generateFn(
      getLlmModel("analysis"),
      "You are an investment banking analyst. Extract structured deal data. Output valid JSON only.",
      prompt,
      800
    );
    return tryParseJson(raw) as BankerGradeEnrichment | null;
  } catch (err: any) {
    console.warn("[entityInsights] Banker-grade enrichment failed:", err?.message || err);
    return null;
  }
}

function extractJsonFromText(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function fetchStockPrice(ctx: any, ticker: string | null | undefined) {
  if (!ticker) return null;
  try {
    const tool = { ...(getStockPrice as any), ctx };
    if (typeof tool.execute !== "function") return null;
    const endDate = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const startDate = start.toISOString().slice(0, 10);
    const response = await tool.execute(
      { symbol: ticker, startDate, endDate },
      { toolCallId: "entityInsights" },
    );
    const parsed = extractJsonFromText(response) as Record<string, unknown> | null;
    const data = (parsed?.data ?? parsed) as unknown[];
    if (Array.isArray(data) && data.length > 0) {
      const latest = data[data.length - 1] as { close?: number; price?: number; adj_close?: number; date?: string; timestamp?: string } | undefined;
      const price = Number(latest?.close ?? latest?.price ?? latest?.adj_close);
      if (Number.isFinite(price)) {
        return { price, asOf: latest?.date ?? latest?.timestamp ?? undefined };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const getEntityInsights = action({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("person")),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Support both authenticated and anonymous users
    // Anonymous users can still perform entity research (external data)
    // This enables evaluation mode and anonymous chat usage
    const userId = (ctx as any).evaluationUserId ?? await getAuthUserId(ctx);
    // Note: userId can be null for anonymous users - that's OK for entity research

    const existing: any = await ctx.runQuery(
      api.domains.knowledge.entityContexts.getEntityContext,
      { entityName: args.entityName, entityType: args.entityType },
    );

    if (existing && !existing.isStale && !args.forceRefresh) {
      await ctx.runMutation(api.domains.knowledge.entityContexts.updateAccessCount, {
        id: existing._id,
      });
      return {
        cached: true,
        entityName: existing.entityName,
        entityType: existing.entityType,
        summary: existing.summary,
        keyFacts: existing.keyFacts,
        crmFields: existing.crmFields,
        sources: existing.sources,
        isStale: existing.isStale,
        researchedAt: existing.researchedAt,
      };
    }

    const baseTool = linkupSearch as any;
    const sourceResults: SourceMatrixItem[] = [];
    let searchAnswer = "";

    if (baseTool && typeof baseTool.execute === "function") {
      const tool = { ...baseTool, ctx };
      const query = `${args.entityName} company overview headquarters founders founded year funding`;
      try {
        const result = await tool.execute(
          {
            query,
            depth: "standard",
            outputType: "sourcedAnswer",
            includeInlineCitations: true,
            includeSources: true,
            maxResults: 8,
            includeImages: false,
          },
          { toolCallId: "entityInsights" },
        );
        if (typeof result === "string") {
          searchAnswer = result;
          sourceResults.push(...extractSourceGalleryData(result));
        }
      } catch (err: any) {
        console.warn("[entityInsights] Linkup search failed:", err?.message || err);
      }

      try {
        const sourceQuery = `${args.entityName} PitchBook Crunchbase funding investors founders`;
        const sourceResult = await tool.execute(
          {
            query: sourceQuery,
            depth: "standard",
            outputType: "sourcedAnswer",
            includeInlineCitations: true,
            includeSources: true,
            maxResults: 8,
            includeImages: false,
          },
          { toolCallId: "entityInsightsSources" },
        );
        if (typeof sourceResult === "string") {
          sourceResults.push(...extractSourceGalleryData(sourceResult));
        }
      } catch (err: any) {
        console.warn("[entityInsights] Linkup source search failed:", err?.message || err);
      }
    }

    const feedItems: any[] = await ctx.runQuery(
      internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
      {},
    );
    const recentNews = feedItems
      .filter((item) => {
        const title = (item.title ?? "").toLowerCase();
        const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";
        const target = args.entityName.toLowerCase();
        return title.includes(target) || tags.includes(target);
      })
      .slice(0, 6)
      .map((item) => ({
        date: item.publishedAt ?? new Date().toISOString(),
        headline: item.title ?? "News update",
        source: item.source ?? "Feed",
        url: item.url ?? "",
      }));

    const systemPrompt =
      "You are a senior investment analyst. Extract structured entity metadata. Output JSON only.";

    const userPrompt =
      `Entity: ${args.entityName}\n` +
      `Type: ${args.entityType}\n\n` +
      `Web summary:\n${clipText(searchAnswer, 4000)}\n\n` +
      `Recent news:\n${JSON.stringify(recentNews, null, 2)}\n\n` +
      `Return JSON with keys: summary, hqLocation, foundedYear, founders, foundersBackground, website, industry, ` +
      `businessModel, fundingStage, totalFunding, lastFundingDate, investors, competitors, keyPeople, ticker, keyFacts, dataQuality.\n` +
      `Use null for unknown fields. Keep summary under 2 sentences. keyFacts should be 3-6 bullets.`;

    const raw = await generateWithProvider(
      getLlmModel("analysis"),
      systemPrompt,
      userPrompt,
      520,
    );

    const parsed = (tryParseJson(raw) ?? {}) as EntityInsightPayload;
    const keyFacts = Array.isArray(parsed.keyFacts)
      ? parsed.keyFacts.filter((fact) => typeof fact === "string")
      : [];
    const sources = ensureFundingSources(toSourceList(sourceResults), args.entityName);
    const normalizedDataQuality = normalizeDataQuality(parsed.dataQuality);
    const normalizedSummary = asString(parsed.summary) || clipText(searchAnswer, 180) || "Summary pending.";
    const normalizedFounders = asStringArray(parsed.founders);
    const normalizedInvestors = asStringArray(parsed.investors);
    const normalizedCompetitors = asStringArray(parsed.competitors);
    const normalizedKeyPeople = asKeyPeople(parsed.keyPeople);
    const sourceFounderText = [searchAnswer, ...sourceResults.map((item) => item.snippet || "")].join(" ");
    const fallbackFounders = extractFoundersFromText(sourceFounderText);
    const fallbackYear = extractFoundedYear(sourceFounderText);
    const fallbackHq = extractHqLocation(sourceFounderText);
    const foundedYear = asYear(parsed.foundedYear) ?? fallbackYear;
    const ticker = asString(parsed.ticker) || null;

    const founderFallback = normalizedFounders.length
      ? normalizedFounders
      : normalizedKeyPeople.map((person) => person.name).filter(Boolean).concat(fallbackFounders);
    const crmFields = {
      companyName: args.entityName,
      description: normalizedSummary,
      headline: normalizedSummary,
      hqLocation: asString(parsed.hqLocation) || fallbackHq,
      city: "",
      state: "",
      country: "",
      website: asString(parsed.website),
      email: "",
      phone: "",
      founders: founderFallback,
      foundersBackground: asString(parsed.foundersBackground),
      keyPeople: normalizedKeyPeople,
      industry: asString(parsed.industry),
      companyType: "",
      foundingYear: foundedYear,
      product: "",
      targetMarket: "",
      businessModel: asString(parsed.businessModel),
      fundingStage: asString(parsed.fundingStage),
      totalFunding: asString(parsed.totalFunding),
      lastFundingDate: asString(parsed.lastFundingDate),
      investors: normalizedInvestors,
      investorBackground: "",
      competitors: normalizedCompetitors,
      competitorAnalysis: "",
      fdaApprovalStatus: "",
      fdaTimeline: "",
      newsTimeline: recentNews.map((item) => ({
        date: item.date ?? "",
        headline: item.headline ?? "",
        source: item.source ?? "",
      })),
      recentNews: recentNews[0]?.headline ?? "",
      keyEntities: [],
      researchPapers: [],
      partnerships: [],
      completenessScore: normalizedDataQuality === "verified" ? 90 : normalizedDataQuality === "partial" ? 65 : 40,
      dataQuality: normalizedDataQuality,
    };

    const stockPrice = await fetchStockPrice(ctx, ticker);

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2: Funding Deep-Dive Extraction
    // ═══════════════════════════════════════════════════════════════════════
    let fundingData: FundingData | null = null;
    try {
      const fundingPrompt = `Extract structured funding information for: ${args.entityName}

Web summary:
${clipText(searchAnswer, 3000)}

Return JSON with this exact structure:
{
  "stage": "Seed|Series A|Series B|...|IPO|null",
  "totalRaised": { "amount": number, "currency": "USD|EUR", "unit": "M|B|K" } or null,
  "lastRound": {
    "roundType": string (e.g., "Seed", "Series A"),
    "announcedDate": "YYYY-MM-DD" or null,
    "amount": { "amount": number, "currency": string, "unit": string } or null,
    "coLeads": ["investor names"] or null,
    "participants": ["other investor names"] or null,
    "useOfProceeds": "brief description" or null
  } or null,
  "bankerTakeaway": "1-sentence investment banking insight"
}

Use null for unknown fields. Be precise with amounts and dates.`;

      const fundingRaw = await generateWithProvider(
        getLlmModel("analysis"),
        "You are a financial analyst. Extract structured funding data. Output JSON only.",
        fundingPrompt,
        400,
      );
      const fundingParsed = tryParseJson(fundingRaw) as { stage?: string; totalRaised?: FundingAmount; lastRound?: FundingRound; bankerTakeaway?: string } | null;
      if (fundingParsed) {
        fundingData = {
          stage: asString(fundingParsed.stage) || asString(parsed.fundingStage),
          totalRaised: fundingParsed.totalRaised || null,
          lastRound: fundingParsed.lastRound || null,
          bankerTakeaway: asString(fundingParsed.bankerTakeaway),
        };
      }
    } catch (err: any) {
      console.warn("[entityInsights] Funding deep-dive failed:", err?.message || err);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2.5: Banker-Grade Deep Enrichment
    // ═══════════════════════════════════════════════════════════════════════
    const bankerEnrichment = await extractBankerGradeEnrichment(
      args.entityName,
      args.entityType,
      searchAnswer,
      recentNews,
      sources,
      generateWithProvider
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 3: Build Enriched Entity Payload
    // ═══════════════════════════════════════════════════════════════════════

    // Classify news items with type and keyClaims from banker enrichment
    const newsClassificationMap = new Map(
      (bankerEnrichment?.newsClassification ?? []).map(nc => [nc.title, nc])
    );
    const newsItems: NewsItem[] = recentNews.map((item) => {
      const classification = newsClassificationMap.get(item.headline);
      return {
        title: item.headline,
        publishedDate: item.date,
        url: item.url,
        type: classification?.type ?? "Feed",
        keyClaims: classification?.keyClaims,
      };
    });
    const freshness = calculateFreshness(newsItems);

    // Use intelligent source credibility classification
    const enrichedSources: EnrichedSource[] = sources.map((s) => {
      const { sourceType, credibility } = classifySourceCredibility(s.url, args.entityName);
      return {
        ...s,
        sourceType,
        credibility,
      };
    });

    // Merge people data from banker enrichment
    const mergedFounders: PersonEntry[] = (bankerEnrichment?.founderDetails ?? []).length > 0
      ? bankerEnrichment!.founderDetails!.map(f => ({
        name: f.name,
        role: f.role ?? "Founder",
        background: f.background,
        credentials: f.credentials,
      }))
      : founderFallback.map((name) => ({ name, role: "Founder" }));

    const mergedExecutives: PersonEntry[] = (bankerEnrichment?.executiveDetails ?? []).length > 0
      ? bankerEnrichment!.executiveDetails!.map(e => ({
        name: e.name,
        role: e.role,
        backgroundHighlights: e.backgroundHighlights,
        credentials: e.credentials,
      }))
      : normalizedKeyPeople.map((p) => ({ name: p.name, role: p.title }));

    // Merge product pipeline from banker enrichment
    const mergedProductPipeline: ProductPipeline = bankerEnrichment?.productPipeline
      ? {
        platform: bankerEnrichment.productPipeline.platform ?? asString(parsed.industry),
        modalities: bankerEnrichment.productPipeline.modalities ?? [],
        leadAsset: bankerEnrichment.productPipeline.leadAsset,
        leadPrograms: bankerEnrichment.productPipeline.leadPrograms ?? [],
        differentiation: bankerEnrichment.productPipeline.differentiation ?? [],
      }
      : {
        platform: asString(parsed.industry),
        modalities: [],
        leadPrograms: [],
        differentiation: [],
      };

    // Merge contact points from banker enrichment
    const mergedContactPoints: ContactPoints = bankerEnrichment?.contactPoints
      ? {
        primary: bankerEnrichment.contactPoints.primary,
        media: bankerEnrichment.contactPoints.media,
        other: bankerEnrichment.contactPoints.other ?? [],
        outreachAngles: bankerEnrichment.contactPoints.outreachAngles?.length
          ? bankerEnrichment.contactPoints.outreachAngles
          : recentNews.length > 0 ? ["Recent news signal"] : [],
      }
      : {
        outreachAngles: recentNews.length > 0 ? ["Recent news signal"] : [],
      };

    const enrichedEntity: EnrichedEntityPayload = {
      entityId: args.entityName.toUpperCase().replace(/\s+/g, "_"),
      entityType: args.entityType === "company" ? "private_company" : "person",
      canonicalName: args.entityName,
      asOf: new Date().toISOString().slice(0, 10),
      summary: normalizedSummary,
      crmFields,
      funding: fundingData || {
        stage: asString(parsed.fundingStage),
        totalRaised: null,
        lastRound: null,
      },
      people: {
        founders: mergedFounders,
        executives: mergedExecutives,
        board: bankerEnrichment?.board,
      },
      productPipeline: mergedProductPipeline,
      recentNews: { items: newsItems },
      contactPoints: mergedContactPoints,
      sources: enrichedSources,
      freshness,
      keyFacts: keyFacts.length ? keyFacts : recentNews.map((item) => item.headline).slice(0, 3),
      stockPrice,
    };

    // Generate persona hooks
    enrichedEntity.personaHooks = generatePersonaHooks(enrichedEntity);

    const contextId = await ctx.runMutation(
      api.domains.knowledge.entityContexts.storeEntityContext,
      {
        entityName: args.entityName,
        entityType: args.entityType,
        summary: normalizedSummary,
        keyFacts: enrichedEntity.keyFacts || [],
        sources,
        crmFields,
        funding: enrichedEntity.funding,
        people: enrichedEntity.people,
        productPipeline: enrichedEntity.productPipeline,
        recentNewsItems: newsItems,
        contactPoints: enrichedEntity.contactPoints,
        freshness: enrichedEntity.freshness,
        personaHooks: enrichedEntity.personaHooks,
        researchedBy: userId ?? undefined,
      },
    );

    return {
      cached: false,
      contextId,
      entityName: args.entityName,
      entityType: args.entityType,
      summary: normalizedSummary,
      keyFacts: enrichedEntity.keyFacts,
      crmFields,
      sources: enrichedSources,
      recentNews,
      stockPrice,
      researchedAt: Date.now(),
      // New banker-grade fields
      funding: enrichedEntity.funding,
      people: enrichedEntity.people,
      freshness: enrichedEntity.freshness,
      productPipeline: enrichedEntity.productPipeline,
      contactPoints: enrichedEntity.contactPoints,
      personaHooks: enrichedEntity.personaHooks,
    };
  },
});
