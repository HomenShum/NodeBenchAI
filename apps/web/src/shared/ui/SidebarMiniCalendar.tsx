import React from "react";
import { MiniMonthCalendar } from "@/features/calendar/components/MiniMonthCalendar";

export interface SidebarMiniCalendarProps {
  anchorDateMs?: number;
  onSelectDate?: (ms: number) => void;
  onViewDay?: (ms: number) => void;
  onViewWeek?: (ms: number) => void;
  showViewFullCalendarLink?: boolean;
}

export const SidebarMiniCalendar = React.memo(function SidebarMiniCalendar({
  anchorDateMs,
  onSelectDate,
  onViewDay,
  onViewWeek,
  showViewFullCalendarLink,
}: SidebarMiniCalendarProps) {
  return (
    <div>
      <div className="text-xs tracking-wide text-content-muted mb-2">Calendar</div>
      <MiniMonthCalendar
        anchorDateMs={anchorDateMs}
        onSelectDate={onSelectDate}
        onViewDay={onViewDay}
        onViewWeek={onViewWeek}
        constrainToSidebar
      />
      {showViewFullCalendarLink && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-content-muted hover:text-content underline-offset-2 hover:underline"
            onClick={() => { try { window.dispatchEvent(new CustomEvent('navigate:calendar')); } catch { /* no-op */ } }}
            aria-label="View full calendar"
          >
            View full calendar
          </button>
        </div>
      )}
    </div>
  );
});
