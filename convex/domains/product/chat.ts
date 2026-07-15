import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { buildPreviewText, deriveDomainFromUrl, requireProductIdentity, summarizeText } from "./helpers";
import { ensureEntityForReport, upsertEntityContextItem, upsertExplicitRelatedEntitiesForReport } from "./entities";
import { productRoutingDecisionValidator } from "./schema";
import { isProductRuntimeFlagEnabled } from "../../lib/featureFlags";
import { deriveCanonicalReportSections } from "../../../shared/reportSections";
import { buildPrepBriefTitle, deriveReportArtifactMode, type ReportArtifactMode } from "../../../shared/reportArtifacts";
import { upsertOpenProductNudge } from "./nudgeHelpers";
import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
} from "../search/searchableTextRecompute";
import { syncGenericDiligenceProjectionDrafts, buildGenericDiligenceProjectionDrafts } from "./diligenceProjectionRuntime";
import {
  buildProductProviderBudgetSummary,
  type ProductProviderBudgetSummary,
} from "../../../shared/productRuntime";
import {
  classifyProductRequest,
  compileActionItems,
  compileTruthSections,
  decidePersistence,
  extractClaimsFromSections,
  resolveProductTarget,
  summarizeClaimLedger,
  type ProductActionItem,
  type ProductAnswerControlSection,
  type ProductAnswerControlSource,
  type ProductClaimDraft,
  type ProductClaimLedgerSummary,
  type ProductPersistenceDecision,
  type ProductResolvedTarget,
} from "../../../shared/productAnswerControl";
// Defense-in-depth save gate. Composes with productAnswerControl.decidePersistence.
// See: convex/domains/agents/safety/artifactDecisionGate.ts
import {
  decideArtifactState,
  type PrimaryCategory,
  type ResolutionExpectation,
} from "../agents/safety/artifactDecisionGate";

const draftSections = [
  {
    id: "what-it-is",
    title: "What it is",
    body: "The agent is classifying the request and gathering the first useful sources.",
    status: "building" as const,
  },
  {
    id: "why-it-matters",
    title: "Why it matters",
    body: "This section fills in once the first evidence arrives.",
    status: "pending" as const,
  },
  {
    id: "what-is-missing",
    title: "What is missing",
    body: "Missing evidence and open questions will appear after the source sweep.",
    status: "pending" as const,
  },
  {
    id: "what-to-do-next",
    title: "What to do next",
    body: "A concrete next move will appear when packaging finishes.",
    status: "pending" as const,
  },
];

function deriveSectionsFromPacket(packet: any, mode: ReportArtifactMode) {
  return deriveCanonicalReportSections(packet, { mode }).map((section) => ({
    id: section.id,
    title: section.title,
    body: summarizeText(
      section.body,
      section.id === "what-it-is"
        ? "No clear summary was returned."
        : section.id === "why-it-matters"
          ? "The agent did not return a distinct why-this-matters section."
          : section.id === "what-is-missing"
            ? "No explicit gap was returned."
            : "No next action was returned.",
    ),
    status: "complete" as const,
    sourceRefIds: section.sourceRefIds,
  }));
}

function normalizeSources(packet: any) {
  const sourceRefs = Array.isArray(packet?.sourceRefs) ? packet.sourceRefs : [];
  return sourceRefs.map((source: any, index: number) => ({
    id: String(source?.id ?? `source:${index + 1}`),
    label: String(source?.label ?? source?.title ?? `Source ${index + 1}`),
    href: typeof source?.href === "string" ? source.href : undefined,
    type: typeof source?.type === "string" ? source.type : undefined,
    status: typeof source?.status === "string" ? source.status : undefined,
    title: typeof source?.title === "string" ? source.title : undefined,
    domain: deriveDomainFromUrl(source?.href),
    siteName: typeof source?.siteName === "string" ? source.siteName : undefined,
    faviconUrl: typeof source?.faviconUrl === "string" ? source.faviconUrl : undefined,
    publishedAt: typeof source?.publishedAt === "string" ? source.publishedAt : undefined,
    thumbnailUrl: typeof source?.thumbnailUrl === "string" ? source.thumbnailUrl : undefined,
    imageCandidates: Array.isArray(source?.imageCandidates)
      ? source.imageCandidates.filter((candidate: unknown): candidate is string => typeof candidate === "string" && candidate.trim().length > 0).slice(0, 4)
      : undefined,
    excerpt: typeof source?.excerpt === "string" ? source.excerpt : undefined,
    confidence: typeof source?.confidence === "number" ? source.confidence : undefined,
  }));
}

function hasPersistableSessionPacket(packet: any, error?: string) {
  if (!error) return true;

  const answer =
    typeof packet?.answer === "string" ? packet.answer.trim() : "";
  const answerBlocks = Array.isArray(packet?.answerBlocks)
    ? packet.answerBlocks.some(
        (block: any) =>
          typeof block?.text === "string" && block.text.trim().length > 0,
      )
    : false;
  const sourceRefs = Array.isArray(packet?.sourceRefs)
    ? packet.sourceRefs.length > 0
    : false;
  const variables = Array.isArray(packet?.variables)
    ? packet.variables.length > 0
    : false;
  const changes = Array.isArray(packet?.changes) ? packet.changes.length > 0 : false;
  const risks = Array.isArray(packet?.risks) ? packet.risks.length > 0 : false;
  const nextAction =
    typeof packet?.recommendedNextAction === "string"
      ? packet.recommendedNextAction.trim()
      : "";

  return Boolean(
    answer || answerBlocks || sourceRefs || variables || changes || risks || nextAction,
  );
}

function buildBudgetEventLabel(summary: ProductProviderBudgetSummary) {
  const primaryProvider = summary.providers[0];
  if (!primaryProvider) {
    return "Runtime budget check completed.";
  }

  const prefix =
    summary.overallStatus === "exceeded"
      ? "Provider budget exceeded"
      : summary.overallStatus === "warning"
        ? "Provider budget warning"
        : "Provider budget stable";

  return `${prefix}: ${primaryProvider.provider} at ${primaryProvider.utilizationPct}% utilization.`;
}

function deriveRunVerdict(args: {
  error?: string;
  sourceCount: number;
  summary: ProductProviderBudgetSummary;
  answer: string;
  resolution: ProductResolvedTarget;
  claimSummary: ProductClaimLedgerSummary;
}) {
  if (args.error) return "failed" as const;
  if (
    args.resolution.state === "ambiguous" ||
    args.resolution.state === "unresolved"
  ) {
    return "needs_review" as const;
  }
  if (args.summary.overallStatus === "exceeded") return "needs_review" as const;
  if (args.summary.overallStatus === "warning") return "provisionally_verified" as const;
  if (
    args.answer.trim().length > 0 &&
    args.sourceCount > 0 &&
    args.claimSummary.publishableClaims >= 2
  ) {
    return "verified" as const;
  }
  return "provisionally_verified" as const;
}

function buildGateResults(args: {
  error?: string;
  sourceCount: number;
  answer: string;
  summary: ProductProviderBudgetSummary;
  resolution: ProductResolvedTarget;
  claimSummary: ProductClaimLedgerSummary;
  persistence: ProductPersistenceDecision;
}) {
  return [
    { gateKey: "has_answer", passed: args.answer.trim().length > 0, label: "Answer captured" },
    { gateKey: "has_sources", passed: args.sourceCount > 0, label: "Sources attached" },
    {
      gateKey: "resolved_target",
      passed:
        args.resolution.state === "exact" ||
        args.resolution.state === "probable",
      label: "Target resolved",
    },
    {
      gateKey: "publishable_claims",
      passed: args.claimSummary.publishableClaims > 0,
      label: "Publishable claims available",
    },
    { gateKey: "budget_ok", passed: args.summary.overallStatus !== "exceeded", label: "Provider budget within guardrails" },
    {
      gateKey: "save_ready",
      passed: args.persistence.saveEligibility === "save_ready",
      label: "Artifact cleared save gate",
    },
    { gateKey: "completed_without_error", passed: !args.error, label: "Run completed without fatal error" },
  ];
}

function estimateRunCostUsd(summary: ProductProviderBudgetSummary) {
  const totalTokens = summary.totals?.totalTokens ?? 0;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  return Number((totalTokens * 0.0000025).toFixed(4));
}

function computeNeedsAttention(args: {
  verdict: "verified" | "provisionally_verified" | "needs_review" | "failed";
  hasPendingInterrupts?: boolean;
  resolutionState?: ProductResolvedTarget["state"];
  saveEligibility?: ProductPersistenceDecision["saveEligibility"];
}) {
  return (
    args.verdict === "needs_review" ||
    args.verdict === "failed" ||
    Boolean(args.hasPendingInterrupts) ||
    args.resolutionState === "ambiguous" ||
    args.resolutionState === "unresolved" ||
    args.saveEligibility === "blocked"
  );
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function resolveSessionReportId(session: {
  linkedReportId?: any;
  autoSavedReportId?: any;
}) {
  return session.linkedReportId ?? session.autoSavedReportId ?? null;
}

async function safeGetSessionReport(ctx: any, reportId: any) {
  if (!reportId) return null;
  try {
    return await ctx.db.get(reportId);
  } catch {
    return null;
  }
}

function normalizeClaimSections(
  sections: ReturnType<typeof deriveSectionsFromPacket>,
): ProductAnswerControlSection[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    body: section.body,
    sourceRefIds: section.sourceRefIds,
  }));
}

function normalizeClaimSources(
  sources: ReturnType<typeof normalizeSources>,
): ProductAnswerControlSource[] {
  return sources.map((source) => ({
    id: source.id,
    label: source.label,
    href: source.href,
    domain: source.domain,
    excerpt: source.excerpt,
    publishedAt: source.publishedAt,
  }));
}

