/**
 * Event Helper Functions
 * 
 * Utility functions for handling calendar events
 */

/**
 * Check if an event is an all-day event
 */
export const isAllDayEvent = (ev: any) => {
  if (ev?.allDay === true) return true;

  // Support both {start, end} and {startTime, endTime}
  const start = ev?.start ?? ev?.startTime;
  const end = ev?.end ?? ev?.endTime;
  if (!start || !end) return false;

  const s = new Date(start);
  const e = new Date(end);

  // Consider "all day" if duration is at least ~23 hours (00:00 -> 23:59)
  const diff = e.getTime() - s.getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours >= 23) return true;

  // Or if same calendar day spanning midnight to end-of-day
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  const isStartMidnight = s.getHours() === 0 && s.getMinutes() === 0;
  const isEndEndOfDay = e.getHours() === 23 && e.getMinutes() >= 58; // allow 23:58-23:59
  return sameDay && isStartMidnight && isEndEndOfDay;
};

/**
 * Render event time display
 */
export const renderEventTime = (e: any) => {
  if (isAllDayEvent(e)) {
    return (
      <span className="text-xs text-content-secondary">All day</span>
    );
  }

  const start = e?.start ? new Date(e.start) : null;
  const end = e?.end ? new Date(e.end) : null;

  if (!start) {
    return (
      <span className="text-xs text-content-secondary">No time</span>
    );
  }

  const formatTime = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const mm = m < 10 ? `0${m}` : m;
    return `${h12}:${mm} ${ampm}`;
  };

  const startStr = formatTime(start);
  const endStr = end ? formatTime(end) : "";

  return (
    <span className="text-xs text-content-secondary">
      {startStr}
      {endStr && ` - ${endStr}`}
    </span>
  );
};


