/**
 * DocumentBreadcrumbs
 * Displays the folder hierarchy path to the current document.
 * Each segment is clickable for navigation.
 */

import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { Home, ChevronRight, Folder } from 'lucide-react';

interface DocumentBreadcrumbsProps {
    documentId: Id<"documents">;
    onNavigate?: (documentId: Id<"documents"> | null) => void;
}

interface BreadcrumbSegment {
    id: Id<"documents"> | null;
    title: string;
    isFolder: boolean;
}

export function DocumentBreadcrumbs({ documentId, onNavigate }: DocumentBreadcrumbsProps) {
    // Get the current document to find its parent
    const document = useQuery(api.domains.documents.documents.getById, { documentId });

    // Get the parent chain (ancestors)
    const ancestors = useQuery(
        api.domains.documents.documents.getAncestors,
        document?.parentId ? { documentId } : 'skip'
    );

    // Build the breadcrumb segments
    const segments: BreadcrumbSegment[] = [
        { id: null, title: 'Home', isFolder: false },
    ];

    if (ancestors && Array.isArray(ancestors)) {
        ancestors.forEach((ancestor: any) => {
            segments.push({
                id: ancestor._id,
                title: ancestor.title || 'Untitled',
                isFolder: true,
            });
        });
    }

    // Add the current document
    if (document) {
        segments.push({
            id: document._id,
            title: document.title || 'Untitled',
            isFolder: false,
        });
    }

    const handleClick = (segmentId: Id<"documents"> | null) => {
        if (onNavigate) {
            onNavigate(segmentId);
        } else {
            // Default behavior: dispatch navigation event
            if (segmentId === null) {
                window.dispatchEvent(new CustomEvent('nodebench:goBack'));
            } else {
                window.dispatchEvent(new CustomEvent('nodebench:openDocument', { detail: { documentId: segmentId } }));
            }
        }
    };

    // Don't show breadcrumbs if we only have Home + Current (no folders in between)
    if (segments.length <= 2) {
        return null;
    }

    return (
        <nav className="flex items-center gap-1 text-xs text-content-muted mb-2 px-2 overflow-x-auto no-scrollbar">
            {segments.map((segment, index) => {
                const isLast = index === segments.length - 1;
                const isClickable = !isLast;

                return (
                    <div key={segment.id ?? 'home'} className="flex items-center gap-1 shrink-0">
                        {index > 0 && (
                            <ChevronRight className="w-3 h-3 text-content-muted opacity-50" />
                        )}
                        <button
                            type="button"
                            onClick={() => isClickable && handleClick(segment.id)}
                            disabled={!isClickable}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${isClickable
                                ? 'hover:bg-surface-hover hover:text-content cursor-pointer'
                                : 'text-content-secondary font-medium cursor-default'
                                }`}
                        >
                            {segment.id === null ? (
                                <Home className="w-3 h-3" />
                            ) : segment.isFolder ? (
                                <Folder className="w-3 h-3 text-amber-500" />
                            ) : null}
                            <span className="truncate max-w-[120px]">{segment.title}</span>
                        </button>
                    </div>
                );
            })}
        </nav>
    );
}

export default DocumentBreadcrumbs;
