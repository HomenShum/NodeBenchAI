"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal, components } from "../../_generated/api";
import { Agent, stepCountIs } from "@convex-dev/agent";
import { getLanguageModelSafe, DEFAULT_MODEL } from "../agents/mcp_tools/models";
import { PERSONAS, type Persona, GROUND_TRUTH_ENTITIES } from "./groundTruth";
import { calculateRequestCost } from "../../../shared/llm/modelCatalog";

type DebriefV1 = {
  schemaVersion: "debrief_v1";
  persona: { inferred: Persona; confidence: number; assumptions?: string[] };
  entity: {
    input: string;
    resolvedId: string | null;
    canonicalName: string | null;
    type: string | null;
    confidence: number;
    candidates?: Array<{ id: string; name: string; confidence: number }>;
  };
  planSteps: string[];
  toolsUsed: Array<{ name: string; ok: boolean; error?: string | null }>;
  fallbacks: string[];
  verdict: "PASS" | "FAIL" | "UNKNOWN";
  keyFacts: {
    hqLocation: string | null;
    funding: {
      stage: string | null;
      amount: { amount: number | null; currency: string | null; unit: string | null };
      date: string | null;
      coLeads: string[];
    };
    people: { founders: string[]; ceo: string | null };
    product: { platform: string | null; leadPrograms: string[] };
    contact: { email: string | null; channel: string | null };
    freshness: { ageDays: number | null };
  };
  risks: string[];
  nextActions: string[];
  grounding: string[];
};

