import {
  isApprovedModel,
  resolveModelAlias,
  type ApprovedModel,
} from "./mcp_tools/models/modelResolver";

export type TierModelCheck = {
  allowed: boolean;
  estimatedCost: number;
  reason?: string;
  suggestedModel?: string;
  maxTokensPerRequest?: number;
};

export type TierModelAttempt = {
  model: ApprovedModel;
  check?: TierModelCheck;
  skipped?: "provider_unavailable";
};

export type TierModelSelection = {
  model: ApprovedModel | null;
  check: TierModelCheck | null;
  attempts: TierModelAttempt[];
};

export type RuntimeBillingContext =
  | "authenticated_user"
  | "anonymous_user"
  | "trusted_evaluation";

export type MeteredProviderStep = {
  usage?: {
    totalTokens?: number;
    inputTokens?: number;
    promptTokens?: number;
    outputTokens?: number;
    completionTokens?: number;
  };
};

function reportedStepTotalTokens(step: MeteredProviderStep): number | null {
  const total = Number(step.usage?.totalTokens);
  if (Number.isFinite(total) && total > 0) return Math.ceil(total);
  const input = Number(step.usage?.inputTokens ?? step.usage?.promptTokens);
  const output = Number(step.usage?.outputTokens ?? step.usage?.completionTokens);
  if (
    Number.isFinite(input) &&
    input >= 0 &&
    Number.isFinite(output) &&
    output >= 0 &&
    input + output > 0
  ) {
    return Math.ceil(input + output);
  }
  return null;
}

export function getCumulativeMeteredProviderTokens(
  steps: MeteredProviderStep[],
  assignedStepTotalBudgets: number[],
): number {
  return steps.reduce((total, step, index) => {
    return total +
      (reportedStepTotalTokens(step) ??
        assignedStepTotalBudgets[index] ??
        Number.POSITIVE_INFINITY);
  }, 0);
}

export function planMeteredProviderStep(args: {
  requestTokenLimit: number;
  steps: MeteredProviderStep[];
  assignedStepTotalBudgets: number[];
  messages: readonly unknown[];
  system?: string;
  providerOverheadTokens?: number;
  maxStepOutputTokens?: number;
}) {
  const usedTokens = getCumulativeMeteredProviderTokens(
    args.steps,
    args.assignedStepTotalBudgets,
  );
  const serializedInput = JSON.stringify({
    system: args.system ?? "",
    messages: args.messages,
  });
  // UTF-8 bytes are a conservative upper bound for provider tokenizer units.
  // Reserve an additional fixed allowance for the three known tool schemas and
  // provider message framing, which are not present in `messages`.
  const inputUpperBoundTokens =
    new TextEncoder().encode(serializedInput).byteLength +
    (args.providerOverheadTokens ?? 1_024);
  const remainingAfterInput =
    args.requestTokenLimit - usedTokens - inputUpperBoundTokens;
  if (!Number.isFinite(remainingAfterInput) || remainingAfterInput < 1) {
    throw new Error(
      `Request exceeds the cumulative metered token budget (${args.requestTokenLimit.toLocaleString()} tokens)`,
    );
  }
  const maxOutputTokens = Math.max(
    1,
    Math.min(args.maxStepOutputTokens ?? 1_024, remainingAfterInput),
  );
  return {
    usedTokens,
    inputUpperBoundTokens,
    maxOutputTokens,
    assignedTotalTokens: inputUpperBoundTokens + maxOutputTokens,
  };
}

export function resolveRuntimeBillingContext(args: {
  hasAuthenticatedUser: boolean;
  isAnonymous: boolean;
  evaluationMode: boolean;
  usageSessionId?: string;
}): RuntimeBillingContext {
  if (args.hasAuthenticatedUser) return "authenticated_user";
  if (
    !args.isAnonymous &&
    args.evaluationMode &&
    args.usageSessionId?.startsWith("__eval_personaEpisodeEval__:")
  ) {
    return "trusted_evaluation";
  }
  return "anonymous_user";
}

export function assertTierModelAllowed(
  model: ApprovedModel,
  check: TierModelCheck,
): TierModelCheck {
  if (!check.allowed) {
    throw new Error(
      `Rate limit exceeded: ${check.reason ?? `Model ${model} is unavailable for this account`}`,
    );
  }
  return check;
}

const TIER_SAFE_RUNTIME_FALLBACKS: readonly ApprovedModel[] = [
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "claude-haiku-4.5",
];

export function getRuntimeAccessTokenEstimate(isUnauthenticated: boolean): {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
} {
  return isUnauthenticated
    ? { estimatedInputTokens: 1000, estimatedOutputTokens: 1000 }
    : { estimatedInputTokens: 2000, estimatedOutputTokens: 1000 };
}

function resolveSuggestedModel(model: string | undefined): ApprovedModel | null {
  if (!model) return null;
  const resolved = resolveModelAlias(model);
  return resolved && isApprovedModel(resolved) ? resolved : null;
}

/**
 * Reconcile runtime routing with the authenticated user's billing tier.
 *
 * Runtime routing intentionally optimizes for task shape and provider health, while
 * the billing gate is the source of truth for plan eligibility and remaining budget.
 * This helper keeps the hard gate intact, but follows its approved suggestion (or a
 * configured low-cost fallback) instead of failing before the first model call.
 */
export async function selectTierEligibleRuntimeModel(args: {
  primaryModel: ApprovedModel;
  fallbackModels?: readonly ApprovedModel[];
  excludedModels?: readonly ApprovedModel[];
  checkModel: (model: ApprovedModel) => Promise<TierModelCheck>;
  isModelAvailable?: (model: ApprovedModel) => boolean;
}): Promise<TierModelSelection> {
  const isModelAvailable = args.isModelAvailable ?? (() => true);
  const queue: ApprovedModel[] = [];
  const seen = new Set<ApprovedModel>();
  const excluded = new Set(args.excludedModels ?? []);
  const attempts: TierModelAttempt[] = [];

  const enqueue = (model: ApprovedModel, index?: number) => {
    if (seen.has(model) || excluded.has(model)) return;
    seen.add(model);
    if (typeof index === "number") {
      queue.splice(index, 0, model);
    } else {
      queue.push(model);
    }
  };

  enqueue(args.primaryModel);
  for (const model of args.fallbackModels ?? []) enqueue(model);
  for (const model of TIER_SAFE_RUNTIME_FALLBACKS) enqueue(model);

  for (let index = 0; index < queue.length; index += 1) {
    const model = queue[index];
    if (!isModelAvailable(model)) {
      attempts.push({ model, skipped: "provider_unavailable" });
      continue;
    }

    const check = await args.checkModel(model);
    attempts.push({ model, check });
    if (check.allowed) {
      return { model, check, attempts };
    }

    const suggestedModel = resolveSuggestedModel(check.suggestedModel);
    if (suggestedModel && !seen.has(suggestedModel)) {
      enqueue(suggestedModel, index + 1);
    }
  }

  return { model: null, check: null, attempts };
}

export function getTierSelectionFailureReason(
  selection: TierModelSelection,
): string {
  let reason: string | undefined;
  for (const attempt of selection.attempts) {
    if (attempt.check?.reason) reason = attempt.check.reason;
  }
  return reason ?? "No configured model is available for this account tier";
}