async function replaceResolutionCandidates(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    resolution: ProductResolvedTarget;
    createdAt: number;
  },
) {
  const existing = await ctx.db
    .query("productResolutionCandidates")
    .withIndex("by_session_confidence", (q: any) => q.eq("sessionId", args.sessionId))
    .collect();

  for (const candidate of existing) {
    await ctx.db.delete(candidate._id);
  }

  for (const candidate of args.resolution.candidates) {
    await ctx.db.insert("productResolutionCandidates", {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      candidateKey: candidate.candidateKey,
      label: candidate.label,
      slug: candidate.slug,
      confidence: candidate.confidence,
      reason: candidate.reason,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
  }
}

async function upsertSourceEvidenceItems(
  ctx: any,
  args: {
    ownerKey: string;
    bundleId?: any;
    sessionId: any;
    entityId?: any;
    reportId?: any;
    query: string;
    sources: ReturnType<typeof normalizeSources>;
    existingEvidence: any[];
    createdAt: number;
  },
) {
  const sourceEvidenceByRefId = new Map<string, any>();
  const linkEvidence = args.existingEvidence.filter(
    (item) => item.type === "link",
  );

  for (const source of args.sources) {
    const existing =
      linkEvidence.find(
        (item) =>
          (source.href && item.sourceUrl === source.href) ||
          item.metadata?.sourceRefId === source.id,
      ) ?? null;

    const patch = {
      bundleId: args.bundleId,
      sessionId: args.sessionId,
      reportId: args.reportId,
      entityId: args.entityId,
      type: "link" as const,
      label: source.label,
      description: source.title,
      status: "linked" as const,
      sourceUrl: source.href,
      sourceDomain: source.domain,
      publishedAt: source.publishedAt,
      snapshotHash: stableHash(
        [source.id, source.href, source.label, source.excerpt].filter(Boolean).join("|"),
      ),
      textPreview: source.excerpt ?? source.title ?? source.label,
      matchedEntityId: args.entityId,
      matchedEntityConfidence: undefined,
      freshnessStatus: source.publishedAt ? "fresh" : "unknown",
      retrievalQuery: args.query,
      metadata: {
        sourceRefId: source.id,
        title: source.title,
        siteName: source.siteName,
        faviconUrl: source.faviconUrl,
        thumbnailUrl: source.thumbnailUrl,
      },
      updatedAt: args.createdAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      sourceEvidenceByRefId.set(source.id, { ...(await ctx.db.get(existing._id)), ...patch, _id: existing._id });
      continue;
    }

    const evidenceId = await ctx.db.insert("productEvidenceItems", {
      ownerKey: args.ownerKey,
      createdAt: args.createdAt,
      ...patch,
    });
    sourceEvidenceByRefId.set(source.id, await ctx.db.get(evidenceId));
  }

  return sourceEvidenceByRefId;
}

function buildClaimGateResults(args: {
  claim: ProductClaimDraft;
  resolution: ProductResolvedTarget;
}) {
  return [
    {
      gateKey: "target_resolved",
      passed:
        args.resolution.state === "exact" ||
        args.resolution.state === "probable",
      label: "Target resolved enough for claim extraction",
    },
    {
      gateKey: "has_support",
      passed: args.claim.supportStrength !== "weak",
      label: "Claim has support",
    },
    {
      gateKey: "slot_conflict_free",
      passed: !args.claim.contradictionFlag,
      label: "No slot conflict detected",
    },
    {
      gateKey: "publishable",
      passed: args.claim.publishable,
      label: "Claim cleared publishability gate",
    },
  ];
}

async function replaceSessionClaims(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    reportId?: any;
    entityId?: any;
    claims: ProductClaimDraft[];
    sourceEvidenceByRefId: Map<string, any>;
    resolution: ProductResolvedTarget;
    createdAt: number;
  },
) {
  const existingClaims = await ctx.db
    .query("productClaims")
    .withIndex("by_owner_session", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("sessionId", args.sessionId),
    )
    .collect();
  const existingSupports = await Promise.all(
    existingClaims.map((claim) =>
      ctx.db
        .query("productClaimSupports")
        .withIndex("by_claim", (q: any) => q.eq("claimId", claim._id))
        .collect(),
    ),
  );
  const existingReviews = await Promise.all(
    existingClaims.map((claim) =>
      ctx.db
        .query("productClaimReviews")
        .withIndex("by_claim", (q: any) => q.eq("claimId", claim._id))
        .collect(),
    ),
  );

  for (const reviewRows of existingReviews) {
    for (const row of reviewRows) {
      await ctx.db.delete(row._id);
    }
  }
  for (const supportRows of existingSupports) {
    for (const row of supportRows) {
      await ctx.db.delete(row._id);
    }
  }
  for (const claim of existingClaims) {
    await ctx.db.delete(claim._id);
  }

  const claimIdByKey = new Map<string, any>();
  const claimRows: Array<{ _id: any } & ProductClaimDraft> = [];
  for (const claim of args.claims) {
    const claimId = await ctx.db.insert("productClaims", {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      reportId: args.reportId,
      entityId: args.entityId,
      claimKey: claim.claimKey,
      claimText: claim.claimText,
      claimType: claim.claimType,
      slotKey: claim.slotKey,
      sectionId: claim.sectionId,
      sourceRefIds: claim.sourceRefIds,
      supportStrength: claim.supportStrength,
      freshnessStatus: claim.freshnessStatus,
      contradictionFlag: claim.contradictionFlag,
      publishable: claim.publishable,
      rejectionReasons: claim.rejectionReasons,
      gateResults: buildClaimGateResults({
        claim,
        resolution: args.resolution,
      }),
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
    claimIdByKey.set(claim.claimKey, claimId);
    claimRows.push({ _id: claimId, ...claim });
  }

  for (const claim of claimRows) {
    await ctx.db.patch(claim._id, {
      conflictClaimIds: claim.conflictingClaimKeys
        .map((claimKey) => claimIdByKey.get(claimKey))
        .filter(Boolean),
      updatedAt: args.createdAt,
    });

    for (const support of claim.supports) {
      const evidence = args.sourceEvidenceByRefId.get(support.sourceRefId);
      if (!evidence?._id) continue;
      await ctx.db.insert("productClaimSupports", {
        ownerKey: args.ownerKey,
        claimId: claim._id,
        evidenceId: evidence._id,
        sessionId: args.sessionId,
        reportId: args.reportId,
        sourceRefId: support.sourceRefId,
        spanText: support.spanText,
        spanHash: support.spanHash,
        supportType: support.supportType,
        entityId: args.entityId,
        freshnessStatus: support.freshnessStatus,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      });
    }

    await ctx.db.insert("productClaimReviews", {
      ownerKey: args.ownerKey,
      claimId: claim._id,
      sessionId: args.sessionId,
      reportId: args.reportId,
      reviewer: "deterministic",
      status: claim.publishable ? "approved" : "rejected",
      reasoning: claim.publishable
        ? "Claim satisfied the deterministic publishability gates."
        : claim.rejectionReasons.join(", "),
      gateResults: buildClaimGateResults({
        claim,
        resolution: args.resolution,
      }),
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
  }

  return {
    claimRows,
    claimIdByKey,
  };
}

function materializeCompiledSections(args: {
  compiledSections: ReturnType<typeof compileTruthSections>;
  claimIdByKey: Map<string, any>;
  sourceEvidenceByRefId: Map<string, any>;
}) {
  const materialized: Array<{
    id: string;
    title: string;
    sentences: Array<{
      sentenceId: string;
      text: string;
      claimIds: any[];
      evidenceIds: any[];
    }>;
  }> = [];
  for (const section of args.compiledSections) {
    materialized.push({
      id: section.id,
      title: section.title,
      sentences: section.sentences.map((sentence) => ({
        sentenceId: sentence.sentenceId,
        text: sentence.text,
        claimIds: sentence.claimKeys
          .map((claimKey) => args.claimIdByKey.get(claimKey))
          .filter(Boolean),
        evidenceIds: sentence.sourceRefIds
          .map((sourceRefId) => args.sourceEvidenceByRefId.get(sourceRefId)?._id)
          .filter(Boolean),
      })),
    });
  }
  return materialized;
}

async function insertRunEvent(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    kind:
      | "run_started"
      | "intent_classified"
      | "entity_candidates_ranked"
      | "entity_resolution_finalized"
      | "evidence_collected"
      | "tool_started"
      | "tool_completed"
      | "tool_recovered"
      | "provider_budget"
      | "interrupt_created"
      | "interrupt_resolved"
      | "claims_extracted"
      | "claims_rejected"
      | "claims_published"
      | "truth_compiled"
      | "actions_compiled"
      | "artifact_state_changed"
      | "milestone"
      | "run_completed"
      | "run_failed";
    status: "info" | "success" | "warning" | "error" | "pending";
    label: string;
    tool?: string;
    provider?: string;
    model?: string;
    step?: number;
    totalPlanned?: number;
    payload?: any;
    createdAt: number;
  },
) {
  await ctx.db.insert("productRunEvents", {
    ownerKey: args.ownerKey,
    sessionId: args.sessionId,
    kind: args.kind,
    status: args.status,
    label: args.label,
    tool: args.tool,
    provider: args.provider,
    model: args.model,
    step: args.step,
    totalPlanned: args.totalPlanned,
    payload: args.payload,
    createdAt: args.createdAt,
  });
}

type ProductRuntimeInterruptKind =
  | "entity_disambiguation_required"
  | "missing_required_context"
  | "conflicting_evidence_detected"
  | "quality_gate_blocked_save"
  | "provider_budget_queued";

function buildRuntimeInterruptToolName(
  kind: ProductRuntimeInterruptKind,
  qualifier?: string | null,
) {
  const suffix = qualifier ? `:${qualifier}` : "";
  return `runtime:${kind}${suffix}`;
}

async function ensureRuntimeInterrupt(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    kind: ProductRuntimeInterruptKind;
    description: string;
    payload: Record<string, unknown>;
    createdAt: number;
    provider?: string;
    qualifier?: string | null;
    allowedDecisions?: Array<"approve" | "reject">;
  },
) {
  const threadId = String(args.sessionId);
  const toolName = buildRuntimeInterruptToolName(args.kind, args.qualifier);
  const pending = await ctx.db
    .query("agentInterrupts")
    .withIndex("by_thread_and_status", (q: any) =>
      q.eq("threadId", threadId).eq("status", "pending"),
    )
    .collect();
  const existing = pending.find((interrupt: any) => interrupt.toolName === toolName);
  if (existing) {
    return existing._id;
  }

  const allowedDecisions = args.allowedDecisions ?? ["approve", "reject"];
  const interruptId = await ctx.db.insert("agentInterrupts", {
    threadId,
    toolName,
    arguments: {
      kind: args.kind,
      ...args.payload,
    },
    description: args.description,
    allowedDecisions,
    status: "pending",
    createdAt: args.createdAt,
  });

  await insertRunEvent(ctx, {
    ownerKey: args.ownerKey,
    sessionId: args.sessionId,
    kind: "interrupt_created",
    status: "pending",
    label: args.description,
    tool: toolName,
    provider: args.provider,
    payload: {
      interruptId,
      interruptKind: args.kind,
      allowedDecisions,
      ...args.payload,
    },
    createdAt: args.createdAt,
  });

  return interruptId;
}

async function ensureBudgetInterrupt(
  ctx: any,
  args: {
    sessionId: any;
    ownerKey: string;
    summary: ProductProviderBudgetSummary;
    createdAt: number;
  },
) {
  if (args.summary.overallStatus === "ok") return null;
  const primaryProvider =
    args.summary.providers.find((provider) => provider.status === args.summary.overallStatus) ??
    args.summary.providers[0];
  if (!primaryProvider) return null;

  const description =
    primaryProvider.status === "exceeded"
      ? `${primaryProvider.provider} crossed the current session budget. ${primaryProvider.calls}/${primaryProvider.callBudget} calls used.`
      : `${primaryProvider.provider} is nearing the current session budget. ${primaryProvider.calls}/${primaryProvider.callBudget} calls used.`;

  return ensureRuntimeInterrupt(ctx, {
    ownerKey: args.ownerKey,
    sessionId: args.sessionId,
    kind: "provider_budget_queued",
    qualifier: primaryProvider.provider.toLowerCase(),
    description,
    provider: primaryProvider.provider,
    payload: {
      provider: primaryProvider.provider,
      summary: args.summary,
      queueSuggested: primaryProvider.status === "exceeded",
    },
    createdAt: args.createdAt,
  });
}

async function ensureQualityInterrupts(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    resolution: ProductResolvedTarget;
    persistence: ProductPersistenceDecision;
    claimSummary: ProductClaimLedgerSummary;
    createdAt: number;
  },
) {
  const interruptIds: any[] = [];

  if (args.resolution.state === "ambiguous") {
    const interruptId = await ensureRuntimeInterrupt(ctx, {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      kind: "entity_disambiguation_required",
      description:
        "Multiple candidate entities survived resolution. Clarify the target before NodeBench saves anything.",
      payload: {
        resolutionState: args.resolution.state,
        candidates: args.resolution.candidates,
      },
      createdAt: args.createdAt,
    });
    if (interruptId) interruptIds.push(interruptId);
  } else if (args.resolution.state === "unresolved") {
    const interruptId = await ensureRuntimeInterrupt(ctx, {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      kind: "missing_required_context",
      description:
        "NodeBench needs a clearer entity or source URL before it can promote this thread beyond chat-only mode.",
      payload: {
        resolutionState: args.resolution.state,
        resolutionReason: args.resolution.reason,
      },
      createdAt: args.createdAt,
    });
    if (interruptId) interruptIds.push(interruptId);
  }

  if (args.claimSummary.contradictedClaims > 0) {
    const interruptId = await ensureRuntimeInterrupt(ctx, {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      kind: "conflicting_evidence_detected",
      description:
        "The claim ledger detected conflicting evidence in the same slot. Review the contradiction before trusting the answer.",
      payload: {
        contradictedClaims: args.claimSummary.contradictedClaims,
        rejectionReasons: args.claimSummary.rejectionReasons,
      },
      createdAt: args.createdAt,
    });
    if (interruptId) interruptIds.push(interruptId);
  }

  if (args.persistence.saveEligibility !== "save_ready") {
    const interruptId = await ensureRuntimeInterrupt(ctx, {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      kind: "quality_gate_blocked_save",
      description: `NodeBench blocked canonical save promotion. ${args.persistence.reason}`,
      payload: {
        artifactState: args.persistence.artifactState,
        saveEligibility: args.persistence.saveEligibility,
        reason: args.persistence.reason,
      },
      createdAt: args.createdAt,
    });
    if (interruptId) interruptIds.push(interruptId);
  }

  return interruptIds;
}

async function recoverSessionToolEvents(
  ctx: any,
  args: {
    ownerKey: string;
    sessionId: any;
    toolEvents: Array<{
      _id: any;
      tool: string;
      provider?: string;
      model?: string;
      step: number;
      totalPlanned: number;
      status: "running" | "done" | "error";
      durationMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      preview?: string;
      startedAt: number;
      updatedAt: number;
    }>;
    createdAt: number;
    failRun: boolean;
  },
) {
  const grouped = new Map<string, typeof args.toolEvents>();
  for (const event of args.toolEvents) {
    const key = `${event.step}:${event.tool}`;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }

  const recoveries: Array<{
    tool: string;
    provider?: string;
    step: number;
    reason: string;
  }> = [];

  for (const group of grouped.values()) {
    const sorted = [...group].sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
      if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt;
      return String(left._id).localeCompare(String(right._id));
    });
    const preferred =
      [...sorted].reverse().find((event) => event.status === "done") ??
      [...sorted].reverse().find((event) => event.status === "error") ??
      sorted[sorted.length - 1];

    for (const event of sorted) {
      if (event._id === preferred._id) continue;
      if (event.status === "error") continue;
      await ctx.db.patch(event._id, {
        status: "error",
        durationMs: event.durationMs ?? Math.max(0, args.createdAt - event.startedAt),
        preview: buildPreviewText(
          event.preview ?? "Recovered duplicate tool event and marked it superseded.",
        ),
        updatedAt: args.createdAt,
      });
      recoveries.push({
        tool: event.tool,
        provider: event.provider,
        step: event.step,
        reason: "duplicate tool event superseded",
      });
    }

    if (preferred.status === "running") {
      await ctx.db.patch(preferred._id, {
        status: args.failRun ? "error" : "done",
        durationMs: preferred.durationMs ?? Math.max(0, args.createdAt - preferred.startedAt),
        preview: buildPreviewText(
          preferred.preview ??
            (args.failRun
              ? "Recovered unfinished tool call after a failed run."
              : "Recovered unfinished tool call at run completion."),
        ),
        updatedAt: args.createdAt,
      });
      recoveries.push({
        tool: preferred.tool,
        provider: preferred.provider,
        step: preferred.step,
        reason: args.failRun
          ? "unfinished tool event closed as error"
          : "unfinished tool event closed as done",
      });
    }
  }

  for (const recovery of recoveries) {
    await insertRunEvent(ctx, {
      ownerKey: args.ownerKey,
      sessionId: args.sessionId,
      kind: "tool_recovered",
      status: "warning",
      label: `${recovery.tool} step ${recovery.step} recovered: ${recovery.reason}.`,
      tool: recovery.tool,
      provider: recovery.provider,
      step: recovery.step,
      payload: recovery,
      createdAt: args.createdAt,
    });
  }

  return recoveries;
}

