// src/components/FastAgentPanel/FastAgentPanel.GoalCard.tsx
// Goal card showing high-level task overview and progress

import React from 'react';
import { Target, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TaskStatus = 'queued' | 'active' | 'success' | 'failed';

export interface TaskStatusItem {
  id: string;
  name: string;
  status: TaskStatus;
}

interface GoalCardProps {
  goal: string;
  tasks: TaskStatusItem[];
  elapsedSeconds?: number;
  apiCallsUsed?: number;
  apiCallsTotal?: number;
  isStreaming?: boolean;
}

/**
 * GoalCard - High-level overview of the agent's current goal and task progress
 * Provides visual status indicators for all parallel tasks at a glance
 */
export function GoalCard({
  goal,
  tasks,
  elapsedSeconds,
  apiCallsUsed,
  apiCallsTotal,
  isStreaming = false,
}: GoalCardProps) {
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const activeCount = tasks.filter(t => t.status === 'active').length;
  const queuedCount = tasks.filter(t => t.status === 'queued').length;

  const getStatusSummary = () => {
    const parts: string[] = [];
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (successCount > 0) parts.push(`${successCount} complete`);
    if (activeCount > 0) parts.push(`${activeCount} active`);
    if (queuedCount > 0) parts.push(`${queuedCount} queued`);
    return parts.join(', ');
  };

  return (
    <div className="mb-4 p-4 border border-edge rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isStreaming ? "bg-violet-500 motion-safe:animate-pulse" : "bg-violet-600"
        )}>
          <Target className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-content mb-1">
            🎯 Goal
          </h3>
          <p className="text-sm text-content leading-relaxed">{goal}</p>
        </div>
      </div>

      {/* Task Status Boxes */}
      {tasks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-edge">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-content-secondary">Tasks:</span>
            {tasks.map((task, idx) => (
              <div
                key={task.id || idx}
                className={cn(
                  "group relative w-6 h-6 rounded flex items-center justify-center text-xs font-bold transition-all",
                  "cursor-default",
                  task.status === 'failed' && "bg-red-500 text-white",
                  task.status === 'success' && "bg-green-500 text-white",
                  task.status === 'active' && "bg-yellow-500 text-content motion-safe:animate-pulse",
                  task.status === 'queued' && "bg-[var(--border-color)] text-content-secondary opacity-50"
                )}
                title={`${task.name}: ${task.status}`}
              >
                {task.status === 'failed' && '❌'}
                {task.status === 'success' && '✅'}
                {task.status === 'active' && '⏳'}
                {task.status === 'queued' && '⏸️'}
                
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 whitespace-nowrap">
                  <div className="bg-surface text-content text-xs px-2 py-1 rounded shadow-lg">
                    {task.name}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Stats */}
            <div className="flex items-center gap-3 ml-2 text-xs text-content-secondary">
              {elapsedSeconds !== undefined && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{elapsedSeconds.toFixed(1)}s</span>
                </div>
              )}
              {apiCallsUsed !== undefined && apiCallsTotal !== undefined && (
                <div className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span>{apiCallsUsed}/{apiCallsTotal} calls</span>
                </div>
              )}
            </div>
          </div>

          {/* Status summary text */}
          {getStatusSummary() && (
            <p className="text-xs text-content-secondary mt-2">
              Status: {getStatusSummary()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
