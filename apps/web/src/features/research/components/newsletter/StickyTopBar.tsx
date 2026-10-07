// src/components/newsletter/StickyTopBar.tsx
// Sticky navigation bar for long dossiers
// Shows entity, scope, verification status, and quick actions

import React, { useState, useEffect } from 'react';
import {
    Building2, Calendar, CheckCircle2, AlertCircle, Clock,
    RefreshCw, Share2, Download, Bell, ChevronDown, Sparkles
} from 'lucide-react';

interface StickyTopBarProps {
    entity: string;
    scope?: 'week' | 'month' | 'all';
    verificationStatus?: 'verified' | 'partial' | 'pending';
    lastRefresh?: Date;
    onScopeChange?: (scope: 'week' | 'month' | 'all') => void;
    onRefresh?: () => void;
    onExport?: () => void;
    onSubscribe?: () => void;
    isRefreshing?: boolean;
    className?: string;
}

const SCOPE_LABELS = {
    week: 'This Week',
    month: 'This Month',
    all: 'All Time',
};

const VERIFICATION_CONFIG = {
    verified: {
        icon: CheckCircle2,
        color: 'text-indigo-600',
        bg: 'bg-indigo-50',
        border: 'border-indigo-200',
        label: 'Verified',
    },
    partial: {
        icon: Clock,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        label: 'Partial',
    },
    pending: {
        icon: AlertCircle,
        color: 'text-content-secondary',
        bg: 'bg-surface-secondary',
        border: 'border-edge',
        label: 'Pending',
    },
};

export function StickyTopBar({
    entity,
    scope = 'week',
    verificationStatus = 'partial',
    lastRefresh,
    onScopeChange,
    onRefresh,
    onExport,
    onSubscribe,
    isRefreshing = false,
    className = '',
}: StickyTopBarProps) {
    const [isSticky, setIsSticky] = useState(false);
    const [showScopeDropdown, setShowScopeDropdown] = useState(false);

    // Track scroll for sticky behavior
    useEffect(() => {
        const handleScroll = () => {
            setIsSticky(window.scrollY > 200);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const verificationConfig = VERIFICATION_CONFIG[verificationStatus];
    const VerificationIcon = verificationConfig.icon;

    return (
        <div
            className={`
                ${isSticky ? 'fixed top-0 left-0 right-0 z-40 shadow-md animate-in slide-in-from-top duration-200' : ''}
                bg-surface border-b border-edge ${className}
            `}
        >
            <div className="max-w-5xl mx-auto px-6 py-3">
                <div className="flex items-center justify-between gap-4">
                    {/* Left: Entity + Scope */}
                    <div className="flex items-center gap-3">
                        {/* Entity Pill */}
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary rounded-full">
                            <Building2 className="w-3.5 h-3.5 text-content" />
                            <span className="text-sm font-semibold text-content truncate max-w-[200px]">
                                {entity}
                            </span>
                        </div>

                        {/* Scope Selector */}
                        <div className="relative">
                            <button
                                onClick={() => setShowScopeDropdown(!showScopeDropdown)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-content hover:text-content hover:bg-surface-hover rounded-lg transition-colors"
                            >
                                <Calendar className="w-3.5 h-3.5" />
                                {SCOPE_LABELS[scope]}
                                <ChevronDown className="w-3 h-3" />
                            </button>
                            
                            {showScopeDropdown && (
                                <div className="absolute top-full left-0 mt-1 py-1 bg-surface rounded-lg shadow-lg border border-edge z-50 min-w-[120px]">
                                    {Object.entries(SCOPE_LABELS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            onClick={() => {
                                                onScopeChange?.(key as 'week' | 'month' | 'all');
                                                setShowScopeDropdown(false);
                                            }}
                                            className={`w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover transition-colors ${
                                                scope === key ? 'font-semibold text-content' : 'text-content'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Verification Badge */}
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${verificationConfig.bg} ${verificationConfig.border} border`}>
                            <VerificationIcon className={`w-3 h-3 ${verificationConfig.color}`} />
                            <span className={`text-xs font-medium ${verificationConfig.color}`}>
                                {verificationConfig.label}
                            </span>
                        </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                        {/* Last Refresh */}
                        {lastRefresh && (
                            <span className="text-xs text-content-secondary mr-2">
                                Updated {formatTimeAgo(lastRefresh)}
                            </span>
                        )}

                        {/* Refresh */}
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="p-2 text-content-secondary hover:text-content hover:bg-surface-hover rounded-lg transition-colors disabled:opacity-50"
                                title="Refresh"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
                            </button>
                        )}

                        {/* Export */}
                        {onExport && (
                            <button
                                onClick={onExport}
                                className="p-2 text-content-secondary hover:text-content hover:bg-surface-hover rounded-lg transition-colors"
                                title="Export"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                        )}

                        {/* Subscribe */}
                        {onSubscribe && (
                            <button
                                onClick={onSubscribe}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                Subscribe
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper: format relative time
function formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default StickyTopBar;
