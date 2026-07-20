// src/features/agents/components/FastAgentPanel/FastAgentPanel.PromptEnhancer.tsx
// Prompt enhancement preview with memory context injection

import React, { useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Sparkles,
  Check,
  X,
  Brain,
  Clock,
  User,
  Wrench,
  FileText,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

interface EntityContext {
  name: string;
  type: "ground_truth" | "inferred";
  confidence: number;
}

interface MemorySummary {
  entityName: string;
  qualityTier: "excellent" | "good" | "fair" | "poor";
  ageInDays: number;
  factCount: number;
  isStale: boolean;
}

interface TemporalContext {
  label: string;
  startDate: string;
  endDate: string;
}

interface DossierContext {
  actIndex: number;
  sectionType: string;
  chartId?: string;
  entityName?: string;
}

interface PromptDiff {
  type: "added" | "context";
  content: string;
  source: string;
}

interface EnhancedPrompt {
  original: string;
  enhanced: string;
  diff: PromptDiff[];
  injectedContext: {
    entities: EntityContext[];
    memory: MemorySummary[];
    temporalRange?: TemporalContext;
    dossierContext?: DossierContext;
    suggestedTools: string[];
    personaHint?: string;
  };
}

interface PromptEnhancerProps {
  value: string;
  onChange: (value: string) => void;
  threadId?: string;
  dossierContext?: DossierContext;
  attachedFileIds?: string[];
  onEnhanced?: (enhanced: EnhancedPrompt) => void;
  disabled?: boolean;
}

// ============================================================================
// QUALITY TIER COLORS
// ============================================================================

const qualityTierColors: Record<string, string> = {
  excellent: "bg-green-500/20 text-green-400 border-green-500/30",
  good: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  fair: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  poor: "bg-red-500/20 text-red-400 border-red-500/30",
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PromptEnhancer({
  value,
  onChange,
  threadId,
  dossierContext,
  attachedFileIds,
  onEnhanced,
  disabled = false,
}: PromptEnhancerProps) {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [preview, setPreview] = useState<EnhancedPrompt | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["memory", "tools"])
  );

  const enhancePromptAction = useAction(
    api.domains.agents.promptEnhancer.enhancePrompt
  );

  const handleEnhance = useCallback(async () => {
    if (!value.trim() || disabled || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const result = await enhancePromptAction({
        prompt: value,
        threadId,
        dossierContext,
        attachedFileIds,
      });

      setPreview(result);
      setShowPreview(true);
      onEnhanced?.(result);
    } catch (error) {
      console.error("Enhancement failed:", error);
    } finally {
      setIsEnhancing(false);
    }
  }, [
    value,
    threadId,
    dossierContext,
    attachedFileIds,
    disabled,
    isEnhancing,
    enhancePromptAction,
    onEnhanced,
  ]);

  const handleAccept = useCallback(() => {
    if (preview) {
      onChange(preview.enhanced);
      setPreview(null);
      setShowPreview(false);
    }
  }, [preview, onChange]);

  const handleReject = useCallback(() => {
    setPreview(null);
    setShowPreview(false);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P or Cmd+P to trigger enhancement
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        handleEnhance();
      }

      // Escape to close preview
      if (e.key === "Escape" && showPreview) {
        handleReject();
      }

      // Enter to accept (when preview is shown)
      if (e.key === "Enter" && showPreview && !e.shiftKey) {
        e.preventDefault();
        handleAccept();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleAccept, handleEnhance, handleReject, showPreview]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  // Don't render anything if no value
  if (!value.trim()) {
    return null;
  }

  return (
    <div className="prompt-enhancer relative">
      {/* Enhancement button */}
      <button
        onClick={handleEnhance}
        disabled={disabled || isEnhancing || !value.trim()}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all",
          "hover:bg-purple-500/20 active:scale-95",
          isEnhancing
            ? "text-purple-400 bg-purple-500/10"
            : "text-content-muted hover:text-purple-400",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        title="Enhance prompt with context (Ctrl+P)"
      >
        {isEnhancing ? (
          <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span>{isEnhancing ? "Enhancing..." : "Enhance"}</span>
      </button>

      {/* Preview modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface-secondary border border-edge rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h3 className="font-medium text-content">Enhanced Prompt</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAccept}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                  Accept
                </button>
                <button
                  onClick={handleReject}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-hover text-content-secondary hover:bg-surface-hover transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Injected Context Summary */}
              <div className="space-y-3">
                {/* Memory */}
                {preview.injectedContext.memory.length > 0 && (
                  <ContextSection
                    icon={<Brain className="h-4 w-4" />}
                    title="Memory"
                    expanded={expandedSections.has("memory")}
                    onToggle={() => toggleSection("memory")}
                  >
                    <div className="flex flex-wrap gap-2">
                      {preview.injectedContext.memory.map((m, i) => (
                        <MemoryBadge key={i} memory={m} />
                      ))}
                    </div>
                  </ContextSection>
                )}

                {/* Persona */}
                {preview.injectedContext.personaHint && (
                  <ContextSection
                    icon={<User className="h-4 w-4" />}
                    title="Persona"
                    expanded={expandedSections.has("persona")}
                    onToggle={() => toggleSection("persona")}
                  >
                    <span className="px-2 py-1 rounded-md text-xs font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      {preview.injectedContext.personaHint}
                    </span>
                  </ContextSection>
                )}

                {/* Temporal */}
                {preview.injectedContext.temporalRange && (
                  <ContextSection
                    icon={<Clock className="h-4 w-4" />}
                    title="Timeframe"
                    expanded={expandedSections.has("temporal")}
                    onToggle={() => toggleSection("temporal")}
                  >
                    <span className="px-2 py-1 rounded-md text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {preview.injectedContext.temporalRange.label}
                    </span>
                  </ContextSection>
                )}

                {/* Suggested Tools */}
                {preview.injectedContext.suggestedTools.length > 0 && (
                  <ContextSection
                    icon={<Wrench className="h-4 w-4" />}
                    title="Suggested Tools"
                    expanded={expandedSections.has("tools")}
                    onToggle={() => toggleSection("tools")}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {preview.injectedContext.suggestedTools.map((tool, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded text-xs font-mono bg-surface-hover text-content-secondary"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </ContextSection>
                )}

                {/* Files */}
                {attachedFileIds && attachedFileIds.length > 0 && (
                  <ContextSection
                    icon={<FileText className="h-4 w-4" />}
                    title="Files"
                    expanded={expandedSections.has("files")}
                    onToggle={() => toggleSection("files")}
                  >
                    <span className="text-xs text-content-muted">
                      {attachedFileIds.length} file(s) attached
                    </span>
                  </ContextSection>
                )}
              </div>

              {/* Diff View */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-content-secondary">
                  Context Injections
                </h4>
                <div className="space-y-1 bg-surface-hover rounded-md p-3 border border-edge">
                  {preview.diff.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-xs font-mono"
                    >
                      <span className="text-content-muted shrink-0">
                        [{d.source}]
                      </span>
                      <span className="text-green-400">{d.content}</span>
                    </div>
                  ))}
                  {preview.diff.length === 0 && (
                    <span className="text-xs text-content-muted">
                      No context additions detected
                    </span>
                  )}
                </div>
              </div>

              {/* Original Prompt */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-content-secondary">
                  Your Prompt
                </h4>
                <div className="bg-surface-hover rounded-md p-3 border border-edge">
                  <p className="text-sm text-content whitespace-pre-wrap">
                    {preview.original}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-edge bg-surface-hover">
              <p className="text-xs text-content-muted">
                Press <kbd className="px-1 py-0.5 rounded bg-surface-hover">Enter</kbd> to
                accept or{" "}
                <kbd className="px-1 py-0.5 rounded bg-surface-hover">Esc</kbd> to
                cancel
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface ContextSectionProps {
  icon: React.ReactNode;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function ContextSection({
  icon,
  title,
  expanded,
  onToggle,
  children,
}: ContextSectionProps) {
  return (
    <div className="border border-edge rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 bg-surface-hover hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2 text-content-secondary">
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-content-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-content-muted" />
        )}
      </button>
      {expanded && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

interface MemoryBadgeProps {
  memory: MemorySummary;
}

function MemoryBadge({ memory }: MemoryBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded-md text-xs border",
        qualityTierColors[memory.qualityTier]
      )}
    >
      <span className="font-medium">{memory.entityName}</span>
      <span className="opacity-75">
        {memory.qualityTier} | {memory.factCount} facts | {memory.ageInDays}d
        {memory.isStale && " | outdated"}
      </span>
    </div>
  );
}

// ============================================================================
// COMPACT INLINE ENHANCER (for use in InputBar)
// ============================================================================

interface InlineEnhancerProps {
  value: string;
  onEnhance: () => void;
  isEnhancing: boolean;
  disabled?: boolean;
}

export function InlineEnhancer({
  value,
  onEnhance,
  isEnhancing,
  disabled = false,
}: InlineEnhancerProps) {
  if (!value.trim()) return null;

  return (
    <button
      type="button"
      onClick={onEnhance}
      disabled={disabled || isEnhancing}
      className={cn(
        "p-1.5 rounded-md transition-all",
        "hover:bg-purple-500/20 active:scale-95",
        isEnhancing
          ? "text-purple-400 bg-purple-500/10"
          : "text-content-muted hover:text-purple-400",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      title="Enhance prompt with context (Ctrl+P)"
    >
      {isEnhancing ? (
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
    </button>
  );
}

export default PromptEnhancer;
