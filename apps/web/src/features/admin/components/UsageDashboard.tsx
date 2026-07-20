/**
 * Usage Dashboard Component
 * Displays LLM usage, limits, and cost tracking for the user
 */

import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Zap, DollarSign, MessageSquare, Clock, TrendingUp, AlertTriangle } from "lucide-react";

interface UsageData {
  requestsToday: number;
  tokensToday: number;
  costToday: number;
  requestsLimit: number;
  tokensLimit: number;
  costLimit: number;
}

interface UsageDashboardProps {
  className?: string;
  compact?: boolean;
}

// Progress bar component
const ProgressBar: React.FC<{
  value: number;
  max: number;
  label: string;
  icon: React.ReactNode;
  color: string;
  format?: (value: number) => string;
}> = ({ value, max, label, icon, color, format }) => {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const isUnlimited = max < 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-content-secondary">
          {icon}
          <span className="font-medium">{label}</span>
        </div>
        <span className={`text-xs font-medium ${isAtLimit ? 'text-red-600 dark:text-red-400' : isNearLimit ? 'text-amber-600 dark:text-amber-400' : 'text-content-secondary'}`}>
          {format ? format(value) : value.toLocaleString()}
          {!isUnlimited && ` / ${format ? format(max) : max.toLocaleString()}`}
          {isUnlimited && " (Unlimited)"}
        </span>
      </div>
      <div className="h-2 bg-surface-secondary dark:bg-white/[0.08] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-amber-500' : color
          }`}
          style={{ width: isUnlimited ? '10%' : `${percentage}%` }}
        />
      </div>
    </div>
  );
};

// Stat card component
const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  className?: string;
}> = ({ label, value, icon, trend, className = "" }) => (
  <div className={`bg-surface rounded-lg border border-edge p-4 ${className}`}>
    <div className="flex items-start justify-between">
      <div className="p-2 bg-surface-secondary rounded-lg">{icon}</div>
      {trend !== undefined && (
        <div className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
          <TrendingUp className={`h-3 w-3 ${trend < 0 ? 'rotate-180' : ''}`} />
          {Math.abs(trend)}%
        </div>
      )}
    </div>
    <div className="mt-3">
      <p className="text-2xl font-bold text-content">{value}</p>
      <p className="text-xs text-content-secondary mt-0.5">{label}</p>
    </div>
  </div>
);

export const UsageDashboard: React.FC<UsageDashboardProps> = ({
  className = "",
  compact = false,
}) => {
  // Try to fetch usage data from Convex (optional - may not be set up)
  const rawUsageData = useQuery(
    (api.domains?.billing?.rateLimiting?.getCurrentUsage ?? null) as any
  );
  
  // Transform the data structure if available
  const usageData: UsageData | null = rawUsageData ? {
    requestsToday: rawUsageData.usage?.requests ?? 0,
    tokensToday: rawUsageData.usage?.tokens ?? 0,
    costToday: rawUsageData.usage?.cost ?? 0,
    requestsLimit: rawUsageData.limits?.requestsPerDay ?? 25,
    tokensLimit: rawUsageData.limits?.tokensPerDay ?? 100000,
    costLimit: rawUsageData.limits?.costLimitPerDay ?? 0.50,
  } : null;

  // Default/mock data if query not available
  const data: UsageData = useMemo(() => usageData ?? {
    requestsToday: 0,
    tokensToday: 0,
    costToday: 0,
    requestsLimit: 25,
    tokensLimit: 100000,
    costLimit: 0.50,
  }, [usageData]);

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens.toString();
  };

  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;

  if (compact) {
    const percentage = data.requestsLimit > 0 
      ? Math.round((data.requestsToday / data.requestsLimit) * 100)
      : 0;
    const isNearLimit = percentage >= 80;

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-lg ${className}`}>
        <Zap className={`h-4 w-4 ${isNearLimit ? 'text-amber-500' : 'text-content-muted'}`} />
        <span className="text-xs text-content-secondary">
          <span className="font-medium">{data.requestsToday}</span>
          <span className="text-content-muted">/{data.requestsLimit > 0 ? data.requestsLimit : '∞'}</span>
        </span>
        {isNearLimit && (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">Usage Dashboard</h3>
          <p className="text-sm text-content-secondary">Today's LLM usage and limits</p>
        </div>
        <div className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 rounded-full text-xs font-medium">
          Free Tier
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Requests Today"
          value={data.requestsToday}
          icon={<MessageSquare className="h-5 w-5 text-indigo-500" />}
        />
        <StatCard
          label="Tokens Used"
          value={formatTokens(data.tokensToday)}
          icon={<Zap className="h-5 w-5 text-amber-500" />}
        />
        <StatCard
          label="Cost Today"
          value={formatCost(data.costToday)}
          icon={<DollarSign className="h-5 w-5 text-indigo-500" />}
        />
        <StatCard
          label="Avg Response"
          value="1.2s"
          icon={<Clock className="h-5 w-5 text-blue-500" />}
        />
      </div>

      {/* Progress Bars */}
      <div className="bg-surface rounded-lg border border-edge p-4 space-y-4">
        <h4 className="text-sm font-medium text-content">Daily Limits</h4>
        
        <ProgressBar
          value={data.requestsToday}
          max={data.requestsLimit}
          label="Requests"
          icon={<MessageSquare className="h-4 w-4" />}
          color="bg-indigo-500"
        />
        
        <ProgressBar
          value={data.tokensToday}
          max={data.tokensLimit}
          label="Tokens"
          icon={<Zap className="h-4 w-4" />}
          color="bg-amber-500"
          format={formatTokens}
        />
        
        <ProgressBar
          value={data.costToday}
          max={data.costLimit}
          label="Cost"
          icon={<DollarSign className="h-4 w-4" />}
          color="bg-indigo-500"
          format={formatCost}
        />
      </div>

      {/* Upgrade CTA */}
      {data.requestsToday >= data.requestsLimit * 0.8 && (
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg p-4 text-white">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Running low on requests?</h4>
              <p className="text-sm text-white/80 mt-0.5">
                Upgrade to Pro for 500 requests/day, all models, and priority support.
              </p>
            </div>
            <button className="px-4 py-2 bg-white dark:bg-white/90 text-indigo-600 font-medium text-sm rounded-lg hover:bg-white/90 dark:hover:bg-white transition-colors">
              Upgrade
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsageDashboard;
