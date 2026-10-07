/**
 * TelemetrySpanTree - Hierarchical span visualization
 * 
 * Features:
 * - Parent-child hierarchy with indentation
 * - Span type icons and colors
 * - Duration and status indicators
 * - Expandable/collapsible nodes
 */

import React, { useState } from 'react';
import { 
  ChevronRight, 
  ChevronDown,
  Bot,
  Cpu,
  Wrench,
  Shield,
  ArrowRightLeft,
  Search,
  GitBranch,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskSpan, SpanType, SpanStatus } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// SPAN TYPE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const spanTypeConfig: Record<SpanType, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  agent: {
    icon: <Bot className="w-3 h-3" />,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    label: 'Agent'
  },
  generation: {
    icon: <Sparkles className="w-3 h-3" />,
    color: 'text-content-secondary',
    bgColor: 'bg-surface-secondary',
    label: 'Generation'
  },
  tool: {
    icon: <Wrench className="w-3 h-3" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    label: 'Tool'
  },
  guardrail: {
    icon: <Shield className="w-3 h-3" />,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Guardrail'
  },
  handoff: {
    icon: <ArrowRightLeft className="w-3 h-3" />,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    label: 'Handoff'
  },
  retrieval: {
    icon: <Search className="w-3 h-3" />,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    label: 'Retrieval'
  },
  delegation: {
    icon: <GitBranch className="w-3 h-3" />,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    label: 'Delegation'
  },
  custom: {
    icon: <Cpu className="w-3 h-3" />,
    color: 'text-content-secondary',
    bgColor: 'bg-surface-secondary',
    label: 'Custom'
  },
};

const spanStatusConfig: Record<SpanStatus, { icon: React.ReactNode; color: string }> = {
  running: { icon: <Loader2 className="w-3 h-3 motion-safe:animate-spin" />, color: 'text-indigo-600 dark:text-indigo-400' },
  completed: { icon: <CheckCircle2 className="w-3 h-3" />, color: 'text-emerald-600 dark:text-emerald-400' },
  error: { icon: <AlertCircle className="w-3 h-3" />, color: 'text-red-500' },
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPAN NODE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface SpanNodeProps {
  span: TaskSpan;
  children?: TaskSpan[];
  childrenByParent: Record<string, TaskSpan[]>;
  defaultExpanded?: boolean;
}

function SpanNode({ span, childrenByParent, defaultExpanded = true }: SpanNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const typeCfg = spanTypeConfig[span.spanType];
  const statusCfg = spanStatusConfig[span.status];
  const children = childrenByParent[span._id as string] || [];
  const hasChildren = children.length > 0;

  return (
    <div className="relative">
      {/* Span row */}
      <div 
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md",
          "hover:bg-surface-secondary transition-colors",
          hasChildren && "cursor-pointer"
        )}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
        style={{ marginLeft: `${span.depth * 16}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          isExpanded 
            ? <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
            : <ChevronRight className="w-3.5 h-3.5 text-content-muted" />
        ) : (
          <div className="w-3.5 h-3.5" /> // Spacer
        )}

        {/* Span type icon */}
        <span className={cn("flex items-center justify-center w-5 h-5 rounded", typeCfg.bgColor, typeCfg.color)}>
          {typeCfg.icon}
        </span>

        {/* Name */}
        <span className="flex-1 text-xs font-medium text-content truncate">
          {span.name}
        </span>

        {/* Duration */}
        {span.durationMs !== undefined && (
          <span className="text-xs text-content-muted tabular-nums">
            {formatDuration(span.durationMs)}
          </span>
        )}

        {/* Status */}
        <span className={statusCfg.color}>{statusCfg.icon}</span>
      </div>

      {/* Error message */}
      {span.error && (
        <div
          className="ml-8 mt-1 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
          style={{ marginLeft: `${span.depth * 16 + 32}px` }}
        >
          <p className="text-xs text-red-600 dark:text-red-400">
            {span.error.message}
          </p>
        </div>
      )}

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="border-l border-edge" style={{ marginLeft: `${span.depth * 16 + 12}px` }}>
          {children.map((child) => (
            <SpanNode
              key={child._id}
              span={child}
              childrenByParent={childrenByParent}
              defaultExpanded={child.depth < 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface TelemetrySpanTreeProps {
  spans: TaskSpan[];
  rootSpans: TaskSpan[];
  childrenByParent: Record<string, TaskSpan[]>;
  className?: string;
}

export function TelemetrySpanTree({ spans, rootSpans, childrenByParent, className }: TelemetrySpanTreeProps) {
  if (spans.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
        <Cpu className="w-8 h-8 text-content-muted mb-2" />
        <p className="text-sm text-content-secondary">No actions recorded</p>
        <p className="text-xs text-content-muted mt-1">
          Actions will appear here as the agent executes
        </p>
      </div>
    );
  }

  // Summary stats
  const completedSpans = spans.filter(s => s.status === 'completed').length;
  const errorSpans = spans.filter(s => s.status === 'error').length;
  const totalDuration = spans.reduce((acc, s) => acc + (s.durationMs || 0), 0);

  return (
    <div className={className}>
      {/* Summary header */}
      <div className="flex items-center gap-3 mb-3 px-2 py-1.5 bg-surface-secondary rounded-md">
        <span className="text-xs text-content font-medium">
          {spans.length} actions tracked
        </span>
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          {completedSpans} completed
        </span>
        {errorSpans > 0 && (
          <span className="text-xs text-red-600">
            {errorSpans} errors
          </span>
        )}
        <span className="text-xs text-content-muted ml-auto">
          Total: {formatDuration(totalDuration)}
        </span>
      </div>

      {/* Span tree */}
      <div className="space-y-0.5">
        {rootSpans.map((span) => (
          <SpanNode
            key={span._id}
            span={span}
            childrenByParent={childrenByParent}
            defaultExpanded={true}
          />
        ))}
      </div>
    </div>
  );
}

export default TelemetrySpanTree;


