import { memo } from "react";
import {
  INTENT_LABEL,
  LENS_LABEL,
  RUNTIME_LABEL,
  type PromptClassification,
} from "@/features/chat/lib/classifyPrompt";

export interface ClassificationChipProps {
  classification: PromptClassification | null;
  variant?: "preview" | "active";
  className?: string;
}

export const ClassificationChip = memo(function ClassificationChip({
  classification,
  variant = "preview",
  className = "",
}: ClassificationChipProps) {
  if (!classification) return null;

  const intentLabels = classification.intents.map((i) => INTENT_LABEL[i]).join(" + ");
  const personaLabels = classification.personas.map((p) => LENS_LABEL[p]).join(" + ");
  const runtimeLabel = RUNTIME_LABEL[classification.runtime];
  const dotTone =
    classification.runtime === "slow"
      ? "bg-[var(--accent-primary)]"
      : "bg-emerald-400";

  const reasonTitle = [
    `Intent: ${classification.reasons.intent}`,
    `Persona: ${classification.reasons.persona}`,
    `Runtime: ${classification.reasons.runtime}`,
    `Confidence: ${Math.round(classification.confidence * 100)}%`,
  ].join(" • ");

  const isActive = variant === "active";

  return (
    <div
      role="status"
      aria-label="Inferred intent, persona, and runtime"
      title={reasonTitle}
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition ${
        isActive
          ? "border border-white/[0.1] bg-white/[0.04] text-gray-200 dark:border-white/[0.12] dark:bg-white/[0.06]"
          : "border border-gray-200 bg-gray-50 text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400"
      } ${className}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotTone}`}
        aria-hidden="true"
      />
      <span className="text-gray-500 dark:text-gray-400">Inferred</span>
      <span className="font-semibold text-gray-800 dark:text-gray-100">{personaLabels}</span>
      <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">{"\u00B7"}</span>
      <span className="text-gray-700 dark:text-gray-200">{intentLabels}</span>
      <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">{"\u00B7"}</span>
      <span className="text-gray-700 dark:text-gray-200">{runtimeLabel}</span>
    </div>
  );
});
