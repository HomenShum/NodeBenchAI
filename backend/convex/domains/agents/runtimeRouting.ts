import type { UltraLongChatWorkingSet } from "../../../shared/ultraLongChatContext";
import {
  NODEBENCH_ADVISOR_MODEL,
  NODEBENCH_BACKGROUND_MODELS,
  NODEBENCH_EXECUTOR_MODELS,
  normalizeNodeBenchRuntimeModel,
  resolveModelAlias,
  type ApprovedModel,
  type NodeBenchRuntimeProfile,
} from "./mcp_tools/models/modelResolver";
import { isModelAvailable } from "./mcp_tools/models/healthcheck";

export type NodeBenchRoutingReason =
  | "anonymous_fast_executor"
  | "explicit_advisor"
  | "continuation_memory_anchor"
  | "multi_angle_orchestration"
  | "context_rot_guard"
  | "tool_heavy_executor"
  | "structured_executor"
  | "large_context_executor"
  | "cheap_executor_default"
  | "background_large_context";

export type NodeBenchRuntimeRoute = {
  profile: NodeBenchRuntimeProfile;
  model: ApprovedModel;
  reason: NodeBenchRoutingReason;
  explanation: string;
  fallbackModels: ApprovedModel[];
};

type ChooseNodeBenchRuntimeRouteArgs = {
  prompt: string;
  requestedModel?: string | null;
  useCoordinator?: boolean;
  isAnonymous?: boolean;
  hasOpenRouter?: boolean;
  workingSet?: UltraLongChatWorkingSet | null;
  availableModels?: ApprovedModel[] | null;
};

const REQUESTABLE_EXECUTOR_MODELS = new Set<ApprovedModel>([
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "minimax-m2.7",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
]);

