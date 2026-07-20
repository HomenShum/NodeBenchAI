/**
 * diligenceProjectionWriter — the orchestrator-facing write path for
 * structured diligence projections.
 *
 * Pattern: scratchpad-first → structure → deterministic merge → overlay.
 *          This module is the "merge" step's single entry point. Any
 *          orchestrator pass that emits a structured projection for a block
 *          calls emitDiligenceProjection(...). The function then routes
 *          through Convex's internal upsertFromStructuringPass mutation.
 *
 * Prior art:
 *   - Anthropic "Building Effective Agents" — orchestrator-workers with merge
 *   - Manus AI — structured output derived from virtual workspace
 *   - Cognition Devin — structured notes extracted from raw markdown
 *
 * See: .claude/rules/scratchpad_first.md
 *      .claude/rules/orchestrator_workers.md
 *      .claude/rules/agentic_reliability.md  (HONEST_STATUS, DETERMINISTIC)
 *      convex/domains/product/diligenceProjections.ts
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *
 * Invariants enforced by the helper:
 *   - Block type must be one of the 10 canonical diligence blocks (or "projection")
 *   - Entity slug + scratchpadRunId + blockType are the dedupe key
 *   - Version must be monotonic: the caller is responsible for passing a
 *     higher version on each structuring pass. DETERMINISTIC guidance:
 *     use the structuring pass's wall-clock start time, or a monotonic
 *     counter on the orchestrator run.
 *   - HONEST_STATUS: the helper returns the raw status from the mutation
 *     so the caller (orchestrator) can decide what to do with "stale".
 */

export type BlockType =
  | "projection"
  | "founder"
  | "product"
  | "funding"
  | "news"
  | "hiring"
  | "patent"
  | "publicOpinion"
  | "competitor"
  | "regulatory"
  | "financial";

export type OverallTier =
  | "verified"
  | "corroborated"
  | "single-source"
  | "unverified";

export type EmitProjectionArgs = {
  entitySlug: string;
  blockType: BlockType;
  scratchpadRunId: string;
  version: number;
  overallTier: OverallTier;
  headerText: string;
  bodyProse?: string;
  /** Optional block-specific candidate payload — e.g. FounderCandidate[] */
  payload?: unknown;
  sourceSectionId?: string;
};

export type EmitProjectionResult =
  | { status: "created"; entitySlug: string; blockType: BlockType; version: number }
  | { status: "updated"; entitySlug: string; blockType: BlockType; version: number }
  | { status: "stale"; entitySlug: string; blockType: BlockType; currentVersion: number };

/**
 * Convex mutation caller — parameterized so the helper stays testable.
 *
 * The real orchestrator runs inside a trusted Convex action and supplies the
 * internal mutation callable. External Node workers must enter through an
 * authenticated owner-scoped route rather than calling this producer directly.
 * In unit tests we supply a spy.
 */
export type UpsertProjectionMutation = (args: {
  entitySlug: string;
  blockType: BlockType;
  scratchpadRunId: string;
  version: number;
  overallTier: OverallTier;
  headerText: string;
  bodyProse?: string;
  payload?: unknown;
  sourceSectionId?: string;
}) => Promise<{ status: "created" } | { status: "updated" } | { status: "stale"; currentVersion: number }>;

const VALID_BLOCK_TYPES = new Set<BlockType>([
  "projection",
  "founder",
  "product",
  "funding",
  "news",
  "hiring",
  "patent",
  "publicOpinion",
  "competitor",
  "regulatory",
  "financial",
]);

const VALID_TIERS = new Set<OverallTier>([
  "verified",
  "corroborated",
  "single-source",
  "unverified",
]);

/**
 * Validate an EmitProjectionArgs payload against the schema constraints.
 * Throws a descriptive Error on any violation.
 *
 * Called implicitly by emitDiligenceProjection so orchestrator bugs fail
 * loudly instead of producing malformed rows. Exported for unit tests.
 */
export function validateEmitArgs(args: EmitProjectionArgs): void {
  if (!args.entitySlug || args.entitySlug.trim().length === 0) {
    throw new Error("emitDiligenceProjection: entitySlug is required");
  }
  if (!VALID_BLOCK_TYPES.has(args.blockType)) {
    throw new Error(
      `emitDiligenceProjection: invalid blockType "${args.blockType}"`,
    );
  }
  if (!args.scratchpadRunId || args.scratchpadRunId.trim().length === 0) {
    throw new Error("emitDiligenceProjection: scratchpadRunId is required");
  }
  if (typeof args.version !== "number" || Number.isNaN(args.version) || args.version < 0) {
    throw new Error(
      `emitDiligenceProjection: version must be a non-negative number (got ${String(args.version)})`,
    );
  }
  if (!VALID_TIERS.has(args.overallTier)) {
    throw new Error(
      `emitDiligenceProjection: invalid overallTier "${args.overallTier}"`,
    );
  }
  if (!args.headerText || args.headerText.trim().length === 0) {
    throw new Error("emitDiligenceProjection: headerText is required");
  }
}

/**
 * Emit one projection via the Convex upsert mutation.
 *
 * Usage from the orchestrator:
 *
 *   const result = await emitDiligenceProjection(
 *     ctx.runMutation(internal.domains.product.diligenceProjections.upsertFromStructuringPass),
 *     {
 *       entitySlug: "acme-ai",
 *       blockType: "founder",
 *       scratchpadRunId: run.id,
 *       version: run.structuringPassStartedAt,
 *       overallTier: "verified",
 *       headerText: "Founders",
 *       bodyProse: structured.prose,
 *       payload: structured.candidates,
 *     },
 *   );
 *
 *   if (result.status === "stale") {
 *     // Another later run already wrote this block; discard this projection
 *   }
 */
