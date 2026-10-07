// src/components/newsletter/NewsletterComponents.tsx
// Reusable newsletter-style components extracted from prototype
// Used by LiveDossierDocument for clean editorial layout

import React, { ReactNode } from 'react';
import {
    CheckCircle2, Youtube, ExternalLink, FileText
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsletterBullet {
    text: string;
    evidenceChips: string[];
}

export interface NewsletterMediaItem {
    type: 'youtube' | 'web' | 'sec' | 'pdf';
    title: string;
    domain: string;
    url?: string;
    verified?: boolean;
}

export interface NewsletterSection {
    key: string;
    title: string;
    icon: ReactNode;
    freshness: 'new' | 'updated' | 'stable';
    bullets: NewsletterBullet[];
    mediaRail: NewsletterMediaItem[];
    takeaway?: string;
    isPinned?: boolean;
    isExpanded?: boolean;
    confidence?: string;
}

interface KPI {
    label: string;
    value: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// Helper component for rendering a single bullet point
function BulletItem({ bullet, onEvidenceClick }: { bullet: NewsletterBullet; onEvidenceClick?: (chipId: string) => void; }) {
    return (
        <div className="flex items-start gap-2">
            <span className="mt-1.5 h-1 w-1 rounded-full bg-blue-500 shrink-0" />
            <div className="flex-1">
                <span className="text-sm leading-6 text-content">{bullet.text}</span>
                {bullet.evidenceChips.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                        {bullet.evidenceChips.map((chip) => (
                            <span
                                key={chip}
                                onClick={() => onEvidenceClick?.(chip)}
                                className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-100 text-blue-700 text-[8px] font-bold cursor-pointer hover:bg-blue-200 transition-colors"
                                title="Click to view source"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Helper component for rendering a single media item
function MediaItem({ item }: { item: NewsletterMediaItem }) {
    return (
        <div className="p-3 bg-surface-secondary hover:bg-surface-hover rounded-lg border border-edge cursor-pointer transition-colors">
            <div className="flex items-start gap-2">
                <span className="p-1 bg-surface rounded border border-edge">
                    {item.type === 'youtube' && <Youtube className="w-3 h-3 text-red-500" />}
                    {item.type === 'web' && <ExternalLink className="w-3 h-3 text-blue-500" />}
                    {item.type === 'sec' && <FileText className="w-3 h-3 text-green-500" />}
                    {item.type === 'pdf' && <FileText className="w-3 h-3 text-purple-500" />}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-content truncate">{item.title}</div>
                    <div className="text-xs text-content-secondary truncate">{item.domain}</div>
                </div>
                {item.verified && <CheckCircle2 className="w-3 h-3 text-indigo-500 shrink-0" />}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION BLOCK (Document Style)
// ═══════════════════════════════════════════════════════════════════════════

export function NewsletterSectionBlock({
    section,
    onToggleExpand,
    onEvidenceChipClick,
}: {
    section: NewsletterSection;
    onToggleExpand?: () => void;
    onTogglePin?: () => void; // Kept for interface compatibility but unused in UI
    onEvidenceChipClick?: (chipId: string) => void;
}) {
    // Default to expanded if not specified
    const isExpanded = section.isExpanded ?? true;

    return (
        <div className="mb-8 group">
            {/* Header - Simple H2 style */}
            <div
                className="flex items-center gap-2 mb-3 cursor-pointer select-none"
                onClick={onToggleExpand}
            >
                <div className="p-1 rounded text-content-secondary group-hover:text-content transition-colors">
                    {section.icon}
                </div>
                <h2 className="text-xl font-semibold text-content flex-1">{section.title}</h2>

                {/* Confidence Badge - Subtle */}
                {section.confidence && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-secondary text-content">
                        {section.confidence}
                    </span>
                )}
            </div>

            {/* Content */}
            {isExpanded && (
                <div className="pl-2 border-l-2 border-transparent hover:border-edge transition-colors">
                    {/* Bullets */}
                    <div className="space-y-3 text-content leading-relaxed">
                        {section.bullets.map((bullet, idx) => (
                            <BulletItem
                                key={idx}
                                bullet={bullet}
                                onEvidenceClick={onEvidenceChipClick}
                            />
                        ))}
                    </div>

                    {/* Media Rail - Simple Grid */}
                    {section.mediaRail && section.mediaRail.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {section.mediaRail.map((item, idx) => (
                                <MediaItem key={idx} item={item} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// HERO (Document Title)
// ═══════════════════════════════════════════════════════════════════════════

export function DigestHero({
    title,
    summary,
    confidence,
}: {
    title: string;
    summary: string;
    kpis?: KPI[]; // Unused in simple mode
    confidence?: string;
}) {
    return (
        <div className="mb-10 pb-6 border-b border-edge">
            <h1 className="text-4xl font-bold text-content mb-4 tracking-tight">{title}</h1>
            <p className="text-lg text-content leading-relaxed">{summary}</p>

            {confidence && (
                <div className="mt-4 flex items-center gap-2 text-sm text-content-secondary">
                    <span className="font-medium">Confidence Score:</span>
                    <span className="bg-surface-secondary px-2 py-0.5 rounded text-content">{confidence}</span>
                </div>
            )}
        </div>
    );
}