export const startSession = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    query: v.string(),
    lens: v.union(
      v.literal("founder"),
      v.literal("investor"),
      v.literal("banker"),
      v.literal("ceo"),
      v.literal("legal"),
      v.literal("student"),
    ),
    files: v.optional(
      v.array(
        v.object({
          evidenceId: v.optional(v.id("productEvidenceItems")),
          name: v.string(),
          type: v.string(),
          size: v.optional(v.number()),
        }),
      ),
    ),
    contextHint: v.optional(v.string()),
    contextLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const now = Date.now();
    const intentKind = classifyProductRequest(args.query);

    const bundleId = await ctx.db.insert("productInputBundles", {
      ownerKey: identity.ownerKey,
      query: args.query,
      lens: args.lens,
      entrySurface: "chat",
      status: "processing",
      uploadedFiles: args.files ?? [],
      createdAt: now,
      updatedAt: now,
    });

    const sessionId = await ctx.db.insert("productChatSessions", {
      ownerKey: identity.ownerKey,
      bundleId,
      query: args.query,
      lens: args.lens,
      title: args.query,
      intentKind,
      resolutionState: "unresolved",
      resolutionConfidence: 0,
      resolutionReason: "NodeBench has not resolved a stable target yet.",
      artifactState: "none",
      saveEligibility: "blocked",
      saveEligibilityReason: "No artifact is created until the target and support gates pass.",
      status: "streaming",
      operatorContext: args.contextHint?.trim()
        ? {
            hint: args.contextHint.trim(),
            label: args.contextLabel?.trim() || undefined,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("productChatEvents", {
      ownerKey: identity.ownerKey,
      sessionId,
      type: "message",
      label: "User query",
      body: args.query,
      payload: {
        role: "user",
      },
      createdAt: now,
    });

    if (args.contextHint?.trim()) {
      await ctx.db.insert("productChatEvents", {
        ownerKey: identity.ownerKey,
        sessionId,
        type: "system",
        label: "Operator context applied",
        body: args.contextLabel?.trim()
          ? `Applied saved context: ${args.contextLabel.trim()}`
          : "Applied saved operator context from Me.",
        payload: {
          role: "system",
          contextHint: args.contextHint.trim(),
          contextLabel: args.contextLabel?.trim() || null,
        },
        createdAt: now,
      });
    }

    await insertRunEvent(ctx, {
      ownerKey: identity.ownerKey,
      sessionId,
      kind: "run_started",
      status: "info",
      label: "Run started.",
      payload: {
        query: args.query,
        lens: args.lens,
        uploadedFiles: (args.files ?? []).length,
        contextApplied: Boolean(args.contextHint?.trim()),
      },
      createdAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey: identity.ownerKey,
      sessionId,
      kind: "intent_classified",
      status: "info",
      label: `Intent classified as ${intentKind.replace(/_/g, " ")}.`,
      payload: {
        intentKind,
      },
      createdAt: now,
    });

    await ctx.db.insert("productReportDrafts", {
      ownerKey: identity.ownerKey,
      sessionId,
      title: args.query,
      status: "building",
      sections: draftSections,
      createdAt: now,
      updatedAt: now,
    });

    for (const file of args.files ?? []) {
      if (file.evidenceId) {
        const existingEvidence = await ctx.db.get(file.evidenceId);
        if (existingEvidence && existingEvidence.ownerKey === identity.ownerKey) {
          await ctx.db.patch(file.evidenceId, {
            bundleId,
            sessionId,
            status: "processing",
            updatedAt: now,
          });
          continue;
        }
      }

      await ctx.db.insert("productEvidenceItems", {
        ownerKey: identity.ownerKey,
        bundleId,
        sessionId,
        type: "file",
        label: file.name,
        status: "processing",
        mimeType: file.type,
        metadata: {
          size: file.size,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      bundleId,
      sessionId,
      reportId: null,
      artifactState: "none",
      saveEligibility: "blocked",
    };
  },
});

export const recordToolStart = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
    tool: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    step: v.number(),
    totalPlanned: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      throw new Error("Session not found");
    }

    const now = Date.now();
    await ctx.db.insert("productToolEvents", {
      ownerKey: identity.ownerKey,
      sessionId: args.sessionId,
      tool: args.tool,
      provider: args.provider,
      model: args.model,
      step: args.step,
      totalPlanned: args.totalPlanned,
      reason: args.reason,
      status: "running",
      startedAt: now,
      updatedAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey: identity.ownerKey,
      sessionId: args.sessionId,
      kind: "tool_started",
      status: "info",
      label: `${args.tool} started.`,
      tool: args.tool,
      provider: args.provider,
      model: args.model,
      step: args.step,
      totalPlanned: args.totalPlanned,
      payload: {
        reason: args.reason,
      },
      createdAt: now,
    });

    await ctx.db.patch(args.sessionId, { updatedAt: now });
    return { ok: true };
  },
});

