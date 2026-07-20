// src/components/FastAgentPanel/StepTimeline.tsx
// Timeline component for showing agent progress and tool executions

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, XCircle, Clock, Wrench, Users, FileText, BarChart3, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolUIPart } from 'ai';
import { ToolResultPopover } from './ToolResultPopover';
import type { CompanyOption } from './CompanySelectionCard';
import type { PersonOption } from './PeopleSelectionCard';
import type { EventOption } from './EventSelectionCard';
import type { NewsArticleOption } from './NewsSelectionCard';
import { extractMediaFromText, removeMediaMarkersFromText } from './utils/mediaExtractor';
import { YouTubeGallery } from './MediaGallery';
import { SourceCard } from './SourceCard';
import { ProfileCard } from './ProfileCard';
import { ResourceLinkCard, type ResourceLink } from './ResourceLinkCard';

function isResourceLinkResult(value: unknown): value is ResourceLink {
  return typeof value === 'object' && value !== null && (value as any).type === 'resource_link';
}

interface StepTimelineProps {
  steps: TimelineStep[];
  isStreaming?: boolean;
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
}

export interface TimelineStep {
  id: string;
  type: 'delegation' | 'tool' | 'result' | 'error';
  timestamp: number;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  agentRole?: 'coordinator' | 'documentAgent' | 'mediaAgent' | 'secAgent' | 'webAgent';
  toolName?: string;
  args?: any; // Tool arguments
  result?: any;
  error?: string;
  elapsedMs?: number;
}

// Agent role icons
const agentIcons = {
  coordinator: Users,
  documentAgent: FileText,
  mediaAgent: BarChart3,
  secAgent: BarChart3,
  webAgent: Globe,
};

// Status icons
const statusIcons = {
  pending: Clock,
  running: Loader2,
  complete: CheckCircle2,
  error: XCircle,
};

// Status colors
const statusColors = {
  pending: 'text-content-muted',
  running: 'text-violet-500',
  complete: 'text-green-500',
  error: 'text-red-500',
};

/**
 * StepTimeline - Vertical timeline showing agent progress
 * Replaces multiple "Step X" cards with a cohesive timeline view
 */
