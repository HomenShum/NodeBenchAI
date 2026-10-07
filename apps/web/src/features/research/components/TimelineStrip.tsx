"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Clock, History, Zap, Telescope, ChevronLeft, ChevronRight } from "lucide-react";
import { useMotionConfig } from '@/lib/motion';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export type TemporalPhase = "past" | "present" | "future";

export interface TimelineEvent {
  /** Unique event ID */
  id: string;
  /** Event label */
  label: string;
  /** ISO timestamp or relative date string */
  date: string;
  /** Temporal phase */
  phase: TemporalPhase;
  /** Optional description */
  description?: string;
  /** Whether this is the current focus */
  isCurrent?: boolean;
  /** Optional link to section or document */
  linkTo?: string;
}

export interface TimelineStripProps {
  /** Timeline events to display */
  events: TimelineEvent[];
  /** Currently active event ID */
  activeEventId?: string;
  /** Callback when an event is clicked */
  onEventClick?: (event: TimelineEvent) => void;
  /** Optional external phase filter */
  phaseFilter?: TemporalPhase | "all";
  /** Callback when phase filter changes */
  onPhaseChange?: (phase: TemporalPhase | "all") => void;
  /** Whether the strip is sticky */
  sticky?: boolean;
  /** Custom class name */
  className?: string;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const getPhaseIcon = (phase: TemporalPhase) => {
  switch (phase) {
    case "past":
      return History;
    case "present":
      return Zap;
    case "future":
      return Telescope;
  }
};

const getPhaseColors = (phase: TemporalPhase, isActive: boolean) => {
  const baseColors = {
    past: {
      bg: isActive ? "bg-content-secondary" : "bg-surface-secondary hover:bg-surface-hover",
      text: isActive ? "text-white" : "text-content-secondary",
      border: isActive ? "border-content-secondary" : "border-edge",
      dot: "bg-content-muted",
    },
    present: {
      bg: isActive ? "bg-[var(--accent-primary)]" : "bg-surface-secondary hover:bg-surface-hover",
      text: isActive ? "text-white" : "text-content-secondary",
      border: isActive ? "border-indigo-500/40" : "border-edge",
      dot: "bg-[var(--accent-primary)]",
    },
    future: {
      bg: isActive ? "bg-content" : "bg-surface-secondary hover:bg-surface-hover",
      text: isActive ? "text-white" : "text-content",
      border: isActive ? "border-content" : "border-edge",
      dot: "bg-content",
    },
  };
  return baseColors[phase];
};

const formatDate = (dateStr: string): string => {
  // Handle relative dates
  if (dateStr.toLowerCase().includes("today")) return "Today";
  if (dateStr.toLowerCase().includes("yesterday")) return "Yesterday";
  if (dateStr.toLowerCase().includes("tomorrow")) return "Tomorrow";

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * TimelineStrip - AI-2027.com-inspired temporal context visualization
 *
 * Shows Pastâ†’Presentâ†’Future timeline with:
 * - Phase-colored event markers
 * - Active event highlighting
 * - Smooth scroll navigation
 * - Sticky positioning option
 * - Progress bar showing current position
 */
export const TimelineStrip: React.FC<TimelineStripProps> = ({
  events,
  activeEventId,
  onEventClick,
  phaseFilter,
  onPhaseChange,
  sticky = false,
  className = "",
}) => {
  const { instant, transition } = useMotionConfig();
  const [internalPhaseFilter, setInternalPhaseFilter] = useState<TemporalPhase | "all">("all");
  const activePhaseFilter = phaseFilter ?? internalPhaseFilter;
  const setPhaseFilter = (next: TemporalPhase | "all") => {
    if (onPhaseChange) {
      onPhaseChange(next);
      return;
    }
    setInternalPhaseFilter(next);
  };

  const visibleEvents = useMemo(() => {
    if (activePhaseFilter === "all") return events;
    return events.filter((event) => event.phase === activePhaseFilter);
  }, [events, activePhaseFilter]);

  // Group events by phase
  const groupedEvents = useMemo(() => {
    const groups: Record<TemporalPhase, TimelineEvent[]> = {
      past: [],
      present: [],
      future: [],
    };
    visibleEvents.forEach((event) => {
      groups[event.phase].push(event);
    });
    return groups;
  }, [visibleEvents]);

  // Calculate progress based on active event position
  const progressInfo = useMemo(() => {
    if (visibleEvents.length === 0) return { percentage: 0, phasePercentages: { past: 0, present: 0, future: 0 } };

    const fallbackIndex = Math.max(0, visibleEvents.findIndex((event) => event.phase === "present"));
    const matchedActiveIndex = activeEventId
      ? visibleEvents.findIndex((event) => event.id === activeEventId)
      : fallbackIndex;
    const activeIndex = matchedActiveIndex >= 0 ? matchedActiveIndex : fallbackIndex;

    const percentage = visibleEvents.length > 1
      ? ((activeIndex + 1) / visibleEvents.length) * 100
      : 50;

    // Calculate phase segment widths
    const total = visibleEvents.length;
    const phasePercentages = {
      past: (groupedEvents.past.length / total) * 100,
      present: (groupedEvents.present.length / total) * 100,
      future: (groupedEvents.future.length / total) * 100,
    };

    return { percentage, phasePercentages };
  }, [visibleEvents, activeEventId, groupedEvents]);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (visibleEvents.length === 0) {
    // Reserve height to prevent CLS when events load async
    return <div className="min-h-[84px]" />;
  }

  return (
    <div
      className={`
        ${sticky ? "sticky top-0 z-40" : ""}
        bg-surface/95  border-b border-edge shadow-sm
        ${className}
      `}
    >
      <div className="max-w-6xl mx-auto px-4 py-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-content-secondary" />
            <span className="text-xs font-semibold text-content-secondary tracking-wider">
              Timeline
            </span>
            <span className="text-xs text-content-secondary tracking-wider hidden sm:inline">
              {activePhaseFilter === "all" ? "Showing all phases" : `Filtered: ${activePhaseFilter}`}
            </span>
          </div>
          {/* Phase legend */}
          <div className="flex items-center gap-2 text-xs">
            {(["past", "present", "future"] as TemporalPhase[]).map((phase) => {
              const Icon = getPhaseIcon(phase);
              const colors = getPhaseColors(phase, false);
              const isActiveFilter = activePhaseFilter === phase;
              return (
                <button
                  key={phase}
                  type="button"
                  onClick={() => setPhaseFilter(activePhaseFilter === phase ? "all" : phase)}
                  aria-pressed={isActiveFilter}
                  title={`Filter to ${phase} events`}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full border transition-colors ${
                    isActiveFilter ? "border-edge bg-surface-secondary" : "border-transparent hover:border-edge"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                  <Icon className={`w-3 h-3 ${colors.text}`} />
                  <span className={`capitalize ${colors.text}`}>{phase}</span>
                </button>
              );
            })}
            {activePhaseFilter !== "all" && (
              <button
                type="button"
                onClick={() => setPhaseFilter("all")}
                className="text-xs text-content-secondary hover:text-content"
                title="Show all phases"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-1.5 bg-surface-secondary rounded-full mb-3 overflow-hidden">
          {/* Phase segments */}
          <div className="absolute inset-0 flex">
            <div
              className="h-full bg-surface-secondary"
              style={{ width: `${progressInfo.phasePercentages.past}%` }}
            />
            <div
              className="h-full bg-indigo-500/10"
              style={{ width: `${progressInfo.phasePercentages.present}%` }}
            />
            <div
              className="h-full bg-surface-hover"
              style={{ width: `${progressInfo.phasePercentages.future}%` }}
            />
          </div>
          {/* Progress indicator â€” skip animation on mount to avoid initial jank */}
          <motion.div
            className="absolute top-0 left-0 h-full bg-[var(--accent-primary)] rounded-full"
            initial={false}
            animate={{ width: `${progressInfo.percentage}%` }}
            transition={transition({ duration: 0.3, ease: "easeOut" })}
          />
          {/* Current position marker */}
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-surface border-2 border-indigo-500/30 rounded-full shadow-sm"
            initial={false}
            animate={{ left: `calc(${progressInfo.percentage}% - 6px)` }}
            transition={transition({ duration: 0.3, ease: "easeOut" })}
          />
        </div>

        {/* Timeline */}
        <div className="relative flex items-center">
          {/* Left scroll button */}
          <button
            type="button"
            onClick={() => scroll("left")}
            className="flex-shrink-0 p-1 rounded-full hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Scrollable timeline */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none]"
          >
            <div className="flex items-center gap-1 min-w-max px-2">
              {/* Past section */}
              {groupedEvents.past.length > 0 && (
                <div className="flex items-center gap-1">
                  {groupedEvents.past.map((event) => (
                    <TimelineEventChip
                      key={event.id}
                      event={event}
                      isActive={event.id === activeEventId}
                      onClick={onEventClick}
                    />
                  ))}
                  <div className="w-px h-6 bg-surface-secondary mx-2" />
                </div>
              )}

              {/* Present section */}
              {groupedEvents.present.length > 0 && (
                <div className="flex items-center gap-1">
                  {groupedEvents.present.map((event) => (
                    <TimelineEventChip
                      key={event.id}
                      event={event}
                      isActive={event.id === activeEventId}
                      onClick={onEventClick}
                    />
                  ))}
                  <div className="w-px h-6 bg-surface-secondary mx-2" />
                </div>
              )}

              {/* Future section */}
              {groupedEvents.future.length > 0 && (
                <div className="flex items-center gap-1">
                  {groupedEvents.future.map((event) => (
                    <TimelineEventChip
                      key={event.id}
                      event={event}
                      isActive={event.id === activeEventId}
                      onClick={onEventClick}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right scroll button */}
          <button
            type="button"
            onClick={() => scroll("right")}
            className="flex-shrink-0 p-1 rounded-full hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUB-COMPONENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface TimelineEventChipProps {
  event: TimelineEvent;
  isActive: boolean;
  onClick?: (event: TimelineEvent) => void;
}

const TimelineEventChip: React.FC<TimelineEventChipProps> = ({
  event,
  isActive,
  onClick,
}) => {
  const { instant } = useMotionConfig();
  const colors = getPhaseColors(event.phase, isActive);
  const Icon = getPhaseIcon(event.phase);

  return (
    <motion.button
      onClick={() => onClick?.(event)}
      aria-pressed={isActive}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-full
        border transition-all duration-200
        ${colors.bg} ${colors.text} ${colors.border}
        ${isActive ? "shadow-sm ring-2 ring-indigo-500/30" : ""}
        focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring
      `}
      whileHover={!instant ? { scale: 1.02 } : undefined}
      whileTap={!instant ? { scale: 0.98 } : undefined}
      title={event.description}
    >
      <Icon className="w-3 h-3" />
      <span className="text-xs font-medium whitespace-nowrap max-w-[120px] truncate">
        {event.label}
      </span>
      <span className="text-xs opacity-70 whitespace-nowrap">
        {formatDate(event.date)}
      </span>
      {event.isCurrent && (
        <span className="w-1.5 h-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      )}
    </motion.button>
  );
};

export default TimelineStrip;
