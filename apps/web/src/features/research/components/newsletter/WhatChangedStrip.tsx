// src/components/newsletter/WhatChangedStrip.tsx
// Compact strip showing what changed since last view
// Quick visual indicator of new sources, updates, and contradictions

import React from 'react';
import { Plus, RefreshCw, AlertTriangle, ChevronRight, Eye } from 'lucide-react';

interface WhatChangedStripProps {
    newSources: number;
    updates: number;
    contradictions: number;
    lastUpdated?: Date;
    onViewDiff?: () => void;
    className?: string;
}

export function WhatChangedStrip({
    newSources,
    updates,
    contradictions,
    lastUpdated,
    onViewDiff,
    className = '',
}: WhatChangedStripProps) {
    const hasChanges = newSources > 0 || updates > 0 || contradictions > 0;

    if (!hasChanges) return null;

    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100 ${className}`}>
            {/* New Sources */}
            {newSources > 0 && (
                <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                        <Plus className="w-3 h-3 text-indigo-600" />
                    </div>
                    <span className="text-xs font-medium text-content-secondary">
                        {newSources} new source{newSources !== 1 ? 's' : ''}
                    </span>
                </div>
            )}

            {/* Separator */}
            {newSources > 0 && updates > 0 && (
                <span className="text-[color:var(--border-color)]">•</span>
            )}

            {/* Updates */}
            {updates > 0 && (
                <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                        <RefreshCw className="w-3 h-3 text-blue-600" />
                    </div>
                    <span className="text-xs font-medium text-blue-700">
                        {updates} update{updates !== 1 ? 's' : ''}
                    </span>
                </div>
            )}

            {/* Separator */}
            {(newSources > 0 || updates > 0) && contradictions > 0 && (
                <span className="text-[color:var(--border-color)]">•</span>
            )}

            {/* Contradictions */}
            {contradictions > 0 && (
                <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                    </div>
                    <span className="text-xs font-medium text-amber-700">
                        {contradictions} conflict{contradictions !== 1 ? 's' : ''}
                    </span>
                </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Last Updated */}
            {lastUpdated && (
                <span className="text-xs text-content-secondary">
                    {formatTimeAgo(lastUpdated)}
                </span>
            )}

            {/* View Diff Button */}
            {onViewDiff && (
                <button
                    onClick={onViewDiff}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-content bg-surface hover:bg-surface-hover rounded-lg border border-edge transition-colors"
                >
                    <Eye className="w-3 h-3" />
                    View diff
                    <ChevronRight className="w-3 h-3" />
                </button>
            )}
        </div>
    );
}

// Helper: format relative time
function formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default WhatChangedStrip;
