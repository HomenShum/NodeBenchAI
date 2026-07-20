/**
 * Personal Analytics Dashboard
 * Shows user productivity insights, activity patterns, and usage statistics
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  Clock,
  FileText,
  CheckSquare,
  Calendar,
  Sparkles,
  Activity,
  Target,
  Flame,
} from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { staggerContainerVariants, staggerItemVariants } from '../../../utils/animations';
import { useMotionConfig } from '@/lib/motion';

interface PersonalAnalyticsProps {
  className?: string;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: typeof FileText;
  trend?: { value: number; label: string };
  color: string;
}

function StatCard({ label, value, icon: Icon, trend, color }: StatCardProps) {
  return (
    <motion.div
      variants={staggerItemVariants}
      className={`p-4 rounded-lg border ${color}`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className="h-5 w-5 opacity-70" />
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${trend.value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            <TrendingUp className={`h-3 w-3 ${trend.value < 0 ? 'rotate-180' : ''}`} />
            <span>{Math.abs(trend.value)}%</span>
          </div>
        )}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </motion.div>
  );
}

function ActivityBar({ day, value, max, instant, transition }: { day: string; value: number; max: number; instant: boolean; transition: (d?: number | import('framer-motion').Transition) => import('framer-motion').Transition }) {
  const height = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-8 h-20 bg-surface-secondary rounded-full overflow-hidden flex items-end">
        <motion.div
          className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-full"
          initial={{ height: instant ? `${height}%` : 0 }}
          animate={{ height: `${height}%` }}
          transition={transition({ duration: 0.5, delay: 0.1 })}
        />
      </div>
      <span className="text-xs text-content-secondary">{day}</span>
    </div>
  );
}

export function PersonalAnalytics({ className = '' }: PersonalAnalyticsProps) {
  const { instant, transition } = useMotionConfig();
  // Fetch data
  const behaviorSummary = useQuery(api.domains.recommendations.behaviorTracking.getBehaviorSummary);
  const tasks = useQuery(api.domains.tasks.tasks.listTasks, { limit: 100 });
  const documents = useQuery(api.domains.documents.documents.listDocuments, { limit: 100 });

  const stats = useMemo(() => {
    const completedTasks = tasks?.filter((t) => t.status === 'completed').length ?? 0;
    const totalTasks = tasks?.length ?? 0;
    const totalDocs = documents?.length ?? 0;
    const totalEvents = behaviorSummary?.totalEvents ?? 0;

    // Calculate streak (simplified - days with activity)
    const streak = Math.min(7, Math.floor(totalEvents / 5));

    // Productivity score
    const productivityScore = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

    return {
      completedTasks,
      totalTasks,
      totalDocs,
      totalEvents,
      streak,
      productivityScore,
    };
  }, [tasks, documents, behaviorSummary]);

  // Mock weekly activity data
  const weeklyActivity = [
    { day: 'Mon', value: 12 },
    { day: 'Tue', value: 8 },
    { day: 'Wed', value: 15 },
    { day: 'Thu', value: 10 },
    { day: 'Fri', value: 18 },
    { day: 'Sat', value: 5 },
    { day: 'Sun', value: 3 },
  ];
  const maxActivity = Math.max(...weeklyActivity.map((d) => d.value));

  return (
    <div className={`bg-surface rounded-lg border border-edge p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-content">Your Analytics</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <Flame className="h-4 w-4 text-orange-500" />
          <span>{stats.streak} day streak</span>
        </div>
      </div>

      {/* Stats Grid */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
        variants={instant ? undefined : staggerContainerVariants}
        initial={instant ? undefined : "hidden"}
        animate={instant ? undefined : "visible"}
      >
        <StatCard label="Tasks Done" value={stats.completedTasks} icon={CheckSquare} color="bg-green-50 border-green-200 text-green-800" trend={{ value: 12, label: 'vs last week' }} />
        <StatCard label="Documents" value={stats.totalDocs} icon={FileText} color="bg-blue-50 border-blue-200 text-blue-800" />
        <StatCard label="Activities" value={stats.totalEvents} icon={Activity} color="bg-purple-50 border-purple-200 text-purple-800" />
        <StatCard label="Focus Score" value={`${stats.productivityScore}%`} icon={Target} color="bg-amber-50 border-amber-200 text-amber-800" />
      </motion.div>

      {/* Weekly Activity Chart */}
      <div className="bg-surface-secondary rounded-lg p-4">
        <h3 className="text-sm font-medium text-content-secondary mb-4">Weekly Activity</h3>
        <div className="flex items-end justify-between gap-2">
          {weeklyActivity.map((day) => (
            <ActivityBar key={day.day} day={day.day} value={day.value} max={maxActivity} instant={instant} transition={transition} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default PersonalAnalytics;

