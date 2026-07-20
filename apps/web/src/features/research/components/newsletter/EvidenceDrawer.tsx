// src/components/newsletter/EvidenceDrawer.tsx
// Right sidebar drawer for sources, artifacts, and verification
// Provides source transparency for the newsletter view

import React, { useState, useMemo } from 'react';
import {
    X, Search, ExternalLink, CheckCircle2, AlertCircle,
    FileText, Youtube, Globe, Filter, ChevronDown, Link2,
    ShieldCheck, Clock, Eye
} from 'lucide-react';
import { Sheet, SheetContent, SheetOverlay, SheetPortal } from '@/components/ai-ui/sheet';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceSource {
    id: string;
    title: string;
    url: string;
    domain: string;
    type: 'web' | 'youtube' | 'sec' | 'pdf' | 'news';
    snippet?: string;
    verified?: boolean;
    citedInSections?: string[];
    discoveredAt?: number;
}

interface EvidenceDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    sources: EvidenceSource[];
    activeSection?: string;
    onSourceClick?: (source: EvidenceSource) => void;
    className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function SourceCard({ source, onSourceClick }: { source: EvidenceSource; onSourceClick?: (s: EvidenceSource) => void }) {
    const typeIcons = {
        web: <Globe className="w-3.5 h-3.5 text-blue-500" />,
        youtube: <Youtube className="w-3.5 h-3.5 text-red-500" />,
        sec: <FileText className="w-3.5 h-3.5 text-green-600" />,
        pdf: <FileText className="w-3.5 h-3.5 text-orange-500" />,
        news: <Globe className="w-3.5 h-3.5 text-purple-500" />,
    };

    return (
        <div
            onClick={() => onSourceClick?.(source)}
            className="p-3 bg-surface rounded-lg border border-edge hover:shadow-md hover:border-primary/20 cursor-pointer transition-all duration-200 group"
        >
            <div className="flex items-start gap-2">
                <span className="p-1.5 bg-surface-secondary rounded border border-edge shrink-0">
                    {typeIcons[source.type]}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-medium text-content truncate group-hover:text-blue-600 transition-colors">
                            {source.title}
                        </h4>
                        {source.verified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        )}
                    </div>
                    <p className="text-xs text-content-secondary truncate">{source.domain}</p>
                    {source.snippet && (
                        <p className="text-xs text-content mt-1 line-clamp-2">{source.snippet}</p>
                    )}
                    {source.citedInSections && source.citedInSections.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                            {source.citedInSections.slice(0, 3).map(section => (
                                <span key={section} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">
                                    {section.replace(/_/g, ' ')}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-content-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-secondary flex items-center justify-center mb-3">
                <Link2 className="w-5 h-5 text-content-secondary" />
            </div>
            <p className="text-sm text-content-secondary">{message}</p>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function EvidenceDrawer({
    isOpen,
    onClose,
    sources,
    activeSection,
    onSourceClick,
    className = '',
}: EvidenceDrawerProps) {
    const [activeTab, setActiveTab] = useState<'sources' | 'verify'>('sources');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<string | null>(null);

    // Filter sources
    const filteredSources = useMemo(() => {
        let result = sources;

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(s =>
                s.title.toLowerCase().includes(q) ||
                s.domain.toLowerCase().includes(q) ||
                s.snippet?.toLowerCase().includes(q)
            );
        }

        if (filterType) {
            result = result.filter(s => s.type === filterType);
        }

        return result;
    }, [sources, searchQuery, filterType]);

    // Group by section for better organization
    const verifiedCount = sources.filter(s => s.verified).length;
    const unverifiedCount = sources.length - verifiedCount;

    return (
        <Sheet open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
          <SheetPortal>
            <SheetOverlay className="bg-black/30" />
          <SheetContent
            showCloseButton={false}
            className={`inset-y-0 right-0 w-[400px] max-w-full bg-surface border-l border-edge shadow-2xl z-50 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right motion-reduce:animate-none ${className}`}
            aria-labelledby="evidence-drawer-title"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-content" />
                    <h2 id="evidence-drawer-title" className="font-semibold text-content">Evidence</h2>
                    <span className="px-1.5 py-0.5 bg-surface-secondary text-content text-xs rounded-full font-medium">
                        {sources.length}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
                >
                    <X className="w-4 h-4 text-content-secondary" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-edge bg-surface px-4">
                <button
                    onClick={() => setActiveTab('sources')}
                    className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'sources'
                        ? 'border-[color:var(--text-primary)] text-content'
                        : 'border-transparent text-content-secondary hover:text-content'
                        }`}
                >
                    Sources ({sources.length})
                </button>
                <button
                    onClick={() => setActiveTab('verify')}
                    className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'verify'
                        ? 'border-[color:var(--text-primary)] text-content'
                        : 'border-transparent text-content-secondary hover:text-content'
                        }`}
                >
                    Verify
                </button>
            </div>

            {/* Search & Filter */}
            <div className="px-4 py-3 bg-surface border-b border-edge">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-secondary" />
                    <input
                        type="text"
                        placeholder="Search sources..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm bg-surface-secondary border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-blue-500"
                    />
                </div>
                <div className="flex gap-1.5 mt-2">
                    {['all', 'web', 'youtube', 'sec', 'pdf'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type === 'all' ? null : type)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${(type === 'all' && !filterType) || filterType === type
                                ? 'bg-gray-900 text-white'
                                : 'bg-surface-secondary text-content hover:bg-surface-hover'
                                }`}
                        >
                            {type.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {activeTab === 'sources' && (
                    <div className="space-y-2">
                        {filteredSources.length === 0 ? (
                            <EmptyState message={searchQuery ? "No sources match your search" : "No sources found"} />
                        ) : (
                            filteredSources.map(source => (
                                <SourceCard
                                    key={source.id}
                                    source={source}
                                    onSourceClick={onSourceClick}
                                />
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'verify' && (
                    <div className="space-y-4">
                        {/* Verification Summary */}
                        <div className="p-4 bg-surface rounded-lg border border-edge">
                            <h3 className="text-sm font-semibold text-content mb-3">Verification Status</h3>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                                        <span className="text-sm text-content">Verified</span>
                                    </div>
                                    <span className="text-sm font-medium text-indigo-600">{verifiedCount}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-amber-500" />
                                        <span className="text-sm text-content">Pending</span>
                                    </div>
                                    <span className="text-sm font-medium text-amber-600">{unverifiedCount}</span>
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-edge">
                                <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 rounded-full transition-all"
                                        style={{ width: sources.length > 0 ? `${(verifiedCount / sources.length) * 100}%` : '0%' }}
                                    />
                                </div>
                                <p className="text-xs text-content-secondary mt-1.5">
                                    {sources.length > 0 ? Math.round((verifiedCount / sources.length) * 100) : 0}% of sources verified
                                </p>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="p-4 bg-surface rounded-lg border border-edge">
                            <h3 className="text-sm font-semibold text-content mb-3">Quick Actions</h3>
                            <div className="space-y-2">
                                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content bg-surface-secondary hover:bg-surface-hover rounded-lg transition-colors">
                                    <Eye className="w-4 h-4" />
                                    View all citations
                                </button>
                                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-content bg-surface-secondary hover:bg-surface-hover rounded-lg transition-colors">
                                    <AlertCircle className="w-4 h-4" />
                                    Flag inconsistency
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-edge bg-surface">
                <p className="text-xs text-content-secondary text-center">
                    Click any source to open in new tab
                </p>
            </div>
          </SheetContent>
          </SheetPortal>
        </Sheet>
    );
}

export default EvidenceDrawer;
