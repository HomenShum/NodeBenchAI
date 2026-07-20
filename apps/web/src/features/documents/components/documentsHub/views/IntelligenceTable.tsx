/**
 * IntelligenceTable Component
 * 
 * A Notion-style data table wrapper that provides:
 * - Sticky column headers
 * - Consistent column sizing
 * - Themed styling with CSS variables
 */

import type { ReactNode } from "react";

export interface IntelligenceTableProps {
    /** Table rows content */
    children: ReactNode;
    /** Optional className for the container */
    className?: string;
    /** Show/hide specific columns on smaller screens */
    showTagsColumn?: boolean;
    showStatusColumn?: boolean;
    showDateColumn?: boolean;
}

/**
 * IntelligenceTable - Wraps document rows in a table with header
 */
export function IntelligenceTable({
    children,
    className = "",
    showTagsColumn = true,
    showStatusColumn = true,
    showDateColumn = true,
}: IntelligenceTableProps) {
    return (
        <div className={`bg-surface rounded-lg border border-edge shadow-sm overflow-hidden ${className}`}>
            {/* Table Header - Sticky */}
            <div className="sticky top-0 z-10 flex items-center gap-4 px-4 py-2.5 bg-surface-secondary border-b border-edge text-xs font-semibold text-content-muted">
                {/* Checkbox spacer */}
                <div className="w-6 shrink-0" />

                {/* Name column */}
                <div className="flex-1">Name</div>

                {/* Tags column */}
                {showTagsColumn && (
                    <div className="w-48 hidden md:block">Tags</div>
                )}

                {/* Status column */}
                {showStatusColumn && (
                    <div className="w-28 hidden lg:block">Status</div>
                )}

                {/* Date column */}
                {showDateColumn && (
                    <div className="w-24 hidden sm:block">Modified</div>
                )}

                {/* Actions spacer */}
                <div className="w-28" />
            </div>

            {/* Table Body */}
            <div className="divide-y divide-[var(--border-color)]/50">
                {children}
            </div>
        </div>
    );
}

/**
 * Empty state for when there are no documents
 */
export function IntelligenceTableEmpty({ message = "No documents found" }: { message?: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-lg bg-surface-secondary flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-content-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            </div>
            <p className="text-sm text-content-secondary">{message}</p>
        </div>
    );
}