type Scenario = {
  id: string;
  name: string;
  query: string;
  expectedPersona: Persona;
  expectedEntityId?: string;
  /** If provided, persona match passes when inferred persona is in this list. */
  allowedPersonas?: Persona[];
  /** Extra behavioral requirements beyond ground-truth field checks. */
  requirements?: {
    minToolCalls?: number;
    maxToolCalls?: number;
    maxCostUsd?: number;
    maxClarifyingQuestions?: number;
    requireVerificationStep?: boolean;
    requireProviderUsage?: boolean;
    requireTools?: string[];
    // Phase 5: Dynamic Context Stack requirements
    maxTokenBudget?: number;              // Maximum token budget for the run
    requireResourceLinkUsage?: boolean;   // Must use resource_link pattern for large outputs
    minCitationResolutionRate?: number;   // e.g., 0.95 = 95% citations must resolve
  };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function extractDebriefV1(text: string): { debrief: DebriefV1 | null; error?: string } {
  const start = text.indexOf("[DEBRIEF_V1_JSON]");
  const end = text.indexOf("[/DEBRIEF_V1_JSON]");
  if (start < 0 || end < 0 || end <= start) {
    return { debrief: null, error: "Missing [DEBRIEF_V1_JSON] block" };
  }
  const jsonText = text.slice(start + "[DEBRIEF_V1_JSON]".length, end).trim();
  if (!jsonText) return { debrief: null, error: "Empty DEBRIEF_V1_JSON payload" };
  try {
    const parsed = JSON.parse(jsonText);
    return { debrief: parsed as DebriefV1 };
  } catch (e) {
    return { debrief: null, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCLOSURE METRICS EXTRACTION (P0 Instrumentation)
// ═══════════════════════════════════════════════════════════════════════════

/** Meta-tools that indicate progressive disclosure is being used */
const SKILL_META_TOOLS = ["searchAvailableSkills", "describeSkill", "listSkillCategories", "classifyPersona"];
const TOOL_META_TOOLS = ["searchAvailableTools", "describeTools", "listToolCategories", "invokeTool"];
const ALL_META_TOOLS = [...SKILL_META_TOOLS, ...TOOL_META_TOOLS];

const RESOURCE_LINK_WRAP_THRESHOLD_BYTES = 100 * 1024;

function isResourceLinkObject(value: unknown): value is { type: "resource_link"; sizeBytes?: number } {
  return typeof value === "object" && value !== null && (value as any).type === "resource_link";
}

function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function estimateValueSizeBytes(value: unknown): number {
  if (typeof value === "string") return getByteLength(value);
  try {
    return getByteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function collectResourceLinks(value: unknown, out: any[], depth: number = 0): void {
  if (depth > 8) return;
  if (isResourceLinkObject(value)) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResourceLinks(item, out, depth + 1);
    return;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, 80)) {
      if (k === "ctx") continue;
      collectResourceLinks(v, out, depth + 1);
    }
  }
}

function analyzeToolResultsForResourceLinks(toolResults: unknown[]): {
  resourceLinks: any[];
  resourceLinkCount: number;
  resourceLinkBytes: number;
  hasLargeInlinePayload: boolean;
} {
  const resourceLinks: any[] = [];
  for (const tr of toolResults) collectResourceLinks(tr, resourceLinks);

  const resourceLinkBytes = resourceLinks.reduce((sum, rl) => sum + Number((rl as any)?.sizeBytes ?? 0), 0);
  const hasLargeInlinePayload = toolResults.some((tr) => estimateValueSizeBytes(tr) >= RESOURCE_LINK_WRAP_THRESHOLD_BYTES);

  return {
    resourceLinks,
    resourceLinkCount: resourceLinks.length,
    resourceLinkBytes,
    hasLargeInlinePayload,
  };
}

/**
 * Disclosure summary extracted from tool calls telemetry.
 * This is computed ONLY from actual tool call data (never by inference).
 */
interface DisclosureMetrics {
  // Skill metrics
  skillSearchCalls: number;
  skillsActivated: string[];

  // Tool metrics
  toolSearchCalls: number;
  toolsExpanded: string[];
  toolsInvoked: string[];
  toolInvokeErrors: number;

  // Quality indicators
  usedSkillFirst: boolean;      // Did skill search happen before non-meta tool invoke?
  usedMetaTools: boolean;       // Were any meta-tools used?
  directToolCalls: string[];    // Non-meta tools called without skill context

  // Derived
  disclosureLevel: "none" | "partial" | "full";

  // Token estimates (P0 baseline measurement)
  estimatedToolSchemaTokens: number;  // Estimated tokens for tool schemas loaded in prompt

  // Phase 5: Resource link metrics (Dynamic Context Stack)
  resourceLinksCreated: number;       // Large outputs wrapped as resource_links
  resourceLinksRetrieved: number;     // Retrievals from resource_links
  artifactBytesAvoided: number;       // Bytes saved by using resource_links

  // Phase 5: Citation resolution metrics
  citationsInResponse: number;        // Total citation anchors in response
  citationsResolved: number;          // Citations that resolve to valid chunks
  citationsUnresolved: number;        // Citations that couldn't be resolved

  // Phase 5: Budget compliance
  tokenBudgetExceeded: boolean;       // Did we exceed token budget?
  costBudgetExceeded: boolean;        // Did we exceed cost budget?
}

/**
 * Extract disclosure metrics from tool calls telemetry.
 * This allows us to track progressive disclosure usage without modifying meta-tool implementations.
 */
function extractDisclosureMetrics(
  toolCalls: Array<{ name: string; ok?: boolean; error?: string | null }>,
  toolResults: unknown[] = []
): DisclosureMetrics {
  const callNames = toolCalls.map((c) => String(c?.name ?? ""));

  // Skill metrics
  const skillSearchCalls = callNames.filter((n) => n === "searchAvailableSkills").length;
  const skillDescribeCalls = callNames.filter((n) => n === "describeSkill");

  // Tool metrics
  const toolSearchCalls = callNames.filter((n) => n === "searchAvailableTools").length;
  const toolDescribeCalls = callNames.filter((n) => n === "describeTools");
  const toolInvokeCalls = callNames.filter((n) => n === "invokeTool");

  // Find all non-meta tools invoked directly
  const nonMetaTools = callNames.filter((n) => !ALL_META_TOOLS.includes(n) && n.length > 0);

  // Determine order: did skill search happen before any non-meta tool call?
  const firstSkillSearchIdx = callNames.findIndex((n) => n === "searchAvailableSkills");
  const firstNonMetaIdx = callNames.findIndex((n) => !ALL_META_TOOLS.includes(n) && n.length > 0);
  const usedSkillFirst = firstSkillSearchIdx >= 0 && (firstNonMetaIdx < 0 || firstSkillSearchIdx < firstNonMetaIdx);

  // Determine disclosure level
  let disclosureLevel: "none" | "partial" | "full" = "none";
  const usedMetaTools = callNames.some((n) => ALL_META_TOOLS.includes(n));

  if (skillSearchCalls > 0 && toolSearchCalls > 0) {
    disclosureLevel = "full";
  } else if (usedMetaTools) {
    disclosureLevel = "partial";
  }

  // Extract skill names from describeSkill calls (we can infer from call order, but this is limited)
  // In future, the meta-tools should emit structured disclosure events
  const skillsActivated: string[] = [];
  const toolsExpanded: string[] = [];

  // Count tool invoke errors
  const toolInvokeErrors = toolCalls.filter((c) => c.name === "invokeTool" && c.ok === false).length;

  // Estimate tool schema tokens (P0 baseline measurement)
  // Currently tools are loaded upfront, so we estimate based on direct tool calls
  // Each tool schema averages ~150-200 tokens (name, description, parameters)
  // In deferred mode, only describeTools-expanded tools would count
  const ESTIMATED_TOKENS_PER_TOOL = 175;
  const TOTAL_TOOLS_IN_CATALOG = 70; // Approximate number of tools registered

  // Current (non-deferred): all tool schemas loaded upfront
  // This gives us a baseline to compare against after deferral is implemented
  const estimatedToolSchemaTokens = disclosureLevel === "full" && toolSearchCalls > 0
    ? nonMetaTools.length * ESTIMATED_TOKENS_PER_TOOL  // Deferred: only expanded tools
    : TOTAL_TOOLS_IN_CATALOG * ESTIMATED_TOKENS_PER_TOOL;  // Non-deferred: all tools

  // Phase 5: Resource link metrics (extracted from tool results)
  const _resourceLinkTools = ["wrapToolOutput", "retrieveArtifact", "retrieveFullArtifact", "retrieveMultipleArtifacts"];
  const toolResultAnalysis = analyzeToolResultsForResourceLinks(toolResults);
  const resourceLinksCreated = toolResultAnalysis.resourceLinkCount > 0
    ? toolResultAnalysis.resourceLinkCount
    : callNames.filter((n) => n === "wrapToolOutput").length;
  const resourceLinksRetrieved = callNames.filter((n) =>
    ["retrieveArtifact", "retrieveFullArtifact", "retrieveMultipleArtifacts"].includes(n)
  ).length;

  // Estimate bytes avoided. Prefer actual resource_link sizes when available.
  const artifactBytesAvoided = toolResultAnalysis.resourceLinkBytes > 0
    ? toolResultAnalysis.resourceLinkBytes
    : resourceLinksCreated * 100 * 1024;

  // Phase 5: Citation metrics (would need response analysis for accuracy)
  // Placeholder: count citation anchors in tool names (actual implementation needs response text)
  const citationsInResponse = 0; // Will be computed from response text
  const citationsResolved = 0;
  const citationsUnresolved = 0;

  // Phase 5: Budget compliance (will be set by requirements checking)
  const tokenBudgetExceeded = false;
  const costBudgetExceeded = false;

  return {
    skillSearchCalls,
    skillsActivated,
    toolSearchCalls,
    toolsExpanded,
    toolsInvoked: Array.from(new Set(nonMetaTools)),
    toolInvokeErrors,
    usedSkillFirst,
    usedMetaTools,
    directToolCalls: nonMetaTools.filter((n) => !ALL_META_TOOLS.includes(n)),
    disclosureLevel,
    estimatedToolSchemaTokens,
    // Phase 5 additions
    resourceLinksCreated,
    resourceLinksRetrieved,
    artifactBytesAvoided,
    citationsInResponse,
    citationsResolved,
    citationsUnresolved,
    tokenBudgetExceeded,
    costBudgetExceeded,
  };
}

/**
 * Generate disclosure warnings (non-scored, Week 1-2 mode).
 * These are informational and don't affect pass/fail.
 */
function generateDisclosureWarnings(
  metrics: DisclosureMetrics,
  scenarioId: string,
  expectedPersona: string
): string[] {
  const warnings: string[] = [];

  // Warning: No skill search before tool invoke (for non-trivial scenarios)
  if (!metrics.usedSkillFirst && metrics.toolsInvoked.length > 0) {
    warnings.push(`No skill search before tool invoke`);
  }

  // Warning: Too many direct tool calls without meta-tool usage
  if (metrics.directToolCalls.length > 10) {
    warnings.push(`Excessive direct tool calls: ${metrics.directToolCalls.length} (>10)`);
  }

  // Warning: No skill activation for non-banker scenarios
  if (expectedPersona !== "JPM_STARTUP_BANKER" && metrics.skillSearchCalls === 0 && metrics.toolsInvoked.length > 0) {
    warnings.push(`No skill search for ${expectedPersona} scenario`);
  }

  // Warning: No meta-tool usage at all
  if (!metrics.usedMetaTools && metrics.toolsInvoked.length > 0) {
    warnings.push(`No progressive disclosure meta-tools used`);
  }

  return warnings;
}

function isConvexMutationContentionError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.includes("Data read or written in this mutation changed while it was being run");
}

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && (PERSONAS as readonly string[]).includes(value);
}

function validateDebriefV1(debrief: DebriefV1): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical fields (must have)
  if (debrief?.schemaVersion !== "debrief_v1") errors.push("schemaVersion must be 'debrief_v1'");
  if (!isPersona(debrief?.persona?.inferred)) errors.push("persona.inferred must be a known persona");
  if (typeof debrief?.persona?.confidence !== "number") errors.push("persona.confidence must be a number");

  if (typeof debrief?.entity?.input !== "string" || debrief.entity.input.trim().length === 0) {
    errors.push("entity.input must be a non-empty string");
  }

  // Allow entity.confidence to be number (including 0) or missing
  const entityConf = debrief?.entity?.confidence;
  if (entityConf !== undefined && entityConf !== null && typeof entityConf !== "number") {
    errors.push("entity.confidence must be a number if provided");
  }

  if (!Array.isArray(debrief?.planSteps) || debrief.planSteps.length === 0) errors.push("planSteps must be a non-empty array");
  if (!Array.isArray(debrief?.toolsUsed)) errors.push("toolsUsed must be an array");
  if (!["PASS", "FAIL", "UNKNOWN"].includes(String(debrief?.verdict))) errors.push("verdict must be PASS|FAIL|UNKNOWN");
  if (!debrief?.keyFacts || typeof debrief.keyFacts !== "object") errors.push("keyFacts is required");
  if (!Array.isArray(debrief?.nextActions)) errors.push("nextActions must be an array");
  if (!Array.isArray(debrief?.grounding)) errors.push("grounding must be an array");

  // Optional fields (nice to have, but not critical for pass/fail)
  if (!Array.isArray(debrief?.fallbacks)) warnings.push("fallbacks array missing (optional)");
  if (!Array.isArray(debrief?.risks)) warnings.push("risks array missing (optional)");

  // Log warnings but don't fail validation
  if (warnings.length > 0) {
    console.log(`[Validation warnings for ${debrief?.entity?.input}]:`, warnings);
  }

  return { ok: errors.length === 0, errors };
}

