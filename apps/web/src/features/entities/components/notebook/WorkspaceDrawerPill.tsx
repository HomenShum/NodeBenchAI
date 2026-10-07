/**
 * WorkspaceDrawerPill — fixed bottom-right trigger that opens the global
 * FastAgentContext drawer for the current entity (redesign PR1).
 *
 * The pill is the ONLY persistent runtime affordance in the notebook body.
 * It advertises the drawer exists (most users never discover Cmd+J on their
 * own) and wires the click to `openWithContext({ initialTab })` so the
 * drawer lands on the right tab with the right entity context.
 *
 * Heuristics PR1 ships:
 *   - Default tab = "chat" on manual click (user ask intent).
 *   - When a run is active, the label gains a subtle "run" dot and default
 *     tab flips to "scratchpad" so one click lands on the live trace.
 *   - When no run exists yet but the user has edit rights, show the
 *     default chat affordance.
 *
 * Full Chat / Scratchpad / Flow tab refactor happens in PR2.
 */

import { memo, useMemo } from "react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { useViewMode } from "@/features/entities/lib/useViewMode";

export type WorkspaceDrawerPillProps = {
  entitySlug: string;
  entityName?: string;
  runActive?: boolean;
  runLabel?: string;
};

function WorkspaceDrawerPillBase({
  entitySlug,
  entityName,
  runActive = false,
  runLabel,
}: WorkspaceDrawerPillProps) {
  const { isOpen, openWithContext } = useFastAgent();
  const { isReadMode } = useViewMode();
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    [],
  );
  const shortcutLabel = isMac ? "⌘J" : "Ctrl+J";

  // Hide while the drawer is already open — the drawer owns its own close
  // affordance, and the pill would otherwise float on top of the panel.
  if (isOpen || isReadMode) return null;

  const initialTab = runActive ? "scratchpad" : "chat";
  const contextTitle = entityName ?? entitySlug;
  // Linear/Vercel status-pill pattern: pulse dot + single-word state + kbd hint.
  // Collapses the prior 2-line "Live run / streaming / Ctrl+J" stack (152px wide)
  // into a single scannable row. `runLabel` lives in the `title` tooltip so power
  // users still get the current checkpoint step on hover without crowding the pill.
  const labelPrimary = runActive ? "Live" : "Ask";
  const dotClass = runActive
    ? "bg-emerald-400 animate-pulse shadow-[0_0_0_3px_rgba(52,211,153,0.18)]"
    : "bg-white/70";
  const titleSuffix = runActive && runLabel ? ` · ${runLabel}` : "";

  return (
    <button
      type="button"
      onClick={() =>
        openWithContext({
          initialTab,
          contextEntitySlug: entitySlug,
          contextTitle,
        })
      }
      data-testid="workspace-drawer-pill"
      className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#12161b]/95 px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_18px_42px_rgba(0,0,0,0.32)] backdrop-blur transition hover:border-white/20 hover:bg-[#161b21]/95"
      aria-label={`Open workspace drawer — ${labelPrimary}`}
      title={`Open workspace drawer · ${shortcutLabel}${titleSuffix}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
      />
      <span className="font-semibold leading-none text-white">{labelPrimary}</span>
      <span
        aria-hidden="true"
        className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/75"
      >
        {shortcutLabel}
      </span>
    </button>
  );
}

export const WorkspaceDrawerPill = memo(WorkspaceDrawerPillBase);
WorkspaceDrawerPill.displayName = "WorkspaceDrawerPill";
