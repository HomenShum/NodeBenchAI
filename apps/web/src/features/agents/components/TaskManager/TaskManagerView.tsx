/**
 * TaskManagerView - Main view for browsing and viewing task sessions
 * 
 * Features:
 * - Session list with filters
 * - Date navigation
 * - Status and type filtering
 * - Detail panel for selected session
 * - Support for public (unauthenticated) and private (authenticated) views
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { useConvexAuth } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { 
  Calendar,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Bot,
  Timer,
  Users,
  ListTodo,
  X,
  RefreshCw,
  Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskSessionCard } from './TaskSessionCard';
import { TaskSessionDetail } from './TaskSessionDetail';
import type { TaskSession, TaskSessionStatus, TaskSessionType, TaskFilters } from './types';
import type { Id } from '../../../../../convex/_generated/dataModel';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FILTER OPTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const statusOptions: { value: TaskSessionStatus | 'all'; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Status', icon: <ListTodo className="w-3.5 h-3.5" /> },
  { value: 'running', label: 'Running', icon: <Loader2 className="w-3.5 h-3.5" /> },
  { value: 'completed', label: 'Completed', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { value: 'failed', label: 'Failed', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  { value: 'pending', label: 'Pending', icon: <Clock className="w-3.5 h-3.5" /> },
];

const typeOptions: { value: TaskSessionType | 'all'; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Types', icon: <ListTodo className="w-3.5 h-3.5" /> },
  { value: 'agent', label: 'Agent', icon: <Bot className="w-3.5 h-3.5" /> },
  { value: 'cron', label: 'Cron', icon: <Timer className="w-3.5 h-3.5" /> },
  { value: 'swarm', label: 'Swarm', icon: <Users className="w-3.5 h-3.5" /> },
  { value: 'scheduled', label: 'Scheduled', icon: <Calendar className="w-3.5 h-3.5" /> },
];

const dateRangeOptions = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPER FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function getDateRange(range: string): { from: number | undefined; to: number | undefined } {
  const now = new Date();
  switch (range) {
    case 'today':
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: startOfDay.getTime(), to: undefined };
    case 'week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return { from: startOfWeek.getTime(), to: undefined };
    case 'month':
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfMonth.getTime(), to: undefined };
    default:
      return { from: undefined, to: undefined };
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface TaskManagerViewProps {
  /** Show public sessions (for unauthenticated users) */
  isPublic?: boolean;
  className?: string;
}

