/**
 * ToolCallTransparency — Phase 3 Unified Interface Component
 *
 * Renders a visual timeline of MCP tool calls within agent messages,
 * showing tool name, timing, status, and quickRef suggestions.
 * Integrates with the existing ToolStep rendering in UIMessageBubble.
 */

import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolPart,
} from '@/components/ai-elements/tool';

interface ToolCallData {
  toolName: string;
  status: 'running' | 'success' | 'error';
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  quickRef?: {
    nextAction: string;
    nextTools: string[];
    methodology: string;
    relatedGotchas: string[];
    confidence: 'high' | 'medium' | 'low';
  };
}

interface ToolCallTransparencyProps {
  toolCalls: ToolCallData[];
  isStreaming?: boolean;
  compact?: boolean;
}

type PrimitiveToolState = ToolPart['state'];

const TOOL_STATE_BY_STATUS: Record<ToolCallData['status'], PrimitiveToolState> = {
  running: 'input-available',
  success: 'output-available',
  error: 'output-error',
};

function getToolCategory(toolName: string): string {
  if (toolName.includes('schema') || toolName.includes('index') || toolName.includes('validator') || toolName.includes('snapshot')) return 'Schema';
  if (toolName.includes('function') || toolName.includes('ref')) return 'Function';
  if (toolName.includes('deploy') || toolName.includes('env') || toolName.includes('gate')) return 'Deploy';
  if (toolName.includes('gotcha') || toolName.includes('record') || toolName.includes('rules')) return 'Learning';
  if (toolName.includes('methodology') || toolName.includes('discover') || toolName.includes('bootstrap')) return 'Meta';
  return 'Tool';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colors = {
    high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    low: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[confidence]}`}>
      {confidence}
    </span>
  );
}

function CompactStatusIcon({ state }: { state: PrimitiveToolState }) {
  if (state === 'output-available') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  }
  if (state === 'output-error') {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  return <Clock className="h-3.5 w-3.5 text-primary motion-safe:animate-spin" />;
}

function SingleToolCall({ call, compact }: { call: ToolCallData; compact?: boolean }) {
  const category = getToolCategory(call.toolName);
  const primitiveState = TOOL_STATE_BY_STATUS[call.status];
  const displayName = call.toolName.replace(/^convex_/, '').replace(/_/g, ' ');

  if (compact) {
    return (
      <Tool
        className="mb-0 inline-flex w-auto items-center gap-1.5 rounded-full border-edge bg-surface-secondary px-2 py-1 text-xs"
        data-tool-state={primitiveState}
      >
        <CompactStatusIcon state={primitiveState} />
        <span className="font-medium text-content">{displayName}</span>
        {call.durationMs !== undefined && (
          <span className="text-content-muted">{formatDuration(call.durationMs)}</span>
        )}
      </Tool>
    );
  }

  return (
    <Tool
      className="mb-0 overflow-hidden rounded-lg border-edge bg-surface shadow-sm"
      data-tool-state={primitiveState}
      defaultOpen={false}
    >
      <ToolHeader
        className="px-3 py-2 text-left transition-colors hover:bg-surface-hover motion-reduce:transition-none motion-reduce:[&_.animate-pulse]:animate-none"
        state={primitiveState}
        title={displayName}
        toolName={call.toolName}
        type="dynamic-tool"
      />

      <div className="-mt-1 flex items-center gap-2 px-3 pb-2 text-xs text-content-muted">
        <span className="rounded bg-surface-secondary px-1.5 py-0.5">{category}</span>
        {call.durationMs !== undefined && (
          <span className="flex items-center gap-0.5">
            <Clock className="h-3 w-3" />
            {formatDuration(call.durationMs)}
          </span>
        )}
      </div>

      <ToolContent className="space-y-2 border-t border-edge px-3 pb-3 pt-2">
        {call.inputSummary && (
          <div className="text-xs">
            <span className="font-medium text-content-muted">Input: </span>
            <span className="text-content-secondary">{call.inputSummary}</span>
          </div>
        )}
        {call.outputSummary && (
          <div className="text-xs">
            <span className="font-medium text-content-muted">Output: </span>
            <span className="text-content-secondary">{call.outputSummary}</span>
          </div>
        )}

        {call.quickRef && (
          <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="mb-1 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-violet-500" />
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">QuickRef</span>
              <ConfidenceBadge confidence={call.quickRef.confidence} />
            </div>
            <p className="mb-1 text-xs text-blue-800 dark:text-blue-200">
              {call.quickRef.nextAction}
            </p>
            {call.quickRef.nextTools.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <ArrowRight className="h-3 w-3 text-blue-400" />
                {call.quickRef.nextTools.map((tool) => (
                  <span key={tool} className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs text-blue-700 dark:bg-blue-800/40 dark:text-blue-300">
                    {tool}
                  </span>
                ))}
              </div>
            )}
            {call.quickRef.relatedGotchas.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <BookOpen className="h-3 w-3 text-amber-500" />
                {call.quickRef.relatedGotchas.slice(0, 3).map((gotcha) => (
                  <span key={gotcha} className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:bg-amber-800/30 dark:text-amber-300">
                    {gotcha}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

export function ToolCallTransparency({ toolCalls, compact }: ToolCallTransparencyProps) {
  const stats = useMemo(() => {
    const total = toolCalls.length;
    const errors = toolCalls.filter((toolCall) => toolCall.status === 'error').length;
    const running = toolCalls.filter((toolCall) => toolCall.status === 'running').length;
    const totalDuration = toolCalls.reduce((sum, toolCall) => sum + (toolCall.durationMs || 0), 0);
    return { total, errors, running, totalDuration };
  }, [toolCalls]);

  if (toolCalls.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {toolCalls.map((call, index) => (
          <SingleToolCall key={`${call.toolName}-${index}`} call={call} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-content-muted">
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-medium">
          {stats.total} tool call{stats.total !== 1 ? 's' : ''}
        </span>
        {stats.totalDuration > 0 && (
          <span>({formatDuration(stats.totalDuration)})</span>
        )}
        {stats.running > 0 && (
          <span className="flex items-center gap-0.5 text-primary">
            <Clock className="h-3 w-3 motion-safe:animate-spin" />
            {stats.running} running
          </span>
        )}
        {stats.errors > 0 && (
          <span className="text-red-500">{stats.errors} failed</span>
        )}
      </div>

      <div className="space-y-1.5">
        {toolCalls.map((call, index) => (
          <SingleToolCall key={`${call.toolName}-${index}`} call={call} />
        ))}
      </div>
    </div>
  );
}

export default ToolCallTransparency;
