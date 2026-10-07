/**
 * AskNodeBenchPill - the single canonical app-level "Ask NodeBench" trigger.
 *
 * Location: top-right of the product top-nav, next to the theme toggle and
 * sign-in / start-chat action. See src/layouts/ProductTopNav.tsx for the
 * mount site.
 *
 * Replaces two older triggers:
 *   1. CockpitLayout floating "Ask NodeBench assistant" button
 *   2. AgentPresenceRail sidebar "Open Ask NodeBench agent panel" card
 *
 * Per the architecture decision logged in chat 2026-04-20:
 *   - One app-level trigger (this pill) for "ask about this whole surface"
 *   - Contextual per-row / per-selection triggers stay where they are
 *     (they pre-load specific selection context into the same drawer)
 *   - Chat top-nav item is distinct: full-page conversation surface
 *
 * Keyboard shortcut: `Cmd+J` / `Ctrl+J` - handled globally by the
 * FastAgentProvider so it works from anywhere in the app, not only when
 * this pill is focused.
 */

import { Sparkles } from "lucide-react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

export type AskNodeBenchPillProps = {
  /** Optional class hook for layout-specific spacing. */
  className?: string;
  /** Override the default label - useful for mobile ("Ask" vs "Ask NodeBench"). */
  label?: string;
  /** Hide the kbd hint on small screens. */
  hideKbdOnMobile?: boolean;
};

export function AskNodeBenchPill({
  className,
  label = "Ask",
  hideKbdOnMobile = true,
}: AskNodeBenchPillProps) {
  const { isOpen, open, close } = useFastAgent();

  const handleToggle = () => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  };

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const shortcutKeys = isMac ? "⌘J" : "Ctrl+J";

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Open NodeBench agent panel"
      aria-expanded={isOpen}
      aria-pressed={isOpen}
      aria-keyshortcuts="Meta+J Control+J"
      title={`${isOpen ? "Close" : "Open"} agent panel · ${shortcutKeys}`}
      data-state={isOpen ? "active" : "inactive"}
      className={
        "nb-ask-pill inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 focus-visible:outline-none " +
        (isOpen
          ? "border-[var(--accent-primary)]/55 bg-[var(--accent-primary)]/16 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/18 shadow-[0_12px_30px_-20px_rgba(217,106,65,0.92)] dark:border-[var(--accent-primary)]/60 dark:bg-[var(--accent-primary)]/20 dark:text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-[var(--accent-primary)]/40 hover:bg-[var(--accent-primary)]/8 hover:text-[var(--accent-primary)] dark:border-white/[0.1] dark:bg-white/[0.02] dark:text-gray-300 dark:hover:bg-[var(--accent-primary)]/10 dark:hover:text-[var(--accent-primary)]") +
        (className ? " " + className : "")
      }
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{isOpen ? "Ask open" : label}</span>
      <kbd
        className={
          "ml-0.5 inline-flex items-center rounded border border-current/20 bg-current/5 px-1 py-0.5 font-mono text-[10px] leading-none " +
          (hideKbdOnMobile ? "hidden sm:inline-flex" : "")
        }
        aria-hidden="true"
      >
        {shortcutKeys}
      </kbd>
    </button>
  );
}
