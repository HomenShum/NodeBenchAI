/**
 * LiveDiligenceSection — always-visible runtime status header.
 *
 * Post-spec-alignment role (canonical spec §5 + §3):
 *   - Renders `NotebookTopStatusRow` (4 silent-when-idle chips)
 *   - "Details" toggle OPENS THE WORKSPACE DRAWER to the Flow tab
 *     (or Scratchpad when no run is live)
 *   - No more in-body panel stack. Runtime lives in the drawer;
 *     the notebook body is content-only.
 */

import { memo } from "react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { useRunGraph } from "@/features/agents/hooks/useRunGraph";
import { NotebookTopStatusRow } from "@/features/entities/components/NotebookTopStatusRow";
import { cn } from "@/lib/utils";

export interface LiveDiligenceSectionProps {
  entitySlug: string;
  canEdit: boolean;
  hasDriftWarning?: boolean;
  hasPendingRetries?: boolean;
  hasActiveRun?: boolean;
  lastRunAt?: number | null;
  className?: string;
}

export const LiveDiligenceSection = memo(function LiveDiligenceSection({
  entitySlug,
  canEdit: _canEdit,
  hasActiveRun,
  className,
}: LiveDiligenceSectionProps) {
  const runGraph = useRunGraph(entitySlug);
  const { openWithContext } = useFastAgent();

  const openRuntimeDrawer = () => {
    const runIsLive = hasActiveRun ?? runGraph.isActive;
    openWithContext({
      initialTab: runIsLive ? "flow" : "scratchpad",
      contextEntitySlug: entitySlug,
      contextTitle: `${entitySlug} runtime`,
    });
  };

  return (
    <div className={cn(className)}>
      <NotebookTopStatusRow
        entitySlug={entitySlug}
        expanded={false}
        onToggle={openRuntimeDrawer}
      />
    </div>
  );
});

LiveDiligenceSection.displayName = "LiveDiligenceSection";