export const recordToolDone = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
    tool: v.string(),
    step: v.number(),
    durationMs: v.optional(v.number()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    preview: v.optional(v.any()),
    isError: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      throw new Error("Session not found");
    }

    const existing = await ctx.db
      .query("productToolEvents")
      .withIndex("by_session_step", (q) => q.eq("sessionId", args.sessionId).eq("step", args.step))
      .collect();

    const matching = existing.find((event) => event.tool === args.tool) ?? existing[0] ?? null;
    const now = Date.now();
    let recoveredMissingStart = false;
    if (matching) {
      await ctx.db.patch(matching._id, {
        status: args.isError ? "error" : "done",
        durationMs: args.durationMs,
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        preview: buildPreviewText(args.preview),
        updatedAt: now,
      });
    } else {
      recoveredMissingStart = true;
      await ctx.db.insert("productToolEvents", {
        ownerKey: identity.ownerKey,
        sessionId: args.sessionId,
        tool: args.tool,
        step: args.step,
        totalPlanned: args.step,
        status: args.isError ? "error" : "done",
        durationMs: args.durationMs,
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        preview: buildPreviewText(args.preview ?? "Recovered tool completion without a matching tool start."),
        startedAt: Math.max(0, now - Math.max(0, args.durationMs ?? 0)),
        updatedAt: now,
      });
    }

    await insertRunEvent(ctx, {
      ownerKey: identity.ownerKey,
      sessionId: args.sessionId,
      kind: recoveredMissingStart ? "tool_recovered" : "tool_completed",
      status: args.isError ? "error" : recoveredMissingStart ? "warning" : "success",
      label: recoveredMissingStart
        ? `${args.tool} step ${args.step} recovered without a matching start event.`
        : `${args.tool} step ${args.step} completed.`,
      tool: args.tool,
      step: args.step,
      payload: {
        durationMs: args.durationMs,
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        preview: buildPreviewText(args.preview),
      },
      createdAt: now,
    });

    const allToolEvents = await ctx.db
      .query("productToolEvents")
      .withIndex("by_session_step", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const providerBudgetSummary = buildProductProviderBudgetSummary(allToolEvents);
    if (providerBudgetSummary.overallStatus !== "ok") {
      await insertRunEvent(ctx, {
        ownerKey: identity.ownerKey,
        sessionId: args.sessionId,
        kind: "provider_budget",
        status: providerBudgetSummary.overallStatus === "exceeded" ? "error" : "warning",
        label: buildBudgetEventLabel(providerBudgetSummary),
        provider: providerBudgetSummary.providers[0]?.provider,
        payload: providerBudgetSummary,
        createdAt: now,
      });
      await ensureBudgetInterrupt(ctx, {
        sessionId: args.sessionId,
        ownerKey,
        summary: providerBudgetSummary,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.sessionId, { updatedAt: now });
    return { ok: true };
  },
});

