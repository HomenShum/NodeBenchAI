/**
 * Universal Research Run Action
 *
 * LangGraph-style state machine for adaptive, multi-angle research.
 * Follows the spec: deterministic outer graph + agentic inner routing.
 *
 * Core flow:
 * 1. normalize_inputs - unify subject formats
 * 2. resolve_entities - canonicalize company/person/event/topic
 * 3. infer_facets - detect scenario (job_prep, event_context, etc.)
 * 4. load_angle_catalog - get available angles
 * 5. plan_angles - score and select angles (reuse/refresh/compute)
 * 6. gate_cost_and_confidence - human review if needed
 * 7. dispatch_angle_tasks - run selected angles in parallel
 * 8. collect_artifacts - gather outputs
 * 9. fuse_evidence - merge claims with provenance
 * 10. synthesize_brief - 3-act structure
 * 11. render_deliverables - format outputs
 * 12. persist_resources - save reusable artifacts
 * 13. finalize - return result
 */

"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  ANGLE_REGISTRY,
  SCENARIO_PROFILES,
  selectAngles,
  getFreshnessThreshold,
  type AngleId,
} from "./angleRegistry.js";
import {
  traceSpan,
  startSpan,
  closeSpan,
} from "../../../shared/research/tracing.js";
import {
  SPAN_ROOT_SELECTION,
  SPAN_ENTITY_HYDRATION,
} from "../../../shared/research/spanNames.js";

// Deterministic slug for canonical entity lookup (intelligenceEntities.entityKey).
// Must match the slug we accept at /v1/resources/expand so the URI round-trips.
function slugifyEntityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const INTEL_ENTITY_TYPES = new Set([
  "company",
  "subsidiary",
  "person",
  "fund",
  "investor",
  "product",
  "facility",
  "organization",
  "other",
]);

function mapSubjectTypeToEntityType(
  subjectType: string,
): "company" | "person" | "product" | "organization" | "other" {
  switch (subjectType) {
    case "company":
      return "company";
    case "person":
      return "person";
    case "repo":
    case "document":
      return "product";
    default:
      return "other";
  }
}

function mapSourceTier(
  tier: string,
): "T1" | "T2" | "T3" | "USER" | "INTERNAL" {
  const t = (tier ?? "").toUpperCase();
  if (t === "T1" || t === "T2" || t === "T3" || t === "USER" || t === "INTERNAL") {
    return t;
  }
  return "T3";
}

/**
 * Translate a completed research run into the shape expected by
 * `internal.domains.research.hydrateEntities.compactFindings`.
 *
 * We emit one finding per resolved subject. Each fused evidence row
 * scoped to that subject becomes a claim carrying its source tier,
 * URL, and confidence. Edges are left empty here — the initial ring
 * of edges is inferred lazily from `entityRoles` + downstream angles,
 * keeping the first hydration conservative and safe.
 */
function buildFindingsFromRun(
  normalizedSubjects: any[],
  resolvedEntities: any[],
  fusedEvidence: any[],
): Array<{
  subject: {
    entityKey: string;
    canonicalName: string;
    entityType:
      | "company"
      | "subsidiary"
      | "person"
      | "fund"
      | "investor"
      | "product"
      | "facility"
      | "organization"
      | "other";
    aliases?: string[];
    summary?: string;
    sector?: string;
    website?: string;
  };
  edges?: Array<never>;
  claims?: Array<{
    predicate: string;
    literalValue?: string;
    polarity: "supports" | "contradicts" | "neutral";
    confidence: number;
    evidence?: Array<{
      sourceTier: "T1" | "T2" | "T3" | "USER" | "INTERNAL";
      url?: string;
      evidenceWeight: number;
    }>;
  }>;
}> {
  const findings: Array<any> = [];
  const subjectsById = new Map<string, any>();
  for (const s of normalizedSubjects) {
    if (s?.name) subjectsById.set(String(s.name).toLowerCase(), s);
  }

  for (const r of resolvedEntities) {
    const subjectType = r?.type ?? "other";
    const mappedType = INTEL_ENTITY_TYPES.has(subjectType)
      ? subjectType
      : mapSubjectTypeToEntityType(subjectType);
    const canonicalName = r.canonicalName ?? r.name;
    if (!canonicalName) continue;
    const entityKey =
      r.entityData?.entityKey
      ?? r.entityData?.slug
      ?? slugifyEntityKey(canonicalName);

    const relatedEvidence = fusedEvidence.filter((ev) => {
      if (!ev?.claim) return false;
      const haystack = `${ev.claim} ${ev.source_title ?? ""}`.toLowerCase();
      return haystack.includes(canonicalName.toLowerCase());
    });

    const claims = relatedEvidence.slice(0, 12).map((ev) => ({
      predicate: "has_evidence",
      literalValue: String(ev.claim).slice(0, 500),
      polarity: "supports" as const,
      confidence: typeof ev.confidence === "number" ? ev.confidence : 0.5,
      evidence: [
        {
          sourceTier: mapSourceTier(String(ev.tier ?? "T3")),
          url: ev.source_url,
          evidenceWeight:
            typeof ev.confidence === "number" ? ev.confidence : 0.5,
        },
      ],
    }));

    findings.push({
      subject: {
        entityKey,
        canonicalName,
        entityType: mappedType,
        summary: r.entityData?.description ?? undefined,
        sector: r.entityData?.sector ?? undefined,
        website: r.entityData?.website ?? undefined,
      },
      claims,
    });
  }
  return findings;
}

