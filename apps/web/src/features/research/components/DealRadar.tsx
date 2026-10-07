import React, { useState, useMemo } from 'react';
import { Filter, TrendingUp, Building2 } from 'lucide-react';
import { useDealData, type DealStage, type DealSector } from '../hooks/useDealData';
import { DealTable } from './DealTable';

interface DealRadarProps {
    onDealClick: (dealId: string, companyName: string) => void;
}

const STAGE_OPTIONS: Array<{ value: DealStage | 'all'; label: string }> = [
    { value: 'all', label: 'All Stages' },
    { value: 'Seed', label: 'Seed' },
    { value: 'Series A', label: 'Series A' },
    { value: 'Series B', label: 'Series B' },
    { value: 'Series C+', label: 'Series C+' },
];

const SECTOR_OPTIONS: Array<{ value: DealSector | 'all'; label: string }> = [
    { value: 'all', label: 'All Sectors' },
    { value: 'Biotech', label: 'Biotech' },
    { value: 'Fintech', label: 'Fintech' },
    { value: 'AI/ML', label: 'AI/ML' },
    { value: 'HealthTech', label: 'HealthTech' },
    { value: 'Space', label: 'Space' },
    { value: 'Other', label: 'Other' },
];

export function DealRadar({ onDealClick }: DealRadarProps) {
    const [activeTab, setActiveTab] = useState<'all' | DealStage>('all');
    const [sectorFilter, setSectorFilter] = useState<DealSector | 'all'>('all');
    const [minScore, setMinScore] = useState<number>(0);

    const filters = useMemo(() => ({
        stage: activeTab === 'all' ? undefined : activeTab,
        sector: sectorFilter === 'all' ? undefined : sectorFilter,
        minBankerScore: minScore,
    }), [activeTab, sectorFilter, minScore]);

    const { deals, stats } = useDealData(filters);

    return (
        <div className="space-y-6">
            {/* Header with Stats */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-2xl font-bold text-content italic">Deal Radar</h3>
                    <p className="text-xs text-content-secondary mt-1">
                        Recent financings matching JPM criteria • {stats.filtered} of {stats.total} deals
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="px-3 py-1.5 bg-surface-secondary border border-edge rounded">
                        <div className="text-xs font-medium text-content-secondary dark:text-content-muted">Avg Score</div>
                        <div className="text-base font-semibold text-content">{stats.avgBankerScore}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-content-muted">
                        <Building2 className="w-4 h-4" />
                        <span>Last 30 Days</span>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-2 border-b border-edge pb-3">
                {STAGE_OPTIONS.map((option) => {
                    const count = option.value === 'all' ? stats.total : stats.byStage[option.value as DealStage] || 0;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setActiveTab(option.value as typeof activeTab)}
                            className={`px-4 py-2 text-xs font-medium transition-all ${activeTab === option.value
                                    ? 'bg-gray-900 dark:bg-white/[0.15] text-white'
                                    : 'text-content-secondary hover:text-content dark:hover:text-gray-200 hover:bg-surface-hover'
                                }`}
                        >
                            {option.label}
                            <span className={`ml-2 ${activeTab === option.value ? 'text-white/50' : 'text-content-muted'}`}>
                                ({count})
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4 p-4 bg-surface-secondary border border-edge">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-content-muted" />
                    <span className="text-xs font-medium text-content-secondary">Filters</span>
                </div>

                <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value as typeof sectorFilter)}
                    aria-label="Filter by sector"
                    className="px-3 py-1.5 text-xs font-medium border border-edge bg-surface dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                    {SECTOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>

                <div className="flex items-center gap-2">
                    <label className="text-xs text-content-secondary">Min Score:</label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="10"
                        value={minScore}
                        onChange={(e) => setMinScore(Number(e.target.value))}
                        className="w-32"
                    />
                    <span className="text-xs font-mono font-semibold text-content-secondary w-8">{minScore}</span>
                </div>

                {(sectorFilter !== 'all' || minScore > 0) && (
                    <button
                        type="button"
                        onClick={() => {
                            setSectorFilter('all');
                            setMinScore(0);
                        }}
                        className="ml-auto text-xs font-medium text-content-secondary hover:text-content dark:hover:text-gray-200 transition-colors"
                    >
                        Clear Filters
                    </button>
                )}
            </div>

            {/* Deal Table */}
            <div className="border border-edge bg-surface">
                <DealTable deals={deals} onDealClick={onDealClick} />
            </div>

            {/* Footer Stats */}
            {deals.length > 0 && (
                <div className="flex items-center justify-between text-xs text-content-secondary px-4">
                    <div>
                        Showing {deals.length} deal{deals.length !== 1 ? 's' : ''}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />
                            <span>High Quality (80+)</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-blue-600" />
                            <span>Good Fit (60-79)</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-amber-500" />
                            <span>Potential (40-59)</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