export const completeSession = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
    packet: v.any(),
    entitySlugHint: v.optional(v.string()),
    routing: v.optional(productRoutingDecisionValidator),
    totalDurationMs: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== ownerKey) {
      throw new Error("Session not found");
    }

    const now = Date.now();
    const artifactMode = deriveReportArtifactMode(session.query);
    const sections = deriveSectionsFromPacket(args.packet, artifactMode);
    const sources = normalizeSources(args.packet);
    const routing = args.routing ?? undefined;
    const shouldPersistReport = hasPersistableSessionPacket(args.packet, args.error);
    const reportTitle =
      artifactMode === "prep_brief"
        ? buildPrepBriefTitle({
            entityName: typeof args.packet?.entityName === "string" ? args.packet.entityName : undefined,
            fallbackQuery: session.query,
          })
        : summarizeText(args.packet?.entityName ?? session.query, session.query);
    const reportSummary = summarizeText(args.packet?.answer, "No clear summary was returned.");

    const draft = await ctx.db
      .query("productReportDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    const existingReportId = resolveSessionReportId(session);
    const existingReport = await safeGetSessionReport(ctx, existingReportId);

    const existingEvidence = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_session", (q) =>
        q.eq("ownerKey", ownerKey).eq("sessionId", args.sessionId),
      )
      .collect();

    const toolEvents = await ctx.db
      .query("productToolEvents")
      .withIndex("by_session_step", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const recoveries = await recoverSessionToolEvents(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      toolEvents,
      createdAt: now,
      failRun: Boolean(args.error),
    });
    const finalToolEvents = await ctx.db
      .query("productToolEvents")
      .withIndex("by_session_step", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const providerBudgetSummary = buildProductProviderBudgetSummary(finalToolEvents);
    if (providerBudgetSummary.providers.length > 0) {
      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "provider_budget",
        status:
          providerBudgetSummary.overallStatus === "exceeded"
            ? "error"
            : providerBudgetSummary.overallStatus === "warning"
              ? "warning"
              : "info",
        label: buildBudgetEventLabel(providerBudgetSummary),
        provider: providerBudgetSummary.providers[0]?.provider,
        payload: providerBudgetSummary,
        createdAt: now,
      });
      await ensureBudgetInterrupt(ctx, {
        sessionId: args.sessionId,
        ownerKey,
        summary: providerBudgetSummary,
        createdAt: now,
      });
    }
    const assistantAnswer =
      typeof args.packet?.answer === "string" && args.packet.answer.trim()
        ? args.packet.answer.trim()
        : reportSummary;
    const strictResolutionGate = isProductRuntimeFlagEnabled(
      "strict_resolution_gate_v1",
    );
    const claimLedgerEnabled = isProductRuntimeFlagEnabled("claim_ledger_v1");
    const truthCompilerEnabled = isProductRuntimeFlagEnabled(
      "truth_compiler_v1",
    );
    const actionCompilerEnabled = isProductRuntimeFlagEnabled(
      "action_compiler_v1",
    );
    const artifactSaveGateEnabled = isProductRuntimeFlagEnabled(
      "artifact_save_gate_v1",
    );

    const resolution = strictResolutionGate
      ? resolveProductTarget({
          query: session.query,
          entitySlugHint: args.entitySlugHint,
          packetEntityName:
            typeof args.packet?.entityName === "string"
              ? args.packet.entityName
              : null,
          sources: normalizeClaimSources(sources),
        })
      : {
          intentKind: session.intentKind ?? classifyProductRequest(session.query),
          state: "exact" as const,
          entityName:
            typeof args.packet?.entityName === "string"
              ? args.packet.entityName
              : null,
          entitySlug: args.entitySlugHint ?? null,
          confidence: 0.99,
          reason: "Strict resolution gate disabled.",
          candidates: [],
        };

    await replaceResolutionCandidates(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      resolution,
      createdAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: "entity_candidates_ranked",
      status:
        resolution.candidates.length > 1
          ? "warning"
          : resolution.candidates.length === 1
            ? "success"
            : "pending",
      label:
        resolution.candidates.length > 0
          ? `${resolution.candidates.length} resolution candidate${resolution.candidates.length === 1 ? "" : "s"} ranked.`
          : "No stable resolution candidates found.",
      payload: {
        candidates: resolution.candidates,
      },
      createdAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: "entity_resolution_finalized",
      status:
        resolution.state === "exact"
          ? "success"
          : resolution.state === "probable"
            ? "warning"
            : "pending",
      label: `Resolution finalized as ${resolution.state}.`,
      payload: resolution,
      createdAt: now,
    });

    const sourceEvidenceByRefId = claimLedgerEnabled
      ? await upsertSourceEvidenceItems(ctx, {
          ownerKey,
          bundleId: session.bundleId,
          sessionId: args.sessionId,
          query: session.query,
          sources,
          existingEvidence,
          createdAt: now,
        })
      : new Map<string, any>();

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: "evidence_collected",
      status: sources.length > 0 ? "success" : "warning",
      label: `${sources.length} source${sources.length === 1 ? "" : "s"} normalized into evidence.`,
      payload: {
        sourceCount: sources.length,
        evidenceCount: sourceEvidenceByRefId.size,
      },
      createdAt: now,
    });

    const claims = claimLedgerEnabled
      ? extractClaimsFromSections({
          sections: normalizeClaimSections(sections),
          sources: normalizeClaimSources(sources),
          resolution,
        })
      : [];
    const claimSummary = claimLedgerEnabled
      ? summarizeClaimLedger(claims)
      : {
          totalClaims: 0,
          publishableClaims: 0,
          rejectedClaims: 0,
          contradictedClaims: 0,
          corroboratedClaims: 0,
          verifiedClaims: 0,
          weakClaims: 0,
          rejectionReasons: [],
        };
    const persistence = artifactSaveGateEnabled
      ? decidePersistence({
          resolution,
          claimSummary,
          sourceCount: sources.length,
        })
      : {
          artifactState: "saved" as const,
          saveEligibility: "save_ready" as const,
          reason: "Artifact save gate disabled.",
        };
    const truthSectionsDraft = truthCompilerEnabled
      ? compileTruthSections({ claims })
      : [];
    const actionItems: ProductActionItem[] = actionCompilerEnabled
      ? compileActionItems({
          resolution,
          artifactState: persistence.artifactState,
          saveEligibility: persistence.saveEligibility,
        })
      : [];

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: "claims_extracted",
      status: claims.length > 0 ? "success" : "warning",
      label: `${claims.length} claim${claims.length === 1 ? "" : "s"} extracted.`,
      payload: claimSummary,
      createdAt: now,
    });

    if (claimSummary.rejectedClaims > 0) {
      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "claims_rejected",
        status: "warning",
        label: `${claimSummary.rejectedClaims} claim${claimSummary.rejectedClaims === 1 ? "" : "s"} rejected by deterministic gates.`,
        payload: {
          rejectionReasons: claimSummary.rejectionReasons,
        },
        createdAt: now,
      });
    }

    if (claimSummary.publishableClaims > 0) {
      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "claims_published",
        status: "success",
        label: `${claimSummary.publishableClaims} claim${claimSummary.publishableClaims === 1 ? "" : "s"} cleared publishability gates.`,
        payload: claimSummary,
        createdAt: now,
      });
    }

    if (truthCompilerEnabled) {
      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "truth_compiled",
        status: truthSectionsDraft.some((section) => section.sentences.length > 0)
          ? "success"
          : "warning",
        label: "Truth compiler completed.",
        payload: {
          sections: truthSectionsDraft.length,
        },
        createdAt: now,
      });
    }

    if (actionCompilerEnabled) {
      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "actions_compiled",
        status: actionItems.length > 0 ? "success" : "warning",
        label: "Action compiler completed.",
        payload: {
          actions: actionItems,
        },
        createdAt: now,
      });
    }

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: "artifact_state_changed",
      status:
        persistence.artifactState === "saved"
          ? "success"
          : persistence.artifactState === "draft"
            ? "warning"
            : "pending",
      label: `Artifact state is now ${persistence.artifactState}.`,
      payload: persistence,
      createdAt: now,
    });

    const qualityInterruptIds = await ensureQualityInterrupts(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      resolution,
      persistence,
      claimSummary,
      createdAt: now,
    });

    const verdict = deriveRunVerdict({
      error: args.error,
      sourceCount: sources.length,
      summary: providerBudgetSummary,
      answer: assistantAnswer,
      resolution,
      claimSummary,
    });
    const gateResults = buildGateResults({
      error: args.error,
      sourceCount: sources.length,
      answer: assistantAnswer,
      summary: providerBudgetSummary,
      resolution,
      claimSummary,
      persistence,
    });
    const costUsd = estimateRunCostUsd(providerBudgetSummary);
    const needsAttention = computeNeedsAttention({
      verdict,
      hasPendingInterrupts:
        providerBudgetSummary.overallStatus !== "ok" ||
        qualityInterruptIds.length > 0,
      resolutionState: resolution.state,
      saveEligibility: persistence.saveEligibility,
    });

    const sessionPatchBase = {
      intentKind: resolution.intentKind,
      resolutionState: resolution.state,
      resolvedEntitySlug: resolution.entitySlug ?? undefined,
      resolutionConfidence: resolution.confidence,
      resolutionReason: resolution.reason,
      artifactState: persistence.artifactState,
      saveEligibility: persistence.saveEligibility,
      saveEligibilityReason: persistence.reason,
      latestSummary: reportSummary,
      lastError: args.error,
      totalDurationMs: args.totalDurationMs,
      verdict,
      gateResults,
      costUsd,
      needsAttention,
      routing,
      updatedAt: now,
    } as const;

    if (!shouldPersistReport) {
      if (draft) {
        await ctx.db.patch(draft._id, {
          title: args.packet?.entityName ?? session.query,
          status: "pending",
          sections,
          updatedAt: now,
        });
      }

      await ctx.db.patch(args.sessionId, {
        ...sessionPatchBase,
        status: "error",
        linkedReportId: existingReport?._id ?? undefined,
        autoSavedReportId: existingReport?._id ?? undefined,
      });

      if (session.bundleId) {
        await ctx.db.patch(session.bundleId, {
          status: "error",
          updatedAt: now,
        });
      }

      await ctx.db.insert("productChatEvents", {
        ownerKey,
        sessionId: args.sessionId,
        type: "error",
        label: "Run failed",
        body: args.error ?? "Live refresh failed before NodeBench could persist a trustworthy artifact.",
        payload: {
          reportId: existingReport?._id ?? null,
          routingMode: routing?.routingMode,
          resolutionState: resolution.state,
          saveEligibility: persistence.saveEligibility,
        },
        createdAt: now,
      });

      await insertRunEvent(ctx, {
        ownerKey,
        sessionId: args.sessionId,
        kind: "run_failed",
        status: "error",
        label: args.error ?? "Run failed before artifact persistence.",
        payload: {
          routingMode: routing?.routingMode,
          providerBudgetSummary,
          recoveries,
          resolution,
          claimSummary,
        },
        createdAt: now,
      });

      return {
        reportId: existingReport?._id ?? null,
        entitySlug: resolution.entitySlug ?? existingReport?.entitySlug ?? null,
        resolutionState: resolution.state,
        artifactState: persistence.artifactState,
        saveEligibility: persistence.saveEligibility,
      };
    }

    let entityMeta:
      | Awaited<ReturnType<typeof ensureEntityForReport>>
      | {
          entityId: any;
          entitySlug: string | null;
          entityName: string;
          entityType: string;
          revision: number;
          previousReportId?: any;
          reportCount: number;
        };

    if (resolution.state === "exact") {
      entityMeta = await ensureEntityForReport(ctx, {
        ownerKey,
        primaryEntity:
          typeof args.packet?.entityName === "string"
            ? args.packet.entityName
            : resolution.entityName ?? undefined,
        entitySlugHint: resolution.entitySlug ?? args.entitySlugHint,
        title: reportTitle,
        query: session.query,
        type:
          typeof args.packet?.classification === "string"
            ? args.packet.classification
            : artifactMode,
        sourceUrls: sources.map((source) => source.href),
        lens: session.lens,
        summary: reportSummary,
        now,
      });
    } else {
      entityMeta = {
        entityId: existingReport?.entityId ?? undefined,
        entitySlug:
          resolution.entitySlug ??
          existingReport?.entitySlug ??
          args.entitySlugHint ??
          null,
        entityName:
          resolution.entityName ??
          (typeof args.packet?.entityName === "string"
            ? args.packet.entityName
            : reportTitle),
        entityType:
          typeof args.packet?.classification === "string"
            ? args.packet.classification
            : artifactMode,
        revision: existingReport?.revision ?? 0,
        previousReportId: existingReport?._id ?? undefined,
        reportCount: existingReport ? 1 : 0,
      };
    }

    if (draft) {
      await ctx.db.patch(draft._id, {
        title: args.packet?.entityName ?? session.query,
        status: args.error ? "pending" : "complete",
        sections,
        updatedAt: now,
      });
    }

    const existingSourceEvents = await ctx.db
      .query("productSourceEvents")
      .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const source of sources) {
      const duplicate = existingSourceEvents.some(
        (stored) =>
          stored.sourceKey === source.id ||
          (!!stored.href && stored.href === source.href),
      );
      if (duplicate) continue;
      await ctx.db.insert("productSourceEvents", {
        ownerKey,
        sessionId: args.sessionId,
        sourceKey: source.id,
        label: source.label,
        href: source.href,
        type: source.type,
        status: source.status,
        title: source.title,
        domain: source.domain,
        siteName: source.siteName,
        faviconUrl: source.faviconUrl,
        publishedAt: source.publishedAt,
        thumbnailUrl: source.thumbnailUrl,
        imageCandidates: source.imageCandidates,
        excerpt: source.excerpt,
        confidence: source.confidence,
        createdAt: now,
      });
    }

    // ── Defense-in-depth artifact save gate ──────────────────────────
    // Composes with the upstream productAnswerControl.decidePersistence
    // decision. Only clamps DOWNWARD (never lifts a draft to saved).
    // Hard blocks for:
    //   - adversarial category (prompt injection, PII, SSRF, exfil)
    //   - unsupported claim flagged by answer-control
    //   - hallucination gate failure
    // Other cases defer to persistence.saveEligibility. See:
    // convex/domains/agents/safety/artifactDecisionGate.ts
    const classificationValue: PrimaryCategory = (() => {
      const raw =
        typeof args.packet?.classification === "string"
          ? args.packet.classification.trim().toLowerCase()
          : "";
      // Narrow to known values; default to "entity" for product-diligence flow
      const knownCategories: readonly PrimaryCategory[] = [
        "entity",
        "people",
        "product",
        "job",
        "location",
        "event",
        "compare",
        "multi_category",
        "ambiguous",
        "file_grounded",
        "file_plus_web",
        "artifact_reuse",
        "crm_action",
        "crm_export",
        "share_export",
        "pulse",
        "pulse_generation",
        "browser_tooling",
        "contradiction",
        "prolonged_usage",
        "chat_followup",
        "save_gate",
        "mobile_on_the_go",
        "background",
        "coalesced",
      ];
      return (knownCategories.find((c) => c === raw) ?? "entity") as PrimaryCategory;
    })();
    const resolutionExpectation: ResolutionExpectation = (() => {
      const raw = String(resolution.state ?? "").trim().toLowerCase();
      const known: readonly ResolutionExpectation[] = [
        "exact",
        "exact_or_probable",
        "probable",
        "probable_allowed",
        "ambiguous",
        "ambiguous_or_exact",
        "contextual",
        "file_first",
      ];
      return (known.find((k) => k === raw) ?? "probable") as ResolutionExpectation;
    })();
    const gateDecision = decideArtifactState({
      mode: "slow",
      primaryCategory: classificationValue,
      resolutionExpectation,
      citationCount: sources.length,
      // Use claim ledger signals as proxy; persistence carries retrieval confidence upstream.
      retrievalConfidence:
        sources.length >= 3 ? "high" : sources.length >= 1 ? "medium" : "low",
      hallucinationGateFailed: Boolean(
        (claimSummary as unknown as { hallucinationFailed?: boolean })?.hallucinationFailed,
      ),
      userExplicitlyRequestedSave: Boolean(
        (args as unknown as { requestSave?: boolean }).requestSave,
      ),
      userScopedToEvent: Boolean(
        (session as unknown as { eventId?: string }).eventId ??
          (args as unknown as { eventId?: string }).eventId,
      ),
      hasUnsupportedClaim: Boolean(
        (claimSummary as unknown as { unsupportedClaims?: unknown[] })?.unsupportedClaims
          ?.length ?? 0,
      ),
    });

    // Clamp downward only. Never promote a draft to saved.
    let effectiveArtifactState = persistence.artifactState;
    if (gateDecision.allowedState === "none" && effectiveArtifactState !== "none") {
      console.warn(
        `[chat.ts artifactDecisionGate] HARD-BLOCK clamp from "${persistence.artifactState}" to "none"` +
          ` — ${gateDecision.reason}; category=${classificationValue}; resolution=${resolutionExpectation}`,
      );
      effectiveArtifactState = "none";
    } else if (
      gateDecision.allowedState === "draft_only" &&
      effectiveArtifactState === "saved"
    ) {
      console.warn(
        `[chat.ts artifactDecisionGate] DOWN-CLAMP saved→draft — ${gateDecision.reason};` +
          ` category=${classificationValue}`,
      );
      effectiveArtifactState = "draft";
    }

    // Propagate the clamp to every downstream surface so session, chat events,
    // entity index, run events, nudge, and the mutation return value observe
    // the gate — not just the productReports row. Fixes the "surfaces
    // disagree about saved vs draft" regression (bug_006).
    const effectiveSaveEligibility: typeof persistence.saveEligibility =
      effectiveArtifactState === "none"
        ? "blocked"
        : effectiveArtifactState === "draft" && persistence.artifactState === "saved"
          ? "draft_only"
          : persistence.saveEligibility;
    // sessionPatchBase was built pre-gate (line ~1625) with unclamped values;
    // override in place so the eventual session patch reflects the clamp.
    // const-declared objects allow property writes; this is safe.
    (sessionPatchBase as { artifactState: typeof effectiveArtifactState }).artifactState =
      effectiveArtifactState;
    (sessionPatchBase as { saveEligibility: typeof effectiveSaveEligibility }).saveEligibility =
      effectiveSaveEligibility;

    let reportId = existingReport?._id ?? null;
    let reportStatus: "draft" | "saved" = "draft";
    if (effectiveArtifactState !== "none") {
      reportStatus = effectiveArtifactState === "saved" ? "saved" : "draft";
      const reportPatch = {
        sessionId: args.sessionId,
        bundleId: session.bundleId,
        entityId: entityMeta.entityId,
        entitySlug: entityMeta.entitySlug ?? undefined,
        title: reportTitle,
        type: artifactMode,
        summary: reportSummary,
        status: reportStatus,
        resolutionState: resolution.state,
        // Use the clamped value so down-clamps (saved→draft) are honored in the DB row
        artifactState: effectiveArtifactState,
        saveEligibility: effectiveSaveEligibility,
        primaryEntity:
          typeof args.packet?.entityName === "string"
            ? args.packet.entityName
            : resolution.entityName ?? undefined,
        lens: session.lens,
        query: session.query,
        routing,
        operatorContext: session.operatorContext ?? undefined,
        sections,
        sources,
        evidenceItemIds: [
          ...existingEvidence.map((item) => item._id),
          ...Array.from(sourceEvidenceByRefId.values())
            .map((item: any) => item?._id)
            .filter(Boolean),
        ],
        qualityGateSummary: claimSummary,
        revision: entityMeta.revision,
        previousReportId: entityMeta.previousReportId ?? undefined,
        lastRefreshAt: now,
        // PR D: populate searchableText so the federated `search_reports`
        // index sees both the chat-driven insert AND any subsequent patch.
        // This is the hottest report write path — every chat finalization
        // flows through here.
        searchableText: recomputeReportSearchableText({
          title: reportTitle,
          summary: reportSummary,
          query: session.query,
          primaryEntity:
            typeof args.packet?.entityName === "string"
              ? args.packet.entityName
              : (resolution.entityName ?? undefined),
          entitySlug: entityMeta.entitySlug ?? undefined,
        }),
        updatedAt: now,
      };

      if (existingReport && existingReport.ownerKey === ownerKey) {
        await ctx.db.patch(existingReport._id, reportPatch);
        reportId = existingReport._id;
      } else {
        reportId = await ctx.db.insert("productReports", {
          ownerKey,
          pinned: false,
          visibility: "private",
          createdAt: now,
          ...reportPatch,
        });
      }
      // PR E: schedule per-row embedding for the inserted or patched report.
      // Idempotent on searchableTextHash, so the patch path doesn't double-embed.
      if (reportId) {
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedReportRow,
          { reportId },
        );
      }

      // Wiki-maintainer ingest hook (Stage 1 INGEST of the four-stage
      // pipeline in docs/architecture/ME_AGENT_DESIGN.md). Fire-and-forget
      // — the enqueue mutation deduplicates via idempotency key, so
      // duplicate saves within the debounce window collapse onto one regen.
      // Only fires when the save actually lands (effectiveArtifactState !== "none").
      if (reportId && entityMeta.entitySlug) {
        const wikiPageType: "topic" | "company" | "person" | "product" | "event" | "location" | "job" | "contradiction" =
          (() => {
            const cat = String(args.packet?.classification ?? "").toLowerCase();
            if (
              cat === "company" ||
              cat === "person" ||
              cat === "product" ||
              cat === "event" ||
              cat === "location" ||
              cat === "job" ||
              cat === "topic" ||
              cat === "contradiction"
            ) {
              return cat;
            }
            if (cat === "market" || cat === "industry") return "topic";
            if (cat === "founder" || cat === "people") return "person";
            if (cat === "entity") return "company";
            return "company";
          })();
        await ctx.scheduler.runAfter(
          0,
          internal.domains.product.userWikiMaintainer.enqueueRegenFromSignal,
          {
            ownerKey,
            targetSlug: entityMeta.entitySlug,
            targetPageType: wikiPageType,
            triggerSignal: "report_saved" as const,
            triggerRef: String(reportId),
          },
        );
      }
    }

    const claimInsert = claimLedgerEnabled
      ? await replaceSessionClaims(ctx, {
          ownerKey,
          sessionId: args.sessionId,
          reportId: reportId ?? undefined,
          entityId: entityMeta.entityId,
          claims,
          sourceEvidenceByRefId,
          resolution,
          createdAt: now,
        })
      : { claimRows: [], claimIdByKey: new Map<string, any>() };

    const compiledAnswerV2 =
      truthCompilerEnabled || actionCompilerEnabled
        ? {
            resolutionState: resolution.state,
            artifactState: effectiveArtifactState,
            saveEligibility: effectiveSaveEligibility,
            truthSections: materializeCompiledSections({
              compiledSections: truthSectionsDraft,
              claimIdByKey: claimInsert.claimIdByKey,
              sourceEvidenceByRefId,
            }),
            actions: actionItems,
          }
        : undefined;

    if (reportId && compiledAnswerV2) {
      await ctx.db.patch(reportId, {
        claimIds: claimInsert.claimRows.map((claim) => claim._id),
        compiledAnswerV2,
        updatedAt: now,
      });
    }

    const sourceEvidenceRows = Array.from(sourceEvidenceByRefId.values()).filter(
      (item: any) => item?._id,
    );
    for (const evidence of [...existingEvidence, ...sourceEvidenceRows]) {
      await ctx.db.patch(evidence._id, {
        entityId: entityMeta.entityId,
        reportId: reportId ?? undefined,
        status: reportId ? "linked" : evidence.status,
        matchedEntityId: entityMeta.entityId,
        matchedEntityConfidence: resolution.confidence,
        freshnessStatus:
          evidence.publishedAt || evidence.metadata?.publishedAt
            ? "fresh"
            : evidence.freshnessStatus ?? "unknown",
        updatedAt: now,
      });
    }

    if (!args.error) {
      await ctx.db.insert("productChatEvents", {
        ownerKey,
        sessionId: args.sessionId,
        type: "message",
        label: "Assistant answer",
        body: assistantAnswer,
        payload: {
          role: "assistant",
          reportId,
          entitySlug: entityMeta.entitySlug,
          sectionCount: sections.length,
          artifactState: effectiveArtifactState,
          saveEligibility: effectiveSaveEligibility,
        },
        createdAt: now,
      });
    }

    if (
      reportId &&
      entityMeta.entityId &&
      entityMeta.entitySlug &&
      effectiveArtifactState === "saved"
    ) {
      await syncGenericDiligenceProjectionDrafts(ctx, {
        ownerKey,
        entityId: entityMeta.entityId,
        entitySlug: entityMeta.entitySlug,
        drafts: buildGenericDiligenceProjectionDrafts({
          entitySlug: entityMeta.entitySlug,
          title: reportTitle,
          primaryEntity:
            typeof args.packet?.entityName === "string"
              ? args.packet.entityName
              : entityMeta.entityName,
          sections,
          sources,
          updatedAt: now,
          revision: entityMeta.revision,
        }),
      });

      await ctx.scheduler.runAfter(
        0,
        internal.domains.product.diligenceProjections.runScratchpadProjectionPass,
        {
          ownerKey,
          entityId: entityMeta.entityId,
          workflowId: `scratchpad:${entityMeta.entitySlug}:${entityMeta.entityId}:${now}:session_complete:all:${args.sessionId}`,
          reason: "session_complete",
          userId: identity.rawUserId ?? undefined,
          idempotencyKey: `overlay:${entityMeta.entityId}:${entityMeta.entitySlug}:${now}:all:${args.sessionId}`,
          report: {
            entitySlug: entityMeta.entitySlug,
            title: reportTitle,
            primaryEntity:
              typeof args.packet?.entityName === "string"
                ? args.packet.entityName
                : entityMeta.entityName,
            sections,
            sources,
            updatedAt: now,
            revision: entityMeta.revision,
          },
        },
      );
    }

    if (entityMeta.entityId && reportId && effectiveArtifactState === "saved") {
      // PR D: refresh searchableText on the entity row when chat saves a
      // report (entity name/summary may have changed during finalization).
      const existingEntityForChat = await ctx.db.get(entityMeta.entityId);
      const nextEntitySearchableText = recomputeEntitySearchableText({
        name: entityMeta.entityName,
        slug: existingEntityForChat?.slug ?? entityMeta.entitySlug,
        summary: reportSummary,
        savedBecause: existingEntityForChat?.savedBecause,
      });
      await ctx.db.patch(entityMeta.entityId, {
        name: entityMeta.entityName,
        entityType: entityMeta.entityType,
        summary: reportSummary,
        latestReportId: reportId,
        latestReportUpdatedAt: now,
        latestRevision: entityMeta.revision,
        reportCount: entityMeta.reportCount,
        searchableText: nextEntitySearchableText,
        updatedAt: now,
      });
      // PR E: schedule per-row embedding for the chat-finalized entity.
      await ctx.scheduler.runAfter(
        0,
        internal.domains.search.embedRowOnUpdate.embedEntityRow,
        { entityId: entityMeta.entityId },
      );

      if (entityMeta.entitySlug) {
        await upsertEntityContextItem(ctx, {
          ownerKey,
          entitySlug: entityMeta.entitySlug,
          entityName: entityMeta.entityName,
          entityType: entityMeta.entityType,
          summary: reportSummary,
          linkedReportId: reportId,
          now,
        });

        await upsertExplicitRelatedEntitiesForReport(ctx, {
          ownerKey,
          primaryEntitySlug: entityMeta.entitySlug,
          query: session.query,
          sources,
          now,
        });
      }
    }

    await ctx.db.patch(args.sessionId, {
      ...sessionPatchBase,
      status: args.error ? "error" : "complete",
      linkedReportId: reportId ?? undefined,
      autoSavedReportId: reportId ?? undefined,
      resolvedEntityId: entityMeta.entityId,
    });

    if (session.bundleId) {
      await ctx.db.patch(session.bundleId, {
        status: args.error ? "error" : "complete",
        updatedAt: now,
      });
    }

    const milestoneLabel =
      effectiveArtifactState === "saved"
        ? "Report saved"
        : effectiveArtifactState === "draft"
          ? "Draft ready"
          : "Clarification required";
    const milestoneBody =
      args.error ??
      (effectiveArtifactState === "saved"
        ? "The run cleared the save gate and is now in Reports."
        : persistence.reason);

    await ctx.db.insert("productChatEvents", {
      ownerKey,
      sessionId: args.sessionId,
      type: args.error ? "error" : "milestone",
      label: args.error ? "Run failed" : milestoneLabel,
      body: milestoneBody,
      payload: {
        reportId,
        routingMode: routing?.routingMode,
        resolutionState: resolution.state,
        artifactState: effectiveArtifactState,
        saveEligibility: effectiveSaveEligibility,
      },
      createdAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey,
      sessionId: args.sessionId,
      kind: args.error ? "run_failed" : "run_completed",
      status: args.error
        ? "error"
        : effectiveArtifactState === "saved"
          ? "success"
          : effectiveArtifactState === "draft"
            ? "warning"
            : "pending",
      label: args.error
        ? "Run completed with errors."
        : effectiveArtifactState === "saved"
          ? "Run completed and report saved."
          : effectiveArtifactState === "draft"
            ? "Run completed and draft created."
            : "Run completed but is waiting on clarification.",
      payload: {
        reportId,
        entitySlug: entityMeta.entitySlug,
        routingMode: routing?.routingMode,
        providerBudgetSummary,
        recoveries,
        qualityInterruptIds,
        resolution,
        claimSummary,
        persistence,
      },
      createdAt: now,
    });

    if (
      reportId &&
      entityMeta.entitySlug &&
      effectiveArtifactState === "saved"
    ) {
      await upsertOpenProductNudge(ctx, {
        ownerKey,
        type: "refresh_recommended",
        title: `Revisit ${entityMeta.entityName}`,
        summary:
          "This report cleared the save gate and can be refreshed later if the underlying facts change.",
        linkedReportId: reportId,
        linkedChatSessionId: args.sessionId,
        priority: "medium",
        dueAt: now + 24 * 60 * 60 * 1000,
        actionLabel: "Open report",
        actionTargetSurface: "reports",
        actionTargetId: entityMeta.entitySlug,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.domains.product.reports.hydrateReportSourceMediaInternal,
        { reportId },
      );
    }

    return {
      reportId,
      entitySlug: entityMeta.entitySlug,
      resolutionState: resolution.state,
      artifactState: effectiveArtifactState,
      saveEligibility: effectiveSaveEligibility,
      claimSummary,
    };
  },
});