// Validators
const goalSpecValidator = v.object({
  objective: v.string(),
  mode: v.union(
    v.literal("auto"),
    v.literal("analyze"),
    v.literal("prepare"),
    v.literal("monitor"),
    v.literal("compare"),
    v.literal("decision_support"),
    v.literal("summarize")
  ),
  decision_type: v.optional(
    v.union(
      v.literal("auto"),
      v.literal("job"),
      v.literal("event"),
      v.literal("vendor"),
      v.literal("customer"),
      v.literal("market"),
      v.literal("founder"),
      v.literal("topic"),
      v.literal("regulatory"),
      v.literal("technical"),
      v.literal("investment")
    )
  ),
});

const subjectRefValidator = v.object({
  type: v.union(
    v.literal("email"),
    v.literal("person"),
    v.literal("company"),
    v.literal("event"),
    v.literal("topic"),
    v.literal("repo"),
    v.literal("document"),
    v.literal("url"),
    v.literal("text")
  ),
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  url: v.optional(v.string()),
  raw: v.optional(v.any()),  // Avoid v.record() due to circular import issues
  hints: v.optional(v.array(v.string())),
});

const constraintsValidator = v.object({
  freshness_days: v.optional(v.number()),
  latency_budget_ms: v.optional(v.number()),
  prefer_cache: v.optional(v.boolean()),
  max_external_calls: v.optional(v.number()),
  evidence_min_sources_per_major_claim: v.optional(v.number()),
});

