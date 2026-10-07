/**
 * Artifact Decision Gate
 *
 * Pure function: given a run's signals, returns the allowed artifact state.
 * Enforced at the call site BEFORE any `insert("artifacts"|"reports", ...)` mutation.
 *
 * Hard rule: fast mode defaults to `none|draft`. A silent-save during a demo
 * query ("tell me about Stripe") pollutes the workspace and breaks trust.
 *
 * See: docs/architecture/FAST_SLOW_RUNTIME_SPEC.md §10
 * See: .claude/rules/agent_run_verdict_workflow.md
 */

export type ArtifactState =
  | "none"
  | "none|draft"
  | "draft"
  | "draft_only"
  | "draft|saved"
  | "saved"
  | "saved|published";

export type Mode = "fast" | "slow" | "pulse" | "background";

export type ResolutionExpectation =
  | "exact"
  | "exact_or_probable"
  | "probable"
  | "probable_allowed"
  | "ambiguous"
  | "ambiguous_or_exact"
  | "contextual"
  | "file_first";

export type PrimaryCategory =
  | "entity"
  | "people"
  | "product"
  | "job"
  | "location"
  | "event"
  | "compare"
  | "chat_followup"
  | "ambiguous"
  | "file_grounded"
  | "artifact_reuse"
  | "crm_action"
  | "save_gate"
  | "mobile_on_the_go"
  | "pulse"
  | "pulse_generation"
  | "file_plus_web"
  | "browser_tooling"
  | "background"
  | "coalesced"
  | "contradiction"
  | "prolonged_usage"
  | "multi_category"
  | "crm_export"
  | "share_export"
  | "concurrency"
  | "event_scope"
  | "adversarial_injection"
  | "adversarial_pii"
  | "adversarial_ssrf"
  | "adversarial_exfil"
  | "privacy_isolation"
  | "degraded_network"
  | "degraded_auth"
  | "burst_load"
  | "hallucination_guard"
  | "partial_failure"
  | "idempotency"
  | "rate_limit_honest"
  | "provider_fallback"
  | "schema_drift"
  | "cost_budget"
  | "memory_accumulation"
  | "long_running_mid_revise"
  | "background_voice_handoff"
  | "gdr_interactive"
  | "gdr_background_pulse"
  | "gdr_collaborative_planning"
  | "gdr_visualization"
  | "gdr_remote_mcp"
  | "gdr_file_search"
  | "gdr_stream_resume"
  | "gdr_followup"
  | "gdr_fallback"
  | "gdr_answer_control";

export interface ArtifactDecisionInput {
  mode: Mode;
  primaryCategory: PrimaryCategory;
  resolutionExpectation: ResolutionExpectation;
  citationCount: number;
  retrievalConfidence: "high" | "medium" | "low";
  hallucinationGateFailed: boolean;
  userExplicitlyRequestedSave: boolean;
  userScopedToEvent: boolean;
  hasUnsupportedClaim: boolean;
}

export interface ArtifactDecision {
  allowedState: ArtifactState;
  saveAllowed: boolean;
  publishAllowed: boolean;
  reason: string;
}

const ADVERSARIAL_CATEGORIES: ReadonlySet<PrimaryCategory> = new Set<PrimaryCategory>([
  "adversarial_injection",
  "adversarial_pii",
  "adversarial_ssrf",
  "adversarial_exfil",
]);

const PULSE_CATEGORIES: ReadonlySet<PrimaryCategory> = new Set<PrimaryCategory>([
  "pulse",
  "pulse_generation",
  "gdr_background_pulse",
]);

const EXPORT_CATEGORIES: ReadonlySet<PrimaryCategory> = new Set<PrimaryCategory>([
  "crm_export",
  "share_export",
]);

const AMBIGUOUS_RESOLUTIONS: ReadonlySet<ResolutionExpectation> = new Set<ResolutionExpectation>([
  "ambiguous",
  "probable",
]);

/**
 * Core gate. Deterministic, pure. Call before any artifact mutation.
 */