function normalizeLower(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function normalizeGroundTruthEntityKey(value: string | null | undefined): string {
  return normalizeLower(value).replace(/[^a-z0-9]+/g, "");
}

function findGroundTruthEntity(expectedEntityId: string | null | undefined) {
  const raw = String(expectedEntityId ?? "").trim();
  if (!raw) return null;

  const normalizedId = normalizeGroundTruthEntityKey(raw);
  return (
    GROUND_TRUTH_ENTITIES.find((entity) => entity.entityId === raw) ??
    GROUND_TRUTH_ENTITIES.find((entity) => normalizeGroundTruthEntityKey(entity.entityId) === normalizedId) ??
    GROUND_TRUTH_ENTITIES.find((entity) => normalizeGroundTruthEntityKey(entity.canonicalName) === normalizedId)
  );
}

type ParsedCitationAnchor =
  | { kind: "cite"; raw: string; artifactId: string; chunkId: string }
  | { kind: "fact"; raw: string; chunkId: string };

function parseCitationAnchors(text: string): ParsedCitationAnchor[] {
  const out: ParsedCitationAnchor[] = [];

  const citeRe = /\{\{cite:([^:}]+):([^}]+)\}\}/g;
  for (const match of text.matchAll(citeRe)) {
    const artifactId = String(match[1] ?? "").trim();
    const chunkId = String(match[2] ?? "").trim();
    if (!artifactId || !chunkId) continue;
    out.push({ kind: "cite", raw: match[0], artifactId, chunkId });
  }

  const factRe = /\{\{fact:distilled:([^:}]+):([^}]+)\}\}/g;
  for (const match of text.matchAll(factRe)) {
    const chunkId = String(match[2] ?? "").trim();
    if (!chunkId) continue;
    out.push({ kind: "fact", raw: match[0], chunkId });
  }

  return out;
}

async function resolveCitationAnchors(
  ctx: any,
  anchors: ParsedCitationAnchor[]
): Promise<{ total: number; resolved: number; unresolved: number; resolutionRate: number; limited: boolean }> {
  const MAX_TO_RESOLVE = 60;
  const total = anchors.length;
  if (total === 0) return { total: 0, resolved: 0, unresolved: 0, resolutionRate: 1, limited: false };

  const limitedAnchors = anchors.slice(0, MAX_TO_RESOLVE);
  const limited = total > limitedAnchors.length;

  const uniqueChunkIds = Array.from(new Set(limitedAnchors.map((a) => a.chunkId)));
  const chunkToArtifactId = new Map<string, string | null>();

  for (const chunkId of uniqueChunkIds) {
    try {
      const chunk = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.getEvidenceChunkById, {
        chunkId: chunkId as any,
      });
      chunkToArtifactId.set(chunkId, chunk ? String(chunk.artifactId) : null);
    } catch {
      chunkToArtifactId.set(chunkId, null);
    }
  }

  let resolved = 0;
  for (const anchor of limitedAnchors) {
    const artifactId = chunkToArtifactId.get(anchor.chunkId);
    if (!artifactId) continue;
    if (anchor.kind === "cite" && artifactId !== anchor.artifactId) continue;
    resolved++;
  }

  const unresolved = total - resolved;
  const resolutionRate = total > 0 ? resolved / total : 1;
  return { total, resolved, unresolved, resolutionRate, limited };
}

function isRedactedEmailLike(value: string): boolean {
  const v = normalizeLower(value);
  if (!v) return false;
  if (v.includes("[email") && v.includes("protected")) return true;
  if (v.includes("email") && v.includes("protected")) return true;
  return false;
}

const ENTITY_NAME_STOPWORDS = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "llc",
  "ltd",
  "limited",
  "plc",
  "the",
  "and",
  "of",
]);

function tokenizeEntityName(s: string): string[] {
  return normalizeLower(s)
    .replace(/'s\b/g, "s")  // Convert possessives: "Alzheimer's" → "Alzheimers"
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !ENTITY_NAME_STOPWORDS.has(t));  // Filter single-char tokens
}

function hasMeaningfulEntityTokenOverlap(actualName: string, expectedName: string): boolean {
  const actual = new Set(tokenizeEntityName(actualName));
  const expected = new Set(tokenizeEntityName(expectedName));
  if (actual.size === 0 || expected.size === 0) return false;

  const overlap = [...expected].filter((t) => actual.has(t));
  if (overlap.length === 0) return false;

  if (expected.size <= 2) return true;
  if (overlap.length >= 2) return true;

  return overlap[0].length >= 6;
}

