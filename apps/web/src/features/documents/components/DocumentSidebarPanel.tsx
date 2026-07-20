import React, { memo, useCallback, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SidebarMiniCalendar } from "@shared/ui/SidebarMiniCalendar";
import { SidebarUpcoming } from "@shared/ui/SidebarUpcoming";
import type { Id } from "../../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DocumentSidebarPanelProps {
  /** Whether the calendar card is hidden (e.g. in timeline view). */
  hideCalendarCard: boolean;
  /** Planner upcoming data fed into SidebarUpcoming. */
  upcoming: any;
  /** Active workspace day used to keep the mini calendar month in sync. */
  anchorDateMs?: number;
  /** Callback when user selects a date on the mini-calendar (week view). */
  onViewWeek: (dateMs: number) => void;
  /** Callback when user clicks a specific day on the mini-calendar. */
  onViewDay: (dateMs: number) => void;
  /** Callback when a document is selected in the upcoming widget. */
  onOpenDocument: (documentId: Id<"documents">) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Right sidebar panel for DocumentsHomeHub containing the mini-calendar
 * and upcoming tasks/events widgets. Memoized to avoid re-renders when
 * the document grid state changes.
 */
export const DocumentSidebarPanel = memo(function DocumentSidebarPanel({
  hideCalendarCard,
  upcoming,
  anchorDateMs,
  onViewWeek,
  onViewDay,
  onOpenDocument,
}: DocumentSidebarPanelProps) {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem("unifiedSidebar.open") || "true");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("unifiedSidebar.open", JSON.stringify(sidebarOpen));
    } catch {
      // noop
    }
  }, [sidebarOpen]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSelectDate = useCallback((dateMs: number) => {
    onViewWeek(dateMs);
  }, [onViewWeek]);

  return (
    <aside
      className={`${sidebarOpen ? "w-full 2xl:w-[320px] 2xl:md:w-[360px] p-3" : "w-full h-[18px] 2xl:w-[18px] 2xl:h-auto p-0"} shrink-0 border-t 2xl:border-t-0 2xl:border-l border-edge bg-surface relative transition-all duration-300`}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        className="absolute left-3 -top-2 2xl:left-auto 2xl:-left-2 2xl:top-3 w-6 h-4 2xl:w-4 2xl:h-6 rounded-sm border border-edge bg-surface text-content-secondary hover:bg-surface-hover flex items-center justify-center shadow-sm"
      >
        {sidebarOpen ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </button>
      {sidebarOpen && (
        <div className="space-y-4">
          {/* Widget 1: Mini Month Calendar */}
          {!hideCalendarCard && (
            <SidebarMiniCalendar
              anchorDateMs={anchorDateMs}
              onSelectDate={handleSelectDate}
              onViewDay={onViewDay}
              onViewWeek={onViewWeek}
              showViewFullCalendarLink
            />
          )}

          {/* Widget 2: Upcoming (Tasks & Events) */}
          <SidebarUpcoming
            upcoming={upcoming}
            onOpenDocument={onOpenDocument}
          />
        </div>
      )}
    </aside>
  );
});

export default DocumentSidebarPanel;
