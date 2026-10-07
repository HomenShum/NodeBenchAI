import React from 'react';
import { ArrowUpRight, TrendingUp } from 'lucide-react';
import type { Deal } from '../hooks/useDealData';

interface DealTableProps {
    deals: Deal[];
    onDealClick: (dealId: string, companyName: string) => void;
}

const SECTOR_COLORS: Record<string, string> = {
    'Biotech': 'bg-purple-100 text-purple-900 border-purple-200',
    'Fintech': 'bg-blue-100 text-blue-900 border-blue-200',
    'AI/ML': 'bg-indigo-100 text-content border-indigo-200',
    'HealthTech': 'bg-rose-100 text-rose-900 border-rose-200',
    'Space': 'bg-indigo-100 text-indigo-900 border-indigo-200',
    'Other': 'bg-surface-secondary text-content-secondary border-edge',
};

const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-content-secondary font-bold';
    if (score >= 60) return 'text-blue-700 font-semibold';
    if (score >= 40) return 'text-amber-700';
    return 'text-content-secondary';
};

const formatAmount = (amount: number, currency: string): string => {
    const symbol = currency === 'EUR' ? '€' : '$';
    return `${symbol}${amount}M`;
};

const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function DealTable({ deals, onDealClick }: DealTableProps) {
    if (deals.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="text-content-muted text-sm mb-2">No deals match your current filters</div>
                <div className="text-gray-300 text-xs">Try adjusting your filter criteria</div>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse">
                <thead>
                    <tr className="border-b border-edge">
                        <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Company</th>
                        <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Sector</th>
                        <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Stage</th>
                        <th className="text-right py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Amount</th>
                        <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Lead</th>
                        <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">Date</th>
                        <th className="text-center py-3 px-4 text-xs font-bold uppercase tracking-wider text-content-muted">
                            <div className="flex items-center justify-center gap-1">
                                <TrendingUp className="w-3 h-3" />
                                <span>Score</span>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {deals.map((deal) => {
                        const sectorColor = SECTOR_COLORS[deal.sector] || SECTOR_COLORS.Other;
                        const scoreColor = getScoreColor(deal.bankerScore);

                        return (
                            <tr
                                key={deal.id}
                                onClick={() => onDealClick(deal.id, deal.companyName)}
                                className="border-b border-edge hover:bg-surface-hover cursor-pointer transition-colors group"
                            >
                                <td className="py-4 px-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-content group-hover:text-content transition-colors">
                                            {deal.companyName}
                                        </span>
                                        <ArrowUpRight className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <div className="text-xs text-content-muted mt-0.5">{deal.hqLocation}</div>
                                </td>
                                <td className="py-4 px-4">
                                    <span className={`inline-block px-2 py-0.5 text-xs font-bold tracking-tight border ${sectorColor}`}>
                                        {deal.sector}
                                    </span>
                                </td>
                                <td className="py-4 px-4">
                                    <span className="text-xs font-medium text-content-secondary">{deal.stage}</span>
                                </td>
                                <td className="py-4 px-4 text-right">
                                    <span className="text-sm font-bold text-content font-mono">
                                        {formatAmount(deal.amount, deal.currency)}
                                    </span>
                                </td>
                                <td className="py-4 px-4">
                                    <span className="text-xs text-content-secondary">{deal.leadInvestor}</span>
                                </td>
                                <td className="py-4 px-4">
                                    <span className="text-xs text-content-secondary font-mono">{formatDate(deal.announcedDate)}</span>
                                </td>
                                <td className="py-4 px-4 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <span className={`text-2xl font-semibold ${scoreColor}`}>
                                            {deal.bankerScore}
                                        </span>
                                        <div className="w-16 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${deal.bankerScore >= 80 ? 'bg-[var(--accent-primary)]' : deal.bankerScore >= 60 ? 'bg-blue-600' : 'bg-amber-500'}`}
                                                style={{ width: `${deal.bankerScore}%` }}
                                            />
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