export async function emitDiligenceProjection(
  mutation: UpsertProjectionMutation,
  args: EmitProjectionArgs,
): Promise<EmitProjectionResult> {
  validateEmitArgs(args);

  const raw = await mutation({
    entitySlug: args.entitySlug,
    blockType: args.blockType,
    scratchpadRunId: args.scratchpadRunId,
    version: args.version,
    overallTier: args.overallTier,
    headerText: args.headerText,
    bodyProse: args.bodyProse,
    payload: args.payload,
    sourceSectionId: args.sourceSectionId,
  });

  if (raw.status === "stale") {
    return {
      status: "stale",
      entitySlug: args.entitySlug,
      blockType: args.blockType,
      currentVersion: raw.currentVersion,
    };
  }
  return {
    status: raw.status,
    entitySlug: args.entitySlug,
    blockType: args.blockType,
    version: args.version,
  };
}

/**
 * Emit many projections in parallel. Returns per-projection results so the
 * caller can triage stale/created/updated individually without losing rows
 * if one call fails.
 *
 * Settled results: each entry is either { ok: true, result } or
 * { ok: false, error, args } so one failure doesn't short-circuit the batch
 * (reexamine_resilience — partial failures don't discard the successes).
 */
export type EmitBatchOutcome =
  | { ok: true; result: EmitProjectionResult }
  | { ok: false; error: Error; args: EmitProjectionArgs };

export async function emitDiligenceProjectionBatch(
  mutation: UpsertProjectionMutation,
  batch: readonly EmitProjectionArgs[],
): Promise<ReadonlyArray<EmitBatchOutcome>> {
  return Promise.all(
    batch.map(async (args): Promise<EmitBatchOutcome> => {
      try {
        const result = await emitDiligenceProjection(mutation, args);
        return { ok: true, result };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          args,
        };
      }
    }),
  );
}

/* --------------------------------------------------------------------------
 * Instrumented write path — wraps emitDiligenceProjection with telemetry
 * capture and an optional judge hook. Used by the orchestrator runtime so
 * every real projection emission produces a RunTelemetry row that can be
 * judged deterministically (server/pipeline/diligenceJudge.ts) and
 * persisted to Convex (convex/domains/product/diligenceRunTelemetry.ts).
 *
 * Kept as a separate function (not a default wrapper) so existing callers
 * that don't care about telemetry keep their terse signature + test shape.
 * ------------------------------------------------------------------------ */

/** Shape kept in sync with server/pipeline/diligenceJudge.ts RunTelemetry. */
export type InstrumentedRunTelemetry = {
  startedAt: number;
  endedAt: number;
  toolCalls?: number;
  tokensIn?: number;
  tokensOut?: number;
  sourceCount?: number;
  errorMessage?: string;
};

export type InstrumentOptions = {
  /** Wall-clock source — injected so tests can use a fake clock. Defaults to Date.now. */
  now?: () => number;
  /**
   * Optional pre-populated telemetry fields (e.g., tokensIn/Out, toolCalls,
   * sourceCount) the caller already knows from the structuring pass. The
   * writer fills in startedAt/endedAt and errorMessage on top of this.
   */
  seedTelemetry?: Omit<InstrumentedRunTelemetry, "startedAt" | "endedAt" | "errorMessage">;
  /**
   * Called with the final telemetry once the emit settles (success OR
   * failure). Intended for fire-and-forget persistence to Convex. Any error
   * thrown here is swallowed — telemetry must never break the write path.
   */
  onTelemetry?: (telemetry: InstrumentedRunTelemetry, args: EmitProjectionArgs) => void | Promise<void>;
};

export type InstrumentedEmitOutcome =
  | { ok: true; result: EmitProjectionResult; telemetry: InstrumentedRunTelemetry }
  | { ok: false; error: Error; args: EmitProjectionArgs; telemetry: InstrumentedRunTelemetry };

/**
 * Emit one projection AND capture telemetry around the mutation call.
 * Always returns an outcome envelope — never throws — so the orchestrator
 * can triage judge verdicts without a surrounding try/catch.
 */
export async function emitDiligenceProjectionInstrumented(
  mutation: UpsertProjectionMutation,
  args: EmitProjectionArgs,
  options: InstrumentOptions = {},
): Promise<InstrumentedEmitOutcome> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  try {
    const result = await emitDiligenceProjection(mutation, args);
    const telemetry: InstrumentedRunTelemetry = {
      ...(options.seedTelemetry ?? {}),
      startedAt,
      endedAt: now(),
    };
    // Fire-and-forget: telemetry persistence must never break the write path.
    if (options.onTelemetry) {
      try {
        await options.onTelemetry(telemetry, args);
      } catch {
        /* swallow — telemetry failures are P2, not P0 */
      }
    }
    return { ok: true, result, telemetry };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const telemetry: InstrumentedRunTelemetry = {
      ...(options.seedTelemetry ?? {}),
      startedAt,
      endedAt: now(),
      errorMessage: error.message,
    };
    if (options.onTelemetry) {
      try {
        await options.onTelemetry(telemetry, args);
      } catch {
        /* swallow */
      }
    }
    return { ok: false, error, args, telemetry };
  }
}

/** Batch version of the instrumented emitter. Settled — one failure does not discard the rest. */
export async function emitDiligenceProjectionBatchInstrumented(
  mutation: UpsertProjectionMutation,
  batch: readonly EmitProjectionArgs[],
  options: InstrumentOptions = {},
): Promise<ReadonlyArray<InstrumentedEmitOutcome>> {
  return Promise.all(batch.map((args) => emitDiligenceProjectionInstrumented(mutation, args, options)));
}
