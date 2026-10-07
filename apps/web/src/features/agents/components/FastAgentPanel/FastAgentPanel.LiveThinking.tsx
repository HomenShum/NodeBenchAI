/**
 * LiveThinking Component
 * 
 * Displays real-time thinking steps, tool calls, and sources during agent execution.
 * This is a lightweight component for FastAgentPanel to show streaming agent progress.
 */

import React from 'react';
import { Brain, Wrench, FileText, Loader2, Sparkles } from 'lucide-react';
import type { ThinkingStep, ToolCall, Source } from './types';
import { cn } from '@/lib/utils';

interface LiveThinkingProps {
  thinkingSteps?: ThinkingStep[];
  toolCalls?: ToolCall[];
  sources?: Source[];
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export function LiveThinking({
  thinkingSteps = [],
  toolCalls = [],
  sources = [],
  isStreaming = false,
}: LiveThinkingProps) {
  const hasContent = thinkingSteps.length > 0 || toolCalls.length > 0 || sources.length > 0;

  if (!isStreaming && !hasContent) {
    return null;
  }

  // Determine the most recent activity to show
  let activeIcon = <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin text-purple-500" />;
  let activeText = "Processing...";
  let activeType: 'thinking' | 'tool' | 'source' | 'idle' = 'idle';

  // Check sources first (usually last step of research)
  if (sources.length > 0) {
    const lastSource = sources[sources.length - 1];
    activeIcon = <FileText className="h-3.5 w-3.5 text-violet-500" />;
    activeText = `Found source: ${lastSource.title}`;
    activeType = 'source';
  }

  // Check tool calls (usually intermediate)
  if (toolCalls.length > 0) {
    const lastTool = toolCalls[toolCalls.length - 1];
    if (lastTool.status === 'running') {
      activeIcon = <Wrench className="h-3.5 w-3.5 motion-safe:animate-pulse text-orange-500" />;
      activeText = `Using tool: ${lastTool.toolName}...`;
      activeType = 'tool';
    }
  }

  // Check thinking steps (usually continuous)
  if (thinkingSteps.length > 0) {
    const lastStep = thinkingSteps[thinkingSteps.length - 1];
    // If we have a very recent thinking step, it might be the most relevant
    // But usually we prefer showing active tools if they are running
    if (activeType !== 'tool') {
      activeIcon = <Brain className="h-3.5 w-3.5 motion-safe:animate-pulse text-purple-500" />;
      activeText = lastStep.type || "Reasoning...";
      activeType = 'thinking';
    }
  }

  // If just streaming but no specific data yet
  if (isStreaming && !hasContent) {
    activeIcon = <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse text-purple-500" />;
    activeText = "Agent is starting...";
  }

  // If finished streaming and has content, show "Completed" briefly or hide?
  // The parent component usually handles hiding this when done, but let's be safe
  if (!isStreaming && hasContent) {
    return null;
  }

  return (
    <div className="mt-4 flex justify-center">
      <div className={cn(
        "inline-flex items-center gap-2.5 px-4 py-2 rounded-full",
        "bg-surface-secondary border border-edge shadow-sm",
        "text-xs font-medium text-content-secondary",
        "animate-in fade-in slide-in-from-bottom-2 duration-300"
      )}>
        {activeIcon}
        <span className="max-w-[200px] truncate">{activeText}</span>
        {isStreaming && (
          <div className="flex gap-0.5 ml-1">
            <span className="w-1 h-1 bg-content-muted rounded-full typing-dot [animation-delay:-0.3s]"></span>
            <span className="w-1 h-1 bg-content-muted rounded-full typing-dot [animation-delay:-0.15s]"></span>
            <span className="w-1 h-1 bg-content-muted rounded-full typing-dot"></span>
          </div>
        )}
      </div>
    </div>
  );
}