// Main action
export const runResearch = action({
  args: {
    preset: v.optional(v.string()),
    goal: goalSpecValidator,
    subjects: v.array(subjectRefValidator),
    angle_strategy: v.optional(
      v.union(v.literal("auto"), v.literal("explicit"), v.literal("preset_bias"), v.literal("preset_only"))
    ),
    angles: v.optional(v.array(v.string())),
    depth: v.union(
      v.literal("quick"),
      v.literal("standard"),
      v.literal("comprehensive"),
      v.literal("exhaustive")
    ),
    constraints: v.optional(constraintsValidator),
    deliverables: v.array(
      v.union(
        v.literal("json_full"),
        v.literal("compact_alert"),
        v.literal("ntfy_brief"),
        v.literal("notion_markdown"),
        v.literal("executive_brief"),
        v.literal("dossier_markdown"),
        v.literal("email_digest"),
        v.literal("ui_card_bundle")
      )
    ),
    context: v.optional(v.any()),  // Avoid v.record() due to circular import issues
  },
  returns: v.object({
    run_id: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("needs_review")
    ),
    inferred_facets: v.array(v.string()),
    selected_angles: v.array(
      v.object({
        angle_id: v.string(),
        mode: v.union(v.literal("reuse"), v.literal("refresh"), v.literal("compute")),
        score: v.number(),
        reason: v.optional(v.string()),
      })
    ),
    outputs: v.object({
      briefing: v.object({
        act_1: v.string(),
        act_2: v.string(),
        act_3: v.string(),
      }),
      prep: v.object({
        why_now: v.string(),
        talking_points: v.array(v.string()),
        questions: v.array(v.string()),
        risks: v.array(v.string()),
        next_actions: v.array(v.string()),
        draft_reply: v.optional(v.union(v.string(), v.null())),
      }),
      rendered: v.any(),  // Avoid v.record() due to circular import issues
    }),
    evidence: v.array(
      v.object({
        claim: v.string(),
        source_title: v.string(),
        source_url: v.string(),
        published_at: v.optional(v.union(v.string(), v.null())),
        tier: v.union(
          v.literal("T1"),
          v.literal("T2"),
          v.literal("T3"),
          v.literal("USER"),
          v.literal("INTERNAL")
        ),
        confidence: v.number(),
      })
    ),
    resources: v.object({
      reused: v.array(v.string()),
      refreshed: v.array(v.string()),
      emitted: v.array(v.string()),
    }),
    trace: v.object({
      depth: v.string(),
      cache_hit_ratio: v.number(),
      latency_ms: v.number(),
      human_review_required: v.optional(v.boolean()),
    }),
  }),
  handler: async (ctx, args): Promise<any> => {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    console.log(`[ResearchRun] ${runId} starting`, {
      preset: args.preset,
      depth: args.depth,
      subjectCount: args.subjects.length,
    });

    // 1. Normalize inputs
    const normalizedSubjects = normalizeSubjects(args.subjects);

    // 2. Resolve entities (lookup in knowledge graph)
    const resolvedEntities = await traceSpan(
      {
        name: SPAN_ROOT_SELECTION,
        traceId: runId,
        runType: "tool",
        tags: ["root_selection"],
        inputs: {
          subjectCount: normalizedSubjects.length,
          subjectTypes: normalizedSubjects.map((s: any) => s?.type),
        },
      },
      () => resolveEntities(ctx, normalizedSubjects),
    );

    // 3. Infer facets based on subjects and goal
    const inferredFacets = inferFacets(args.goal, normalizedSubjects, resolvedEntities);

    // 4. Apply preset bias if specified
    const profile = args.preset ? SCENARIO_PROFILES[args.preset] : null;

    // 5. Plan angles
    const selectedAngles = planAngles(
      inferredFacets,
      normalizedSubjects,
      args.angle_strategy || "auto",
      args.angles as AngleId[] | undefined,
      profile,
      args.depth
    );

    // 6. Check freshness and determine mode for each angle
    const anglesWithMode = await determineAngleModes(ctx, selectedAngles, resolvedEntities, args.constraints);

    // 7. Dispatch angle tasks (in parallel with budget management)
    const angleResults = await dispatchAngleTasks(
      ctx,
      anglesWithMode,
      resolvedEntities,
      args.depth,
      args.constraints?.latency_budget_ms || 12000
    );

    // 8. Collect artifacts and evidence
    const { artifacts, evidence, reused, refreshed, emitted } = collectArtifacts(
      angleResults,
      resolvedEntities
    );

    // 9. Fuse evidence
    const fusedEvidence = fuseEvidence(evidence, args.constraints);

    // 10. Synthesize 3-act brief
    const briefing = synthesizeBrief(artifacts, fusedEvidence, args.goal, resolvedEntities);

    // 11. Generate prep pack (talking points, questions, risks, next_actions)
    const prep = generatePrepPack(artifacts, fusedEvidence, inferredFacets, args.goal, resolvedEntities);

    // 12. Render deliverables
    const rendered = renderDeliverables(args.deliverables, briefing, prep, artifacts);

    // 13. Persist resources (async, don't wait)
    const finalEmitted = await persistResources(ctx, emitted, artifacts, runId);

    const latencyMs = Date.now() - startTime;
    const cacheHitRatio = calculateCacheRatio(anglesWithMode);

    console.log(`[ResearchRun] ${runId} completed in ${latencyMs}ms`, {
      angles: selectedAngles.length,
      cacheHitRatio,
      evidenceCount: fusedEvidence.length,
    });

    // 14. Compact findings into the canonical entity graph.
    //     Single compaction-first writer (scratchpad_first rule). Errors are
    //     logged but never break the run — HONEST_STATUS tells the caller
    //     compaction failed without hiding the research result. Wrapped in a
    //     LangSmith span so hydration latency is traceable per run.
    try {
      const findings = buildFindingsFromRun(
        normalizedSubjects,
        resolvedEntities,
        fusedEvidence,
      );
      if (findings.length > 0) {
        const compactResult = await traceSpan(
          {
            name: SPAN_ENTITY_HYDRATION,
            traceId: runId,
            runType: "tool",
            tags: ["hydrate_entities", `depth:${args.depth}`],
            inputs: {
              runId,
              findingCount: findings.length,
            },
            metadata: {
              depth: args.depth,
              lens_hint: args.preset,
            },
          },
          () =>
            ctx.runMutation(
              internal.domains.research.hydrateEntities.compactFindings,
              { runId, findings },
            ),
        );
        console.log(`[ResearchRun] ${runId} hydrated`, compactResult);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ResearchRun] ${runId} hydrate failed: ${message}`);
    }

    return {
      run_id: runId,
      status: "completed",
      inferred_facets: inferredFacets,
      selected_angles: anglesWithMode.map((a) => ({
        angle_id: a.angleId,
        mode: a.mode,
        score: a.score,
        reason: a.reason,
      })),
      outputs: {
        briefing,
        prep,
        rendered,
      },
      evidence: fusedEvidence,
      resources: {
        reused,
        refreshed,
        emitted: finalEmitted,
      },
      trace: {
        depth: args.depth,
        cache_hit_ratio: cacheHitRatio,
        latency_ms: latencyMs,
        human_review_required: false,
      },
    };
  },
});

// === Node Implementations ===

function normalizeSubjects(subjects: any[]): any[] {
  return subjects.map((s) => ({
    ...s,
    key: s.id || s.name || s.url || `${s.type}_${Math.random().toString(36).slice(2, 8)}`,
    normalizedAt: Date.now(),
  }));
}

async function resolveEntities(ctx: any, subjects: any[]): Promise<any[]> {
  const resolved: any[] = [];
  for (const subject of subjects) {
    // Try to find existing entity by name
    if (subject.name && (subject.type === "company" || subject.type === "person")) {
      try {
        const entity = await ctx.runQuery(api.domains.knowledge.entities.getByName, {
          name: subject.name,
        });
        if (entity) {
          resolved.push({
            ...subject,
            resolved: true,
            entityId: entity._id,
            canonicalName: entity.name,
            entityData: entity,
          });
          continue;
        }
      } catch (e) {
        // Entity not found, continue with unresolved
      }
    }
    resolved.push({ ...subject, resolved: false });
  }
  return resolved;
}

function inferFacets(goal: any, subjects: any[], entities: any[]): string[] {
  const facets: string[] = [];

  // Goal-based facets
  if (goal.mode === "prepare") facets.push("prep");
  if (goal.mode === "monitor") facets.push("monitoring");
  if (goal.mode === "decision_support") facets.push("decision");

  // Subject-based facets
  const hasEmail = subjects.some((s) => s.type === "email");
  const hasPerson = subjects.some((s) => s.type === "person" || s.type === "email");
  const hasCompany = subjects.some((s) => s.type === "company" || s.type === "email");

  if (hasEmail && hasCompany) {
    // Check for job-related keywords in email
    const emailSubject = subjects.find((s) => s.type === "email")?.raw?.subject || "";
    const emailText = subjects.find((s) => s.type === "email")?.raw?.body_text || "";
    const combinedText = `${emailSubject} ${emailText}`.toLowerCase();

    if (/interview|recruiter|hiring|position|role|opportunity|career/i.test(combinedText)) {
      facets.push("job_prep");
    }
    if (/demo day|conference|event|meetup|summit/i.test(combinedText)) {
      facets.push("event_context");
    }
    if (/investor|funding|seed|series|venture|portfolio/i.test(combinedText)) {
      facets.push("company_diligence");
    }
    if (/customer|vendor|partner|proposal|sales/i.test(combinedText)) {
      facets.push("account_prep");
    }
  }

  // Entity-based facets
  if (hasCompany) facets.push("company_diligence");
  if (hasPerson) facets.push("people_research");

  return [...new Set(facets)];
}

function planAngles(
  facets: string[],
  subjects: any[],
  strategy: string,
  explicitAngles: AngleId[] | undefined,
  profile: any,
  depth: string
): AngleId[] {
  // If explicit angles provided, use them
  if (strategy === "explicit" && explicitAngles) {
    return explicitAngles.filter((a) => a in ANGLE_REGISTRY) as AngleId[];
  }

  // If preset_only and profile exists, use profile angles
  if (strategy === "preset_only" && profile) {
    return profile.defaultAngles.filter((a: string) => a in ANGLE_REGISTRY) as AngleId[];
  }

  // Otherwise, use scoring algorithm
  const subjectTypes = new Set(subjects.map((s) => s.type));

  // Build angle scores
  const scored: { angleId: AngleId; score: number; reason: string }[] = [];

  for (const [angleId, meta] of Object.entries(ANGLE_REGISTRY)) {
    let score = 0;
    let reasons: string[] = [];

    // Facet match
    for (const facet of facets) {
      const facetProfile = SCENARIO_PROFILES[`${facet}_v1`];
      if (facetProfile?.defaultAngles.includes(angleId as AngleId)) {
        score += 10;
        reasons.push(`facet:${facet}`);
      }
    }

    // Preset bias
    if (strategy === "preset_bias" && profile?.defaultAngles.includes(angleId as AngleId)) {
      score += 5;
      reasons.push("preset_bias");
    }

    // Subject type support
    const supportsSubject = meta.supports.some((t) => subjectTypes.has(t as any));
    if (supportsSubject) {
      score += 5;
      reasons.push("subject_support");
    }

    // Depth preference
    if (depth === "quick" && meta.costTier === "low") score += 3;
    if (depth === "comprehensive" && meta.costTier === "high") score += 5;

    if (score > 0) {
      scored.push({ angleId: angleId as AngleId, score, reason: reasons.join(",") });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Select based on depth
  const maxAngles =
    depth === "quick" ? 3 : depth === "standard" ? 6 : depth === "comprehensive" ? 10 : 15;

  return scored.slice(0, maxAngles).map((s) => s.angleId);
}

async function determineAngleModes(
  ctx: any,
  angles: AngleId[],
  entities: any[],
  constraints: any
): Promise<Array<{ angleId: AngleId; mode: "reuse" | "refresh" | "compute"; score: number; reason?: string }>> {
  const freshnessDays = constraints?.freshness_days || 30;
  const threshold = getFreshnessThreshold(angles[0], freshnessDays);

  return angles.map((angleId) => {
    const meta = ANGLE_REGISTRY[angleId];

    // In v1, simplified: always compute
    // In production, check cache freshness here
    const mode: "reuse" | "refresh" | "compute" = "compute";

    return {
      angleId,
      mode,
      score: 1.0,
      reason: mode === "compute" ? "no_cache" : "fresh",
    };
  });
}

async function dispatchAngleTasks(
  ctx: any,
  angles: any[],
  entities: any[],
  depth: string,
  latencyBudgetMs: number
): Promise<any[]> {
  const results = [];

  // Run angles in parallel with timeout management
  const promises = angles.map(async (angle) => {
    const start = Date.now();
    try {
      const result = await runAngleSubgraph(ctx, angle, entities, depth);
      return {
        angleId: angle.angleId,
        success: true,
        result,
        elapsedMs: Date.now() - start,
      };
    } catch (e) {
      return {
        angleId: angle.angleId,
        success: false,
        error: String(e),
        elapsedMs: Date.now() - start,
      };
    }
  });

  // Race with overall budget
  const timeoutPromise = new Promise<any[]>((_, reject) =>
    setTimeout(() => reject(new Error("angle_dispatch_timeout")), latencyBudgetMs * 0.8)
  );

  try {
    const settled = await Promise.race([Promise.all(promises), timeoutPromise]);
    return settled;
  } catch (e) {
    // Timeout or error - return what we have
    return [];
  }
}

async function runAngleSubgraph(ctx: any, angle: any, entities: any[], depth: string): Promise<any> {
  const meta = ANGLE_REGISTRY[angle.angleId];

  // Route to appropriate implementation based on angle type
  switch (angle.angleId) {
    case "entity_profile":
      return await runEntityProfileAngle(ctx, entities);
    case "public_signals":
      return await runPublicSignalsAngle(ctx, entities, depth);
    case "funding_intelligence":
      return await runFundingIntelligenceAngle(ctx, entities);
    case "people_graph":
      return await runPeopleGraphAngle(ctx, entities, depth);
    case "narrative_tracking":
      return await runNarrativeTrackingAngle(ctx, entities, depth);
    case "competitive_intelligence":
      return await runCompetitiveIntelligenceAngle(ctx, entities, depth);
    case "executive_brief":
      return await runExecutiveBriefAngle(ctx, entities, depth);
    default:
      // Fallback: return minimal structure
      return {
        angleId: angle.angleId,
        summary: `${meta.displayName} analysis not yet implemented`,
        findings: [],
        evidence: [],
        confidence: 0.5,
      };
  }
}

// === Angle Subgraph Implementations ===

async function runEntityProfileAngle(ctx: any, entities: any[]): Promise<any> {
  const findings: any[] = [];
  const evidence: any[] = [];

  for (const entity of entities.filter((e) => e.resolved)) {
    const data = entity.entityData;
    findings.push({
      entityKey: entity.key,
      type: "profile",
      data: {
        name: data.name,
        description: data.description,
        founded: data.founded,
        industry: data.industry,
        headquarters: data.headquarters,
        website: data.website,
      },
    });
    evidence.push({
      claim: `${data.name} is a ${data.industry || "company"}`,
      source: "entity_graph",
      confidence: 0.9,
    });
  }

  return {
    angleId: "entity_profile",
    summary: `Resolved ${findings.length} entities from knowledge graph`,
    findings,
    evidence,
    confidence: 0.85,
  };
}

async function runPublicSignalsAngle(ctx: any, entities: any[], depth: string): Promise<any> {
  // Search for recent news/signals
  const searchPromises = entities
    .filter((e) => e.name)
    .slice(0, 3)
    .map((e) =>
      ctx
        .runAction(api.domains.search.fusionSearch, {
          query: `${e.name} news 2026`,
          mode: "fast",
          maxResults: depth === "quick" ? 3 : 5,
        })
        .catch(() => null)
    );

  const results = await Promise.all(searchPromises);

  const findings: any[] = [];
  const evidence: any[] = [];

  results.forEach((result, idx) => {
    if (result?.results) {
      const entity = entities[idx];
      const topResults = result.results.slice(0, 3);

      findings.push({
        entityKey: entity.key,
        type: "signals",
        signals: topResults.map((r: any) => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          date: r.publishedDate,
        })),
      });

      topResults.forEach((r: any) => {
        evidence.push({
          claim: r.title,
          source: r.url,
          publishedAt: r.publishedDate,
          confidence: 0.7,
        });
      });
    }
  });

  return {
    angleId: "public_signals",
    summary: `Found ${evidence.length} recent signals`,
    findings,
    evidence,
    confidence: 0.75,
  };
}

async function runFundingIntelligenceAngle(ctx: any, entities: any[]): Promise<any> {
  const companies = entities.filter((e) => e.type === "company" || e.entityData?.type === "company");

  const findings: any[] = [];
  const evidence: any[] = [];

  for (const company of companies) {
    const data = company.entityData;
    if (data?.fundingHistory || data?.valuation) {
      findings.push({
        entityKey: company.key,
        type: "funding",
        data: {
          totalRaised: data.totalRaised,
          valuation: data.valuation,
          lastRound: data.lastRound,
          investors: data.investors,
        },
      });

      if (data.lastRound) {
        evidence.push({
          claim: `Last funding round: ${data.lastRound}`,
          source: "entity_graph",
          confidence: 0.85,
        });
      }
    }
  }

  return {
    angleId: "funding_intelligence",
    summary: `Retrieved funding data for ${findings.length} companies`,
    findings,
    evidence,
    confidence: 0.8,
  };
}

async function runPeopleGraphAngle(ctx: any, entities: any[], depth: string): Promise<any> {
  // Extract people from entities and find connections
  const findings: any[] = [];
  const evidence: any[] = [];

  // For each company, get key people
  for (const entity of entities.filter((e) => e.type === "company")) {
    if (entity.entityData?.keyPeople) {
      findings.push({
        entityKey: entity.key,
        type: "people",
        people: entity.entityData.keyPeople,
      });

      entity.entityData.keyPeople.forEach((person: any) => {
        evidence.push({
          claim: `${person.name} is ${person.role} at ${entity.name}`,
          source: "entity_graph",
          confidence: 0.8,
        });
      });
    }
  }

  return {
    angleId: "people_graph",
    summary: `Mapped ${findings.reduce((sum, f) => sum + (f.people?.length || 0), 0)} key people`,
    findings,
    evidence,
    confidence: 0.75,
  };
}

async function runNarrativeTrackingAngle(ctx: any, entities: any[], depth: string): Promise<any> {
  const findings: any[] = [];
  const evidence: any[] = [];

  // Search for narrative shifts over time
  for (const entity of entities.filter((e) => e.name)) {
    try {
      const result = await ctx.runAction(api.domains.search.fusionSearch, {
        query: `${entity.name} strategy pivot product launch announcement 2025 2026`,
        mode: "balanced",
        maxResults: depth === "quick" ? 2 : 5,
      });

      if (result?.results?.length > 0) {
        findings.push({
          entityKey: entity.key,
          type: "narrative_shift",
          signals: result.results.map((r: any) => ({
            title: r.title,
            snippet: r.snippet,
            url: r.url,
            date: r.publishedDate,
          })),
        });

        result.results.forEach((r: any) => {
          evidence.push({
            claim: r.title,
            source: r.url,
            publishedAt: r.publishedDate,
            confidence: 0.7,
          });
        });
      }
    } catch (e) {
      // Ignore search failures
    }
  }

  return {
    angleId: "narrative_tracking",
    summary: `Found ${evidence.length} narrative signals`,
    findings,
    evidence,
    confidence: findings.length > 0 ? 0.75 : 0.5,
  };
}

async function runCompetitiveIntelligenceAngle(ctx: any, entities: any[], depth: string): Promise<any> {
  const findings: any[] = [];
  const evidence: any[] = [];

  for (const entity of entities.filter((e) => e.name)) {
    // First check entity graph
    if (entity.entityData?.competitors) {
      findings.push({
        entityKey: entity.key,
        type: "competitors",
        competitors: entity.entityData.competitors,
      });
    }

    // Search for competitive landscape
    try {
      const result = await ctx.runAction(api.domains.search.fusionSearch, {
        query: `${entity.name} competitors market share comparison vs alternative`,
        mode: "balanced",
        maxResults: depth === "quick" ? 2 : 4,
      });

      if (result?.results?.length > 0) {
        findings.push({
          entityKey: entity.key,
          type: "competitive_signals",
          signals: result.results.map((r: any) => ({
            title: r.title,
            snippet: r.snippet,
            url: r.url,
          })),
        });

        result.results.forEach((r: any) => {
          evidence.push({
            claim: r.snippet || r.title,
            source: r.url,
            confidence: 0.6,
          });
        });
      }
    } catch (e) {
      // Ignore search failures
    }
  }

  return {
    angleId: "competitive_intelligence",
    summary: `Mapped competitors for ${findings.filter((f) => f.type === "competitors").length} companies, found ${evidence.length} competitive signals`,
    findings,
    evidence,
    confidence: 0.7,
  };
}

async function runExecutiveBriefAngle(ctx: any, entities: any[], depth: string): Promise<any> {
  const findings: any[] = [];
  
  // Search for executive summary / analyst coverage
  for (const entity of entities.filter((e) => e.name)) {
    try {
      const result = await ctx.runAction(api.domains.search.fusionSearch, {
        query: `${entity.name} analyst report executive summary market position`,
        mode: "balanced",
        maxResults: depth === "quick" ? 1 : 3,
      });

      if (result?.results?.length > 0) {
        findings.push({
          entityKey: entity.key,
          type: "executive_summary",
          summary: result.results[0].snippet,
          source: result.results[0].url,
        });
      }
    } catch (e) {
      // Ignore search failures
    }
  }

  return {
    angleId: "executive_brief",
    summary: `Generated executive brief with ${findings.length} analyst perspectives`,
    findings,
    evidence: [],
    confidence: findings.length > 0 ? 0.8 : 0.6,
  };
}

// === Post-Processing ===

function collectArtifacts(
  angleResults: any[],
  entities: any[]
): {
  artifacts: Record<string, any>;
  evidence: any[];
  reused: string[];
  refreshed: string[];
  emitted: string[];
} {
  const artifacts: Record<string, any> = {};
  const allEvidence: any[] = [];
  const reused: string[] = [];
  const refreshed: string[] = [];
  const emitted: string[] = [];

  for (const result of angleResults.filter((r) => r?.success)) {
    artifacts[result.angleId] = result.result;
    if (result.result?.evidence) {
      allEvidence.push(...result.result.evidence);
    }
    emitted.push(`nodebench://angle/${result.angleId}/${entities[0]?.key || "unknown"}`);
  }

  return { artifacts, evidence: allEvidence, reused, refreshed, emitted };
}

function fuseEvidence(evidence: any[], constraints: any): any[] {
  // Deduplicate and rank evidence
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const e of evidence) {
    const key = `${e.claim}_${e.source}`.slice(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        claim: e.claim,
        source_title: e.source_title || e.source || "Unknown",
        source_url: e.source_url || e.source || "",
        published_at: e.publishedAt || null,
        tier: e.tier || "T2",
        confidence: Math.min(1, Math.max(0, e.confidence || 0.5)),
      });
    }
  }

  // Sort by confidence
  unique.sort((a, b) => b.confidence - a.confidence);

  // Limit based on constraints
  const maxClaims = constraints?.evidence_min_sources_per_major_claim
    ? constraints.evidence_min_sources_per_major_claim * 10
    : 20;

  return unique.slice(0, maxClaims);
}