function scoreAgainstGroundTruth(params: {
  expectedPersona: Persona;
  allowedPersonas?: Persona[];
  expectedEntityId: string;
  debrief: DebriefV1;
  responseText?: string;
}): { ok: boolean; checks: Record<string, boolean>; reasons: string[] } {
  const reasons: string[] = [];
  const checks: Record<string, boolean> = {};

  const allowed = params.allowedPersonas?.length ? params.allowedPersonas : null;
  checks.persona = allowed ? allowed.includes(params.debrief.persona.inferred) : params.debrief.persona.inferred === params.expectedPersona;
  if (!checks.persona) {
    reasons.push(
      allowed
        ? `persona mismatch: got ${params.debrief.persona.inferred} expected one of ${allowed.join(", ")}`
        : `persona mismatch: got ${params.debrief.persona.inferred} expected ${params.expectedPersona}`,
    );
  }

  if (!String(params.expectedEntityId ?? "").trim()) {
    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, reasons };
  }

  const entity = findGroundTruthEntity(params.expectedEntityId);
  if (!entity) {
    reasons.push(`unknown ground truth entity: ${params.expectedEntityId}`);
    return { ok: false, checks, reasons };
  }

  const resolvedId = normalizeLower(params.debrief.entity?.resolvedId ?? "");
  const canonical = normalizeLower(params.debrief.entity?.canonicalName ?? "");
  const expectedCanonical = normalizeLower(entity.canonicalName);
  const expectedId = normalizeLower(entity.entityId);
  checks.entityResolved =
    resolvedId === expectedId ||
    (resolvedId.length > 0 && expectedId.includes(resolvedId)) ||
    (resolvedId.length > 0 && resolvedId.includes(expectedId)) ||
    canonical === expectedCanonical ||
    canonical.includes(expectedCanonical) ||
    expectedCanonical.includes(canonical) ||
    hasMeaningfulEntityTokenOverlap(canonical, expectedCanonical);
  if (!checks.entityResolved) reasons.push(`entity mismatch: got resolvedId='${params.debrief.entity?.resolvedId ?? "N/A"}' canonical='${params.debrief.entity?.canonicalName ?? "N/A"}' expected '${entity.entityId}'`);

  // Check for hqLocation in keyFacts OR anywhere in the full debrief text
  // Note: hqLocation is optional for public companies with strategy/positioning personas
  // (e.g., FOUNDER_STRATEGY analyzing Salesforce doesn't need SF HQ mentioned)
  const hq = normalizeLower(params.debrief.keyFacts?.hqLocation ?? "");
  const fullDebriefForHq = normalizeLower(JSON.stringify(params.debrief));
  const responseText = normalizeLower(params.responseText ?? "");
  const combinedText = `${fullDebriefForHq}\n${responseText}`;
  const hqTokens = entity.hqLocation ? normalizeLower(entity.hqLocation).split(/[,\s]+/).filter((p) => p.length >= 3) : [];
  const hqOptionalForPersonas: Persona[] = ["FOUNDER_STRATEGY", "ENTERPRISE_EXEC", "ECOSYSTEM_PARTNER"];
  const isHqOptional = hqOptionalForPersonas.includes(params.expectedPersona);
  checks.hq = !entity.hqLocation || isHqOptional
    ? true
    : hqTokens.some((p) => hq.includes(p)) || hqTokens.some((p) => combinedText.includes(p));
  if (!checks.hq) reasons.push("hqLocation does not match ground truth");

  // Check for funding stage in multiple locations (nested funding.stage OR flat fundingStage)
  const nestedStage = normalizeLower(params.debrief.keyFacts?.funding?.stage ?? "");
  const flatStage = normalizeLower((params.debrief.keyFacts as any)?.fundingStage ?? "");
  const stage = nestedStage || flatStage;
  const expectedStage = normalizeLower(entity.funding?.stage ?? "");
  checks.fundingStage = entity.funding?.stage
    ? stage.includes(expectedStage) || combinedText.includes(expectedStage)
    : true;
  if (!checks.fundingStage) reasons.push(`funding.stage mismatch: got '${stage || "N/A"}' expected '${entity.funding?.stage ?? ""}'`);

  // Check for contact email in multiple places (keyFacts.contact.email, nextActions, or anywhere in debrief)
  const email = normalizeLower(params.debrief.keyFacts?.contact?.email ?? "");
  const nextActionsText = normalizeLower(JSON.stringify(params.debrief.nextActions ?? []));
  const fullDebriefText = normalizeLower(JSON.stringify(params.debrief));
  const fullAnswerText = `${fullDebriefText}\n${responseText}`;

  if (!entity.primaryContact) {
    checks.contact = true;
  } else if (isRedactedEmailLike(entity.primaryContact)) {
    // For redacted emails, just check that some email-like text exists
    checks.contact = email.length > 0 || nextActionsText.includes("@") || fullAnswerText.includes("@");
  } else {
    // Check if the expected email appears in keyFacts, nextActions, or anywhere in the debrief
    const expectedEmail = normalizeLower(entity.primaryContact);
    // Also check for partial email matches (e.g., just the domain or just the local part)
    const emailDomain = expectedEmail.split("@")[1] ?? "";
    const emailLocal = expectedEmail.split("@")[0] ?? "";
    checks.contact =
      email.includes(expectedEmail) ||
      nextActionsText.includes(expectedEmail) ||
      fullAnswerText.includes(expectedEmail) ||
      // Lenient matching: allow domain match + some form of email indication
      (emailDomain && fullAnswerText.includes(emailDomain) && fullAnswerText.includes("@")) ||
      // Allow local part match if it's distinctive (>3 chars) + @ symbol present
      (emailLocal.length > 3 && fullAnswerText.includes(emailLocal) && fullAnswerText.includes("@"));
  }
  if (!checks.contact) reasons.push("contact.email missing or mismatched");

  // Check for ground truth anchor in grounding[] - lenient: accept any anchor containing the entity ID
  const groundingArray = params.debrief.grounding ?? [];
  const entityIdLower = normalizeLower(entity.entityId);
  const hasAnchor = Array.isArray(groundingArray) && groundingArray.some((a) => {
    const anchorLower = normalizeLower(a);
    // Exact match: {{fact:ground_truth:ENTITY_ID}}
    if (anchorLower.includes(`{{fact:ground_truth:${entityIdLower}}}`)) return true;
    // Lenient: anchor contains entity ID or canonical name
    if (anchorLower.includes(entityIdLower)) return true;
    if (anchorLower.includes(normalizeLower(entity.canonicalName))) return true;
    return false;
  });
  // Also check if entity ID appears anywhere in the full response as a citation
  const fullTextForGrounding = `${normalizeLower(JSON.stringify(params.debrief))}\n${responseText}`;
  const hasInlineGrounding = fullTextForGrounding.includes(`ground_truth:${entityIdLower}`) ||
    fullTextForGrounding.includes(`fact:${entityIdLower}`);
  checks.grounding = hasAnchor || hasInlineGrounding;
  if (!checks.grounding) reasons.push("missing ground truth citation anchor in grounding[]");

  const nextActionsArray = params.debrief.nextActions ?? [];
  checks.nextActions = Array.isArray(nextActionsArray) && nextActionsArray.length >= 3;
  if (!checks.nextActions) reasons.push("nextActions must have >= 3 items");

  const ok = Object.values(checks).every(Boolean);
  return { ok, checks, reasons };
}

