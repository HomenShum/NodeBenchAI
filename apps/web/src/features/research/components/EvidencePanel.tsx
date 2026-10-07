import React, { useState } from 'react';
import { ExternalLink, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import type { Evidence } from '../types';
import { useEvidence } from '../contexts/EvidenceContext';

interface EvidencePanelProps {
    /** Array of evidence items to display */
    evidence: Evidence[];
    /** Maximum items to show before "Show more" (default: 4) */
    maxVisible?: number;
    /** Optional title override */
    title?: string;
    /** Open evidence in the internal reader */
    onEvidenceClick?: (evidence: Evidence) => void;
}

/**
 * EvidencePanel - Collapsible panel showing cited sources
 * 
 * Builds trust by showing users where the AI's claims come from.
 */
export function EvidencePanel({
    evidence,
    maxVisible = 4,
    title = "Cited Sources",
    onEvidenceClick
}: EvidencePanelProps) {
    const [expanded, setExpanded] = useState(false);
    const evidenceCtx = useEvidence();
    const highlightedId = evidenceCtx.store.highlightedId;

    if (!evidence || evidence.length === 0) {
        return null;
    }

    const visible = expanded ? evidence : evidence.slice(0, maxVisible);
    const hasMore = evidence.length > maxVisible;
    const shouldScroll = expanded && evidence.length > maxVisible;

    return (
        <div className="border-t border-edge/60 pt-5 mt-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <FileText className="w-3 h-3 text-gray-900/50" />
                    <h4 className="text-xs font-bold text-content">
                        {title}
                    </h4>
                    <span className="text-xs font-mono text-content-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                        {evidence.length}
                    </span>
                </div>

                {hasMore && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        aria-expanded={expanded}
                        className="flex items-center gap-1 text-xs text-content-secondary hover:text-content transition-colors"
                    >
                        {expanded ? (
                            <>
                                <span>Show less</span>
                                <ChevronUp className="w-3 h-3" />
                            </>
                        ) : (
                            <>
                                <span>View all {evidence.length}</span>
                                <ChevronDown className="w-3 h-3" />
                            </>
                        )}
                    </button>
                )}
            </div>

            {/* Evidence List */}
            <div className={shouldScroll ? "max-h-[260px] overflow-y-auto pr-2" : ""}>
                <ul className="space-y-2.5">
                    {visible.map((ev, i) => {
                        const isHighlighted = ev.id ? ev.id === highlightedId : false;
                        const handleOpen = () => {
                            if (onEvidenceClick) {
                                onEvidenceClick(ev);
                                return;
                            }
                            if (ev.url) {
                                window.open(ev.url, "_blank", "noopener,noreferrer");
                            }
                        };

                        return (
                            <li
                                key={`${ev.id ?? ev.url ?? ev.title ?? ev.source ?? "evidence"}-${i}`}
                                data-evidence-id={ev.id}
                                className={`group flex items-start gap-2.5 ${isHighlighted ? "bg-indigo-50/60 rounded-md px-2 py-1" : ""}`}
                            >
                                {/* Index Badge */}
                                <span className="text-xs font-mono text-content-muted bg-surface-secondary w-5 h-5 flex items-center justify-center rounded shrink-0">
                                    {i + 1}
                                </span>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <button
                                        type="button"
                                        onClick={handleOpen}
                                        className="text-xs text-content-secondary hover:text-content transition-colors flex items-start gap-1.5 group/link text-left w-full"
                                    >
                                        <span className="truncate flex-1">
                                            {ev.title || ev.source || ev.url || "Source"}
                                        </span>
                                        {ev.url && (
                                            <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity mt-0.5" />
                                        )}
                                    </button>

                                    {/* Source Badge */}
                                    {ev.source && ev.title && (
                                        <span className="text-xs text-content-muted mt-0.5 block">
                                            via {ev.source}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {/* Collapsed indicator */}
            {!expanded && hasMore && (
                <div className="mt-3 pt-2 border-t border-dashed border-edge/50 text-center">
                    <span className="text-xs text-content-muted italic">
                        {evidence.length - maxVisible} more sources available
                    </span>
                </div>
            )}
            {expanded && shouldScroll && (
                <div className="mt-3 pt-2 border-t border-dashed border-edge/50 text-center">
                    <span className="text-xs text-content-muted italic">
                        Scroll to view all sources
                    </span>
                </div>
            )}
        </div>
    );
}

export default EvidencePanel;