function hasPattern(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function buildFallbacks(
  primary: ApprovedModel,
  candidates: ApprovedModel[],
): ApprovedModel[] {
  const seen = new Set<ApprovedModel>([primary]);
  const ordered: ApprovedModel[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    ordered.push(candidate);
  }
  return ordered;
}

function isRoutableModelAvailable(
  model: ApprovedModel,
  availableModels?: ApprovedModel[] | null,
): boolean {
  if (Array.isArray(availableModels) && availableModels.length > 0) {
    return availableModels.includes(model);
  }
  return isModelAvailable(model);
}

function chooseAvailableRouteModels(args: {
  primary: ApprovedModel;
  candidates: ApprovedModel[];
  availableModels?: ApprovedModel[] | null;
}): { model: ApprovedModel; fallbackModels: ApprovedModel[] } {
  const ordered = [args.primary, ...buildFallbacks(args.primary, args.candidates)];
  const availableOrdered = ordered.filter((model, index, array) => {
    if (array.indexOf(model) !== index) return false;
    return isRoutableModelAvailable(model, args.availableModels);
  });

  if (availableOrdered.length > 0) {
    const [model, ...fallbackModels] = availableOrdered;
    return { model, fallbackModels };
  }

  return {
    model: args.primary,
    fallbackModels: buildFallbacks(args.primary, args.candidates),
  };
}

function resolveRequestedExecutorModel(
  requestedModel?: string | null,
): ApprovedModel | null {
  if (!requestedModel) {
    return null;
  }

  const resolved = resolveModelAlias(requestedModel);
  if (!resolved) {
    return null;
  }

  if (!REQUESTABLE_EXECUTOR_MODELS.has(resolved)) {
    return null;
  }

  return normalizeNodeBenchRuntimeModel(resolved, "executor");
}

export function chooseNodeBenchRuntimeRoute(
  args: ChooseNodeBenchRuntimeRouteArgs,
): NodeBenchRuntimeRoute {
  const prompt = String(args.prompt ?? "").trim();
  const workingSet = args.workingSet ?? null;
  const activeAngles = workingSet?.activeAngles ?? [];
  const jitSlices = workingSet?.jitSlices ?? [];
  const messagesCompacted = workingSet?.messagesCompacted ?? 0;
  const contextRotRisk = workingSet?.contextRotRisk ?? "low";
  const hasOpenRouter = args.hasOpenRouter !== false;
  const pickRouteModels = (
    primary: ApprovedModel,
    candidates: ApprovedModel[],
  ) =>
    chooseAvailableRouteModels({
      primary,
      candidates,
      availableModels: args.availableModels,
    });

  if (args.isAnonymous) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      "gemini-3.1-flash-lite-preview",
      "executor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3-flash-preview",
      ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
      "gpt-5.4-mini",
    ]);
    return {
      profile: "executor",
      model,
      reason: "anonymous_fast_executor",
      explanation:
        "Anonymous turns stay on the lowest-cost Gemini 3 executor lane.",
      fallbackModels,
    };
  }

  const explicitAdvisor =
    args.useCoordinator !== false &&
    hasPattern(prompt, /\b(plan|orchestrate|delegate|deep research|deep dive)\b/i);
  const continuationSignal = hasPattern(
    prompt,
    /\b(what matters to me|what did we learn|do not re-research|never lose context|pick up where we left off)\b/i,
  );
  const openingAnchorSignal = messagesCompacted === 0 && activeAngles.length >= 3;
  const toolHeavyExecutorSignal = hasPattern(
    prompt,
    /\b(code|implement|patch|fix|script|automation|browser|scrape|run tool|tool call|mcp)\b/i,
  );
  const structuredExecutorSignal = hasPattern(
    prompt,
    /\b(json|schema|csv|table|structured|fields|classify|parse|extract into)\b/i,
  );
  const multiAngleSignal =
    activeAngles.length >= 4 ||
    jitSlices.length >= 4 ||
    (messagesCompacted >= 18 && activeAngles.length >= 3);
  const highRiskLongContext =
    contextRotRisk === "high" || messagesCompacted >= 24;

  if (highRiskLongContext) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      args.requestedModel ?? NODEBENCH_BACKGROUND_MODELS[0],
      "background",
    );
    const { model, fallbackModels } = pickRouteModels(
      preferredModel,
      NODEBENCH_BACKGROUND_MODELS,
    );
    return {
      profile: "background",
      model,
      reason: "background_large_context",
      explanation:
        "Escalated to the background-capable large-context lane because compaction alone is nearing its limit.",
      fallbackModels,
    };
  }

  if (explicitAdvisor) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      args.requestedModel ?? NODEBENCH_ADVISOR_MODEL,
      "advisor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gpt-5.4",
    ]);
    return {
      profile: "advisor",
      model,
      reason: "explicit_advisor",
      explanation:
        "Planner/orchestrator language pushes this turn onto the advisor lane.",
      fallbackModels,
    };
  }

  if (continuationSignal) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      args.requestedModel ?? NODEBENCH_ADVISOR_MODEL,
      "advisor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gpt-5.4",
    ]);
    return {
      profile: "advisor",
      model,
      reason: "continuation_memory_anchor",
      explanation:
        "Continuation turns stay on the advisor lane so the model preserves what matters without replaying the full thread.",
      fallbackModels,
    };
  }

  if (args.useCoordinator !== false && (openingAnchorSignal || multiAngleSignal)) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      args.requestedModel ?? NODEBENCH_ADVISOR_MODEL,
      "advisor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gpt-5.4",
    ]);
    return {
      profile: "advisor",
      model,
      reason: "multi_angle_orchestration",
      explanation:
        "Opening anchors and genuinely multi-angle turns use the advisor lane; narrower follow-ups stay on executor lanes.",
      fallbackModels,
    };
  }

  if (
    contextRotRisk === "medium" &&
    (activeAngles.length >= 3 || (messagesCompacted >= 18 && activeAngles.length >= 2))
  ) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      "gemini-3-flash-preview",
      "executor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-flash-lite-preview",
      ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
      "gpt-5.4-mini",
    ]);
    return {
      profile: "executor",
      model,
      reason: "context_rot_guard",
      explanation:
        "Use the roomier Gemini 3 executor because the session is compacted but still carrying multiple active angles.",
      fallbackModels,
    };
  }

  if (toolHeavyExecutorSignal) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      "gemini-3-flash-preview",
      "executor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-flash-lite-preview",
      ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
      "gpt-5.4-mini",
    ]);
    return {
      profile: "executor",
      model,
      reason: "tool_heavy_executor",
      explanation:
        "Tool-heavy execution stays on Gemini 3 Flash first for broader tool and long-context headroom, with cheaper executors only as fallbacks.",
      fallbackModels,
    };
  }

  if (structuredExecutorSignal) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      "gemini-3.1-flash-lite-preview",
      "executor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3-flash-preview",
      ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
      "gpt-5.4-mini",
    ]);
    return {
      profile: "executor",
      model,
      reason: "structured_executor",
      explanation:
        "Structured-output turns stay on Gemini 3.1 Flash Lite first; GPT-5.4 Mini is only a bounded fallback if we need a second pass.",
      fallbackModels,
    };
  }

  if (activeAngles.length >= 2 || jitSlices.length >= 2) {
    const preferredModel = normalizeNodeBenchRuntimeModel(
      "gemini-3-flash-preview",
      "executor",
    );
    const { model, fallbackModels } = pickRouteModels(preferredModel, [
      "gemini-3.1-flash-lite-preview",
      ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
      "gpt-5.4-mini",
    ]);
    return {
      profile: "executor",
      model,
      reason: "large_context_executor",
      explanation:
        "Executor turn still spans multiple slices, so it uses the larger Gemini 3 flash lane.",
      fallbackModels,
    };
  }

  const requestedExecutorModel = resolveRequestedExecutorModel(args.requestedModel);
  const preferredModel = normalizeNodeBenchRuntimeModel(
    requestedExecutorModel ?? NODEBENCH_EXECUTOR_MODELS[0],
    "executor",
  );
  const { model, fallbackModels } = pickRouteModels(preferredModel, [
    "gemini-3-flash-preview",
    ...(hasOpenRouter ? (["minimax-m2.7"] as ApprovedModel[]) : []),
    "gpt-5.4-mini",
    "kimi-k2.6",
  ]);
  return {
    profile: "executor",
    model,
    reason: "cheap_executor_default",
    explanation:
      "Bounded turn with light context stays on the cheapest Gemini 3 executor lane.",
    fallbackModels,
  };
}
