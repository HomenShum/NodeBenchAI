/**
 * AgentCommandBar.tsx
 *
 * Central input for agent commands with /spawn syntax support.
 * Features: auto-complete, agent type dropdown, model selector, quick action chips.
 */

import React, { memo, useState, useRef, useCallback, useEffect } from "react";
import {
  Send,
  Zap,
  ChevronDown,
  FileText,
  Video,
  Building,
  TrendingUp,
  Search,
  Command,
  Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseSpawnCommand, isSpawnCommand } from "@/hooks/useSwarm";

// Import from SINGLE SOURCE OF TRUTH
import {
  APPROVED_MODELS,
  MODEL_UI_INFO,
  DEFAULT_MODEL,
  type ApprovedModel,
} from "@shared/llm/approvedModels";

// ============================================================================
// Types & Constants
// ============================================================================

export type { ApprovedModel };

// Build MODEL_OPTIONS from shared APPROVED_MODELS (SINGLE SOURCE OF TRUTH)
const MODEL_OPTIONS = APPROVED_MODELS.map((modelId) => {
  const info = MODEL_UI_INFO[modelId];
  return {
    value: modelId,
    label: info.name,
    provider: info.provider.charAt(0).toUpperCase() + info.provider.slice(1),
    isFree: info.isFree ?? false,
  };
});

const QUICK_ACTIONS = [
  { label: "Research", command: "/spawn", agents: ["doc", "media", "sec"], icon: Search },
  { label: "Compare Sources", command: "/spawn", agents: ["research"], icon: FileText },
  { label: "Market Analysis", command: "/spawn", agents: ["finance", "sec"], icon: TrendingUp },
  { label: "Media Scan", command: "/spawn", agents: ["media"], icon: Video },
];

const AGENT_SHORTCUTS = [
  { key: "doc", name: "Document", icon: FileText },
  { key: "media", name: "Media", icon: Video },
  { key: "sec", name: "SEC", icon: Building },
  { key: "finance", name: "Finance", icon: TrendingUp },
  { key: "research", name: "Research", icon: Search },
];

interface AgentCommandBarProps {
  onSubmit: (query: string, options: {
    model: ApprovedModel;
    agents?: string[];
  }) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

// ============================================================================
// Sub-components
// ============================================================================

const ModelSelector = memo(function ModelSelector({
  model,
  onModelChange,
  isOpen,
  onToggle,
}: {
  model: ApprovedModel;
  onModelChange: (model: ApprovedModel) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const selected = MODEL_OPTIONS.find((m) => m.value === model) || MODEL_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
          "text-xs font-medium border border-edge",
          "hover:bg-surface-hover transition-colors",
          isOpen && "bg-surface-hover"
        )}
      >
        <span className="max-w-[120px] truncate">{selected.label}</span>
        {selected.isFree && <Gift className="w-3 h-3 text-violet-500" />}
        <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[220px] bg-surface border border-edge rounded-lg shadow-lg overflow-hidden max-h-[320px] overflow-y-auto">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                onModelChange(m.value);
                onToggle();
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-left",
                "hover:bg-surface-hover transition-colors",
                model === m.value && "bg-indigo-500/10"
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-content">{m.label}</span>
                {m.isFree && <Gift className="w-3 h-3 text-violet-500" />}
              </div>
              <div className="text-xs text-content-muted">{m.provider}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const AgentCommandBar = memo(function AgentCommandBar({
  onSubmit,
  isLoading = false,
  placeholder = "Ask NodeBench...",
  className,
}: AgentCommandBarProps) {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ApprovedModel>(DEFAULT_MODEL);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Detect /spawn command in input
  const isSpawn = isSpawnCommand(input);
  const parsedSpawn = isSpawn ? parseSpawnCommand(input) : null;

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Show hint when user starts typing /
  useEffect(() => {
    setShowHint(input.startsWith("/") && !isSpawn);
  }, [input, isSpawn]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;

    if (parsedSpawn) {
      onSubmit(parsedSpawn.query, { model, agents: parsedSpawn.agents });
    } else {
      onSubmit(input.trim(), { model });
    }

    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input, isLoading, parsedSpawn, model, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleQuickAction = useCallback((action: typeof QUICK_ACTIONS[0]) => {
    const agentsStr = action.agents.join(",");
    setInput(`/spawn "" --agents=${agentsStr}`);
    inputRef.current?.focus();
    // Position cursor inside quotes
    setTimeout(() => {
      if (inputRef.current) {
        const pos = 8; // Position after first quote
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, []);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Command Input Area — the only primary action on first view. */}
      <div className="relative">
        <div
          className={cn(
            "flex flex-col bg-surface rounded-lg border border-edge",
            "focus-within:ring-2 focus-within:ring-ring",
            "focus-within:border-indigo-500/30/50 transition-all",
          )}
        >
          {/* Input Row */}
          <div className="flex items-end gap-2 p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label="Message input"
              rows={1}
              className={cn(
                "flex-1 resize-none bg-transparent text-sm",
                "text-content placeholder:text-content-muted",
                "outline-none min-h-[24px] max-h-[120px]",
              )}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                "bg-[var(--accent-primary)] text-white",
                "hover:opacity-90 transition-opacity",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Swarm-only controls. A plain ask routes to the canonical FastAgent panel. */}
          {isSpawn && parsedSpawn && (
            <div className="flex items-center justify-between px-3 pb-3 pt-0">
              <ModelSelector
                model={model}
                onModelChange={setModel}
                isOpen={modelDropdownOpen}
                onToggle={() => setModelDropdownOpen(!modelDropdownOpen)}
              />
              <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                <Zap className="w-3 h-3" aria-hidden="true" />
                <span>Swarm: {parsedSpawn.agents.length} agents</span>
              </div>
            </div>
          )}
        </div>

        {/* Command Hint */}
        {showHint && (
          <div className="absolute top-full left-0 mt-1 z-50 w-full max-w-md bg-surface border border-edge rounded-lg shadow-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Command className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-medium text-content">
                Spawn Command
              </span>
            </div>
            <p className="text-xs text-content-muted mb-2">
              Use{" "}
              <code className="px-1 bg-surface-secondary rounded">
                /spawn "query" --agents=doc,media,sec
              </code>
            </p>
            <div className="flex flex-wrap gap-1">
              {AGENT_SHORTCUTS.map((agent) => {
                const Icon = agent.icon;
                return (
                  <span
                    key={agent.key}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-surface-secondary rounded"
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {agent.key}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <details className="group w-fit max-w-full">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-content-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Suggestions
          <ChevronDown
            className="h-3 w-3 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Agent command suggestions"
        >
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => handleQuickAction(action)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1.5",
                  "bg-surface text-xs font-medium hover:bg-surface-hover transition-colors",
                )}
              >
                <Icon
                  className="h-3 w-3 text-indigo-600 dark:text-indigo-400"
                  aria-hidden="true"
                />
                {action.label}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
});

export default AgentCommandBar;
