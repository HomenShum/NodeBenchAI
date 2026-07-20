/**
 * Agent Marketplace Component
 * Ranked agent discovery using Phoenix ML
 */

import React, { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Zap, TrendingUp, CheckCircle, Clock, Play } from "lucide-react";

export function AgentMarketplace() {
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  const rankedAgents = useQuery(api.domains.agents.agentMarketplace.getRankedAgents, {
    category: selectedCategory,
    limit: 20,
  });
  const fallbackAgents = useQuery(api.domains.agents.agentMarketplace.getRankedAgents, {
    category: undefined,
    limit: 6,
  });

  const categories = ["research", "synthesis", "publishing", "validation", "agentLoop"];
  const showingFallbackAgents =
    !!selectedCategory &&
    Array.isArray(rankedAgents) &&
    rankedAgents.length === 0 &&
    Array.isArray(fallbackAgents) &&
    fallbackAgents.length > 0;
  const displayedAgents = showingFallbackAgents ? fallbackAgents : rankedAgents;

  if (!rankedAgents || !fallbackAgents) {
    return (
      <div className="p-6 text-center text-content-secondary">
        Loading agent marketplace...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content flex items-center gap-2">
          <Zap className="w-6 h-6" />
          Automations
        </h1>
        <p className="text-sm text-content-secondary mt-1">
          Discover top-performing agents ranked by success rate and usage
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setSelectedCategory(undefined)}
          className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            selectedCategory === undefined
              ? "bg-[var(--accent-primary)] text-white shadow-sm"
              : "bg-surface text-content-secondary border border-edge hover:bg-surface-hover hover:text-content"
          }`}
        >
          All Categories
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setSelectedCategory(category)}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150 capitalize active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selectedCategory === category
                ? "bg-[var(--accent-primary)] text-white shadow-sm"
                : "bg-surface text-content-secondary border border-edge hover:bg-surface-hover hover:text-content"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Agent List */}
      {displayedAgents.length === 0 ? (
        <div className="p-6 text-center text-content-secondary">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No ranked workflows are available yet.</p>
          {selectedCategory ? (
            <p className="mt-2 text-xs text-content-muted">
              Try another category or return to All Categories while ranking data catches up.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {showingFallbackAgents ? (
            <div className="rounded-lg border border-edge bg-surface-secondary/60 px-4 py-3 text-sm text-content-secondary">
              No dedicated workflows are ranked under <span className="font-semibold text-content capitalize">{selectedCategory}</span> yet.
              Showing the strongest automations instead.
            </div>
          ) : null}
          {displayedAgents.map((agent: any, index: number) => (
            <AgentCard key={agent._id} agent={agent} rank={index + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface AgentCardProps {
  agent: any;
  rank: number;
}

function AgentCard({ agent, rank }: AgentCardProps) {
  const getRankColor = (rank: number) => {
    if (rank === 1) return "text-yellow-500";
    if (rank === 2) return "text-content-muted";
    if (rank === 3) return "text-orange-600";
    return "text-content-secondary";
  };

  return (
    <div className="bg-surface rounded-lg p-5 border border-edge shadow-sm hover:shadow-md transition-shadow duration-200 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${getRankColor(rank)} w-8`}>
            #{rank}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-content capitalize tracking-tight">
              {agent.agentType} Agent
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-semibold border border-green-500/20" title="Phoenix Score: composite of success rate, usage, and latency">
          <TrendingUp className="w-4 h-4" />
          {agent.phoenixScore}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-surface-secondary rounded-md p-3 border border-edge/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[11px] font-medium text-content-muted">Success Rate</span>
          </div>
          <div className="text-lg font-semibold text-content">
            {Math.round(agent.successRate * 100)}%
          </div>
        </div>

        <div className="bg-surface-secondary rounded-md p-3 border border-edge/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Play className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-medium text-content-muted">Total Runs</span>
          </div>
          <div className="text-lg font-semibold text-content">
            {agent.usageCount.toLocaleString()}
          </div>
        </div>

        <div className="bg-surface-secondary rounded-md p-3 border border-edge/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Clock className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-[11px] font-medium text-content-muted">Avg Latency</span>
          </div>
          <div className="text-lg font-semibold text-content">
            {(agent.avgLatencyMs / 1000).toFixed(1)}s
          </div>
        </div>

        <div className="bg-surface-secondary rounded-md p-3 border border-edge/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-medium text-content-muted" title="Composite ranking: success rate + usage + speed">Overall Score</span>
          </div>
          <div className="text-lg font-semibold text-content">
            {agent.phoenixScore}
          </div>
        </div>
      </div>

      {/* Multi-Action Prediction — removed: speculative percentages confused users */}
    </div>
  );
}