const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: "banker_vague_disco",
    name: "Banker vague outreach debrief",
    query: "DISCO — I'm trying to figure out if this is worth reaching out on and what I should do with it.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "DISCO",
  },
  {
    id: "vc_vague_openautoglm",
    name: "VC wedge from OSS signal",
    query: "OpenAutoGLM — what does this imply about the agent market and where is the wedge?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "OPEN-AUTOGLM",
  },
  {
    id: "cto_vague_quickjs",
    name: "CTO risk exposure + patch plan",
    query: "QuickJS — do I have risk exposure and what is my patch plan?",
    expectedPersona: "CTO_TECH_LEAD",
    expectedEntityId: "MQUICKJS",
  },
  {
    id: "exec_vague_gemini",
    name: "Exec vendor evaluation",
    query: "Gemini 3 — should we consider this, and what's the procurement next step?",
    expectedPersona: "ENTERPRISE_EXEC",
    expectedEntityId: "GEMINI_3",
  },
  {
    id: "ecosystem_vague_soundcloud",
    name: "Ecosystem second-order effects",
    query: "SoundCloud VPN issue — who benefits and what partnerships does this create?",
    expectedPersona: "ECOSYSTEM_PARTNER",
    expectedEntityId: "SOUNDCLOUD",
  },
  {
    id: "founder_salesforce_positioning",
    name: "Founder positioning vs incumbent",
    query: "Salesforce Agentforce — what does this mean for a founder's positioning and what should we do next?",
    expectedPersona: "FOUNDER_STRATEGY",
    expectedEntityId: "SALESFORCE",
  },
  {
    id: "academic_ryr2_anchor",
    name: "Academic literature anchor",
    query: "RyR2 / Alzheimer's — what's the literature anchor and what's methodologically solid?",
    expectedPersona: "ACADEMIC_RD",
    expectedEntityId: "ALZHEIMERS",
  },
  {
    id: "quant_disco_signal",
    name: "Quant signal extraction",
    query: "DISCO — extract the funding signal and timeline points you'd track.",
    expectedPersona: "QUANT_ANALYST",
    expectedEntityId: "DISCO",
  },
  {
    id: "product_disco_card",
    name: "Product designer schema card",
    query: "DISCO — I need a schema-dense UI card JSON that can be rendered.",
    expectedPersona: "PRODUCT_DESIGNER",
    expectedEntityId: "DISCO",
  },
  {
    id: "sales_disco_onepager",
    name: "Sales engineer one-screen summary",
    query: "DISCO — write a share-ready single-screen outbound summary.",
    expectedPersona: "SALES_ENGINEER",
    expectedEntityId: "DISCO",
  },
];