export const pinReport = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerKey !== identity.ownerKey) {
      throw new Error("Report not found");
    }
    await ctx.db.patch(args.reportId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const deleteSession = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== identity.ownerKey) {
      throw new Error("Session not found");
    }
    if (session.deletedAt) {
      return { deleted: true, sessionId: args.sessionId };
    }
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      deletedAt: now,
      updatedAt: now,
    });
    return { deleted: true, sessionId: args.sessionId };
  },
});

export const renameSession = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== identity.ownerKey) {
      throw new Error("Session not found");
    }
    const trimmed = args.title.trim().slice(0, 200);
    if (!trimmed) {
      throw new Error("Title cannot be empty");
    }
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      title: trimmed,
      updatedAt: now,
    });
    return { renamed: true, sessionId: args.sessionId, title: trimmed };
  },
});

export const resolveSessionInterrupt = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
    interruptId: v.id("agentInterrupts"),
    decisionType: v.union(v.literal("approve"), v.literal("reject")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== identity.ownerKey) {
      throw new Error("Session not found");
    }

    const interrupt = await ctx.db.get(args.interruptId);
    if (!interrupt || interrupt.threadId !== String(args.sessionId)) {
      throw new Error("Interrupt not found");
    }
    if (interrupt.status !== "pending") {
      throw new Error("Interrupt already resolved");
    }
    if (!interrupt.allowedDecisions.includes(args.decisionType)) {
      throw new Error("Decision not allowed for this interrupt");
    }

    const now = Date.now();
    await ctx.db.patch(args.interruptId, {
      status: args.decisionType,
      decision: {
        type: args.decisionType,
        message: args.message,
      },
      resolvedAt: now,
    });

    await insertRunEvent(ctx, {
      ownerKey: identity.ownerKey,
      sessionId: args.sessionId,
      kind: "interrupt_resolved",
      status: args.decisionType === "approve" ? "success" : "warning",
      label: `${interrupt.toolName} ${args.decisionType}d.`,
      tool: interrupt.toolName,
      payload: {
        interruptId: args.interruptId,
        decisionType: args.decisionType,
        message: args.message,
      },
      createdAt: now,
    });

    await ctx.db.patch(args.sessionId, { updatedAt: now });

    return { ok: true };
  },
});

