import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  Filter,
  ChevronLeft,
  ChevronRight,
  FileText,
  CheckSquare,
  Calendar,
  MessageSquare,
  Sparkles,
  X,
} from 'lucide-react';
import { useMotionConfig } from '@/lib/motion';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EventCategory = 'document' | 'task' | 'calendar' | 'agent' | 'capture';

export interface EnhancedTimelineEvent {
  id: string;
  label: string;
  date: string;
  timestamp: number;
  category: EventCategory;
  description?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface EnhancedTimelineStripProps {
  events: EnhancedTimelineEvent[];
  activeEventId?: string;
  onEventClick?: (event: EnhancedTimelineEvent) => void;
  sticky?: boolean;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const categoryConfig: Record<EventCategory, { icon: typeof FileText; color: string; label: string }> = {
  document: { icon: FileText, color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Documents' },
  task: { icon: CheckSquare, color: 'bg-green-100 text-green-700 border-green-200', label: 'Tasks' },
  calendar: { icon: Calendar, color: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Calendar' },
  agent: { icon: Sparkles, color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'AI Agent' },
  capture: { icon: MessageSquare, color: 'bg-pink-100 text-pink-700 border-pink-200', label: 'Captures' },
};

const formatEventDate = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function EnhancedTimelineStrip({
  events,
  activeEventId,
  onEventClick,
  sticky = false,
  className = '',
}: EnhancedTimelineStripProps) {
  const { instant, transition } = useMotionConfig();
  const [activeFilters, setActiveFilters] = useState<Set<EventCategory>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events;
    return events.filter((e) => activeFilters.has(e.category));
  }, [events, activeFilters]);

  const toggleFilter = useCallback((category: EventCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFilters(new Set());
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -200 : 200,
        behavior: 'smooth',
      });
    }
  };

  if (events.length === 0) return null;

  return (
    <div
      className={`${sticky ? 'sticky top-0 z-40' : ''} bg-surface/95 dark:bg-[#09090B]/95 backdrop-blur-sm border-b border-edge shadow-sm ${className}`}
    >
      <div className="max-w-6xl mx-auto px-4 py-3">
        {/* Header with filter toggle */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-content-muted" />
            <span className="text-xs font-semibold text-content-secondary">
              Activity Timeline
            </span>
            <span className="text-xs text-content-muted">({filteredEvents.length})</span>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              showFilters || activeFilters.size > 0
                ? 'bg-blue-100 text-blue-700'
                : 'text-content-secondary hover:bg-surface-hover'
            }`}
          >
            <Filter className="w-3 h-3" />
            Filter
            {activeFilters.size > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-blue-600 text-white rounded-full text-xs">
                {activeFilters.size}
              </span>
            )}
          </button>
        </div>

        {/* Filter chips */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: instant ? 'auto' : 0, opacity: instant ? 1 : 0 }}
              className="overflow-hidden mb-2"
            >
              <div className="flex items-center gap-2 flex-wrap py-2">
                {(Object.keys(categoryConfig) as EventCategory[]).map((cat) => {
                  const config = categoryConfig[cat];
                  const Icon = config.icon;
                  const isActive = activeFilters.has(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleFilter(cat)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all ${
                        isActive ? config.color : 'bg-surface-secondary text-content-secondary border-edge hover:bg-surface-hover'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {config.label}
                    </button>
                  );
                })}
                {activeFilters.size > 0 && (
                  <button onClick={clearFilters} className="text-xs text-content-muted hover:text-content-secondary flex items-center gap-1">
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timeline events */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="flex-shrink-0 p-1 rounded-full hover:bg-surface-hover text-content-muted hover:text-content-secondary transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none]"
          >
            <div className="flex items-center gap-2 min-w-max px-2 py-1">
              <AnimatePresence mode="popLayout">
                {filteredEvents.map((event) => {
                  const config = categoryConfig[event.category];
                  const Icon = config.icon;
                  const isActive = event.id === activeEventId;

                  return (
                    <motion.button
                      key={event.id}
                      layout
                      initial={{ opacity: instant ? 1 : 0, scale: instant ? 1 : 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: instant ? 1 : 0, scale: instant ? 1 : 0.8 }}
                      onClick={() => onEventClick?.(event)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border transition-all ${
                        isActive
                          ? 'bg-gray-900 text-white border-gray-900'
                          : `${config.color}`
                      }`}
                      whileHover={!instant ? { scale: 1.02 } : undefined}
                      whileTap={!instant ? { scale: 0.98 } : undefined}
                      title={event.description}
                    >
                      <Icon className="w-3 h-3" />
                      <span className="text-xs font-medium whitespace-nowrap max-w-[120px] truncate">
                        {event.label}
                      </span>
                      <span className="text-xs opacity-70 whitespace-nowrap">
                        {formatEventDate(event.timestamp)}
                      </span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
              {filteredEvents.length === 0 && (
                <span className="text-xs text-content-muted italic">No events match filters</span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => scroll('right')}
            className="flex-shrink-0 p-1 rounded-full hover:bg-surface-hover text-content-muted hover:text-content-secondary transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default EnhancedTimelineStrip;

