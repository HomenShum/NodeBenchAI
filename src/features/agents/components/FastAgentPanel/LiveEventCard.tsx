// src/components/FastAgentPanel/LiveEventCard.tsx
// Disclosure card for live agent events backed by AI Elements primitives.

import type { ReactNode } from 'react';
import {
  Bot,
  Brain,
  Clock,
  Database,
  FileText,
  Globe,
  Search,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolPart,
} from '@/components/ai-elements/tool';
import { TaskItem } from '@/components/ai-elements/task';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';

export type LiveEventType =
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'agent_spawn'
  | 'agent_complete'
  | 'step_complete'
  | 'thinking'
  | 'memory_read'
  | 'memory_write';

export type LiveEventStatus = 'running' | 'success' | 'error' | 'pending';

export interface LiveEvent {
  id: string;
  type: LiveEventType;
  status: LiveEventStatus;
  title: string;
  details?: string;
  toolName?: string;
  agentName?: string;
  timestamp: number;
  duration?: number; // ms
}

type EventIconKind =
  | 'agent'
  | 'document'
  | 'memory'
  | 'search'
  | 'step'
  | 'thinking'
  | 'tool'
  | 'web';

const TOOL_STATE_BY_STATUS: Record<LiveEventStatus, ToolPart['state']> = {
  error: 'output-error',
  pending: 'input-streaming',
  running: 'input-available',
  success: 'output-available',
};

function getEventVisual(event: LiveEvent): {
  icon: ReactNode;
  kind: EventIconKind;
} {
  const iconClass = 'h-3.5 w-3.5';

  switch (event.type) {
    case 'tool_start':
    case 'tool_end':
    case 'tool_error': {
      const toolName = event.toolName?.toLowerCase() ?? '';

      if (toolName.includes('search')) {
        return { icon: <Search className={iconClass} />, kind: 'search' };
      }
      if (toolName.includes('document')) {
        return { icon: <FileText className={iconClass} />, kind: 'document' };
      }
      if (toolName.includes('memory')) {
        return { icon: <Database className={iconClass} />, kind: 'memory' };
      }
      if (toolName.includes('web') || toolName.includes('linkup')) {
        return { icon: <Globe className={iconClass} />, kind: 'web' };
      }
      return { icon: <Wrench className={iconClass} />, kind: 'tool' };
    }

    case 'agent_spawn':
    case 'agent_complete':
      return { icon: <Bot className={iconClass} />, kind: 'agent' };

    case 'thinking':
      return { icon: <Brain className={iconClass} />, kind: 'thinking' };

    case 'memory_read':
    case 'memory_write':
      return { icon: <Database className={iconClass} />, kind: 'memory' };

    case 'step_complete':
    default:
      return { icon: <Zap className={iconClass} />, kind: 'step' };
  }
}

function getStatusStyles(status: LiveEventStatus) {
  switch (status) {
    case 'running':
      return {
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        border: 'border-blue-200 dark:border-blue-800',
        dot: 'bg-violet-500',
        icon: 'text-violet-500',
      };
    case 'success':
      return {
        bg: 'bg-green-50 dark:bg-green-900/20',
        border: 'border-green-200 dark:border-green-800',
        dot: 'bg-green-500',
        icon: 'text-green-500',
      };
    case 'error':
      return {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-200 dark:border-red-800',
        dot: 'bg-red-500',
        icon: 'text-red-500',
      };
    case 'pending':
    default:
      return {
        bg: 'bg-surface-secondary dark:bg-gray-800/50',
        border: 'border-edge dark:border-edge',
        dot: 'bg-content-muted',
        icon: 'text-content-muted',
      };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface LiveEventCardProps {
  event: LiveEvent;
  showTimeline?: boolean;
  isLast?: boolean;
}

export function LiveEventCard({
  event,
  showTimeline = true,
  isLast = false,
}: LiveEventCardProps) {
  const reducedMotion = useReducedMotion();
  const styles = getStatusStyles(event.status);
  const eventVisual = getEventVisual(event);
  const toolState = TOOL_STATE_BY_STATUS[event.status];

  return (
    <div className={cn('relative', showTimeline && 'pl-6')}>
      {showTimeline && (
        <>
          {!isLast && (
            <div
              className="absolute bottom-0 left-[9px] top-5 w-0.5 bg-[var(--border-color)]"
              data-live-event-connector
            />
          )}
          <div
            className={cn(
              'absolute left-1 top-2 z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-surface',
              event.status === 'running' &&
                'border-violet-500 motion-safe:animate-pulse',
              event.status === 'success' && 'border-green-500',
              event.status === 'error' && 'border-red-500',
              event.status === 'pending' && 'border-content-muted',
              reducedMotion && '!animate-none !transition-none'
            )}
            data-live-event-dot
          >
            <div className={cn('h-1.5 w-1.5 rounded-full', styles.dot)} />
          </div>
        </>
      )}

      <Tool
        className={cn(
          'mb-2 overflow-hidden rounded-lg border transition-all duration-200 hover:shadow-sm',
          styles.bg,
          styles.border,
          event.status === 'running' &&
            'animate-in fade-in slide-in-from-left-2 duration-300',
          reducedMotion && '!animate-none !transform-none !transition-none'
        )}
        data-event-status={event.status}
        data-reduced-motion={reducedMotion ? 'true' : undefined}
        data-tool-state={toolState}
        defaultOpen
      >
        <div className="relative">
          <span
            className={cn(
              'pointer-events-none absolute left-3 top-3 z-10 flex h-4 w-4 items-center justify-center',
              styles.icon
            )}
            data-event-icon={eventVisual.kind}
          >
            {eventVisual.icon}
          </span>
          <ToolHeader
            className={cn(
              'gap-2 py-2.5 pl-9 pr-3 text-left [&>div]:min-w-0 [&>div]:flex-1 [&>div>span]:truncate [&>div>svg:first-child]:hidden',
              reducedMotion &&
                '[&_.animate-pulse]:!animate-none [&>svg]:!transition-none'
            )}
            state={toolState}
            title={event.title}
            toolName={event.toolName ?? event.type}
            type="dynamic-tool"
          />
        </div>

        {(event.toolName ||
          event.agentName ||
          (event.duration !== undefined && event.status === 'success')) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-current/10 px-3 py-1.5 text-xs text-content-secondary">
            {event.toolName && (
              <span className="truncate font-mono">{event.toolName}</span>
            )}
            {event.agentName && <span>{event.agentName}</span>}
            {event.duration !== undefined && event.status === 'success' && (
              <span className="ml-auto">{formatDuration(event.duration)}</span>
            )}
          </div>
        )}

        <ToolContent
          className={cn(
            'space-y-1 border-t border-current/10 px-3 pb-2.5 pt-2',
            reducedMotion && '!animate-none !transform-none !transition-none'
          )}
          data-reduced-motion={reducedMotion ? 'true' : undefined}
        >
          {event.details && (
            <TaskItem className="line-clamp-2 text-xs text-content-secondary">
              {event.details}
            </TaskItem>
          )}
          <TaskItem className="flex items-center gap-1 text-xs text-content-muted">
            <Clock aria-hidden="true" className="h-3 w-3" />
            {formatTimestamp(event.timestamp)}
          </TaskItem>
        </ToolContent>
      </Tool>
    </div>
  );
}

export default LiveEventCard;