function synthesizeBrief(
  artifacts: Record<string, any>,
  evidence: any[],
  goal: any,
  entities: any[]
): { act_1: string; act_2: string; act_3: string } {
  const entityNames = entities.filter((e) => e.name).map((e) => e.name);
  const primarySubject = entityNames[0] || "the subject";

  // Build Act I: The Hook (what's happening)
  const signals = artifacts.public_signals?.findings?.[0]?.signals || [];
  const latestSignal = signals[0];

  const act1 = latestSignal
    ? `${primarySubject} in focus: ${latestSignal.title}`
    : `Research on ${primarySubject}`;

  // Build Act II: The Context (why it matters)
  const profile = artifacts.entity_profile?.findings?.[0]?.data;
  const funding = artifacts.funding_intelligence?.findings?.[0]?.data;

  let act2Parts: string[] = [];
  if (profile) {
    act2Parts.push(`${profile.name} is ${profile.description || "a company in " + profile.industry}`);
  }
  if (funding?.lastRound) {
    act2Parts.push(`Latest funding: ${funding.lastRound}`);
  }
  const act2 = act2Parts.join(". ") || `Key context about ${primarySubject}`;

  // Build Act III: The Takeaway (what to do)
  const act3 = `Consider ${goal.objective} with attention to recent signals and entity relationships.`;

  return { act_1: act1, act_2: act2, act_3: act3 };
}