export function decideArtifactState(input: ArtifactDecisionInput): ArtifactDecision {
  // Adversarial → always `none`. No artifact, no trace of attempt as saved state.
  if (ADVERSARIAL_CATEGORIES.has(input.primaryCategory)) {
    return {
      allowedState: "none",
      saveAllowed: false,
      publishAllowed: false,
      reason: `adversarial category ${input.primaryCategory} must not produce an artifact`,
    };
  }

  // Unsupported claim flagged by answer-control → draft_only
  if (input.hasUnsupportedClaim) {
    return {
      allowedState: "draft_only",
      saveAllowed: false,
      publishAllowed: false,
      reason: "answer-control flagged an unsupported claim; artifact locked to draft",
    };
  }

  // Hallucination gate failure → no save regardless of mode
  if (input.hallucinationGateFailed) {
    return {
      allowedState: "draft_only",
      saveAllowed: false,
      publishAllowed: false,
      reason: "hallucination gate failed; artifact locked to draft_only",
    };
  }

  // Ambiguous resolution → never canonicalize before disambiguation
  if (AMBIGUOUS_RESOLUTIONS.has(input.resolutionExpectation)) {
    return {
      allowedState: "none|draft",
      saveAllowed: false,
      publishAllowed: false,
      reason: `resolution_expectation=${input.resolutionExpectation}; cannot canonicalize`,
    };
  }

  // Pulse runs own their artifacts by design
  if (PULSE_CATEGORIES.has(input.primaryCategory)) {
    return {
      allowedState: "saved",
      saveAllowed: true,
      publishAllowed: false,
      reason: "pulse category owns its artifact lifecycle",
    };
  }

  // Export categories require save + publish
  if (EXPORT_CATEGORIES.has(input.primaryCategory)) {
    const canExport =
      input.citationCount >= 2 &&
      input.retrievalConfidence !== "low" &&
      !input.hasUnsupportedClaim;
    return canExport
      ? {
          allowedState: "saved|published",
          saveAllowed: true,
          publishAllowed: true,
          reason: "export category with sufficient evidence",
        }
      : {
          allowedState: "draft",
          saveAllowed: false,
          publishAllowed: false,
          reason: "export requested but evidence insufficient; kept as draft",
        };
  }

  // Fast mode default: never silently save
  if (input.mode === "fast") {
    if (input.userExplicitlyRequestedSave && input.retrievalConfidence === "high") {
      return {
        allowedState: "draft|saved",
        saveAllowed: true,
        publishAllowed: false,
        reason: "fast mode with explicit user save and high confidence",
      };
    }
    return {
      allowedState: "none|draft",
      saveAllowed: false,
      publishAllowed: false,
      reason: "fast mode defaults to none|draft; no silent save",
    };
  }

  // Slow mode: save-gate per v2 spec
  const saveGatePassed =
    (input.resolutionExpectation === "exact" ||
      input.resolutionExpectation === "exact_or_probable" ||
      input.resolutionExpectation === "file_first") &&
    input.citationCount >= 2 &&
    input.retrievalConfidence !== "low" &&
    input.userScopedToEvent;

  if (saveGatePassed) {
    return {
      allowedState: "draft|saved",
      saveAllowed: true,
      publishAllowed: false,
      reason: "slow mode save-gate passed",
    };
  }

  return {
    allowedState: "draft",
    saveAllowed: false,
    publishAllowed: false,
    reason: "slow mode save-gate not met; artifact kept as draft",
  };
}

/**
 * Runtime assertion to call from upstream mutations.
 * Throws on attempt to save when the gate blocks it — never silently succeed.
 */
export function assertSaveAllowed(
  decision: ArtifactDecision,
  context: string,
): void {
  if (!decision.saveAllowed) {
    throw new Error(
      `[artifactDecisionGate] save blocked at ${context}: ${decision.reason} (allowedState=${decision.allowedState})`,
    );
  }
}

/**
 * Runtime assertion for publish/export paths.
 */
export function assertPublishAllowed(
  decision: ArtifactDecision,
  context: string,
): void {
  if (!decision.publishAllowed) {
    throw new Error(
      `[artifactDecisionGate] publish blocked at ${context}: ${decision.reason} (allowedState=${decision.allowedState})`,
    );
  }
}
