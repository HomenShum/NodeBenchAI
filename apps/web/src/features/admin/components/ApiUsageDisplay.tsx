// src/components/ApiUsageDisplay.tsx
// Display API usage statistics for the current user

import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Activity, TrendingUp, DollarSign, AlertCircle } from 'lucide-react';

export function ApiUsageDisplay() {
  const usageSummary = useQuery(api.domains.billing.apiUsageTracking.getUserApiUsageSummary);

  if (!usageSummary) {
    return (
      <div className="p-4 border border-edge rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-5 w-5 text-content-secondary" />
          <h3 className="font-semibold">API Usage</h3>
        </div>
        <p className="text-sm text-content-secondary">Loading usage data...</p>
      </div>
    );
  }

  const { byApi, summary } = usageSummary;
  const apiNames = Object.keys(byApi);

  // Calculate costs
  const totalCostDollars = (summary.totalCost / 100).toFixed(2);

  return (
    <div className="p-4 border border-edge rounded-lg space-y-4 bg-surface shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        <h3 className="font-semibold text-lg text-content">Usage</h3>
      </div>

      {/* Overall Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
          <div className="text-xs text-content-secondary mb-1">Today</div>
          <div className="text-2xl font-bold text-content">
            {summary.todayTotalCalls}
          </div>
          <div className="text-xs text-content-muted">requests</div>
        </div>

        <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
          <div className="text-xs text-content-secondary mb-1">This Month</div>
          <div className="text-2xl font-bold text-content">
            {summary.monthTotalCalls}
          </div>
          <div className="text-xs text-content-muted">requests</div>
        </div>

        <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
          <div className="text-xs text-content-secondary mb-1">All Time</div>
          <div className="text-2xl font-bold text-content">
            {summary.totalCalls}
          </div>
          <div className="text-xs text-content-muted">requests</div>
        </div>
      </div>

      {/* Success Rate */}
      {summary.totalCalls > 0 && (
        <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-content-secondary">Success Rate</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {parseFloat(((summary.successfulCalls / summary.totalCalls) * 100).toFixed(1))}%
            </span>
          </div>
          <div className="mt-2 h-2 bg-surface/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/80"
              style={{ width: `${(summary.successfulCalls / summary.totalCalls) * 100}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-content-muted">
            {summary.successfulCalls} successful, {summary.failedCalls} failed
          </div>
        </div>
      )}

      {/* Estimated Cost */}
      {summary.totalCost > 0 && (
        <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-content-secondary">Estimated Cost</span>
          </div>
          <div className="text-2xl font-bold text-content mt-1">
            ${totalCostDollars}
          </div>
          <div className="text-xs text-content-muted mt-1">
            Based on API pricing estimates
          </div>
        </div>
      )}

      {/* Per-API Breakdown */}
      {apiNames.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-content-secondary mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            API Breakdown
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {apiNames.map((apiName) => {
              const apiData = byApi[apiName];
              const successRate = apiData.totalCalls > 0
                ? ((apiData.successfulCalls / apiData.totalCalls) * 100).toFixed(0)
                : 0;

              return (
                <div key={apiName} className="p-3 border border-edge rounded-lg bg-surface-secondary/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${apiName === 'linkup' ? 'bg-blue-500' :
                        apiName === 'youtube' ? 'bg-red-500' :
                          apiName === 'openai' ? 'bg-indigo-600' :
                            'bg-content-muted'
                        }`} />
                      <span className="text-sm font-semibold capitalize text-content">{apiName}</span>
                    </div>
                    <span className="text-xs font-medium text-content-muted">
                      {apiData.totalCalls} calls
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px] sm:text-xs">
                    <div>
                      <div className="text-content-muted tracking-tight">Today</div>
                      <div className="font-bold text-content">{apiData.todayCalls}</div>
                    </div>
                    <div>
                      <div className="text-content-muted tracking-tight">Month</div>
                      <div className="font-bold text-content">{apiData.monthCalls}</div>
                    </div>
                    <div>
                      <div className="text-content-muted tracking-tight">Success</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">{successRate}%</div>
                    </div>
                  </div>

                  {apiData.totalUnitsUsed > 0 && (
                    <div className="mt-2 pt-2 border-t border-edge/50 text-[10px] text-content-muted flex items-center justify-between">
                      <span>{apiData.totalUnitsUsed} units</span>
                      {apiData.totalCost > 0 && <span>• ${(apiData.totalCost / 100).toFixed(2)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Info Note */}
      <div className="flex items-start gap-2 p-3 bg-indigo-500/10 rounded-lg border border-indigo-500/30 opacity-80 shadow-sm">
        <AlertCircle className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <div className="font-bold text-content mb-1">Usage Tracking</div>
          <div className="text-content-secondary space-y-0.5">
            <div>• <strong>Linkup:</strong> Web search (~€0.005 per search)</div>
            <div>• <strong>YouTube:</strong> Video search (10K free units/day)</div>
            <div>• <strong>OpenAI:</strong> GPT-5 token-based pricing</div>
            <div className="mt-2 pt-1 border-t border-edge/30 text-[10px] text-content-muted italic">
              Pricing updated March 2026. Actual costs may vary.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
