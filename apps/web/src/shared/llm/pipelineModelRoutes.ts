import {
  DEFAULT_MODEL,
  MODEL_UI_INFO,
  type ApprovedModel,
  type Provider,
  isApprovedModel,
} from "./approvedModels";

export const PIPELINE_MODEL_AUTO_BALANCED = "nodebench:auto-balanced";
export const PIPELINE_MODEL_AUTO_FREE = "nodebench:auto-free";
export const PIPELINE_MODEL_AUTO_FRONTIER = "nodebench:auto-frontier";
export const PIPELINE_MODEL_AUTO_FAST = "nodebench:auto-fast";

export type PipelineModelRouteId =
  | typeof PIPELINE_MODEL_AUTO_BALANCED
  | typeof PIPELINE_MODEL_AUTO_FREE
  | typeof PIPELINE_MODEL_AUTO_FRONTIER
  | typeof PIPELINE_MODEL_AUTO_FAST;

export type PipelineModelSelection = PipelineModelRouteId | ApprovedModel;

export type PipelineModelOption = {
  value: PipelineModelSelection;
  label: string;
  shortLabel: string;
  detail: string;
  provider: Provider;
  resolvedModelId: ApprovedModel;
  isRoute: boolean;
  isFree: boolean;
};

const AUTO_ROUTE_OPTIONS: PipelineModelOption[] = [
  {
    value: PIPELINE_MODEL_AUTO_BALANCED,
    label: "Auto balanced",
    shortLabel: "Auto balanced",
    detail: "Recommended route for research quality, latency, and cost.",
    provider: MODEL_UI_INFO[DEFAULT_MODEL].provider,
    resolvedModelId: DEFAULT_MODEL,
    isRoute: true,
    isFree: false,
  },
  {
    value: PIPELINE_MODEL_AUTO_FREE,
    label: "Auto free",
    shortLabel: "Auto free",
    detail: "Free-capable OpenRouter route for budget-sensitive runs.",
    provider: "openrouter",
    resolvedModelId: "laguna-s-2.1-free",
    isRoute: true,
    isFree: true,
  },
  {
    value: PIPELINE_MODEL_AUTO_FRONTIER,
    label: "Best quality",
    shortLabel: "Best quality",
    detail: "Frontier model route for high-stakes reports.",
    provider: MODEL_UI_INFO["gpt-5.4"].provider,
    resolvedModelId: "gpt-5.4",
    isRoute: true,
    isFree: false,
  },
  {
    value: PIPELINE_MODEL_AUTO_FAST,
    label: "Fast",
    shortLabel: "Fast",
    detail: "Low-latency route for lightweight capture and refreshes.",
    provider: MODEL_UI_INFO["gemini-3.1-flash-lite-preview"].provider,
    resolvedModelId: "gemini-3.1-flash-lite-preview",
    isRoute: true,
    isFree: false,
  },
];

export const PIPELINE_DIRECT_MODEL_IDS: ApprovedModel[] = [
  DEFAULT_MODEL,
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gpt-5.4-mini",
  "gpt-5.4",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "laguna-s-2.1-free",
  "laguna-xs-2.1-free",
  "step-3.5-flash-free",
  "gpt-oss-120b-free",
];

const DIRECT_MODEL_OPTIONS: PipelineModelOption[] = PIPELINE_DIRECT_MODEL_IDS.map((modelId) => {
  const info = MODEL_UI_INFO[modelId];
  return {
    value: modelId,
    label: info.name,
    shortLabel: info.name,
    detail: info.description,
    provider: info.provider,
    resolvedModelId: modelId,
    isRoute: false,
    isFree: Boolean(info.isFree),
  };
});

export const PIPELINE_MODEL_OPTIONS: PipelineModelOption[] = [
  ...AUTO_ROUTE_OPTIONS,
  ...DIRECT_MODEL_OPTIONS,
];

export const DEFAULT_PIPELINE_MODEL_SELECTION: PipelineModelSelection =
  PIPELINE_MODEL_AUTO_BALANCED;

export function getPipelineModelOption(value: string | null | undefined): PipelineModelOption {
  const exact = PIPELINE_MODEL_OPTIONS.find((option) => option.value === value);
  if (exact) return exact;

  if (value && isApprovedModel(value)) {
    const info = MODEL_UI_INFO[value];
    return {
      value,
      label: info.name,
      shortLabel: info.name,
      detail: info.description,
      provider: info.provider,
      resolvedModelId: value,
      isRoute: false,
      isFree: Boolean(info.isFree),
    };
  }

  return AUTO_ROUTE_OPTIONS[0];
}

export function getPipelineModelRuntimeId(value: string | null | undefined): ApprovedModel {
  return getPipelineModelOption(value).resolvedModelId;
}
