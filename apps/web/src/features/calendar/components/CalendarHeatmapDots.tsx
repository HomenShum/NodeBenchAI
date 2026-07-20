/**
 * CalendarHeatmapDots - Color-coded dot indicators for calendar dates
 * 
 * Dot meanings:
 * - Red dot: Hard deadlines / Earnings calls / High priority
 * - Accent dot: Regular events, tasks, notes/files, holidays
 */

import React from "react";
import { cn } from "@/lib/utils";

export interface HeatmapMarkers {
  events: number;
  tasks: number;
  notes: number;
  holidays: number;
  files: number;
  hasDeadline: boolean;
  hasEarnings: boolean;
  maxPriority: number; // 0-4 scale
}

export interface CalendarHeatmapDotsProps {
  markers: HeatmapMarkers;
  size?: "sm" | "md" | "lg";
  variant?: "dots" | "pills";
  className?: string;
}

const DOT_SIZES = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-2.5 h-2.5",
};

const PILL_SIZES = {
  sm: "h-1 min-w-[4px]",
  md: "h-1.5 min-w-[6px]",
  lg: "h-2 min-w-[8px]",
};

/**
 * Compact dot-based heatmap indicator
 */
export function CalendarHeatmapDots({
  markers,
  size = "sm",
  variant = "dots",
  className,
}: CalendarHeatmapDotsProps) {
  const { events, tasks, notes, holidays, files, hasDeadline, hasEarnings, maxPriority } = markers;
  
  const hasAny = events > 0 || tasks > 0 || notes > 0 || holidays > 0 || files > 0;
  
  if (!hasAny) return null;

  const dotSize = DOT_SIZES[size];
  const pillSize = PILL_SIZES[size];

  // Priority ring color based on max priority
  const getPriorityClass = () => {
    if (hasDeadline || hasEarnings || maxPriority >= 4) return "ring-red-500";
    if (maxPriority >= 1) return "ring-[var(--accent-primary)]/50";
    return "";
  };

  if (variant === "pills") {
    return (
      <div className={cn("flex items-center gap-0.5", className)}>
        {/* Red pill for deadlines/earnings */}
        {(hasDeadline || hasEarnings || maxPriority >= 4) && (
          <div className={cn(pillSize, "rounded-full bg-red-500")} 
               style={{ width: Math.min((events || 1) * 4, 16) }} 
               title={`${events} high-priority events`} />
        )}
        {/* Accent pill for events */}
        {events > 0 && !hasDeadline && !hasEarnings && maxPriority < 4 && (
          <div className={cn(pillSize, "rounded-full bg-[var(--accent-primary)]")} 
               style={{ width: Math.min(events * 4, 16) }}
               title={`${events} events`} />
        )}
        {/* Accent pill for tasks */}
        {tasks > 0 && (
          <div className={cn(pillSize, "rounded-full bg-[var(--accent-primary)]/80")} 
               style={{ width: Math.min(tasks * 4, 16) }}
               title={`${tasks} tasks`} />
        )}
        {/* Accent pill for files/notes */}
        {(notes > 0 || files > 0) && (
          <div className={cn(pillSize, "rounded-full bg-[var(--accent-primary)]/70")} 
               style={{ width: Math.min((notes + files) * 4, 16) }}
               title={`${notes + files} notes/files`} />
        )}
        {/* Accent pill for holidays */}
        {holidays > 0 && (
          <div className={cn(pillSize, "rounded-full bg-[var(--accent-primary)]/60")} 
               style={{ width: 8 }}
               title={`${holidays} holidays`} />
        )}
      </div>
    );
  }

  // Dot variant (default)
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {/* Red dot for deadlines/earnings/high priority */}
      {(hasDeadline || hasEarnings || maxPriority >= 4) && (
        <span className={cn(dotSize, "rounded-full bg-red-500 ring-1 ring-red-300")} 
              title="High priority / Deadline" />
      )}
      {/* Accent dot for regular events */}
      {events > 0 && !hasDeadline && !hasEarnings && maxPriority < 4 && (
        <span className={cn(dotSize, "rounded-full bg-[var(--accent-primary)]")} 
              title={`${events} events`} />
      )}
      {/* Accent dot for tasks */}
      {tasks > 0 && (
        <span className={cn(dotSize, "rounded-full bg-[var(--accent-primary)]/80")} 
              title={`${tasks} tasks`} />
      )}
      {/* Accent dot for notes/files */}
      {(notes > 0 || files > 0) && (
        <span className={cn(dotSize, "rounded-full bg-[var(--accent-primary)]/70")} 
              title={`${notes + files} notes/files`} />
      )}
      {/* Accent dot for holidays */}
      {holidays > 0 && (
        <span className={cn(dotSize, "rounded-full bg-[var(--accent-primary)]/60")} 
              title={`${holidays} holidays`} />
      )}
    </div>
  );
}

/**
 * Priority ring wrapper for calendar day cells
 * Wraps the day number with a colored ring based on priority
 */
export function PriorityRing({
  maxPriority,
  hasDeadline,
  hasEarnings,
  children,
  className,
}: {
  maxPriority: number;
  hasDeadline?: boolean;
  hasEarnings?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const getPriorityRing = () => {
    if (hasDeadline || hasEarnings || maxPriority >= 4) return "ring-2 ring-red-500/60";
    if (maxPriority >= 1) return "ring-2 ring-[var(--accent-primary)]/60";
    return "";
  };

  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg", getPriorityRing(), className)}>
      {children}
    </span>
  );
}

export default CalendarHeatmapDots;