export const getSession = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== identity.ownerKey) {
      return null;
    }

    const reportId = resolveSessionReportId(session);

    const [events, toolEvents, sourceEvents, draft, report, runEvents, interrupts, sessionFiles, sessionArtifacts, claims, resolutionCandidates] = await Promise.all([
      ctx.db
        .query("productChatEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      ctx.db
        .query("productToolEvents")
        .withIndex("by_session_step", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      ctx.db
        .query("productSourceEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      ctx.db
        .query("productReportDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .first(),
      safeGetSessionReport(ctx, reportId),
      ctx.db
        .query("productRunEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      ctx.db
        .query("agentInterrupts")
        .withIndex("by_thread", (q) => q.eq("threadId", String(args.sessionId)))
        .collect(),
      ctx.db
        .query("productEvidenceItems")
        .withIndex("by_owner_session", (q) => q.eq("ownerKey", identity.ownerKey).eq("sessionId", args.sessionId))
        .order("desc")
        .collect(),
      ctx.db
        .query("sessionArtifacts")
        .withIndex("by_session", (q) => q.eq("sessionId", String(args.sessionId)))
        .collect(),
      ctx.db
        .query("productClaims")
        .withIndex("by_owner_session", (q) =>
          q.eq("ownerKey", identity.ownerKey).eq("sessionId", args.sessionId),
        )
        .collect(),
      ctx.db
        .query("productResolutionCandidates")
        .withIndex("by_session_confidence", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
    ]);

    const providerBudgetSummary = buildProductProviderBudgetSummary(toolEvents);
    const claimSummary =
      report?.qualityGateSummary ?? {
        totalClaims: claims.length,
        publishableClaims: claims.filter((claim) => claim.publishable).length,
        rejectedClaims: claims.filter((claim) => !claim.publishable).length,
        contradictedClaims: claims.filter((claim) => claim.contradictionFlag).length,
        corroboratedClaims: claims.filter((claim) => claim.supportStrength === "corroborated").length,
        verifiedClaims: claims.filter((claim) => claim.supportStrength === "verified").length,
        weakClaims: claims.filter((claim) => claim.supportStrength === "weak").length,
        rejectionReasons: Array.from(new Set(claims.flatMap((claim) => claim.rejectionReasons))).sort(),
      };

    return {
      session: {
        ...session,
        verdict: session.verdict ?? (session.status === "error" ? "failed" : undefined),
        gateResults: session.gateResults ?? undefined,
        costUsd: session.costUsd ?? 0,
        needsAttention: session.needsAttention ?? session.status === "error",
        resolutionState: session.resolutionState ?? "unresolved",
        artifactState: session.artifactState ?? (report ? report.artifactState ?? (report.status === "saved" ? "saved" : "draft") : "none"),
        saveEligibility: session.saveEligibility ?? (report ? report.saveEligibility ?? (report.status === "saved" ? "save_ready" : "draft_only") : "blocked"),
      },
      events,
      toolEvents,
      runEvents,
      sourceEvents,
      draft,
      report,
      claims,
      claimSummary,
      resolutionCandidates: resolutionCandidates.sort((left, right) => right.confidence - left.confidence),
      sessionFiles,
      artifactCount: sessionArtifacts.length,
      providerBudgetSummary,
      interrupts: interrupts.sort((left, right) => right.createdAt - left.createdAt),
    };
  },
});

function asPlainString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPlainNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSessionStatus(
  value: unknown,
): "queued" | "streaming" | "complete" | "error" {
  return value === "queued" ||
    value === "streaming" ||
    value === "complete" ||
    value === "error"
    ? value
    : "complete";
}

function normalizeRunVerdictValue(
  value: unknown,
  fallback: "verified" | "provisionally_verified" | "needs_review" | "failed" | null,
) {
  return value === "verified" ||
    value === "provisionally_verified" ||
    value === "needs_review" ||
    value === "failed"
    ? value
    : fallback;
}

function normalizeResolutionStateValue(
  value: unknown,
): "exact" | "probable" | "ambiguous" | "unresolved" | null {
  return value === "exact" ||
    value === "probable" ||
    value === "ambiguous" ||
    value === "unresolved"
    ? value
    : null;
}

function normalizeArtifactStateValue(
  value: unknown,
): "none" | "draft" | "saved" | "published" | null {
  return value === "none" ||
    value === "draft" ||
    value === "saved" ||
    value === "published"
    ? value
    : null;
}

function normalizeSaveEligibilityValue(
  value: unknown,
): "blocked" | "draft_only" | "save_ready" | "publish_ready" | null {
  return value === "blocked" ||
    value === "draft_only" ||
    value === "save_ready" ||
    value === "publish_ready"
    ? value
    : null;
}

function normalizeGateResultsValue(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const gateKey = asPlainString(record.gateKey);
      if (!gateKey) return null;
      const label = asPlainString(record.label);
      return {
        gateKey,
        passed: Boolean(record.passed),
        ...(label ? { label } : {}),
      };
    })
    .filter(
      (
        entry,
      ): entry is { gateKey: string; passed: boolean; label?: string } => entry !== null,
    );
  return normalized.length > 0 ? normalized : null;
}

export const listSessions = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
      const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
      // Convex q.eq(q.field(...), undefined) crashes on optional fields.
      // Take extra + filter in JS for soft-deleted rows.
      const rawSessions = await ctx.db
        .query("productChatSessions")
        .withIndex("by_owner_updated", (q) => q.eq("ownerKey", identity.ownerKey))
        .order("desc")
        .take(limit + 10);
      const sessions = rawSessions.filter((s) => !s.deletedAt).slice(0, limit);

      const hydratedSessions = await Promise.all(
        sessions.map(async (session) => {
          try {
            const reportId = resolveSessionReportId(session);
            const [report, events, files, artifacts] = await Promise.all([
              safeGetSessionReport(ctx, reportId),
              ctx.db
                .query("productChatEvents")
                .withIndex("by_session_created", (q) => q.eq("sessionId", session._id))
                .order("desc")
                .take(6),
              ctx.db
                .query("productEvidenceItems")
                .withIndex("by_owner_session", (q) => q.eq("ownerKey", identity.ownerKey).eq("sessionId", session._id))
                .collect(),
              ctx.db
                .query("sessionArtifacts")
                .withIndex("by_session", (q) => q.eq("sessionId", String(session._id)))
                .collect(),
            ]);

            const lastConversationEvent =
              events.find((event) => event.type === "message" && event.payload?.role === "assistant") ??
              events.find((event) => event.type === "message") ??
              events.find((event) => event.type === "error") ??
              null;
            const status = normalizeSessionStatus(session.status);
            const createdAt = asPlainNumber(session.createdAt, Date.now());
            const updatedAt = asPlainNumber(session.updatedAt, createdAt);
            const query = asPlainString(session.query) ?? asPlainString(session.title) ?? "Untitled thread";
            const title = asPlainString(session.title) ?? query;
            const latestSummary = asPlainString(session.latestSummary);
            const reportSummary = asPlainString(report?.summary);
            const reportArtifactState =
              normalizeArtifactStateValue(report?.artifactState) ??
              (report?.status === "saved" ? "saved" : report ? "draft" : null);
            const reportSaveEligibility =
              normalizeSaveEligibilityValue(report?.saveEligibility) ??
              (report?.status === "saved" ? "save_ready" : report ? "draft_only" : null);
            const lastMessage =
              asPlainString(lastConversationEvent?.body) ??
              latestSummary ??
              reportSummary ??
              query;
            const lastMessageAt = asPlainNumber(lastConversationEvent?.createdAt, updatedAt);

            return {
              _id: String(session._id),
              _creationTime: createdAt,
              title,
              query,
              status,
              verdict: normalizeRunVerdictValue(
                session.verdict,
                status === "error" ? "failed" : null,
              ),
              gateResults: normalizeGateResultsValue(session.gateResults),
              costUsd:
                typeof session.costUsd === "number" && Number.isFinite(session.costUsd)
                  ? session.costUsd
                  : 0,
              needsAttention:
                typeof session.needsAttention === "boolean"
                  ? session.needsAttention
                  : status === "error",
              latestSummary,
              lastMessage,
              lastMessageAt,
              reportId: report?._id ? String(report._id) : null,
              entitySlug: asPlainString(report?.entitySlug),
              pinned: report?.pinned ?? false,
              fileCount: files.length,
              artifactCount: artifacts.length,
              resolutionState: normalizeResolutionStateValue(session.resolutionState),
              artifactState:
                normalizeArtifactStateValue(session.artifactState) ??
                reportArtifactState,
              saveEligibility:
                normalizeSaveEligibilityValue(session.saveEligibility) ??
                reportSaveEligibility,
              updatedAt,
              createdAt,
            };
          } catch (error) {
            console.error("[product.chat:listSessions] failed to hydrate session", String(session._id), error);
            return null;
          }
        }),
      );

      return hydratedSessions.filter((session) => session !== null);
    } catch (error) {
      console.error("[product.chat:listSessions] failed", error);
      return [];
    }
  },
});