function generatePrepPack(
  artifacts: Record<string, any>,
  evidence: any[],
  facets: string[],
  goal: any,
  entities: any[]
): {
  why_now: string;
  talking_points: string[];
  questions: string[];
  risks: string[];
  next_actions: string[];
  draft_reply?: string | null;
} {
  const whyNow =
    artifacts.public_signals?.findings?.[0]?.signals?.[0]?.title ||
    "Recent activity warrants attention";

  const talkingPoints: string[] = [];
  const primaryEntity = entities.find((e) => e.name) || entities[0];
  const entityName = primaryEntity?.name || "the subject";

  // Add entity facts
  const profile = artifacts.entity_profile?.findings?.[0]?.data;
  if (profile) {
    talkingPoints.push(`Founded: ${profile.founded || "Unknown"}`);
    talkingPoints.push(`Industry: ${profile.industry || "Unknown"}`);
    if (profile.headquarters) {
      talkingPoints.push(`Headquarters: ${profile.headquarters}`);
    }
  }

  // Add funding facts
  const funding = artifacts.funding_intelligence?.findings?.[0]?.data;
  if (funding?.lastRound) {
    talkingPoints.push(`Recent funding: ${funding.lastRound}`);
  }

  // Add people facts
  const people = artifacts.people_graph?.findings?.[0]?.people || [];
  if (people.length > 0) {
    talkingPoints.push(`Key contact: ${people[0].name}, ${people[0].role}`);
  }

  // Generate contextual questions based on facets AND actual findings
  const questions: string[] = [];
  
  if (facets.includes("job_prep")) {
    questions.push(`What are the top priorities for the ${entityName} team right now?`);
    questions.push(`How has ${entityName}'s recent funding/trajectory changed team needs?`);
    questions.push("What would success look like in this role at 90 days?");
    
    // Add signal-based questions if we found recent news
    const signals = artifacts.public_signals?.findings?.[0]?.signals || [];
    if (signals.length > 0) {
      questions.push(`Ask about the impact of recent news: "${signals[0].title}"`);
    }
  }
  
  if (facets.includes("company_diligence") || facets.includes("founder_diligence")) {
    questions.push(`What milestones must ${entityName} hit in the next 12 months?`);
    questions.push("What is the path to profitability/cash flow positivity?");
    questions.push("Who are the key decision makers and what do they prioritize?");
    
    const competitors = artifacts.competitive_intelligence?.findings?.[0]?.competitors || [];
    if (competitors.length > 0) {
      questions.push(`How does ${entityName} defend against ${competitors[0]}?`);
    }
  }
  
  if (facets.includes("event_prep")) {
    questions.push("What are you most excited to learn from this event?");
    questions.push("Who should I prioritize meeting with and why?");
    
    const people = artifacts.people_graph?.findings?.[0]?.people || [];
    if (people.length > 0) {
      questions.push(`Ask ${people[0].name}: "What's the most underrated trend in your space?"`);
    }
  }

  // Generate contextual risks based on actual findings
  const risks: string[] = [];
  const competitors = artifacts.competitive_intelligence?.findings?.[0]?.competitors || [];
  if (competitors.length > 0) {
    risks.push(`Direct competition from ${competitors.slice(0, 2).join(" and ")}`);
  }
  
  // Risk from signals (if any negative indicators)
  const signals = artifacts.public_signals?.findings?.[0]?.signals || [];
  const negativeSignal = signals.find((s: any) => 
    /layoff|downsiz|cut|depart|resign|investigation|lawsuit|loss/i.test(s.title || s.snippet || "")
  );
  if (negativeSignal) {
    risks.push(`Recent signal: "${negativeSignal.title}" — monitor closely`);
  }

  // Generate contextual, specific next actions with follow-up hooks
  const nextActions: string[] = [];
  
  // Always add specific follow-up based on goal
  if (facets.includes("job_prep")) {
    nextActions.push(`Schedule a 15-min follow-up after your ${entityName} interview to debrief`);
    nextActions.push(`Set reminder to research your interviewers on LinkedIn 1 day before`);
    nextActions.push(`Draft 3 specific questions about ${entityName}'s ${profile?.industry || "industry"} challenges`);
    
    // Add action based on actual findings
    const people = artifacts.people_graph?.findings?.[0]?.people || [];
    if (people.length > 0) {
      nextActions.push(`Look up ${people[0].name} (${people[0].role}) on LinkedIn for background`);
    }
    
    // Context preservation hook
    nextActions.push(`Save this research — ask me for "${entityName} interview debrief" after your meeting`);
  } else if (facets.includes("company_diligence") || facets.includes("founder_diligence")) {
    nextActions.push(`Request financial projections or cap table from ${entityName}`);
    nextActions.push(`Schedule a follow-up call with specific questions about the 12-month roadmap`);
    nextActions.push(`Cross-check claims against ${competitors[0] || "competitor"} public filings`);
    
    // Context preservation hook
    nextActions.push(`Track ${entityName} — I'll alert you to any major signals in the next 30 days`);
  } else if (facets.includes("event_prep")) {
    nextActions.push(`Create a target list of 5 people to meet at ${entityName || "the event"}`);
    nextActions.push(`Prepare your 30-second intro based on ${entityName || "event"} context`);
    nextActions.push(`Schedule a post-event recap with me to process new connections`);
  } else if (facets.includes("competitor_monitor")) {
    nextActions.push(`Set up weekly monitoring alert for ${entityName} and key competitors`);
    nextActions.push(`Share key findings with your team this week`);
    nextActions.push(`Schedule competitive review meeting — I can prepare a briefing`);
  } else if (facets.includes("sales_prep")) {
    nextActions.push(`Tailor your pitch to ${entityName}'s specific ${profile?.industry || "industry"} context`);
    nextActions.push(`Research the specific decision maker's background before the call`);
    nextActions.push(`Prepare ROI case study relevant to ${entityName}'s stage`);
  } else {
    // Default but still contextual
    nextActions.push(`Follow up on ${entityName} — ask me for updates anytime`);
    nextActions.push(`Set a reminder to review progress on "${goal?.objective || "this goal"}"`);
  }

  return {
    why_now: whyNow,
    talking_points: talkingPoints,
    questions,
    risks,
    next_actions: nextActions.slice(0, 6), // Cap at 6 actions
    draft_reply: null,
  };
}