export function StepTimeline({
  steps,
  isStreaming,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
}: StepTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [selectedToolResult, setSelectedToolResult] = useState<{
    toolName: string;
    result: unknown;
    args?: unknown;
    error?: string;
  } | null>(null);

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  if (steps.length === 0) return null;

  return (
    <div className="bg-surface-secondary border border-edge rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="h-4 w-4 text-content-secondary" />
        <h3 className="text-sm font-medium text-content">Agent Progress</h3>
        {isStreaming && (
          <span className="ml-auto text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
            Processing...
          </span>
        )}
      </div>

      <div className="relative">
        {/* Timeline Line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-[var(--border-color)]"></div>

        {/* Timeline Steps */}
        <div className="space-y-3">
          {steps.map((step, idx) => {
            const isExpanded = expandedSteps.has(step.id);
            const hasDetails = step.description || step.result || step.error;
            const StatusIcon = statusIcons[step.status];
            const AgentIcon = step.agentRole ? agentIcons[step.agentRole] : Wrench;

            return (
              <div key={step.id} className="relative pl-10">
                {/* Timeline Node */}
                <div className={cn(
                  "absolute left-2 top-1 w-4 h-4 rounded-full border-2 bg-surface flex items-center justify-center",
                  step.status === 'complete' && "border-green-500",
                  step.status === 'running' && "border-violet-500",
                  step.status === 'error' && "border-red-500",
                  step.status === 'pending' && "border-edge"
                )}>
                  <StatusIcon className={cn(
                    "h-2.5 w-2.5",
                    statusColors[step.status],
                    step.status === 'running' && "motion-safe:animate-spin"
                  )} />
                </div>

                {/* Step Content */}
                <div className={cn(
                  "bg-surface border rounded-lg p-3 shadow-sm transition-all",
                  step.status === 'error' && "border-red-200 bg-red-50",
                  step.status === 'running' && "border-blue-200 bg-blue-50",
                  step.status === 'complete' && "border-green-200"
                )}>
                  {/* Step Header */}
                  <div 
                    className={cn(
                      "flex items-start gap-2",
                      hasDetails && "cursor-pointer"
                    )}
                    onClick={() => hasDetails && toggleStep(step.id)}
                  >
                    {/* Agent/Tool Icon */}
                    <div className={cn(
                      "flex-shrink-0 w-6 h-6 rounded flex items-center justify-center",
                      step.type === 'delegation' && "bg-purple-100",
                      step.type === 'tool' && "bg-blue-100",
                      step.type === 'result' && "bg-green-100",
                      step.type === 'error' && "bg-red-100"
                    )}>
                      <AgentIcon className={cn(
                        "h-3.5 w-3.5",
                        step.type === 'delegation' && "text-purple-600",
                        step.type === 'tool' && "text-blue-600",
                        step.type === 'result' && "text-green-600",
                        step.type === 'error' && "text-red-600"
                      )} />
                    </div>

                    {/* Step Title and Metadata */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-content">{step.title}</span>
                        {step.elapsedMs && (
                          <span className="text-xs text-content-secondary">
                            ({step.elapsedMs}ms)
                          </span>
                        )}
                      </div>
                      {step.toolName && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedToolResult({
                              toolName: step.toolName!,
                              result: step.result,
                              args: step.args, // Pass actual args, not description
                              error: step.error,
                            });
                          }}
                          className="text-xs text-content-secondary mt-0.5 hover:text-blue-600 transition-colors"
                          aria-label={`View ${step.toolName} result`}
                        >
                          Tool: <code className="bg-surface-hover px-1 rounded hover:bg-blue-100 cursor-pointer">{step.toolName}</code>
                        </button>
                      )}
                    </div>

                    {/* Expand/Collapse Icon */}
                    {hasDetails && (
                      <div className="flex-shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-content-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-content-muted" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && hasDetails && (
                    <div className="mt-3 pt-3 border-t border-edge space-y-2">
                      {step.description && (
                        <div className="text-xs text-content-secondary">
                          {step.description}
                        </div>
                      )}
                      {step.result && (
                        <div className="text-xs">
                          <div className="font-medium text-content mb-2">Results:</div>
                          {(() => {
                            if (isResourceLinkResult(step.result)) {
                              return <ResourceLinkCard resourceLink={step.result} variant="compact" />;
                            }
                            const resultText = typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2);
                            const media = extractMediaFromText(resultText);
                            
                            // Check if we have rich media to display
                            const hasRichMedia = media.youtubeVideos.length > 0 || 
                                                 media.webSources.length > 0 || 
                                                 media.profiles.length > 0 ||
                                                 media.images.length > 0;
                            
                            if (hasRichMedia) {
                              return (
                                <div className="space-y-3">
                                  {/* YouTube Videos */}
                                  {media.youtubeVideos.length > 0 && (
                                    <div>
                                      <div className="text-xs text-content-secondary mb-2">
                                        Found {media.youtubeVideos.length} videos:
                                      </div>
                                      <YouTubeGallery videos={media.youtubeVideos} />
                                    </div>
                                  )}

                                  {/* News/Web Sources */}
                                  {media.webSources.length > 0 && (
                                    <div>
                                      <div className="text-xs text-content-secondary mb-2">
                                        Found {media.webSources.length} articles:
                                      </div>
                                      <div className="flex gap-2 overflow-x-auto pb-2">
                                        {media.webSources.map((source, idx) => (
                                          <div key={idx} className="flex-shrink-0" style={{ width: '200px' }}>
                                            <SourceCard source={source} />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* People Profiles */}
                                  {media.profiles.length > 0 && (
                                    <div>
                                      <div className="text-xs text-content-secondary mb-2">
                                        Found {media.profiles.length} people:
                                      </div>
                                      <div className="flex gap-2 overflow-x-auto pb-2">
                                        {media.profiles.map((profile, idx) => (
                                          <div key={idx} className="flex-shrink-0" style={{ width: '200px' }}>
                                            <ProfileCard profile={profile} />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Images */}
                                  {media.images.length > 0 && (
                                    <div>
                                      <div className="text-xs text-content-secondary mb-2">
                                        Found {media.images.length} images:
                                      </div>
                                      <div className="flex gap-2 overflow-x-auto pb-2">
                                        {media.images.map((img, idx) => (
                                          <img
                                            key={idx}
                                            src={img.url}
                                            alt={img.alt || `Image ${idx + 1}`}
                                            className="h-32 w-auto rounded border border-edge"
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Text summary (with media markers removed) */}
                                  <details className="text-xs">
                                    <summary className="cursor-pointer text-content-secondary hover:text-content">
                                      View raw text
                                    </summary>
                                    <pre className="bg-surface-hover p-2 rounded text-xs overflow-x-auto mt-2">
                                      {removeMediaMarkersFromText(resultText)}
                                    </pre>
                                  </details>
                                </div>
                              );
                            }
                            
                            // No rich media, show text as before
                            return (
                              <pre className="bg-surface-hover p-2 rounded text-xs overflow-x-auto">
                                {resultText}
                              </pre>
                            );
                          })()}
                        </div>
                      )}
                      {step.error && (
                        <div className="text-xs">
                          <div className="font-medium text-red-700 mb-1">Error:</div>
                          <div className="bg-red-100 p-2 rounded text-red-600">
                            {step.error}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tool Result Popover */}
      {selectedToolResult && (
        <ToolResultPopover
          isOpen={!!selectedToolResult}
          onClose={() => setSelectedToolResult(null)}
          toolName={selectedToolResult.toolName}
          result={selectedToolResult.result}
          args={selectedToolResult.args}
          error={selectedToolResult.error}
          onCompanySelect={onCompanySelect}
          onPersonSelect={onPersonSelect}
          onEventSelect={onEventSelect}
          onNewsSelect={onNewsSelect}
        />
      )}
    </div>
  );
}

/**
 * Helper function to convert ToolUIPart array to TimelineStep array
 *
 * In AI SDK v5, tool parts use typed naming: tool-${toolName}
 * Examples: 'tool-webSearch', 'tool-secCompanySearch', 'tool-result-webSearch', 'tool-error-webSearch'
 */
export function toolPartsToTimelineSteps(toolParts: ToolUIPart[]): TimelineStep[] {
  const steps: TimelineStep[] = [];

  const inferAgentRole = (toolName: string): TimelineStep['agentRole'] | undefined => {
    const normalized = toolName.toLowerCase();
    if (normalized.includes('document')) return 'documentAgent';
    if (normalized.includes('media')) return 'mediaAgent';
    if (normalized.includes('sec')) return 'secAgent';
    if (normalized.includes('web')) return 'webAgent';
    if (normalized.includes('delegate') || normalized.includes('coordinate')) return 'coordinator';
    return undefined;
  };

  toolParts.forEach((part, idx) => {
    // Extract tool name from type field (e.g., 'tool-webSearch' -> 'webSearch')
    // Handle all variants: tool-call, tool-result-${toolName}, tool-error-${toolName}
    let toolName = 'Unknown Tool';

    if (part.type.startsWith('tool-')) {
      // Remove 'tool-' prefix
      const remainder = part.type.slice(5);

      // Check if it's a result or error type
      if (remainder.startsWith('result-')) {
        toolName = remainder.slice(7); // Remove 'result-'
      } else if (remainder.startsWith('error-')) {
        toolName = remainder.slice(6); // Remove 'error-'
      } else if (remainder === 'call') {
        // For tool-call, try to get toolName from part properties
        toolName = (part as any).toolName || 'Unknown Tool';
      } else {
        // Direct tool name (e.g., 'tool-webSearch')
        toolName = remainder;
      }
    }

    const args = (part as any).args;
    const result = (part as any).result || (part as any).output; // Try both 'result' and 'output'
    const error = (part as any).error;


    // Determine status based on part type
    let status: TimelineStep['status'] = 'pending';
    if (part.type.startsWith('tool-result')) status = 'complete';
    else if (part.type.startsWith('tool-error')) status = 'error';
    else if (part.type === 'tool-call' || part.type.startsWith('tool-')) status = 'running';

    // Determine step type
    let type: TimelineStep['type'] = 'tool';
    if (toolName.startsWith('delegateTo')) type = 'delegation';
    else if (part.type.startsWith('tool-result')) type = 'result';
    else if (part.type.startsWith('tool-error')) type = 'error';

    // Create step
    steps.push({
      id: `step-${idx}`,
      type,
      timestamp: Date.now(),
      title: toolName.replace(/([A-Z])/g, ' $1').trim(),
      description: args ? `Arguments: ${JSON.stringify(args)}` : undefined,
      status,
      toolName,
      agentRole: inferAgentRole(toolName),
      args, // Store args separately for popover
      result,
      error,
    });
  });

  return steps;
}
