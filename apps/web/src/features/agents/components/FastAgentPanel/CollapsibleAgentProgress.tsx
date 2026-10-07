// src/components/FastAgentPanel/CollapsibleAgentProgress.tsx
// Collapsible section for agent progress details (tools, reasoning, etc.)

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Zap } from 'lucide-react';
import {
  Reasoning,
  ReasoningContent,
} from '@/components/ai-elements/reasoning';
import {
  Task,
  TaskContent,
  TaskTrigger,
} from '@/components/ai-elements/task';
import {
  Tool,
  ToolContent,
} from '@/components/ai-elements/tool';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/utils';
import { StepTimeline, toolPartsToTimelineSteps } from './StepTimeline';
import type { ToolUIPart } from 'ai';
import type { CompanyOption } from './CompanySelectionCard';
import type { PersonOption } from './PeopleSelectionCard';
import type { EventOption } from './EventSelectionCard';
import type { NewsArticleOption } from './NewsSelectionCard';

interface CollapsibleAgentProgressProps {
  toolParts: ToolUIPart[];
  reasoning?: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
}

/**
 * CollapsibleAgentProgress - Wraps agent process details in an expandable section
 *
 * This component separates the "polished answer" from the "agent process" for better UX.
 * Users see a clean answer by default, with the option to expand and view detailed agent steps.
 */
export function CollapsibleAgentProgress({
  toolParts,
  reasoning,
  isStreaming,
  defaultExpanded = false,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
}: CollapsibleAgentProgressProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const reducedMotion = useReducedMotion();

  // Don't render if there's no process to show
  const hasContent = toolParts.length > 0 || reasoning;
  if (!hasContent) return null;

  const stepCount = toolParts.length;

  return (
    <Task
      className="mb-3"
      defaultOpen={defaultExpanded}
      onOpenChange={setIsExpanded}
      open={isExpanded}
    >
      <TaskTrigger title={isStreaming ? 'Agent Working...' : 'Agent Progress'}>
        <button
          type="button"
          className={cn(
            'group flex w-full items-center justify-between gap-2 rounded-lg border border-edge',
            'bg-surface-secondary px-3 py-2 text-left hover:bg-surface-hover',
            'transition-colors motion-reduce:transition-none',
            reducedMotion && '!transition-none',
            isExpanded && 'bg-surface-hover'
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
                isStreaming ? 'bg-primary/10' : 'bg-muted'
              )}
            >
              {isStreaming ? (
                <Zap className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-content">
                  {isStreaming ? 'Agent Working...' : 'Agent Progress'}
                </span>
                {stepCount > 0 && (
                  <span className="text-xs text-content-secondary">
                    {stepCount} {stepCount === 1 ? 'step' : 'steps'}
                  </span>
                )}
              </div>
              {!isExpanded && (
                <p className="truncate text-xs text-content-secondary">
                  Click to view detailed agent actions and tool executions
                </p>
              )}
            </div>

            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-content-secondary transition-colors group-hover:text-content motion-reduce:transition-none" />
              ) : (
                <ChevronRight className="h-4 w-4 text-content-secondary transition-colors group-hover:text-content motion-reduce:transition-none" />
              )}
            </div>
          </div>
        </button>
      </TaskTrigger>

      <TaskContent
        className={cn(
          'mt-2 duration-200 [&>div]:mt-0 [&>div]:space-y-3 [&>div]:border-l-0 [&>div]:pl-0',
          reducedMotion && '!animate-none !transform-none !transition-none'
        )}
        data-reduced-motion={reducedMotion ? 'true' : undefined}
      >
        {reasoning && (
          <Reasoning
            className="mb-0 rounded-lg border border-edge bg-surface-secondary px-3 py-2"
            isStreaming={isStreaming}
            open
          >
            <div className="mb-1 text-xs font-medium text-content-secondary">
              Reasoning
            </div>
            <ReasoningContent
              className={cn(
                'mt-0 text-xs italic text-content-secondary',
                reducedMotion && '!animate-none !transform-none !transition-none'
              )}
              data-reduced-motion={reducedMotion ? 'true' : undefined}
            >
              {reasoning}
            </ReasoningContent>
          </Reasoning>
        )}

        {toolParts.length > 0 && (
          <Tool className="mb-0 border-0 bg-transparent" open>
            <ToolContent
              className={cn(
                'p-0',
                reducedMotion && '!animate-none !transform-none !transition-none'
              )}
              data-reduced-motion={reducedMotion ? 'true' : undefined}
            >
              <div className="rounded-lg border border-edge bg-surface p-3">
                <StepTimeline
                  steps={toolPartsToTimelineSteps(toolParts)}
                  isStreaming={isStreaming}
                  onCompanySelect={onCompanySelect}
                  onPersonSelect={onPersonSelect}
                  onEventSelect={onEventSelect}
                  onNewsSelect={onNewsSelect}
                />
              </div>
            </ToolContent>
          </Tool>
        )}
      </TaskContent>
    </Task>
  );
}
