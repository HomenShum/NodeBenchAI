import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  FileText,
  CheckSquare,
  Calendar,
  Sparkles,
  Activity,
  Clock,
} from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useTimeContext } from '../../../hooks/useTimeContext';
import { useMotionConfig } from '@/lib/motion';

interface PersonalDashboardProps {
  className?: string;
  onNavigate?: (path: string) => void;
}

interface StatCardProps {
  label: string;
  value: number | string;
  icon: typeof FileText;
  trend?: number;
  color: string;
  onClick?: () => void;
}

const StatCard = React.memo(function StatCard({ label, value, icon: Icon, trend, color, onClick }: StatCardProps) {
  const { instant } = useMotionConfig();
  return (
    <motion.button
      onClick={onClick}
      className={`p-4 rounded-lg border ${color} text-left transition-all`}
      whileHover={!instant ? { scale: 1.02 } : undefined}
      whileTap={!instant ? { scale: 0.98 } : undefined}
    >
      <div className="flex items-start justify-between mb-2">
        <Icon className="h-5 w-5 opacity-70" />
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-0.5 text-xs ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </motion.button>
  );
});

export function PersonalDashboard({ className = '', onNavigate }: PersonalDashboardProps) {
  const { instant, transition } = useMotionConfig();
  const timeContext = useTimeContext();

  // Fetch user stats - reduced limits since we only need counts
  const tasks = useQuery(api.domains.tasks.tasks.listTasks, { limit: 50 });
  const documents = useQuery(api.domains.documents.documents.listDocuments, { limit: 20 });
  const events = useQuery(api.domains.calendar.events.listEvents, { limit: 20 });
  const behaviorSummary = useQuery(api.domains.recommendations.behaviorTracking.getBehaviorSummary);

  const stats = useMemo(() => {
    const completedTasks = tasks?.filter((t) => t.status === 'completed').length ?? 0;
    const pendingTasks = tasks?.filter((t) => t.status === 'pending').length ?? 0;
    const totalDocs = documents?.length ?? 0;
    const upcomingEvents = events?.length ?? 0;
    const totalActivity = behaviorSummary?.totalEvents ?? 0;

    return {
      completedTasks,
      pendingTasks,
      totalDocs,
      upcomingEvents,
      totalActivity,
      productivityScore: pendingTasks + completedTasks > 0
        ? Math.round((completedTasks / (pendingTasks + completedTasks)) * 100)
        : 0,
    };
  }, [tasks, documents, events, behaviorSummary]);

  return (
    <div className={`bg-surface rounded-lg border border-edge p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-purple-600" />
          <h2 className="text-lg font-semibold text-content">Your Dashboard</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <Clock className="h-3 w-3" />
          <span>{timeContext.greeting}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Tasks Completed"
          value={stats.completedTasks}
          icon={CheckSquare}
          color="bg-green-50 border-green-200 text-green-800"
          onClick={() => onNavigate?.('/tasks')}
        />
        <StatCard
          label="Pending Tasks"
          value={stats.pendingTasks}
          icon={CheckSquare}
          color="bg-amber-50 border-amber-200 text-amber-800"
          onClick={() => onNavigate?.('/tasks')}
        />
        <StatCard
          label="Documents"
          value={stats.totalDocs}
          icon={FileText}
          color="bg-blue-50 border-blue-200 text-blue-800"
          onClick={() => onNavigate?.('/documents')}
        />
        <StatCard
          label="Upcoming Events"
          value={stats.upcomingEvents}
          icon={Calendar}
          color="bg-purple-50 border-purple-200 text-purple-800"
          onClick={() => onNavigate?.('/calendar')}
        />
      </div>

      {/* Productivity Score */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-medium text-content">Productivity Score</span>
          </div>
          <span className="text-2xl font-bold text-purple-700">{stats.productivityScore}%</span>
        </div>
        <div className="w-full h-2 bg-surface/50 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
            initial={{ width: instant ? `${stats.productivityScore}%` : 0 }}
            animate={{ width: `${stats.productivityScore}%` }}
            transition={transition({ duration: 0.8, ease: 'easeOut' })}
          />
        </div>
        <p className="text-xs text-content-secondary mt-2">
          Based on {stats.completedTasks + stats.pendingTasks} total tasks this week
        </p>
      </div>
    </div>
  );
}

export default PersonalDashboard;