export function TaskManagerView({ isPublic = false, className }: TaskManagerViewProps) {
  // Check authentication - use public query for unauthenticated users
  const { isAuthenticated } = useConvexAuth();
  const effectiveIsPublic = isPublic || !isAuthenticated;
  
  // State
  const [selectedSessionId, setSelectedSessionId] = useState<Id<"agentTaskSessions"> | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskSessionStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<TaskSessionType | 'all'>('all');
  const [dateRange, setDateRange] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Calculate date range
  const { from: dateFrom, to: dateTo } = useMemo(() => getDateRange(dateRange), [dateRange]);

  // Build query args
  const queryArgs = useMemo(() => ({
    limit: 100,
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
    dateFrom,
    dateTo,
  }), [statusFilter, typeFilter, dateFrom, dateTo]);

  // Fetch sessions - use public or authenticated query based on auth status
  const publicSessions = useQuery(
    api.domains.taskManager.queries.getPublicTaskSessions,
    effectiveIsPublic ? queryArgs : 'skip'
  );

  const userSessions = useQuery(
    api.domains.taskManager.queries.getUserTaskSessions,
    !effectiveIsPublic ? queryArgs : 'skip'
  );

  const sessionsData = effectiveIsPublic ? publicSessions : userSessions;
  const sessions = (sessionsData?.sessions || []) as TaskSession[];
  const isLoading = sessionsData === undefined;

  // Stats
  const stats = useMemo(() => {
    const running = sessions.filter(s => s.status === 'running').length;
    const completed = sessions.filter(s => s.status === 'completed').length;
    const failed = sessions.filter(s => s.status === 'failed').length;
    return { running, completed, failed, total: sessions.length };
  }, [sessions]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || dateRange !== 'all';

  const clearFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setDateRange('all');
  };

  // If a session is selected, show detail view
  if (selectedSessionId) {
    return (
      <div className={cn("h-full", className)}>
        <TaskSessionDetail
          sessionId={selectedSessionId}
          onBack={() => setSelectedSessionId(null)}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-surface", className)}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-edge">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isPublic ? null : (
              <Lock className="w-5 h-5 text-primary" />
            )}
            <h1 className="text-lg font-semibold text-content">
              {isPublic ? 'Sessions' : 'Task Manager'}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              showFilters || hasActiveFilters
                ? "bg-primary text-primary-foreground"
                : "bg-surface-secondary text-content-secondary border border-edge hover:text-content hover:border-primary/25"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
            )}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center rounded-full border border-edge bg-surface-secondary px-2.5 py-1 text-content-muted">
            {stats.total} {stats.total === 1 ? 'session' : 'sessions'}
          </span>
          {stats.running > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-primary">
              <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
              {stats.running} running
            </span>
          )}
          {stats.completed > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              {stats.completed} completed
            </span>
          )}
          {stats.failed > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />
              {stats.failed} failed
            </span>
          )}
          {stats.failed > 0 && (statusFilter as string) !== 'failed' && (
            <button
              type="button"
              onClick={() => setStatusFilter('failed' as any)}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/12 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/18 dark:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-1"
              aria-pressed={(statusFilter as string) === 'failed'}
              title="Show only failed sessions"
            >
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-current/50 bg-current/8">
                <div className="h-1.5 w-1.5 rounded-[2px] bg-current" />
              </div>
              Show failed
            </button>
          )}
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="flex-shrink-0 p-3 border-b border-edge bg-surface-secondary">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Status filter */}
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskSessionStatus | 'all')}
              className="px-2 py-1 text-xs rounded border border-edge bg-surface text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Type filter */}
            <select
              aria-label="Filter by type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TaskSessionType | 'all')}
              className="px-2 py-1 text-xs rounded border border-edge bg-surface text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              {typeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Date range */}
            <select
              aria-label="Filter by date range"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-edge bg-surface text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              {dateRangeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Session list */}
      <div className="relative flex-1 min-h-0">
        <div className="nb-scroll-region px-4 pt-4">
        {isLoading ? (
          <div className="space-y-2 motion-safe:animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-surface-secondary/50" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <Bot className="w-10 h-10 text-primary" />
            </div>
            <p className="text-base font-semibold text-content mb-2">
              {hasActiveFilters ? 'No sessions match your filters' : isPublic ? 'No public activity yet' : 'No task sessions yet'}
            </p>
            <p className="text-sm text-content-secondary max-w-sm">
              {hasActiveFilters
                ? "Try clearing the filters - active sessions appear here as agents run research pipelines and workflows."
                : isPublic
                  ? "Public AI sessions - automated research pipelines, scheduled tasks, and multi-agent workflows - appear here as they run."
                  : "Start an agent task to see it here."
              }
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 mt-3 px-3 py-1.5 text-xs font-medium text-primary hover:bg-surface-hover rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <TaskSessionCard
                key={session._id}
                session={session}
                isSelected={selectedSessionId === session._id}
                onClick={() => setSelectedSessionId(session._id)}
              />
            ))}

            {sessionsData?.hasMore && (
              <div className="text-center py-4">
                <span className="text-xs text-content-muted">
                  Showing {sessions.length} sessions. More available.
                </span>
              </div>
            )}
          </div>
        )}
        </div>
        {sessions.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface via-surface/90 to-transparent" />
        )}
      </div>
    </div>
  );
}

export default TaskManagerView;