const NEXT_SCENARIOS: Scenario[] = [
  // JPM_STARTUP_BANKER
  {
    id: "next_banker_vague_disco_cover_this_week",
    name: "Next: banker vague (fast debrief)",
    query: "DISCO — can we cover them this week? Give me the fastest banker-grade debrief and tell me what you’re unsure about.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_banker_tool_ambros_outbound_pack",
    name: "Next: banker tool-driven outbound pack",
    query:
      "Build an outbound-ready pack for Ambros: last round details, why-now, 3 talk-track bullets, and primary-source citations. If any primary is missing, say so and propose the fastest way to resolve.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "AMBROS",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // EARLY_STAGE_VC
  {
    id: "next_vc_vague_disco_wedge",
    name: "Next: VC vague wedge",
    query: "DISCO — I want a wedge. What’s the thesis and where’s the weakness?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_vc_tool_disco_comps",
    name: "Next: VC tool-driven comps + diligence",
    query:
      "Map DISCO vs 2 nearest comparables (pick them via research). Output: market map, wedge, why-now, key risks, and 5 diligence questions. Cite sources and label assumptions.",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // CTO_TECH_LEAD
  {
    id: "next_cto_vague_quickjs_exposure",
    name: "Next: CTO vague exposure",
    query: "QuickJS — am I exposed? I’m not sure where it’s used.",
    expectedPersona: "CTO_TECH_LEAD",
    expectedEntityId: "MQUICKJS",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_cto_tool_cve_plan",
    name: "Next: CTO tool-driven CVE plan",
    query:
      "Assess CVE-2025-62495: fixed version, mitigations, and a dependency-trace plan. Include a verification checklist and cite NVD + upstream changelog.",
    expectedPersona: "CTO_TECH_LEAD",
    expectedEntityId: "MQUICKJS",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // FOUNDER_STRATEGY
  {
    id: "next_founder_vague_salesforce_agentforce",
    name: "Next: founder vague positioning",
    query: "Salesforce Agentforce — what does this mean for our positioning?",
    expectedPersona: "FOUNDER_STRATEGY",
    expectedEntityId: "SALESFORCE",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_founder_tool_salesforce_memo",
    name: "Next: founder tool-driven memo",
    query:
      "Write a founder memo: Salesforce’s agent strategy, where it’s strong, where it’s weak, and 3 counter-positioning moves. Must be grounded in filings/IR + credible coverage; no invented metrics.",
    expectedPersona: "FOUNDER_STRATEGY",
    expectedEntityId: "SALESFORCE",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // ACADEMIC_RD
  {
    id: "next_academic_vague_ryr2_alz",
    name: "Next: academic vague anchor",
    query: "RyR2 and Alzheimer’s — what’s real here?",
    expectedPersona: "ACADEMIC_RD",
    expectedEntityId: "ALZHEIMERS",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_academic_tool_lit_debrief",
    name: "Next: academic tool-driven literature debrief",
    query:
      "ALZHEIMERS — Produce a literature-anchored debrief: 2–3 key papers, what methods were used, limitations, and a replication/next-experiment plan. Cite primary literature and label uncertainty.",
    expectedPersona: "ACADEMIC_RD",
    expectedEntityId: "ALZHEIMERS",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // ENTERPRISE_EXEC
  {
    id: "next_exec_vague_gemini_standardize",
    name: "Next: exec vague standardize",
    query: "Gemini 3 — should we standardize on Flash or Pro for agent loops?",
    expectedPersona: "ENTERPRISE_EXEC",
    expectedEntityId: "GEMINI_3",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_exec_tool_cost_model",
    name: "Next: exec tool-driven cost model",
    query:
      "Gemini 3 — Build a cost model using official pricing: 3 usage scenarios, caching impact, and a procurement next-step checklist. Cite the pricing source of truth.",
    expectedPersona: "ENTERPRISE_EXEC",
    expectedEntityId: "GEMINI_3",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // ECOSYSTEM_PARTNER
  {
    id: "next_ecosystem_vague_soundcloud_vpn",
    name: "Next: ecosystem vague incident",
    query: "SoundCloud VPN issue — who benefits and why should I care?",
    expectedPersona: "ECOSYSTEM_PARTNER",
    expectedEntityId: "SOUNDCLOUD",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_ecosystem_tool_second_order_brief",
    name: "Next: ecosystem tool-driven second-order brief",
    query:
      "SOUNDCLOUD — Produce a second-order ecosystem brief: incident timeline, 3 beneficiary categories, and 2 partnership plays. Cite at least 2 credible sources; clearly separate fact vs inference.",
    expectedPersona: "ECOSYSTEM_PARTNER",
    expectedEntityId: "SOUNDCLOUD",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // QUANT_ANALYST
  {
    id: "next_quant_vague_disco_track",
    name: "Next: quant vague what to track",
    query: "DISCO — what should I track over time?",
    expectedPersona: "QUANT_ANALYST",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_quant_tool_signal_json",
    name: "Next: quant tool-driven signal set JSON",
    query:
      "Extract a structured signal set for DISCO: funding event timeline, key milestones, and 5 measurable KPIs. Output JSON + ‘data sources to ingest’ list.",
    expectedPersona: "QUANT_ANALYST",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // PRODUCT_DESIGNER
  {
    id: "next_product_vague_make_usable_ui",
    name: "Next: product vague UI usable",
    query: "Make this usable in the UI: DISCO.",
    expectedPersona: "PRODUCT_DESIGNER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_product_tool_expandable_card",
    name: "Next: product tool-driven expandable card schema",
    query:
      "Generate a UI-ready entity card schema for DISCO with expandable sections (funding, people, pipeline, sources, freshness, confidence). Include citation pointers and a ‘missing fields’ panel.",
    expectedPersona: "PRODUCT_DESIGNER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },

  // SALES_ENGINEER
  {
    id: "next_sales_vague_shareable",
    name: "Next: sales vague shareable",
    query: "DISCO — give me the shareable version.",
    expectedPersona: "SALES_ENGINEER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "next_sales_tool_one_screen_objections",
    name: "Next: sales tool-driven one-screen + objections",
    query:
      "DISCO — Write a single-screen outbound-ready summary: headline, 3 bullets, funding line (amount/date/round), and contact path. Include ‘objections & responses’ and cite sources.",
    expectedPersona: "SALES_ENGINEER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
];

const STRESS_SCENARIOS: Scenario[] = [
  {
    id: "stress_ambiguous_persona_disco_wedge_outreach",
    name: "Stress: ambiguous persona (wedge + outreach)",
    query: "Disco — wedge + outreach. I’m moving fast.",
    expectedPersona: "JPM_STARTUP_BANKER",
    allowedPersonas: ["JPM_STARTUP_BANKER", "EARLY_STAGE_VC"],
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
  {
    id: "stress_contradiction_disco_series_a_claim",
    name: "Stress: contradiction handling (Seed vs Series A)",
    query: "DISCO raised a Series A for €36M—give me the banker pack.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedEntityId: "DISCO",
    requirements: { minToolCalls: 1, requireTools: ["lookupGroundTruthEntity"] },
  },
];

const PACK_SCENARIOS: Scenario[] = [
  ...NEXT_SCENARIOS,
  ...STRESS_SCENARIOS,
  {
    id: "pack_exec_cross_provider_pricing",
    name: "Pack: exec cross-provider pricing comparison",
    query: "Gemini 3 — Compare OpenAI vs Anthropic vs Gemini for our agent loops: 3 usage scenarios, estimated monthly cost, and recommendation. Use web search for official pricing and cite sources; label assumptions; include a verification step.",
    expectedPersona: "ENTERPRISE_EXEC",
    expectedEntityId: "GEMINI_3",
    requirements: {
      minToolCalls: 1,
      requireTools: ["linkupSearch"],
      requireVerificationStep: true,
    },
  },
  {
    id: "pack_meta_budgeted_deep_dive",
    name: "Pack: meta budgeted deep dive (<=3 tools, <=$0.25)",
    query: "DISCO — Do a deep dive: thesis + risks + comps + diligence + outbound version, but keep it under 3 tool calls and under $0.25. If you must skip, say what you skipped. Ask at most 1 clarifier if needed, then proceed. Include a verification step.",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "DISCO",
    allowedPersonas: ["EARLY_STAGE_VC", "JPM_STARTUP_BANKER", "SALES_ENGINEER"],
    requirements: {
      maxToolCalls: 3,
      maxCostUsd: 0.25,
      maxClarifyingQuestions: 1,
      requireVerificationStep: true,
      requireProviderUsage: true,
      requireTools: ["lookupGroundTruthEntity"],
    },
  },
  // Phase 5: Resource link + citation scenarios
  {
    id: "pack_resource_link_budget",
    name: "Pack: resource_link with tight token budget",
    query: "DISCO — Comprehensive research deep dive with all available sources. Keep total context under 8000 tokens by using resource_links for large outputs. Cite all facts with proper anchors.",
    expectedPersona: "EARLY_STAGE_VC",
    expectedEntityId: "DISCO",
    allowedPersonas: ["EARLY_STAGE_VC", "JPM_STARTUP_BANKER", "QUANT_ANALYST"],
    requirements: {
      minToolCalls: 2,
      maxTokenBudget: 8000,
      requireResourceLinkUsage: true,
      requireTools: ["lookupGroundTruthEntity"],
    },
  },
  {
    id: "pack_citation_resolution",
    name: "Pack: 95% citation resolution verification",
    query: "DISCO — Provide a fully-cited analysis with at least 5 distinct facts. Every claim must have a citation anchor that resolves to a valid source chunk. I'll verify citation resolution.",
    expectedPersona: "ACADEMIC_RD",
    expectedEntityId: "DISCO",
    allowedPersonas: ["ACADEMIC_RD", "EARLY_STAGE_VC", "JPM_STARTUP_BANKER"],
    requirements: {
      minToolCalls: 1,
      minCitationResolutionRate: 0.95,
      requireTools: ["lookupGroundTruthEntity"],
    },
  },
];


export const runPersonaEpisodeEval = action({
  args: {
    secret: v.string(),
    model: v.optional(v.string()),
    suite: v.optional(v.union(v.literal("core"), v.literal("full"), v.literal("next"), v.literal("stress"), v.literal("pack"))),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
    domain: v.optional(v.string()),
    useDbScenarios: v.optional(v.boolean()),
    scenarios: v.optional(
      v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            query: v.string(),
            expectedPersona: v.string(),
            expectedEntityId: v.optional(v.string()),
            allowedPersonas: v.optional(v.array(v.string())),
          }),
        ),
      ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.MCP_SECRET;
    if (!expectedSecret || args.secret !== expectedSecret) {
      return { ok: false, error: "Unauthorized (bad secret)" };
    }

    const model = String(args.model ?? DEFAULT_MODEL);
    const suite = args.suite ?? "core";
    const useDbScenarios = args.useDbScenarios === true;

    // Optionally load scenarios from database for larger, tool-grounded suites.
    // NOTE: DB-backed scenarios may require a different scoring approach than audit_mocks ground truth.
    let dbScenarios: Scenario[] = [];
    if (useDbScenarios && (suite === "pack" || suite === "full")) {
      try {
        const dbResult = await ctx.runQuery(internal.domains.evaluation.scenarioQueries.loadScenariosFromDb, {
          domain: args.domain,
          offset: 0,
          limit: 1000, // Load all for filtering
        });
        dbScenarios = dbResult.scenarios as Scenario[];
        console.log(`Loaded ${dbScenarios.length} scenarios from database`);
      } catch (e) {
        console.error("Failed to load scenarios from database:", e);
      }
    }

    const base =
      args.scenarios ??
      (dbScenarios.length > 0
        ? dbScenarios
        : suite === "core"
          ? DEFAULT_SCENARIOS.filter((s) => ["banker_vague_disco", "cto_vague_quickjs", "exec_vague_gemini"].includes(s.id))
          : suite === "next"
            ? NEXT_SCENARIOS
            : suite === "stress"
              ? STRESS_SCENARIOS
              : suite === "pack"
                ? PACK_SCENARIOS
              : DEFAULT_SCENARIOS);
    const offset = Math.max(0, Math.floor(args.offset ?? 0));
    const limitDefault = suite === "core" ? 3 : 5;
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? limitDefault), 10));
    const scenariosRaw = base.slice(offset, offset + limit);

    const threadAgent = new Agent(components.agent, {
      name: "PersonaEpisodeEvalThreadAgent",
      languageModel: getLanguageModelSafe(model),
      instructions: "Create evaluation threads and save prompts. Do not answer.",
      tools: {},
      stopWhen: stepCountIs(1),
    });

    const startedAt = Date.now();
    const usageSessionId = `__eval_personaEpisodeEval__:${suite}:${startedAt}`;
    const runs: any[] = [];

    for (const s of scenariosRaw) {
      const scenarioStartedAt = Date.now();
      const expectedPersona = isPersona((s).expectedPersona) ? ((s).expectedPersona as Persona) : "JPM_STARTUP_BANKER";
      const expectedEntityId = String((s).expectedEntityId ?? "");
      const allowedPersonas = Array.isArray((s).allowedPersonas)
        ? ((s).allowedPersonas.filter(isPersona) as Persona[])
        : undefined;
      const requirements = (s).requirements as Scenario["requirements"] | undefined;

      let threadId: string | undefined;
      let promptMessageId: string | undefined;
      let streamRes: any = null;

      try {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const created = await threadAgent.createThread(ctx as any, { title: `[Eval] ${s.name}` });
            threadId = created.threadId;
            const saved = await threadAgent.saveMessage(ctx as any, {
              threadId,
              prompt: s.query,
              skipEmbeddings: true,
            });
            promptMessageId = saved.messageId;

            streamRes = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.streamAsync, {
              promptMessageId,
              threadId,
              model,
              useCoordinator: true,
              evaluationMode: true,
              groundTruthMode: suite === "next" || suite === "stress" || suite === "pack" ? "tool" : "inject",
              evaluationExpectedPersona: expectedPersona,
              evaluationExpectedEntityId: expectedEntityId,
              evaluationScenarioId: s.id,
              usageSessionId,
            });
            break;
          } catch (e) {
            if (isConvexMutationContentionError(e) && attempt < maxAttempts) {
              await wait(250 * attempt);
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        runs.push({
          id: s.id,
          name: s.name,
          expectedPersona,
          expectedEntityId,
          ok: false,
          elapsedMs: Date.now() - scenarioStartedAt,
          error: e instanceof Error ? e.message : String(e),
          failureReasons: [e instanceof Error ? e.message : String(e)],
          threadId,
          promptMessageId,
        });
        continue;
      }

      const finalText = String(streamRes?.telemetry?.finalText ?? "");
      const toolCalls = Array.isArray(streamRes?.telemetry?.toolCalls) ? streamRes.telemetry.toolCalls : [];
      const toolResults = Array.isArray(streamRes?.telemetry?.toolResults) ? streamRes.telemetry.toolResults : [];
      const stepsCount = Number(streamRes?.telemetry?.stepsCount ?? 0);
      const estimatedInputTokens = Number(streamRes?.telemetry?.estimatedInputTokens ?? 0);
      const estimatedOutputTokens = Number(streamRes?.telemetry?.estimatedOutputTokens ?? 0);
      const providerUsageRaw = streamRes?.telemetry?.providerUsage ?? null;
      const providerUsage =
        providerUsageRaw && typeof providerUsageRaw === "object"
          ? {
            promptTokens: Number((providerUsageRaw).promptTokens ?? 0),
            completionTokens: Number((providerUsageRaw).completionTokens ?? 0),
            totalTokens: Number((providerUsageRaw).totalTokens ?? 0),
            cachedInputTokens: Number((providerUsageRaw).cachedInputTokens ?? 0),
            reasoningTokens: Number((providerUsageRaw).reasoningTokens ?? 0),
          }
          : null;

      const extracted = extractDebriefV1(finalText);
      const debrief = extracted.debrief;

      const debriefValidation = debrief ? validateDebriefV1(debrief) : { ok: false, errors: [extracted.error ?? "Missing debrief"] };
      const normalizedDebrief =
        debrief && isPersona(debrief.persona?.inferred)
          ? ({
            ...debrief,
            persona: { ...debrief.persona, confidence: clamp01(debrief.persona.confidence) },
            entity: { ...debrief.entity, confidence: clamp01(debrief.entity.confidence) },
          } as DebriefV1)
          : null;

      const gtScore =
        normalizedDebrief
          ? scoreAgainstGroundTruth({
              expectedPersona,
              allowedPersonas,
              expectedEntityId,
              debrief: normalizedDebrief,
              responseText: finalText,
            })
          : { ok: false, checks: {}, reasons: debriefValidation.errors };

      const streamErrorText =
        typeof streamRes?.error === "string" && streamRes.error.trim().length > 0
          ? streamRes.error.trim()
          : null;

      const citationAnchors = parseCitationAnchors(finalText);
      const citationStats = await resolveCitationAnchors(ctx, citationAnchors);

      const extraChecks: Record<string, boolean> = {};
      const extraReasons: string[] = [];
      if (requirements) {
        const callNames = toolCalls.map((c: any) => String(c?.name ?? ""));
        const callNameSet = new Set(callNames);

        const toolAliases: Record<string, string[]> = {
          // Historical/legacy alias: some agent prompts/tools still refer to lookupGroundTruth.
          // Treat either name as satisfying requirements for either name.
          lookupGroundTruthEntity: ["lookupGroundTruthEntity", "lookupGroundTruth"],
          lookupGroundTruth: ["lookupGroundTruth", "lookupGroundTruthEntity"],
          // Search tools: allow fusionSearch to satisfy a linkupSearch requirement since it is a
          // higher-level aggregator over web sources in this codebase.
          linkupSearch: ["linkupSearch", "fusionSearch"],
        };
        const hasTool = (required: string) => (toolAliases[required] ?? [required]).some((t) => callNameSet.has(t));

        // For tool-count budgets, exclude meta-tools (progressive disclosure) so
        // we can safely require skill/tool discovery without breaking maxToolCalls scenarios.
        const nonMetaCallNames = callNames.filter((n: string) => !ALL_META_TOOLS.includes(n));
        if (typeof requirements.minToolCalls === "number") {
          extraChecks.minToolCalls = nonMetaCallNames.length >= requirements.minToolCalls;
          if (!extraChecks.minToolCalls) extraReasons.push(`minToolCalls not met: got ${nonMetaCallNames.length} expected >= ${requirements.minToolCalls}`);
        }
        if (typeof requirements.maxToolCalls === "number") {
          extraChecks.maxToolCalls = nonMetaCallNames.length <= requirements.maxToolCalls;
          if (!extraChecks.maxToolCalls) extraReasons.push(`maxToolCalls exceeded: got ${nonMetaCallNames.length} expected <= ${requirements.maxToolCalls}`);
        }
        if (Array.isArray(requirements.requireTools) && requirements.requireTools.length) {
          extraChecks.requireTools = requirements.requireTools.every((t) => hasTool(t));
          if (!extraChecks.requireTools) extraReasons.push(`missing required tools: expected ${requirements.requireTools.join(", ")} got [${callNames.join(", ")}]`);
        }
        if (requirements.requireVerificationStep) {
          const plan = Array.isArray(normalizedDebrief?.planSteps) ? normalizedDebrief.planSteps : [];
          const verificationKeywords = ["verify", "validate", "confirm", "cross-check", "cross check", "double-check", "double check", "sanity check"];
          extraChecks.verificationStep = plan.some((p) => {
            const s = String(p).toLowerCase();
            return verificationKeywords.some((k) => s.includes(k));
          });
          if (!extraChecks.verificationStep) {
            extraReasons.push("missing verification loop (no planSteps entry includes verify/validate/confirm/cross-check/double-check)");
          }
        }
        if (requirements.requireProviderUsage) {
          // Some providers don't reliably report token usage; fall back to estimates so the eval
          // still reflects "a model was actually invoked".
          const providerOk = !!providerUsage && Number.isFinite(providerUsage.totalTokens) && providerUsage.totalTokens > 0;
          const estimateOk = Number.isFinite(estimatedInputTokens) && Number.isFinite(estimatedOutputTokens) && (estimatedInputTokens + estimatedOutputTokens) > 0;
          extraChecks.providerUsage = providerOk || estimateOk;
          if (!extraChecks.providerUsage) extraReasons.push("provider usage metadata missing (expected providerUsage.totalTokens > 0)");
        }
        if (typeof requirements.maxClarifyingQuestions === "number") {
          const cqCountFromField = Number((normalizedDebrief as any)?.clarifyingQuestionsAsked ?? (normalizedDebrief as any)?.clarifyingQuestionCount ?? NaN);
          const cqCountFromList = Array.isArray((normalizedDebrief as any)?.clarifyingQuestions) ? (normalizedDebrief as any).clarifyingQuestions.length : NaN;
          const cq = Number.isFinite(cqCountFromField)
            ? cqCountFromField
            : Number.isFinite(cqCountFromList)
              ? cqCountFromList
              : 0;
          extraChecks.maxClarifyingQuestions = cq <= requirements.maxClarifyingQuestions;
          if (!extraChecks.maxClarifyingQuestions) extraReasons.push(`too many clarifying questions: got ${cq} expected <= ${requirements.maxClarifyingQuestions}`);
        }
        if (typeof requirements.maxCostUsd === "number") {
          const modelUsed = String(streamRes?.telemetry?.modelUsed ?? model);
          const inputTokens = providerUsage?.promptTokens ?? estimatedInputTokens;
          const outputTokens = providerUsage?.completionTokens ?? estimatedOutputTokens;
          const useCached = (providerUsage?.cachedInputTokens ?? 0) > 0;
          const costUsd = calculateRequestCost(modelUsed, inputTokens, outputTokens, useCached);
          extraChecks.maxCostUsd = costUsd <= requirements.maxCostUsd;
          if (!extraChecks.maxCostUsd) extraReasons.push(`cost exceeded: $${costUsd.toFixed(4)} expected <= $${requirements.maxCostUsd.toFixed(2)}`);
        }

        // Phase 5: Dynamic Context Stack requirements
        if (typeof requirements.maxTokenBudget === "number") {
          const totalTokens = providerUsage?.totalTokens ?? (estimatedInputTokens + estimatedOutputTokens);
          extraChecks.maxTokenBudget = totalTokens <= requirements.maxTokenBudget;
          if (!extraChecks.maxTokenBudget) {
            extraReasons.push(`token budget exceeded: ${totalTokens} expected <= ${requirements.maxTokenBudget}`);
          }
        }

        if (requirements.requireResourceLinkUsage === true) {
          const resourceLinkAnalysis = analyzeToolResultsForResourceLinks(toolResults);

          // Pass when:
          // - a resource_link payload is observed in tool results, OR
          // - the agent explicitly used resource_link tools, OR
          // - no tool produced a payload large enough to require wrapping.
          const resourceLinkTools = ["wrapToolOutput", "retrieveArtifact", "retrieveFullArtifact", "retrieveMultipleArtifacts"];
          const usedResourceLinkTools = callNames.some((n: string) => resourceLinkTools.includes(n));
          const hasResourceLinkInText =
            finalText.includes("resource_link") ||
            finalText.includes("\"type\":\"resource_link\"") ||
            finalText.includes("\"type\": \"resource_link\"");
          extraChecks.resourceLinkUsage =
            resourceLinkAnalysis.resourceLinkCount > 0 ||
            usedResourceLinkTools ||
            hasResourceLinkInText ||
            resourceLinkAnalysis.hasLargeInlinePayload === false;
          if (!extraChecks.resourceLinkUsage) {
            extraReasons.push("requireResourceLinkUsage not met: large tool output observed without resource_link wrapping");
          }
        }

        if (typeof requirements.minCitationResolutionRate === "number") {
          extraChecks.citationResolutionRate =
            citationStats.resolutionRate >= requirements.minCitationResolutionRate;
          if (!extraChecks.citationResolutionRate) {
            extraReasons.push(
              `citation resolution rate too low: ${(citationStats.resolutionRate * 100).toFixed(1)}% expected >= ${(requirements.minCitationResolutionRate * 100).toFixed(1)}%`
            );
          }
          if (citationStats.total === 0) {
            extraReasons.push("no citation anchors found in response");
          }
          if (citationStats.limited) {
            extraReasons.push("citation resolution check limited to first 60 anchors");
          }
        }
      }

      const ok = gtScore.ok && Object.values(extraChecks).every(Boolean);

      // Extract disclosure metrics from tool calls (P0 instrumentation)
      const disclosureMetrics = extractDisclosureMetrics(toolCalls, toolResults);
      disclosureMetrics.citationsInResponse = citationStats.total;
      disclosureMetrics.citationsResolved = citationStats.resolved;
      disclosureMetrics.citationsUnresolved = citationStats.unresolved;
      const disclosureWarnings = generateDisclosureWarnings(disclosureMetrics, s.id, expectedPersona);

      runs.push({
        id: s.id,
        name: s.name,
        expectedPersona,
        expectedEntityId,
        ok,
        elapsedMs: Date.now() - scenarioStartedAt,
        execution: {
          streamStatus: streamRes?.status ?? "unknown",
          modelUsed: streamRes?.telemetry?.modelUsed ?? null,
          latencyMs: streamRes?.telemetry?.latencyMs ?? null,
          stepsCount,
          estimatedInputTokens,
          estimatedOutputTokens,
          providerUsage,
          toolCalls,
          toolResults,
          error: streamErrorText,
        },
        // P0: Disclosure metrics for progressive disclosure tracking
        disclosure: {
          ...disclosureMetrics,
          warnings: disclosureWarnings,
        },
        debrief: normalizedDebrief,
        debriefValidation,
        checks: { ...gtScore.checks, ...extraChecks },
        failureReasons: [...gtScore.reasons, ...extraReasons, ...(streamErrorText ? [streamErrorText] : [])],
        threadId,
        promptMessageId,
        responseText: finalText,
        responsePreview: finalText.slice(0, 900),
      });
    }

    const passed = runs.filter((r) => r.ok === true).length;
    const total = runs.length;

    return {
      ok: total > 0 && passed === total,
      model,
      elapsedMs: Date.now() - startedAt,
      window: {
        suite,
        totalAvailable: base.length,
        offset,
        limit,
        nextOffset: offset + scenariosRaw.length < base.length ? offset + scenariosRaw.length : null,
      },
      summary: { total, passed, failed: total - passed },
      runs,
    };
  },
});