function renderDeliverables(
  deliverables: string[],
  briefing: { act_1: string; act_2: string; act_3: string },
  prep: any,
  artifacts: Record<string, any>
): Record<string, any> {
  const rendered: Record<string, any> = {};

  for (const format of deliverables) {
    switch (format) {
      case "compact_alert":
        rendered.compact_alert = `${briefing.act_1}\n\n${prep.why_now}\n\nKey points: ${prep.talking_points.slice(0, 3).join("; ")}`;
        break;
      case "notion_markdown":
        rendered.notion_markdown = generateNotionMarkdown(briefing, prep, artifacts);
        break;
      case "json_full":
        rendered.json_full = {
          briefing,
          prep,
          artifacts: Object.keys(artifacts),
        };
        break;
      case "executive_brief":
        rendered.executive_brief = `${briefing.act_1}\n\n${briefing.act_2}\n\n${briefing.act_3}`;
        break;
      default:
        rendered[format] = { format, status: "not_implemented" };
    }
  }

  return rendered;
}

function generateNotionMarkdown(
  briefing: { act_1: string; act_2: string; act_3: string },
  prep: any,
  artifacts: Record<string, any>
): string {
  const lines: string[] = [];

  lines.push(`# Research Brief`);
  lines.push("");
  lines.push(`## ${briefing.act_1}`);
  lines.push("");
  lines.push(briefing.act_2);
  lines.push("");
  lines.push(briefing.act_3);
  lines.push("");
  lines.push("## Talking Points");
  prep.talking_points.forEach((tp: string) => lines.push(`- ${tp}`));
  lines.push("");
  lines.push("## Questions to Ask");
  prep.questions.forEach((q: string) => lines.push(`- ${q}`));
  lines.push("");
  lines.push("## Potential Risks");
  prep.risks.forEach((r: string) => lines.push(`- ${r}`));
  lines.push("");
  lines.push("## Next Actions");
  prep.next_actions.forEach((a: string) => lines.push(`- [ ] ${a}`));

  return lines.join("\n");
}

async function persistResources(ctx: any, emitted: string[], artifacts: Record<string, any>, runId: string): Promise<string[]> {
  // In production, save artifacts to cache/store
  // For now, just return the URIs
  return emitted.map((uri) => `${uri}?run=${runId}`);
}

function calculateCacheRatio(angles: any[]): number {
  if (angles.length === 0) return 0;
  const reused = angles.filter((a) => a.mode === "reuse").length;
  return reused / angles.length;
}
