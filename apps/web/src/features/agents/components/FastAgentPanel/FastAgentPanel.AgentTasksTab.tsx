// src/features/agents/components/FastAgentPanel/FastAgentPanel.AgentTasksTab.tsx
// Agent Tasks tab - shows orchestration workflow tasks from deep agent runs

import React from 'react';
import { useQuery } from 'convex/react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Cpu,
  GitBranch,
  Loader2,
  Zap,
} from 'lucide-react';
import { api } from '../../../../../convex/_generated/api';
import { TokenUsageBadge } from './TokenUsageBadge';
import { cn } from '@/lib/utils';

type AgentTaskStatus = 'pending' | 'running' | 'complete' | 'paused' | 'error';
type AgentType = 'orchestrator' | 'main' | 'leaf';

interface AgentTask {
  _id: string;
  name: string;
  status: AgentTaskStatus;
  agentType: AgentType;
  progress: number;
  description?: string;
  parentId?: string;
  startedAtMs?: number;
  completedAtMs?: number;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: number;
  updatedAt: number;
}

interface AgentTasksTabProps {
  agentThreadId?: string | null;
}

const statusConfig: Record<AgentTaskStatus, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  pending: {
    icon: <Circle className="w-3.5 h-3.5" />,
    color: 'text-content-muted',
    bgColor: 'bg-surface-hover',
    label: 'Pending',
  },
  running: {
    icon: <Clock className="w-3.5 h-3.5 motion-safe:animate-pulse" />,
    color: 'text-violet-500',
    bgColor: 'bg-violet-100',
    label: 'Running',
  },
  complete: {
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-100',
    label: 'Complete',
  },
  paused: {
    icon: <Clock className="w-3.5 h-3.5" />,
    color: 'text-amber-500',
    bgColor: 'bg-amber-100',
    label: 'Paused',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    color: 'text-red-500',
    bgColor: 'bg-red-100',
    label: 'Error',
  },
};

const agentTypeConfig: Record<AgentType, { icon: React.ReactNode; color: string; label: string }> = {
  orchestrator: {
    icon: <GitBranch className="w-3 h-3" />,
    color: 'text-purple-600 bg-purple-100',
    label: 'Agent',
  },
  main: {
    icon: <Cpu className="w-3 h-3" />,
    color: 'text-blue-600 bg-blue-100',
    label: 'Main',
  },
  leaf: {
    icon: <Zap className="w-3 h-3" />,
    color: 'text-indigo-600 bg-indigo-100',
    label: 'Worker',
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function AgentTaskItem({ task, depth = 0 }: { task: AgentTask; depth?: number }) {
  const statusCfg = statusConfig[task.status];
  const typeCfg = agentTypeConfig[task.agentType];

  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-lg p-2 transition-colors hover:bg-surface-secondary',
        depth > 0 && 'ml-4 border-l-2 border-edge pl-3',
      )}
    >
      <div className={cn('mt-0.5', statusCfg.color)}>
        {statusCfg.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-medium',
              task.status === 'complete' ? 'text-content-secondary' : 'text-content',
            )}
          >
            {task.name}
          </span>
          <span
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
              typeCfg.color,
            )}
          >
            {typeCfg.icon}
            {typeCfg.label}
          </span>
        </div>

        {task.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-content-secondary">
            {task.description}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-3">
          {task.status === 'running' && task.progress > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-secondary">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${task.progress * 100}%` }}
                />
              </div>
              <span className="text-xs text-content-secondary">
                {Math.round(task.progress * 100)}%
              </span>
            </div>
          )}

          {task.elapsedMs && (
            <span className="text-xs text-content-muted">
              {formatDuration(task.elapsedMs)}
            </span>
          )}

          {(task.inputTokens || task.outputTokens) && (
            <TokenUsageBadge
              inputTokens={task.inputTokens || 0}
              outputTokens={task.outputTokens || 0}
              className="text-[10px]"
            />
          )}
        </div>
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-content-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

export function AgentTasksTab({ agentThreadId }: AgentTasksTabProps) {
  const agentTasks = useQuery(
    api.domains.agents.agentTimelines.listAgentTasksByThread,
    agentThreadId ? { agentThreadId } : 'skip',
  );

  const tasksByStatus: Record<AgentTaskStatus, number> = agentTasks?.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, { pending: 0, running: 0, complete: 0, paused: 0, error: 0 } as Record<AgentTaskStatus, number>)
    || { pending: 0, running: 0, complete: 0, paused: 0, error: 0 };

  const totalTasks = agentTasks?.length || 0;
  const completedTasks = tasksByStatus.complete;
  const runningTasks = tasksByStatus.running;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex-shrink-0 border-b border-edge p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium text-content">Agent Workflow</span>
          </div>
          {totalTasks > 0 && (
            <span className="text-xs text-content-secondary">
              {completedTasks}/{totalTasks} complete
            </span>
          )}
        </div>

        {totalTasks > 0 && (
          <div className="flex gap-2">
            {runningTasks > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                <Clock className="h-3 w-3 motion-safe:animate-pulse" />
                {runningTasks} running
              </span>
            )}
            {tasksByStatus.pending > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-content-secondary">
                {tasksByStatus.pending} pending
              </span>
            )}
            {tasksByStatus.error > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                <AlertCircle className="h-3 w-3" />
                {tasksByStatus.error} failed
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!agentThreadId ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="mb-3 h-10 w-10 text-content-muted" />
            <p className="text-sm text-content-secondary">No active thread</p>
            <p className="mt-1 text-xs text-content-muted">
              Start a Deep Agent conversation to see orchestration tasks
            </p>
          </div>
        ) : !agentTasks ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-content-muted motion-safe:animate-spin" />
          </div>
        ) : agentTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <GitBranch className="mb-2 h-8 w-8 text-content-muted" />
            <p className="text-sm text-content-secondary">No agent tasks yet</p>
            <p className="mt-1 text-xs text-content-muted">
              Tasks will appear here as the agent works
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {agentTasks.map((task: AgentTask) => (
              <AgentTaskItem key={task._id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentTasksTab;
