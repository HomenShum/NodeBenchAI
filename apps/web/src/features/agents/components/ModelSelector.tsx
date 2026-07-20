/**
 * Model Selector Component
 * Allows users to select their preferred LLM provider and model
 *
 * Uses shared/llm/approvedModels.ts as SINGLE SOURCE OF TRUTH
 */

import React, { useState, useMemo } from "react";
import { ChevronDown, Sparkles, Zap, Brain, Check, Gift } from "lucide-react";

// Import from SINGLE SOURCE OF TRUTH
import {
  getModelUIList,
  PROVIDER_COLORS,
  type ApprovedModel,
  type ModelUIInfo,
} from "@shared/llm/approvedModels";

const TIER_ICONS = {
  fast: Zap,
  balanced: Sparkles,
  powerful: Brain,
};

// Get models from shared module
const MODELS = getModelUIList();

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  compact?: boolean;
}

type ProviderFilter = "all" | "openai" | "anthropic" | "google" | "openrouter";

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  className = "",
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterProvider, setFilterProvider] = useState<ProviderFilter>("all");

  const selectedModel = useMemo(() => 
    MODELS.find(m => m.id === value) ?? MODELS[0],
    [value]
  );

  const filteredModels = useMemo(() =>
    filterProvider === "all" 
      ? MODELS 
      : MODELS.filter(m => m.provider === filterProvider),
    [filterProvider]
  );

  const providerStyle = PROVIDER_COLORS[selectedModel.provider];
  const TierIcon = TIER_ICONS[selectedModel.tier];

  if (compact) {
    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${providerStyle.bg} ${providerStyle.border} border ${providerStyle.text} hover:opacity-80 transition-opacity`}
        >
          <span>{providerStyle.icon}</span>
          <span>{selectedModel.name}</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-surface rounded-lg shadow-xl border border-edge py-1 max-h-80 overflow-y-auto">
              {MODELS.map((model) => {
                const style = PROVIDER_COLORS[model.provider];
                const Icon = TIER_ICONS[model.tier];
                const isSelected = model.id === value;
                return (
                  <button
                    type="button"
                    key={model.id}
                    onClick={() => { onChange(model.id); setIsOpen(false); }}
                    className={`w-full px-3 py-2 text-left hover:bg-surface-hover dark:hover:bg-white/[0.03] flex items-center gap-2 ${isSelected ? 'bg-surface-secondary' : ''}`}
                  >
                    <span className="text-sm">{style.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-content truncate flex items-center gap-1.5">
                        <span>{model.name}</span>
                        {model.isFree && <Gift className="h-3.5 w-3.5 text-violet-500" />}
                      </div>
                      <div className="text-xs text-content-secondary">{model.description}</div>
                    </div>
                    <Icon className="h-3.5 w-3.5 text-content-muted" />
                    {isSelected && <Check className="h-4 w-4 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Provider Filter */}
      <div className="flex gap-2">
        {(["all", "openai", "anthropic", "google", "openrouter"] as const).map((provider) => (
          <button
            type="button"
            key={provider}
            onClick={() => setFilterProvider(provider)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterProvider === provider
                ? "bg-content text-surface"
                : "bg-surface-secondary text-content-secondary hover:bg-surface-secondary dark:hover:bg-white/[0.1]"
            }`}
          >
            {provider === "all"
              ? "All"
              : provider === "google"
                ? "Google"
                : provider === "openrouter"
                  ? "OpenRouter"
                  : provider.charAt(0).toUpperCase() + provider.slice(1)}
          </button>
        ))}
      </div>

      {/* Model Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {filteredModels.map((model) => {
          const style = PROVIDER_COLORS[model.provider];
          const Icon = TIER_ICONS[model.tier];
          const isSelected = model.id === value;

          return (
            <button
              type="button"
              key={model.id}
              onClick={() => onChange(model.id)}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? `${style.border} ${style.bg} ring-2 ring-offset-1 ring-ring`
                  : "border-edge hover:border-edge dark:hover:border-white/[0.1] bg-surface"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{style.icon}</span>
                  <span className="font-medium text-content text-sm">{model.name}</span>
                  {model.isFree && <Gift className="h-3.5 w-3.5 text-violet-500" />}
                </div>
                <p className="text-xs text-content-secondary mt-0.5">{model.description}</p>
              </div>
                <div className="flex items-center gap-1">
                  <Icon className="h-4 w-4 text-content-muted" />
                  {isSelected && <Check className="h-4 w-4 text-indigo-600" />}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-content-muted">
                <span className="px-1.5 py-0.5 bg-surface-secondary rounded">{model.contextWindow}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModelSelector;