export const getSessionMessages = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.id("productChatSessions"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.ownerKey !== identity.ownerKey) {
      return [];
    }

    const reportId = resolveSessionReportId(session);

    const [events, report] = await Promise.all([
      ctx.db
        .query("productChatEvents")
        .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      safeGetSessionReport(ctx, reportId),
    ]);

    const normalized = events.map((event) => {
      const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : null;
      const explicitRole = payload && typeof payload.role === "string" ? payload.role : null;
      const role =
        explicitRole === "assistant" || explicitRole === "system" || explicitRole === "user"
          ? explicitRole
          : event.type === "system" || event.type === "error" || event.type === "milestone"
            ? "system"
            : event.label === "Assistant answer"
              ? "assistant"
              : "user";
      return {
        id: String(event._id),
        role,
        label: event.label,
        content: event.body,
        createdAt: event.createdAt,
        status: event.type === "error" ? "error" : "complete",
        reportId: payload && typeof payload.reportId === "string" ? payload.reportId : null,
      };
    });

    const hasAssistantMessage = normalized.some((event) => event.role === "assistant");
    if (!hasAssistantMessage && report?.summary?.trim()) {
      normalized.push({
        id: `synthetic:${String(args.sessionId)}`,
        role: "assistant",
        label: "Assistant answer",
        content: report.summary.trim(),
        createdAt: report.updatedAt,
        status: "complete",
        reportId: String(report._id),
      });
    }

    return normalized.sort((left, right) => left.createdAt - right.createdAt);
  },
});
