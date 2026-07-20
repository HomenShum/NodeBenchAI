import { useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";
import { CalendarView } from "@/features/calendar/views/CalendarView";

import { usePlannerState } from "@/hooks/usePlannerState";
import { SidebarMiniCalendar } from "@shared/ui/SidebarMiniCalendar";
import { SidebarUpcoming } from "@shared/ui/SidebarUpcoming";
import { TopDividerBar } from "@shared/ui/TopDividerBar";
import { UnifiedHubPills } from "@shared/ui/UnifiedHubPills";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";

interface CalendarHomeHubProps {
  onDocumentSelect: (documentId: Id<"documents">) => void;
  onGridModeToggle?: () => void;
}

export function CalendarHomeHub({
  onDocumentSelect,
  onGridModeToggle: _onGridModeToggle,
}: CalendarHomeHubProps) {
  // Shared planner state
  const { focusedDateMs, setFocusedDateMs, handleViewDay, handleViewWeek, handleAddTaskForDate, upcoming } = usePlannerState();


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

  // If this sidebar is rendered as an overlay (absolute/fixed), publish its width so timeline can pad-left
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sidebarRef.current;
    const update = () => {
      if (!el) return;
      const cs = window.getComputedStyle(el);
      const pos = cs.position;
      const isOverlay = pos === 'absolute' || pos === 'fixed';
      const w = Math.ceil(el.getBoundingClientRect().width);
      try {
        document.documentElement.style.setProperty('--left-overlay-padding', isOverlay && w > 0 ? `${w}px` : '0px');
      } catch {
        // Style property setting failed
      }
    };
    update();
    let ro: ResizeObserver | null = null;
    try {
      if (typeof ResizeObserver !== 'undefined' && el) {
        ro = new ResizeObserver(() => update());
        ro.observe(el);
      }
    } catch {
      // ResizeObserver not available
    }
    window.addEventListener('resize', update);
    return () => {
      try {
        document.documentElement.style.setProperty('--left-overlay-padding', '0px');
      } catch {
        // Cleanup style setting failed
      }
      window.removeEventListener('resize', update);
      if (ro) {
        try {
          ro.disconnect();
        } catch {
          // ResizeObserver disconnect failed
        }
      }
    };
  }, [sidebarOpen]);


  return (
    <div className="nb-page-shell">

      <div className="nb-page-inner">
        <div className="nb-page-frame flex gap-8">
          <div className="flex-1 min-w-0">
            <TopDividerBar
              left={
                <UnifiedHubPills active="calendar" showRoadmap roadmapDisabled={false} />
              }
            />

            <CalendarView
              focusedDateMs={focusedDateMs}
              onSelectDate={setFocusedDateMs}
              onViewDay={handleViewDay}
              onViewWeek={handleViewWeek}
              onQuickAddTask={handleAddTaskForDate}
            />
          </div>
          <aside ref={sidebarRef} className={`${sidebarOpen ? "w-[320px] md:w-[360px] p-4" : "w-[18px] p-0"} shrink-0 border-l border-edge bg-surface relative z-sidebar hidden lg:block`}>
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="absolute -left-2 top-3 w-4 h-6 rounded-sm border border-edge bg-surface text-content-secondary hover:bg-surface-hover flex items-center justify-center shadow-sm"
            >
              {sidebarOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
            {sidebarOpen && (
              <div className="space-y-6">
                <SidebarMiniCalendar
                  onSelectDate={(ms) => handleViewWeek(ms)}
                  onViewDay={(ms) => handleViewDay(ms)}
                  onViewWeek={(ms) => handleViewWeek(ms)}
                  showViewFullCalendarLink
                />
                <SidebarUpcoming upcoming={upcoming} onOpenDocument={onDocumentSelect} />
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
